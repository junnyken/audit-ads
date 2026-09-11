"""A7 §"Meta API chưa sẵn sàng vẫn build được" — the provider boundary.

Mirrors A3's `NotificationTransport`/`FakeNotificationTransport` pattern exactly: a narrow
`Protocol` above the line is deterministic and testable; a real implementation below it is a
network call automated tests never make and this module does not yet contain (mini-spec: "A7
không tự động gọi Meta thật khi bạn chưa confirm batch" — and no real provider is wired at all
until there is a real Meta App, approved permissions, and a token in server config, mirroring
CLAUDE.md rule 18's "token lives only in server configuration" boundary for Telegram).

`FakeMetaBusinessProvider` is what the test suite and any local pilot use. `queue_*_result` lets
a test stage a specific outcome so retry, unknown-status and reconciliation paths are exercised
for real rather than merely asserted about.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum

from app.core.enums import CoverageStatus


class MetaFailureCode(str, Enum):
    PERMISSION_MISSING = "permission_missing"
    BILLING_REQUIRED = "billing_required"
    TOKEN_EXPIRED = "token_expired"
    NOT_SUPPORTED = "not_supported"
    #: A10. The call succeeded and carried nothing — no Business Manager id is configured, or
    #: the configured one resolved to nothing. Distinct from `PERMISSION_MISSING`, which means
    #: Meta actively refused, and never produced by the batch engine (so it is not retryable).
    NOT_CONFIGURED = "not_configured"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    PROVIDER_SERVER_ERROR = "provider_server_error"
    INVALID_REQUEST = "invalid_request"
    UNSUPPORTED_ROLE = "unsupported_role"
    UNKNOWN_ERROR = "unknown_error"


#: A create/share request has a real side effect. A timeout during one is ambiguous — the
#: request may have succeeded server-side — so it is never in this set: mini-spec A7 says a
#: timed-out item becomes `unknown` and waits for reconciliation, not a blind retry that could
#: create a duplicate account or duplicate grant.
RETRYABLE_FAILURE_CODES = frozenset(
    {MetaFailureCode.RATE_LIMITED, MetaFailureCode.PROVIDER_SERVER_ERROR}
)


@dataclass(frozen=True)
class CapabilityCheck:
    list_business_managers: bool
    create_ad_account: bool
    share_ad_account_access: bool
    #: A8. Defaults `True` so every existing 3-positional-arg call site (tests included) keeps
    #: meaning "fully available" rather than silently gaining a false capability.
    share_pixel_access: bool = True
    #: Present only when at least one capability is false — a safe code, never a raw provider body.
    reason: MetaFailureCode | None = None


@dataclass(frozen=True)
class CreateAccountRequest:
    """What this product asks a provider to create.

    Shaped against the fake provider in A7, which accepted anything; A10.2 checked it against
    Meta's documented `POST /{business-id}/adaccount` and found three mismatches worth naming:

    * `timezone_id` is what Meta wants — an **integer** timezone identifier. `timezone` here is a
      free-text operator note and is never sent; sending a guessed id would stamp a permanent
      artifact with a value nobody chose.
    * `country` is not a parameter Meta accepts at all. It is kept because A1's registry record
      uses it, and dropping a field operators already fill in would lose information.
    * `end_advertiser`, `media_agency` and `partner` are required by Meta but are plumbing rather
      than operator choices, so the provider derives them — see `meta_real_provider.py`.
    """

    business_manager_external_id: str
    name: str
    currency: str
    country: str | None
    timezone: str | None
    idempotency_key: str
    #: Meta's integer timezone identifier. `None` means "not supplied", which a real provider
    #: must refuse rather than guess.
    timezone_id: int | None = None


@dataclass(frozen=True)
class CreateAccountResult:
    #: "succeeded" | "failed" | "unknown" — never anything else (mini-spec's own status set).
    status: str
    external_account_id: str | None = None
    failure_code: MetaFailureCode | None = None
    #: A short, safe sentence. Never a provider response body.
    failure_summary: str | None = None

    @property
    def retryable(self) -> bool:
        return self.failure_code in RETRYABLE_FAILURE_CODES


@dataclass(frozen=True)
class ShareAccessRequest:
    source_external_account_id: str
    recipient_reference: str
    role: str
    idempotency_key: str


@dataclass(frozen=True)
class ShareAccessResult:
    status: str
    access_grant_reference: str | None = None
    failure_code: MetaFailureCode | None = None
    failure_summary: str | None = None

    @property
    def retryable(self) -> bool:
        return self.failure_code in RETRYABLE_FAILURE_CODES


@dataclass(frozen=True)
class SharePixelRequest:
    """A8: reuses A7's shape exactly — a Pixel shared onto one ad account per item, batched the
    same way A7 shares access onto one account per item."""

    source_external_pixel_id: str
    target_ad_account_external_id: str
    idempotency_key: str


@dataclass(frozen=True)
class SharePixelResult:
    status: str
    access_grant_reference: str | None = None
    failure_code: MetaFailureCode | None = None
    failure_summary: str | None = None

    @property
    def retryable(self) -> bool:
        return self.failure_code in RETRYABLE_FAILURE_CODES


class MetaWriteNotEnabled(RuntimeError):
    """Raised by a provider that will not attempt a write.

    Lives here, on the interface, rather than beside the one implementation that raises it: the
    batch engines need to distinguish it from a genuine provider crash, and they should not have
    to import the real provider to do so. They previously could not, so a blanket
    `except Exception` turned this refusal into `unknown` — the state reserved for "this may have
    succeeded server-side" — which is the opposite of what a refusal means.

    Deliberately an exception rather than a failed result: a result would flow into the retry
    machinery as though the attempt had really happened. It did not, and it must be loud.
    """


@dataclass(frozen=True)
class DiscoveredAsset:
    """One asset a provider returned, normalised and stripped to allowlisted fields.

    `external_id` is already canonical (see `canonical_external_id`), because Meta writes an ad
    account as `act_123` on one field and `123` on another, and the registry stores whichever
    form an operator typed. Comparing the raw strings would report every account as both missing
    from the registry *and* missing from discovery — two false conclusions from one mismatch.
    """

    external_id: str
    name: str
    #: Which Graph edge produced this. Kept because "owned" and "client" ad accounts are
    #: different edges, and a run that read only one of them has not seen the whole BM.
    source_edge: str
    safe_metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class EdgeOutcome:
    """What happened on one edge. `truncated` means the item cap stopped the read early —
    a bounded read, not a complete one."""

    edge: str
    ok: bool
    pages_read: int = 0
    #: Rows this edge returned, before cross-edge de-duplication. Recorded per edge because the
    #: union count alone cannot answer "which edge contributed nothing, and was that because it
    #: is empty or because it was never read".
    items: int = 0
    truncated: bool = False
    failure_code: MetaFailureCode | None = None


@dataclass(frozen=True)
class AssetDiscovery:
    """The result of reading one asset type for one Business Manager.

    `complete` is derived, never assigned. A10 shipped a bug where a capability was set from
    transport success alone; the same mistake here would let a run that failed an edge, or hit
    its cap, still be treated as a full inventory — and "absent from a full inventory" is what
    licenses `missing_from_latest_discovery`. Coverage is part of completeness, not just the
    absence of errors.
    """

    assets: tuple[DiscoveredAsset, ...] = ()
    edges: tuple[EdgeOutcome, ...] = ()
    #: The edges this asset type must cover before absence from the result means anything.
    #: Recorded with the run, so adding an edge later invalidates old coverage instead of
    #: silently reinterpreting it as though the new edge had always been read.
    required_edges: tuple[str, ...] = ()

    @property
    def coverage_status(self) -> CoverageStatus:
        """How much was actually seen. Deliberately not derived from "did anything error":
        an edge nobody asked for raises no error at all, and that is the case that produces a
        confidently wrong "missing"."""
        if not self.edges:
            return CoverageStatus.NOT_ATTEMPTED

        codes = {edge.failure_code for edge in self.edges if edge.failure_code is not None}
        if codes & {MetaFailureCode.PERMISSION_MISSING, MetaFailureCode.NOT_SUPPORTED}:
            return CoverageStatus.INCOMPLETE
        if MetaFailureCode.UNKNOWN_ERROR in codes:
            return CoverageStatus.UNKNOWN
        if codes & {
            MetaFailureCode.RATE_LIMITED,
            MetaFailureCode.PROVIDER_SERVER_ERROR,
            MetaFailureCode.TIMEOUT,
        } or any(edge.truncated for edge in self.edges):
            return CoverageStatus.PARTIAL
        if codes:
            return CoverageStatus.UNKNOWN

        answered = {edge.edge for edge in self.edges if edge.ok}
        if any(required not in answered for required in self.required_edges):
            return CoverageStatus.INCOMPLETE
        return CoverageStatus.COMPLETE

    @property
    def complete(self) -> bool:
        """The single gate on concluding anything is absent."""
        return self.coverage_status == CoverageStatus.COMPLETE

    @property
    def reason(self) -> MetaFailureCode | None:
        """The first real failure. `None` when coverage fell short without an error — which is
        itself the dangerous case, and why `coverage_status` is what callers must check."""
        for edge in self.edges:
            if edge.failure_code is not None:
                return edge.failure_code
        return None


def _count_from(assets: list[DiscoveredAsset], edge: str) -> int:
    """How many of these assets that edge produced.

    The fake provider used to leave `items` at its default, so every per-edge count rendered as
    zero while the total was right — visible only by looking at the page. That breakdown is the
    evidence behind a coverage claim, so a fake that always reports zero makes the fake
    environment useless for checking exactly the thing it exists to check.
    """
    return sum(1 for asset in assets if asset.source_edge == edge)


class MetaBusinessProvider:
    """Protocol-shaped base rather than `typing.Protocol` so `isinstance` checks and a shared
    docstring are available in one place; every method is abstract in intent."""

    name: str

    #: Whether a write through this provider would land on a real Business Manager. The batch
    #: engines cap how many items may run in one batch when this is true — a fake write is free
    #: to repeat, a real ad account cannot be un-created.
    #:
    #: Declared on the interface rather than checked with `isinstance` so a future provider has
    #: to answer the question explicitly, and so the batch engines never import the real one.
    writes_are_real: bool = False

    def discover_ad_accounts(self, business_id: str) -> AssetDiscovery:  # pragma: no cover
        raise NotImplementedError

    def discover_pixels(self, business_id: str) -> AssetDiscovery:  # pragma: no cover
        raise NotImplementedError

    def check_capability(self) -> CapabilityCheck:  # pragma: no cover - interface
        raise NotImplementedError

    def list_business_managers(self) -> list[dict[str, str]]:  # pragma: no cover - interface
        raise NotImplementedError

    def create_ad_account(self, request: CreateAccountRequest) -> CreateAccountResult:  # pragma: no cover
        raise NotImplementedError

    def share_ad_account_access(self, request: ShareAccessRequest) -> ShareAccessResult:  # pragma: no cover
        raise NotImplementedError

    def share_pixel_access(self, request: SharePixelRequest) -> SharePixelResult:  # pragma: no cover
        raise NotImplementedError

    def reconcile_create(self, idempotency_key: str) -> CreateAccountResult | None:  # pragma: no cover
        """Out-of-band "did this actually happen?" check for an item stuck `unknown` after a
        timeout — distinct from calling `create_ad_account` again, which mini-spec A7
        deliberately forbids for a timed-out item (a blind retry could double-create). Returns
        `None` when the provider itself cannot resolve the ambiguity — the mini-spec's "nếu
        không reconcile được thì bạn kiểm tra tay" path."""
        raise NotImplementedError


@dataclass
class FakeMetaBusinessProvider(MetaBusinessProvider):
    name: str = "fake"
    created: list[CreateAccountRequest] = field(default_factory=list)
    shared: list[ShareAccessRequest] = field(default_factory=list)
    pixels_shared: list[SharePixelRequest] = field(default_factory=list)
    business_managers: list[dict[str, str]] = field(default_factory=list)
    capability: CapabilityCheck = field(
        default_factory=lambda: CapabilityCheck(True, True, True, True)
    )
    _staged_create: list[CreateAccountResult] = field(default_factory=list)
    _staged_share: list[ShareAccessResult] = field(default_factory=list)
    _staged_pixel_share: list[SharePixelResult] = field(default_factory=list)
    #: Idempotency replay: the same key must always return the same result, exactly as a real
    #: API's own idempotency contract would — a test can otherwise hide a real replay bug.
    _create_by_key: dict[str, CreateAccountResult] = field(default_factory=dict)
    _share_by_key: dict[str, ShareAccessResult] = field(default_factory=dict)
    _pixel_share_by_key: dict[str, SharePixelResult] = field(default_factory=dict)
    #: What `reconcile_create` answers for a given key — staged explicitly per test, since a
    #: real reconciliation call is a genuinely separate provider capability, not a replay.
    _reconcile_by_key: dict[str, CreateAccountResult | None] = field(default_factory=dict)
    #: A10.1 discovery. The default inventory a discovery returns when nothing is staged.
    discovered_ad_accounts: list[DiscoveredAsset] = field(default_factory=list)
    discovered_pixels: list[DiscoveredAsset] = field(default_factory=list)
    _staged_ad_account_discovery: list[AssetDiscovery] = field(default_factory=list)
    _staged_pixel_discovery: list[AssetDiscovery] = field(default_factory=list)
    #: Every provider method a test caused, in order, as `(method, argument)`. A10.1 asserts
    #: against this that a discovery run never reached a write method.
    calls: list[tuple[str, str]] = field(default_factory=list)

    def queue_create_result(self, result: CreateAccountResult) -> None:
        self._staged_create.append(result)

    def queue_ad_account_discovery(self, discovery: AssetDiscovery) -> None:
        self._staged_ad_account_discovery.append(discovery)

    def queue_pixel_discovery(self, discovery: AssetDiscovery) -> None:
        self._staged_pixel_discovery.append(discovery)

    def stage_reconcile_result(self, idempotency_key: str, result: CreateAccountResult | None) -> None:
        self._reconcile_by_key[idempotency_key] = result

    def queue_share_result(self, result: ShareAccessResult) -> None:
        self._staged_share.append(result)

    def queue_pixel_share_result(self, result: SharePixelResult) -> None:
        self._staged_pixel_share.append(result)

    def discover_ad_accounts(self, business_id: str) -> AssetDiscovery:
        self.calls.append(("discover_ad_accounts", business_id))
        if self._staged_ad_account_discovery:
            return self._staged_ad_account_discovery.pop(0)
        return AssetDiscovery(
            assets=tuple(self.discovered_ad_accounts),
            edges=(
                EdgeOutcome(
                    "owned_ad_accounts", ok=True, pages_read=1,
                    items=_count_from(self.discovered_ad_accounts, "owned_ad_accounts"),
                ),
                EdgeOutcome(
                    "client_ad_accounts", ok=True, pages_read=1,
                    items=_count_from(self.discovered_ad_accounts, "client_ad_accounts"),
                ),
            ),
            required_edges=("owned_ad_accounts", "client_ad_accounts"),
        )

    def discover_pixels(self, business_id: str) -> AssetDiscovery:
        self.calls.append(("discover_pixels", business_id))
        if self._staged_pixel_discovery:
            return self._staged_pixel_discovery.pop(0)
        return AssetDiscovery(
            assets=tuple(self.discovered_pixels),
            edges=(
                EdgeOutcome(
                    "adspixels", ok=True, pages_read=1,
                    items=_count_from(self.discovered_pixels, "adspixels"),
                ),
            ),
            required_edges=("adspixels",),
        )

    def check_capability(self) -> CapabilityCheck:
        self.calls.append(("check_capability", ""))
        return self.capability

    def list_business_managers(self) -> list[dict[str, str]]:
        self.calls.append(("list_business_managers", ""))
        return list(self.business_managers)

    def create_ad_account(self, request: CreateAccountRequest) -> CreateAccountResult:
        self.calls.append(("create_ad_account", request.idempotency_key))
        if request.idempotency_key in self._create_by_key:
            return self._create_by_key[request.idempotency_key]
        if self._staged_create:
            result = self._staged_create.pop(0)
        else:
            result = CreateAccountResult(
                status="succeeded", external_account_id=f"fake_act_{uuid.uuid4().hex[:12]}"
            )
        self.created.append(request)
        # Only a terminal outcome is remembered under this key. A retryable failure means the
        # server never durably completed anything for this key, so a real API's own idempotency
        # contract lets a retry with the same key proceed for real — caching it here would make
        # every retry replay the same failure forever, which is not what "retryable" means.
        if not result.retryable:
            self._create_by_key[request.idempotency_key] = result
        return result

    def share_ad_account_access(self, request: ShareAccessRequest) -> ShareAccessResult:
        self.calls.append(("share_ad_account_access", request.idempotency_key))
        if request.idempotency_key in self._share_by_key:
            return self._share_by_key[request.idempotency_key]
        if self._staged_share:
            result = self._staged_share.pop(0)
        else:
            result = ShareAccessResult(
                status="succeeded", access_grant_reference=f"fake_grant_{uuid.uuid4().hex[:12]}"
            )
        self.shared.append(request)
        if not result.retryable:
            self._share_by_key[request.idempotency_key] = result
        return result

    def share_pixel_access(self, request: SharePixelRequest) -> SharePixelResult:
        self.calls.append(("share_pixel_access", request.idempotency_key))
        if request.idempotency_key in self._pixel_share_by_key:
            return self._pixel_share_by_key[request.idempotency_key]
        if self._staged_pixel_share:
            result = self._staged_pixel_share.pop(0)
        else:
            result = SharePixelResult(
                status="succeeded", access_grant_reference=f"fake_pixel_grant_{uuid.uuid4().hex[:12]}"
            )
        self.pixels_shared.append(request)
        if not result.retryable:
            self._pixel_share_by_key[request.idempotency_key] = result
        return result

    def reconcile_create(self, idempotency_key: str) -> CreateAccountResult | None:
        if idempotency_key in self._reconcile_by_key:
            return self._reconcile_by_key[idempotency_key]
        # Default: the fake provider actually did keep the original attempt's own result, so an
        # unstaged reconciliation call answers with whatever create_ad_account already decided —
        # a real provider would answer the equivalent of "yes, this is what happened server-side".
        return self._create_by_key.get(idempotency_key)


#: One shared fake instance so tests and a local pilot can inspect what *would* have run — a
#: per-call instance would throw the evidence away the moment the request ended (mirrors A3's
#: `_FAKE_TRANSPORT` singleton exactly).
_FAKE_PROVIDER = FakeMetaBusinessProvider()


def get_fake_provider() -> FakeMetaBusinessProvider:
    return _FAKE_PROVIDER


def reset_fake_provider() -> FakeMetaBusinessProvider:
    _FAKE_PROVIDER.created.clear()
    _FAKE_PROVIDER.shared.clear()
    _FAKE_PROVIDER.pixels_shared.clear()
    _FAKE_PROVIDER.business_managers.clear()
    _FAKE_PROVIDER.capability = CapabilityCheck(True, True, True, True)
    _FAKE_PROVIDER._staged_create.clear()
    _FAKE_PROVIDER._staged_share.clear()
    _FAKE_PROVIDER._staged_pixel_share.clear()
    _FAKE_PROVIDER._create_by_key.clear()
    _FAKE_PROVIDER._reconcile_by_key.clear()
    _FAKE_PROVIDER._share_by_key.clear()
    _FAKE_PROVIDER._pixel_share_by_key.clear()
    _FAKE_PROVIDER.discovered_ad_accounts.clear()
    _FAKE_PROVIDER.discovered_pixels.clear()
    _FAKE_PROVIDER._staged_ad_account_discovery.clear()
    _FAKE_PROVIDER._staged_pixel_discovery.clear()
    _FAKE_PROVIDER.calls.clear()
    return _FAKE_PROVIDER
