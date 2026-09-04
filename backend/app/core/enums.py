"""Controlled vocabulary for A1 (MINI-SPEC A1 §B).

Values are stable wire/database values. Display labels are localised in the frontend; these
strings must not be renamed without a migration.
"""
from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    BUYER = "buyer"
    VIEWER = "viewer"
    AUDITOR = "auditor"


class AccountType(StrEnum):
    BUSINESS_MANAGER = "business_manager"
    PERSONAL_REFERENCE = "personal_reference"
    UNKNOWN = "unknown"


class AccountStatus(StrEnum):
    UNKNOWN = "unknown"
    ACTIVE = "active"
    WARNING = "warning"
    RESTRICTED = "restricted"
    DISABLED = "disabled"
    ARCHIVED = "archived"


class ReadinessStatus(StrEnum):
    UNKNOWN = "unknown"
    NOT_READY = "not_ready"
    READY_WITH_WARNINGS = "ready_with_warnings"
    OPERATIONALLY_READY = "operationally_ready"


class EvidenceStatus(StrEnum):
    MISSING = "missing"
    PROVIDED = "provided"
    VERIFIED = "verified"
    EXPIRED = "expired"
    REJECTED = "rejected"


class ChecklistReviewStatus(StrEnum):
    NOT_REVIEWED = "not_reviewed"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"
    NEEDS_UPDATE = "needs_update"
    WAIVED = "waived"


class EventSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class EventStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class ChecklistCategory(StrEnum):
    OWNERSHIP = "ownership"
    ACCESS = "access"
    BILLING = "billing"
    ASSETS = "assets"
    COMPLIANCE = "compliance"
    OPERATIONS = "operations"


class AssetType(StrEnum):
    """Asset kinds addressable through AccountAssetLink."""

    PAGE = "page"
    PIXEL = "pixel"
    PAYMENT_PROFILE = "payment_profile"
    BROWSER_PROFILE = "browser_profile"
    PROXY = "proxy"


#: Asset kinds where at most one link may be active per ad account at a time.
SINGLE_ACTIVE_ASSET_TYPES = frozenset({AssetType.BROWSER_PROFILE, AssetType.PROXY})


class ReferenceStatus(StrEnum):
    """Lifecycle of a non-account reference record (BM, page, pixel, proxy, ...)."""

    UNKNOWN = "unknown"
    ACTIVE = "active"
    INACTIVE = "inactive"
    RESTRICTED = "restricted"


class DataFreshness(StrEnum):
    CURRENT = "current"
    STALE = "stale"
    UNKNOWN = "unknown"


class ReasonSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
