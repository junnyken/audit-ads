"""Context resolution and URL sanitisation for the Chrome extension (A5).

Two rules shape everything here:

* **Exact match or nothing.** An account is `confirmed` only when the id shown on the page
  matches a registered account exactly, after a stated format canonicalisation. Names are never
  compared. There is no similarity code path at all, so a later change cannot accidentally
  reach one.
* **Nothing leaves the browser that we would not want stored.** The account id arrives in a
  query string; the query string never does. Paths are reduced to an allowlisted shape here as
  well as in the extension, because the browser side is a convenience and the server side is
  the guarantee.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlparse

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import ExtensionContextStatus, ExtensionPageType
from app.models.entities import AdAccount

#: Meta writes the ad account as `act_123456789` in some places and `123456789` in others.
#: Treating those as the same account is a *format* equivalence, not a similarity guess.
_ACT_PREFIX = re.compile(r"^act[_-]", re.IGNORECASE)
_ALLOWED_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,119}$")

#: Route shapes the extension is allowed to report, mapped to the page type they mean.
#: Anything not on this list becomes `unsupported_page` with the path discarded.
PATH_RULES: tuple[tuple[re.Pattern[str], ExtensionPageType], ...] = (
    (re.compile(r"^/adsmanager/manage/campaigns/?$"), ExtensionPageType.CAMPAIGN),
    (re.compile(r"^/adsmanager/manage/adsets/?$"), ExtensionPageType.ADSET),
    (re.compile(r"^/adsmanager/manage/ads/?$"), ExtensionPageType.AD),
    (re.compile(r"^/adsmanager/manage/accounts/?$"), ExtensionPageType.ACCOUNT),
    (re.compile(r"^/adsmanager/manage/?$"), ExtensionPageType.ACCOUNT),
    (re.compile(r"^/adsmanager/billing/?$"), ExtensionPageType.BILLING),
    (re.compile(r"^/ads/manager/account_settings.*$"), ExtensionPageType.SETTINGS),
    (re.compile(r"^/settings/?$"), ExtensionPageType.SETTINGS),
    (re.compile(r"^/billing_hub/accounts/?$"), ExtensionPageType.BILLING),
    (re.compile(r"^/billing_hub/payment_activity/?$"), ExtensionPageType.BILLING),
)

MAX_PATH_LENGTH = 120


def canonical_external_id(value: str | None) -> str | None:
    """Trim, lowercase and drop an `act_` prefix. Returns None for anything unusable.

    This is the only normalisation in A5. It never removes digits, never truncates and never
    compares two different ids as equal.
    """
    if not value:
        return None
    candidate = _ACT_PREFIX.sub("", str(value).strip().lower())
    if not candidate or not _ALLOWED_ID.match(candidate):
        return None
    return candidate


def sanitise_path(raw: str | None) -> tuple[str | None, ExtensionPageType]:
    """Reduce a location to an allowlisted route path, or refuse it.

    Query and fragment are dropped before matching, so a path that arrives with an access token
    or a session parameter attached cannot carry it any further.
    """
    if not raw:
        return None, ExtensionPageType.UNKNOWN
    candidate = str(raw).strip()
    if not candidate:
        return None, ExtensionPageType.UNKNOWN
    # Accept a full URL or a bare path; either way keep only the path component, so a query
    # string or fragment is discarded before anything is matched or stored.
    if candidate.startswith(("http://", "https://")):
        path = urlparse(candidate).path or ""
    else:
        path = urlparse(f"http://x{candidate}" if candidate.startswith("/") else "").path or ""
    if not path.startswith("/") or len(path) > MAX_PATH_LENGTH:
        return None, ExtensionPageType.UNKNOWN
    for pattern, page_type in PATH_RULES:
        if pattern.match(path):
            return path, page_type
    return None, ExtensionPageType.UNKNOWN


@dataclass
class ContextResolution:
    status: ExtensionContextStatus
    account: AdAccount | None = None
    reason_code: str | None = None
    message: str | None = None
    safe_path: str | None = None
    page_type: ExtensionPageType = ExtensionPageType.UNKNOWN
    candidate_count: int = 0
    detail: dict = field(default_factory=dict)


class ExtensionContextResolver:
    """Maps what a page showed to exactly one registered account, or admits it cannot."""

    def __init__(self, session: Session, workspace_id: uuid.UUID) -> None:
        self.session = session
        self.workspace_id = workspace_id

    def resolve(
        self,
        *,
        external_account_id: str | None,
        raw_path: str | None,
        declared_page_type: str | None = None,
    ) -> ContextResolution:
        safe_path, derived_type = sanitise_path(raw_path)
        page_type = derived_type
        if page_type is ExtensionPageType.UNKNOWN and declared_page_type:
            try:
                page_type = ExtensionPageType(declared_page_type)
            except ValueError:
                page_type = ExtensionPageType.UNKNOWN

        if safe_path is None:
            return ContextResolution(
                status=ExtensionContextStatus.UNSUPPORTED_PAGE,
                reason_code="unsupported_page",
                message="This page is not a recognised Ads Manager route.",
                page_type=ExtensionPageType.UNKNOWN,
            )

        canonical = canonical_external_id(external_account_id)
        if canonical is None:
            return ContextResolution(
                status=ExtensionContextStatus.AMBIGUOUS,
                reason_code="no_account_id_on_page",
                message=(
                    "No account id was visible on this page, so it cannot be matched safely. "
                    "Select the account manually."
                ),
                safe_path=safe_path,
                page_type=page_type,
            )

        matches = self._exact_matches(canonical)
        if not matches:
            return ContextResolution(
                status=ExtensionContextStatus.UNKNOWN,
                reason_code="account_not_registered",
                message="No exact registered account matches the detected account id.",
                safe_path=safe_path,
                page_type=page_type,
            )
        if len(matches) > 1:
            return ContextResolution(
                status=ExtensionContextStatus.AMBIGUOUS,
                reason_code="multiple_registered_matches",
                message=(
                    "More than one registered account carries this account id. Resolve the "
                    "duplicate in the registry before relying on this context."
                ),
                safe_path=safe_path,
                page_type=page_type,
                candidate_count=len(matches),
            )

        account = matches[0]
        if account.archived_at is not None:
            return ContextResolution(
                status=ExtensionContextStatus.AMBIGUOUS,
                reason_code="account_archived",
                message="The matching account is archived and is no longer actively managed.",
                account=account,
                safe_path=safe_path,
                page_type=page_type,
                candidate_count=1,
            )

        return ContextResolution(
            status=ExtensionContextStatus.CONFIRMED,
            account=account,
            safe_path=safe_path,
            page_type=page_type,
            candidate_count=1,
        )

    def _exact_matches(self, canonical: str) -> list[AdAccount]:
        """Exact set membership on the canonical forms, resolved in SQL.

        The candidate set is the small closed list of ways the same id can legitimately have
        been typed into the registry — never a pattern, never a prefix search. Archived rows
        are included on purpose, so an archived account is reported as archived rather than as
        "not registered".
        """
        candidates = [canonical, f"act_{canonical}", f"act-{canonical}"]
        return list(
            self.session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == self.workspace_id,
                    AdAccount.external_account_id.isnot(None),
                    sa.func.lower(sa.func.trim(AdAccount.external_account_id)).in_(candidates),
                )
            ).scalars().all()
        )
