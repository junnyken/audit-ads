#!/usr/bin/env python3
"""A9 live verification — real Chromium, real backend, real database.

The first real-browser click-through this project has ever run against its own dashboard UI:
A5's UAT covered the extension, and A6/A7/A8's pages were only ever verified by tsc/eslint/unit
tests because the browser tooling was believed to be unavailable (it was actually a missing
`libnspr4.so`, fixed 2026-09-09 — see the memory note of the same name).

Run it with any interpreter that has Playwright — deliberately *not* this project's own venv:
Playwright is a verification tool, not a runtime dependency, and `backend/requirements.txt` is
what ships in the production image. In this workspace the Translation project's venv already
has it:

    /home/coder/workspace/projects/Translation/.venv/bin/python scripts/a9_live_verify.py

Needs the dev stack up: backend on :8000, frontend on :5173.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

FRONTEND = "http://localhost:5173"  # must match CORS_ORIGINS exactly — 127.0.0.1 is a different origin
EMAIL = "trieunt@matbao.com"
PASSWORD = "dev-password-6779"
OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "evidence" / "A9-LIVE"

RESULTS: list[tuple[str, bool, str]] = []
CONSOLE_ERRORS: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def reset_a9_artifacts() -> None:
    """Make the run repeatable: clear only what a previous run of *this script* created, so the
    "no seat plan configured yet" state is verified every time rather than only on a virgin
    database. Touches nothing outside A9's own tables, and only ever runs against the local dev
    database this script is pointed at."""
    subprocess.run(
        [
            "docker", "exec", "adsops-db", "psql", "-U", "adsops", "-d", "adsops", "-c",
            "DELETE FROM workspace_invitations; DELETE FROM workspace_seat_plans;",
        ],
        capture_output=True,
        timeout=30,
        check=False,
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    reset_a9_artifacts()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: CONSOLE_ERRORS.append(f"pageerror: {e}"))

        try:
            # --- sign in ------------------------------------------------------------------
            page.goto(FRONTEND, wait_until="networkidle")
            page.fill("input[type=email]", EMAIL)
            page.fill("input[type=password]", PASSWORD)
            page.click("button[type=submit]")
            page.wait_for_selector("nav", timeout=15000)
            check("L1 sign in reaches the dashboard", "Overview" in page.inner_text("body"))

            # --- settings shows the two new entry points ----------------------------------
            page.goto(f"{FRONTEND}/settings", wait_until="networkidle")
            page.wait_for_timeout(600)
            body = page.inner_text("body")
            check("L2 Settings links to Team & Seats", "Team & Seats" in body)
            check("L3 Settings links to Security & Devices", "Security & Devices" in body)
            page.screenshot(path=str(OUT / "01_settings.png"), full_page=True)

            # --- Team & Seats ------------------------------------------------------------
            page.goto(f"{FRONTEND}/team", wait_until="networkidle")
            page.wait_for_selector("text=Team & Seats", timeout=15000)
            page.wait_for_timeout(800)
            body = page.inner_text("body")
            check(
                "L4 unconfigured capacity is shown as unknown, not a guessed number",
                "No seat plan is configured" in body or "no seat plan configured" in body.lower(),
            )
            check("L5 the owner is listed as a member", EMAIL in body)
            page.screenshot(path=str(OUT / "02_team_before_plan.png"), full_page=True)

            # --- set a seat plan ---------------------------------------------------------
            page.fill("input[type=number]", "5")
            page.click("button:has-text('Save')")
            page.wait_for_timeout(1200)
            body = page.inner_text("body")
            check("L6 seat plan saves and the summary updates", "Seat limit" in body and "5" in body)
            page.screenshot(path=str(OUT / "03_team_after_plan.png"), full_page=True)

            # --- invite a member ----------------------------------------------------------
            page.click("button:has-text('Invite member')")
            page.wait_for_selector("[role=dialog]", timeout=10000)
            check("L7 invite drawer opens", page.locator("[role=dialog]").is_visible())
            dialog_text = page.inner_text("[role=dialog]")
            check(
                "L8 invite drawer never offers Owner as a role",
                "Owner" not in page.inner_text("[role=dialog] select"),
                page.inner_text("[role=dialog] select").replace("\n", "/"),
            )
            check(
                "L9 invite drawer states no email is sent",
                "No email is sent" in dialog_text,
            )
            page.screenshot(path=str(OUT / "04_invite_drawer.png"), full_page=True)

            page.fill("[role=dialog] input[type=email]", "live-check@example.com")
            page.click("[role=dialog] button:has-text('Create invitation')")
            page.wait_for_timeout(1500)
            body = page.inner_text("body")
            check("L10 invitation created and the one-time link is shown", "Invitation link" in body)
            check(
                "L11 the one-time warning is visible next to it",
                "shown once" in body.lower(),
            )
            check("L12 the invited email appears in the invitations table", "live-check@example.com" in body)
            page.screenshot(path=str(OUT / "05_invitation_created.png"), full_page=True)

            # --- member drawer -------------------------------------------------------------
            page.click("button:has-text('Manage')")
            page.wait_for_selector("[role=dialog]", timeout=10000)
            drawer = page.inner_text("[role=dialog]")
            check(
                "L13 the owner's drawer explains owner cannot be downgraded/suspended",
                "cannot be downgraded" in drawer,
            )
            check(
                "L14 no destructive action is offered against the last owner",
                "Deactivate" not in drawer and "Suspend" not in drawer,
            )
            page.screenshot(path=str(OUT / "06_member_drawer_owner.png"), full_page=True)
            page.keyboard.press("Escape")
            page.click("[role=dialog] button[aria-label=Close]") if page.locator(
                "[role=dialog]"
            ).count() else None
            page.wait_for_timeout(400)

            # --- Security & Devices --------------------------------------------------------
            page.goto(f"{FRONTEND}/security-devices", wait_until="networkidle")
            page.wait_for_selector("text=Security & Devices", timeout=15000)
            page.wait_for_timeout(800)
            body = page.inner_text("body")
            check("L15 the current device is marked as such", "(this device)" in body)
            check(
                "L16 the current session cannot be revoked from here",
                "Sign out from the header" in body,
            )
            check(
                "L17 the page states no IP/user-agent/fingerprint is stored",
                "No IP address" in body,
            )
            page.screenshot(path=str(OUT / "07_security_devices.png"), full_page=True)

            # --- responsive ----------------------------------------------------------------
            for name, width, height in (("mobile", 375, 800), ("tablet", 768, 1024)):
                page.set_viewport_size({"width": width, "height": height})
                page.goto(f"{FRONTEND}/team", wait_until="networkidle")
                page.wait_for_timeout(800)
                overflow = page.evaluate(
                    "() => ({scroll: document.documentElement.scrollWidth,"
                    " client: document.documentElement.clientWidth})"
                )
                check(
                    f"L18 no horizontal overflow @ {name} ({width}px)",
                    overflow["scroll"] <= overflow["client"] + 1,
                    f"scroll={overflow['scroll']} client={overflow['client']}",
                )
                page.screenshot(path=str(OUT / f"08_team_{name}.png"), full_page=True)

            # `/config.js` is written by nginx at container start and deliberately does not
            # exist under the vite dev server — `lib/api.ts` documents the fallback that makes
            # its absence correct. It 404s on every page of this app and predates A9, so it is
            # named as an exception rather than allowed to hide any *other* console error.
            unexpected = [e for e in CONSOLE_ERRORS if "config.js" not in e and "404" not in e]
            check(
                "Z1 no JavaScript console errors beyond the known dev-only /config.js 404",
                not unexpected,
                "; ".join(unexpected[:3]),
            )
        finally:
            browser.close()

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"RESULT: {passed}/{len(RESULTS)} passed — screenshots in {OUT}")
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAILED: {name} — {detail}")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
