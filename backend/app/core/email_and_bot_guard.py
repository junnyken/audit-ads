# Strict Email Reputation Guard, Anti-Bot Challenge, and Multi-Tenant Isolation Helper.
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import re
import secrets
import threading
import time
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import WorkspaceRole
from app.core.errors import ValidationError

# Trusted global & regional email providers
TRUSTED_EMAIL_DOMAINS: frozenset[str] = frozenset(
    {
        # Google
        "gmail.com",
        "googlemail.com",
        # Microsoft
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "outlook.com.vn",
        "hotmail.com.vn",
        "live.com.vn",
        # Apple iCloud
        "icloud.com",
        "me.com",
        "mac.com",
        # Yahoo
        "yahoo.com",
        "yahoo.com.vn",
        "ymail.com",
        "rocketmail.com",
        # Proton / Privacy-first reputable
        "proton.me",
        "protonmail.com",
        "pm.me",
        # Zoho / Yandex / GMX / AOL
        "zoho.com",
        "zohomail.com",
        "yandex.com",
        "gmx.com",
        "aol.com",
        # Known Enterprise VN domains
        "matbao.com",
        "matbao.net",
        "matbao.in",
        "tbsupellex.com",
        "fpt.com",
        "fpt.com.vn",
        "viettel.com.vn",
        "vnpt.vn",
        "vng.com.vn",
        "cmc.com.vn",
    }
)

# Verified Vietnam organizational TLD suffixes allowed for legitimate companies
TRUSTED_VN_TLD_SUFFIXES: tuple[str, ...] = (
    ".com.vn",
    ".net.vn",
    ".org.vn",
    ".edu.vn",
    ".gov.vn",
    ".biz.vn",
    ".ac.vn",
    ".pro.vn",
    ".info.vn",
    ".vn",
)

# Known disposable / temporary / fake email domains and substrings
DISPOSABLE_DOMAIN_EXACT: frozenset[str] = frozenset(
    {
        "10minutemail.com",
        "10minutemail.net",
        "10minutemail.org",
        "20minutemail.com",
        "33mail.com",
        "anonaddy.com",
        "anonaddy.me",
        "binkmail.com",
        "bobmail.info",
        "burnermail.io",
        "chammy.info",
        "crazymailing.com",
        "deadaddress.com",
        "despam.it",
        "devnullmail.com",
        "discard.email",
        "discardmail.com",
        "dispostable.com",
        "dodgeit.com",
        "dodgit.com",
        "dropmail.me",
        "duck.com",
        "dump-email.info",
        "e4ward.com",
        "emailias.com",
        "emailigo.de",
        "emailinfive.com",
        "emailmiser.com",
        "emailondeck.com",
        "emailsensei.com",
        "emailtemporario.com.br",
        "emailwarden.com",
        "emailxfer.com",
        "emz.net",
        "enterto.com",
        "ephemail.net",
        "etranquil.com",
        "example.com",
        "example.net",
        "example.org",
        "explodemail.com",
        "fakeinbox.com",
        "fakemail.fr",
        "fakemailgenerator.com",
        "fastacura.com",
        "filzmail.com",
        "fizmail.com",
        "frapmail.com",
        "get1mail.com",
        "get2mail.fr",
        "getairmail.com",
        "getnada.com",
        "getonemail.com",
        "gishpuppy.com",
        "GrR.la",
        "grr.la",
        "guerrillamail.biz",
        "guerrillamail.com",
        "guerrillamail.de",
        "guerrillamail.info",
        "guerrillamail.net",
        "guerrillamail.org",
        "guerrillamailblock.com",
        "harakirimail.com",
        "incognitomail.com",
        "incognitomail.net",
        "incognitomail.org",
        "inboxkitten.com",
        "jetable.com",
        "jetable.net",
        "jetable.org",
        "kasmail.com",
        "koszmail.pl",
        "kurzepost.de",
        "letthemeatspam.com",
        "linshiyouxiang.net",
        "luxusmail.org",
        "mail-temporaire.fr",
        "mail.tm",
        "mail.gw",
        "mailblocks.com",
        "mailcatch.com",
        "maildrop.cc",
        "maileater.com",
        "mailexpire.com",
        "mailfa.tk",
        "mailforspam.com",
        "mailfreeonline.com",
        "mailimate.com",
        "mailin8r.com",
        "mailinater.com",
        "mailinator.com",
        "mailinator.net",
        "mailinator.org",
        "mailinator2.com",
        "mailincubator.com",
        "mailismagic.com",
        "mailme.ir",
        "mailme.lv",
        "mailmetrash.com",
        "mailmoat.com",
        "mailnator.com",
        "mailnesia.com",
        "mailnull.com",
        "mailpoof.com",
        "mailsac.com",
        "mailscrap.com",
        "mailshell.com",
        "mailsiphon.com",
        "mailslite.com",
        "mailtemp.info",
        "mailtothis.com",
        "mailzilla.com",
        "mbx.cc",
        "mega.zik.dj",
        "meltmail.com",
        "messagebeamer.de",
        "mierdamail.com",
        "mintemail.com",
        "mohmal.com",
        "moncourrier.fr.nf",
        "monemail.fr.nf",
        "monmail.fr.nf",
        "mozmail.com",
        "mt2009.com",
        "mt2014.com",
        "mycleaninbox.net",
        "mypartyclip.de",
        "myphantomemail.com",
        "myspaceinc.com",
        "myspaceinc.net",
        "myspacepimpedup.com",
        "mytemp.email",
        "mytempemail.com",
        "mytrashmail.com",
        "nada.email",
        "nada.ltd",
        "neomailbox.com",
        "nepwk.com",
        "nervmich.net",
        "nervtmich.net",
        "netmails.com",
        "netmails.net",
        "netzidiot.de",
        "neverbox.com",
        "no-spam.ws",
        "nobulk.com",
        "noclickemail.com",
        "nogmailspam.info",
        "nomail.xl.cx",
        "nomail2me.com",
        "nomorespamemails.com",
        "nospam.ze.tc",
        "nospam4.us",
        "nospamfor.us",
        "nospamthanks.info",
        "notmailinator.com",
        "nowmymail.com",
        "nurfuerspam.de",
        "nus.edu.sg",
        "nwldx.com",
        "objectmail.com",
        "obobbo.com",
        "oneoffemail.com",
        "onewaymail.com",
        "online.ms",
        "oopi.org",
        "ordinaryamerican.net",
        "otherinbox.com",
        "ourklips.com",
        "outlawspam.com",
        "ovpn.to",
        "owlpic.com",
        "pancakemail.com",
        "pimpedupmyspace.com",
        "pjjkp.com",
        "politikerclub.de",
        "poofy.org",
        "pookmail.com",
        "privacy.net",
        "proxymail.eu",
        "prtnx.com",
        "punkass.com",
        "putthisinyourspamdatabase.com",
        "qq.com",
        "163.com",
        "126.com",
        "mail.ru",
        "bk.ru",
        "inbox.ru",
        "list.ru",
        "quickinbox.com",
        "rcpt.at",
        "recode.me",
        "recursor.net",
        "regbypass.com",
        "regbypass.comsafe-mail.net",
        "rejectmail.com",
        "rklips.com",
        "rmqkr.net",
        "rppkn.com",
        "rtrtr.com",
        "s0ny.net",
        "safe-mail.net",
        "safersignup.de",
        "safetymail.info",
        "safetypost.de",
        "sandelf.de",
        "saynotospams.com",
        "selfdestructingmail.com",
        "sendspamhere.com",
        "sharklasers.com",
        "shiftmail.com",
        "shitmail.me",
        "shortmail.net",
        "sibmail.com",
        "SimpleLogin.co",
        "simplelogin.co",
        "simplelogin.io",
        "skeefmail.com",
        "slaskpost.se",
        "slopsbox.com",
        "smellfear.com",
        "snakemail.com",
        "sneakemail.com",
        "sofimail.com",
        "sofort-mail.de",
        "sogetthis.com",
        "soodonims.com",
        "spam.la",
        "spam.su",
        "spam4.me",
        "spamavert.com",
        "spambob.com",
        "spambob.net",
        "spambob.org",
        "spambog.com",
        "spambog.de",
        "spambog.ru",
        "spambox.info",
        "spambox.irishspringrealty.com",
        "spambox.us",
        "spamcannon.com",
        "spamcannon.net",
        "spamcero.com",
        "spamcon.org",
        "spamcorptastic.com",
        "spamcowboy.com",
        "spamcowboy.net",
        "spamcowboy.org",
        "spamday.com",
        "spamex.com",
        "spamfree24.com",
        "spamfree24.de",
        "spamfree24.eu",
        "spamfree24.info",
        "spamfree24.net",
        "spamfree24.org",
        "spamgourmet.com",
        "spamgourmet.net",
        "spamgourmet.org",
        "spamherelots.com",
        "spamhereplease.com",
        "spamhole.com",
        "spamify.com",
        "spaminator.de",
        "spamkill.info",
        "spaml.com",
        "spaml.de",
        "spammotel.com",
        "spamobox.com",
        "spamoff.de",
        "spamslicer.com",
        "spamspot.com",
        "spamthis.co.uk",
        "spamthisplease.com",
        "spamtrail.com",
        "speed.1s.fr",
        "supergreatmail.com",
        "supermailer.jp",
        "suremail.info",
        "teewars.org",
        "teleworm.com",
        "teleworm.us",
        "temp-mail.org",
        "temp-mail.ru",
        "tempail.com",
        "tempalias.com",
        "tempe-mail.com",
        "tempemail.biz",
        "tempemail.co.za",
        "tempemail.com",
        "tempemail.net",
        "tempinbox.co.uk",
        "tempinbox.com",
        "tempmail.co",
        "tempmail.de",
        "tempmail.eu",
        "tempmail.it",
        "tempmail.net",
        "tempmail.org",
        "tempmail.us",
        "tempmail2.com",
        "tempmaildemo.com",
        "tempmailer.com",
        "tempmailer.de",
        "tempmailo.com",
        "tempomail.fr",
        "temporarily.de",
        "temporarioemail.com.br",
        "temporaryemail.net",
        "temporaryemail.us",
        "temporaryforwarding.com",
        "temporaryinbox.com",
        "temporarymailaddress.com",
        "tempr.email",
        "thanksnospam.info",
        "thankyou2010.com",
        "thisisnotmyrealemail.com",
        "throwawayemailaddress.com",
        "throwawaymail.com",
        "tilien.com",
        "tmailinator.com",
        "tmpmail.net",
        "tmpmail.org",
        "tradermail.info",
        "trash-amil.com",
        "trash-mail.at",
        "trash-mail.com",
        "trash-mail.de",
        "trash2009.com",
        "trashemail.de",
        "trashmail.at",
        "trashmail.com",
        "trashmail.de",
        "trashmail.me",
        "trashmail.net",
        "trashmail.org",
        "trashmail.ws",
        "trashmailer.com",
        "trashymail.com",
        "trashymail.net",
        "trbvm.com",
        "turual.com",
        "twinmail.de",
        "tyldd.com",
        "uggsrock.com",
        "upliftnow.com",
        "uplipht.com",
        "venompen.com",
        "veryrealemail.com",
        "viditag.com",
        "viewcastmedia.com",
        "webm4il.info",
        "wegwerfadresse.de",
        "wegwerfemail.de",
        "wegwerfmail.de",
        "wegwerfmail.net",
        "wegwerfmail.org",
        "wetrainbayarea.com",
        "wh4f.org",
        "whyspam.me",
        "willselfdestruct.com",
        "winemaven.info",
        "wronghead.com",
        "wuzup.net",
        "wuzupmail.net",
        "xagloo.com",
        "xemaps.com",
        "xents.com",
        "xmaily.com",
        "xoxy.net",
        "yep.it",
        "yogamaven.com",
        "yopmail.com",
        "yopmail.fr",
        "yopmail.net",
        "ypmail.webarnak.fr.eu.org",
        "yuurok.com",
        "zehnminutenmail.de",
        "zippymail.info",
        "zoaxe.com",
        "zoemail.org",
    }
)

DISPOSABLE_KEYWORDS: tuple[str, ...] = (
    "tempmail",
    "temp-mail",
    "10minutemail",
    "guerrillamail",
    "mailinator",
    "yopmail",
    "trashmail",
    "throwaway",
    "fakeinbox",
    "fakemail",
    "burnermail",
    "sharklasers",
    "getnada",
    "mohmal",
    "maildrop",
    "dispostable",
    "mailnesia",
    "spamgourmet",
    "wegwerf",
    "minuteinbox",
    "tempinbox",
)

_EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}[a-zA-Z0-9]@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def validate_reputable_registration_email(raw_email: str) -> str:
    # Validate that an email belongs to a reputable provider or verified VN corporate domain.
    email = (raw_email or "").strip().lower()
    if not email or "@" not in email:
        raise ValidationError(
            "Vui lòng nhập địa chỉ email hợp lệ.",
            {"field": "email", "reason": "invalid_format"},
        )

    local_part, domain = email.rsplit("@", 1)

    if "+" in local_part:
        raise ValidationError(
            "Không chấp nhận email phụ chứa ký tự '+' (alias). Vui lòng dùng địa chỉ email chính thức.",
            {"field": "email", "reason": "alias_not_allowed"},
        )

    if ".." in email or not _EMAIL_REGEX.match(email):
        raise ValidationError(
            "Định dạng địa chỉ email không hợp lệ.",
            {"field": "email", "reason": "invalid_format"},
        )

    if len(local_part) < 3 or local_part.isdigit():
        raise ValidationError(
            "Tên tài khoản email trước dấu '@' phải có ít nhất 3 ký tự và không được chỉ gồm chữ số.",
            {"field": "email", "reason": "suspicious_local_part"},
        )

    # 1. Check disposable / fake email blocklist
    if domain in DISPOSABLE_DOMAIN_EXACT or any(kw in domain for kw in DISPOSABLE_KEYWORDS):
        raise ValidationError(
            f"Tên miền email '@{domain}' thuộc danh sách email ảo / tạm thời bị chặn. "
            "Hệ thống chỉ chấp nhận đăng ký bằng email chính thống (Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton, Zoho hoặc tên miền doanh nghiệp .vn).",
            {"field": "email", "reason": "disposable_email_blocked", "domain": domain},
        )

    # 2. Check reputable provider allowlist or verified VN corporate domain
    is_trusted_provider = domain in TRUSTED_EMAIL_DOMAINS
    is_trusted_vn_corp = False
    if not is_trusted_provider:
        for suffix in TRUSTED_VN_TLD_SUFFIXES:
            if domain.endswith(suffix):
                prefix = domain[: -len(suffix)]
                if len(prefix) >= 3 and "." not in prefix and not any(kw in prefix for kw in DISPOSABLE_KEYWORDS):
                    is_trusted_vn_corp = True
                break

    if not (is_trusted_provider or is_trusted_vn_corp):
        raise ValidationError(
            f"Tên miền email '@{domain}' chưa được xác thực nguồn gốc. "
            "Chỉ cho phép đăng ký bằng các nhà cung cấp email uy tín (gmail.com, outlook.com, hotmail.com, live.com, icloud.com, yahoo.com, proton.me, zoho.com) hoặc email doanh nghiệp Việt Nam (.vn, .com.vn).",
            {"field": "email", "reason": "untrusted_email_domain", "domain": domain},
        )

    return email


def validate_strong_password(password: str) -> None:
    if len(password or "") < 8:
        raise ValidationError(
            "Mật khẩu phải có tối thiểu 8 ký tự.",
            {"field": "password", "reason": "password_too_short"},
        )
    has_upper = any(c.isupper() for c in password)
    has_lower = any(c.islower() for c in password)
    has_digit_or_sym = any(c.isdigit() or not c.isalnum() for c in password)
    if not (has_upper and has_lower and has_digit_or_sym):
        raise ValidationError(
            "Mật khẩu phải bao gồm chữ hoa (A-Z), chữ thường (a-z) và ít nhất 1 chữ số hoặc ký tự đặc biệt.",
            {"field": "password", "reason": "password_weak"},
        )


# --------------------------------------------------------------------------- Anti-Bot Captcha Guard

_USED_NONCES_LOCK = threading.Lock()
_USED_NONCES: dict[str, float] = {}
_CHALLENGE_TTL_SECONDS = 300  # 5 minutes
_MIN_HUMAN_SOLVE_SECONDS = 2.0
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _prune_used_nonces(now: float) -> None:
    expired = [k for k, exp in _USED_NONCES.items() if exp <= now]
    for k in expired:
        _USED_NONCES.pop(k, None)


def _render_captcha_svg_data_uri(code: str, math_label: str) -> str:
    rng = random.SystemRandom()
    width, height = 220, 56
    bg_colors = ("#0f172a", "#111827", "#1e1b4b")
    bg = rng.choice(bg_colors)

    lines_svg = []
    stroke_palette = ("#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#ec4899")
    for _ in range(6):
        x1, y1 = rng.randint(4, width - 4), rng.randint(4, height - 4)
        x2, y2 = rng.randint(4, width - 4), rng.randint(4, height - 4)
        col = rng.choice(stroke_palette)
        lines_svg.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="1.4" stroke-opacity="0.45" />'
        )

    dots_svg = []
    for _ in range(18):
        cx, cy = rng.randint(6, width - 6), rng.randint(6, height - 6)
        col = rng.choice(stroke_palette)
        dots_svg.append(f'<circle cx="{cx}" cy="{cy}" r="1.3" fill="{col}" fill-opacity="0.5" />')

    chars_svg = []
    char_palette = ("#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#38bdf8")
    for idx, ch in enumerate(code):
        x = 22 + idx * 36 + rng.randint(-3, 3)
        y = 37 + rng.randint(-4, 4)
        rot = rng.randint(-16, 16)
        col = char_palette[idx % len(char_palette)]
        chars_svg.append(
            f'<text x="{x}" y="{y}" fill="{col}" font-family="monospace" font-size="24" font-weight="bold" '
            f'transform="rotate({rot} {x} {y})">{ch}</text>'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f'<rect width="100%" height="100%" rx="8" fill="{bg}" />'
        + "".join(lines_svg)
        + "".join(dots_svg)
        + "".join(chars_svg)
        + "</svg>"
    )
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def create_bot_challenge() -> dict[str, Any]:
    # Generate a signed visual SVG captcha + math challenge.
    settings = get_settings()
    rng = random.SystemRandom()
    code = "".join(rng.choice(_ALPHABET) for _ in range(5))
    a = rng.randint(6, 19)
    b = rng.randint(3, 14)
    math_sum = str(a + b)
    math_prompt = f"{a} + {b} = ?"

    issued_at = int(time.time())
    nonce = secrets.token_hex(12)

    payload_obj = {
        "n": nonce,
        "iat": issued_at,
        "exp": issued_at + _CHALLENGE_TTL_SECONDS,
        "c_hash": hashlib.sha256(f"{code.upper()}:{math_sum}:{nonce}".encode("utf-8")).hexdigest(),
    }
    payload_bytes = json.dumps(payload_obj, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=")
    sig = hmac.new(settings.jwt_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    challenge_token = f"{payload_b64}.{sig}"

    return {
        "challenge_token": challenge_token,
        "captcha_svg": _render_captcha_svg_data_uri(code, math_prompt),
        "math_question": math_prompt,
        "expires_in_seconds": _CHALLENGE_TTL_SECONDS,
    }


def verify_bot_challenge(
    *,
    challenge_token: str,
    captcha_code: str,
    math_answer: str,
    human_confirmed: bool,
    honeypot: str | None = None,
) -> None:
    # Verify all 4 anti-bot layers: honeypot, human checkbox, timing gate, and signed single-use challenge.
    # Layer 1: Honeypot trap
    if (honeypot or "").strip():
        raise ValidationError(
            "Yêu cầu đăng ký bị từ chối bởi hệ thống chống Bot tự động.",
            {"field": "captcha_code", "reason": "bot_honeypot_triggered"},
        )

    # Layer 2: Human confirmation checkbox
    if not human_confirmed:
        raise ValidationError(
            "Vui lòng tích chọn xác nhận 'Tôi là người thật (Không phải Robot)'.",
            {"field": "human_confirmed", "reason": "human_checkbox_required"},
        )

    token = (challenge_token or "").strip()
    if "." not in token:
        raise ValidationError(
            "Mã phiên xác thực chống Bot không hợp lệ. Vui lòng tải lại mã xác nhận.",
            {"field": "captcha_code", "reason": "invalid_challenge_token"},
        )

    settings = get_settings()
    payload_b64, sig = token.rsplit(".", 1)
    expected_sig = hmac.new(
        settings.jwt_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise ValidationError(
            "Chữ ký bảo mật chống Bot không khớp. Vui lòng bấm đổi mã mới.",
            {"field": "captcha_code", "reason": "invalid_challenge_signature"},
        )

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_obj = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        nonce = str(payload_obj["n"])
        iat = int(payload_obj["iat"])
        exp = int(payload_obj["exp"])
        expected_hash = str(payload_obj["c_hash"])
    except Exception as exc:
        raise ValidationError(
            "Dữ liệu xác thực chống Bot bị lỗi. Vui lòng thử lại.",
            {"field": "captcha_code", "reason": "malformed_challenge"},
        ) from exc

    now = time.time()
    if now > exp:
        raise ValidationError(
            "Mã xác thực chống Bot đã hết hạn (5 phút). Hệ thống đã tạo mã mới, vui lòng nhập lại.",
            {"field": "captcha_code", "reason": "challenge_expired"},
        )

    # Layer 3: Minimum human interaction time (>= 2.0s)
    if (now - iat) < _MIN_HUMAN_SOLVE_SECONDS:
        raise ValidationError(
            "Thao tác gửi biểu mẫu quá nhanh (nghi vấn Bot tự động). Vui lòng kiểm tra lại thông tin và thử lại.",
            {"field": "captcha_code", "reason": "submission_too_fast"},
        )

    # Layer 4: Single-use nonce enforcement + answer verification
    with _USED_NONCES_LOCK:
        _prune_used_nonces(now)
        if nonce in _USED_NONCES:
            raise ValidationError(
                "Mã xác thực chống Bot này đã được sử dụng. Vui lòng đổi mã mới.",
                {"field": "captcha_code", "reason": "challenge_replayed"},
            )
        _USED_NONCES[nonce] = float(exp + 60)

    clean_code = (captcha_code or "").strip().upper()
    clean_math = (math_answer or "").strip()
    actual_hash = hashlib.sha256(f"{clean_code}:{clean_math}:{nonce}".encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual_hash, expected_hash):
        raise ValidationError(
            "Mã xác thực hình ảnh (5 ký tự) hoặc kết quả phép tính chưa chính xác. Vui lòng nhập lại mã mới.",
            {"field": "captcha_code", "reason": "captcha_mismatch"},
        )


# --------------------------------------------------------------------------- Multi-Tenant Isolation Guard


def is_bootstrap_owner_workspace(session: Session, workspace_id: uuid.UUID) -> bool:
    # Return True ONLY if workspace_id belongs to the configured BOOTSTRAP_OWNER_EMAIL.
    settings = get_settings()
    owner_email = (settings.bootstrap_owner_email or "").strip().lower()
    if not owner_email:
        return False
    from app.models.entities import User, WorkspaceMember

    row = (
        session.execute(
            sa.select(WorkspaceMember.id)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.archived_at.is_(None),
                WorkspaceMember.role == WorkspaceRole.OWNER,
                sa.func.lower(User.email) == owner_email,
            )
            .limit(1)
        )
        .scalars()
        .first()
    )
    return row is not None
