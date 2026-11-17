"""Request rate limiting.

Every prior MINI-SPEC recorded the same follow-up: nothing in this API is rate limited, not
even the login route. A5 noted that the extension is well-behaved "by construction, but that is
politeness, not enforcement". This module is the enforcement.

Three decisions worth stating, because each one is a place this could have gone wrong:

**In-process, not Redis.** The deployment has no Redis and adding one would be a new service,
a new failure mode and a new thing to back up, for a limiter whose only job is to blunt
brute-force and runaway clients. The cost is honest and bounded: the limit is *per process*, so
N API workers permit N times the configured rate. `RATE_LIMIT_PROCESS_COUNT` states how many
workers a deployment runs, and the configured limits are divided by it, so the documented number
is the number an operator actually gets. It is not a distributed limiter and this module never
claims to be one.

**A token bucket, not a fixed window.** A fixed window lets a caller spend the whole allowance
in the last second of one window and the whole allowance in the first second of the next — twice
the intended burst, exactly at the moment an attacker is trying. A bucket refills continuously,
so the average is the limit, and it yields an honest `Retry-After` for free.

**`X-Forwarded-For` is trusted only when told to.** Behind a proxy, `request.client.host` is the
proxy, so every caller would share one bucket and the first brute-force attempt would lock out
the entire deployment. Reading the header without being told a proxy is there is worse: a
client sets the header itself, gets a fresh bucket per request, and the limiter is decorative.
So the number of trusted hops is configuration, defaults to zero, and the address is counted
from the right — the leftmost entries are client-supplied and are never trusted.

Identity, not just address: an authenticated caller is limited by subject, so one operator on a
shared office IP cannot exhaust everyone else's allowance.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

#: Buckets are evicted when idle. The cap is what stops the limiter itself becoming the memory
#: exhaustion it exists to prevent: a caller cycling through spoofed identities can create at
#: most this many, and the oldest are dropped first.
MAX_TRACKED_IDENTITIES = 20_000
#: A bucket that has been full and untouched for this long carries no information — dropping it
#: is indistinguishable from keeping it, because a fresh bucket starts full too.
IDLE_EVICTION_SECONDS = 900.0


@dataclass(frozen=True)
class RateLimitPolicy:
    """`limit` requests per `window_seconds`, allowing a burst of `limit`."""

    name: str
    limit: int
    window_seconds: float

    def __post_init__(self) -> None:
        if self.limit <= 0:
            raise ValueError("limit must be positive")
        if self.window_seconds <= 0:
            raise ValueError("window_seconds must be positive")

    @property
    def refill_per_second(self) -> float:
        return self.limit / self.window_seconds

    def scaled(self, process_count: int) -> RateLimitPolicy:
        """Divide the allowance across the processes that will each hold their own buckets.

        Integer division floors, but never below 1: a policy must not silently become
        "no requests allowed" because someone configured more workers than the limit.
        """
        if process_count <= 1:
            return self
        return RateLimitPolicy(
            name=self.name,
            limit=max(1, self.limit // process_count),
            window_seconds=self.window_seconds,
        )


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    policy_name: str
    limit: int
    remaining: int
    #: Seconds until one token is available. Zero when the request was allowed.
    retry_after_seconds: int


class RateLimiter:
    """A thread-safe token bucket per (policy, identity).

    The clock is injectable so tests can prove refill behaviour without sleeping — a limiter
    tested only by wall-clock sleeps is a limiter whose window is never actually checked.
    """

    def __init__(self, *, clock=time.monotonic) -> None:
        self._clock = clock
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        self._lock = threading.Lock()

    def check(self, policy: RateLimitPolicy, identity: str) -> RateLimitDecision:
        """Consume one token if available. Never raises; a limiter that can fail closed on its
        own bookkeeping would be an outage of its own making."""
        now = self._clock()
        key = (policy.name, identity)
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                self._evict_if_needed(now)
                bucket = _Bucket(tokens=float(policy.limit), updated_at=now)
                self._buckets[key] = bucket
            else:
                elapsed = max(0.0, now - bucket.updated_at)
                bucket.tokens = min(
                    float(policy.limit), bucket.tokens + elapsed * policy.refill_per_second
                )
                bucket.updated_at = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return RateLimitDecision(
                    allowed=True,
                    policy_name=policy.name,
                    limit=policy.limit,
                    remaining=int(bucket.tokens),
                    retry_after_seconds=0,
                )

            needed = 1.0 - bucket.tokens
            # Always at least one second: a Retry-After of 0 invites an immediate retry, which
            # is the behaviour the limit exists to stop.
            retry_after = max(1, int(needed / policy.refill_per_second) + 1)
            return RateLimitDecision(
                allowed=False,
                policy_name=policy.name,
                limit=policy.limit,
                remaining=0,
                retry_after_seconds=retry_after,
            )

    def _evict_if_needed(self, now: float) -> None:
        """Caller holds the lock."""
        if len(self._buckets) < MAX_TRACKED_IDENTITIES:
            return
        cutoff = now - IDLE_EVICTION_SECONDS
        stale = [key for key, bucket in self._buckets.items() if bucket.updated_at < cutoff]
        for key in stale:
            del self._buckets[key]
        if len(self._buckets) < MAX_TRACKED_IDENTITIES:
            return
        # Still full of active buckets: drop the least recently used quarter. Dropping a bucket
        # is generous to that caller, never punitive to another, so this cannot lock anyone out.
        ordered = sorted(self._buckets.items(), key=lambda item: item[1].updated_at)
        for key, _ in ordered[: max(1, len(ordered) // 4)]:
            del self._buckets[key]

    def reset(self) -> None:
        """Drop all state. For tests and for nothing else."""
        with self._lock:
            self._buckets.clear()


def client_address(
    *,
    peer: str | None,
    forwarded_for: str | None,
    trusted_proxy_hops: int,
) -> str:
    """The caller's address, or a stable placeholder.

    With `trusted_proxy_hops == 0` the header is ignored entirely. Otherwise the address is
    counted from the **right**: the rightmost entry was appended by the nearest proxy and is
    the only one it observed directly, while everything further left was supplied by whoever
    came before — including, at the far left, the client itself.
    """
    if trusted_proxy_hops > 0 and forwarded_for:
        parts = [part.strip() for part in forwarded_for.split(",") if part.strip()]
        if parts:
            index = len(parts) - trusted_proxy_hops
            # Fewer entries than configured hops means the chain is shorter than expected.
            # Take the leftmost rather than indexing past the start; it is the most
            # conservative reading available.
            return parts[max(0, index)]
    return peer or "unknown"
