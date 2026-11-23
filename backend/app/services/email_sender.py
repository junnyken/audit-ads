"""Transactional SMTP email helper for password resets (stdlib smtplib, zero extra deps)."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from typing import Any

logger = logging.getLogger(__name__)


def build_password_reset_url(settings: Any, raw_token: str) -> str:
    """Build password reset link strictly from server-configured public_app_url (never request Host/Origin)."""
    base = (getattr(settings, "public_app_url", "") or "").strip()
    if not base.startswith(("https://", "http://")):
        base = "https://adsops-app.vibe.tinhgon.xyz"
    base = base.rstrip("/")
    return f"{base}/?reset_token={raw_token}"


def send_password_reset_email(
    settings: Any,
    to_email: str,
    reset_url: str,
    *,
    full_name: str = "",
) -> tuple[bool, str | None]:
    """Send password reset email via configured SMTP. Never logs tokens or credentials."""
    if not getattr(settings, "smtp_configured", False):
        return False, "smtp_not_configured"

    host = settings.smtp_host.strip()
    port = int(settings.smtp_port or 587)
    timeout = max(3, int(getattr(settings, "smtp_timeout_seconds", 10) or 10))
    from_addr = settings.smtp_from_email.strip()
    username = (getattr(settings, "smtp_username", "") or "").strip()
    password = getattr(settings, "smtp_password", "") or ""
    use_tls = bool(getattr(settings, "smtp_use_tls", True))

    msg = EmailMessage()
    msg["Subject"] = "[AdsOps Control Center] Đặt lại mật khẩu tài khoản"
    msg["From"] = from_addr
    msg["To"] = to_email
    greeting = f"Chào {full_name.strip()}," if full_name.strip() else "Chào bạn,"
    body = (
        f"{greeting}\n\n"
        "Hệ thống đã nhận yêu cầu đặt lại mật khẩu cho tài khoản AdsOps Control Center của bạn.\n"
        "Liên kết bên dưới chỉ sử dụng 1 lần và có hiệu lực trong 30 phút:\n\n"
        f"{reset_url}\n\n"
        "Nếu bạn không gửi yêu cầu này, hãy bỏ qua email — mật khẩu và phiên đăng nhập hiện tại vẫn an toàn.\n"
    )
    msg.set_content(body)

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=timeout) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=timeout) as smtp:
                smtp.ehlo()
                if use_tls:
                    smtp.starttls()
                    smtp.ehlo()
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        return True, None
    except Exception as exc:
        logger.warning("smtp_password_reset_failed", extra={"error_type": type(exc).__name__})
        return False, type(exc).__name__
