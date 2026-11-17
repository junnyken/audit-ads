"""The credential vault — O4. **The only module in this backend that may encrypt or decrypt.**

What it protects: a Meta reader credential the product itself obtained from Meta's Facebook Login
for Business flow (rule 1's single exception). Nothing a person typed, pasted or posted ever comes
through here — `StrictPayload` still refuses every credential-named field.

Shape borrowed from `tracking-audit-os` (`app/core/secret_encryption.py`), read-only:

* **One Fernet key** (AES-128-CBC + HMAC-SHA256) from server configuration,
  `CREDENTIAL_VAULT_KEY`. Missing or malformed → `VaultNotConfiguredError`. There is **no
  plaintext fallback** of any kind: a vault that cannot encrypt refuses to store.
* A ciphertext the current key cannot open → `SecretDecryptionError`. The caller treats that as
  "this credential is unusable" (`vault_unavailable`), never guesses, never falls back to another
  identity (rule 40).
* The same key signs the OAuth `state` for the Login round trip, with a TTL enforced when it is
  read back (`Fernet.decrypt(ttl=…)`). The state carries no secret: workspace, user, label, an
  optional Business Manager id, an optional credential id for a reconnect, and a nonce.

Who may call `decrypt_secret`: `meta_real_provider.resolve_reader` and nothing else — a test pins
it by name. No value handled here is logged, raised in a message, or returned to a route.
"""
from __future__ import annotations

import json

from cryptography.fernet import Fernet, InvalidToken

#: The OAuth round trip: ten minutes from "Connect" to Meta's redirect back.
STATE_TTL_SECONDS = 600


class VaultNotConfiguredError(Exception):
    """`CREDENTIAL_VAULT_KEY` is missing or is not a Fernet key. The vault does nothing."""


class SecretDecryptionError(Exception):
    """The ciphertext does not open with the configured key (key changed, or row damaged)."""


class StateInvalidError(Exception):
    """The OAuth `state` is expired, tampered with, or was signed by another key."""


def _fernet(settings) -> Fernet:
    key = (getattr(settings, "credential_vault_key", "") or "").strip()
    if not key:
        raise VaultNotConfiguredError("The credential vault has no key configured.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        # The exception text of a malformed key can echo it; it is dropped on purpose.
        raise VaultNotConfiguredError("The credential vault key is not a valid Fernet key.") from None


def vault_configured(settings) -> bool:
    """A boolean capability. Never the key."""
    try:
        _fernet(settings)
    except VaultNotConfiguredError:
        return False
    return True


def encrypt_secret(settings, plaintext: str) -> str:
    """Ciphertext as text, for `meta_reader_credentials.encrypted_secret`. Refuses an empty
    plaintext: an empty credential stored as though it were one would authenticate as nobody."""
    if not plaintext:
        raise ValueError("Refusing to store an empty credential.")
    return _fernet(settings).encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(settings, ciphertext: str) -> str:
    """Only `resolve_reader` calls this. The plaintext lives for one provider call chain."""
    if not ciphertext:
        raise SecretDecryptionError("There is no stored ciphertext to open.")
    fernet = _fernet(settings)
    try:
        return fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        raise SecretDecryptionError("The stored credential cannot be opened with the configured key.") from None


def sign_state(settings, payload: dict) -> str:
    """A short-lived, tamper-evident `state`. The payload must not carry a secret — it is
    encrypted only as a side effect of Fernet's format, and a test pins what it holds."""
    return _fernet(settings).encrypt(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")


def verify_state(settings, state: str, *, ttl_seconds: int | None = None) -> dict:
    """The payload, or `StateInvalidError`. Never `None` for a caller to fall back on."""
    if ttl_seconds is None:
        ttl_seconds = STATE_TTL_SECONDS
    if not state:
        raise StateInvalidError("No state was returned.")
    try:
        fernet = _fernet(settings)
    except VaultNotConfiguredError:
        raise StateInvalidError("The state cannot be checked without the vault key.") from None
    try:
        raw = fernet.decrypt(state.encode("ascii"), ttl=ttl_seconds)
        payload = json.loads(raw.decode("utf-8"))
    except (InvalidToken, ValueError, UnicodeError):
        raise StateInvalidError("The state is expired or not valid.") from None
    if not isinstance(payload, dict):
        raise StateInvalidError("The state is not valid.")
    return payload
