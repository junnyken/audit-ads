# Hướng dẫn cho chủ Business Manager — chia sẻ tài khoản quảng cáo sang BM hub của đội

> **BẢN NHÁP — CHỜ BA DUYỆT.** Agent soạn từ `docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md` §5 (quyết
> định §9 8.8: agent soạn nháp, BA duyệt câu chữ và chụp ảnh). **Chưa gửi cho chủ BM nào.**
>
> **Toàn bộ nhãn menu dưới đây là [CHƯA KIỂM].** Thân hai bài trợ giúp chính thức của Meta
> (`facebook.com/business/help/1717412048538897` — *Give a Partner Access to Business Assets in Your
> Business Portfolio*, và `…/708679622611131` — *Add Partners to Your Business Portfolio*) không tải
> được khi soạn (2026-10-27), chỉ có tiêu đề; thứ tự bước lấy từ bản tóm tắt tìm kiếm của chính các
> trang đó. Meta đổi tên "Business Manager" ↔ "Business portfolio" ↔ "Meta Business Suite", và nhãn
> khác nhau giữa giao diện tiếng Việt và tiếng Anh. **Hãy bám theo thứ tự các bước**, không bám theo
> từng chữ. BA kiểm trên giao diện thật, thay nhãn đúng, thêm ảnh chụp, rồi bỏ các nhãn [CHƯA KIỂM].

---

## Bạn đang làm gì, và không làm gì

- Bạn **chia sẻ quyền xem** một số tài khoản quảng cáo (và nếu muốn, Pixel) của BM bạn sang BM
  của đội, mã **`1993884657458857`** (gọi là "BM hub"). Mã này không phải bí mật — nó hiện trong
  Business Settings của bất kỳ ai làm việc với BM đó.
- Bạn **không chuyển quyền sở hữu**. Tài khoản vẫn thuộc BM của bạn; bạn thu hồi được bất cứ lúc
  nào trong mục Đối tác (Partners).
- Phía đội **chỉ đọc**: công cụ của đội không thể tạo, sửa, chia sẻ hay thanh toán gì trên tài khoản
  của bạn — phần kết nối Meta của nó về cấu trúc chỉ có lệnh đọc (GET).
- Công cụ **không hứa hẹn gì về trạng thái tài khoản**: nó báo lại những gì Meta trả về, không nói
  tài khoản "an toàn" hay "sẽ không bị hạn chế".

## Bước 1 — Điều kiện  [CHƯA KIỂM từng ý]

1. Người thao tác có **toàn quyền** (*full control* / Admin) trên BM của mình.
2. BM đã bật **xác thực hai yếu tố** theo yêu cầu của Meta.
3. Có sẵn **ID BM hub của đội**: `1993884657458857`.

## Bước 2 — Thêm đối tác và gán tài khoản quảng cáo  [CHƯA KIỂM nhãn]

1. Mở **Business Settings** / **Cài đặt doanh nghiệp** của BM mình (`business.facebook.com/settings`).
2. Vào **Users → Partners** (*Người dùng → Đối tác*) → **Add** (*Thêm*) → chọn
   **"Give a partner access to your assets"** (*Cấp cho đối tác quyền truy cập tài sản của bạn*).
   **Không** chọn "Ask a partner to share their assets".
3. Nhập **Partner business ID** = `1993884657458857` → **Next**.
4. Chọn loại tài sản **Ad accounts** (*Tài khoản quảng cáo*) → tick các tài khoản muốn đội theo dõi →
   chọn **mức quyền thấp nhất chỉ để xem** (nhãn kiểu "View performance" / "Partial access" —
   [CHƯA KIỂM]). Tránh "Manage ad account" / "Full control": đội không cần, và công cụ không dùng.
5. Bấm **Assign assets** / **Save**. Bài trợ giúp nói có thể cần một admin toàn quyền khác của BM bạn
   **duyệt** thao tác này [CHƯA KIỂM].

## Bước 3 — Pixel (chỉ khi muốn đội thấy Pixel)  [CHƯA KIỂM]

- Vẫn trong hộp thoại đối tác, hoặc vào **Data sources → Pixels / Datasets** (*Nguồn dữ liệu*) → chọn
  Pixel → **Assign partners** → tick, mức quyền **View** / ANALYZE.
- Theo tài liệu API của Meta (đọc 2026-10-27), chia sẻ Pixel cho một doanh nghiệp đối tác dùng các
  quyền `ANALYZE / UPLOAD / ADVERTISE` (`EDIT` bị hạn chế), và **có thể cần BM nhận chấp thuận** nếu
  hai bên chưa có quan hệ đối tác.
- Ghi chú cho đội: hôm nay công cụ chỉ đọc cạnh `adspixels` của BM hub; Pixel được chia sẻ có hiện ở
  đó hay chỉ ở `client_pixels` thì **[CHƯA KIỂM]**. Pixel không bao giờ được tự nhập vào registry
  (giới hạn của mô hình dữ liệu) — chỉ được đếm trong tin tóm tắt.

## Bước 4 — Phía đội (admin BM hub làm, mỗi đợt chia sẻ một lần)

Tài sản được chia sẻ vào BM hub **không tự hiện với system user** `adsops-readonly`: system user chỉ
thấy tài sản được gán cho nó (`docs/RUNBOOK_META_CONNECTION.md`, phần system user).

1. Business Settings của BM hub → **Users → System users** → chọn system user của công cụ.
2. **Assign assets** → tick các tài khoản / Pixel vừa được chia sẻ → mức quyền chỉ xem.

Bằng chứng 2026-09-10 (`TEST_LOG.md`): hai tài khoản được chia sẻ **đã** được gán và liệt kê được.
Đây là thao tác tay **còn lại** của mô hình hub. Nếu Meta cho phép gán "mọi tài sản hiện tại và tương
lai" cho system user thì bước này biến mất — **[CHƯA KIỂM]**.

## Bước 5 — Kiểm

1. Trên dashboard, connection của BM hub phải là **Production** và đã bật **Discover automatically**
   (chủ workspace bật trên thẻ connection; mỗi lần bật/tắt đều có dòng audit ghi tên người bật).
   Muốn tài khoản mới tự vào registry thì bật thêm **Also add new ad accounts to the registry**.
2. Chạy một lượt bằng tay (người vận hành, trên máy chủ):
   `python -m app.commands.run_dispatcher --discovery-sweep` — hoặc bấm **Run discovery** trên
   connection hub.
3. Tài khoản mới phải hiện dưới cạnh **Client accounts** kèm tên. Nếu tự nhập đang bật, nó vào
   registry, nằm dưới BM hub, và dòng nguồn gốc trên tab Overview của tài khoản ghi "Shared from Business Manager <ID BM
   của bạn>" nếu Meta trả về BM sở hữu (trường này **[CHƯA KIỂM]** với token của hub — không có thì
   ghi "Owning Business Manager not returned by Meta", không đoán).
4. Nếu ra `0` tài khoản: xem lại **Bước 4** trước khi nghi ngờ công cụ.

## Trước khi bật tự nhập cho lần đầu (cho đội)

Lần nhập đầu của nhiều tài khoản sinh nhiều cảnh báo. Đã có ba lớp chặn bão: một tin tóm tắt mỗi lượt
mỗi connection; ân hạn 24 giờ cho cảnh báo mức `warning` của tài khoản vừa tự nhập (không bao giờ áp
cho `critical`); và hai đòn bẩy có sẵn — tắt luật `manual_review_due_or_stale` cho cả workspace, hoặc
để trống chat Telegram cho tới khi lượt nhập đầu xong.

Bật nhịp quét tự động trên production (`DISCOVERY_SWEEP_EVERY_N_PASSES > 0`) là **một quyết định
phát hành riêng, có tên người duyệt** — chưa ai duyệt.
