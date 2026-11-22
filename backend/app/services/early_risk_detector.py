"""Early Risk Detector (≥80% Billing Threshold & Spend Spike) + Operational 7d Telemetry (v4.2.0).

Pure database-backed calculations over existing stored `AdAccount`, `AdAccountSpendObservation`,
`AuditLog`, `PersonalAccountReference`, and `Alert` records — zero fabricated numbers and zero
external network calls. Does NOT modify A2 `health_rules.py` registry keys.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    AssetType,
    ReferenceStatus,
    SpendObservationStatus,
)
from app.models.alerts import Alert
from app.models.entities import (
    AccountAssetLink,
    AdAccount,
    AuditLog,
    PaymentProfileReference,
    PersonalAccountReference,
)
from app.models.spend import AdAccountSpendObservation
from app.services import spend_service
from app.services.spend_engine import amount_text, parse_amount

EARLY_RISK_SOURCE_ENTITY_TYPE = "early_risk_guard"


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _is_google_account(account: AdAccount) -> bool:
    ext = (account.external_account_id or "").strip().lower()
    if ext.startswith("gads_"):
        return True
    tags = [str(t).lower() for t in (account.tags or [])]
    return "platform:google_ads" in tags or any(t.startswith("gads_") for t in tags)


def _normalize_proxy_label(raw: str | None) -> str:
    clean = (raw or "").strip()
    if not clean:
        return "Direct IP (Mạng gốc)"
    low = clean.lower()
    if low in ("direct", "direct ip", "none", "local", "mạng gốc"):
        return "Direct IP (Mạng gốc)"
    # Normalize scheme://user:pass@host:port or host:port -> host:port (strip credentials)
    stripped = clean.split("://", 1)[1] if "://" in clean else clean
    stripped = stripped.rsplit("@", 1)[-1].split("/", 1)[0].strip()
    return stripped or clean


def _noise_floor_for_currency(currency: str | None) -> Decimal:
    curr = (currency or "VND").strip().upper()
    return Decimal("50000") if curr == "VND" else Decimal("5")


def _extract_sorted_daily_spend(obs: AdAccountSpendObservation | None) -> list[tuple[date, Decimal]]:
    if obs is None or not isinstance(obs.daily_json, list):
        return []
    by_day: dict[date, Decimal] = {}
    for row in obs.daily_json:
        if not isinstance(row, dict):
            continue
        raw_day = str(row.get("date_start") or "").strip()[:10]
        amt = parse_amount(row.get("spend"))
        if not raw_day or amt is None:
            continue
        try:
            parsed_d = date.fromisoformat(raw_day)
        except ValueError:
            continue
        by_day[parsed_d] = amt
    return sorted(by_day.items(), key=lambda pair: pair[0])


def _load_payment_labels(session: Session, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    if not account_ids:
        return {}
    out: dict[uuid.UUID, list[str]] = {}
    rows = session.execute(
        sa.select(
            AccountAssetLink.ad_account_id,
            AccountAssetLink.asset_type,
            PaymentProfileReference.reference_code,
            PaymentProfileReference.label,
        )
        .outerjoin(
            PaymentProfileReference,
            sa.and_(
                AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                PaymentProfileReference.id == AccountAssetLink.asset_id,
                PaymentProfileReference.archived_at.is_(None),
            ),
        )
        .where(
            AccountAssetLink.ad_account_id.in_(account_ids),
            AccountAssetLink.unlinked_at.is_(None),
        )
    ).all()
    for acc_id, asset_type, pay_code, pay_label in rows:
        if asset_type == AssetType.PAYMENT_PROFILE and pay_code:
            text = f"{pay_code} ({pay_label})" if pay_label and pay_label != pay_code else pay_code
            bucket = out.setdefault(acc_id, [])
            if text not in bucket:
                bucket.append(text)
    return out


def _latest_succeeded_observations(
    session: Session, workspace_id: uuid.UUID, account_ids: list[uuid.UUID]
) -> dict[uuid.UUID, AdAccountSpendObservation]:
    if not account_ids:
        return {}
    rows = (
        session.execute(
            sa.select(AdAccountSpendObservation)
            .where(
                AdAccountSpendObservation.workspace_id == workspace_id,
                AdAccountSpendObservation.ad_account_id.in_(account_ids),
                AdAccountSpendObservation.status == SpendObservationStatus.SUCCEEDED,
                AdAccountSpendObservation.archived_at.is_(None),
            )
            .order_by(AdAccountSpendObservation.observed_at.desc(), AdAccountSpendObservation.id.desc())
        )
        .scalars()
        .all()
    )
    out: dict[uuid.UUID, AdAccountSpendObservation] = {}
    for row in rows:
        if row.ad_account_id not in out:
            out[row.ad_account_id] = row
    return out


def _reconcile_early_risk_alerts(
    session: Session,
    workspace_id: uuid.UUID,
    risks: list[dict[str, Any]],
    now: datetime,
) -> tuple[int, int]:
    """Upsert active early-risk Alerts and auto-resolve ones that cleared."""
    with session.begin_nested():
        existing_rows = (
            session.execute(
                sa.select(Alert).where(
                    Alert.workspace_id == workspace_id,
                    Alert.source_entity_type == EARLY_RISK_SOURCE_ENTITY_TYPE,
                    Alert.archived_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        existing_by_key: dict[str, Alert] = {}
        for al in existing_rows:
            if al.active_key:
                existing_by_key[al.active_key] = al

        desired_keys: set[str] = set()
        opened_or_updated = 0
        resolved = 0

        for item in risks:
            active_key = f"early_risk:{item['ad_account_id']}:{item['kind']}"
            desired_keys.add(active_key)
            sev = AlertSeverity.CRITICAL if item["severity"] == "critical" else AlertSeverity.WARNING
            category = "billing_threshold" if item["kind"] in ("billing_threshold_80", "spend_cap_85") else "spend_spike"
            snap = {
                "kind": item["kind"],
                "platform": item["platform"],
                "ratio_pct": item["ratio_pct"],
                "current_raw": item["current_raw"],
                "reference_raw": item["reference_raw"],
                "currency": item["currency"],
                "payment_card": item.get("payment_card"),
                "latest_day": item.get("latest_day"),
            }
            existing = existing_by_key.get(active_key)
            if existing is not None:
                existing.severity = sev
                existing.title = item["title"][:200]
                existing.summary = item["summary"]
                existing.last_observed_at = now
                existing.source_snapshot_json = snap
                opened_or_updated += 1
            else:
                new_alert = Alert(
                    workspace_id=workspace_id,
                    ad_account_id=uuid.UUID(item["ad_account_id"]),
                    source_type=AlertSourceType.HEALTH_SIGNAL,
                    source_entity_type=EARLY_RISK_SOURCE_ENTITY_TYPE,
                    source_entity_id=item["ad_account_id"],
                    alert_key=active_key,
                    active_key=active_key,
                    category=category,
                    severity=sev,
                    status=AlertStatus.OPEN,
                    title=item["title"][:200],
                    summary=item["summary"],
                    source_snapshot_json=snap,
                    first_observed_at=now,
                    last_observed_at=now,
                )
                session.add(new_alert)
                opened_or_updated += 1

        for active_key, al in existing_by_key.items():
            if active_key not in desired_keys and al.status in ACTIVE_ALERT_STATUSES:
                al.status = AlertStatus.RESOLVED
                al.active_key = None
                al.resolved_at = now
                al.resolution_reason = "Mức dư nợ thẻ hoặc chi tiêu ngày đã trở về ngưỡng bình thường."
                resolved += 1

        session.flush()
        return opened_or_updated, resolved


def evaluate_and_reconcile_early_risks(
    session: Session,
    workspace_id: uuid.UUID,
    *,
    reconcile_alerts: bool = True,
    threshold_warn_pct: float = 80.0,
    spend_cap_warn_pct: float = 85.0,
    spike_multiplier: float = 1.8,
) -> dict[str, Any]:
    """Detect >=80% card threshold proximity, spend-cap proximity, and daily spend spikes (Meta & Google Ads)."""
    from app.api.v1.routers.ad_accounts import _build_billing_meta_map

    now = datetime.now(UTC)
    accounts = list(
        session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    if not accounts:
        return {
            "items": [],
            "threshold_warnings_count": 0,
            "spend_spike_count": 0,
            "reconciled": {"upserted": 0, "resolved": 0},
        }

    account_ids = [a.id for a in accounts]
    reads = spend_service.list_compact_reads(session, workspace_id, accounts)
    payment_labels = _load_payment_labels(session, account_ids)
    billing_map = _build_billing_meta_map(session, workspace_id, accounts, reads, payment_labels)
    latest_obs_map = _latest_succeeded_observations(session, workspace_id, account_ids)

    risks: list[dict[str, Any]] = []

    for acc in accounts:
        bm = billing_map.get(acc.id, {})
        obs = latest_obs_map.get(acc.id)
        platform = "google_ads" if _is_google_account(acc) else "meta"
        currency = str(
            (obs.observed_currency if obs else None)
            or acc.currency
            or "VND"
        ).upper()
        card_display = str(bm.get("payment_card_display") or "").strip() or None
        noise_floor = _noise_floor_for_currency(currency)

        # 1. Billing Threshold Proximity (>= 80%)
        bal = parse_amount(bm.get("balance_raw") or (obs.balance_raw if obs else None))
        thresh = parse_amount(bm.get("billing_threshold_raw"))
        if thresh is not None and thresh > 0 and bal is not None and bal > 0:
            pct = round(float((bal / thresh) * Decimal("100")), 1)
            if pct >= threshold_warn_pct:
                sev = "critical" if pct >= 95.0 else "warning"
                bal_txt = amount_text(bal)
                thresh_txt = amount_text(thresh)
                risks.append(
                    {
                        "ad_account_id": str(acc.id),
                        "display_name": acc.display_name,
                        "external_account_id": acc.external_account_id,
                        "platform": platform,
                        "kind": "billing_threshold_80",
                        "severity": sev,
                        "ratio_pct": pct,
                        "current_raw": bal_txt,
                        "reference_raw": thresh_txt,
                        "currency": currency,
                        "payment_card": card_display,
                        "latest_day": None,
                        "title": f"[{acc.display_name}] Dư nợ đạt {pct:.0f}% ngưỡng thẻ ({bal_txt}/{thresh_txt} {currency})",
                        "summary": (
                            f"Dư nợ hiện tại {bal_txt} {currency} đã đạt {pct:.1f}% ngưỡng thanh toán "
                            f"{thresh_txt} {currency}"
                            + (f" trên {card_display}" if card_display else "")
                            + ". Hãy kiểm tra số dư thẻ để tránh Billing Hold."
                        ),
                    }
                )

        # 2. Lifetime Spend Cap Proximity (>= 85%) — Meta accounts only (Google Ads stores daily budget here)
        if platform != "google_ads" and (obs is None or obs.reader_source != "google_ads_script"):
            spent = parse_amount(obs.amount_spent_raw if obs else None)
            cap = parse_amount(obs.spend_cap_raw if obs else None)
            if cap is not None and cap > 0 and spent is not None and spent > 0:
                cap_pct = round(float((spent / cap) * Decimal("100")), 1)
                if cap_pct >= spend_cap_warn_pct:
                    sev = "critical" if cap_pct >= 97.0 else "warning"
                    spent_txt = amount_text(spent)
                    cap_txt = amount_text(cap)
                    risks.append(
                        {
                            "ad_account_id": str(acc.id),
                            "display_name": acc.display_name,
                            "external_account_id": acc.external_account_id,
                            "platform": platform,
                            "kind": "spend_cap_85",
                            "severity": sev,
                            "ratio_pct": cap_pct,
                            "current_raw": spent_txt,
                            "reference_raw": cap_txt,
                            "currency": currency,
                            "payment_card": card_display,
                            "latest_day": None,
                            "title": f"[{acc.display_name}] Đạt {cap_pct:.0f}% giới hạn chi tiêu (Spend Cap)",
                            "summary": f"Tổng chi tiêu {spent_txt} / {cap_txt} {currency} ({cap_pct:.1f}% Spend Cap).",
                        }
                    )

        # 3. Daily Spend Spike Detection (vs Daily Limit >= 125% OR vs 3-7d avg >= 1.8x)
        daily_series = _extract_sorted_daily_spend(obs)
        if daily_series:
            latest_d, latest_spend = daily_series[-1]
            latest_day_iso = latest_d.isoformat()
            latest_txt = amount_text(latest_spend)
            daily_limit = parse_amount(bm.get("meta_daily_limit_raw") or acc.planned_daily_budget_raw)

            triggered_spike = False
            if (
                daily_limit is not None
                and daily_limit > 0
                and latest_spend >= daily_limit * Decimal("1.25")
                and (latest_spend - daily_limit) >= noise_floor
            ):
                ratio_pct = round(float((latest_spend / daily_limit) * Decimal("100")), 1)
                sev = "critical" if ratio_pct >= 180.0 else "warning"
                ref_txt = amount_text(daily_limit)
                risks.append(
                    {
                        "ad_account_id": str(acc.id),
                        "display_name": acc.display_name,
                        "external_account_id": acc.external_account_id,
                        "platform": platform,
                        "kind": "daily_spend_spike",
                        "severity": sev,
                        "ratio_pct": ratio_pct,
                        "current_raw": latest_txt,
                        "reference_raw": ref_txt,
                        "currency": currency,
                        "payment_card": card_display,
                        "latest_day": latest_day_iso,
                        "title": f"[{acc.display_name}] Vượt {ratio_pct:.0f}% ngân sách ngày ({latest_day_iso})",
                        "summary": (
                            f"Chi tiêu ngày {latest_day_iso} đạt {latest_txt} {currency}, "
                            f"vượt mức ngân sách/giới hạn ngày {ref_txt} {currency} ({ratio_pct:.0f}%)."
                        ),
                    }
                )
                triggered_spike = True

            if not triggered_spike:
                prior_active = [amt for _, amt in daily_series[:-1] if amt > 0][-7:]
                if len(prior_active) >= 3:
                    avg_prior = sum(prior_active) / Decimal(len(prior_active))
                    if (
                        avg_prior > 0
                        and latest_spend >= avg_prior * Decimal(str(spike_multiplier))
                        and (latest_spend - avg_prior) >= noise_floor
                    ):
                        ratio_pct = round(float((latest_spend / avg_prior) * Decimal("100")), 1)
                        mult = round(float(latest_spend / avg_prior), 2)
                        sev = "critical" if mult >= 2.5 else "warning"
                        avg_txt = amount_text(avg_prior.quantize(Decimal("1")))
                        risks.append(
                            {
                                "ad_account_id": str(acc.id),
                                "display_name": acc.display_name,
                                "external_account_id": acc.external_account_id,
                                "platform": platform,
                                "kind": "daily_spend_spike",
                                "severity": sev,
                                "ratio_pct": ratio_pct,
                                "current_raw": latest_txt,
                                "reference_raw": avg_txt,
                                "currency": currency,
                                "payment_card": card_display,
                                "latest_day": latest_day_iso,
                                "title": f"[{acc.display_name}] Chi tiêu vọt {mult:.1f}x so với TB {len(prior_active)} ngày",
                                "summary": (
                                    f"Chi tiêu ngày {latest_day_iso} đạt {latest_txt} {currency} — "
                                    f"gấp {mult:.1f}x trung bình {len(prior_active)} ngày gần nhất ({avg_txt} {currency})."
                                ),
                            }
                        )

    risks.sort(
        key=lambda r: (
            0 if r["severity"] == "critical" else 1,
            -float(r.get("ratio_pct") or 0.0),
        )
    )

    reconciled_stats = {"upserted": 0, "resolved": 0}
    if reconcile_alerts:
        upserted, resolved = _reconcile_early_risk_alerts(session, workspace_id, risks, now)
        reconciled_stats = {"upserted": upserted, "resolved": resolved}

    thresh_cnt = sum(1 for r in risks if r["kind"] in ("billing_threshold_80", "spend_cap_85"))
    spike_cnt = sum(1 for r in risks if r["kind"] == "daily_spend_spike")
    return {
        "items": risks,
        "threshold_warnings_count": thresh_cnt,
        "spend_spike_count": spike_cnt,
        "reconciled": reconciled_stats,
    }


def build_workspace_operational_telemetry(
    session: Session,
    workspace_id: uuid.UUID,
) -> dict[str, Any]:
    """Compile real 7-day automation reliability, proxy cluster health ranking, and early financial risks."""
    now = datetime.now(UTC)
    since_7d = now - timedelta(days=7)

    audit_rows = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.created_at >= since_7d,
                AuditLog.action.in_(
                    (
                        "page.warmup_posted",
                        "page.via_created",
                        "page.via_keepalive",
                        "page.via_alert",
                        "via.engine_failover",
                        "workspace_automation_cron.executed",
                    )
                ),
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(1000)
        )
        .scalars()
        .all()
    )

    warmup_posts_7d = 0
    pages_created_7d = 0
    keepalive_ok_7d = 0
    via_alerts_7d = 0
    failover_events_7d = 0
    cron_runs_7d = 0
    incidents_by_via_id: dict[str, int] = {}
    incidents_by_via_label: dict[str, int] = {}

    for row in audit_rows:
        meta = row.metadata_json if isinstance(row.metadata_json, dict) else {}
        if row.action == "page.warmup_posted":
            warmup_posts_7d += 1
        elif row.action == "page.via_created":
            pages_created_7d += 1
        elif row.action == "page.via_keepalive":
            keepalive_ok_7d += 1
        elif row.action == "via.engine_failover":
            failover_events_7d += 1
        elif row.action == "workspace_automation_cron.executed":
            cron_runs_7d += 1
        elif row.action == "page.via_alert":
            via_alerts_7d += 1
            vid = str(meta.get("via_id") or "").strip().lower()
            vlabel = str(meta.get("via_label") or "").strip().lower()
            if vid:
                incidents_by_via_id[vid] = incidents_by_via_id.get(vid, 0) + 1
            if vlabel:
                incidents_by_via_label[vlabel] = incidents_by_via_label.get(vlabel, 0) + 1

    ok_ops_7d = warmup_posts_7d + pages_created_7d + keepalive_ok_7d
    total_ops_7d = ok_ops_7d + via_alerts_7d
    success_rate_pct = round((ok_ops_7d / total_ops_7d) * 100.0, 1) if total_ops_7d > 0 else None

    vias = list(
        session.execute(
            sa.select(PersonalAccountReference).where(
                PersonalAccountReference.workspace_id == workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )

    clusters_map: dict[str, dict[str, Any]] = {}
    for via in vias:
        proxy_key = _normalize_proxy_label(getattr(via, "network_label", None))
        is_direct = proxy_key.startswith("Direct IP")
        bucket = clusters_map.setdefault(
            proxy_key,
            {
                "proxy_key": proxy_key,
                "is_direct_ip": is_direct,
                "via_count": 0,
                "active_via_count": 0,
                "restricted_via_count": 0,
                "incident_count_7d": 0,
                "via_labels": [],
            },
        )
        bucket["via_count"] += 1
        if via.status == ReferenceStatus.ACTIVE:
            bucket["active_via_count"] += 1
        elif via.status in (ReferenceStatus.RESTRICTED, ReferenceStatus.DISABLED):
            bucket["restricted_via_count"] += 1
        v_id_low = str(via.id).lower()
        v_lbl_low = str(via.label or "").strip().lower()
        inc = incidents_by_via_id.get(v_id_low, 0) or incidents_by_via_label.get(v_lbl_low, 0)
        bucket["incident_count_7d"] += inc
        if len(bucket["via_labels"]) < 6:
            bucket["via_labels"].append(via.label)

    proxy_clusters: list[dict[str, Any]] = []
    for bucket in clusters_map.values():
        inc_cnt = bucket["incident_count_7d"]
        rest_cnt = bucket["restricted_via_count"]
        v_cnt = bucket["via_count"]
        is_direct = bucket["is_direct_ip"]
        if rest_cnt > 0 or inc_cnt > 0:
            status = "incident"
        elif (is_direct and v_cnt > 3) or (not is_direct and v_cnt > 4):
            status = "crowded"
        else:
            status = "healthy"
        proxy_clusters.append({**bucket, "status": status})

    status_rank = {"incident": 0, "crowded": 1, "healthy": 2}
    proxy_clusters.sort(key=lambda c: (status_rank.get(c["status"], 9), -c["incident_count_7d"], -c["via_count"]))

    early_risks_data = evaluate_and_reconcile_early_risks(
        session,
        workspace_id,
        reconcile_alerts=False,
    )

    return {
        "generated_at": now.isoformat(),
        "window_days": 7,
        "automation_health": {
            "total_ops_7d": total_ops_7d,
            "ok_ops_7d": ok_ops_7d,
            "fail_ops_7d": via_alerts_7d,
            "success_rate_pct": success_rate_pct,
            "warmup_posts_7d": warmup_posts_7d,
            "pages_created_7d": pages_created_7d,
            "keepalive_ok_7d": keepalive_ok_7d,
            "via_alerts_7d": via_alerts_7d,
            "failover_events_7d": failover_events_7d,
            "cron_runs_7d": cron_runs_7d,
        },
        "proxy_clusters": proxy_clusters,
        "proxy_summary": {
            "total_clusters": len(proxy_clusters),
            "healthy_clusters": sum(1 for c in proxy_clusters if c["status"] == "healthy"),
            "crowded_clusters": sum(1 for c in proxy_clusters if c["status"] == "crowded"),
            "incident_clusters": sum(1 for c in proxy_clusters if c["status"] == "incident"),
        },
        "early_risks": early_risks_data["items"],
        "early_risk_summary": {
            "total": len(early_risks_data["items"]),
            "threshold_warnings": early_risks_data["threshold_warnings_count"],
            "spend_spikes": early_risks_data["spend_spike_count"],
        },
    }
