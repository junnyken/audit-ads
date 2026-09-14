#!/usr/bin/env python3
"""O2.1 live verification — real Chromium, real backend, real database, real login.

Follows the pattern of `a9_live_verify.py` / `a10_live_probe.py` / `a6_live_verify.py`, with one
deliberate difference: **the credential comes from the environment, not from a literal in the
source.**

`a9_live_verify.py` signs in as `trieunt@matbao.com` with a password committed to this repository.
Measured 2026-09-14: that account no longer exists — the dev database holds exactly one user — so
every prior live-verify script in this repo is currently unrunnable. Rather than commit a second
credential that will rot the same way, this script asks for one:

    export ADSOPS_LIVE_EMAIL='you@example.com'
    read -rs ADSOPS_LIVE_PASSWORD && export ADSOPS_LIVE_PASSWORD   # not echoed, not in history

    /home/coder/workspace/projects/Translation/.venv/bin/python scripts/o2_1_live_verify.py

Playwright is deliberately *not* in this project's own venv: it is a verification tool, not a
runtime dependency, and `requirements.txt` is what ships in the production image.

Needs the dev stack up (`scripts/dev.sh status`). It signs in through the real login form. It
mints nothing, and it writes nothing to Meta: every action here is a page load or a filter change.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

FRONTEND = os.environ.get("ADSOPS_LIVE_FRONTEND", "http://localhost:5173")
EMAIL = os.environ.get("ADSOPS_LIVE_EMAIL", "")
PASSWORD = os.environ.get("ADSOPS_LIVE_PASSWORD", "")
OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "evidence" / "O2-1-LIVE"

#: The connection whose discovery produced the real import, and the two accounts it created.
#: Overridable so this script survives a different dev database.
CONNECTION_LABEL = os.environ.get("ADSOPS_LIVE_CONNECTION", "Quảng Cáo Top")
IMPORTED = os.environ.get("ADSOPS_LIVE_IMPORTED", "1069545664559001,1594590901195302").split(",")

RESULTS: list[tuple[str, bool, str]] = []
CONSOLE_ERRORS: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def shot(page, name: str) -> None:
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)


def main() -> int:
    if not EMAIL or not PASSWORD:
        print(
            "ADSOPS_LIVE_EMAIL and ADSOPS_LIVE_PASSWORD must be set.\n"
            "This script will not invent a credential and will not mint a session: the point of a\n"
            "live verification is that a real identity performed it.",
            file=sys.stderr,
        )
        return 2

    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 1200})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: CONSOLE_ERRORS.append(f"pageerror: {e}"))

        try:
            # --- real sign-in, through the real form -------------------------------------
            page.goto(FRONTEND, wait_until="networkidle")
            page.fill("input[type=email]", EMAIL)
            page.fill("input[type=password]", PASSWORD)
            page.click("button[type=submit]")
            page.wait_for_selector("nav", timeout=15000)
            check("L0 signed in through the real auth flow", "Overview" in page.inner_text("body"))
            shot(page, "L0-signed-in")

            # --- reach the workspace for the connection that produced the import ----------
            page.goto(f"{FRONTEND}/meta-connections", wait_until="networkidle")
            page.wait_for_timeout(800)
            shot(page, "L1-connections")
            card = page.locator("div").filter(has_text=CONNECTION_LABEL).first
            check("L1 the connection card is listed", card.count() > 0, CONNECTION_LABEL)

            page.get_by_role("link", name="Open workspace").first.click()
            page.wait_for_timeout(1200)
            body = page.inner_text("body")

            # --- B1: the registry badge, the one thing O1.1 could not verify --------------
            check("B1 Overview says the Business Manager is in the registry", "In the registry" in body,
                  "found 'Not in the registry yet'" if "Not in the registry yet" in body else "")
            check("B1 the registry lookup did not fail", "Registry could not be checked" not in body)
            shot(page, "B1-overview-registry-badge")

            # --- B1: matched rows carry no import button ---------------------------------
            page.get_by_role("tab", name="Ad Accounts").click()
            page.wait_for_timeout(800)
            shot(page, "B1-ad-accounts")
            rows = page.locator("li").all()
            for external_id in IMPORTED:
                row = [r for r in rows if external_id in (r.inner_text() or "")]
                if not row:
                    check(f"B1 imported account {external_id} is listed", False, "row not found")
                    continue
                text = row[0].inner_text()
                check(f"B1 {external_id} reads Matched", "Matched" in text)
                check(f"B1 {external_id} offers no import", "Add to registry" not in text)

            missing = page.get_by_role("button", name="Add to registry")
            check("B1 unimported accounts still offer the import", missing.count() > 0,
                  f"{missing.count()} buttons")

            # --- B2: the owned/client split on the real 8-account run ---------------------
            page.select_option("#inventory-edge", "owned_ad_accounts")
            page.wait_for_timeout(400)
            owned = page.inner_text("body")
            check("B2 owned filter shows only owned rows", "Returned by Client accounts" not in owned)
            shot(page, "B2-owned")
            page.select_option("#inventory-edge", "client_ad_accounts")
            page.wait_for_timeout(400)
            client = page.inner_text("body")
            check("B2 client filter shows only client rows", "Returned by Owned accounts" not in client)
            shot(page, "B2-client")
            page.select_option("#inventory-edge", "all")
            page.wait_for_timeout(400)

            # --- B3/B4: coverage and authority as the real run reports them ---------------
            page.get_by_role("tab", name="Overview").click()
            page.wait_for_timeout(600)
            overview = page.inner_text("body")
            check("B3 coverage is stated, not implied", "Complete" in overview or "Unknown" in overview)
            check("B4 an unestablished authority would be stated",
                  "could not be established" not in overview or "Unknown" in overview,
                  "authority caveat present without an Unknown coverage")
            shot(page, "B3-B4-overview-coverage")

            # --- B5: both real runs, each with its own coverage ---------------------------
            page.get_by_role("tab", name="Discovery History").click()
            page.wait_for_timeout(900)
            history = page.inner_text("body")
            check("B5 history lists more than one run", history.count("Ad accounts:") >= 2,
                  f"{history.count('Ad accounts:')} runs rendered")
            check("B5 history carries no reconciliation", "Add to registry" not in history)
            check("B5 history says why reconciliation is absent", "recomputed" in history)
            shot(page, "B5-discovery-history")

            # --- B6: the Pixel asymmetry -------------------------------------------------
            page.get_by_role("tab", name="Pixels").click()
            page.wait_for_timeout(800)
            pixels = page.inner_text("body")
            check("B6 Pixels tab offers no import", "Add to registry" not in pixels)
            check("B6 the reverse-absence limitation is stated",
                  "cannot be evaluated for absence" in pixels or "mapping is not recorded" in pixels)
            shot(page, "B6-pixels")

            check("Z no console errors during the walkthrough", not CONSOLE_ERRORS,
                  "; ".join(CONSOLE_ERRORS[:3]))
        finally:
            browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\n{passed}/{len(RESULTS)} checks passed. Screenshots: {OUT}")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
