# P1-D1 — audit trước build mockup email độc lập

Ngày 2026-11-26. Dành cho PO/BA và người triển khai.

## Context / Goal

Theo ADSOPS_MASTER_PLAN_2026-11-26.md, MINI_SPEC_PLAYBOOK v2, brief P1 và checklist mockup. Người dùng yêu cầu “làm tiếp bước tiếp theo” sau kế hoạch: thực hiện mockup D1, không schema/API/production.
Mục tiêu: review được luồng tìm email → chi tiết → sửa metadata → xem lại → lưu/hủy bằng fixture tương tác.

## Quyết định / Constraints

Email độc lập; Gmail cá nhân/Microsoft. Owner/admin + assignee được reveal theo cơ chế sau này; list che, CSV không full address. D1 không giả mô phỏng PIN/auth như bảo mật thật, không full-address data cần bảo vệ, không CSV thật. Không secret/provider/network/API/localStorage/sessionStorage. Fixture mang nhãn minh họa, trạng thái manual chưa provider verified. Chưa chốt Microsoft managed/personal thì unknown.
Không stack, route, publish always-on hay server. Các yêu cầu always-on cũ trong skill nhường quy định TTL và phạm vi offline đã giao. Mỗi màn file nhỏ; không Chromium/Playwright/Selenium theo hard rule repo. Test DOM/jsdom được phép, không giả viewport QA.

## Audit / Gap

F1 PersonalAccountReference có owner/email vault/PIN/recovery_note nhưng là identity Facebook, không mailbox độc lập. Assets và tokens.css/index.css là nền bố cục/token, không cần thư viện/biểu đồ mới. Chưa có clickable mockup registry độc lập đủ trạng thái.

## Design Choice / Scope A–E

A: fixture masked example.com, owner/provider/type/state/source/time/due/reason/history, không DB enum.
B: JS local memory, event-driven filter/navigation/draft/review/save/cancel/reset; không persistence/network.
C: không API.
D: index navigation + registry/detail/edit/review mỗi màn file HTML riêng, cùng app.js/design-system.css. Hoạt động file://, dùng iframe same-origin file navigation và state parent nếu hỗ trợ hoặc các script chung không fetch; ưu tiên cơ chế test được. Đủ loading/empty/no results/error/retry/no permission/partial, theme, keyboard focus/error summary.
E: jsdom integration đi qua file/screens actual scripts; secret/network/storage guards; labels, no-permission DOM not leaking rows, draft cancel/save/history and filters. Browser/viewport/contrast QA ghi chưa chạy.

## Tham vấn UI

Đã invoke mockup và ui-ux-pro-max, chạy search --design-system và ux keyboard/loading/error. Chọn data-dense tables, visible focus, alert errors, skip link và native controls. Không chọn landing hero/chart, palette/font Inter của gợi ý vì giữ AdsOps tokens và Be Vietnam Pro có sẵn; không import Google Fonts/CDN. Token RGB sử dụng rgb(var(--token)), theme sáng/tối kế thừa.

## Test / Acceptance / Rollback

Click luồng local chạy được, không dead actions; fixture-only notice luôn thấy, wording [ĐỀ XUẤT — chờ duyệt]. Save chỉ bộ nhớ, refresh/reset phục hồi fixture. Unknown không success. Không cập nhật app production entry point. Manual 375/768/1280/keyboard/contrast chưa chạy nếu không có công cụ hợp lệ. Rollback bỏ docs/mockups/p1-email, không DB/runtime ảnh hưởng.
