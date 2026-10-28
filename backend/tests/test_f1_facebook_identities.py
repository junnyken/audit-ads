"""F1 — Facebook account profiles: no login secret ever stored, the email behind a PIN, and every ad
account answering "which Facebook account do I log in to"."""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet

from alembic import command
from alembic.config import Config
from app.core.config import get_settings
from app.core.enums import IdentityBusinessRole, WorkspaceRole
from app.core.security import hash_password
from app.db.session import engine
from app.models.entities import AuditLog, PersonalAccountReference, User, WorkspaceMember
from app.models.team import MemberBusinessManagerAssignment
from tests.conftest import login

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES = "/api/v1/personal-account-references"
EMAIL = "nguyen.van.a@gmail.com"
PIN = "482913"


@pytest.fixture()
def vault(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "credential_vault_key", Fernet.generate_key().decode())
    return settings


def _member(db_session, owner, *, email: str, role: WorkspaceRole) -> WorkspaceMember:
    user = User(email=email, full_name=email.split("@")[0], password_hash=hash_password("correct-horse-battery"), is_active=True)
    db_session.add(user)
    db_session.flush()
    member = WorkspaceMember(workspace_id=owner["workspace"].id, user_id=user.id, role=role)
    db_session.add(member)
    db_session.commit()
    return member


def _profile(api, **extra) -> dict:
    response = api.post(PROFILES, json={"label": "FB2 – Nguyễn A", **extra})
    assert response.status_code == 201, response.text
    return response.json()


def _bm(api, name="BM Shop XYZ", external_id="1993884657458857") -> dict:
    response = api.post("/api/v1/business-managers", json={"name": name, "external_id": external_id})
    assert response.status_code == 201, response.text
    return response.json()


def _set_pin(client, headers, password="correct-horse-battery", pin=PIN):
    return client.put("/api/v1/me/reveal-pin", headers=headers, json={"current_password": password, "new_pin": pin})


# ------------------------------------------------------------------------------------ migration
def _config() -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return config


def _revision() -> str:
    with engine.connect() as connection:
        return connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()


def test_head_is_0019_and_downgrade_round_trips(migrated_database):
    assert _revision() == "0019_f1_facebook_identities"
    tables_before = set(sa.inspect(engine).get_table_names())
    try:
        command.downgrade(_config(), "0018_o4_reader_credentials")
        inspector = sa.inspect(engine)
        assert tables_before - set(inspector.get_table_names()) == {"personal_account_business_links"}
        columns = {c["name"] for c in inspector.get_columns("personal_account_references")}
        assert not columns & {"email_ciphertext", "email_hint", "vault_reference", "two_factor_method"}
        assert "reveal_pin_hash" not in {c["name"] for c in inspector.get_columns("users")}
    finally:
        command.upgrade(_config(), "head")
    assert _revision() == "0019_f1_facebook_identities"
    assert set(sa.inspect(engine).get_table_names()) == tables_before


def test_no_column_can_hold_a_password_or_a_second_factor(migrated_database):
    inspector = sa.inspect(engine)
    names = {c["name"] for c in inspector.get_columns("personal_account_references")}
    for forbidden in ("password", "otp", "totp", "seed", "two_factor_code", "cookie", "session"):
        assert not any(forbidden in name for name in names), names


# ------------------------------------------------------------------------------- refusing secrets
@pytest.mark.parametrize("field", ["password", "fb_password", "pin", "otp", "totp", "two_factor_code", "backup_code", "seed", "cookie"])
def test_a_secret_named_field_is_refused(api, field):
    response = api.post(PROFILES, json={"label": "FB2", field: "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "forbidden_field"


@pytest.mark.parametrize(
    "field,value",
    [
        ("recovery_note", "pass: Abc123!"),
        ("recovery_note", "mật khẩu: abc"),
        ("notes", "mã 2FA 482913"),
        ("vault_reference", "JBSWY3DPEHPK3PXP"),
        ("vault_reference", "otpauth://totp/Facebook?secret=JBSWY3DPEHPK3PXP"),
        ("label", "FB2 pw=hunter2"),
    ],
)
def test_text_that_carries_a_password_or_code_is_refused(api, field, value):
    response = api.post(PROFILES, json={"label": "FB2", field: value} if field != "label" else {"label": value})
    assert response.status_code == 422, response.text


def test_ordinary_profile_text_is_accepted(api):
    profile = _profile(
        api,
        two_factor_method="app",
        vault_reference="https://vault.bitwarden.com/#/vault?itemId=3f2a9c1e-77b1-4c1e-9a1b-0d1c2e3f4a5b",
        recovery_note="SĐT khôi phục 0901234567 do chị B giữ",
        notes="Dùng cho BM 1993884657458857 từ 28/10/2026",
    )
    assert profile["two_factor_method"] == "app"
    assert profile["email_hint"] is None


def test_a_plain_http_vault_link_is_refused(api):
    assert api.post(PROFILES, json={"label": "FB2", "vault_reference": "http://vault.example.com/x"}).status_code == 422


def test_the_holder_must_be_a_member_of_this_workspace(api, db_session, owner, other_owner):
    foreign = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.workspace_id == other_owner["workspace"].id)
    ).scalar_one()
    response = api.post(PROFILES, json={"label": "FB2", "owner_member_id": str(foreign.id)})
    assert response.status_code == 422
    mine = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.workspace_id == owner["workspace"].id)
    ).scalar_one()
    assert _profile(api, owner_member_id=str(mine.id))["owner_member_id"] == str(mine.id)


# ------------------------------------------------------------------------------------- the email
def test_email_set_reveal_and_audit(client, auth, api, db_session, vault):
    profile = _profile(api)
    response = client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    assert response.status_code == 200, response.text
    assert response.json() == {"email_hint": "ng***@gmail.com", "email_stored": True}

    row = db_session.get(PersonalAccountReference, uuid.UUID(profile["id"]))
    db_session.refresh(row)
    assert row.email_ciphertext and EMAIL not in row.email_ciphertext

    # Every ordinary read carries the hint, never the address.
    for url in (f"{PROFILES}/{profile['id']}", PROFILES, f"{PROFILES}/{profile['id']}/profile"):
        body = api.get(url).text
        assert EMAIL not in body
    assert api.get(f"{PROFILES}/{profile['id']}/profile").json()["has_full_email"] is True

    # No PIN yet → refused, and it costs no attempt.
    no_pin = client.post(f"{PROFILES}/{profile['id']}/reveal-email", headers=auth, json={"pin": PIN})
    assert no_pin.status_code == 409 and no_pin.json()["error"]["code"] == "pin_not_set"

    assert _set_pin(client, auth).status_code == 200
    revealed = client.post(f"{PROFILES}/{profile['id']}/reveal-email", headers=auth, json={"pin": PIN})
    assert revealed.status_code == 200, revealed.text
    assert revealed.json() == {"email": EMAIL}

    audit_text = " ".join(
        str(entry.before_json) + str(entry.after_json) + str(entry.metadata_json)
        for entry in db_session.execute(sa.select(AuditLog)).scalars()
    )
    assert EMAIL not in audit_text
    assert row.email_ciphertext not in audit_text
    assert PIN not in audit_text
    actions = {entry.action for entry in db_session.execute(sa.select(AuditLog)).scalars()}
    assert {"personal_account_reference.email_set", "personal_account_reference.email_revealed", "user.reveal_pin_set"} <= actions


def test_without_a_vault_key_only_the_hint_is_kept(client, auth, api, db_session, monkeypatch):
    monkeypatch.setattr(get_settings(), "credential_vault_key", "")
    profile = _profile(api)
    response = client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    assert response.json() == {"email_hint": "ng***@gmail.com", "email_stored": False}
    row = db_session.get(PersonalAccountReference, uuid.UUID(profile["id"]))
    db_session.refresh(row)
    assert row.email_ciphertext is None
    assert api.get(f"{PROFILES}/{profile['id']}/profile").json()["has_full_email"] is False


def test_a_wrong_pin_counts_down_then_locks_for_fifteen_minutes(client, auth, api, db_session, owner, vault):
    profile = _profile(api)
    client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    assert _set_pin(client, auth).status_code == 200
    url = f"{PROFILES}/{profile['id']}/reveal-email"
    remaining = []
    for _ in range(4):
        response = client.post(url, headers=auth, json={"pin": "111222"})
        assert response.status_code == 403
        remaining.append(response.json()["error"]["details"]["attempts_remaining"])
    assert remaining == [4, 3, 2, 1]
    fifth = client.post(url, headers=auth, json={"pin": "111222"})
    assert fifth.status_code == 423
    # Locked: even the right PIN is refused, and the lock survived the failing requests' rollback.
    assert client.post(url, headers=auth, json={"pin": PIN}).status_code == 423
    user = db_session.get(User, owner["user"].id)
    db_session.refresh(user)
    assert user.reveal_pin_locked_until is not None
    user.reveal_pin_locked_until = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    assert client.post(url, headers=auth, json={"pin": PIN}).status_code == 200


def test_setting_a_pin_needs_the_current_password_and_six_digits(client, auth):
    assert _set_pin(client, auth, password="wrong-password-123").status_code == 403
    assert _set_pin(client, auth, pin="12345").status_code == 422
    assert _set_pin(client, auth, pin="abcdef").status_code == 422
    assert _set_pin(client, auth, pin="111111").status_code == 422
    assert client.get("/api/v1/me/reveal-pin", headers=auth).json()["is_set"] is False
    assert _set_pin(client, auth).status_code == 200
    assert client.get("/api/v1/me/reveal-pin", headers=auth).json()["is_set"] is True


def test_only_owner_admin_or_holder_may_reveal(client, auth, api, db_session, owner, vault):
    _buyer = _member(db_session, owner, email="buyer@example.com", role=WorkspaceRole.BUYER)
    holder = _member(db_session, owner, email="holder@example.com", role=WorkspaceRole.BUYER)
    profile = _profile(api, owner_member_id=str(holder.id))
    client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    url = f"{PROFILES}/{profile['id']}/reveal-email"

    buyer_headers = login(client, "buyer@example.com", "correct-horse-battery")
    assert _set_pin(client, buyer_headers).status_code == 200
    assert client.post(url, headers=buyer_headers, json={"pin": PIN}).status_code == 403
    assert client.get(f"{PROFILES}/{profile['id']}/profile", headers=buyer_headers).json()["can_reveal_email"] is False

    holder_headers = login(client, "holder@example.com", "correct-horse-battery")
    assert _set_pin(client, holder_headers).status_code == 200
    assert client.post(url, headers=holder_headers, json={"pin": PIN}).json() == {"email": EMAIL}


def test_the_owner_can_clear_a_members_pin(client, auth, db_session, owner):
    member = _member(db_session, owner, email="admin@example.com", role=WorkspaceRole.ADMIN)
    headers = login(client, "admin@example.com", "correct-horse-battery")
    assert _set_pin(client, headers).status_code == 200
    # Not the admin themself: owner only.
    assert client.post(f"/api/v1/team/members/{member.id}/reveal-pin/clear", headers=headers).status_code == 403
    cleared = client.post(f"/api/v1/team/members/{member.id}/reveal-pin/clear", headers=auth)
    assert cleared.status_code == 200 and cleared.json()["is_set"] is False


# ------------------------------------------------------------------- Business Managers and accounts
def test_an_ad_account_names_the_facebook_accounts_that_reach_it(client, auth, api, db_session):
    bm = _bm(api)
    other_bm = _bm(api, name="BM Khác", external_id="109796697343603")
    fb2 = _profile(api, two_factor_method="app", vault_reference="Bitwarden → Agency/FB2")
    fb3 = _profile(api, label="FB3 – Trần B")
    in_bm = api.post("/api/v1/ad-accounts", json={"display_name": "TK 01", "business_manager_id": bm["id"]}).json()
    elsewhere = api.post("/api/v1/ad-accounts", json={"display_name": "TK 02", "business_manager_id": other_bm["id"]}).json()

    # Nothing recorded yet: an empty list, not a guess.
    assert api.get(f"/api/v1/ad-accounts/{in_bm['id']}").json()["facebook_identities"] == []

    for profile in (fb2, fb3):
        response = api.post(f"{PROFILES}/{profile['id']}/business-links", json={"business_manager_id": bm["id"], "role": "admin"})
        assert response.status_code == 201, response.text
    duplicate = api.post(f"{PROFILES}/{fb2['id']}/business-links", json={"business_manager_id": bm["id"]})
    assert duplicate.status_code == 409

    detail = api.get(f"/api/v1/ad-accounts/{in_bm['id']}").json()["facebook_identities"]
    assert [item["label"] for item in detail] == ["FB2 – Nguyễn A", "FB3 – Trần B"]
    assert detail[0]["via"] == "business_manager" and detail[0]["role"] == "admin"
    assert detail[0]["vault_reference"] == "Bitwarden → Agency/FB2"
    assert api.get(f"/api/v1/ad-accounts/{elsewhere['id']}").json()["facebook_identities"] == []

    listed = {row["id"]: row for row in api.get("/api/v1/ad-accounts").json()["items"]}
    assert [i["label"] for i in listed[in_bm["id"]]["facebook_identities"]] == ["FB2 – Nguyễn A", "FB3 – Trần B"]

    filtered = api.get("/api/v1/ad-accounts", params={"facebook_identity_id": fb2["id"]}).json()["items"]
    assert [row["id"] for row in filtered] == [in_bm["id"]]

    summary = {row["id"]: row for row in api.get("/api/v1/facebook-identities/summary").json()}
    assert summary[fb2["id"]]["business_manager_count"] == 1
    assert summary[fb2["id"]]["ad_account_count"] == 1

    # Unlinking keeps the history row and stops the derivation.
    link = api.get(f"{PROFILES}/{fb3['id']}/profile").json()["business_links"][0]
    assert api.post(f"{PROFILES}/{fb3['id']}/business-links/{link['id']}/unlink").json()["unlinked_at"]
    detail = api.get(f"/api/v1/ad-accounts/{in_bm['id']}").json()["facebook_identities"]
    assert [item["label"] for item in detail] == ["FB2 – Nguyễn A"]

    # An archived profile is no longer named.
    api.post(f"{PROFILES}/{fb2['id']}/archive")
    assert api.get(f"/api/v1/ad-accounts/{in_bm['id']}").json()["facebook_identities"] == []


def test_another_workspace_cannot_see_or_link_a_profile(client, api, other_auth):
    profile = _profile(api)
    assert client.get(f"{PROFILES}/{profile['id']}/profile", headers=other_auth).status_code == 404
    foreign_bm = client.post(
        "/api/v1/business-managers", headers=other_auth, json={"name": "Theirs", "external_id": "555000000000003"}
    ).json()
    response = api.post(f"{PROFILES}/{profile['id']}/business-links", json={"business_manager_id": foreign_bm["id"]})
    assert response.status_code == 404


# ----------------------------------------------------------------------------- the rule-1 surface
def test_only_the_documented_request_bodies_opt_out_of_strict_payload(app):
    """Rule 1: a request body that may carry a secret is a plain `BaseModel`, deliberately. Pin the list."""
    from fastapi.routing import APIRoute
    from pydantic import BaseModel

    from app.schemas.common import StrictPayload

    opted_out = set()
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.body_field is None:
            continue
        model = route.body_field.type_
        if isinstance(model, type) and issubclass(model, BaseModel) and not issubclass(model, StrictPayload):
            opted_out.add(model.__name__)
    assert {"RevealEmailRequest", "RevealPinSetRequest"} <= opted_out
    assert opted_out <= {
        "LoginRequest",
        "InvitationAcceptRequest",
        "RevealEmailRequest",
        "RevealPinSetRequest",
    } | _PRE_F1_OPT_OUTS, opted_out


#: Measured before F1 by this same walk; anything new has to be added on purpose.
_PRE_F1_OPT_OUTS: set[str] = set()


# ------------------------------------------------------------------------- review regressions (F1)
def _buyer_headers(client, db_session, owner, email="buyer@example.com"):
    member = _member(db_session, owner, email=email, role=WorkspaceRole.BUYER)
    return member, login(client, email, "correct-horse-battery")


def test_a_buyer_cannot_make_themself_the_holder_and_read_the_email(client, auth, api, db_session, owner, vault):
    """A buyer passes WriteCtx. Changing `owner_member_id` is what unlocks `reveal-email`, so it is
    an owner/admin decision, and so is storing the email."""
    buyer, buyer_headers = _buyer_headers(client, db_session, owner)
    profile = _profile(api)
    client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    assert _set_pin(client, buyer_headers).status_code == 200
    url = f"{PROFILES}/{profile['id']}"

    grab = client.patch(url, headers=buyer_headers, json={"owner_member_id": str(buyer.id)})
    assert grab.status_code == 403, grab.text
    assert client.post(f"{url}/reveal-email", headers=buyer_headers, json={"pin": PIN}).status_code == 403
    db_session.expire_all()
    assert db_session.get(PersonalAccountReference, uuid.UUID(profile["id"])).owner_member_id is None

    # Creating a profile already owned by oneself is the same move.
    created = client.post(PROFILES, headers=buyer_headers, json={"label": "FB9", "owner_member_id": str(buyer.id)})
    assert created.status_code == 403, created.text
    # Clearing a holder is a holder change too.
    assert client.patch(url, headers=buyer_headers, json={"owner_member_id": None}).status_code == 403

    # Setting or replacing the stored email is owner/admin only.
    assert client.put(f"{url}/email", headers=buyer_headers, json={"email": "x.y@evil.test"}).status_code == 403

    # What a buyer legitimately does is untouched: an ordinary profile edit, without a holder change.
    assert client.patch(url, headers=buyer_headers, json={"label": "FB2 – đổi tên"}).status_code == 200
    assert client.post(PROFILES, headers=buyer_headers, json={"label": "FB10"}).status_code == 201


def test_an_admin_may_assign_the_holder_and_set_the_email(client, auth, api, db_session, owner, vault):
    admin = _member(db_session, owner, email="admin@example.com", role=WorkspaceRole.ADMIN)
    headers = login(client, "admin@example.com", "correct-horse-battery")
    profile = _profile(api)
    url = f"{PROFILES}/{profile['id']}"
    assert client.patch(url, headers=headers, json={"owner_member_id": str(admin.id)}).status_code == 200
    assert client.put(f"{url}/email", headers=headers, json={"email": EMAIL}).status_code == 200


def test_pin_failures_are_serialised_per_user(client, auth, api, db_session, owner, vault):
    """Two concurrent wrong guesses must both be counted. Without a row lock each reads count N and
    writes N+1, so a parallel guesser gets more than five tries per lock window."""
    import threading
    import time

    from app.db.session import SessionLocal
    from app.services.audit import AuditLogService
    from app.services.facebook_identities import PinRejectedError, RevealPinService

    assert _set_pin(client, auth).status_code == 200
    user_id = owner["user"].id
    workspace_id = owner["workspace"].id

    def attempt(session):
        user = session.get(User, user_id)
        service = RevealPinService(session, AuditLogService(session, workspace_id, user_id))
        with pytest.raises(PinRejectedError):
            service.verify(user, "111222")

    first = SessionLocal()
    second = SessionLocal()
    outcome: dict[str, object] = {}
    try:
        attempt(first)  # holds the user row until `first` commits

        def worker():
            try:
                attempt(second)
                second.commit()
                outcome["done"] = True
            except BaseException as exc:  # noqa: BLE001 - surfaced by the assertion below
                outcome["error"] = exc

        thread = threading.Thread(target=worker)
        thread.start()
        time.sleep(0.6)
        assert thread.is_alive(), "the second guess did not wait for the first one"
        first.commit()
        thread.join(timeout=10)
        assert not thread.is_alive() and outcome.get("done") is True, outcome
    finally:
        first.close()
        second.close()

    db_session.expire_all()
    assert db_session.get(User, user_id).reveal_pin_failed_count == 2


def _scoped_buyer(client, db_session, owner, api):
    """A buyer assigned to BM1 only, plus a profile linked to both BM1 and BM2 by the owner."""
    bm1 = _bm(api, name="BM Một", external_id="111000000000001")
    bm2 = _bm(api, name="BM Hai", external_id="222000000000002")
    buyer = _member(db_session, owner, email="scoped@example.com", role=WorkspaceRole.BUYER)
    db_session.add(
        MemberBusinessManagerAssignment(
            workspace_id=owner["workspace"].id,
            member_id=buyer.id,
            business_manager_id=uuid.UUID(bm1["id"]),
            assigned_by=owner["user"].id,
            assigned_at=datetime.now(UTC),
        )
    )
    db_session.commit()
    headers = login(client, "scoped@example.com", "correct-horse-battery")
    profile = _profile(api)
    links = {}
    for key, bm in (("bm1", bm1), ("bm2", bm2)):
        response = api.post(f"{PROFILES}/{profile['id']}/business-links", json={"business_manager_id": bm["id"]})
        assert response.status_code == 201, response.text
        links[key] = response.json()["id"]
    return profile, bm1, bm2, links, headers


def test_a_scoped_member_sees_and_changes_only_their_business_managers(client, api, db_session, owner):
    profile, bm1, bm2, links, headers = _scoped_buyer(client, db_session, owner, api)
    url = f"{PROFILES}/{profile['id']}"

    seen = client.get(f"{url}/profile", headers=headers).json()["business_links"]
    assert [item["business_manager_id"] for item in seen] == [bm1["id"]]
    assert bm2["name"] not in client.get(f"{url}/profile", headers=headers).text

    mine = {row["id"]: row for row in client.get("/api/v1/facebook-identities/summary", headers=headers).json()}
    assert mine[profile["id"]]["business_manager_count"] == 1
    everything = {row["id"]: row for row in api.get("/api/v1/facebook-identities/summary").json()}
    assert everything[profile["id"]]["business_manager_count"] == 2

    # Out of scope: indistinguishable from a Business Manager that does not exist.
    hidden = client.post(f"{url}/business-links", headers=headers, json={"business_manager_id": bm2["id"]})
    assert hidden.status_code == 404
    assert client.post(f"{url}/business-links/{links['bm2']}/unlink", headers=headers).status_code == 404
    still = api.get(f"{url}/profile").json()["business_links"]
    assert {item["business_manager_id"] for item in still} == {bm1["id"], bm2["id"]}

    # Inside the scope both still work.
    assert client.post(f"{url}/business-links/{links['bm1']}/unlink", headers=headers).status_code == 200
    assert client.post(f"{url}/business-links", headers=headers, json={"business_manager_id": bm1["id"]}).status_code == 201


@pytest.mark.parametrize(
    "value",
    [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "vbscript:msgbox(1)",
        "ftp://vault.example.com/x",
        "file:///etc/passwd",
        "mailto:a@b.co",
        "//vault.example.com/x",
        "http://vault.example.com/x",
        "\tjavascript:alert(1)",
        "java\nscript:alert(1)",
    ],
)
def test_a_vault_reference_may_only_be_https_or_plain_text(api, value):
    assert api.post(PROFILES, json={"label": "FB2", "vault_reference": value}).status_code == 422
    profile = _profile(api)
    assert api.patch(f"{PROFILES}/{profile['id']}", json={"vault_reference": value}).status_code == 422


def test_a_vault_reference_that_is_https_or_a_plain_label_is_kept(api):
    for value in ("https://vault.bitwarden.com/#/vault?itemId=abc", "Bitwarden: Agency/FB2", "Bitwarden → Agency/FB2", "1Password / Ads / FB2"):
        assert _profile(api, vault_reference=value)["vault_reference"] == value


def test_the_pin_pattern_does_not_accept_a_trailing_newline_or_non_ascii_digits(client, auth, api, db_session, vault):
    assert _set_pin(client, auth, pin="482913\n").status_code == 422
    assert _set_pin(client, auth, pin="٤٨٢٩١٣").status_code == 422
    assert client.get("/api/v1/me/reveal-pin", headers=auth).json()["is_set"] is False

    assert _set_pin(client, auth).status_code == 200
    profile = _profile(api)
    client.put(f"{PROFILES}/{profile['id']}/email", headers=auth, json={"email": EMAIL})
    url = f"{PROFILES}/{profile['id']}/reveal-email"
    assert client.post(url, headers=auth, json={"pin": PIN + "\n"}).status_code == 403
    assert client.post(url, headers=auth, json={"pin": PIN}).status_code == 200


def test_filtering_ad_accounts_by_an_archived_profile_returns_nothing(api):
    bm = _bm(api)
    fb_bm = _profile(api, label="FB BM")
    fb_direct = _profile(api, label="FB Direct")
    api.post(f"{PROFILES}/{fb_bm['id']}/business-links", json={"business_manager_id": bm["id"]})
    in_bm = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "TK BM", "business_manager_id": bm["id"]},
    ).json()
    direct = api.post(
        "/api/v1/ad-accounts",
        json={
            "display_name": "TK Direct",
            "account_type": "personal_reference",
            "personal_account_reference_id": fb_direct["id"],
        },
    ).json()

    assert [r["id"] for r in api.get("/api/v1/ad-accounts", params={"facebook_identity_id": fb_bm["id"]}).json()["items"]] == [in_bm["id"]]
    assert [r["id"] for r in api.get("/api/v1/ad-accounts", params={"facebook_identity_id": fb_direct["id"]}).json()["items"]] == [direct["id"]]

    assert api.post(f"{PROFILES}/{fb_bm['id']}/archive").status_code == 200
    assert api.post(f"{PROFILES}/{fb_direct['id']}/archive").status_code == 200

    assert api.get("/api/v1/ad-accounts", params={"facebook_identity_id": fb_bm["id"]}).json()["items"] == []
    assert api.get("/api/v1/ad-accounts", params={"facebook_identity_id": fb_direct["id"]}).json()["items"] == []


@pytest.mark.parametrize(
    "field",
    [
        "label",
        "display_name",
        "status",
        "notes",
        "two_factor_method",
        "vault_reference",
        "recovery_note",
    ],
)
def test_updating_a_profile_with_an_explicit_null_on_a_not_null_column_is_422(api, field):
    profile = _profile(api, notes="ghi chú", vault_reference="Bitwarden → Agency/FB2", recovery_note="SIM 01")
    response = api.patch(f"{PROFILES}/{profile['id']}", json={field: None})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


def test_concurrent_business_links_for_the_same_pair_raise_conflict_instead_of_500(api, owner):
    from app.core.errors import ConflictError
    from app.db.session import SessionLocal
    from app.models.entities import BusinessManager
    from app.services.audit import AuditLogService
    from app.services.facebook_identities import FacebookIdentityService

    bm = _bm(api)
    profile = _profile(api)
    workspace_id = owner["workspace"].id
    actor_id = owner["user"].id
    identity_id = uuid.UUID(profile["id"])
    bm_id = uuid.UUID(bm["id"])

    first = SessionLocal()
    second = SessionLocal()
    try:
        svc1 = FacebookIdentityService(first, workspace_id, AuditLogService(first, workspace_id, actor_id), get_settings())
        svc2 = FacebookIdentityService(second, workspace_id, AuditLogService(second, workspace_id, actor_id), get_settings())

        id1 = svc1.get(identity_id)
        id2 = svc2.get(identity_id)

        svc1.link_business(id1, business_manager_id=bm_id, role=IdentityBusinessRole.ADMIN, note="", actor_id=actor_id)
        first.commit()

        real_execute = second.execute
        calls = 0

        def race_execute(statement, *args, **kwargs):
            nonlocal calls
            calls += 1
            # In link_business: call 1 is get_or_404(BusinessManager), call 2 is the existing-link pre-check.
            if calls == 2:
                class _Empty:
                    def scalar_one_or_none(self_inner):
                        return None
                return _Empty()
            return real_execute(statement, *args, **kwargs)

        second.execute = race_execute  # type: ignore[method-assign]
        with pytest.raises(ConflictError):
            svc2.link_business(id2, business_manager_id=bm_id, role=IdentityBusinessRole.ADMIN, note="", actor_id=actor_id)
        second.execute = real_execute  # type: ignore[method-assign]

        # And the savepoint kept `second` usable after the IntegrityError.
        assert second.get(BusinessManager, bm_id) is not None
    finally:
        first.close()
        second.close()

