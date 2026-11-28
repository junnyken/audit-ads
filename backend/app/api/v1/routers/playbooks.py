"""Team Automation Playbook Marketplace, Versioning, Ratings & Profile Launch Audit (v2.6.0)."""
from __future__ import annotations

import re
import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query
from pydantic import Field

from app.api.deps import Ctx, WriteCtx
from app.core.errors import NotFoundError, ValidationError
from app.models.entities import AuditLog, AutomationPlaybook, AutomationPlaybookRating, User
from app.schemas.common import StrictPayload

router = APIRouter(prefix="/playbooks", tags=["playbooks"])

_PLATFORMS = {"meta", "google_ads", "tiktok", "multi"}

_BUILTIN_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "meta-warmup-72h-organic",
        "title": "Meta 72h Vàng — Đảo Ấm Newsfeed & Watch (Chống Checkpoint)",
        "platform": "meta",
        "category": "warmup",
        "version_tag": "1.2.0",
        "changelog": "Tách riêng pha ngâm 72h, cấm vào Ads Manager và thêm nghỉ Jitter lệch pha.",
        "description": "Quy trình an toàn tuyệt đối cho Via mới/đổi Proxy: lướt Newsfeed, xem Facebook Watch và kiểm tra Thông báo ngẫu nhiên. Tuyệt đối KHÔNG mở Trình quản lý Quảng cáo.",
        "default_stagger_sec": 60,
        "jitter_pct": 40,
        "steps": [
            {"action": "open_url", "target": "https://www.facebook.com/", "wait_sec": 8, "note": "Vào trang chủ, chờ tải tự nhiên"},
            {"action": "scroll_feed", "target": "newsfeed", "wait_sec": 18, "note": "Cuộn Newsfeed ngẫu nhiên + đọc thông báo"},
            {"action": "open_url", "target": "https://www.facebook.com/watch", "wait_sec": 15, "note": "Xem video Watch ngắn giúp tăng Trust phiên"},
        ],
    },
    {
        "slug": "meta-ads-preflight-clean",
        "title": "Meta Preflight — Kiểm tra Account Quality, Xóa Bài Rejected & Billing",
        "platform": "meta",
        "category": "preflight",
        "version_tag": "1.1.0",
        "changelog": "Gộp kiểm tra Chất lượng Tài khoản + rà soát bài từ chối + ngưỡng thẻ.",
        "description": "Mở trước khi lên chiến dịch cho khách để xử lý bài viết bị từ chối và kiểm tra ngưỡng thanh toán thẻ.",
        "default_stagger_sec": 55,
        "jitter_pct": 35,
        "steps": [
            {"action": "open_url", "target": "https://www.facebook.com/accountquality/", "wait_sec": 10, "note": "Kiểm tra Chất lượng Tài khoản & Hạn chế"},
            {"action": "open_url", "target": "https://business.facebook.com/accountquality", "wait_sec": 14, "note": "Rà bài Rejected / Đỏ thẻ"},
            {"action": "open_url", "target": "https://business.facebook.com/billing_hub/accounts", "wait_sec": 10, "note": "Kiểm tra số dư và ngưỡng thanh toán"},
        ],
    },
    {
        "slug": "meta-bm-security-check",
        "title": "Meta BM Hold — Rà Quản trị viên, Email BM & Nhật ký Bảo mật",
        "platform": "meta",
        "category": "bm_security",
        "version_tag": "1.0.0",
        "changelog": "Bản phát hành đầu cho Via Hold BM (Lớp 1).",
        "description": "Dành riêng cho Via Tổng cầm BM: chỉ kiểm tra nhân sự, đối tác và bảo mật BM, không thao tác tạo camp.",
        "default_stagger_sec": 65,
        "jitter_pct": 35,
        "steps": [
            {"action": "open_url", "target": "https://business.facebook.com/settings/people", "wait_sec": 12, "note": "Rà danh sách Nhân sự / Admin BM"},
            {"action": "open_url", "target": "https://business.facebook.com/settings/security", "wait_sec": 10, "note": "Kiểm tra Xác thực 2 lớp & Yêu cầu xác minh BM"},
        ],
    },
    {
        "slug": "google-ads-trust-warmup",
        "title": "Google Ads — Đảo Ấm Overview, Chính sách & Billing Trust",
        "platform": "google_ads",
        "category": "warmup",
        "version_tag": "1.0.0",
        "changelog": "Bổ sung kịch bản Google Ads học theo Dolphin{anty}.",
        "description": "Giữ phiên Gmail/Google Ads sống ổn định, mở trang Tổng quan chiến dịch và Kiểm tra trạng thái Thanh toán.",
        "default_stagger_sec": 55,
        "jitter_pct": 35,
        "steps": [
            {"action": "open_url", "target": "https://ads.google.com/aw/overview", "wait_sec": 14, "note": "Tải Tổng quan Google Ads"},
            {"action": "open_url", "target": "https://ads.google.com/aw/billing/summary", "wait_sec": 10, "note": "Kiểm tra Billing Summary tự nhiên"},
        ],
    },
    {
        "slug": "tiktok-ads-bc-warmup",
        "title": "TikTok Ads — Đảo Ấm Business Center & Kiểm tra Tài khoản",
        "platform": "tiktok",
        "category": "warmup",
        "version_tag": "1.0.0",
        "changelog": "Bổ sung kịch bản TikTok Ads học theo Dolphin{anty}.",
        "description": "Giữ cookie Business Center TikTok Ads và kiểm tra trạng thái duyệt tài khoản quảng cáo.",
        "default_stagger_sec": 55,
        "jitter_pct": 35,
        "steps": [
            {"action": "open_url", "target": "https://business.tiktok.com/", "wait_sec": 12, "note": "Mở TikTok Business Center"},
            {"action": "open_url", "target": "https://ads.tiktok.com/i18n/home", "wait_sec": 12, "note": "Kiểm tra Ads Manager & Số dư"},
        ],
    },
    {
        "slug": "multi-session-cookie-refresh",
        "title": "Multi-Platform — Kiểm tra & Làm mới Cookie Định kỳ",
        "platform": "multi",
        "category": "maintenance",
        "version_tag": "1.0.0",
        "changelog": "Mẫu bảo trì cookie đa nền tảng chạy lệch pha.",
        "description": "Kiểm tra nhanh trạng thái đăng nhập và làm mới Cookie trước khi bàn giao hoặc đổi ca nhân sự.",
        "default_stagger_sec": 50,
        "jitter_pct": 30,
        "steps": [
            {"action": "open_url", "target": "https://www.facebook.com/", "wait_sec": 10, "note": "Xác minh phiên không bị Checkpoint / văng Cookie"},
            {"action": "open_url", "target": "https://www.facebook.com/notifications", "wait_sec": 8, "note": "Đọc thông báo để giữ tương tác tự nhiên"},
        ],
    },
]


class PlaybookStepInput(StrictPayload):
    action: str = Field(default="open_url", min_length=1, max_length=60)
    target: str = Field(default="", max_length=500)
    wait_sec: int = Field(default=10, ge=1, le=300)
    note: str = Field(default="", max_length=240)


class PlaybookCreateInput(StrictPayload):
    title: str = Field(min_length=3, max_length=200)
    platform: str = Field(default="meta", max_length=32)
    category: str = Field(default="warmup", max_length=64)
    description: str = Field(default="", max_length=1500)
    version_tag: str = Field(default="1.0.0", max_length=32)
    changelog: str = Field(default="", max_length=600)
    default_stagger_sec: int = Field(default=55, ge=25, le=600)
    jitter_pct: int = Field(default=35, ge=10, le=60)
    steps: list[PlaybookStepInput] = Field(default_factory=list, max_length=20)


class PlaybookPatchInput(StrictPayload):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=1500)
    version_tag: str | None = Field(default=None, max_length=32)
    changelog: str | None = Field(default=None, max_length=600)
    default_stagger_sec: int | None = Field(default=None, ge=25, le=600)
    jitter_pct: int | None = Field(default=None, ge=10, le=60)
    steps: list[PlaybookStepInput] | None = Field(default=None, max_length=20)


class PlaybookRateInput(StrictPayload):
    stars: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=400)


class PlaybookRecordRunInput(StrictPayload):
    via_ids: list[str] = Field(default_factory=list, max_length=200)
    engine: str = Field(default="chrome_native", max_length=40)
    stagger_sec: int = Field(default=55, ge=1, le=600)
    jitter_pct: int = Field(default=35, ge=0, le=60)
    workstation: str = Field(default="", max_length=120)


def _slugify(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower().strip()).strip("-")
    if not base:
        base = "playbook"
    return f"{base[:56]}-{uuid.uuid4().hex[:6]}"


def _normalize_platform(raw: str | None) -> str:
    p = (raw or "meta").strip().lower()
    return p if p in _PLATFORMS else "meta"


def ensure_builtin_playbooks(session, workspace_id: uuid.UUID) -> None:
    existing_slugs = set(
        session.execute(
            sa.select(AutomationPlaybook.slug).where(AutomationPlaybook.workspace_id == workspace_id)
        )
        .scalars()
        .all()
    )
    added = False
    for tpl in _BUILTIN_TEMPLATES:
        if tpl["slug"] in existing_slugs:
            continue
        session.add(
            AutomationPlaybook(
                workspace_id=workspace_id,
                slug=tpl["slug"],
                title=tpl["title"],
                platform=tpl["platform"],
                category=tpl["category"],
                description=tpl["description"],
                version_tag=tpl["version_tag"],
                changelog=tpl["changelog"],
                steps_json=list(tpl["steps"]),
                default_stagger_sec=int(tpl["default_stagger_sec"]),
                jitter_pct=int(tpl["jitter_pct"]),
                is_builtin=True,
                author_user_id=None,
                rating_sum=0,
                rating_count=0,
                run_count=0,
            )
        )
        added = True
    if added:
        session.flush()


def _serialize_playbook(
    row: AutomationPlaybook,
    *,
    author_name: str | None = None,
    my_rating: int | None = None,
) -> dict[str, Any]:
    avg_rating = round(row.rating_sum / row.rating_count, 2) if row.rating_count > 0 else None
    return {
        "id": str(row.id),
        "slug": row.slug,
        "title": row.title,
        "platform": row.platform,
        "category": row.category,
        "description": row.description,
        "version_tag": row.version_tag,
        "changelog": row.changelog,
        "steps": row.steps_json if isinstance(row.steps_json, list) else [],
        "default_stagger_sec": row.default_stagger_sec,
        "jitter_pct": row.jitter_pct,
        "is_builtin": bool(row.is_builtin),
        "author_name": author_name or ("AdsOps Pro Built-in" if row.is_builtin else "Thành viên Team"),
        "avg_rating": avg_rating,
        "rating_count": row.rating_count,
        "run_count": row.run_count,
        "my_rating": my_rating,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
def list_playbooks(
    ctx: Ctx,
    platform: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    ensure_builtin_playbooks(ctx.session, ctx.workspace_id)
    ctx.commit()

    stmt = sa.select(AutomationPlaybook).where(
        AutomationPlaybook.workspace_id == ctx.workspace_id,
        AutomationPlaybook.archived_at.is_(None),
    )
    if platform and platform.strip().lower() in _PLATFORMS:
        stmt = stmt.where(AutomationPlaybook.platform == platform.strip().lower())
    stmt = stmt.order_by(AutomationPlaybook.is_builtin.desc(), AutomationPlaybook.updated_at.desc())
    rows = list(ctx.session.execute(stmt).scalars().all())

    author_ids = {r.author_user_id for r in rows if r.author_user_id is not None}
    authors: dict[uuid.UUID, str] = {}
    if author_ids:
        for uid, fn, em in ctx.session.execute(
            sa.select(User.id, User.full_name, User.email).where(User.id.in_(author_ids))
        ).all():
            authors[uid] = fn or em

    my_ratings: dict[uuid.UUID, int] = {}
    pb_ids = [r.id for r in rows]
    if pb_ids:
        for pb_id, stars in ctx.session.execute(
            sa.select(AutomationPlaybookRating.playbook_id, AutomationPlaybookRating.stars).where(
                AutomationPlaybookRating.playbook_id.in_(pb_ids),
                AutomationPlaybookRating.user_id == ctx.user.id,
            )
        ).all():
            my_ratings[pb_id] = stars

    return [
        _serialize_playbook(
            r,
            author_name=authors.get(r.author_user_id) if r.author_user_id else None,
            my_rating=my_ratings.get(r.id),
        )
        for r in rows
    ]


@router.post("", status_code=201)
def create_playbook(ctx: WriteCtx, payload: PlaybookCreateInput) -> dict[str, Any]:
    steps = [s.model_dump() for s in payload.steps]
    if not steps:
        raise ValidationError("Kịch bản cần có ít nhất 1 bước hành động.")
    row = AutomationPlaybook(
        workspace_id=ctx.workspace_id,
        slug=_slugify(payload.title),
        title=payload.title.strip(),
        platform=_normalize_platform(payload.platform),
        category=(payload.category or "custom").strip()[:64] or "custom",
        description=payload.description.strip(),
        version_tag=(payload.version_tag or "1.0.0").strip()[:32] or "1.0.0",
        changelog=(payload.changelog or "Tạo bởi thành viên team").strip(),
        steps_json=steps,
        default_stagger_sec=payload.default_stagger_sec,
        jitter_pct=payload.jitter_pct,
        is_builtin=False,
        author_user_id=ctx.user.id,
        rating_sum=0,
        rating_count=0,
        run_count=0,
    )
    ctx.session.add(row)
    ctx.session.flush()
    ctx.audit.record(
        action="playbook.created",
        entity_type="automation_playbook",
        entity_id=row.id,
        metadata={"title": row.title, "platform": row.platform, "version_tag": row.version_tag},
    )
    ctx.commit()
    return _serialize_playbook(row, author_name=ctx.user.full_name or ctx.user.email, my_rating=None)


@router.patch("/{playbook_id}")
def update_playbook(ctx: WriteCtx, playbook_id: uuid.UUID, payload: PlaybookPatchInput) -> dict[str, Any]:
    row = ctx.session.get(AutomationPlaybook, playbook_id)
    if row is None or row.workspace_id != ctx.workspace_id or row.archived_at is not None:
        raise NotFoundError("Không tìm thấy kịch bản.")
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.description is not None:
        row.description = payload.description.strip()
    if payload.version_tag is not None:
        row.version_tag = payload.version_tag.strip()[:32] or row.version_tag
    if payload.changelog is not None:
        row.changelog = payload.changelog.strip()
    if payload.default_stagger_sec is not None:
        row.default_stagger_sec = payload.default_stagger_sec
    if payload.jitter_pct is not None:
        row.jitter_pct = payload.jitter_pct
    if payload.steps is not None:
        row.steps_json = [s.model_dump() for s in payload.steps]
    ctx.audit.record(
        action="playbook.version_bumped",
        entity_type="automation_playbook",
        entity_id=row.id,
        metadata={"title": row.title, "version_tag": row.version_tag, "changelog": row.changelog},
    )
    ctx.commit()
    return _serialize_playbook(row, author_name=ctx.user.full_name or ctx.user.email)


@router.post("/{playbook_id}/rate")
def rate_playbook(ctx: Ctx, playbook_id: uuid.UUID, payload: PlaybookRateInput) -> dict[str, Any]:
    row = ctx.session.get(AutomationPlaybook, playbook_id)
    if row is None or row.workspace_id != ctx.workspace_id or row.archived_at is not None:
        raise NotFoundError("Không tìm thấy kịch bản.")
    existing = ctx.session.execute(
        sa.select(AutomationPlaybookRating).where(
            AutomationPlaybookRating.playbook_id == row.id,
            AutomationPlaybookRating.user_id == ctx.user.id,
        )
    ).scalar_one_or_none()
    if existing is None:
        ctx.session.add(
            AutomationPlaybookRating(
                playbook_id=row.id,
                workspace_id=ctx.workspace_id,
                user_id=ctx.user.id,
                stars=payload.stars,
                comment=payload.comment.strip(),
            )
        )
    else:
        existing.stars = payload.stars
        existing.comment = payload.comment.strip()
    ctx.session.flush()

    agg_sum, agg_cnt = ctx.session.execute(
        sa.select(
            sa.func.coalesce(sa.func.sum(AutomationPlaybookRating.stars), 0),
            sa.func.count(AutomationPlaybookRating.id),
        ).where(AutomationPlaybookRating.playbook_id == row.id)
    ).one()
    row.rating_sum = int(agg_sum or 0)
    row.rating_count = int(agg_cnt or 0)
    ctx.commit()
    return _serialize_playbook(row, my_rating=payload.stars)


@router.post("/{playbook_id}/record-run")
def record_playbook_run(ctx: WriteCtx, playbook_id: uuid.UUID, payload: PlaybookRecordRunInput) -> dict[str, Any]:
    row = ctx.session.get(AutomationPlaybook, playbook_id)
    if row is None or row.workspace_id != ctx.workspace_id or row.archived_at is not None:
        raise NotFoundError("Không tìm thấy kịch bản.")
    row.run_count = int(row.run_count or 0) + 1
    ctx.audit.record(
        action="playbook.batch_executed",
        entity_type="automation_playbook",
        entity_id=row.id,
        metadata={
            "playbook_title": row.title,
            "platform": row.platform,
            "version_tag": row.version_tag,
            "via_count": len(payload.via_ids),
            "via_ids": payload.via_ids[:50],
            "antidetect_engine": payload.engine,
            "stagger_sec": payload.stagger_sec,
            "jitter_pct": payload.jitter_pct,
            "workstation": payload.workstation,
            "actor_email": ctx.user.email,
            "actor_name": ctx.user.full_name,
        },
    )
    ctx.commit()
    return _serialize_playbook(row)


@router.get("/launch-audit")
def list_profile_launch_audit(
    ctx: Ctx,
    limit: int = Query(default=60, ge=1, le=200),
) -> list[dict[str, Any]]:
    actions = (
        "via.profile_launched",
        "via.profile_stopped",
        "via.engine_failover",
        "playbook.batch_executed",
    )
    rows = ctx.session.execute(
        sa.select(AuditLog, User.email, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(
            AuditLog.workspace_id == ctx.workspace_id,
            AuditLog.action.in_(actions),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    ).all()

    out: list[dict[str, Any]] = []
    for log, actor_email, actor_name in rows:
        meta = dict(log.metadata_json or {}) if isinstance(log.metadata_json, dict) else {}
        out.append(
            {
                "id": str(log.id),
                "action": log.action,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "actor_email": actor_email or meta.get("actor_email") or "",
                "actor_name": actor_name or meta.get("actor_name") or "",
                "via_id": meta.get("via_id") or (log.entity_id if log.entity_type == "personal_account_reference" else ""),
                "via_label": meta.get("via_label") or meta.get("playbook_title") or "",
                "antidetect_engine": meta.get("antidetect_engine") or "chrome_native",
                "antidetect_profile_id": meta.get("antidetect_profile_id") or "",
                "browser_profile": meta.get("browser_profile") or "",
                "workstation": meta.get("workstation") or "",
                "startup_ms": meta.get("startup_ms"),
                "failover_from": meta.get("failover_from") or "",
                "detail": meta.get("detail") or meta.get("note") or "",
            }
        )
    return out
