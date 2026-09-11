#!/usr/bin/env python3
"""A6 live verification — the last never-clicked-through surface in this product.

A6's Preflight pages shipped with "never clicked through in a real browser" and stayed that way
while A6 was deferred from the nav. The browser tooling turned out to have been fine all along
(a missing `libnspr4.so`, fixed 2026-09-09), so this closes the last of those gaps.

Beyond "does it render", this checks the things A6 exists to guarantee: a verdict is never
worded as a platform approval, and a blocking finding is never styled as success.

    /home/coder/workspace/projects/Translation/.venv/bin/python scripts/a6_live_verify.py

Needs the dev stack up: backend on :8000, frontend on :5173 (origin must match CORS_ORIGINS).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

FRONTEND = "http://localhost:5173"
EMAIL = "trieunt@matbao.com"
PASSWORD = "dev-password-6779"
OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "evidence" / "A6-LIVE"

RESULTS: list[tuple[str, bool, str]] = []
CONSOLE_ERRORS: list[str] = []

#: Wording A6 must never produce, in copy or in a verdict (CLAUDE.md rule 6, A6 §non-goals).
FORBIDDEN_WORDING = ("approved", "safe to publish", "will be approved", "guaranteed")


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def reset_drafts() -> None:
    subprocess.run(
        [
            "docker", "exec", "adsops-db", "psql", "-U", "adsops", "-d", "adsops", "-c",
            "DELETE FROM preflight_findings; DELETE FROM landing_page_evidence;"
            "DELETE FROM preflight_evaluation_runs; DELETE FROM campaign_drafts;",
        ],
        capture_output=True, timeout=30, check=False,
    )


def sign_in(page: Page) -> None:
    page.goto(FRONTEND, wait_until="networkidle")
    page.fill("input[type=email]", EMAIL)
    page.fill("input[type=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_selector("nav", timeout=15000)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    reset_drafts()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: CONSOLE_ERRORS.append(f"pageerror: {e}"))

        try:
            sign_in(page)

            # --- the list page, reachable by URL even though it is hidden from the nav ------
            page.goto(f"{FRONTEND}/preflight", wait_until="networkidle")
            page.wait_for_selector("text=Preflight", timeout=15000)
            page.wait_for_timeout(600)
            body = page.inner_text("body")
            check("A6-1 the Preflight page still loads by URL while hidden from the nav",
                  "Campaign Drafts" in body)
            check("A6-2 the page says up front it is not a platform decision",
                  "Not a platform decision" in body)
            check("A6-3 empty state explains what a draft is for, rather than showing nothing",
                  "No campaign drafts yet" in body)
            page.screenshot(path=str(OUT / "01_list_empty.png"), full_page=True)

            # --- create a draft that should trip a real rule --------------------------------
            page.click("button:has-text('Create campaign draft')")
            page.wait_for_selector("[role=dialog]", timeout=10000)
            check("A6-4 the create drawer opens", page.locator("[role=dialog]").is_visible())

            page.fill("#pf-title", "Live check draft")
            # Copy deliberately written to trip a copy rule: an absolute earnings promise.
            page.fill(
                "#pf-copy",
                "Guaranteed profit! You will 100% make money back, no risk at all, miracle cure.",
            )
            page.screenshot(path=str(OUT / "02_create_drawer.png"), full_page=True)
            page.click("[role=dialog] button:has-text('Create')")
            page.wait_for_timeout(1500)
            body = page.inner_text("body")
            check("A6-5 the draft appears in the list after creation", "Live check draft" in body)
            page.screenshot(path=str(OUT / "03_list_with_draft.png"), full_page=True)

            # --- open the detail page and run an evaluation ---------------------------------
            page.click("a:has-text('Open')") if page.locator("a:has-text('Open')").count() else page.click(
                "text=Live check draft"
            )
            page.wait_for_selector("button:has-text('Run evaluation')", timeout=15000)
            check("A6-6 the draft detail page opens", "Live check draft" in page.inner_text("body"))

            page.click("button:has-text('Run evaluation')")
            page.wait_for_timeout(3000)
            body = page.inner_text("body")
            check("A6-7a the evaluation produces a verdict worded as internal policy",
                  "internal policy" in body.lower() or "internal checks" in body.lower(),
                  body.split("\n")[2][:70] if len(body.split("\n")) > 2 else "")
            page.screenshot(path=str(OUT / "04_detail_evaluated.png"), full_page=True)

            # The Findings tab is the substance of A6 — assert real findings render with a
            # severity and a recommended action, not just that a tab labelled "Findings" exists.
            page.click("button:has-text('Findings'), [role=tab]:has-text('Findings')")
            page.wait_for_timeout(1200)
            findings_text = page.inner_text("body")
            check("A6-7b the Findings tab lists at least one real finding",
                  "No findings" not in findings_text and len(findings_text) > len(body) - 200,
                  findings_text.split("Findings")[-1].strip().replace("\n", " ")[:90])
            check("A6-7c the findings table shows a severity and a human-readable message",
                  any(s in findings_text for s in ("Blocking", "Warning", "Info"))
                  and "Draft is not linked" in findings_text,
                  "")
            page.screenshot(path=str(OUT / "04b_findings_tab.png"), full_page=True)

            # Opening a finding must explain *what to do*, not just restate the rule key.
            page.click("table tbody tr button:has-text('Review'), table tbody tr button:has-text('View')")
            page.wait_for_selector("[role=dialog]", timeout=10000)
            drawer = page.inner_text("[role=dialog]")
            check("A6-7d opening a finding shows a recommended action, not just a rule code",
                  "Recommended action" in drawer and len(drawer.split("Recommended action")[-1].strip()) > 20,
                  drawer.split("Recommended action")[-1].strip().replace("\n", " ")[:80])
            page.screenshot(path=str(OUT / "04c_finding_drawer.png"), full_page=True)
            # This project's `Drawer` has no Escape handler (unlike some other modals here) —
            # noted, not fixed: it is pre-existing and outside what A6 guarantees.
            page.click("[role=dialog] button[aria-label=Close]")
            page.wait_for_selector("[role=dialog]", state="hidden", timeout=5000)
            body = findings_text

            # --- the guarantees A6 exists for ------------------------------------------------
            # A naive substring search is wrong here: the page is *supposed* to contain the
            # phrase "will be approved" — inside the disclaimer that denies it. What must never
            # appear is an *affirmative* claim, so check sentence by sentence and skip any
            # sentence carrying a negation.
            lowered = body.lower()
            check(
                "A6-8a the required disclaimer denying a platform outcome is on the page",
                "do not guarantee that a draft will be approved" in lowered,
            )

            negations = ("not ", "never", "cannot", "no ", "n't")
            offending = []
            for sentence in re.split(r"[.\n]", lowered):
                if any(word in sentence for word in FORBIDDEN_WORDING) and not any(
                    n in sentence for n in negations
                ):
                    # The copy *we typed into the draft* is deliberately non-compliant ad text —
                    # it is the input under review, not the product's own wording.
                    if "guaranteed profit" in sentence or "miracle cure" in sentence:
                        continue
                    offending.append(sentence.strip()[:80])
            check("A6-8b no affirmative approval or safety claim in the product's own wording",
                  not offending, " | ".join(offending[:3]))

            check("A6-9 the page states the verdict is an internal-checks statement",
                  "internal" in lowered)

            # --- a blocking finding must never be styled as success -------------------------
            blocking_tone = page.evaluate(
                """() => {
                  const cell = [...document.querySelectorAll('td, span')]
                    .find(e => e.textContent.trim() === 'Blocking')
                  return cell ? getComputedStyle(cell).color + '|' + getComputedStyle(cell).backgroundColor : null
                }"""
            )
            check("A6-10 a blocking finding is never styled with success colouring",
                  blocking_tone is not None and "0, 128, 0" not in blocking_tone
                  and "16, 185, 129" not in blocking_tone,
                  str(blocking_tone))

            # --- archive keeps history ------------------------------------------------------
            page.on("dialog", lambda d: d.accept())
            page.click("button:has-text('Archive')")
            page.wait_for_timeout(1500)
            body = page.inner_text("body")
            check("A6-11 archiving keeps the record and offers Restore, never a delete",
                  "Restore" in body and "Delete" not in body)
            page.screenshot(path=str(OUT / "05_archived.png"), full_page=True)

            # --- responsive ------------------------------------------------------------------
            for name, width in (("mobile", 375), ("tablet", 768)):
                page.set_viewport_size({"width": width, "height": 900})
                page.goto(f"{FRONTEND}/preflight", wait_until="networkidle")
                page.wait_for_timeout(700)
                overflow = page.evaluate(
                    "() => ({scroll: document.documentElement.scrollWidth,"
                    " client: document.documentElement.clientWidth})"
                )
                check(f"A6-12 no horizontal overflow @ {name} ({width}px)",
                      overflow["scroll"] <= overflow["client"] + 1,
                      f"scroll={overflow['scroll']} client={overflow['client']}")
                page.screenshot(path=str(OUT / f"06_list_{name}.png"), full_page=True)

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
