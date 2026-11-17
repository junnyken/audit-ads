"""A6 §6.D `LandingPageCheckService` — turns one `safe_fetch` call into evidence fields plus the
landing-page findings that can be decided from that fetch alone.

`landing_page_missing` (no URL at all) is not this service's concern — a rule module never
knows a URL doesn't exist, so it belongs with the other pure draft-field checks in
`preflight_copy_rules`. Everything else in the landing-page rule table lives here.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.enums import FindingCategory, FindingSeverity
from app.services.preflight_safe_http import FetchOutcome, SafeFetchResult, safe_fetch
from app.services.preflight_types import FindingDraft

RULE_VERSION = 1
#: How long one fetch's evidence is trusted before a re-evaluation must fetch again.
EVIDENCE_TTL = timedelta(minutes=30)
#: Distinct from `preflight_safe_http.DEFAULT_MAX_REDIRECTS` (5, the hard cap that aborts the
#: fetch): this is the lower bar at which a *successful* fetch still earns a warning.
REDIRECT_WARNING_THRESHOLD = 3
SLOW_RESPONSE_MS_THRESHOLD = 3000


@dataclass(frozen=True)
class LandingPageCheckOutcome:
    #: Ready to spread into a `LandingPageEvidence` row. Never contains the fetched HTML.
    evidence_fields: dict
    findings: list[FindingDraft]
    #: True only for `FetchOutcome.TRANSIENT_ERROR` — the caller's verdict rollup must route
    #: this to `unknown_missing_evidence`, never treat it as a definitive finding (guardrail 16).
    is_transient: bool


def _evidence_fields(result: SafeFetchResult, now: datetime) -> dict:
    return {
        "url": result.url,
        "final_url": result.final_url,
        "http_status": result.http_status,
        "is_https": bool(result.is_https),
        "redirect_count": result.redirect_count,
        "response_time_ms": result.response_time_ms,
        "mobile_viewport_meta_present": result.mobile_viewport_meta_present,
        "contact_or_policy_link_detected": result.contact_or_policy_link_detected,
        "fetch_error": result.fetch_error,
        "checked_at": now,
        "expires_at": now + EVIDENCE_TTL,
    }


class LandingPageCheckService:
    """No I/O of its own beyond `safe_fetch` — kept a class (rather than a bare function) so a
    future caller can inject fetch parameters (timeout, redirect cap) per workspace without
    changing every call site."""

    def check(self, url: str) -> LandingPageCheckOutcome:
        now = datetime.now(UTC)
        result = safe_fetch(url)
        evidence = _evidence_fields(result, now)

        if result.outcome is FetchOutcome.TRANSIENT_ERROR:
            return LandingPageCheckOutcome(evidence_fields=evidence, findings=[], is_transient=True)

        findings: list[FindingDraft] = []

        if result.outcome is FetchOutcome.BLOCKED_UNSAFE:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="landing_page_private_target_blocked",
                    rule_version=RULE_VERSION,
                    message=(
                        "Landing page URL resolves to a private, loopback or internal network "
                        "address and was refused for safety."
                    ),
                    recommended_action="Use a public, internet-reachable landing page URL.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )
            return LandingPageCheckOutcome(evidence_fields=evidence, findings=findings, is_transient=False)

        if result.outcome is FetchOutcome.UNREACHABLE:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="landing_page_unreachable",
                    rule_version=RULE_VERSION,
                    message=f"Landing page could not be reached: {result.fetch_error}.",
                    recommended_action="Confirm the landing page loads and returns a normal page.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )
            return LandingPageCheckOutcome(evidence_fields=evidence, findings=findings, is_transient=False)

        # FetchOutcome.OK — the page loaded; the checks below are all warning-level signals.
        if not result.is_https:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="landing_page_not_https",
                    rule_version=RULE_VERSION,
                    message="The final landing page URL is not served over HTTPS.",
                    recommended_action="Serve the landing page over HTTPS.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )

        if (result.redirect_count or 0) > REDIRECT_WARNING_THRESHOLD:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="landing_page_excessive_redirects",
                    rule_version=RULE_VERSION,
                    message=f"Landing page required {result.redirect_count} redirects to load.",
                    recommended_action="Point the ad directly at the final destination URL.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )

        if (result.response_time_ms or 0) > SLOW_RESPONSE_MS_THRESHOLD:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="landing_page_slow_response",
                    rule_version=RULE_VERSION,
                    message=f"Landing page took {result.response_time_ms}ms to respond.",
                    recommended_action="Improve landing page load time before spending budget on it.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )

        if result.mobile_viewport_meta_present is False:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="landing_page_missing_mobile_viewport",
                    rule_version=RULE_VERSION,
                    message="No mobile viewport meta tag was detected on the landing page.",
                    recommended_action="Add a responsive viewport meta tag for mobile visitors.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )

        if result.contact_or_policy_link_detected is False:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="landing_page_missing_contact_or_policy_link",
                    rule_version=RULE_VERSION,
                    message="No contact, policy or terms link pattern was detected on the page.",
                    recommended_action="Add a visible contact or policy/terms link.",
                    field_reference="landing_page_url",
                    evidence_reference="landing_page_evidence",
                )
            )

        return LandingPageCheckOutcome(evidence_fields=evidence, findings=findings, is_transient=False)
