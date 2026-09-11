#!/usr/bin/env python3
"""A10 live probe — the one real, non-mutating call to Meta, run by a human on purpose.

This is deliberately a script and not a route: CLAUDE.md rule 22 makes the first real external
call a separate, witnessed decision, not something that can happen because a page loaded or a
test ran. Nothing in the running application can reach this file.

**What it does:** GETs `me/businesses` twice — once as the probe, once through
`check_capability()`. **Two** real calls per run, not one; each flag below adds more, and the
count is printed before anything is sent. It only reads: the transport underneath has no method
that can write.

**What it prints:** whether the calls succeeded, how many BMs the token can see, their ids and
names, and Meta's own rate-limit header. It never prints the token.

    .venv/bin/python scripts/a10_live_probe.py

Run it from `backend/`. It asks for the token at a hidden prompt, so the token never reaches
your shell history — which an inline `META_ACCESS_TOKEN=... command` would write to
`~/.bash_history` in the clear. `META_ACCESS_TOKEN` in the environment still works and takes
precedence, for a server that already has it configured.

Flags, each costing extra read calls:

- `--scopes` — ask Meta what this token is actually permitted to do, via `debug_token`. The one
  honest way to tell "App Review came through" from "the build cannot write", which look
  identical in a capability check (+1 call).
- `--list` — print every BM the token can see, not just the first (+1 call).
- `--assets` — reads the configured BM's ad accounts and Pixels and reports the outcome of
  every edge separately, so an edge Meta refuses is visible rather than silently narrowing the
  inventory. Needs `META_BUSINESS_ID` (+3 calls or more, one per edge per page).
- `--discover` — asks whether Meta will name the business behind the token at all, by trying
  `business` as a field, `businesses` as an expanded field, and `businesses` as an edge. Answers
  "can this product discover a system user's BM automatically, or must the id be configured?"
  (+3 calls).
- `--bm <id>` — diagnostic for the case where `me/businesses` comes back empty even though the
  system user demonstrably has assets assigned. Reads `me` and then the Business Manager
  directly, which separates "this token cannot see that BM" from "`me/businesses` is simply the
  wrong edge for a system user token" (+2 calls).
"""
from __future__ import annotations

import getpass
import sys
from pathlib import Path

# This script is run directly (`python scripts/a10_live_probe.py`), which puts `scripts/` on
# `sys.path` rather than `backend/`, so `app` would not be importable. pytest gets this from
# `pythonpath = .` in pytest.ini; a standalone script has to say it itself.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings  # noqa: E402
from app.services.meta_real_provider import build_real_provider  # noqa: E402


def _flag_value(name: str) -> str | None:
    """Value following `name` on the command line, or None. No argparse: this script has two
    optional flags and stays readable without it."""
    if name in sys.argv:
        index = sys.argv.index(name)
        if index + 1 < len(sys.argv):
            return sys.argv[index + 1]
    return None


def _code(response) -> str:
    return response.failure_code.value if response.failure_code else "unknown"


def main() -> int:
    settings = get_settings()

    token = settings.meta_access_token
    if not token:
        # Hidden prompt rather than an inline environment variable: the token lives in this
        # process's memory for the length of one call, and never reaches the shell history,
        # the screen, a file, or this repo.
        token = getpass.getpass("Meta system user token (input is hidden): ").strip()
    if not token:
        print("No token given. Nothing was called.")
        return 2

    print(f"Graph API   : {settings.meta_graph_api_base_url}/{settings.meta_graph_api_version}")
    print(f"Token       : {len(token)} characters (not shown)")
    # Two calls, not one: `probe()` and `check_capability()` each issue their own GET. Saying
    # "one call" here would understate the rate-limit cost of running this script.
    if settings.meta_business_id:
        print(f"Business ID : {settings.meta_business_id}")
        print("Calling     : 2 read-only GETs — the configured Business Manager, read directly\n")
    else:
        # Without this line the output gave no clue that the run was misconfigured, so an empty
        # result looked identical whether the id was missing or the BM was genuinely empty.
        print("Business ID : NOT CONFIGURED  (set META_BUSINESS_ID)")
        print("              Meta will not name the business behind a system user token, so")
        print("              `me/businesses` returns nothing and capability reports")
        print("              `not_configured`. That is the correct answer, not a fault.")
        print("Calling     : 2 read-only GETs — me/businesses (probe, then capability)\n")

    provider = build_real_provider(settings)
    provider.transport.access_token = token
    found, response = provider.probe()

    if not response.ok:
        print(f"RESULT      : FAILED — {response.failure_code.value if response.failure_code else 'unknown'}")
        print(f"              {response.failure_summary}")
        if response.rate_limit_header:
            print(f"rate limit  : {response.rate_limit_header}")
        print("\nNothing was created, shared or changed. This call can only read.")
        return 1

    if found:
        print("RESULT      : OK — the token read a Business Manager")
    else:
        # A 200 carrying nothing is not a success worth announcing as one: it is exactly the
        # state the product reports as `not_configured`.
        print("RESULT      : NOTHING RETURNED — the call succeeded and carried no BM")
    print(f"visible now : {len(found)} (limit was 1, so this is 'at least one', not a total)")
    for business in found:
        print(f"  - {business['external_id']}  {business['name']}")
    if response.rate_limit_header:
        print(f"rate limit  : {response.rate_limit_header}")

    if "--list" in sys.argv:
        print("\nFull list (one more read call):")
        for bm in provider.list_business_managers():
            print(f"  - {bm['external_id']}  {bm['name']}")

    if "--discover" in sys.argv:
        # The open question: a system user belongs to exactly one business, so if Meta will name
        # it, discovery stays automatic and no BM id has to be configured. Each candidate is one
        # read. A candidate that fails with `invalid_request` means the field/edge does not
        # exist — that is a real answer, not an error to work around.
        print("\nDiscovery probe — will Meta name the business behind this token? (3 read calls)")
        candidates = [
            ("me", {"fields": "id,name,business"}, "`business` as a field on the user node"),
            ("me", {"fields": "businesses{id,name}"}, "`businesses` as an expanded field"),
            ("me/businesses", {"fields": "id,name"}, "`businesses` as an edge (current code)"),
        ]
        for path, params, description in candidates:
            result = provider.transport.get(path, params)
            if not result.ok:
                print(f"  {description}\n      -> FAILED — {_code(result)}")
                continue
            named = result.payload.get("business") or result.payload.get("businesses")
            if named is None and result.payload.get("data"):
                named = result.payload["data"]
            print(f"  {description}\n      -> OK — {named if named else 'empty, no business named'}")

    if "--scopes" in sys.argv:
        # `debug_token` is the only way to ask Meta what a token may actually do, and it is a
        # read. It is also the one place the token must travel as a query parameter rather than
        # an Authorization header — the endpoint takes `input_token`, and there is no
        # alternative. That is a real departure from this transport's usual rule, so it lives
        # here in an operator-run script and nowhere in the product.
        print("\nToken scopes (1 more read call):")
        debug = provider.transport.get("debug_token", {"input_token": token})
        if not debug.ok:
            print(f"  FAILED — {_code(debug)}")
        else:
            data = debug.payload.get("data", {})
            scopes = data.get("scopes") or []
            print(f"  type      : {data.get('type', 'unknown')}")
            print(f"  valid     : {data.get('is_valid')}")
            expires = data.get("expires_at")
            print(f"  expires   : {'never' if expires in (0, None) else expires}")
            print(f"  scopes    : {', '.join(scopes) if scopes else '(none reported)'}")
            for needed, why in (
                ("ads_read", "read ad account data"),
                ("business_management", "read the Business Manager"),
                ("ads_management", "WRITE — create or change ad accounts"),
            ):
                mark = "yes" if needed in scopes else "NO "
                print(f"    {mark}  {needed:20} — {why}")
            if "ads_management" in scopes:
                print("\n  This token can write. Nothing in this build will: the provider's write")
                print("  methods raise and the transport has no POST. The permission being present")
                print("  is not the same as the product being able to use it.")

    bm_id = _flag_value("--bm")
    if bm_id:
        print(f"\nDiagnosis for BM {bm_id} (2 more read calls):")
        who = provider.transport.get("me", {"fields": "id,name"})
        if who.ok:
            print(f"  GET me      : id={who.payload.get('id')}  name={who.payload.get('name', '')}")
        else:
            print(f"  GET me      : FAILED — {_code(who)}")

        business = provider.transport.get(bm_id, {"fields": "id,name"})
        if business.ok:
            print(f"  GET {bm_id} : id={business.payload.get('id')}  name={business.payload.get('name', '')}")
            print("\n  VERDICT: the token CAN read this Business Manager directly.")
            print("  `me/businesses` returning 0 is then the wrong edge for a system user token")
            print("  — a defect in this product's provider, not a permission problem on Meta.")
        else:
            print(f"  GET {bm_id} : FAILED — {_code(business)}")
            print("\n  VERDICT: the token cannot read this Business Manager either. That points")
            print("  at assignment/permission on the Meta side rather than at the chosen edge.")

    if "--assets" in sys.argv:
        target = settings.meta_business_id
        if not target:
            print("\nAsset discovery : skipped — META_BUSINESS_ID is not set, so there is no BM")
            print("                  to read assets from.")
        else:
            print(f"\nAsset discovery for BM {target} (at least 3 more read calls):")
            print("  The open question: a BM holds ad accounts it owns AND ad accounts clients")
            print("  shared into it, on two different edges. `client_ad_accounts` could not be")
            print("  verified in Meta's docs, so this is how we find out whether it answers.\n")
            for label, discovery in (
                ("ad accounts", provider.discover_ad_accounts(target)),
                ("pixels", provider.discover_pixels(target)),
            ):
                print(f"  {label}: {len(discovery.assets)} returned, complete={discovery.complete}")
                for edge in discovery.edges:
                    detail = f"pages={edge.pages_read}"
                    if edge.truncated:
                        detail += "  TRUNCATED-AT-CAP"
                    if edge.failure_code is not None:
                        detail += f"  failure={edge.failure_code.value}"
                    print(f"      edge {edge.edge:<20} ok={str(edge.ok):<5} {detail}")
                for asset in discovery.assets:
                    print(f"      - {asset.external_id}  {asset.name}  [{asset.source_edge}]")
                if not discovery.complete:
                    print("      -> INCOMPLETE: this run may not conclude anything is missing.")
                print()

    capability = provider.check_capability()
    print("\nCapability as this build reports it:")
    print(f"  list_business_managers   : {capability.list_business_managers}")
    print(f"  create_ad_account        : {capability.create_ad_account}  (writes are not enabled)")
    print(f"  share_ad_account_access  : {capability.share_ad_account_access}")
    print(f"  share_pixel_access       : {capability.share_pixel_access}")
    print(f"  reason                   : {capability.reason.value if capability.reason else '—'}")
    print("\nNothing was created, shared or changed. This call can only read.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
