# AdsOps — MINI-SPEC A7 (v2): Core Simplification & BM Workspace

**Status:** received 2026-09-08, supersedes the earlier "A7 — Account Operations Intelligence"
(spend/activity dashboard) direction. That earlier version is **not deleted** — code lives at
`backend/app/services/account_operations.py`, `backend/app/api/v1/routers/account_operations.py`,
`backend/app/schemas/account_operations.py`, `backend/tests/test_a7_account_operations.py` — but
is deferred/experimental per this document, not wired into the main nav.

**Positioning:** AdsOps — BM & Ad Account Manager. A compact, practical multi-BM/ad-account
management tool (comparable to Eztool/Adsmeta), not a campaign or analytics platform.

## Why this supersedes the analytics-heavy A7

The product was drifting toward an "operations platform" (spend dashboards, activity snapshots,
import pipelines, multi-currency analytics) beyond what the actual need calls for. The existing
UI (Registry, BM, Assets, Readiness, Health, Alerts) is already a sufficient foundation — it does
not need to become campaign/analytics software.

## Kept modules (6)

| Module | Goal | MVP |
|---|---|---|
| Dashboard | Quick view of BM/account/alerts | Total BM, total accounts, active/restricted/unknown, new alerts |
| BM & Ad Accounts | Manage list, status, tags, notes | Add/edit/archive, search/filter, account-BM mapping |
| Assets | Manage Pixel/Page | Asset list, map to account/BM, mapping history |
| Bulk Share | Share Pixel/asset in batch | Select Pixel → select many accounts/BMs → preview → confirm → queue/result log |
| Team seats | Invite staff, assign seat/role | Owner/Admin/Member/Viewer, seat limit, account/BM assignment |
| Native Rules | Save/apply rule presets within what the official API supports | Rule templates, target selection, preview, result log |

**Explicitly not in scope right now:** campaign manager, campaign draft, preflight compliance,
landing-page crawler, creative review, complex spend/ROAS analytics, browser automation,
antidetect browser, fingerprint/proxy rotation, auto-appeal.

## Existing modules — role change, not deletion

| Module | Keep or reduce? | New role |
|---|---|---|
| Account Registry | Keep as-is | Core module |
| Business Managers | Keep as-is | Core module |
| Assets | Keep as-is | Core module |
| Readiness | Reduce UI | Small checklist inside Account Detail, not a big top-level menu |
| Account Health | Reduce UI | Simple status only: normal / attention / restricted / unknown |
| Alerts | Keep, simplified | Notify on restricted, stale, operation fail, share fail |
| Telegram Outbox | Keep backend | Only sends important alerts once deployed/tested for real |
| A5 Extension | Keep, don't expand | Only shows account context + status; no complex side panel |
| A6 Preflight | Defer | Not deleted — hide menu / mark experimental |
| A7 (old, analytics) | Cancel/replace | No spend/activity intelligence at this time |

## Primary flow — bulk share

```
Chọn BM → thấy toàn bộ TKQC trong BM → chọn Pixel/Page/Asset → chọn nhiều TKQC cần share
  → xem preview (asset nào → account nào) → xác nhận → queue chạy tuần tự qua API chính thức
  → xem kết quả từng item: success / failed / skipped → alert nếu cần xử lý tay
```

## Primary flow — team

```
Mua/thêm seat → mời nhân viên bằng email → gán role → gán BM/TKQC cụ thể
  → nhân viên chỉ thấy phần được phân → mọi thay đổi lưu Audit Log
```

## "Multi-device security" — clarified

This is **real account security**, not anti-detect:
- Each employee has their own user, never a shared password.
- Session/device list: see which devices are logged in.
- Can revoke one device/session.
- Can log out of all sessions.
- Optional 2FA/TOTP in a later phase.
- Audit log: which user logged in / shared an asset, and when.
- **Explicitly no** fingerprint spoofing, cookie sharing, or antidetect browser.

## Roadmap

- **A7 — Core Simplification & BM Workspace** (this document). No large analytics. Simplify
  menu/UI, make BM the center, BM detail shows its account list, clear asset mapping, simple
  account status, hide/defer Preflight, no new large metric system.
- **A8 — Bulk Asset Share** (highest-value phase next): Pixel sharing batch, Page share batch,
  preview, confirmation, per-account queue, bounded retry, per-item result, audit. **Only through
  the official API/permission the platform grants — never permission-bypassing automation or
  cookie/session-based automation.**
- **A9 — Team Seats & Access Control**: seat plan, invite user, role, BM/account assignment,
  device/session management, revoke device, audit.
- **A10 — Native Rule Presets**: save rule templates, select BM/account, preview rule target,
  apply via native API where permission allows, job log. Not a full campaign rule engine.

## A7 scope in detail

**Keep in main nav:**
```
Overview
Business Managers
Ad Accounts
Assets
Operations
Team
Settings
```

**Hide or mark "Later/Experimental"** (not deleted from backend; moved into Account Detail or
Settings/Admin so the main UI stays compact):
```
Readiness
Account Health
Alerts
Preflight
Audit Log
System Status
```

**BM Detail — 3 tabs:**
```
Accounts
Assets
Activity
```

**Operations page** — a forward-looking placeholder for A8, "Coming next" feature cards only, no
execute button yet in A7:
```
Bulk Pixel Share
Bulk Page Share
Account Creation & Sharing
Native Rule Presets
```

**Simple status card vocabulary:**
```
Active
Needs attention
Restricted
Unknown
```

**Quick actions:**
```
Add Business Manager
Add Ad Account
Add Pixel
Map Asset
Open Bulk Operations
```
