"""SSRF-safe live proxy health checker for Chrome Via profiles (HTTP/HTTPS/SOCKS5).

Security invariants:
* Rejects loopback, RFC1918 private, link-local, multicast, reserved, and unspecified IPs BEFORE opening any socket.
* Never logs, raises, or returns proxy usernames or passwords.
* Returns sanitized exit IP, country code/name, city, ISP, and latency in milliseconds.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import ssl
import struct
import time
from datetime import UTC, datetime
from typing import Any

import httpx

_URL_RE = re.compile(
    r"^(?:(http|https|socks5)://)?(?:([^:\s/@]+):([^@\s/]+)@)?([A-Za-z0-9.-]+):(\d{1,5})$",
    re.IGNORECASE,
)
_COLON4_RE = re.compile(r"^([A-Za-z0-9.-]+):(\d{1,5}):([^:\s]+):([^\s]+)$")
_COLON2_RE = re.compile(r"^([A-Za-z0-9.-]+):(\d{1,5})$")


class UnsafeProxyTargetError(ValueError):
    """Raised when a proxy hostname resolves to a non-public IP address."""


def parse_proxy_spec(raw: str | None) -> dict[str, Any] | None:
    clean = (raw or "").strip()
    if not clean or len(clean) > 256:
        return None
    scheme = "http"
    host = ""
    port = 0
    user = ""
    password = ""

    m4 = _COLON4_RE.match(clean)
    if m4:
        host, port, user, password = m4.group(1), int(m4.group(2)), m4.group(3), m4.group(4)
    else:
        m2 = _COLON2_RE.match(clean)
        if m2:
            host, port = m2.group(1), int(m2.group(2))
        else:
            mu = _URL_RE.match(clean)
            if not mu:
                return None
            scheme = (mu.group(1) or "http").lower()
            user = mu.group(2) or ""
            password = mu.group(3) or ""
            host = mu.group(4)
            port = int(mu.group(5))

    if port < 1 or port > 65535 or not host or ".." in host:
        return None

    normalized_key = f"{scheme}://{host.lower()}:{port}"
    masked_label = f"{scheme}://{host.lower()}:{port}" + (" (Auth)" if user else "")
    return {
        "scheme": scheme,
        "host": host.lower(),
        "port": port,
        "user": user,
        "password": password,
        "normalized_key": normalized_key,
        "masked_label": masked_label,
    }


def _is_non_public_ip(ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip_obj.is_loopback
        or ip_obj.is_private
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def _resolve_safe_public_ip(host: str, port: int) -> str:
    try:
        ip_literal = ipaddress.ip_address(host)
        if _is_non_public_ip(ip_literal):
            raise UnsafeProxyTargetError("Proxy nội bộ hoặc loopback bị chặn vì lý do bảo mật (SSRF).")
        return str(ip_literal)
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"Không phân giải được tên miền Proxy ({type(exc).__name__}).") from exc

    if not infos:
        raise ValueError("Không tìm thấy địa chỉ IP cho Proxy.")

    chosen: str | None = None
    for family, _, _, _, sockaddr in infos:
        addr = sockaddr[0]
        ip_obj = ipaddress.ip_address(addr.split("%")[0])
        if _is_non_public_ip(ip_obj):
            raise UnsafeProxyTargetError("Proxy phân giải về IP nội bộ/private — đã chặn để bảo vệ hệ thống.")
        if chosen is None and family == socket.AF_INET:
            chosen = addr
    return chosen or infos[0][4][0]


def _parse_geo_json(data: dict[str, Any]) -> dict[str, str | None]:
    if data.get("ip"):
        conn = data.get("connection") if isinstance(data.get("connection"), dict) else {}
        return {
            "exit_ip": str(data.get("ip") or "").strip()[:64] or None,
            "country_code": str(data.get("country_code") or "").strip()[:8] or None,
            "country_name": str(data.get("country") or "").strip()[:80] or None,
            "city": str(data.get("city") or "").strip()[:80] or None,
            "isp": str(conn.get("isp") or conn.get("org") or "").strip()[:100] or None,
        }
    return {
        "exit_ip": str(data.get("query") or "").strip()[:64] or None,
        "country_code": str(data.get("countryCode") or "").strip()[:8] or None,
        "country_name": str(data.get("country") or "").strip()[:80] or None,
        "city": str(data.get("city") or "").strip()[:80] or None,
        "isp": str(data.get("isp") or data.get("org") or "").strip()[:100] or None,
    }


def _check_socks5(spec: dict[str, Any], target_ip: str, timeout: float) -> dict[str, str | None]:
    sock = socket.create_connection((target_ip, spec["port"]), timeout=timeout)
    try:
        sock.settimeout(timeout)
        user = spec["user"].encode("utf-8")[:255]
        password = spec["password"].encode("utf-8")[:255]
        methods = b"\x02" if user else b"\x00"
        sock.sendall(b"\x05" + bytes([len(methods)]) + methods)
        greeting = sock.recv(2)
        if len(greeting) != 2 or greeting[0] != 5:
            raise OSError("SOCKS5 handshake failed")
        if greeting[1] == 2:
            if not user:
                raise PermissionError("SOCKS5 yêu cầu tài khoản xác thực.")
            sock.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(password)]) + password)
            auth_resp = sock.recv(2)
            if len(auth_resp) != 2 or auth_resp[1] != 0:
                raise PermissionError("Sai Username/Password SOCKS5.")
        elif greeting[1] != 0:
            raise OSError("SOCKS5 method rejected")

        dest_host = b"ipwho.is"
        req = b"\x05\x01\x00\x03" + bytes([len(dest_host)]) + dest_host + struct.pack("!H", 443)
        sock.sendall(req)
        rep = sock.recv(4)
        if len(rep) < 4 or rep[1] != 0:
            raise OSError(f"SOCKS5 connect refused (code={rep[1] if len(rep) > 1 else -1})")
        atyp = rep[3]
        if atyp == 1:
            sock.recv(6)
        elif atyp == 3:
            ln = sock.recv(1)
            if ln:
                sock.recv(ln[0] + 2)
        elif atyp == 4:
            sock.recv(18)

        ctx = ssl.create_default_context()
        with ctx.wrap_socket(sock, server_hostname="ipwho.is") as ssock:
            http_req = (
                b"GET /?fields=success,ip,country,country_code,city,connection HTTP/1.1\r\n"
                b"Host: ipwho.is\r\n"
                b"User-Agent: AdsOps-Proxy-Check/1.0\r\n"
                b"Connection: close\r\n\r\n"
            )
            ssock.sendall(http_req)
            chunks: list[bytes] = []
            while True:
                buf = ssock.recv(4096)
                if not buf:
                    break
                chunks.append(buf)
                if sum(len(c) for c in chunks) > 65536:
                    break
        raw_http = b"".join(chunks).decode("utf-8", errors="ignore")
        body = raw_http.split("\r\n\r\n", 1)[1] if "\r\n\r\n" in raw_http else raw_http
        start_idx = body.find("{")
        end_idx = body.rfind("}")
        if start_idx == -1 or end_idx == -1:
            raise ValueError("Invalid JSON response through SOCKS5")
        data = json.loads(body[start_idx : end_idx + 1])
        return _parse_geo_json(data)
    finally:
        try:
            sock.close()
        except Exception:
            pass


def check_proxy_live(raw_proxy: str, timeout_seconds: float = 6.0) -> dict[str, Any]:
    now_iso = datetime.now(UTC).isoformat()
    spec = parse_proxy_spec(raw_proxy)
    if spec is None:
        return {
            "ok": False,
            "status": "INVALID",
            "ssrf_blocked": False,
            "exit_ip": None,
            "country_code": None,
            "country_name": None,
            "city": None,
            "isp": None,
            "latency_ms": None,
            "normalized_key": "",
            "masked_label": "",
            "error_summary": "Định dạng Proxy không hợp lệ (hỗ trợ IP:Port, IP:Port:User:Pass, hoặc socks5://user:pass@ip:port).",
            "checked_at": now_iso,
        }

    try:
        resolved_ip = _resolve_safe_public_ip(spec["host"], spec["port"])
    except UnsafeProxyTargetError as exc:
        return {
            "ok": False,
            "status": "INVALID",
            "ssrf_blocked": True,
            "exit_ip": None,
            "country_code": None,
            "country_name": None,
            "city": None,
            "isp": None,
            "latency_ms": None,
            "normalized_key": spec["normalized_key"],
            "masked_label": spec["masked_label"],
            "error_summary": str(exc),
            "checked_at": now_iso,
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": "DEAD",
            "ssrf_blocked": False,
            "exit_ip": None,
            "country_code": None,
            "country_name": None,
            "city": None,
            "isp": None,
            "latency_ms": None,
            "normalized_key": spec["normalized_key"],
            "masked_label": spec["masked_label"],
            "error_summary": str(exc),
            "checked_at": now_iso,
        }

    t0 = time.monotonic()
    try:
        if spec["scheme"] == "socks5":
            geo = _check_socks5(spec, resolved_ip, timeout_seconds)
        else:
            auth_part = f"{spec['user']}:{spec['password']}@" if spec["user"] else ""
            proxy_url = f"{spec['scheme']}://{auth_part}{resolved_ip}:{spec['port']}"
            with httpx.Client(
                proxy=proxy_url,
                timeout=timeout_seconds,
                follow_redirects=False,
                verify=True,
            ) as client:
                try:
                    resp = client.get("https://ipwho.is/?fields=success,ip,country,country_code,city,connection")
                    if resp.status_code == 200:
                        geo = _parse_geo_json(resp.json())
                    else:
                        raise RuntimeError(f"HTTP {resp.status_code}")
                except Exception:
                    resp2 = client.get("http://ip-api.com/json/?fields=status,query,country,countryCode,city,isp")
                    if resp2.status_code != 200:
                        raise RuntimeError(f"Proxy HTTP {resp2.status_code}")
                    geo = _parse_geo_json(resp2.json())

        latency_ms = int(round((time.monotonic() - t0) * 1000))
        if not geo.get("exit_ip"):
            raise RuntimeError("Proxy kết nối được nhưng không đọc được IP đầu ra.")
        return {
            "ok": True,
            "status": "LIVE",
            "ssrf_blocked": False,
            "exit_ip": geo["exit_ip"],
            "country_code": geo["country_code"],
            "country_name": geo["country_name"],
            "city": geo["city"],
            "isp": geo["isp"],
            "latency_ms": latency_ms,
            "normalized_key": spec["normalized_key"],
            "masked_label": spec["masked_label"],
            "error_summary": None,
            "checked_at": now_iso,
        }
    except Exception as exc:
        latency_ms = int(round((time.monotonic() - t0) * 1000))
        err_name = type(exc).__name__
        err_msg = f"Proxy không phản hồi hoặc sai User/Pass ({err_name})."
        if "407" in str(exc) or isinstance(exc, PermissionError):
            err_msg = "Sai tài khoản/mật khẩu Proxy (407 Proxy Auth Required)."
        elif "Timeout" in err_name or isinstance(exc, TimeoutError):
            err_msg = f"Proxy quá thời gian phản hồi (> {int(timeout_seconds)}s)."
        return {
            "ok": False,
            "status": "DEAD",
            "ssrf_blocked": False,
            "exit_ip": None,
            "country_code": None,
            "country_name": None,
            "city": None,
            "isp": None,
            "latency_ms": latency_ms,
            "normalized_key": spec["normalized_key"],
            "masked_label": spec["masked_label"],
            "error_summary": err_msg,
            "checked_at": now_iso,
        }
