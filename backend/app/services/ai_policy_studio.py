"""Hybrid Meta Ads Policy Pre-Check Scanner, BYOK AI Content Studio & Audited Via Role Guardrail."""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.secret_vault import (
    SecretDecryptionError,
    encrypt_ai_provider_key,
    open_ai_provider_key,
    sign_guardrail_override,
)
from app.models.entities import AuditLog
from app.services.ai_provider_transport import (
    DEFAULT_MODELS_BY_PROVIDER,
    call_ai_provider_chat,
    normalize_model,
    normalize_provider,
)
from app.services.audit import AuditLogService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PolicyRule:
    rule_id: str
    category: str
    category_label: str
    severity: str  # "high" | "medium"
    pattern: re.Pattern[str]
    reason: str
    safe_replacement: str


_POLICY_RULES: tuple[_PolicyRule, ...] = (
    # 1. Medical exaggeration / absolute guarantees
    _PolicyRule(
        rule_id="med_absolute_cure",
        category="medical_exaggeration",
        category_label="Cam kết tuyệt đối & Y khoa",
        severity="high",
        pattern=re.compile(
            r"(?<!\w)(?:cam\s*kết\s*100%|hiệu\s*quả\s*100%|chữa\s*khỏi\s*hoàn\s*toàn|dứt\s*điểm\s*vĩnh\s*viễn|"
            r"trị\s*tận\s*gốc|bác\s*sĩ\s*cam\s*kết|cam\s*kết\s*không\s*tái\s*phát|"
            r"100%\s*guaranteed\s*cure|permanent\s*cure|guaranteed\s*results)(?!\w)",
            re.IGNORECASE,
        ),
        reason="Meta cấm khẳng định kết quả y khoa/thẩm mỹ tuyệt đối 100% hoặc 'dứt điểm vĩnh viễn'.",
        safe_replacement="hỗ trợ cải thiện rõ rệt theo lộ trình chăm sóc phù hợp",
    ),
    # 2. Personal attributes shaming (second-person targeting negative traits)
    _PolicyRule(
        rule_id="personal_attr_shame",
        category="personal_attributes",
        category_label="Ám chỉ đặc điểm cá nhân",
        severity="high",
        pattern=re.compile(
            r"\b(?:bạn\s*đang\s*béo|bụng\s*mỡ\s*của\s*bạn|da\s*bạn\s*đầy\s*mụn|mặt\s*(?:bạn\s*)?nhiều\s*nám(?:\s*sạm)?|"
            r"bạn\s*đang\s*nợ\s*nần|bạn\s*bị\s*hói|are\s*you\s*overweight|suffering\s*from\s*acne|"
            r"is\s*your\s*skin\s*aging)\b",
            re.IGNORECASE,
        ),
        reason="Chính sách Meta Personal Attributes cấm nói trực diện vào ngoại hình, bệnh lý hay tài chính của 'bạn'.",
        safe_replacement="nhiều khách hàng đang tìm kiếm giải pháp chăm sóc phù hợp",
    ),
    # 3. Before / After & rapid numeric claims
    _PolicyRule(
        rule_id="before_after_rapid",
        category="before_after_rapid",
        category_label="Before/After & Cam kết cấp tốc",
        severity="high",
        pattern=re.compile(
            r"\b(?:giảm\s*\d+\s*kg\s*trong\s*\d+\s*(?:ngày|tuần)|trắng\s*bật\s*\d+\s*tông|"
            r"hết\s*sạch\s*mụn\s*sau\s*\d+\s*ngày|before\s*(?:&|and)\s*after|trước\s*và\s*sau\s*khi\s*dùng|"
            r"lose\s*\d+\s*(?:kg|lbs)\s*in\s*\d+\s*days)\b",
            re.IGNORECASE,
        ),
        reason="Quảng cáo so sánh Trước/Sau hoặc hứa giảm cân/làm đẹp cấp tốc theo số ngày dễ bị gắn cờ khóa TKQC.",
        safe_replacement="chăm sóc đều đặn kết hợp chế độ sinh hoạt cân bằng",
    ),
    # 4. Financial / get-rich-quick / debt promises
    _PolicyRule(
        rule_id="financial_claims",
        category="financial_claims",
        category_label="Tài chính & Cam kết thu nhập",
        severity="high",
        pattern=re.compile(
            r"\b(?:giải\s*ngân\s*trong\s*\d+\s*phút|bao\s*đậu\s*nợ\s*xấu|cam\s*kết\s*lợi\s*nhuận|"
            r"việc\s*nhẹ\s*lương\s*cao|kiếm\s*\d+\s*triệu\s*/\s*(?:ngày|tuần)|"
            r"guaranteed\s*profit|get\s*rich\s*quick)\b",
            re.IGNORECASE,
        ),
        reason="Nội dung hứa hẹn lợi nhuận, việc nhẹ lương cao hoặc giải ngân cấp tốc bị xếp vào rủi ro tài chính cao.",
        safe_replacement="quy trình tư vấn minh bạch với thông tin điều kiện rõ ràng",
    ),
    # 5. Restricted products & counterfeit/trademark evasion
    _PolicyRule(
        rule_id="restricted_counterfeit",
        category="restricted_products_trademark",
        category_label="Hàng nhái & Sản phẩm hạn chế",
        severity="high",
        pattern=re.compile(
            r"\b(?:hàng\s*rep\s*1\s*:\s*1|like\s*auth|super\s*fake|thuốc\s*kích|cờ\s*bạc|cá\s*độ|tài\s*xỉu)\b",
            re.IGNORECASE,
        ),
        reason="Từ khóa ám chỉ hàng giả, hàng nhái thương hiệu hoặc sản phẩm cấm dẫn tới vô hiệu hóa TKQC tức thì.",
        safe_replacement="sản phẩm thiết kế chính hãng có nguồn gốc rõ ràng",
    ),
)

_CAPS_WORD_RE = re.compile(r"\b[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]{4,}\b")
_PUNCTS_BURST_RE = re.compile(r"[!?]{3,}")
_SHORTENER_RE = re.compile(r"\bhttps?://(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl)/\S+", re.IGNORECASE)
_ENGAGEMENT_BAIT_RE = re.compile(
    r"\b(?:share\s*ngay\s*để\s*nhận|comment\s*chấm\s*để|bình\s*luận\s*chấm\s*\(?\.?\)?\s*để)\b",
    re.IGNORECASE,
)
_PHONE_OR_LINK_RE = re.compile(r"(?:\b0\d{9}\b|\+84\d{9}\b|https?://\S+|\b(?:inbox\s*ngay|giá\s*chỉ\s*\d+k)\b)", re.IGNORECASE)


def scan_ad_policy_compliance(
    text: str,
    *,
    headline: str = "",
    mode: str = "ad_copy",
    is_new_page: bool = False,
) -> dict[str, Any]:
    clean_text = (text or "").strip()
    clean_headline = (headline or "").strip()
    combined = f"{clean_headline}\n{clean_text}".strip() if clean_headline else clean_text

    findings: list[dict[str, Any]] = []
    sanitized_text = clean_text
    sanitized_headline = clean_headline
    penalty = 0

    for rule in _POLICY_RULES:
        seen_matches: set[str] = set()
        for m in rule.pattern.finditer(combined):
            snippet = m.group(0).strip()
            key = snippet.lower()
            if key in seen_matches:
                continue
            seen_matches.add(key)
            findings.append(
                {
                    "id": f"{rule.rule_id}:{len(findings) + 1}",
                    "category": rule.category,
                    "category_label": rule.category_label,
                    "severity": rule.severity,
                    "matched_text": snippet,
                    "reason": rule.reason,
                    "safe_replacement": rule.safe_replacement,
                }
            )
            penalty += 22 if rule.severity == "high" else 12
        sanitized_text = rule.pattern.sub(rule.safe_replacement, sanitized_text)
        if sanitized_headline:
            sanitized_headline = rule.pattern.sub(rule.safe_replacement, sanitized_headline)

    # Category 6: Engagement bait & spam formatting
    caps_words = _CAPS_WORD_RE.findall(combined)
    if len(caps_words) >= 4:
        findings.append(
            {
                "id": f"engagement_spam_caps:{len(findings) + 1}",
                "category": "engagement_spam_format",
                "category_label": "Định dạng Spam & Câu tương tác",
                "severity": "medium",
                "matched_text": " ".join(caps_words[:4]),
                "reason": f"Phát hiện {len(caps_words)} từ VIẾT HOA liên tiếp — dễ bị bộ lọc Spam của Meta giảm phân phối.",
                "safe_replacement": "viết hoa chuẩn câu chữ tự nhiên",
            }
        )
        penalty += 10
        sanitized_text = _CAPS_WORD_RE.sub(lambda mm: mm.group(0).capitalize(), sanitized_text)

    if _PUNCTS_BURST_RE.search(combined):
        findings.append(
            {
                "id": f"engagement_spam_punct:{len(findings) + 1}",
                "category": "engagement_spam_format",
                "category_label": "Định dạng Spam & Câu tương tác",
                "severity": "medium",
                "matched_text": _PUNCTS_BURST_RE.search(combined).group(0),  # type: ignore[union-attr]
                "reason": "Lạm dụng nhiều dấu '!!!' hoặc '???' liên tiếp kích hoạt cảnh báo nội dung giật gân.",
                "safe_replacement": ".",
            }
        )
        penalty += 8
        sanitized_text = _PUNCTS_BURST_RE.sub(".", sanitized_text)

    short_m = _SHORTENER_RE.search(combined)
    if short_m:
        findings.append(
            {
                "id": f"engagement_spam_shortlink:{len(findings) + 1}",
                "category": "engagement_spam_format",
                "category_label": "Định dạng Spam & Câu tương tác",
                "severity": "high",
                "matched_text": short_m.group(0),
                "reason": "Link rút gọn (bit.ly / tinyurl) trong bài quảng cáo thường bị đánh dấu che giấu đích đến.",
                "safe_replacement": "domain chính chủ của thương hiệu",
            }
        )
        penalty += 18

    if mode == "ad_copy":
        bait_m = _ENGAGEMENT_BAIT_RE.search(combined)
        if bait_m:
            findings.append(
                {
                    "id": f"engagement_bait:{len(findings) + 1}",
                    "category": "engagement_spam_format",
                    "category_label": "Định dạng Spam & Câu tương tác",
                    "severity": "medium",
                    "matched_text": bait_m.group(0),
                    "reason": "Kêu gọi 'share ngay / comment chấm' bị thuật toán Meta xếp vào Engagement Bait (bóp reach).",
                    "safe_replacement": "nhắn tin hoặc để lại thông tin để được đội ngũ hỗ trợ chi tiết",
                }
            )
            penalty += 12
            sanitized_text = _ENGAGEMENT_BAIT_RE.sub(
                "nhắn tin để được đội ngũ hỗ trợ chi tiết", sanitized_text
            )

    # Category 7: Hard-sell / phone / links on Page warmup or new pages
    if mode == "page_warmup" or is_new_page:
        sell_m = _PHONE_OR_LINK_RE.search(combined)
        if sell_m:
            findings.append(
                {
                    "id": f"new_page_hard_sell:{len(findings) + 1}",
                    "category": "new_page_hard_sell",
                    "category_label": "Bán hàng cứng trên Page mới",
                    "severity": "medium",
                    "matched_text": sell_m.group(0),
                    "reason": "Bài mồi nuôi Fanpage mới chưa nên chèn SĐT, link mua hàng hoặc báo giá quá sớm để tránh quét Page thương mại ảo.",
                    "safe_replacement": "(gỡ SĐT/Link bán hàng trong giai đoạn 3 bài mồi đầu)",
                }
            )
            penalty += 14
            sanitized_text = _PHONE_OR_LINK_RE.sub("", sanitized_text).strip()

    score = max(0, min(100, 100 - penalty))
    if score >= 85 and not any(f["severity"] == "high" for f in findings):
        verdict = "safe"
    elif score >= 60:
        verdict = "warning"
    else:
        verdict = "high_risk"

    return {
        "score": score,
        "verdict": verdict,
        "mode": mode,
        "findings_count": len(findings),
        "findings": findings,
        "sanitized_text": re.sub(r"\s{2,}", " ", sanitized_text).strip(),
        "sanitized_headline": sanitized_headline,
    }


def mask_ai_key(raw_key: str) -> str:
    clean = (raw_key or "").strip()
    if len(clean) <= 8:
        return "****"
    return f"{clean[:4]}...{clean[-4:]}"


def get_workspace_ai_record(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_ai_studio",
                AuditLog.action == "workspace_ai_studio.updated",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    meta = dict(row.metadata_json or {}) if row and isinstance(row.metadata_json, dict) else {}
    provider = normalize_provider(str(meta.get("provider") or "gemini"))
    model = normalize_model(provider, str(meta.get("model") or ""))
    return {
        "enabled": bool(meta.get("enabled", False)),
        "provider": provider,
        "model": model,
        "ai_envelope": str(meta.get("ai_envelope") or "").strip(),
        "ai_mask": str(meta.get("ai_mask") or "").strip(),
        "updated_at": row.created_at.isoformat() if row and row.created_at else None,
    }


def serialize_workspace_ai_config(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    rec = get_workspace_ai_record(session, workspace_id)
    has_key = bool(rec["ai_envelope"])
    return {
        "enabled": rec["enabled"],
        "provider": rec["provider"],
        "model": rec["model"],
        "key_configured": has_key,
        "key_mask": rec["ai_mask"] if has_key else "",
        "available_models": DEFAULT_MODELS_BY_PROVIDER,
        "updated_at": rec["updated_at"],
    }


def save_workspace_ai_config(
    session: Session,
    workspace_id: uuid.UUID,
    audit: AuditLogService,
    settings,
    *,
    provider: str | None = None,
    model: str | None = None,
    enabled: bool | None = None,
    provider_key: str | None = None,
    clear_key: bool = False,
) -> dict[str, Any]:
    cur = get_workspace_ai_record(session, workspace_id)
    next_provider = normalize_provider(provider if provider is not None else cur["provider"])
    next_model = normalize_model(next_provider, model if model is not None else cur["model"])
    next_enabled = cur["enabled"] if enabled is None else bool(enabled)
    next_envelope = "" if clear_key else cur["ai_envelope"]
    next_mask = "" if clear_key else cur["ai_mask"]

    clean_key = (provider_key or "").strip()
    if clean_key:
        if len(clean_key) > 256:
            raise ValueError("API Key quá dài (tối đa 256 ký tự).")
        next_envelope = encrypt_ai_provider_key(settings, clean_key)
        next_mask = mask_ai_key(clean_key)
        if enabled is None:
            next_enabled = True

    meta_payload = {
        "provider": next_provider,
        "model": next_model,
        "enabled": next_enabled,
        "ai_envelope": next_envelope,
        "ai_mask": next_mask,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    audit.record(
        action="workspace_ai_studio.updated",
        entity_type="workspace_ai_studio",
        entity_id=str(workspace_id),
        metadata=meta_payload,
    )
    session.flush()
    return serialize_workspace_ai_config(session, workspace_id)


def _resolve_workspace_ai_credentials(session: Session, workspace_id: uuid.UUID, settings) -> tuple[str, str, str] | None:
    rec = get_workspace_ai_record(session, workspace_id)
    if not rec["enabled"] or not rec["ai_envelope"]:
        return None
    try:
        plain_key = open_ai_provider_key(settings, rec["ai_envelope"])
    except SecretDecryptionError:
        logger.warning("workspace_ai_envelope_unreadable", extra={"workspace_id": str(workspace_id)})
        return None
    if not plain_key:
        return None
    return rec["provider"], rec["model"], plain_key


def _deterministic_warmup_variants(page_name: str, category: str) -> list[str]:
    clean_name = (page_name or "Thương hiệu").strip()
    clean_cat = (category or "Dịch vụ & Tư vấn").strip()
    return [
        (
            f"Chia sẻ góc nhìn thực tế từ đội ngũ {clean_name} về lĩnh vực {clean_cat}: "
            f"việc xây dựng thói quen chăm chút từng chi tiết nhỏ mỗi ngày giúp nâng cao trải nghiệm bền vững hơn nhiều so với giải pháp vội vàng."
        ),
        (
            f"Cuối tuần nhẹ nhàng cùng {clean_name}. Chúng tôi luôn tin rằng sự minh bạch trong thông tin và quy trình chuẩn chỉ "
            f"là nền tảng giúp khách hàng an tâm đồng hành dài lâu trong hành trình {clean_cat}."
        ),
        (
            f"3 nguyên tắc đội ngũ {clean_name} ưu tiên khi phục vụ khách hàng mảng {clean_cat}: "
            f"lắng nghe đúng nhu cầu thực tế, tư vấn rõ ràng từng bước và đồng hành hỗ trợ tận tâm sau khi trải nghiệm."
        ),
    ]


def generate_studio_content(
    session: Session,
    workspace_id: uuid.UUID,
    settings,
    *,
    task: str,
    text: str = "",
    headline: str = "",
    page_name: str = "",
    category: str = "",
    mode: str = "ad_copy",
    tone: str = "professional_natural",
) -> dict[str, Any]:
    norm_task = (task or "rewrite_safe").strip().lower()
    if norm_task not in ("rewrite_safe", "page_warmup"):
        norm_task = "rewrite_safe"

    resolved = _resolve_workspace_ai_credentials(session, workspace_id, settings)

    if norm_task == "rewrite_safe":
        before_scan = scan_ad_policy_compliance(text, headline=headline, mode=mode)
        if resolved:
            provider, model, api_key = resolved
            findings_summary = "; ".join(
                f"[{f['category_label']}] '{f['matched_text']}' -> gợi ý '{f['safe_replacement']}'"
                for f in before_scan["findings"][:6]
            )
            system_prompt = (
                "Bạn là chuyên gia kiểm duyệt chính sách Meta Ads. "
                "Hãy viết lại nội dung quảng cáo bằng tiếng Việt tự nhiên, giữ nguyên thông điệp bán hàng và CTA, "
                "nhưng loại bỏ hoàn toàn các câu vi phạm Personal Attributes (chỉ trích trực diện người đọc), "
                "cam kết 100%/vĩnh viễn, Before/After cấp tốc, chữ in hoa spam. Chỉ trả về phần bài viết đã sửa, không giải thích dài."
            )
            user_prompt = (
                f"Phong cách mong muốn: {tone}.\n"
                f"Tiêu đề gốc: {headline or '(không có)'}\n"
                f"Nội dung gốc:\n{text}\n\n"
                f"Các lỗi cần sửa: {findings_summary or 'Tối ưu câu chữ mượt mà hơn, chuẩn chính sách.'}"
            )
            ai_res = call_ai_provider_chat(
                provider=provider,
                model=model,
                provider_key=api_key,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            if ai_res.get("ok"):
                candidate = str(ai_res["text"]).strip()
                after_scan = scan_ad_policy_compliance(candidate, headline=before_scan["sanitized_headline"], mode=mode)
                return {
                    "ok": True,
                    "task": "rewrite_safe",
                    "engine": "workspace_ai",
                    "provider": provider,
                    "model": model,
                    "rewritten_text": candidate,
                    "rewritten_headline": before_scan["sanitized_headline"],
                    "variants": [candidate],
                    "before_score": before_scan["score"],
                    "after_score": after_scan["score"],
                    "after_scan": after_scan,
                }
            # Fallback safely with notice on AI call failure
            after_scan = scan_ad_policy_compliance(
                before_scan["sanitized_text"], headline=before_scan["sanitized_headline"], mode=mode
            )
            return {
                "ok": True,
                "task": "rewrite_safe",
                "engine": "deterministic_rules",
                "ai_fallback_reason": ai_res.get("error_summary"),
                "rewritten_text": before_scan["sanitized_text"],
                "rewritten_headline": before_scan["sanitized_headline"],
                "variants": [before_scan["sanitized_text"]],
                "before_score": before_scan["score"],
                "after_score": after_scan["score"],
                "after_scan": after_scan,
            }

        after_scan = scan_ad_policy_compliance(
            before_scan["sanitized_text"], headline=before_scan["sanitized_headline"], mode=mode
        )
        return {
            "ok": True,
            "task": "rewrite_safe",
            "engine": "deterministic_rules",
            "rewritten_text": before_scan["sanitized_text"],
            "rewritten_headline": before_scan["sanitized_headline"],
            "variants": [before_scan["sanitized_text"]],
            "before_score": before_scan["score"],
            "after_score": after_scan["score"],
            "after_scan": after_scan,
        }

    # task == "page_warmup"
    if resolved:
        provider, model, api_key = resolved
        system_prompt = (
            "Bạn là chuyên gia xây dựng thương hiệu Fanpage sạch trên Facebook. "
            "Hãy viết đúng 3 bài đăng nuôi Page ngắn gọn (2-4 câu mỗi bài) chia sẻ kiến thức hoặc giá trị tự nhiên bằng tiếng Việt, "
            "KHÔNG chèn SĐT, KHÔNG chèn link bán hàng, KHÔNG cam kết 100%, KHÔNG hashtag spam. "
            "Ngăn cách đúng 3 bài bằng chuỗi '---' trên một dòng riêng."
        )
        user_prompt = f"Tên Fanpage: {page_name or 'Thương hiệu'}\nNgành hàng: {category or 'Kinh doanh tổng hợp'}"
        ai_res = call_ai_provider_chat(
            provider=provider,
            model=model,
            provider_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        if ai_res.get("ok"):
            parts = [p.strip() for p in re.split(r"\n\s*---+\s*\n", str(ai_res["text"])) if p.strip()]
            if parts:
                variants = parts[:3]
                first_scan = scan_ad_policy_compliance(variants[0], mode="page_warmup", is_new_page=True)
                return {
                    "ok": True,
                    "task": "page_warmup",
                    "engine": "workspace_ai",
                    "provider": provider,
                    "model": model,
                    "rewritten_text": variants[0],
                    "variants": variants,
                    "after_score": first_scan["score"],
                    "after_scan": first_scan,
                }

    variants = _deterministic_warmup_variants(page_name, category)
    first_scan = scan_ad_policy_compliance(variants[0], mode="page_warmup", is_new_page=True)
    return {
        "ok": True,
        "task": "page_warmup",
        "engine": "deterministic_rules",
        "rewritten_text": variants[0],
        "variants": variants,
        "after_score": first_scan["score"],
        "after_scan": first_scan,
    }


def issue_owner_guardrail_override(
    session: Session,
    workspace_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    audit: AuditLogService,
    settings,
    *,
    via_id: str,
    via_label: str,
    via_tier: str,
    target_scope: str,
    reason: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    ttl_seconds = 900
    expires_at = (now + timedelta(seconds=ttl_seconds)).isoformat()
    clean_scope = (target_scope or "ads_manager_campaign").strip()[:64]
    clean_reason = (reason or "").strip()[:300]
    grant_payload = {
        "w": str(workspace_id),
        "u": str(actor_user_id),
        "v": (via_id or via_label or "").strip()[:80],
        "t": (via_tier or "vault").strip()[:24],
        "s": clean_scope,
        "exp": expires_at,
    }
    override_grant = sign_guardrail_override(settings, grant_payload)
    audit.record(
        action="via_guardrail.owner_override",
        entity_type="via_role_guardrail",
        entity_id=(via_id or via_label or str(workspace_id))[:80],
        metadata={
            "via_id": via_id,
            "via_label": via_label,
            "via_tier": via_tier,
            "target_scope": clean_scope,
            "reason": clean_reason,
            "expires_at": expires_at,
            "expires_in_seconds": ttl_seconds,
        },
    )
    session.flush()
    return {
        "ok": True,
        "via_id": via_id,
        "via_label": via_label,
        "via_tier": via_tier,
        "target_scope": clean_scope,
        "override_grant": override_grant,
        "expires_in_seconds": ttl_seconds,
        "expires_at": expires_at,
    }
