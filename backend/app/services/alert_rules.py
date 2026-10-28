"""Deterministic mapping from A2 facts to alert candidates (MINI-SPEC A3 §B).

Pure functions. A3 reads A2 records and normalises them into attention items; it never
re-evaluates a health rule, never changes a health severity, and never invents a fact.

The A2 severity is carried through into `source_snapshot` so the mapping stays explainable:
an `attention` health signal becomes an `info` alert, and the record says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.enums import AlertSeverity, AlertSourceType, SignalSeverity
from app.models.entities import AdAccount
from app.models.health import AccountHealthSignal, HealthEvaluationRun
from app.services.health_rules import HEALTH_RULES_BY_KEY

ALERT_POLICY_VERSION = "a3-v1"

#: A2 health severity → A3 alert severity. `attention` and `unknown` both become `info`:
#: they are worth showing in the Alert Center, and A3 v1 does not page anyone for them.
SEVERITY_MAP: dict[SignalSeverity, AlertSeverity] = {
    SignalSeverity.CRITICAL: AlertSeverity.CRITICAL,
    SignalSeverity.WARNING: AlertSeverity.WARNING,
    SignalSeverity.ATTENTION: AlertSeverity.INFO,
    SignalSeverity.UNKNOWN: AlertSeverity.INFO,
}

SEVERITY_RANK: dict[AlertSeverity, int] = {
    AlertSeverity.INFO: 0,
    AlertSeverity.WARNING: 1,
    AlertSeverity.CRITICAL: 2,
}

DEFAULT_NEXT_STEP = "Open the account in the dashboard and review the recorded evidence."


@dataclass(frozen=True)
class AlertCandidate:
    alert_key: str
    source_type: AlertSourceType
    source_entity_type: str
    source_entity_id: str | None
    ad_account_id: str | None
    severity: AlertSeverity
    category: str
    title: str
    summary: str
    observed_at: datetime
    source_snapshot: dict[str, Any] = field(default_factory=dict)
    #: The manual action offered to the operator, in the message and in the UI.
    recommended_next_step: str = DEFAULT_NEXT_STEP


def signal_alert_key(signal: AccountHealthSignal) -> str:
    return f"health_signal:{signal.ad_account_id}:{signal.signal_key}"


def evaluation_failure_alert_key(run: HealthEvaluationRun) -> str:
    # Keyed by cause, not by run: repeated failures of the same kind are one attention item,
    # not one per evaluation.
    return f"health_evaluation_run:{run.ad_account_id}:{run.error_code or 'unknown_error'}"


def from_health_signal(
    signal: AccountHealthSignal, account: AdAccount, *, health_status: str
) -> AlertCandidate:
    rule = HEALTH_RULES_BY_KEY.get(signal.rule_key)
    evidence = signal.evidence_json or {}
    severity = SEVERITY_MAP[signal.severity]
    return AlertCandidate(
        alert_key=signal_alert_key(signal),
        source_type=AlertSourceType.HEALTH_SIGNAL,
        source_entity_type="account_health_signal",
        source_entity_id=str(signal.id),
        ad_account_id=str(signal.ad_account_id),
        severity=severity,
        category=signal.category.value,
        title=rule.name if rule else signal.rule_key,
        summary=str(evidence.get("message", signal.rule_key)),
        observed_at=signal.observed_at,
        recommended_next_step=rule.recommended_next_step if rule else DEFAULT_NEXT_STEP,
        source_snapshot={
            "rule_key": signal.rule_key,
            "rule_version": signal.rule_version,
            "health_signal_id": str(signal.id),
            # Kept so nobody has to guess why an attention signal became an info alert.
            "health_severity": signal.severity.value,
            "health_signal_status": signal.status.value,
            "health_status": health_status,
            "readiness_status": account.readiness_status.value,
            "account_status": account.status.value,
            "category": signal.category.value,
            "why_it_matters": rule.why_it_matters if rule else None,
            "observed_at": signal.observed_at.isoformat() if signal.observed_at else None,
        },
    )


def from_evaluation_failure(
    run: HealthEvaluationRun, account: AdAccount, *, health_status: str
) -> AlertCandidate:
    """A failed evaluation means the account's condition is not known — worth a warning.

    Only the allowlisted error *code* is carried. `error_summary` may contain an exception
    message, so it is deliberately left out of both the alert and the message.
    """
    return AlertCandidate(
        alert_key=evaluation_failure_alert_key(run),
        source_type=AlertSourceType.HEALTH_EVALUATION_RUN,
        source_entity_type="health_evaluation_run",
        source_entity_id=str(run.id),
        ad_account_id=str(run.ad_account_id) if run.ad_account_id else None,
        severity=AlertSeverity.WARNING,
        category="data_quality",
        title="Health evaluation did not complete",
        summary=(
            "The last health evaluation for this account failed, so its current condition is "
            f"not known (error code: {run.error_code or 'unknown_error'})."
        ),
        observed_at=run.started_at,
        recommended_next_step=(
            "Recalculate health for this account. If it fails again, check the evaluation-run "
            "history on the Health tab."
        ),
        source_snapshot={
            "health_evaluation_run_id": str(run.id),
            "error_code": run.error_code,
            "trigger_type": run.trigger_type.value,
            "engine_version": run.engine_version,
            "health_status": health_status,
            "readiness_status": account.readiness_status.value,
            "started_at": run.started_at.isoformat() if run.started_at else None,
        },
    )


def is_escalation(previous: AlertSeverity, candidate: AlertSeverity) -> bool:
    return SEVERITY_RANK[candidate] > SEVERITY_RANK[previous]


#: F2 remediation checklists per rule key ([ĐỀ XUẤT — chờ BA duyệt]).
#: Never claims safety, approval, or immunity (rule 6), and never names banned secret substrings.
REMEDIATION_CHECKLISTS_BY_RULE: dict[str, tuple[str, ...]] = {
    "account_restricted_status": (
        "Đăng nhập đúng tài khoản Facebook ở mục 'Đăng nhập để xử lý' bên dưới.",
        "Mở Chất lượng tài khoản (Account Quality) và Business Settings để đọc thông báo hạn chế của Meta.",
        "Ghi nhận sự kiện tài khoản, gửi kháng nghị trên Meta nếu đủ điều kiện, hoặc chuyển ngân sách sang tài khoản dự phòng.",
    ),
    "account_disabled_status": (
        "Đăng nhập đúng tài khoản Facebook ở mục 'Đăng nhập để xử lý' bên dưới.",
        "Kiểm tra Chất lượng tài khoản (Account Quality) để xác nhận lý do tài khoản bị vô hiệu hoá.",
        "Nộp kháng nghị trên Meta nếu có cơ sở, đồng thời chuyển ngân sách sang tài khoản quảng cáo khác và ghi nhận sự kiện.",
    ),
    "platform_account_status_blocking": (
        "Đăng nhập đúng tài khoản Facebook quản lý Business Manager của tài khoản này.",
        "Mở Account Quality và Ads Manager để kiểm tra mã trạng thái và lý do vô hiệu hoá do Meta trả về.",
        "Kháng nghị trên Meta hoặc điều phối lại ngân sách, sau đó ghi nhận kết quả vào tab Sự kiện.",
    ),
    "platform_account_status_pending": (
        "Đăng nhập tài khoản Facebook quản lý Business Manager của tài khoản này.",
        "Mở mục Lập hoá đơn & Thanh toán (Billing) hoặc thông báo xét duyệt trong Ads Manager để xử lý khoản treo.",
        "Ghi nhận sự kiện tài khoản và kiểm tra lại ở lần đọc trạng thái tiếp theo từ Meta.",
    ),
    "platform_account_status_unrecognised": (
        "Đăng nhập tài khoản Facebook quản lý và mở Ads Manager để xem trạng thái thực tế của tài khoản.",
        "Đối chiếu mã trạng thái lạ Meta trả về với thông báo trên giao diện Meta.",
        "Ghi nhận kết quả kiểm tra vào tab Sự kiện của tài khoản.",
    ),
    "platform_vs_recorded_status_mismatch": (
        "Mở tab Tổng quan của tài khoản để so sánh trạng thái Meta trả về với trạng thái đang ghi nhận.",
        "Đăng nhập tài khoản Facebook quản lý nếu cần xác minh trực tiếp trên Ads Manager.",
        "Bấm cập nhật trạng thái ghi nhận kèm ghi chú nếu thông tin từ Meta là trạng thái mới nhất.",
    ),
    "spend_change_vs_baseline": (
        "Đăng nhập tài khoản Facebook quản lý và mở Ads Manager tại đúng ngày có biến động chi tiêu.",
        "So sánh chi tiêu của từng chiến dịch/nhóm quảng cáo với trung vị các ngày hoàn chỉnh trước đó.",
        "Điều chỉnh ngân sách trên Ads Manager nếu cần và ghi nhận nguyên nhân vào Sự kiện tài khoản.",
    ),
    "spend_cap_approaching": (
        "Đăng nhập tài khoản Facebook quản lý và mở Cài đặt thanh toán (Billing Settings) trong Ads Manager.",
        "Kiểm tra giới hạn chi tiêu của tài khoản (Account Spending Limit) so với tổng chi tiêu hiện tại.",
        "Tăng hoặc đặt lại giới hạn chi tiêu trên Meta nếu chiến dịch cần tiếp tục phân phối.",
    ),
    "spend_observation_missing_or_stale": (
        "Mở tab Chi tiêu của tài khoản quảng cáo để xem mã lỗi của các lần đọc gần nhất.",
        "Kiểm tra kết nối Meta và quyền đọc của Business Manager trong trang Cài đặt.",
        "Chủ không gian làm việc có thể bấm 'Đọc lại từ Meta' để kiểm tra lại ngay.",
    ),
    "spend_currency_mismatch": (
        "Mở Ads Manager để xác nhận đơn vị tiền tệ chính thức của tài khoản quảng cáo.",
        "So sánh với đơn vị tiền tệ đang lưu trong hồ sơ tài khoản trên hệ thống.",
        "Cập nhật lại đơn vị tiền tệ trong hồ sơ nếu bản ghi nội bộ bị nhập sai.",
    ),
    "critical_account_event_open": (
        "Mở tab Sự kiện của tài khoản quảng cáo để đọc chi tiết sự kiện nghiêm trọng đang mở.",
        "Đăng nhập tài khoản Facebook quản lý để xử lý nguyên nhân gốc trên Ads Manager / Business Settings.",
        "Đánh dấu hoàn tất (Resolve) sự kiện kèm lý do sau khi đã xử lý xong.",
    ),
    "warning_account_event_open": (
        "Mở tab Sự kiện của tài khoản quảng cáo để xem nội dung cảnh báo đã ghi nhận.",
        "Kiểm tra trên Ads Manager bằng tài khoản Facebook quản lý nếu sự kiện liên quan đến vận hành.",
        "Đánh dấu hoàn tất sự kiện kèm ghi chú kết quả xử lý.",
    ),
    "mandatory_readiness_evidence_missing": (
        "Mở tab Mức sẵn sàng (Readiness) của tài khoản để xem các mục bắt buộc còn thiếu bằng chứng.",
        "Đính kèm bằng chứng xác minh hoặc hoàn tất rà soát cho từng mục.",
        "Kiểm tra lại trạng thái sẵn sàng sau khi hệ thống tự động tính lại.",
    ),
    "mandatory_readiness_evidence_expired": (
        "Mở tab Mức sẵn sàng (Readiness) để xem các mục có bằng chứng đã hết hạn hoặc bị từ chối.",
        "Cập nhật bằng chứng mới còn hiệu lực hoặc ghi nhận lý do miễn trừ nếu phù hợp.",
        "Bấm tính lại sức khoẻ tài khoản để đóng cảnh báo khi bằng chứng đã hợp lệ.",
    ),
    "readiness_not_ready": (
        "Mở tab Mức sẵn sàng của tài khoản để xem danh sách các lý do đang chặn.",
        "Xử lý từng mục checklist hoặc sự kiện đang mở theo hướng dẫn trên màn hình.",
        "Ghi nhận rà soát thủ công sau khi hoàn tất.",
    ),
    "readiness_unknown": (
        "Mở tab Mức sẵn sàng của tài khoản để bổ sung các thông tin rà soát còn trống.",
        "Đính kèm bằng chứng cho các mục bắt buộc.",
        "Tính lại mức sẵn sàng để xác định rõ trạng thái của tài khoản.",
    ),
    "manual_review_due_or_stale": (
        "Đăng nhập tài khoản Facebook quản lý và rà soát tình trạng tài khoản trên Ads Manager.",
        "Mở tab Tổng quan của tài khoản trên hệ thống và ghi nhận kết quả rà soát thủ công.",
        "Cập nhật trạng thái hoặc thêm sự kiện nếu phát hiện thay đổi mới.",
    ),
    "account_data_stale_or_unknown": (
        "Mở trang chi tiết tài khoản quảng cáo và bấm tính lại mức sẵn sàng.",
        "Kiểm tra các mục checklist cơ bản của tài khoản.",
        "Chạy lại đánh giá sức khoẻ tài khoản sau khi dữ liệu đầu vào đã đầy đủ.",
    ),
    "bm_user_access_drift": (
        "Đăng nhập bằng hồ sơ Facebook giữ quyền Admin BM được liệt kê ở mục 'Hồ sơ FB đăng nhập để xử lý'.",
        "Mở Business Settings → Users → People của BM này để kiểm tra ngay các tài khoản vừa thay đổi.",
        "Nếu là người lạ: gỡ khỏi BM ngay lập tức, kiểm tra lại Admin và đổi mật khẩu + kiểm tra 2FA cho các hồ sơ giữ BM.",
        "Nếu là nhân sự nội bộ: vào mục Kết nối Meta → Người trong BM để bấm 'Xác nhận nối' với hồ sơ Facebook tương ứng.",
    ),
    "account_not_returned_by_latest_discovery": (
        "Đăng nhập tài khoản Facebook quản lý BM và mở Business Settings → Tài khoản quảng cáo.",
        "Kiểm tra xem tài khoản quảng cáo còn thuộc BM và còn được gán cho người đọc Meta hay không.",
        "Nếu tài khoản đã chuyển sang BM khác hoặc ngừng dùng, hãy cập nhật BM hoặc lưu trữ hồ sơ.",
    ),
}

REMEDIATION_CHECKLISTS_BY_SOURCE: dict[AlertSourceType, tuple[str, ...]] = {
    AlertSourceType.HEALTH_EVALUATION_RUN: (
        "Mở tab Sức khoẻ (Health) của tài khoản quảng cáo và bấm tính lại sức khoẻ.",
        "Kiểm tra lịch sử các lần chạy đánh giá (Evaluation Runs) để xem mã lỗi.",
        "Nếu lỗi tiếp diễn, kiểm tra trang Trạng thái hệ thống.",
    ),
    AlertSourceType.DISCOVERY_SWEEP: (
        "Mở trang Kết nối Meta để xem kết quả quét khám phá tài sản mới nhất.",
        "Rà soát các tài khoản quảng cáo mới phát hiện hoặc không còn xuất hiện trong lần quét.",
        "Xác nhận nhập vào danh mục hoặc cập nhật hồ sơ tài khoản Facebook quản lý BM tương ứng.",
    ),
    AlertSourceType.READER_CREDENTIAL: (
        "Mở trang Cài đặt → Quyền đọc Meta để xem trạng thái của kết nối đang báo lỗi hoặc sắp hết hạn.",
        "Đăng nhập đúng tài khoản Facebook đã cấp quyền cho kết nối đó.",
        "Thực hiện kết nối lại (Reconnect) để khôi phục việc đọc chi tiêu và trạng thái tự động.",
    ),
}

DEFAULT_REMEDIATION_CHECKLIST: tuple[str, ...] = (
    "Mở chi tiết cảnh báo và kiểm tra bằng chứng đã ghi nhận trên hệ thống.",
    "Đăng nhập tài khoản Facebook quản lý ở mục 'Đăng nhập để xử lý' để kiểm tra trên Meta.",
    "Thực hiện bước xử lý phù hợp và ghi nhận kết quả vào nhật ký cảnh báo.",
)


def remediation_checklist_for_alert(alert: Any) -> list[str]:
    """Return the deterministic step-by-step remediation checklist for an alert (MINI-SPEC F2)."""
    snapshot = getattr(alert, "source_snapshot_json", None) or {}
    rule_key = snapshot.get("rule_key")
    if isinstance(rule_key, str) and rule_key in REMEDIATION_CHECKLISTS_BY_RULE:
        return list(REMEDIATION_CHECKLISTS_BY_RULE[rule_key])
    source_type = getattr(alert, "source_type", None)
    if source_type in REMEDIATION_CHECKLISTS_BY_SOURCE:
        return list(REMEDIATION_CHECKLISTS_BY_SOURCE[source_type])
    return list(DEFAULT_REMEDIATION_CHECKLIST)
