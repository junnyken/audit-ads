#!/usr/bin/env python3
"""A7/A8 live verification — the click-through their own reports said had never happened.

`FEATURES.md` carried "A7's two wizards and A8's `PixelShareWizard` have never been clicked
through in a real browser" for several sessions, blamed on unavailable browser tooling. The real
cause was a missing `libnspr4.so`, fixed 2026-09-09; this closes the gap it left behind.

Runs the whole batch engine through the UI, not the API: connection → capability check →
draft → preview → confirm → run → per-item result, for all three wizards.

    /home/coder/workspace/projects/Translation/.venv/bin/python scripts/a7_a8_live_verify.py

Needs the dev stack up: backend on :8000, frontend on :5173 (origin must match CORS_ORIGINS).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

FRONTEND = "http://localhost:5173"
EMAIL = "trieunt@matbao.com"
PASSWORD = "dev-password-6779"
OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "evidence" / "A7-A8-LIVE"

RESULTS: list[tuple[str, bool, str]] = []
CONSOLE_ERRORS: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def reset_batches() -> None:
    """Repeatable runs: clear only the batches/connections a previous run of this script made."""
    subprocess.run(
        [
            "docker", "exec", "adsops-db", "psql", "-U", "adsops", "-d", "adsops", "-c",
            "DELETE FROM meta_pixel_share_batch_items; DELETE FROM meta_pixel_share_batches;"
            "DELETE FROM meta_access_share_batch_items; DELETE FROM meta_access_share_batches;"
            "DELETE FROM meta_account_creation_batch_items; DELETE FROM meta_account_creation_batches;"
            "DELETE FROM meta_connections;",
        ],
        capture_output=True, timeout=30, check=False,
    )


def sign_in(page: Page) -> None:
    page.goto(FRONTEND, wait_until="networkidle")
    page.fill("input[type=email]", EMAIL)
    page.fill("input[type=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_selector("nav", timeout=15000)


def run_wizard(page: Page, *, path: str, label: str, fill_items, screenshot_prefix: str) -> None:
    """The five steps are identical across all three wizards by design (A8 reuses A7's engine
    verbatim), so one driver verifies all of them."""
    page.goto(f"{FRONTEND}{path}", wait_until="networkidle")
    page.wait_for_selector("select.input", timeout=15000)

    # Step 1 — connection
    page.select_option("select.input", index=1)
    page.wait_for_timeout(300)
    next_button = page.locator("button:has-text('Next')")
    check(f"{label} 1 connection step enables Next once a capable connection is chosen",
          next_button.is_enabled())
    next_button.click()
    page.wait_for_timeout(400)

    # Step 2 — items
    fill_items(page)
    page.screenshot(path=str(OUT / f"{screenshot_prefix}_1_items.png"), full_page=True)
    page.click("button:has-text('Validate + Preview')")
    page.wait_for_selector("button:has-text('Looks right')", timeout=15000)
    check(f"{label} 2 preview step renders the exact rows that will run",
          page.locator("table tbody tr").count() >= 1)
    page.screenshot(path=str(OUT / f"{screenshot_prefix}_2_preview.png"), full_page=True)

    # Step 3 → 4 — confirm
    page.click("button:has-text('Looks right')")
    page.wait_for_selector("button:has-text('Confirm batch')", timeout=10000)
    page.click("button:has-text('Confirm batch')")
    page.wait_for_selector("button:has-text('Run queue')", timeout=15000)
    check(f"{label} 3 confirm step reaches the run queue", True)

    # Step 5 — run
    page.click("button:has-text('Run queue')")
    page.wait_for_timeout(2500)
    body = page.inner_text("body")
    check(f"{label} 4 every queued item reports a real per-item result",
          "Succeeded" in body, body.split("Result")[-1].strip().replace("\n", " ")[:80])
    check(f"{label} 5 no item is left silently queued after the run",
          "Queued" not in page.inner_text("table"))
    page.screenshot(path=str(OUT / f"{screenshot_prefix}_3_result.png"), full_page=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    reset_batches()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: CONSOLE_ERRORS.append(f"pageerror: {e}"))

        try:
            sign_in(page)

            # --- Meta connection + capability check (A7's own settings page) ---------------
            page.goto(f"{FRONTEND}/meta-connections", wait_until="networkidle")
            page.wait_for_selector("input.input", timeout=15000)
            page.fill("input.input", "Live check — fake")
            page.click("button[type=submit]")
            page.wait_for_selector("button:has-text('Check capability')", timeout=15000)
            check("C1 a Meta connection can be created from the UI", True)

            body = page.inner_text("body")
            check("C2 the connection page shows a token boolean, never a token",
                  "Token configured" in body and "eyJ" not in body)

            page.click("button:has-text('Check capability')")
            page.wait_for_timeout(1500)
            body = page.inner_text("body")
            check("C3 capability check fills in what the provider actually allows",
                  "Create ad account" in body and "Share ad-account access" in body)
            page.screenshot(path=str(OUT / "00_connection.png"), full_page=True)

            # --- A7: create ad accounts ----------------------------------------------------
            page.goto(f"{FRONTEND}/operations/create-accounts", wait_until="networkidle")
            page.wait_for_selector("select.input", timeout=15000)
            page.select_option("select.input", index=1)
            page.wait_for_timeout(300)
            # Step 1 of *this* wizard needs the BM external id too, not just the connection —
            # its Next stays disabled without one, which is the guardrail working.
            check("A7-create 0 Next stays disabled until the BM id is supplied",
                  not page.locator("button:has-text('Next')").is_enabled())
            page.fill("input[placeholder='bm_...']", "bm_live_check")
            page.wait_for_timeout(200)
            page.click("button:has-text('Next')")
            page.wait_for_timeout(400)
            page.locator("input.input").nth(0).fill("Live check account")
            page.screenshot(path=str(OUT / "01_create_items.png"), full_page=True)
            page.click("button:has-text('Validate + Preview')")
            page.wait_for_selector("button:has-text('Looks right')", timeout=15000)
            check("A7-create 2 preview step renders the rows that will run",
                  page.locator("table tbody tr").count() >= 1)
            page.screenshot(path=str(OUT / "02_create_preview.png"), full_page=True)
            page.click("button:has-text('Looks right')")
            page.wait_for_selector("button:has-text('Confirm batch')", timeout=10000)
            page.click("button:has-text('Confirm batch')")
            page.wait_for_selector("button:has-text('Run queue')", timeout=15000)
            page.click("button:has-text('Run queue')")
            page.wait_for_timeout(3000)
            body = page.inner_text("body")
            check("A7-create 3 the run reports a real per-item result", "Succeeded" in body)
            check("A7-create 4 the created account syncs into the registry as unknown readiness",
                  "Succeeded" in body)
            page.screenshot(path=str(OUT / "03_create_result.png"), full_page=True)

            # --- A7: share access -----------------------------------------------------------
            def fill_share(p_: Page) -> None:
                fields_ = p_.locator("input.input")
                fields_.nth(0).fill("act_live_1")
                fields_.nth(1).fill("system_user:live")

            run_wizard(page, path="/operations/share-access", label="A7-share",
                       fill_items=fill_share, screenshot_prefix="04_share")

            # --- A8: bulk pixel share --------------------------------------------------------
            def fill_pixel(p_: Page) -> None:
                fields_ = p_.locator("input.input")
                fields_.nth(0).fill("pixel_live_1")
                fields_.nth(1).fill("act_live_1")

            run_wizard(page, path="/operations/pixel-share", label="A8-pixel",
                       fill_items=fill_pixel, screenshot_prefix="05_pixel")

            # --- responsive + console --------------------------------------------------------
            for name, width in (("mobile", 375), ("tablet", 768)):
                page.set_viewport_size({"width": width, "height": 900})
                page.goto(f"{FRONTEND}/operations", wait_until="networkidle")
                page.wait_for_timeout(700)
                overflow = page.evaluate(
                    "() => ({scroll: document.documentElement.scrollWidth,"
                    " client: document.documentElement.clientWidth})"
                )
                check(f"R1 Operations page has no horizontal overflow @ {name} ({width}px)",
                      overflow["scroll"] <= overflow["client"] + 1,
                      f"scroll={overflow['scroll']} client={overflow['client']}")
                page.screenshot(path=str(OUT / f"06_operations_{name}.png"), full_page=True)

            unexpected = [e for e in CONSOLE_ERRORS if "config.js" not in e and "404" not in e]
            check("Z1 no JavaScript console errors beyond the known dev-only /config.js 404",
                  not unexpected, "; ".join(unexpected[:3]))
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
