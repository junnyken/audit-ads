"""Hardcoded HTTPS outbound transport for Workspace BYOK AI providers (Gemini / OpenAI / Claude).

Security boundaries:
* Only hardcoded HTTPS API base URLs are permitted (zero user-supplied URLs -> SSRF-safe).
* Provider keys are passed via request headers (never URL query strings).
* Never logs, echoes, or raises raw provider keys.
"""
from __future__ import annotations

import contextlib
import json
import re
import urllib.error
import urllib.request
from typing import Any

SUPPORTED_AI_PROVIDERS = ("gemini", "openai", "claude")

DEFAULT_MODELS_BY_PROVIDER: dict[str, str] = {
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4o-mini",
    "claude": "claude-3-5-haiku-latest",
}

_SAFE_MODEL_RE = re.compile(r"^[a-zA-Z0-9._-]{2,64}$")


def normalize_provider(raw: str | None) -> str:
    p = (raw or "").strip().lower()
    return p if p in SUPPORTED_AI_PROVIDERS else "gemini"


def normalize_model(provider: str, raw_model: str | None) -> str:
    m = (raw_model or "").strip()
    if m and _SAFE_MODEL_RE.match(m):
        return m
    return DEFAULT_MODELS_BY_PROVIDER[normalize_provider(provider)]


def _scrub_key(text: str, key: str) -> str:
    if not text:
        return ""
    if key and len(key) >= 4:
        return text.replace(key, "[REDACTED]")
    return text


def call_ai_provider_chat(
    *,
    provider: str,
    model: str,
    provider_key: str,
    system_prompt: str,
    user_prompt: str,
    max_output_tokens: int = 900,
    timeout: float = 20.0,
) -> dict[str, Any]:
    norm_provider = normalize_provider(provider)
    norm_model = normalize_model(norm_provider, model)
    clean_key = (provider_key or "").strip()
    if not clean_key:
        return {"ok": False, "error_summary": "Chưa cấu hình API Key cho nhà cung cấp AI."}

    if norm_provider == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{norm_model}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": clean_key,
        }
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": max_output_tokens,
            },
        }
    elif norm_provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {clean_key}",
        }
        payload = {
            "model": norm_model,
            "temperature": 0.4,
            "max_tokens": max_output_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
    else:  # claude
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": clean_key,
            "anthropic-version": "2023-06-01",
        }
        payload = {
            "model": norm_model,
            "max_tokens": max_output_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }

    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_body = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw_body)
    except urllib.error.HTTPError as exc:
        err_body = ""
        with contextlib.suppress(Exception):
            err_body = exc.read().decode("utf-8", errors="replace")[:220]
        return {
            "ok": False,
            "error_summary": _scrub_key(f"HTTP {exc.code} từ {norm_provider}: {err_body or exc.reason}", clean_key),
        }
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return {
            "ok": False,
            "error_summary": _scrub_key(f"Không thể kết nối tới {norm_provider}: {type(exc).__name__}", clean_key),
        }

    text = ""
    try:
        if norm_provider == "gemini":
            candidates = parsed.get("candidates") or []
            parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
            text = "\n".join(str(p.get("text") or "") for p in parts if p.get("text")).strip()
        elif norm_provider == "openai":
            choices = parsed.get("choices") or []
            text = str(((choices[0].get("message") or {}).get("content")) or "").strip() if choices else ""
        else:
            content_blocks = parsed.get("content") or []
            text = "\n".join(str(b.get("text") or "") for b in content_blocks if b.get("type") == "text").strip()
    except (IndexError, KeyError, TypeError, AttributeError):
        text = ""

    if not text:
        return {"ok": False, "error_summary": f"Nhà cung cấp {norm_provider} trả về nội dung rỗng."}

    return {"ok": True, "text": text, "provider": norm_provider, "model": norm_model}
