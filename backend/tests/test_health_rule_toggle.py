"""Turning a health check off for one workspace, without turning it off for everyone.

`FEATURES.md` recorded this as "supported by the schema and engine but has no UI". The schema did
support it. The engine did not: `enabled_definitions()` discarded a disabled row *before* comparing
versions, so a workspace override at `v2, enabled=False` was thrown away and the global
`v1, enabled=True` still won. Measured 2026-09-15: every definition in the database was a global,
enabled `v1`, so no workspace had ever been able to switch a check off.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.core.enums import SignalStatus
from app.models.health import AccountHealthSignal, HealthRuleDefinition

RULE = "readiness_unknown"


def _definitions(db_session, rule_key=RULE):
    return db_session.execute(
        sa.select(HealthRuleDefinition)
        .where(HealthRuleDefinition.rule_key == rule_key)
        .order_by(HealthRuleDefinition.version)
    ).scalars().all()


# ------------------------------------------------------------------ the selection order


def test_a_workspace_override_can_actually_turn_a_rule_off(api, db_session, owner):
    """The defect, as a test. Before the fix this returned the rule as still enabled."""
    api.get("/api/v1/account-health/rules")  # seeds the globals

    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})

    from app.services.health_service import HealthRuleRegistryService

    registry = HealthRuleRegistryService(db_session, owner["workspace"].id)
    assert RULE not in registry.enabled_definitions()


def test_a_rule_can_be_turned_back_on(api, db_session, owner):
    from app.services.health_service import HealthRuleRegistryService

    api.get("/api/v1/account-health/rules")
    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})
    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": True})

    registry = HealthRuleRegistryService(db_session, owner["workspace"].id)
    assert RULE in registry.enabled_definitions()


def test_with_no_override_anywhere_selection_is_unchanged(api, db_session, owner):
    """The engine change must be a no-op for every workspace that has not overridden anything —
    which, measured on 2026-09-15, was all of them."""
    from app.services.health_service import HealthRuleRegistryService

    api.get("/api/v1/account-health/rules")
    registry = HealthRuleRegistryService(db_session, owner["workspace"].id)

    enabled = registry.enabled_definitions()

    assert RULE in enabled
    assert all(row.enabled for row in enabled.values())
    assert all(row.workspace_id is None for row in enabled.values())


# ------------------------------------------------------- the shared default stays shared


def test_the_global_row_is_never_edited(api, db_session):
    api.get("/api/v1/account-health/rules")
    before = [(row.id, row.enabled) for row in _definitions(db_session) if row.workspace_id is None]

    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})

    db_session.expire_all()
    after = [(row.id, row.enabled) for row in _definitions(db_session) if row.workspace_id is None]
    assert after == before, "the shared default must be untouched"


def test_another_workspace_still_has_the_rule(api, client, other_owner):
    """The whole reason an override is written instead of an edit: every definition shipped today
    is global, so flipping one in place would change what a different tenant is shown."""
    api.get("/api/v1/account-health/rules")
    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})

    login = client.post(
        "/api/v1/auth/login",
        json={"email": other_owner["user"].email, "password": other_owner["password"]},
    ).json()
    theirs = client.get(
        "/api/v1/account-health/rules",
        headers={"Authorization": f"Bearer {login['access_token']}"},
    ).json()

    row = next(r for r in theirs if r["rule_key"] == RULE)
    assert row["enabled"] is True


def test_asking_twice_for_the_same_state_stacks_no_versions(api, db_session):
    api.get("/api/v1/account-health/rules")
    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})
    first = len(_definitions(db_session))

    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})

    db_session.expire_all()
    assert len(_definitions(db_session)) == first


# ------------------------------------------------------------ disabling is not resolving


def test_open_signals_expire_rather_than_resolve(api, db_session):
    """Rules 12 and 16 in spirit: switching a check off must never look like the problem went
    away. The signal is expired, with the reason recorded, and the history is kept."""
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Watched"}).json()
    open_signals = db_session.execute(
        sa.select(AccountHealthSignal).where(
            AccountHealthSignal.ad_account_id == account["id"],
            AccountHealthSignal.rule_key == RULE,
        )
    ).scalars().all()
    assert open_signals, "precondition: the rule produced a signal"

    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")

    db_session.expire_all()
    signal = db_session.execute(
        sa.select(AccountHealthSignal).where(
            AccountHealthSignal.ad_account_id == account["id"],
            AccountHealthSignal.rule_key == RULE,
        )
    ).scalars().first()
    assert signal.status is SignalStatus.EXPIRED
    assert signal.status is not SignalStatus.RESOLVED
    # `resolution_reason` is deliberately only written when a signal is RESOLVED — an expired
    # signal was not resolved, and filling that column would say it was. The reason lives in the
    # audit row instead, which is where this asserts it.
    from app.models.entities import AuditLog

    expiry = db_session.execute(
        sa.select(AuditLog)
        .where(
            AuditLog.action == "health_signal.expired",
            AuditLog.entity_id == str(signal.id),
        )
    ).scalars().first()
    assert expiry is not None
    assert "no longer enabled" in expiry.metadata_json["reason"]


# --------------------------------------------------------------------------- access


def test_only_the_owner_may_change_a_rule(api, client, db_session, owner):
    from app.core.enums import WorkspaceRole
    from app.core.security import hash_password
    from app.models.entities import User, WorkspaceMember

    user = User(
        email="rule-member@example.com",
        full_name="Member",
        password_hash=hash_password("correct-horse-battery"),
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        WorkspaceMember(workspace_id=owner["workspace"].id, user_id=user.id, role=WorkspaceRole.BUYER)
    )
    db_session.commit()
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "rule-member@example.com", "password": "correct-horse-battery"},
    ).json()

    response = client.patch(
        f"/api/v1/account-health/rules/{RULE}",
        json={"enabled": False},
        headers={"Authorization": f"Bearer {login['access_token']}"},
    )

    assert response.status_code in (403, 404)


def test_a_rule_the_engine_cannot_evaluate_is_refused(api):
    api.get("/api/v1/account-health/rules")

    response = api.patch("/api/v1/account-health/rules/not_a_real_rule", json={"enabled": False})

    assert response.status_code == 404


def test_the_change_is_audited(api, db_session, owner):
    from app.models.entities import AuditLog

    api.get("/api/v1/account-health/rules")
    api.patch(f"/api/v1/account-health/rules/{RULE}", json={"enabled": False})

    db_session.expire_all()
    row = db_session.execute(
        sa.select(AuditLog).where(AuditLog.action == "health_rule.disabled")
    ).scalars().first()
    assert row is not None
    assert row.metadata_json["rule_key"] == RULE
    assert row.metadata_json["enabled"] is False
