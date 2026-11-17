"""Shared batch-engine primitives for A7 (`meta_account_creation.py`, `meta_access_share.py`):
`preview_hash` and bounded, lease-aware sequential processing.

`preview_hash` is the guardrail against a UI/request mismatch (mini-spec A7): it is computed
over the batch's own confirmed content, so if an item changes between the operator seeing a
preview and confirming it, the hash the client sends no longer matches what the server computes
now, and confirmation is refused with a 409 rather than silently running a different batch than
what was shown.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.errors import ConflictError

#: A crashed worker leaves an item `running` forever unless something reclaims it. Any item
#: still `running` after this long is treated as an abandoned lease, not a live attempt — A7
#: guardrail "queue crash → lease recovery".
LEASE_TIMEOUT = timedelta(minutes=2)

#: Retry is bounded and only for the failure codes `meta_provider.RETRYABLE_FAILURE_CODES`
#: names as safe to retry — permission/billing/policy/invalid-request errors never reach this
#: budget because they are never marked retryable in the first place.
MAX_RETRIES = 3


def assert_within_pilot_cap(provider: Any, queued_count: int) -> None:
    """Refuse an oversized batch **before** the first real write leaves the process.

    Lives here rather than in each engine because all three would otherwise carry their own copy
    of a rule whose whole value is being impossible to miss.

    Only binds when the provider says its writes are real. A fake write costs nothing and repeats
    freely; a real ad account cannot be un-created, and a Business Manager has a finite account
    quota, so the first live run is a pilot of exactly one. Deliberately checked at run time, not
    at draft time: a draft written before the cap existed must still be stopped.
    """
    if not getattr(provider, "writes_are_real", False):
        return
    cap = get_settings().meta_write_pilot_max_items
    if queued_count > cap:
        raise ConflictError(
            f"This batch has {queued_count} items to run and the live-write pilot limit is "
            f"{cap}. Run a smaller batch, or raise the limit deliberately once the pilot has "
            f"been checked in Business Settings.",
            details={"code": "pilot_limit_exceeded", "queued": queued_count, "limit": cap},
        )


def compute_preview_hash(items: Iterable[dict[str, Any]]) -> str:
    """Deterministic over item content and order. Not a security boundary by itself — it is
    paired with the operator's own confirm action, not used in place of authorization."""
    canonical = json.dumps(list(items), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def is_lease_expired(last_attempted_at: datetime | None, *, now: datetime | None = None) -> bool:
    if last_attempted_at is None:
        return False
    now = now or datetime.now(UTC)
    return now - last_attempted_at > LEASE_TIMEOUT
