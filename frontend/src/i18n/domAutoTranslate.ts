import type { Language } from './types'

const VN_CHAR_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/

const EXACT_TRIMMED: Record<string, string> = {
  "chạy · 🟡": "active · 🟡",
  "nợ · 🔴": "past due · 🔴",
  "tắt": "disabled",
  "cùng": "and",
  ", cùng": ", and",
  "và": "and",
  "chạy": "active",
  "nợ": "past due",
  "khác": "more",
  "Bước": "Step"
}

const PHRASE_PAIRS: Array<[string, string]> = [
  ["Đồng bộ từ Meta Graph API (/me/accounts)", "Synced from Meta Graph API (/me/accounts)"],
  ["Tự động liên kết theo cụm Via Tổng", "Auto-linked via Primary Master Account cluster"],
  ["Công ty công nghệ thông tin", "Information Technology Company"],
  ["Người sáng tạo nội dung số", "Digital Creator"],
  ["Công ty cung cấp Internet", "Internet Service Provider"],
  ["Sản phẩm/Dịch vụ", "Product / Service"],
  ["Nhà bếp/Nấu ăn", "Kitchen / Cooking"],
  ["Công ty phần mềm", "Software Company"],
  ["Công nghệ", "Technology"],
  ["6 TKQC Mắt Bão", "6 Mắt Bão Ad Accounts"],
  ["5 TKQC Mắt Bão", "5 Mắt Bão Ad Accounts"],
  ["6 TKQC", "6 Ad Accounts"],
  ["5 TKQC", "5 Ad Accounts"],
  ["3 TKQC", "3 Ad Accounts"],
  ["TKQC", "Ad Accounts"],
  ["Mạng gốc Văn phòng (Dành riêng Via Tổng Lớp 1)", "Office Direct Line (Reserved for Tier-1 Asset Vias)"],
  ["Proxy Dân cư Tĩnh VN #1 — Cụm BM Quảng Cáo Top", "VN Static Residential Proxy #1 — BM Quang Cao Top Cluster"],
  ["Proxy Dân cư Tĩnh VN #2 — Cụm BM Quảng Cáo Top", "VN Static Residential Proxy #2 — BM Quang Cao Top Cluster"],
  ["Proxy Dân cư Tĩnh VN #3 — Cụm BM Mắt Bão Corp", "VN Static Residential Proxy #3 — BM Mat Bao Corp Cluster"],
  ["Proxy Dân cư Tĩnh VN #4 — Cụm BM Xây Dựng Tân Hòa", "VN Static Residential Proxy #4 — BM Xay Dung Tan Hoa Cluster"],
  ["Proxy Dân cư Tĩnh VN #5 — Cụm Via Dự Phòng Ngâm 72h", "VN Static Residential Proxy #5 — 72h Warm-up Standby Via Cluster"],
  ["Tuyến mạng cách ly cụm Via", "Isolated Via cluster network line"],
  ["Tối đa 2 Via/Proxy", "Max 2 Vias/Proxy"],
  ["Cách ly 1:1 cho Via:", "1:1 Isolated for Via:"],
  ["Share Dataset/Pixel từ BM", "Shared Dataset/Pixel from BM"],
  ["Share Pixel/Dataset từ Trung tâm Quản trị Tài sản", "Shared Pixel/Dataset from Asset Control Center"],
  ["Gán thẻ thanh toán từ Trung tâm Quản trị Tài sản", "Assigned payment card from Asset Control Center"],
  ["Đồng bộ trực tiếp từ phương thức thanh toán Meta Ads", "Synced directly from Meta Ads payment method"],
  ["Hết hạn", "Expires"],
  ["Gán quyền chạy Page từ Trung tâm Quản trị Fanpage", "Assigned Page ad access from Fanpage Control Center"],
  ["Đồng bộ tự động từ promote_pages của TKQC", "Auto-synced from Ad Account promote_pages"],
  ["Tự động liên kết theo cụm BM", "Auto-linked by BM cluster"],
  ["Trang Doanh nghiệp / Thương hiệu", "Business / Brand Page"],
  ["Quầy sinh tố & nước trái cây", "Smoothie & Juice Bar"],
  ["Trang web thương mại điện tử", "E-commerce Website"],
  ["Mua sắm & bán lẻ", "Shopping & Retail"],
  ["Quán ăn", "Restaurant"],
  ["Đồng bộ từ BM", "Synced from BM"],
  [
    "🚫 Khiên Chặn Passkey Tự Động (passkey_shield.js): Tiện ích AdsOps Companion v2.4 Pro khóa thẳng hàm WebAuthn (PublicKeyCredential) ngay trước khi trang Facebook tải xong — bảng Windows Hello / QR Passkey sẽ KHÔNG BAO GIỜ nhảy lên nữa, ép Facebook chuyển thẳng về ô nhập mã 2FA 6 số.",
    "🚫 Automatic Passkey Shield (passkey_shield.js): AdsOps Companion v2.4 Pro overrides WebAuthn (PublicKeyCredential) before Facebook finishes loading — Windows Hello / QR Passkey dialogs NEVER appear, forcing Facebook directly to 6-digit 2FA."
  ],
  [
    "🗑️ Nút 1 Chạm «🚫 Quét & Xoá Passkey» trên bảng Via: Bấm 1 nút trên bảng Tài khoản Facebook (hoặc trong Popup tiện ích), trình duyệt sẽ mở thẳng trang Quản lý Passkey của Meta và tự động phát hiện + bấm Xoá sạch Passkey đang lưu.",
    "🗑️ 1-Click «🚫 Scan & Delete Passkey» Button: Click once on the Facebook Accounts table (or inside the Extension Popup) to open Meta Passkey Management and automatically detect + delete stored Passkeys."
  ],
  [
    "1 Via Tổng (Chỉ giữ BM/TKQC, tuyệt đối không lên camp) + Mỗi cụm khách 1 Via Lên Camp riêng (1 Chrome Profile + 1 Proxy tĩnh) + Luôn có ≥ 2 Via Dự phòng đã ngâm > 7 ngày + Xoá sạch bài Rejected & Canh số dư thẻ.",
    "1 Master Vault Via (Holds BM/Ad Accounts only, never launches campaigns) + 1 Dedicated Media Buying Via per client cluster (1 Chrome Profile + 1 Static Proxy) + Always keep ≥ 2 Standby Vias aged > 7 days + Delete Rejected ads & monitor card balances."
  ],
  [
    "Trạng thái là mã Meta trả về cho reader đã nêu, tại thời điểm quan sát. Không phải quyết định của sản phẩm này, không bảo đảm tài khoản sẽ không bị hạn chế, và không thay cho việc kiểm tra trực tiếp trên Meta.",
    "Status is the raw code returned by Meta for the specified reader at observation time. It is not a decision by this product and does not replace checking Meta directly."
  ],
  [
    "⏳ Giờ 0 – 72h (Ngày 1–3): Đăng nhập Chrome riêng + lấy mã 2FA 6 số ngay trên bảng. CẤM vào Ads Manager, CẤM đổi mật khẩu, CẤM đá thiết bị cũ. Mở xem Watch/Newsfeed 5–10 phút/ngày.",
    "⏳ Hours 0 – 72h (Days 1–3): Log into dedicated Chrome + get 6-digit 2FA from the table. DO NOT open Ads Manager, DO NOT change password, DO NOT kick old devices. Watch/Newsfeed 5–10 mins/day."
  ],
  [
    "Chi tiêu là số Meta trả về cho reader đã nêu, tại thời điểm quan sát. Không phải hoá đơn, không phải số đã đối soát, và không nói gì về việc tài khoản có bị hạn chế hay không.",
    "Spend is the raw amount returned by Meta for the specified reader at observation time. It is not an invoice or reconciled statement."
  ],
  [
    "🧹 Xoá ngay các bài quảng cáo bị Từ chối (Rejected Ads): Không để nguyên bài bị từ chối nằm tồn đọng trong TKQC — hãy Xoá (Delete) hẳn bài lỗi đó đi trước khi lên bài mới.",
    "🧹 Permanently delete Rejected Ads immediately: Never leave rejected ads sitting inside an Ad Account — Delete them completely before launching new creatives."
  ],
  [
    "🛡️ Lớp 1 — Via Tổng / Giữ Tài Sản (1–2 con, VD: Tài Khoản Chính): Cầm Admin BM gốc, giữ Page/Pixel. CẤM bấm tạo camp, CẤM gắn thẻ lỗi. Chỉ mở 1–2 lần/tuần để phân quyền.",
    "🛡️ Tier 1 — Master Vault Via / Asset Holder (1–2 Vias, e.g. Primary Account): Holds root BM Admin, Pages & Pixels. NEVER launch campaigns, NEVER add risky cards. Open only 1–2 times/week to grant access."
  ],
  [
    "💳 Không để \"Đỏ thẻ\" 3 lần liên tiếp: Kiểm tra bảng «Tổng hợp Dư nợ theo từng Thẻ» ở trang Tài khoản quảng cáo để nạp đủ tiền trước ngày cắn bill (1 Thẻ ≤ 3 TKQC).",
    "💳 Avoid 3 consecutive card declines: Check the «Balance Summary by Payment Card» matrix on the Ad Accounts page to fund cards before billing dates (1 Card ≤ 3 Ad Accounts)."
  ],
  [
    "khác dải IP với trình duyệt nuôi Via, hệ thống tự động khóa lệnh Ghi từ Server đối với BM Production. Bạn hãy bấm nút bên dưới để mở thẳng trang quản trị của BM",
    "from a different IP range than the Via's browser, the system locks server-side Write mutations for Production BMs. Click the button below to open BM settings for"
  ],
  [
    "BM mới tạo được 1 TKQC (BM1). Sau khi thanh toán bill đầu tiên tăng lên 3–5 TKQC (BM3/BM5). Sau khi Xác minh doanh nghiệp (XMDN) tăng lên 10 → 30 → 250+ TKQC.",
    "Newly created BMs get 1 Ad Account (BM1). After the first paid bill this increases to 3–5 (BM3/BM5). Business Verification unlocks 10 → 30 → 250+ Ad Accounts."
  ],
  [
    "Từ 2025–2026, Facebook liên tục bật bảng Windows Security đòi Khóa truy cập (Passkey) hoặc gạ tạo Passkey khi đăng nhập Via, làm kẹt cứng Via vào 1 máy tính:",
    "Facebook frequently triggers Windows Security Passkey prompts or Passkey creation upsells during Via logins, locking Vias to a single hardware device:"
  ],
  [
    "Tải và chạy 1 lần trên máy Windows để khi bấm nút Mở Chrome / Kháng nghị / Thanh toán trên web sẽ tự động bật đúng cửa sổ Chrome Profile của Via đó",
    "Download and run once on Windows so clicking Open Chrome / Appeal / Billing on the web automatically launches that Via's exact Chrome Profile window"
  ],
  [
    "Mở Chất lượng tài khoản trên đúng Chrome của Via này để kiểm tra và XOÁ hẳn các bài quảng cáo bị Từ chối (Rejected) — chống chết ngược sang Via",
    "Open Account Quality in this Via's Chrome profile to inspect and permanently DELETE Rejected ads — preventing reverse bans to the Via"
  ],
  [
    "Khi Via Lên Camp bị hạn chế quảng cáo: chỉ mất 30 giây vào Via Tổng gỡ ra và thay Via Dự phòng vào — BM gốc & TKQC khách hàng an toàn 100%.",
    "If a Media Buying Via gets restricted: simply use the Master Via to swap in a Standby Via in 30 seconds — keeping your root BM & client Ad Accounts 100% safe."
  ],
  [
    "Mỗi dòng Via trong mục «Tài khoản Facebook» đều đã được tích hợp Bộ chọn Phân tầng 3 lớp, Đồng hồ canh 72h ngâm & Cảnh báo rủi ro liên đới.",
    "Every Via row in «Facebook Accounts» includes a 3-Tier Role selector, a 72h Warm-up Timer, and Chain-Ban Risk Alerts."
  ],
  [
    "Tuyệt đối không đăng xuất Via này để đăng nhập Via khác trên cùng 1 cửa sổ Chrome. Luôn bấm nút «🚀 Mở Chrome» trên bảng để mở đúng Profile.",
    "Never log out of one Via to log into another inside the same Chrome window. Always click «🚀 Open Chrome» in the table to launch the exact Profile."
  ],
  [
    "Kiểm tra ngay mục Người trong BM trên hệ thống và Business Settings trên Meta: gỡ tài khoản lạ hoặc bấm Xác nhận nối nếu là nhân sự nội bộ.",
    "Immediately check BM Users in the system and Business Settings on Meta: remove unknown users or click Confirm Link for internal staff."
  ],
  [
    "Dù Meta cho phép gắn tới 5–10 TKQC, nhưng nếu gắn quá 3 TKQC chung 1 thẻ thì khi 1 TKQC bị khóa phương thức thanh toán hoặc đỏ thẻ sẽ làm",
    "Although Meta allows 5–10 accounts, linking more than 3 Ad Accounts to a single card means one payment flag will trigger"
  ],
  [
    "🌱 Lớp 3 — Via Dự Phòng Ngâm Sẵn (2–3 con): Đã đăng nhập Chrome riêng, ngâm đủ > 7 ngày, nằm im chờ đôn lên thay thế ngay khi Lớp 2 gãy.",
    "🌱 Tier 3 — Warmed Standby Via (2–3 Vias): Logged into isolated Chrome Profiles, warmed > 7 days, ready to replace Tier 2 immediately if restricted."
  ],
  [
    "Mạng Wifi/dây gốc văn phòng chỉ dùng cho 2–3 Via Lớp 1. Từ Via thứ 4 trở đi (Lớp 2 & Lớp 3) nên gắn Proxy IPv4 Dân cư tĩnh riêng.",
    "Use local office Wi-Fi/LAN for at most 2–3 Tier 1 Vias. From the 4th Via onward (Tier 2 & Tier 3), assign dedicated Static Residential IPv4 Proxies."
  ],
  [
    "Mở thẳng trang Khóa truy cập (Passkey) trên Chrome của Via này để Tiện ích tự động phát hiện & xóa sạch Passkey chỉ với 1 chạm",
    "Open the Passkeys page directly in this Via's Chrome profile so the Extension auto-detects & removes Passkeys in 1 click"
  ],
  [
    "ở góc phải phía trên để cập nhật nhanh Ngưỡng thanh toán, Ngày lập hóa đơn hoặc Thông tin doanh nghiệp của tài khoản này.",
    "button in the top-right to quickly update the Payment Threshold, Bill Date, or Business Information for this account."
  ],
  [
    "⚡ Tự động đóng bảng gạ Tạo Passkey & Tự bấm «Thử cách khác → Ứng dụng xác thực» nếu gặp Via cũ bị chủ trước cài Passkey.",
    "⚡ Auto-dismisses «Create a passkey» upsells & auto-clicks «Try another way → Authentication app» if a Via has a pre-existing Passkey."
  ],
  [
    "Mở trực tiếp trang Thanh toán & Ngưỡng Bill của TKQC này trên Meta (Tiện ích Chrome tự động đồng bộ Ngưỡng & Ngày TT)",
    "Open this Ad Account's Billing & Threshold page directly on Meta (Chrome Extension auto-syncs Threshold & Bill Date)"
  ],
  [
    "Xem Slider 5 bước phân tầng 3 lớp Via, quy trình ngâm 72h vàng, hạn mức 1 Thẻ ≤ 3 TKQC và hồ sơ chuẩn XMDN lên BM10+.",
    "View the 6-step Playbook Slider for 3-Tier Via isolation, 72h warm-up, 1 Card ≤ 3 Ad Accounts rule & BM Verification checklist."
  ],
  [
    "🚀 Lớp 2 — Via Lên Camp (4–5 con): Chỉ nhận quyền Nhà quảng cáo (Advertiser) trên TKQC của khách để lên bài hàng ngày.",
    "🚀 Tier 2 — Media Buying Via (4–5 Vias): Granted Advertiser role only on client Ad Accounts for daily campaign execution."
  ],
  [
    "90% Via chết ngay tuần đầu là do vừa đăng nhập vào máy mới đã bấm vào Trình quản lý quảng cáo hoặc đổi mật khẩu ngay:",
    "90% of Vias banned in the first week fail because operators open Ads Manager or change passwords immediately after logging in on a new PC:"
  ],
  [
    "Nhiều khi Via không tự chết mà bị khóa khả năng quảng cáo do TKQC bên dưới nợ cước hoặc giữ quá nhiều bài bị từ chối:",
    "Often Vias are restricted not from login issues, but because underlying Ad Accounts have unpaid balances or accumulated Rejected ads:"
  ],
  [
    "Ghi nhận sự kiện tài khoản, gửi kháng nghị trên Meta nếu đủ điều kiện, hoặc chuyển ngân sách sang tài khoản dự phòng.",
    "Record an account event, submit an appeal on Meta if eligible, or shift budget to a backup ad account."
  ],
  [
    "Nộp kháng nghị trên Meta nếu có cơ sở, đồng thời chuyển ngân sách sang tài khoản quảng cáo khác và ghi nhận sự kiện.",
    "Submit an appeal on Meta if applicable, reallocate budget to another ad account, and log the event."
  ],
  [
    "Điều chỉnh ngân sách trên Ads Manager hoặc cập nhật lại ngân sách cam kết trên hệ thống nếu đã thống nhất thay đổi.",
    "Adjust budgets in Ads Manager or update the committed budget in the system if agreed."
  ],
  [
    "Biến Google Chrome gốc trên máy thành hệ thống cách ly đa Via, canh dư nợ thẻ & chống chết chùm hoàn toàn miễn phí",
    "Turn native Google Chrome into a multi-Via isolation suite, monitor card balances & prevent chain bans 100% free"
  ],
  [
    "Quản lý danh sách kết nối Graph API, kiểm tra hạn Token 60 ngày và đồng bộ tự động toàn bộ BM, TKQC, Dư nợ & Thẻ.",
    "Manage Graph API connections, check 60-day Token expiry, and auto-sync all BMs, Ad Accounts, Balances & Cards."
  ],
  [
    "✅ Sau Ngày 7: Thiết bị & IP đã được Meta ghi nhận Trusted Device — mới đá các thiết bị lạ cũ và bắt đầu lên camp.",
    "✅ After Day 7: Browser & IP are recognized by Meta as a Trusted Device — safe to remove old sessions and launch campaigns."
  ],
  [
    "Nếu là người lạ: gỡ khỏi BM ngay lập tức, kiểm tra lại Admin và đổi mật khẩu + kiểm tra 2FA cho các hồ sơ giữ BM.",
    "If unauthorized: remove from BM immediately, audit Admins, and rotate passwords + verify 2FA on all BM-holding Vias."
  ],
  [
    "Nếu là nhân sự nội bộ: vào mục Kết nối Meta → Người trong BM để bấm 'Xác nhận nối' với hồ sơ Facebook tương ứng.",
    "If internal staff: go to Meta Connections → BM Users and click 'Confirm link' to match their Facebook profile."
  ],
  [
    "Đang trong 72h đầu: CẤM vào Ads Manager, CẤM đổi mật khẩu, CẤM đá thiết bị cũ. Chỉ lướt Newsfeed/Watch 5–10p.",
    "First 72h warm-up: DO NOT open Ads Manager, DO NOT change password, DO NOT kick old sessions. Browse Newsfeed/Watch 5–10 mins only."
  ],
  [
    "Chạy file .bat (1 lần) để mở đúng Hồ sơ Chrome từ Web & cài gói Tiện ích v2.3 Pro (2FA tự điền, khóa WebRTC).",
    "Run the .bat file (once) to launch the exact Chrome Profile from the Web & install Extension v2.4 Pro (2FA auto-fill, WebRTC shield)."
  ],
  [
    "Không gắn quá 3 TKQC chung 1 thẻ trực tiếp để tránh chết liên đới (bão thẻ) khi 1 TKQC bị khoá hoặc hụt tiền.",
    "Never link more than 3 Ad Accounts directly to 1 card to avoid chain payment bans when an account is disabled or declined."
  ],
  [
    "1 Hồ sơ Chrome = 1 Via cố định · 1 Proxy IPv4 Dân cư tĩnh VN (Viettel/VNPT/FPT) = Tối đa 1–2 Via cùng cụm BM:",
    "1 Chrome Profile = 1 Fixed Via · 1 VN Static Residential IPv4 Proxy (Viettel/VNPT/FPT) = Max 1–2 Vias in the same BM cluster:"
  ],
  [
    "Mở Ads Manager để kiểm tra ngân sách chiến dịch và giới hạn chi tiêu của tài khoản so với ngân sách cam kết.",
    "Open Ads Manager to review campaign budgets and account spending limits against the committed budget."
  ],
  [
    "Chỉ cần chọn Hồ sơ Chrome thật (và Proxy nếu có), hoặc dán Token để tự động điền toàn bộ thông tin từ Meta.",
    "Simply select a real Chrome Profile (and optional Proxy), or paste a Token to auto-fill all details from Meta."
  ],
  [
    "Tự động quét toàn bộ Via (Business Users), Email, 2FA, BM và TKQC từ Meta Graph API mà không cần nhập tay",
    "Automatically scan all Vias (Business Users), Emails, 2FA, BMs, and Ad Accounts from Meta Graph API without manual entry"
  ],
  [
    "Để trống nếu chạy trực tiếp trên Wifi/Mạng gốc. Chỉ dán khi bạn có Proxy thật muốn bọc riêng cho Via này.",
    "Leave blank if running on local Wi-Fi/Direct Network. Only paste when routing a dedicated Proxy for this Via."
  ],
  [
    "🟡 Ngày 4 – Ngày 7: Bắt đầu nhận lời mời vào BM (ưu tiên mời qua Email doanh nghiệp thay vì kết bạn ồ ạt).",
    "🟡 Days 4 – 7: Begin accepting BM invitations (prefer corporate email invites over mass friend requests)."
  ],
  [
    "Mở mục Lập hoá đơn & Thanh toán (Billing) hoặc thông báo xét duyệt trong Ads Manager để xử lý khoản treo.",
    "Open Billing & Payments or review notices in Ads Manager to resolve pending charges."
  ],
  [
    "Kiểm tra ngân sách chiến dịch/nhóm quảng cáo và giới hạn chi tiêu so với ngân sách ngày/tháng đã cam kết.",
    "Check campaign/ad set budgets and spending limits against committed daily/monthly budgets."
  ],
  [
    "🛡️ Kiểm tra Chất lượng tài khoản định kỳ bằng nút «🧹 Dọn bài Rejected» trên đúng Chrome Profile của Via.",
    "🛡️ Audit Account Quality regularly using the «🧹 Clean Rejected Ads» shortcut in the Via's assigned Chrome Profile."
  ],
  [
    "BM mới tạo được 1 TKQC; sau bill đầu tiên lên 3–5 TKQC; Xác minh doanh nghiệp (XMDN) mở 10–30+ TKQC.",
    "New BMs start with 1 Ad Account; after first paid bill 3–5; Business Verification unlocks 10–30+ Ad Accounts."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý ở mục 'Đăng nhập để xử lý' và mở Ads Manager của tài khoản này.",
    "Log in with the managing Facebook account under 'Log in to resolve' and open Ads Manager."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý và mở Cài đặt thanh toán (Billing Settings) trong Ads Manager.",
    "Log in with the managing Facebook account and open Billing Settings in Ads Manager."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý để xử lý nguyên nhân gốc trên Ads Manager / Business Settings.",
    "Log in with the managing Facebook account to resolve the root cause in Ads Manager / Business Settings."
  ],
  [
    "Đăng nhập bằng hồ sơ Facebook giữ quyền Admin BM được liệt kê ở mục 'Hồ sơ FB đăng nhập để xử lý'.",
    "Log in using the BM Admin Facebook profile listed under 'FB Profile to Log In'."
  ],
  [
    "Không dùng VPN miễn phí, 1.1.1.1 hoặc Proxy Datacenter giá rẻ vì dải IP đó bị Meta đánh dấu spam.",
    "Never use free VPNs, 1.1.1.1, or cheap Datacenter Proxies as those IP ranges are flagged by Meta."
  ],
  [
    "Mở Chất lượng tài khoản (Account Quality) và Business Settings để đọc thông báo hạn chế của Meta.",
    "Open Account Quality and Business Settings to read Meta's restriction notice."
  ],
  [
    "Từ ngày 4–7: Có thể nhận link mời BM qua email nhưng chưa nên đá thiết bị cũ hoặc lên camp nặng.",
    "Days 4–7: Safe to accept BM invite links via email, but avoid kicking old devices or launching heavy campaigns yet."
  ],
  [
    "Mở Account Quality và Ads Manager để kiểm tra mã trạng thái và lý do vô hiệu hoá do Meta trả về.",
    "Open Account Quality and Ads Manager to inspect the status code and disable reason returned by Meta."
  ],
  [
    "Kiểm tra giới hạn chi tiêu của tài khoản (Account Spending Limit) so với tổng chi tiêu hiện tại.",
    "Check the Account Spending Limit against current cumulative spend."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý và mở Ads Manager để xem trạng thái thực tế của tài khoản.",
    "Log in with the managing Facebook account and open Ads Manager to inspect live account status."
  ],
  [
    "(1 lần) để mở đúng Hồ sơ Chrome từ Web & cài gói Tiện ích v2.3 Pro (2FA tự điền, khóa WebRTC).",
    "(once) to open the exact Chrome Profile from Web & install Extension v2.4 Pro (2FA auto-fill, WebRTC shield)."
  ],
  [
    "Tuyệt đối tách bạch quyền Sở hữu Tài sản (Admin BM) và quyền Lên Chiến dịch (Advertiser TKQC):",
    "Strictly separate Asset Ownership (BM Admin) from Campaign Execution (Ad Account Advertiser):"
  ],
  [
    "Mở tab Tổng quan của tài khoản để so sánh trạng thái Meta trả về với trạng thái đang ghi nhận.",
    "Open the account Overview tab to compare the observed Meta status against the recorded status."
  ],
  [
    "So sánh chi tiêu của từng chiến dịch/nhóm quảng cáo với trung vị các ngày hoàn chỉnh trước đó.",
    "Compare campaign/ad set spend against the median of prior complete days."
  ],
  [
    "Mở trang Cài đặt → Quyền đọc Meta để xem trạng thái của kết nối đang báo lỗi hoặc sắp hết hạn.",
    "Open Settings → Meta Reader Credentials to check connections that are failing or expiring soon."
  ],
  [
    "Kiểm tra trên Ads Manager bằng tài khoản Facebook quản lý nếu sự kiện liên quan đến vận hành.",
    "Check Ads Manager using the managing Facebook account if the event is operational."
  ],
  [
    "Mở Business Settings → Users → People của BM này để kiểm tra ngay các tài khoản vừa thay đổi.",
    "Open Business Settings → Users → People for this BM to inspect recently changed users."
  ],
  [
    "Chạy 1 lần trên máy Windows để kích hoạt giao thức mở đúng cửa sổ Chrome Profile từ trên Web",
    "Run once on Windows to activate the protocol that opens the exact Chrome Profile window from the Web"
  ],
  [
    "Thiết bị Chrome & IP của Via này đã đủ độ tin cậy (Trusted Device). Có thể vận hành ổn định.",
    "This Via's Chrome device & IP have reached Trusted Device status. Ready for stable operations."
  ],
  [
    "Không bao giờ dùng chung 1 con Via vừa cầm BM gốc vừa bấm lên chiến dịch nhạy cảm cho khách.",
    "Never use the same Via to both hold root Business Managers and launch client ad campaigns."
  ],
  [
    "Điều chỉnh ngân sách trên Ads Manager nếu cần và ghi nhận nguyên nhân vào Sự kiện tài khoản.",
    "Adjust budgets in Ads Manager if needed and record the cause in Account Events."
  ],
  [
    "để tránh Meta quét lệch IP khi tạo/share tài sản. Khi cần tạo TKQC hoặc phân quyền, hãy bấm",
    "to prevent Meta IP mismatch flags when creating/sharing assets. To create Ad Accounts or grant access, click"
  ],
  [
    "Kiểm tra Chất lượng tài khoản (Account Quality) để xác nhận lý do tài khoản bị vô hiệu hoá.",
    "Check Account Quality to confirm why the ad account was disabled."
  ],
  [
    "Kháng nghị trên Meta hoặc điều phối lại ngân sách, sau đó ghi nhận kết quả vào tab Sự kiện.",
    "Submit an appeal on Meta or reallocate budget, then log the outcome in the Events tab."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý và mở Ads Manager tại đúng ngày có biến động chi tiêu.",
    "Log in with the managing Facebook account and open Ads Manager for the date with abnormal spend."
  ],
  [
    "Mở tab Mức sẵn sàng (Readiness) của tài khoản để xem các mục bắt buộc còn thiếu bằng chứng.",
    "Open the account's Readiness tab to see mandatory checklist items missing evidence."
  ],
  [
    "Kiểm tra xem tài khoản quảng cáo còn thuộc BM và còn được gán cho người đọc Meta hay không.",
    "Check whether the ad account still belongs to the BM and is assigned to the Meta reader user."
  ],
  [
    "Bấm cập nhật trạng thái ghi nhận kèm ghi chú nếu thông tin từ Meta là trạng thái mới nhất.",
    "Update the recorded status with a note if the Meta observation reflects the latest state."
  ],
  [
    "Đã tự động lấy toàn bộ danh sách Via (Business Users), BM và TKQC thật từ Meta Graph API.",
    "Automatically fetched all live Vias (Business Users), BMs, and Ad Accounts from Meta Graph API."
  ],
  [
    "Tên công ty đầy đủ, Mã số thuế, Địa chỉ trụ sở và Số điện thoại trùng khớp 100% với GPKD.",
    "Full legal company name, Tax ID, registered address, and phone number matching the certificate 100%."
  ],
  [
    "Nếu tài khoản đã chuyển sang BM khác hoặc ngừng dùng, hãy cập nhật BM hoặc lưu trữ hồ sơ.",
    "If the account moved to another BM or is retired, update its BM or archive the record."
  ],
  [
    "Chặn đứng bảng Passkey (Windows Hello) & 1 chạm Tự động Xoá Passkey trong Account Center",
    "Block Passkey (Windows Hello) Prompts & 1-Click Auto-Delete Passkey in Accounts Center"
  ],
  [
    "Mở tab Mức sẵn sàng (Readiness) để xem các mục có bằng chứng đã hết hạn hoặc bị từ chối.",
    "Open the Readiness tab to inspect items with expired or rejected evidence."
  ],
  [
    "Quản trị viên (ADMIN) có mặt ở lần quét đầy đủ trước nhưng không còn trong lần quét này.",
    "ADMIN was present in the previous full scan but is missing from this scan."
  ],
  [
    "Xác nhận nhập vào danh mục hoặc cập nhật hồ sơ tài khoản Facebook quản lý BM tương ứng.",
    "Confirm importing into the registry or update the corresponding BM-managing Facebook profile."
  ],
  [
    "Thực hiện kết nối lại (Reconnect) để khôi phục việc đọc chi tiêu và trạng thái tự động.",
    "Reconnect the credential to restore automated spend and status syncing."
  ],
  [
    "Bấm khi bạn vừa đăng nhập Via mới vào Chrome để bật đồng hồ đếm ngược 72h ngâm an toàn",
    "Click after logging a new Via into Chrome to start the 72h safe warm-up countdown timer"
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý và rà soát tình trạng tài khoản trên Ads Manager.",
    "Log in with the managing Facebook account and review account status in Ads Manager."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý BM và mở Business Settings → Tài khoản quảng cáo.",
    "Log in with the BM-managing Facebook account and open Business Settings → Ad Accounts."
  ],
  [
    "Rà soát các tài khoản quảng cáo mới phát hiện hoặc không còn xuất hiện trong lần quét.",
    "Review newly discovered ad accounts or accounts missing from the latest scan."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý ở mục 'Đăng nhập để xử lý' để kiểm tra trên Meta.",
    "Log in with the managing Facebook account under 'Log in to resolve' to check on Meta."
  ],
  [
    "Mở trang Chất lượng tài khoản (Account Quality) trên Meta để kiểm tra hoặc kháng nghị",
    "Open Meta Account Quality to inspect or submit appeal"
  ],
  [
    "Quản trị viên (ADMIN) đã xác nhận nối nhưng không còn trong lần quét đầy đủ mới nhất.",
    "Confirmed ADMIN is missing from the latest full discovery scan."
  ],
  [
    "tích hợp 2FA 6 số tự điền, khóa rò rỉ WebRTC, Cookie/Token và file mở Chrome tự động",
    "with 6-digit 2FA auto-fill, WebRTC leak shield, Cookie/Token tools & 1-click Chrome launcher"
  ],
  [
    "Tăng hoặc đặt lại giới hạn chi tiêu trên Meta nếu chiến dịch cần tiếp tục phân phối.",
    "Increase or reset the Account Spending Limit on Meta so campaigns can continue delivering."
  ],
  [
    "Mở tab Sự kiện của tài khoản quảng cáo để đọc chi tiết sự kiện nghiêm trọng đang mở.",
    "Open the ad account's Events tab to review details of the open critical event."
  ],
  [
    "Ghi nhận sự kiện tài khoản và kiểm tra lại ở lần đọc trạng thái tiếp theo từ Meta.",
    "Log an account event and verify again on the next Meta status sync."
  ],
  [
    "Mở tab Tổng quan của tài khoản trên hệ thống và ghi nhận kết quả rà soát thủ công.",
    "Open the account Overview tab and log the manual review outcome."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý nếu cần xác minh trực tiếp trên Ads Manager.",
    "Log in with the managing Facebook account if direct verification in Ads Manager is needed."
  ],
  [
    "Chặn \"Chết ngược\" từ Thẻ bị từ chối (Đỏ thẻ) & Bài quảng cáo vi phạm (Rejected)",
    "Prevent Reverse Chain-Bans from Declined Cards & Rejected Ads"
  ],
  [
    "Khai báo trong Cài đặt BM phải khớp 100% từng dấu chấm, dấu phẩy với trên GPKD.",
    "Business Info in BM Settings must match the registration certificate 100% character-for-character."
  ],
  [
    "Mở tab Chi tiêu của tài khoản quảng cáo để xem mã lỗi của các lần đọc gần nhất.",
    "Open the ad account's Spend tab to inspect error codes from recent sync runs."
  ],
  [
    "Dán chuỗi khóa 2FA (Secret Key) để tự động lấy mã OTP 6 số trực tiếp trên bảng",
    "Paste 2FA Secret Key (Base32) to generate live 6-digit OTP codes directly in the table"
  ],
  [
    "Cập nhật bằng chứng mới còn hiệu lực hoặc ghi nhận lý do miễn trừ nếu phù hợp.",
    "Upload valid new evidence or record an exemption reason if applicable."
  ],
  [
    "Trạng thái tài khoản đang bị Hạn chế / Nợ cước trên Meta — cần kiểm tra ngay.",
    "Account status is Restricted / Past Due on Meta — immediate review required."
  ],
  [
    "để tránh chết liên đới (bão thẻ) khi 1 TKQC bị vô hiệu hoá hoặc thẻ hụt tiền.",
    "to prevent chain payment bans when 1 Ad Account is disabled or declined."
  ],
  [
    "Đăng nhập đúng tài khoản Facebook quản lý Business Manager của tài khoản này.",
    "Log in with the Facebook account that manages this ad account's Business Manager."
  ],
  [
    "Mở Ads Manager để xác nhận đơn vị tiền tệ chính thức của tài khoản quảng cáo.",
    "Open Ads Manager to confirm the official currency of the ad account."
  ],
  [
    "Mở tab Mức sẵn sàng của tài khoản để bổ sung các thông tin rà soát còn trống.",
    "Open the account's Readiness tab to complete any remaining review fields."
  ],
  [
    "Đồng bộ trực tiếp từ phương thức thanh toán Meta Ads (funding_source_details)",
    "Synced directly from Meta Ads payment methods (funding_source_details)"
  ],
  [
    "Kiểm tra kết nối Meta và quyền đọc của Business Manager trong trang Cài đặt.",
    "Check the Meta Connection and Business Manager read permissions in Settings."
  ],
  [
    "Mở tab Sự kiện của tài khoản quảng cáo để xem nội dung cảnh báo đã ghi nhận.",
    "Open the ad account's Events tab to view the recorded warning details."
  ],
  [
    "Mở trang Cài đặt thanh toán của tài khoản này trên Meta để thanh toán dư nợ",
    "Open Meta Billing Settings for this account to pay balance"
  ],
  [
    "Xử lý từng mục checklist hoặc sự kiện đang mở theo hướng dẫn trên màn hình.",
    "Resolve each checklist item or open event following the on-screen instructions."
  ],
  [
    "Bảng Kiểm Soát Hạn Mức BM Thực Tế (BM1 → BM5 → BM10+ XMDN) & Dư Nợ Theo BM",
    "Live BM Quota Matrix (BM1 → BM5 → BM10+ Verified) & Balance by BM"
  ],
  [
    "Chủ không gian làm việc có thể bấm 'Đọc lại từ Meta' để kiểm tra lại ngay.",
    "A workspace owner can click 'Re-read from Meta' to re-verify immediately."
  ],
  [
    "Bấm tính lại sức khoẻ tài khoản để đóng cảnh báo khi bằng chứng đã hợp lệ.",
    "Click Recalculate Health to close the alert once evidence is valid."
  ],
  [
    "Mở tab Sức khoẻ (Health) của tài khoản quảng cáo và bấm tính lại sức khoẻ.",
    "Open the ad account's Health tab and click Recalculate Health."
  ],
  [
    "Kiểm soát 20+ TKQC trên 1 bảng, lọc 1 chạm các TK có dư nợ và giữ quy tắc",
    "Control 20+ Ad Accounts in one table, filter accounts with balance in 1 click, and enforce"
  ],
  [
    "Mở Account Center trên đúng Chrome của Via này và tự động bấm Xoá Passkey",
    "Open Accounts Center in this Via's Chrome profile and auto-click Delete Passkey"
  ],
  [
    "để đăng nhập Via mới không cần mật khẩu (chống CP 956) và bắt nhanh Token",
    "to log into new Vias without password prompts (avoiding CP 956) and extract"
  ],
  [
    "Đối chiếu mã trạng thái lạ Meta trả về với thông báo trên giao diện Meta.",
    "Compare the unrecognized Meta status code against the notice shown in Meta's UI."
  ],
  [
    "Bảo vệ Via Tổng: Chỉ giữ BM & Share quyền, tuyệt đối không bấm tạo camp.",
    "Master Via Protection: Hold BMs & share access only — never launch ad campaigns from this Via."
  ],
  [
    "Rà soát thủ công định kỳ: Tài khoản này chưa từng được rà soát thủ công.",
    "Periodic manual review: This account has never been manually reviewed."
  ],
  [
    "Cần mở Chrome quản trị để kiểm tra chất lượng tài khoản hoặc kháng nghị.",
    "Open the managing Chrome profile to inspect Account Quality or submit an appeal."
  ],
  [
    "Đăng nhập tài khoản Facebook quản lý Business Manager của tài khoản này.",
    "Log in with the Facebook account managing this account's Business Manager."
  ],
  [
    "So sánh với đơn vị tiền tệ đang lưu trong hồ sơ tài khoản trên hệ thống.",
    "Compare it with the currency stored in the internal account profile."
  ],
  [
    "Nhập nhanh Ngưỡng thanh toán, Ngày TT hoặc Giới hạn ngày từ Billing Hub",
    "Quickly update Payment Threshold, Bill Date, or Daily Spend Limit from Billing Hub"
  ],
  [
    "Cần xác minh danh tính hoặc kháng nghị trên trang Chất lượng tài khoản.",
    "Complete identity verification or appeal in Meta Account Quality."
  ],
  [
    "1. Chọn Tài khoản Facebook (Via) để nạp sẵn cấu hình thật vào Tiện ích:",
    "1. Select Facebook Account (Via) to pre-load live config into the Extension:"
  ],
  [
    "Cập nhật lại đơn vị tiền tệ trong hồ sơ nếu bản ghi nội bộ bị nhập sai.",
    "Update the profile currency if the internal record was entered incorrectly."
  ],
  [
    "Mở tab Mức sẵn sàng của tài khoản để xem danh sách các lý do đang chặn.",
    "Open the account's Readiness tab to view the list of blocking reasons."
  ],
  [
    "Chạy lại đánh giá sức khoẻ tài khoản sau khi dữ liệu đầu vào đã đầy đủ.",
    "Re-run account health evaluation once input data is complete."
  ],
  [
    "Kiểm tra lịch sử các lần chạy đánh giá (Evaluation Runs) để xem mã lỗi.",
    "Check the Evaluation Runs history to inspect the error code."
  ],
  [
    "Dán IP:Port:User:Pass (VD: 103.145.67.89:8080:user:pass) hoặc để trống",
    "Paste IP:Port:User:Pass (e.g. 103.145.67.89:8080:user:pass) or leave blank"
  ],
  [
    "Kiểm tra nợ cước / hóa đơn: Tài khoản đang có nợ cước chưa thanh toán.",
    "Billing / balance check: Account has an unpaid balance due."
  ],
  [
    "Chưa ghi nhận trạng thái tài khoản nên chưa thể xác nhận mức sẵn sàng.",
    "Account status has not been observed yet; readiness cannot be confirmed."
  ],
  [
    "Xác minh tên miền (Domain Verification) bằng bản ghi DNS TXT trong BM.",
    "Complete Domain Verification via DNS TXT record in Business Settings."
  ],
  [
    "Manifest V3 · Chặn & Tự Xoá Passkey 1 Chạm + 2FA Tự Điền + Khóa WebRTC",
    "Manifest V3 · 1-Click Passkey Blocker & Remover + 2FA Auto-Fill + WebRTC Shield"
  ],
  [
    "Đăng nhập đúng tài khoản Facebook ở mục 'Đăng nhập để xử lý' bên dưới.",
    "Log in with the assigned Facebook account listed under 'Log in to resolve' below."
  ],
  [
    "Mở chi tiết cảnh báo và kiểm tra bằng chứng đã ghi nhận trên hệ thống.",
    "Open the alert details and inspect the recorded evidence."
  ],
  [
    "Thực hiện bước xử lý phù hợp và ghi nhận kết quả vào nhật ký cảnh báo.",
    "Complete the appropriate remediation step and log the result in the alert history."
  ],
  [
    "Dán Token EAAB... của Via vào đây để tự động tạo & điền hết thông tin",
    "Paste the Via's EAAB... Token here to auto-create & populate all details"
  ],
  [
    "Mở thẳng trang Cài đặt BM này trên đúng cửa sổ Chrome Profile của Via",
    "Open this BM Settings page directly in the Via's dedicated Chrome Profile window"
  ],
  [
    "Kết nối tự động bằng Token Facebook (Tự động lấy Tên, ID, Email & BM)",
    "Auto-Connect via Facebook Token (Fetches Name, ID, Email & BMs)"
  ],
  [
    "Tùy chọn nâng cao (ID Meta, 2FA, Người giữ, Ghi chú — Không bắt buộc)",
    "Advanced Options (Meta ID, 2FA, Holder, Notes — Optional)"
  ],
  [
    "Đánh dấu hoàn tất (Resolve) sự kiện kèm lý do sau khi đã xử lý xong.",
    "Mark the event as Resolved with a reason once the issue is fixed."
  ],
  [
    "Mở trang Kết nối Meta để xem kết quả quét khám phá tài sản mới nhất.",
    "Open Meta Connections to review the latest asset discovery scan."
  ],
  [
    "Token đã hết hạn — Hãy dán lại Token mới ở thanh Đồng bộ phía trên.",
    "Token has expired — Please paste a fresh Token in the Quick Sync bar above."
  ],
  [
    "Meta Access Token (Tự động đổi sang Token 60 ngày & lưu két mã hoá)",
    "Meta Access Token (Auto-exchanges for 60-day Token & stores in encrypted vault)"
  ],
  [
    "Cách ly tuyệt đối Hồ sơ Google Chrome thật & Proxy IPv4 Dân cư tĩnh",
    "Strict Isolation of Local Google Chrome Profiles & Static Residential IPv4 Proxies"
  ],
  [
    "Bật 2FA cho toàn bộ Quản trị viên trong BM trước khi bấm gửi duyệt.",
    "Enable 2FA for all Business Manager Admins before submitting verification."
  ],
  [
    "Business Manager chủ quản đã Xác minh doanh nghiệp (XMDN) trên Meta",
    "Owning Business Manager has completed Business Verification on Meta"
  ],
  [
    "Bọc Proxy riêng cho từng Hồ sơ Chrome, tự điền mật khẩu ngầm và bật",
    "Route dedicated Proxies per Chrome Profile, silently authenticate, and enable"
  ],
  [
    "Kiểm tra lại trạng thái sẵn sàng sau khi hệ thống tự động tính lại.",
    "Verify the updated readiness status after automatic recalculation."
  ],
  [
    "Mở trang chi tiết tài khoản quảng cáo và bấm tính lại mức sẵn sàng.",
    "Open the ad account detail page and click Recalculate Readiness."
  ],
  [
    "Hồ sơ trình duyệt (Profile): Chưa gán Profile trình duyệt cố định.",
    "Browser Profile: No fixed browser profile assigned yet."
  ],
  [
    "Thấy rõ Tên pháp nhân, Mã số thuế, Địa chỉ trụ sở, Người đại diện.",
    "Must clearly display Legal Entity Name, Tax ID, Registered Address, and Legal Representative."
  ],
  [
    "Tài khoản từng giữ quyền ADMIN ở lần quét trước nhưng hiện tại là ",
    "Account held ADMIN role in the previous scan but is now "
  ],
  [
    "Không tìm thấy mã BM này hoặc Via đọc chưa được cấp quyền vào BM.",
    "BM ID not found or the reader Via does not have permission on this BM."
  ],
  [
    "Rà soát quyền Quản trị viên (Admin): Phát hiện rủi ro phân quyền.",
    "Admin access review: Permission risk detected."
  ],
  [
    "Liên kết Trang Fanpage: Chưa gắn Fanpage hoạt động cho tài khoản.",
    "Facebook Page link: No active Facebook Page linked to this account."
  ],
  [
    "Tự động sinh mã 2FA 6 số ngay trong Tiện ích Chrome và hỗ trợ nút",
    "Generates live 6-digit 2FA codes inside the Chrome Extension with a"
  ],
  [
    "Cập nhật trạng thái hoặc thêm sự kiện nếu phát hiện thay đổi mới.",
    "Update account status or add an event if new changes are observed."
  ],
  [
    "Rà soát quyền Quản trị viên (Admin): Mục này chưa được kiểm tra.",
    "Admin access review: This item has not been checked yet."
  ],
  [
    "Đính kèm bằng chứng xác minh hoặc hoàn tất rà soát cho từng mục.",
    "Attach verification evidence or complete the review for each item."
  ],
  [
    "Quy tắc \"Ngâm 72 Giờ Vàng & 7 Ngày Trust\" khi mới đăng nhập Via",
    "The \"72-Hour Golden Warm-up & 7-Day Trust\" Protocol for New Vias"
  ],
  [
    "Để trống = Mạng gốc · Hoặc nhập IP:Port:User:Pass thật của bạn",
    "Leave blank = Direct Network · Or enter your live IP:Port:User:Pass"
  ],
  [
    "🌐 Chỗ mua & Quản lý Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):",
    "🌐 Recommended VN Static Residential IPv4 Proxy Providers (1–2 Vias/Proxy):"
  ],
  [
    "4. Hạn mức 1 Proxy IPv4 Dân cư tĩnh → Tài khoản Facebook (Via)",
    "4. 1 Static Residential IPv4 Proxy → Facebook Via Limit"
  ],
  [
    "Tính lại mức sẵn sàng để xác định rõ trạng thái của tài khoản.",
    "Recalculate readiness to determine the account's current status."
  ],
  [
    "Đăng nhập đúng tài khoản Facebook đã cấp quyền cho kết nối đó.",
    "Log in with the Facebook account that granted permission for that connection."
  ],
  [
    "Xác nhận Business Manager: BM đang gặp sự cố hoặc bị hạn chế.",
    "Business Manager confirmation: BM has an issue or restriction."
  ],
  [
    "Phương thức thanh toán (PTTT): PTTT đang lỗi hoặc bị từ chối.",
    "Payment method: Payment method failed or was declined."
  ],
  [
    "Nhóm 2: Giấy tờ xác minh Địa chỉ & Số điện thoại (Trùng GPKD)",
    "Group 2: Address & Phone Verification Documents (Matching Registration)"
  ],
  [
    "Gán Hồ sơ Chrome cố định, phân tầng 3 lớp & lấy mã 2FA 6 số.",
    "Assign fixed Chrome Profiles, 3-tier Via roles & live 6-digit 2FA codes."
  ],
  [
    "Nhóm 1: Giấy tờ pháp lý doanh nghiệp (Bản scan màu rõ 4 góc)",
    "Group 1: Official Business Registration (Clear color scan showing all 4 corners)"
  ],
  [
    "Đóng gói Tiện ích Chrome (.zip) theo từng Via & Hồ sơ Chrome",
    "Build Custom Chrome Extension (.zip) per Via & Chrome Profile"
  ],
  [
    "Theo dõi hạn mức BM1 / BM5 / BM10 (Đã XMDN) & đồng bộ Meta.",
    "Track BM1 / BM5 / BM10 (Verified) quotas & Meta sync."
  ],
  [
    "Bảo mật 2 lớp (2FA): Chưa xác nhận bật 2FA cho VIA quản lý.",
    "Two-factor authentication (2FA): 2FA not yet confirmed for managing Via."
  ],
  [
    "Mức chi tiêu dự kiến hôm nay của bạn nằm trong giới hạn này",
    "Your projected daily spend is within this limit"
  ],
  [
    "Tiện ích Google Chrome chính thức · v2.4 Pro (Anti-Passkey)",
    "Official Google Chrome Extension · v2.4 Pro (Anti-Passkey)"
  ],
  [
    "Token thiếu quyền đọc BM (ads_read / business_management).",
    "Token is missing BM read permissions (ads_read / business_management)."
  ],
  [
    "Xác nhận Business Manager: Chưa gắn hoặc chưa xác nhận BM.",
    "Business Manager confirmation: BM not linked or unconfirmed."
  ],
  [
    "Hồ sơ trình duyệt (Profile): Profile trình duyệt đang lỗi.",
    "Browser Profile: Assigned browser profile has an issue."
  ],
  [
    "2. Hạn mức 1 Business Manager → Tài khoản quảng cáo (TKQC)",
    "2. 1 Business Manager → Ad Account Limit"
  ],
  [
    "Hồ sơ nội bộ ghi nhận quyền ADMIN nhưng Meta trả về quyền ",
    "Internal profile records ADMIN role, but Meta returned "
  ],
  [
    "Nhập ID BM hoặc ID TKQC (để trống = đồng bộ toàn bộ 5 BM)",
    "Enter BM ID or Ad Account ID (leave blank = sync all 5 BMs)"
  ],
  [
    "Liên kết Trang Fanpage: Fanpage liên kết đang bị hạn chế.",
    "Facebook Page link: Linked Facebook Page is restricted."
  ],
  [
    "(Hóa đơn điện, nước, cước Internet VNPT / Viettel / FPT).",
    "(Electricity, water, or telecom/internet invoice in company name)."
  ],
  [
    "Tải file Excel/CSV đối soát toàn bộ Dư nợ, Chi tiêu & Thẻ",
    "Download Excel/CSV reconciliation report for all Balances, Spend & Cards"
  ],
  [
    "Trung tâm Tiện ích Google Chrome («AdsOps Companion Pro»)",
    "Google Chrome Extension Center («AdsOps Companion Pro»)"
  ],
  [
    "Trạng thái tài khoản đã bị Vô hiệu hóa / Đóng trên Meta.",
    "Account status is Disabled / Closed on Meta."
  ],
  [
    "Công thức vận hành bất tử cho Agency chạy Ads khách hàng",
    "Bulletproof Agency Operating Formula for Client Ad Accounts"
  ],
  [
    "nhận quyền Quản trị / Partner không giới hạn số lượng BM",
    "receive Admin / Partner access to an unlimited number of BMs"
  ],
  [
    "1. Hạn mức 1 Tài khoản Facebook (Via) → Business Manager",
    "1. 1 Facebook Account (Via) → Business Manager Limit"
  ],
  [
    "3. Hạn mức 1 Thẻ Visa / Mastercard → Tài khoản quảng cáo",
    "3. 1 Visa / Mastercard → Ad Account Limit"
  ],
  [
    "Mua & Quản lý Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):",
    "Buy & Manage VN Static Residential IPv4 Proxies (1–2 Vias/Proxy):"
  ],
  [
    "Ghi nhận kết quả kiểm tra vào tab Sự kiện của tài khoản.",
    "Record your inspection findings in the account's Events tab."
  ],
  [
    "Cần mở trang Lập hoá đơn trên Meta để thanh toán dư nợ.",
    "Open Meta Billing to settle the outstanding balance."
  ],
  [
    "Thanh toán, Ngưỡng Bill & Thông tin Doanh nghiệp (Meta)",
    "Billing, Payment Threshold & Business Info (Meta)"
  ],
  [
    "(có tên công ty + địa chỉ trụ sở + mộc ngân hàng), hoặc",
    "(showing company name + registered address + bank stamp), or"
  ],
  [
    "Nhóm 3: Tên miền (Domain) & Chân trang Website (Footer)",
    "Group 3: Verified Domain & Website Footer"
  ],
  [
    "BM10 — Đã Xác minh doanh nghiệp / XMDN (Tối đa 10 TKQC)",
    "BM10 — Business Verified (Max 10 Ad Accounts)"
  ],
  [
    "Bất thường IP quản trị (Checkpoint 956 / Khóa tạo TKQC)",
    "Admin IP Mismatch (Checkpoint 956 / Ad Account Creation Block)"
  ],
  [
    "Xem Slider 5 bước chống die Via/TKQC & Checklist XMDN.",
    "View the Anti-Ban Playbook Slider & Business Verification checklist."
  ],
  [
    "Kiểm tra nợ cước / hóa đơn: Mục này chưa được rà soát.",
    "Billing / balance check: This item has not been reviewed yet."
  ],
  [
    "Liên kết Pixel: Chưa gắn Pixel theo dõi cho tài khoản.",
    "Pixel link: No tracking Pixel linked to this account."
  ],
  [
    "Rà soát thủ công định kỳ: Đã quá hạn rà soát thủ công.",
    "Periodic manual review: Manual review is overdue."
  ],
  [
    "3. Proxy riêng (Tùy chọn — Bỏ trống nếu dùng Mạng gốc)",
    "3. Dedicated Proxy (Optional — Leave blank for Direct Network)"
  ],
  [
    "Dư nợ hiện tại, Ngưỡng thanh toán, Giới hạn ngày (DSL)",
    "Current Balance, Payment Threshold, Daily Spend Limit (DSL)"
  ],
  [
    "Mở trang Chất lượng tài khoản trên đúng Chrome Profile",
    "Open Account Quality in the assigned Chrome Profile"
  ],
  [
    "Nếu lỗi tiếp diễn, kiểm tra trang Trạng thái hệ thống.",
    "If the error persists, check the System Status page."
  ],
  [
    "Phương thức thanh toán (PTTT): Chưa rà soát thẻ/PTTT.",
    "Payment method: Card/payment method has not been reviewed yet."
  ],
  [
    "Meta ghi nhận tài khoản đã đóng hoặc ngừng hoạt động.",
    "Meta reports that this ad account is closed or inactive."
  ],
  [
    "Tài khoản đang có khoản thanh toán đến hạn cần xử lý.",
    "This account has an overdue payment that requires attention."
  ],
  [
    "Chia dàn Via thành 3 Lớp tách biệt hoàn toàn nhiệm vụ",
    "Divide Your Vias into 3 Strictly Separated Operational Tiers"
  ],
  [
    "Hồ sơ chuẩn để Xác Minh Doanh Nghiệp (XMDN lên BM10+)",
    "Required Documents for Business Verification (Unlock BM10+)"
  ],
  [
    "Nhóm 4: Email theo tên miền & Bật bảo mật 2 lớp (2FA)",
    "Group 4: Custom Domain Email & Two-Factor Authentication (2FA)"
  ],
  [
    "2. Hồ sơ Google Chrome thật trên máy tính (Mở 1 chạm)",
    "2. Local Google Chrome Profile (1-Click Launch)"
  ],
  [
    "Bản xem trước trực tiếp khi mở Tiện ích trên Chrome (",
    "Live Extension Preview in Chrome ("
  ],
  [
    "Chi tiêu ngày thấp hơn nhiều so với ngân sách cam kết",
    "Daily spend significantly below committed budget"
  ],
  [
    "Chống Checkpoint 956/282 · Chống Chết Chùm BM & TKQC",
    "Prevent Checkpoint 956/282 · Prevent BM & Ad Account Chain-Bans"
  ],
  [
    "Business Manager chưa hoàn tất Xác minh doanh nghiệp",
    "Business Manager has not completed Business Verification yet"
  ],
  [
    "ở trên rồi giải nén ra một thư mục cố định trên máy.",
    "above and extract it to a permanent folder on your PC."
  ],
  [
    "Đánh dấu hoàn tất sự kiện kèm ghi chú kết quả xử lý.",
    "Resolve the event with a note summarizing the outcome."
  ],
  [
    "Hướng dẫn & Công Thức Vận Hành Chống Die Via / TKQC",
    "Anti-Ban Operations Guide & Playbook for Vias / Ad Accounts"
  ],
  [
    "Mở Trình quản lý quảng cáo bằng đúng Chrome Profile",
    "Open Ads Manager in the assigned Chrome Profile"
  ],
  [
    "Bản xem trước trực tiếp khi mở Tiện ích trên Chrome",
    "Live Interactive Extension Preview on Chrome"
  ],
  [
    "Kiểm tra chi tiêu, dư nợ & hạn mức 1 Thẻ ≤ 3 TKQC.",
    "Monitor spend, balances & 1 Card ≤ 3 Ad Accounts safe limit."
  ],
  [
    "để đội ngũ vận hành tra cứu và áp dụng thống nhất.",
    "for media buying teams to reference and apply consistently."
  ],
  [
    "Mạng Wifi văn phòng chỉ nuôi tối đa 2–3 Via chính.",
    "Office Wi-Fi should only host at most 2–3 primary Vias."
  ],
  [
    "Tải thêm file kích hoạt mở Chrome tự động (.bat) →",
    "Download 1-Click Chrome Launcher Setup (.bat) →"
  ],
  [
    "Tắt đồng hồ ngâm 72h khi Via đã hoạt động ổn định",
    "Dismiss the 72h warm-up timer once the Via is stable"
  ],
  [
    "Bảng 4 Hạn Mức An Toàn Meta (Chống Chết Liên Đới)",
    "4 Meta Safe Limits Matrix (Anti-Chain-Ban)"
  ],
  [
    "Quy chuẩn Cách ly Tài sản & Chống Chết Liên Đới →",
    "Asset Isolation & Anti-Chain-Ban Standards →"
  ],
  [
    "Bấm để xem chi tiết và xử lý trạng thái tài khoản",
    "Click to view details and resolve account status"
  ],
  [
    "và mở thẳng trang xử lý (đồng thời copy sẵn link)",
    "and open the resolution page directly (also copies link)"
  ],
  [
    "Hiển thị ngay trong Popup danh sách TKQC của Via:",
    "Displays the Via's Ad Accounts right inside the Popup:"
  ],
  [
    "Bảo mật 2 lớp (2FA): Tài khoản VIA chưa bật 2FA.",
    "Two-factor authentication (2FA): Managing Via does not have 2FA enabled."
  ],
  [
    "chết liên đới toàn bộ các TKQC dùng chung thẻ đó",
    "a chain ban across all Ad Accounts sharing that card"
  ],
  [
    "1 Proxy IPv4 Dân cư tĩnh VN = 1 đến tối đa 2 Via",
    "1 Static Residential IPv4 Proxy = 1 to max 2 Vias"
  ],
  [
    "Môi trường đăng nhập (Chrome & Proxy) & Độ Trust",
    "Login Environment (Chrome & Proxy) & Trust Status"
  ],
  [
    "ở góc trên bên trái → chọn thư mục vừa giải nén.",
    "in the top-left corner → select the extracted folder."
  ],
  [
    "Kiểm tra các mục checklist cơ bản của tài khoản.",
    "Review the core readiness checklist items for the account."
  ],
  [
    "Xác nhận chủ sở hữu: Mục này chưa được rà soát.",
    "Ownership confirmation: This item has not been reviewed yet."
  ],
  [
    "Xem Checklist Hồ sơ XMDN & Công thức Vận hành →",
    "View Business Verification Checklist & Playbook →"
  ],
  [
    "Cách ly chuẩn (1 Chrome riêng · Không xung đột)",
    "Properly Isolated (1 Dedicated Chrome · No Conflict)"
  ],
  [
    "4. Phân tầng Lớp Via (Hiển thị trên thanh HUD):",
    "4. Via Operational Tier (Displayed on HUD Bar):"
  ],
  [
    "Chế độ dành cho nhà phát triển (Developer mode)",
    "Developer mode"
  ],
  [
    "thẻ đang gắn · Quy tắc an toàn: 1 Thẻ ≤ 3 TKQC)",
    "linked cards · Safe rule: 1 Card ≤ 3 Ad Accounts)"
  ],
  [
    "— Chọn Hồ sơ Google Chrome thật trên máy tính (",
    "— Select local Google Chrome Profile ("
  ],
  [
    "): Thao tác trực tiếp trên Hồ sơ Chrome của Via",
    "): Execute directly in the Via's Chrome Profile"
  ],
  [
    "Xác nhận chủ sở hữu: Đang có vấn đề cần xử lý.",
    "Ownership confirmation: Action required to resolve issue."
  ],
  [
    "Liên kết Pixel: Pixel liên kết đang gặp sự cố.",
    "Pixel link: Linked Pixel has an active issue."
  ],
  [
    "Giữ bởi Via Tổng (Lớp 1), share quyền cho TKQC",
    "Held by Master Via (Tier 1), shared to Ad Accounts"
  ],
  [
    "Tải file cài đặt dự phòng cho máy Windows khác",
    "Download setup script for another Windows PC"
  ],
  [
    "Chi tiêu tháng sắp chạm trần ngân sách cam kết",
    "Monthly spend approaching committed budget cap"
  ],
  [
    "Thanh toán tự động khi đạt ngưỡng lập hóa đơn",
    "Charged automatically when billing threshold is reached"
  ],
  [
    "4. Hạn mức 1 Proxy → Tài khoản Facebook (Via)",
    "4. 1 Static IPv4 Proxy → Facebook Via Limit"
  ],
  [
    "Bước 1: Kích hoạt Mở Chrome & Tiện ích (.zip)",
    "Step 1: Enable Chrome Launcher & Extension (.zip)"
  ],
  [
    "Dán khóa Base32 để tiện ích tự sinh 6 số 2FA",
    "Paste Base32 secret key to auto-generate 6-digit 2FA codes"
  ],
  [
    "Tất cả tài khoản đều đang hoạt động ổn định.",
    "All ad accounts are operating normally."
  ],
  [
    "Tra cứu lịch sử thay đổi & thao tác hệ thống",
    "Browse system change history & operational audit logs"
  ],
  [
    "Cấu hình Proxy / IP: Chưa gán Proxy cố định.",
    "Proxy / IP configuration: No dedicated Proxy assigned."
  ],
  [
    "để nhận mã OTP 6 số duyệt XMDN ngay lập tức.",
    "to receive the 6-digit verification OTP immediately."
  ],
  [
    "Thao tác trực tiếp trên Hồ sơ Chrome của Via",
    "Execute directly inside the Via's Chrome Profile"
  ],
  [
    "Chưa xác nhận nối với hồ sơ Facebook nội bộ.",
    "Not yet linked to an internal Facebook profile."
  ],
  [
    "Giấy chứng nhận đăng ký doanh nghiệp (GPKD)",
    "Business Registration Certificate"
  ],
  [
    "BM3 — Đã có bill thanh toán (Tối đa 3 TKQC)",
    "BM3 — First bill paid (Max 3 Ad Accounts)"
  ],
  [
    "Khóa Ghi API (Thao tác trên Chrome của Via)",
    "API Write Locked (Execute in Via Chrome)"
  ],
  [
    "Lớp 1: Via Tổng (Chỉ giữ BM - CẤM LÊN CAMP)",
    "Tier 1: Master Vault (Hold BM - NO ADS)"
  ],
  [
    "Chọn Hồ sơ Google Chrome thật trên máy tính",
    "Select local Google Chrome Profile"
  ],
  [
    "cho từng Hồ sơ Chrome của Via: tích hợp sẵn",
    "for each Via's Chrome Profile: built-in"
  ],
  [
    "vào thẳng trang đăng nhập Facebook đang mở.",
    "button directly on the active Facebook login tab."
  ],
  [
    "💳 Tổng hợp Dư nợ theo từng Thẻ thanh toán (",
    "💳 Balance Summary by Payment Card ("
  ],
  [
    "Ghi nhận rà soát thủ công sau khi hoàn tất.",
    "Record a manual review once completed."
  ],
  [
    "Hiện chưa có khoản thanh toán nào đến hạn.",
    "No payments are currently due."
  ],
  [
    "Giới hạn chi tiêu hàng ngày (do Meta đặt):",
    "Daily Spend Limit (set by Meta):"
  ],
  [
    "(Trần tối đa khi chưa xác minh là 5 TKQC).",
    "(Maximum unverified cap is 5 Ad Accounts)."
  ],
  [
    "Cộng tự động từ số dư nợ thực tế trên Meta",
    "Automatically summed from live Meta balances"
  ],
  [
    "Bấm để xem chi tiết và hướng dẫn khắc phục",
    "Click to view details and troubleshooting guide"
  ],
  [
    "Đã xác nhận nối với hồ sơ Facebook nội bộ.",
    "Confirmed linked to internal Facebook profile."
  ],
  [
    "BM1 — Mới tạo / Chưa bill (Tối đa 1 TKQC)",
    "BM1 — Newly created / Unbilled (Max 1 Ad Account)"
  ],
  [
    "Cài đặt Tự động mở Chrome Profile (1 lần)",
    "Install 1-Click Chrome Launcher (.bat)"
  ],
  [
    "Copy đường link xử lý trực tiếp trên Meta",
    "Copy direct Meta resolution link"
  ],
  [
    "Bộ lấy mã 2FA 6 số & Tự điền vào Facebook",
    "Live 6-Digit 2FA Generator & Facebook Auto-Fill"
  ],
  [
    "3. Mở nhanh trang Meta trên đúng Chrome (",
    "3. Quick Meta Shortcuts in Chrome ("
  ],
  [
    "Đính kèm bằng chứng cho các mục bắt buộc.",
    "Attach evidence for mandatory checklist items."
  ],
  [
    "Tên gợi nhớ cho BM / TKQC mới (tuỳ chọn)",
    "Friendly label for new BM / Ad Account (optional)"
  ],
  [
    "Share Partner qua BM để bảo toàn dữ liệu",
    "Shared via BM Partner to preserve pixel data"
  ],
  [
    "Bước 2: Phân tầng 3 Lớp Via & Lấy mã 2FA",
    "Step 2: 3-Tier Via Isolation & Live 2FA Codes"
  ],
  [
    "Tải tiện ích đã giải nén (Load unpacked)",
    "Load unpacked"
  ],
  [
    "Bạn có chắc muốn xóa tài khoản quảng cáo",
    "Are you sure you want to delete ad account"
  ],
  [
    "Kết nối tự động qua Meta Graph API (/me)",
    "Auto-connected via Meta Graph API (/me)"
  ],
  [
    "Tự động nhận diện theo số TKQC hiện tại",
    "Auto-detect based on current Ad Account count"
  ],
  [
    "BM30 — Đã XMDN Cấp cao (Tối đa 30 TKQC)",
    "BM30 — Verified Pro (Max 30 Ad Accounts)"
  ],
  [
    "Xem Slider 5 Bước Công Thức Chống Die →",
    "View Anti-Ban Playbook Slider →"
  ],
  [
    "Cập nhật trực tiếp từ Meta Insights API",
    "Synced live from Meta Insights API"
  ],
  [
    "Tổng hợp Dư nợ theo từng Thẻ thanh toán",
    "Balance Summary by Payment Card"
  ],
  [
    "Lớp 1: Via Tổng (Giữ BM - Cấm lên camp)",
    "Tier 1: Master Vault (Hold BM - No Ads)"
  ],
  [
    "Lớp 3: Via Dự Phòng (Ngâm sẵn > 7 ngày)",
    "Tier 3: Standby Via (Warmed > 7 days)"
  ],
  [
    "1. 🚫 Chặn Passkey · 🔑 2FA & Khóa WebRTC",
    "1. 🚫 Block Passkey · 🔑 2FA & WebRTC Shield"
  ],
  [
    "(Nên chuyển quyền Admin BM về Via Tổng)",
    "(Transfer BM Admin ownership to Master Via)"
  ],
  [
    "3. Mở nhanh trang Meta trên đúng Chrome",
    "3. Quick Meta Shortcuts in Chrome"
  ],
  [
    "Bạn có chắc muốn xóa tài khoản Facebook",
    "Are you sure you want to delete Facebook account"
  ],
  [
    "Cách ly Hồ sơ Chrome & Proxy IPv4 tĩnh",
    "Chrome Profile & Static IPv4 Proxy Isolation"
  ],
  [
    "• Mỗi Via cá nhân chỉ tự khởi tạo được",
    "• Each personal Via can only self-create"
  ],
  [
    "Sao kê tài khoản ngân hàng của công ty",
    "Corporate Bank Account Statement"
  ],
  [
    "IPv4 Dân cư tĩnh VN (Viettel/VNPT/FPT)",
    "VN Static Residential IPv4 (Viettel/VNPT/FPT)"
  ],
  [
    "Vượt ngưỡng an toàn (Dễ chết liên đới)",
    "Exceeds safe limit (High chain-ban risk)"
  ],
  [
    "Cách ly 1 Hồ sơ Chrome = 1 Via cố định",
    "Isolated: 1 Chrome Profile = 1 Fixed Via"
  ],
  [
    "Đọc danh sách BM, TKQC, Dư nợ & Pixel:",
    "Read BMs, Ad Accounts, Balances & Pixels:"
  ],
  [
    "Quy trình 3 Bước Vận hành Chuẩn Agency",
    "3-Step Agency Operating Workflow"
  ],
  [
    "Tổng chi tiêu từ đầu tháng đến hôm nay",
    "Total spend from the 1st of the month to today"
  ],
  [
    "5. Khóa 2FA Base32 nạp sẵn (Tùy chọn):",
    "5. Pre-loaded Base32 2FA Secret Key (Optional):"
  ],
  [
    "Tải Tiện Ích Chrome Đã Cấu Hình (.zip)",
    "Download Configured Chrome Extension (.zip)"
  ],
  [
    "Mở checklist và hướng dẫn xử lý nội bộ",
    "Open internal troubleshooting checklist and guide"
  ],
  [
    "VD: TK-Xây Dựng hoặc BM Khách hàng...",
    "e.g. Construction-AdAcct or Client BM..."
  ],
  [
    "+ bất kỳ khoản phí nào có thể áp dụng",
    "+ any applicable taxes or fees"
  ],
  [
    "SLIDER 5 BƯỚC: CÔNG THỨC VẬN HÀNH NÀY",
    "PLAYBOOK SLIDER: ANTI-BAN OPERATING FORMULA"
  ],
  [
    "🛡️ Trạng thái Dàn Via thực tế của bạn",
    "🛡️ Live Status of Your Via Fleet"
  ],
  [
    "Email doanh nghiệp theo đuôi tên miền",
    "Corporate domain email address"
  ],
  [
    "Cấp độ BM & Giới hạn tạo Tài khoản QC",
    "BM Tier & Ad Account Creation Limit"
  ],
  [
    "BM250 — Agency XMDN (Tối đa 250 TKQC)",
    "BM250 — Verified Agency (Max 250 Ad Accounts)"
  ],
  [
    "Chuẩn dân cư tĩnh VN: 1 Proxy ≤ 2 Via",
    "Static residential standard: 1 Proxy ≤ 2 Vias"
  ],
  [
    "Bước 3: Canh Dư nợ TKQC & Hạn mức Thẻ",
    "Step 3: Monitor Balances & Card Limits"
  ],
  [
    "Bấm để mở Checklist sẵn sàng vận hành",
    "Click to open Operational Readiness Checklist"
  ],
  [
    "4. Bọc Proxy IPv4 & Khóa rò IP WebRTC",
    "4. IPv4 Proxy Routing & WebRTC Leak Shield"
  ],
  [
    "3. Hồ sơ Google Chrome thật trên máy:",
    "3. Local Google Chrome Profile Folder:"
  ],
  [
    "Tài khoản đã đóng trên Meta (Mã 101)",
    "Account closed on Meta (Code 101)"
  ],
  [
    "Cẩm nang & Quy chuẩn Vận hành Agency",
    "Agency Operations Playbook & Standards"
  ],
  [
    "Tài khoản quảng cáo cập nhật gần đây",
    "Recently Updated Ad Accounts"
  ],
  [
    "Xem Hướng dẫn & Công thức Vận hành →",
    "View Operations Guide & Playbook →"
  ],
  [
    "Lớp 2: Via Lên Camp (Chạy Ads khách)",
    "Tier 2: Media Buying (Run Client Ads)"
  ],
  [
    "Đã chặn bảng Windows Hello / Passkey",
    "Windows Hello / Passkey Prompts Blocked"
  ],
  [
    "Xác thực trực tiếp từ Meta Graph API",
    "Authenticated directly via Meta Graph API"
  ],
  [
    "Tài khoản đang bị hạn chế quảng cáo",
    "Ad account is restricted from advertising"
  ],
  [
    "Ngày lập hóa đơn định kỳ hàng tháng",
    "Monthly recurring billing date"
  ],
  [
    "nhưng thực chiến chỉ nên gắn tối đa",
    "but in production you should link at most"
  ],
  [
    "Tài khoản cần kiểm tra / Kháng nghị",
    "Accounts Needing Review / Appeal"
  ],
  [
    "Mở TKQC này bằng đúng cửa sổ Chrome",
    "Open this Ad Account in its assigned Chrome window"
  ],
  [
    "Tài khoản Via & Phân tầng Chống Die",
    "Facebook Via & 3-Tier Isolation"
  ],
  [
    "Chưa gắn cố định Hồ sơ Chrome riêng",
    "No dedicated Chrome Profile assigned"
  ],
  [
    "3. Xuất/Nạp Cookie & Bắt Token EAAB",
    "3. Cookie Import/Export & EAAB Token Extractor"
  ],
  [
    "Khóa chống rò rỉ IP thật qua WebRTC",
    "WebRTC Real IP Leak Shield"
  ],
  [
    "Bấm để xổ chi tiết & lọc theo thẻ ▾",
    "Click to expand & filter by card ▾"
  ],
  [
    "Quản trị viên bị gỡ hoặc hạ quyền (",
    "Admins removed or demoted ("
  ],
  [
    "Tài khoản quảng cáo bị vô hiệu hoá",
    "Ad account disabled on Meta"
  ],
  [
    "Tài khoản có dư nợ chưa thanh toán",
    "Ad account has unpaid balance due"
  ],
  [
    "Chặn Passkey · 🔑 2FA & Khóa WebRTC",
    "Block Passkey · 🔑 2FA & WebRTC Shield"
  ],
  [
    "Bật hẹn giờ ngâm 72h (cho Via mới)",
    "Start 72h Warm-up Timer (New Via)"
  ],
  [
    "chặn lộ IP Wifi gốc của văn phòng.",
    "to block local office Wi-Fi IP leaks."
  ],
  [
    "Bấm để đổi Proxy IP:Port:User:Pass",
    "Click to edit Proxy IP:Port:User:Pass"
  ],
  [
    "Trang quản lý tài sản doanh nghiệp",
    "Business Asset Management Workspace"
  ],
  [
    "Giới hạn chi tiêu ngày (Meta đặt)",
    "Daily Spend Limit (set by Meta)"
  ],
  [
    "CHỐNG KẸT KHÓA TRUY CẬP (PASSKEY)",
    "PREVENT PASSKEY LOGIN LOCKOUTS"
  ],
  [
    "Hóa đơn tiện ích đứng tên công ty",
    "Corporate Utility Bill"
  ],
  [
    "Bấm để xổ chi tiết & lọc theo thẻ",
    "Click to expand & filter by card"
  ],
  [
    "Daily Spend Limit do Meta áp đặt",
    "Daily Spend Limit enforced by Meta"
  ],
  [
    "CHỐNG CHẾT CHÙM THEO IP / COOKIE",
    "ANTI-CHAIN-BAN BY IP / COOKIE"
  ],
  [
    "Dưới chân trang (Footer) website",
    "The website footer"
  ],
  [
    "BM5 — Tiêu chuẩn (Tối đa 5 TKQC)",
    "BM5 — Standard (Max 5 Ad Accounts)"
  ],
  [
    "trên đúng cửa sổ Chrome của Via:",
    "in the Via's exact Chrome window:"
  ],
  [
    "Chế độ Tạo TKQC & Phân quyền BM:",
    "Ad Account Creation & BM Access Mode:"
  ],
  [
    "Hướng dẫn & Công thức Vận hành →",
    "Operations Guide & Playbook →"
  ],
  [
    "(Vượt ngưỡng an toàn 3 TKQC/thẻ)",
    "(Exceeds safe limit of 3 Ad Accts/card)"
  ],
  [
    "Cài Đặt Tự Động Mở Chrome (.bat)",
    "1-Click Chrome Launcher Setup (.bat)"
  ],
  [
    "1. Bảng Dư nợ, Ngưỡng & Thẻ TKQC",
    "1. Live Ad Account Balance, Threshold & Card HUD"
  ],
  [
    "Tự động bật cửa sổ Google Chrome",
    "Automatically launch Google Chrome window"
  ],
  [
    "Copy link để dán vào trình duyệt",
    "Copy link to paste into browser"
  ],
  [
    "Xuất/Nạp Cookie & Bắt Token EAAB",
    "Cookie Import/Export & EAAB Token Extractor"
  ],
  [
    "Lưu trữ (xóa) tài khoản Facebook",
    "Archive (delete) Facebook account"
  ],
  [
    "Gắn tự động từ hồ sơ vận hành BM",
    "Auto-linked from BM operational profile"
  ],
  [
    "Số dư chưa thanh toán trên Meta",
    "Unpaid balance on Meta"
  ],
  [
    "1. Công Thức Vận Hành Tổng Quát",
    "1. Master Anti-Ban Formula"
  ],
  [
    "Hạn mức BM1 → BM5 → BM10 (XMDN)",
    "BM1 → BM5 → BM10 (Verified) Quotas"
  ],
  [
    "→ Sau khi cắn bill đầu tiên lên",
    "→ After the first paid bill this increases to"
  ],
  [
    "Đã XMDN (Xác minh doanh nghiệp)",
    "Business Verified (XMDN)"
  ],
  [
    "Quy tắc an toàn thẻ thanh toán:",
    "Payment Card Safety Rule:"
  ],
  [
    "TKQC đang gắn (An toàn ≤ 3/thẻ)",
    "Linked Ad Accounts (Safe ≤ 3/card)"
  ],
  [
    "Quy tắc an toàn: 1 Thẻ ≤ 3 TKQC",
    "Safe rule: 1 Card ≤ 3 Ad Accounts"
  ],
  [
    "3. Hạn mức 1 Thẻ → Tài khoản QC",
    "3. 1 Card → Ad Account Limit"
  ],
  [
    "Mở trang Kháng nghị bằng Chrome",
    "Open Appeals in Chrome"
  ],
  [
    "Hướng dẫn & Công thức Chống Die",
    "Anti-Ban Guide & Playbook"
  ],
  [
    "Mạng gốc (Chưa gắn Proxy riêng)",
    "Direct Network (No Dedicated Proxy)"
  ],
  [
    "2. Mã 2FA 6 số & Tự điền 1 chạm",
    "2. Live 6-Digit 2FA OTP & 1-Click Auto-Fill"
  ],
  [
    "1. Tên Via / Tài khoản Facebook",
    "1. Via Name / Facebook Account"
  ],
  [
    "Chi tiêu vượt ngân sách cam kết",
    "Spend exceeding committed budget"
  ],
  [
    "Via xác minh danh tính dự phòng",
    "Identity-verified backup Via"
  ],
  [
    "Dán khóa 2FA (VD: JBSWY3DP...)",
    "Paste 2FA key (e.g. JBSWY3DP...)"
  ],
  [
    "• Tuy nhiên, 1 Via Tổng có thể",
    "• However, 1 Master Via can"
  ],
  [
    "→ Tiếp tục chi tiêu đều sẽ lên",
    "→ Consistent spend unlocks"
  ],
  [
    "khi máy chủ Cloud gửi lệnh Ghi",
    "when a Cloud server sends Write requests"
  ],
  [
    "Lớp 3: Via Dự Phòng (Ngâm sẵn)",
    "Tier 3: Standby Via (Warmed)"
  ],
  [
    "& kích hoạt mở Chrome tự động:",
    "& 1-Click Chrome Launcher Activation:"
  ],
  [
    "Người chưa xác nhận trong BM (",
    "Unconfirmed users in BM ("
  ],
  [
    "Số dư của bạn đạt (Ngưỡng TT)",
    "When your balance reaches (Threshold)"
  ],
  [
    "Công thức phân tầng 3 lớp Via",
    "3-Tier Via Isolation Formula"
  ],
  [
    "Business Manager đang quản lý",
    "Managed Business Managers"
  ],
  [
    "Xem trạng thái Kết nối Meta →",
    "View Meta Connection Status →"
  ],
  [
    "Mở Bảng Phân Tầng Via & 2FA →",
    "Open Via Tiers & 2FA Table →"
  ],
  [
    "(An toàn chống chết liên đới)",
    "(Safe against chain payment bans)"
  ],
  [
    "Tổng Chi tiêu Lũy kế toàn dàn",
    "Total Lifetime Spend Across All Accounts"
  ],
  [
    "2. Tên định danh Via nạp sẵn:",
    "2. Pre-loaded Via Identity Label:"
  ],
  [
    "Xuất File SwitchyOmega (.bak)",
    "Export SwitchyOmega Backup (.bak)"
  ],
  [
    "Quản lý Tài khoản Quảng cáo →",
    "Manage Ad Accounts →"
  ],
  [
    "VD: Thiên Triều Mới, Via 2...",
    "e.g. Primary Via, Backup Via 2..."
  ],
  [
    "Khôi phục tài khoản quảng cáo",
    "Restore ad account"
  ],
  [
    "2. Tài khoản quảng cáo thuộc ",
    "2. Ad Accounts under "
  ],
  [
    "Cảnh báo quyền truy cập BM — ",
    "BM Access Alert — "
  ],
  [
    "Không thể đồng bộ mã ID này.",
    "Could not synchronize this ID."
  ],
  [
    "Phương thức thanh toán (Thẻ)",
    "Payment Method (Card)"
  ],
  [
    "Tên doanh nghiệp (Pháp nhân)",
    "Legal Business Name"
  ],
  [
    "CÔNG THỨC VÀNG CHỐNG DIE VIA",
    "GOLDEN ANTI-BAN FORMULA"
  ],
  [
    "1 Thẻ chỉ gắn cho 1 – 3 TKQC",
    "Link 1 Card to at most 1 – 3 Ad Accounts"
  ],
  [
    "2. Hạn mức BM → Tài khoản QC",
    "2. BM → Ad Account Limit"
  ],
  [
    "Billing Meta (Tự đọc Ngưỡng)",
    "Meta Billing (Auto-Sync)"
  ],
  [
    "Lớp 3: Via Dự Phòng Ngâm Sẵn",
    "Tier 3: Warmed Standby Via"
  ],
  [
    "— để trống nếu dùng Mạng gốc",
    "— leave blank for Direct Network"
  ],
  [
    "6. Cấu hình Proxy IPv4 riêng",
    "6. Dedicated IPv4 Proxy Config"
  ],
  [
    "2. Tài khoản quảng cáo thuộc",
    "2. Ad Accounts under"
  ],
  [
    "Quản lý Tài khoản FB (Via) →",
    "Manage Facebook Vias →"
  ],
  [
    "Kiểm tra & Kháng nghị Meta ↗",
    "Inspect & Appeal on Meta ↗"
  ],
  [
    "An toàn: Mỗi Via gốc chỉ cầm",
    "Safe rule: Each root Via holds"
  ],
  [
    "Tải Gói Tiện Ích (.zip) Cho ",
    "Download Extension (.zip) For "
  ],
  [
    "Đồng bộ tự động từ Token Via",
    "Auto-synced from Via Token"
  ],
  [
    "do các Via khác share sang.",
    "shared from other Vias."
  ],
  [
    "Tiện ích Chrome & Bọc Proxy",
    "Chrome Extension & Proxy Routing"
  ],
  [
    "Thanh toán, Dư nợ & Hạn mức",
    "Billing, Balance & Spend Limits"
  ],
  [
    "Tải bộ kết nối cho máy khác",
    "Launcher Setup (.bat)"
  ],
  [
    "Đã ngâm > 7 ngày (Đã Trust)",
    "Warmed > 7 Days (Trusted)"
  ],
  [
    "Tải Gói Tiện Ích (.zip) Cho",
    "Download Extension (.zip) For"
  ],
  [
    "Chọn môi trường trình duyệt",
    "Select browser environment"
  ],
  [
    "Danh sách TKQC & Dư nợ thật",
    "Live Ad Accounts & Balances"
  ],
  [
    "Business Manager đang cầm (",
    "Linked Business Managers ("
  ],
  [
    " Hồ sơ Chrome thật trên máy",
    " real Chrome Profiles on device"
  ],
  [
    "Ngưỡng lập hóa đơn tự động",
    "Automatic billing threshold"
  ],
  [
    "Tên thẻ hiển thị trên Meta",
    "Card display label on Meta"
  ],
  [
    "Đã xác minh thuế trên Meta",
    "Tax ID verified on Meta"
  ],
  [
    "4. Quy Trình Ngâm 72h Vàng",
    "4. Golden 72h Warm-up Protocol"
  ],
  [
    "CHỐNG CHECKPOINT 956 / 282",
    "PREVENT CHECKPOINT 956 / 282"
  ],
  [
    "5. Chặn Chết Ngược Từ TKQC",
    "5. Prevent Reverse Chain-Bans"
  ],
  [
    "Quy trình ngâm 72 giờ vàng",
    "72-Hour Golden Warm-up Protocol"
  ],
  [
    "(tránh IPv6 & Proxy xoay).",
    "(avoid IPv6 & rotating proxies)."
  ],
  [
    "Đang hoạt động (Được phép)",
    "Active (Permitted)"
  ],
  [
    "kèm mã 2FA 6 số trực tiếp.",
    "with live 6-digit 2FA codes."
  ],
  [
    "Mở Bảng TKQC & Dư Nợ Thẻ →",
    "Open Ad Accounts & Card Balances →"
  ],
  [
    "Trạng thái Meta & Cảnh báo",
    "Meta Status & Alerts"
  ],
  [
    "Kết nối & Token Meta Đa BM",
    "Multi-BM Meta Connections & Tokens"
  ],
  [
    "Kháng nghị & Chất lượng TK",
    "Appeals & Account Quality"
  ],
  [
    "Hồ sơ Chrome thật trên máy",
    "real Chrome Profiles on device"
  ],
  [
    "Chọn Hồ sơ Chrome trên máy",
    "Select Chrome Profile on PC"
  ],
  [
    "Gắn khóa 2FA (Lấy mã 6 số)",
    "Link 2FA Key (Live 6-Digit OTP)"
  ],
  [
    "Quản lý Business Manager →",
    "Manage Business Managers →"
  ],
  [
    "Thanh HUD cảnh báo Lớp Via",
    "Via Tier Safety HUD Bar"
  ],
  [
    "Trên cửa sổ Chrome của Via",
    "In the Via's Chrome window"
  ],
  [
    "trên góc phải Chrome → bấm",
    "in the top-right of Chrome → click"
  ],
  [
    "Mở Bảng TKQC & Dư Nợ Thẻ (",
    "Open Ad Accounts & Card Balances ("
  ],
  [
    "🛡️ Chế độ Bảo vệ BM Thật (",
    "🛡️ Production BM Protection Mode ("
  ],
  [
    "Tổng chi tiêu lịch sử của ",
    "Total historical spend across "
  ],
  [
    "Đồng bộ tự động từ Meta BM",
    "Auto-synced from Meta BM"
  ],
  [
    "Mở Cài đặt BM trên Chrome",
    "Open BM Settings in Chrome"
  ],
  [
    "Thanh toán ngay trên Meta",
    "Pay Now on Meta"
  ],
  [
    "Và vào ngày này (Ngày TT)",
    "And on this date (Bill Date)"
  ],
  [
    "3. Cách Ly Chrome & Proxy",
    "3. Chrome & Proxy Isolation"
  ],
  [
    "VỆ SINH THẺ & BÀI TỪ CHỐI",
    "CARD HYGIENE & REJECTED AD CLEANUP"
  ],
  [
    "Tài khoản QC & Hạn mức BM",
    "Ad Accounts & BM Limit"
  ],
  [
    "Mở Quản lý Kết nối Meta →",
    "Open Meta Connections →"
  ],
  [
    "Cập nhật Ngưỡng / Ngày TT",
    "Edit Threshold / Bill Date"
  ],
  [
    "Tổng Dư nợ cần thanh toán",
    "Total Unpaid Balance Due"
  ],
  [
    "Chi tiêu Hôm nay · 7 Ngày",
    "Spend Today · Last 7 Days"
  ],
  [
    "Tổng chi tiêu lịch sử của",
    "Total historical spend across"
  ],
  [
    "Tải cấu hình Proxy (.bak)",
    "Download Proxy Config (.bak)"
  ],
  [
    "Trùng Chrome Profile với:",
    "Shares Chrome Profile with:"
  ],
  [
    "Business Manager đang cầm",
    "Linked Business Managers"
  ],
  [
    "Ngày thanh toán tiếp theo",
    "Next Bill Date"
  ],
  [
    "Nick chính nhận quyền qua",
    "Master Via receives access via"
  ],
  [
    "6. Chặn & Tự Xoá Passkey",
    "6. Block & Auto-Delete Passkey"
  ],
  [
    "Meta cho phép gắn tối đa",
    "Meta technically allows up to"
  ],
  [
    "Xem Công thức Vận hành →",
    "View Operations Playbook →"
  ],
  [
    "Chi tiêu Tháng này (MTD)",
    "Month-to-Date Spend (MTD)"
  ],
  [
    "Lớp 1: Via Tổng (Giữ BM)",
    "Tier 1: Master Vault (Hold BM)"
  ],
  [
    "An toàn (≤ 2 BM gốc/Via)",
    "Safe (≤ 2 Root BMs/Via)"
  ],
  [
    "Sao chép mã OTP 2FA 6 số",
    "Copy 6-digit 2FA OTP code"
  ],
  [
    "(Vượt mức ≤ 2 Via/Proxy)",
    "(Exceeds safe limit of ≤ 2 Vias/Proxy)"
  ],
  [
    "Chép/Nạp Cookie Facebook",
    "Facebook Cookie Export/Import"
  ],
  [
    "Không phát sinh chi tiêu",
    "No spend recorded"
  ],
  [
    "Mở Bảng TKQC & Dư Nợ Thẻ",
    "Open Ad Accounts & Card Balances"
  ],
  [
    "Tự động gắn với BM chính",
    "Auto-linked to primary BM"
  ],
  [
    "Server chỉ gọi lệnh đọc",
    "The server only executes read requests"
  ],
  [
    "Chưa gắn thẻ thanh toán",
    "No payment card linked"
  ],
  [
    "Chưa khai báo pháp nhân",
    "No legal entity declared"
  ],
  [
    ") trên Chrome của Via ↗",
    ") in Via's Chrome ↗"
  ],
  [
    "Tải gói Tiện ích Chrome",
    "Download the Chrome Extension package"
  ],
  [
    "Mở Trung tâm Tiện ích →",
    "Open Extension Hub →"
  ],
  [
    "Mở Ads Manager (Chrome)",
    "Open Ads Manager (Chrome)"
  ],
  [
    "Mở Thanh toán (Billing)",
    "Open Meta Billing"
  ],
  [
    "Đang lấy Via từ Meta...",
    "Fetching Vias from Meta..."
  ],
  [
    "Tự động lấy Via từ Meta",
    "Auto-Fetch Vias from Meta"
  ],
  [
    "1/2 Via · 1 Proxy riêng",
    "1/2 Via · Dedicated Proxy"
  ],
  [
    "Chạm trần tạo BM (4 BM)",
    "BM Creation Cap Reached (4 BMs)"
  ],
  [
    "+ Nhập khóa 2FA ở mục 5",
    "+ Enter 2FA key in Step 5"
  ],
  [
    "Thanh toán dư nợ Meta ↗",
    "Pay Balance on Meta ↗"
  ],
  [
    "Mở Bảng Phân Tầng Via (",
    "Open Via Tiers Table ("
  ],
  [
    ") trên Chrome của Via ↗",
    ") in Via's Chrome ↗"
  ],
  [
    "Thu gọn danh sách thẻ ▴",
    "Collapse card list ▴"
  ],
  [
    "Thiết lập website Pixel",
    "Website Pixel Setup"
  ],
  [
    "Phương thức thanh toán",
    "Payment Method"
  ],
  [
    "Thông tin doanh nghiệp",
    "Business Information"
  ],
  [
    "Mã số thuế đã xác minh",
    "Tax ID verified"
  ],
  [
    "2. Phân Tầng 3 Lớp Via",
    "2. 3-Tier Via Isolation"
  ],
  [
    "Trang tổng hợp toàn bộ",
    "Comprehensive reference for"
  ],
  [
    "CẢNH BÁO: Thẻ đang gắn",
    "WARNING: Card linked to"
  ],
  [
    "Lọc theo Lớp vận hành:",
    "Filter by Operational Tier:"
  ],
  [
    "Lớp 1: Via Tổng Giữ BM",
    "Tier 1: Master BM Vault"
  ],
  [
    "TKQC thật được nạp sẵn",
    "live Ad Accounts pre-loaded"
  ],
  [
    "Pháp nhân Doanh nghiệp",
    "Legal Business Entity"
  ],
  [
    "Chưa nạp khóa 2FA cho ",
    "No 2FA key loaded for "
  ],
  [
    "Bạn sẽ thanh toán khi",
    "You will be billed when"
  ],
  [
    "Số dư đạt (Ngưỡng TT)",
    "Billing Threshold"
  ],
  [
    "NGUYÊN TẮC TÁCH QUYỀN",
    "PRIVILEGE SEPARATION RULE"
  ],
  [
    "(Via cổ tối đa 4 BM).",
    "(aged Vias up to 4 BMs)."
  ],
  [
    "Ngưỡng an toàn Agency",
    "Agency Safe Limit"
  ],
  [
    "Chuẩn Proxy nuôi Via:",
    "Via Proxy Standard:"
  ],
  [
    "Sử dụng hạn mức TKQC:",
    "Ad Account Quota Usage:"
  ],
  [
    "Chế độ Bảo vệ BM Thật",
    "Production BM Protection Mode"
  ],
  [
    "An toàn chống Die BM:",
    "BM Anti-Ban Safety:"
  ],
  [
    "Tải File .bat (1 lần)",
    "Download .bat Setup (Once)"
  ],
  [
    "Công thức Chống Die →",
    "Anti-Ban Playbook →"
  ],
  [
    "Thu gọn danh sách thẻ",
    "Collapse card list"
  ],
  [
    "Đã đóng / Vô hiệu hóa",
    "Closed / Disabled"
  ],
  [
    "1 Chạm Tự Xoá Passkey",
    "1-Click Auto-Delete Passkey"
  ],
  [
    "Via Lên Camp đang nắm",
    "Media Buying Via holds"
  ],
  [
    "Mở Chrome của Via này",
    "Open This Via's Chrome"
  ],
  [
    "Hướng dẫn cài đặt gói",
    "Installation Guide for"
  ],
  [
    "Chưa nạp khóa 2FA cho",
    "No 2FA key loaded for"
  ],
  [
    "Hướng dẫn khắc phục →",
    "Resolution Guide →"
  ],
  [
    "ID TKQC (External ID)",
    "Ad Account ID (External ID)"
  ],
  [
    "Tự động tính phí theo",
    "Automatically charged to"
  ],
  [
    "Chọn hồ sơ Chrome cho",
    "Select Chrome profile for"
  ],
  [
    "Mở đúng cửa sổ Chrome",
    "Open exact Chrome window"
  ],
  [
    "Mở Bảng Phân Tầng Via",
    "Open Via Tiers Table"
  ],
  [
    "Cần ≥ 2 Via dự phòng",
    "Need ≥ 2 Standby Vias"
  ],
  [
    "bắt buộc hiển thị rõ",
    "must clearly display"
  ],
  [
    "Mua & Gia hạn nhanh:",
    "Quick Buy & Renew:"
  ],
  [
    "1 Proxy đang gắn cho",
    "1 Proxy is shared across"
  ],
  [
    "ở góc trên bên phải.",
    "in the top-right corner."
  ],
  [
    "Chọn lớp vai trò cho",
    "Select operational tier for"
  ],
  [
    "BM Đối tác (Partner)",
    "Partner BM"
  ],
  [
    "BM chủ quản đã XMDN",
    "Parent BM Verified"
  ],
  [
    "1. Hạn mức Via → BM",
    "1. Via → BM Limit"
  ],
  [
    "Tự động xác định BM",
    "Auto-detect owning BM"
  ],
  [
    "Tải Tiện Ích (.zip)",
    "Download Extension (.zip)"
  ],
  [
    "Mở danh sách TKQC →",
    "Open Ad Accounts →"
  ],
  [
    "GH ngày (Meta đặt):",
    "Daily Limit (Meta):"
  ],
  [
    "Lớp 2: Via Lên Camp",
    "Tier 2: Media Buying Via"
  ],
  [
    "Lớp 3: Via Dự Phòng",
    "Tier 3: Standby Via"
  ],
  [
    "Đã kết nối tự động:",
    "Auto-connected:"
  ],
  [
    "Đóng gói riêng file",
    "Package a custom"
  ],
  [
    "Thẻ Visa/Mastercard",
    "Visa/Mastercard"
  ],
  [
    "Mã số thuế (Tax ID)",
    "Tax ID"
  ],
  [
    "để thanh toán dư nợ",
    "to settle balance"
  ],
  [
    "tài khoản quảng cáo",
    "ad accounts"
  ],
  [
    "Tài khoản quảng cáo",
    "Ad Account"
  ],
  [
    "Đạt chuẩn dự phòng",
    "Standby Ready"
  ],
  [
    ": Mới tạo chỉ được",
    ": Newly created BMs get"
  ],
  [
    "Tối đa khuyến nghị",
    "Recommended max"
  ],
  [
    "1 – 3 TKQC / 1 thẻ",
    "1 – 3 Ad Accounts / 1 card"
  ],
  [
    "Để tránh Meta quét",
    "To prevent Meta from flagging"
  ],
  [
    "Chưa xác minh thuế",
    "Tax ID unverified"
  ],
  [
    "Cần tối ưu cách ly",
    "Needs Isolation Fix"
  ],
  [
    "Quét & Xoá Passkey",
    "Scan & Delete Passkey"
  ],
  [
    "Via Tổng / Partner",
    "Master Via / Partner"
  ],
  [
    "Mảnh ghép Tiện ích",
    "Extensions Puzzle Icon"
  ],
  [
    "Via & Hồ sơ Chrome",
    "Via & Chrome Profile"
  ],
  [
    "Bạn có thể bấm nút",
    "You can click the"
  ],
  [
    "Đồng bộ từ Meta BM",
    "Synced from Meta BM"
  ],
  [
    "Mở BM trên Chrome",
    "Open BM in Chrome"
  ],
  [
    "Số dư của bạn đạt",
    "Your balance reaches"
  ],
  [
    "Đồng Việt Nam VND",
    "Vietnamese Dong (VND)"
  ],
  [
    "Chưa cập nhật MST",
    "Tax ID not set"
  ],
  [
    "1 Proxy = 1–2 Via",
    "1 Proxy = 1–2 Vias"
  ],
  [
    "Chạm trần hạn mức",
    "Quota limit reached"
  ],
  [
    "9–10 TKQC / 1 thẻ",
    "9–10 Ad Accounts / 1 card"
  ],
  [
    "TKQC cần kiểm tra",
    "Accounts Needing Review"
  ],
  [
    "Xuất CSV đối soát",
    "Export CSV Report"
  ],
  [
    "Lọc nhanh 1 chạm:",
    "1-Click Quick Filter:"
  ],
  [
    "Nợ cước / Hạn chế",
    "Past Due / Restricted"
  ],
  [
    "🚀 Mở Cài đặt BM (",
    "🚀 Open BM Settings ("
  ],
  [
    "Tài khoản cá nhân",
    "Personal Account"
  ],
  [
    "Tên doanh nghiệp",
    "Legal Business Name"
  ],
  [
    "(cùng 1 cụm BM).",
    "(within the same BM cluster)."
  ],
  [
    "Tự động kiểm tra",
    "Auto-inspect"
  ],
  [
    "Dọn bài Rejected",
    "Clean Rejected Ads"
  ],
  [
    "đã được xác minh",
    "verified"
  ],
  [
    "Mã số thuế (MST)",
    "Tax ID"
  ],
  [
    "Chi tiêu Hôm nay",
    "Spend Today"
  ],
  [
    "Chi tiêu Hôm qua",
    "Spend Yesterday"
  ],
  [
    "Và vào ngày này",
    "And on this date"
  ],
  [
    "Chưa đặt ngưỡng",
    "No threshold set"
  ],
  [
    "Slide tiếp theo",
    "Next slide"
  ],
  [
    "tối đa 2 BM gốc",
    "up to 2 root BMs"
  ],
  [
    "Proxy IPv4 Tĩnh",
    "Static IPv4 Proxies"
  ],
  [
    "Tài Khoản Chính",
    "Primary Master Account"
  ],
  [
    "9–10 TKQC / Thẻ",
    "9–10 Ad Accts / Card"
  ],
  [
    "Mở Cài đặt BM (",
    "Open BM Settings ("
  ],
  [
    "Ẩn danh sách ID",
    "Hide ID List"
  ],
  [
    "Via Tổng giữ BM",
    "Master Vault Via"
  ],
  [
    "(cấm lên camp),",
    "(no ad launching),"
  ],
  [
    "Meta hoạt động:",
    "Meta Active:"
  ],
  [
    "Kháng nghị Meta",
    "Meta Appeals"
  ],
  [
    "Gắn thêm vào BM",
    "Link additional BM"
  ],
  [
    "và bật công tắc",
    "and enable"
  ],
  [
    "Chi tiêu 7 ngày",
    "Spend 7 Days"
  ],
  [
    "Chi tiêu Lũy kế",
    "Lifetime Spend"
  ],
  [
    "Trạng thái Meta",
    "Meta Status"
  ],
  [
    "Mở Chrome xử lý",
    "Open Chrome to Fix"
  ],
  [
    "không giới hạn.",
    "without limit."
  ],
  [
    "Chưa thiết lập",
    "Not set"
  ],
  [
    "Không giới hạn",
    "No limit"
  ],
  [
    "Chạy Ads khách",
    "Run Client Ads"
  ],
  [
    "3–5 TKQC (BM5)",
    "3–5 Ad Accounts (BM5)"
  ],
  [
    ": Mở khóa ngay",
    ": Immediately unlocks"
  ],
  [
    "10 TKQC (BM10)",
    "10 Ad Accounts (BM10)"
  ],
  [
    "Thẻ Thanh Toán",
    "Payment Cards"
  ],
  [
    "1–3 TKQC / Thẻ",
    "1–3 Ad Accts / Card"
  ],
  [
    "1 Thẻ ≤ 3 TKQC",
    "1 Card ≤ 3 Ad Accounts"
  ],
  [
    "[TKQC Cá nhân]",
    "[Personal Ad Acct]"
  ],
  [
    "Chọn BM sở hữu",
    "Select owning BM"
  ],
  [
    "Không thuộc BM",
    "Not in a BM (Personal)"
  ],
  [
    "Tháng hiện tại",
    "Current Month"
  ],
  [
    "Đang hoạt động",
    "Active"
  ],
  [
    "Gắn Proxy tĩnh",
    "Assign Static Proxy"
  ],
  [
    "ĐANG BỌC PROXY",
    "PROXY ACTIVE"
  ],
  [
    "Hồ sơ đã chọn:",
    "Selected profile:"
  ],
  [
    "Không gắn thêm",
    "Do not link additional BM"
  ],
  [
    "«⚡ Tự điền FB»",
    "«⚡ Auto-Fill FB»"
  ],
  [
    "Bấm biểu tượng",
    "Click the"
  ],
  [
    "Đơn vị tiền tệ",
    "Currency"
  ],
  [
    "Dư nợ hiện tại",
    "Current Balance"
  ],
  [
    "(Via cổ: 4 BM)",
    "(Aged Via: 4 BMs)"
  ],
  [
    "✕ Bỏ lọc thẻ (",
    "✕ Clear card filter ("
  ],
  [
    "Không thuộc BM",
    "Not in a BM"
  ],
  [
    "chống đỏ thẻ.",
    "to prevent card bans."
  ],
  [
    "Quỹ trả trước",
    "Prepaid balance"
  ],
  [
    "Ngâm sẵn > 7N",
    "Warmed > 7D"
  ],
  [
    "Đồng bộ Meta:",
    "Meta Sync:"
  ],
  [
    "Chọn nhanh ID",
    "Quick Select ID"
  ],
  [
    "Cấp Token mới",
    "Update Token"
  ],
  [
    "Dán Token mới",
    "Paste New Token"
  ],
  [
    "chưa xác minh",
    "unverified"
  ],
  [
    "Quá tải Proxy",
    "Proxy Overloaded"
  ],
  [
    "Hoàn tất ngâm",
    "Complete Warm-up"
  ],
  [
    "Ngâm 72h vàng",
    "72h Golden Warm-up"
  ],
  [
    "Mở thử Chrome",
    "Test Open Chrome"
  ],
  [
    "Tự tạo tối đa",
    "Can create max"
  ],
  [
    "🟢 Đã kết nối ",
    "🟢 Connected "
  ],
  [
    "% ngưỡng bill",
    "% of billing threshold"
  ],
  [
    "Quản trị viên",
    "Admin"
  ],
  [
    "Thành viên BM",
    "BM Member"
  ],
  [
    "Đồng bộ từ BM",
    "Synced from BM"
  ],
  [
    "Đô la Mỹ USD",
    "US Dollar (USD)"
  ],
  [
    "1 TKQC (BM1)",
    "1 Ad Account (BM1)"
  ],
  [
    "Còn tạo được",
    "Can create"
  ],
  [
    "Đồng bộ ngay",
    "Sync Now"
  ],
  [
    "Via Lên Camp",
    "Media Buying Via"
  ],
  [
    "Via Dự Phòng",
    "Standby Via"
  ],
  [
    "Cảnh báo mở:",
    "Open Alerts:"
  ],
  [
    "Xem tất cả →",
    "View All →"
  ],
  [
    "Thẻ đang gắn",
    "Card linked to"
  ],
  [
    "Chưa gắn thẻ",
    "No card linked"
  ],
  [
    "TK đang sống",
    "active accts"
  ],
  [
    "thẻ đang gắn",
    "linked cards"
  ],
  [
    "Có dư nợ > 0",
    "Has Balance > 0"
  ],
  [
    "BM Chưa XMDN",
    "BM Unverified"
  ],
  [
    "Đã chép 6 số",
    "Copied 6 digits"
  ],
  [
    "Sao chép 2FA",
    "Copy 2FA"
  ],
  [
    "Đổi khóa 2FA",
    "Change 2FA Key"
  ],
  [
    "Nợ / Hạn chế",
    "Past Due / Restricted"
  ],
  [
    "Đã copy link",
    "Link copied"
  ],
  [
    "BM chủ quản:",
    "Parent BM:"
  ],
  [
    "Hồ sơ Chrome",
    "Chrome Profiles"
  ],
  [
    "VIA dự phòng",
    "backup Vias"
  ],
  [
    "Nghiêm trọng",
    "Critical"
  ],
  [
    "Slide trước",
    "Previous slide"
  ],
  [
    "Via cầm BM:",
    "Holding Vias:"
  ],
  [
    "TK có dư nợ",
    "accts with balance"
  ],
  [
    "Đã xác minh",
    "Verified"
  ],
  [
    "Đang lấy...",
    "Fetching..."
  ],
  [
    "Tự động lấy",
    "Auto-Fetch"
  ],
  [
    "Hết hạn thẻ",
    "Card Expiry"
  ],
  [
    "Hết hạn vào",
    "Expires"
  ],
  [
    "Quốc gia ĐK",
    "Country"
  ],
  [
    "Đã ghi nhận",
    "Acknowledged"
  ],
  [
    "ngưỡng bill",
    "of threshold"
  ],
  [
    "Mở Chrome (",
    "Open Chrome ("
  ],
  [
    "Sở hữu TKQC",
    "Owns Ad Account"
  ],
  [
    "Giữ BM gốc",
    "Hold Root BM"
  ],
  [
    "không dùng",
    "do not use"
  ],
  [
    "· Hạn mức:",
    "· Safe Limit:"
  ],
  [
    "[TKQC Mới]",
    "[New Ad Acct]"
  ],
  [
    "Ẩn ô Token",
    "Hide Token Input"
  ],
  [
    "Chi tiết →",
    "Details →"
  ],
  [
    "Quan trọng",
    "Essential"
  ],
  [
    "Số dư đạt:",
    "Threshold:"
  ],
  [
    "Bỏ lọc thẻ",
    "Clear card filter"
  ],
  [
    "Đã gắn thẻ",
    "Card Linked"
  ],
  [
    "TK Cá nhân",
    "Personal Acct"
  ],
  [
    "BM Đã XMDN",
    "BM Verified"
  ],
  [
    "Đã kết nối",
    "Connected"
  ],
  [
    "Tất cả Via",
    "All Vias"
  ],
  [
    "Tổng dư nợ",
    "Total Balance"
  ],
  [
    ", truy cập",
    ", go to"
  ],
  [
    "Ghim (Pin)",
    "Pin"
  ],
  [
    "Mã số thuế",
    "Tax ID"
  ],
  [
    "Chưa có ID",
    "No ID yet"
  ],
  [
    "2 BM / Via",
    "2 BMs / Via"
  ],
  [
    "Trần Meta:",
    "Meta Cap:"
  ],
  [
    "Tiêu chuẩn",
    "Standard"
  ],
  [
    "Đã có bill",
    "Billed"
  ],
  [
    "Pixel của ",
    "Pixel of "
  ],
  [
    "Chạy file",
    "Run file"
  ],
  [
    "bên dưới.",
    "below."
  ],
  [
    "TKQC khác",
    "more Ad Accounts"
  ],
  [
    "trên Meta",
    "on Meta"
  ],
  [
    "Tách biệt",
    "Separate"
  ],
  [
    "Chưa XMDN",
    "Unverified"
  ],
  [
    "Chung với",
    "Shared with"
  ],
  [
    "Ngâm ngày",
    "Warm-up Day"
  ],
  [
    "Mở Chrome",
    "Open Chrome"
  ],
  [
    "Hoạt động",
    "Active"
  ],
  [
    "Pháp nhân",
    "Legal Entity"
  ],
  [
    "Tháng 10,",
    "Oct"
  ],
  [
    "Tháng 11,",
    "Nov"
  ],
  [
    "Tháng 12,",
    "Dec"
  ],
  [
    "Chưa gắn",
    "Not linked"
  ],
  [
    "[ID Mới]",
    "[New ID]"
  ],
  [
    "Ngày TT:",
    "Bill Date:"
  ],
  [
    "Mạng gốc",
    "Direct Network"
  ],
  [
    "MẠNG GỐC",
    "DIRECT NET"
  ],
  [
    "Tên TKQC",
    "Ad Account Name"
  ],
  [
    "Tiền tệ:",
    "Currency:"
  ],
  [
    "Việt Nam",
    "Vietnam"
  ],
  [
    "Mặc định",
    "Default"
  ],
  [
    "Gần nhất",
    "Latest"
  ],
  [
    "IP/Mạng:",
    "IP/Network:"
  ],
  [
    "Cảnh báo",
    "Warning"
  ],
  [
    "% ngưỡng",
    "% of threshold"
  ],
  [
    "An toàn:",
    "Safe:"
  ],
  [
    "Tất cả (",
    "All ("
  ],
  [
    "Via Tổng",
    "Master Via"
  ],
  [
    "Dự Phòng",
    "Standby"
  ],
  [
    "Lên Camp",
    "Media Buying"
  ],
  [
    " chạy · ",
    " active · "
  ],
  [
    "hồ sơ) —",
    "profiles) —"
  ],
  [
    "Đã dùng ",
    "Used "
  ],
  [
    "% ngưỡng",
    "% of threshold"
  ],
  [
    "chạy · 🟡",
    "active · 🟡"
  ],
  [
    "Hết hạn ",
    "Expires "
  ],
  [
    "Tháng 1,",
    "Jan"
  ],
  [
    "Tháng 2,",
    "Feb"
  ],
  [
    "Tháng 3,",
    "Mar"
  ],
  [
    "Tháng 4,",
    "Apr"
  ],
  [
    "Tháng 5,",
    "May"
  ],
  [
    "Tháng 6,",
    "Jun"
  ],
  [
    "Tháng 7,",
    "Jul"
  ],
  [
    "Tháng 8,",
    "Aug"
  ],
  [
    "Tháng 9,",
    "Sep"
  ],
  [
    "Đã XMDN",
    "Verified"
  ],
  [
    "Lưu 2FA",
    "Save 2FA"
  ],
  [
    "Đã chép",
    "Copied"
  ],
  [
    "Bấm nút",
    "Click"
  ],
  [
    "Tiền tệ",
    "Currency"
  ],
  [
    "Lũy kế:",
    "Lifetime:"
  ],
  [
    "Địa chỉ",
    "Address"
  ],
  [
    "Tạm tắt",
    "Suppressed"
  ],
  [
    "Nợ cước",
    "Past Due"
  ],
  [
    "Đã đóng",
    "Closed"
  ],
  [
    "Ngưỡng:",
    "Threshold:"
  ],
  [
    "Đã dùng",
    "Used"
  ],
  [
    "của Via",
    "for Via"
  ],
  [
    "An toàn",
    "Safe"
  ],
  [
    "Cá nhân",
    "Personal"
  ],
  [
    "Dư nợ:",
    "Balance:"
  ],
  [
    "Ngày (",
    "Date ("
  ],
  [
    "Hồ sơ:",
    "Profile:"
  ],
  [
    "5 Bước",
    "6 Steps"
  ],
  [
    "6 Bước",
    "6 Steps"
  ],
  [
    "Tháng ",
    "Month "
  ],
  [
    " nợ · ",
    " past due · "
  ],
  [
    "hồ sơ)",
    "profiles)"
  ],
  [
    "• Dùng",
    "• Use"
  ],
  [
    "Hỗ trợ",
    "Supports"
  ],
  [
    " cùng ",
    " and "
  ],
  [
    ") Ngay",
    ") Now"
  ],
  [
    "nợ · 🔴",
    "past due · 🔴"
  ],
  [
    ", cùng",
    ", and"
  ],
  [
    "Hoa Kỳ",
    "United States"
  ],
  [
    "Đã mở",
    "Opened"
  ],
  [
    "và mã",
    "and"
  ],
  [
    "Dư nợ",
    "Balance"
  ],
  [
    " khác",
    " more"
  ],
  [
    "Bước ",
    "Step "
  ],
  [
    "cạnh",
    "next to"
  ],
  [
    " tắt",
    " disabled"
  ],
  [
    "Dùng",
    "Use"
  ],
  [
    "Ngay",
    "Now"
  ],
  [
    " và ",
    " and "
  ],
  [
    "Cầm ",
    "Holds "
  ],
  [
    "Nợ:",
    "Debt:"
  ],
  [
    "Xóa",
    "Delete"
  ],
  [
    "Sửa",
    "Edit"
  ],
  [
    "Hủy",
    "Cancel"
  ],
  [
    "Bấm",
    "Click"
  ]
]

export function translateViStringToEn(input: string): string {
  if (!input || !VN_CHAR_RE.test(input)) return input
  const norm = input.replace(/\s+/g, ' ')
  const trimmed = norm.trim()
  if (!trimmed) return input

  const exact = EXACT_TRIMMED[trimmed]
  if (exact !== undefined) {
    const lead = input.match(/^\s*/)?.[0] ?? ''
    const trail = input.match(/\s*$/)?.[0] ?? ''
    return lead + exact + trail
  }

  let out = norm
  for (const [viStr, enStr] of PHRASE_PAIRS) {
    if (out.includes(viStr)) {
      out = out.split(viStr).join(enStr)
    }
  }

  const lead = input.match(/^\s*/)?.[0] ?? ''
  const trail = input.match(/\s*$/)?.[0] ?? ''
  return lead + out.trim() + trail
}

const originalTextMap = new WeakMap<Node, string>()
const lastTranslatedTextMap = new WeakMap<Node, string>()
const originalAttrMap = new WeakMap<Element, Record<string, string>>()
const lastTranslatedAttrMap = new WeakMap<Element, Record<string, string>>()
const trackedTextNodes = new Set<WeakRef<Node>>()
const trackedAttrElements = new Set<WeakRef<Element>>()

const TRANSLATABLE_ATTRS = ['title', 'placeholder', 'aria-label'] as const

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return true
  const tag = el.tagName
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA'
}

export function applyDomLanguage(language: Language, root: Node = document.body): void {
  if (typeof document === 'undefined' || !root) return

  if (language === 'vi') {
    for (const ref of trackedTextNodes) {
      const node = ref.deref()
      if (!node) {
        trackedTextNodes.delete(ref)
        continue
      }
      const orig = originalTextMap.get(node)
      const lastTr = lastTranslatedTextMap.get(node)
      if (orig !== undefined && (node.nodeValue === lastTr || !VN_CHAR_RE.test(node.nodeValue ?? ''))) {
        node.nodeValue = orig
      }
      lastTranslatedTextMap.delete(node)
    }
    for (const ref of trackedAttrElements) {
      const el = ref.deref()
      if (!el) {
        trackedAttrElements.delete(ref)
        continue
      }
      const origAttrs = originalAttrMap.get(el)
      const lastAttrs = lastTranslatedAttrMap.get(el)
      if (origAttrs && lastAttrs) {
        for (const attr of TRANSLATABLE_ATTRS) {
          if (origAttrs[attr] !== undefined && el.getAttribute(attr) === lastAttrs[attr]) {
            el.setAttribute(attr, origAttrs[attr])
          }
        }
      }
      lastTranslatedAttrMap.delete(el)
    }
    return
  }

  // language === 'en'
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current: Node | null = walker.nextNode()
  while (current) {
    const parent = current.parentElement
    if (!shouldSkipElement(parent)) {
      const val = current.nodeValue
      if (val && VN_CHAR_RE.test(val)) {
        const lastTr = lastTranslatedTextMap.get(current)
        if (val !== lastTr) {
          originalTextMap.set(current, val)
          const translated = translateViStringToEn(val)
          if (translated !== val) {
            lastTranslatedTextMap.set(current, translated)
            current.nodeValue = translated
            trackedTextNodes.add(new WeakRef(current))
          }
        }
      }
    }
    current = walker.nextNode()
  }

  if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
    const elements =
      root instanceof Element
        ? [root, ...Array.from(root.querySelectorAll('[title],[placeholder],[aria-label]'))]
        : Array.from(root.querySelectorAll('[title],[placeholder],[aria-label]'))

    for (const el of elements) {
      if (shouldSkipElement(el)) continue
      let origAttrs = originalAttrMap.get(el)
      let lastAttrs = lastTranslatedAttrMap.get(el)
      let touched = false
      for (const attr of TRANSLATABLE_ATTRS) {
        const val = el.getAttribute(attr)
        if (val && VN_CHAR_RE.test(val)) {
          if (!origAttrs) {
            origAttrs = {}
            originalAttrMap.set(el, origAttrs)
          }
          if (!lastAttrs) {
            lastAttrs = {}
            lastTranslatedAttrMap.set(el, lastAttrs)
          }
          if (val !== lastAttrs[attr]) {
            origAttrs[attr] = val
            const translated = translateViStringToEn(val)
            if (translated !== val) {
              lastAttrs[attr] = translated
              el.setAttribute(attr, translated)
              touched = true
            }
          }
        }
      }
      if (touched) {
        trackedAttrElements.add(new WeakRef(el))
      }
    }
  }
}
