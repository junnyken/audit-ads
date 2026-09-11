# Runbook — Kết nối Business Manager thật của Meta (A10, chỉ đọc)

Dành cho thời điểm anh đã có token và chuẩn bị gọi thật lần đầu. Đọc hết trang này trước khi
chạy bất cứ thứ gì — toàn bộ ý nghĩa của A10 là làm cho bước này có chủ đích.

> Tài liệu này viết bằng tiếng Việt vì nó là thứ người vận hành thao tác trực tiếp. Các tài liệu
> kỹ thuật khác trong `docs/` vẫn bằng tiếng Anh theo quy ước dự án. Tên biến, đường dẫn, câu
> lệnh và mã lỗi giữ nguyên bản gốc — đó là thứ anh sẽ gõ và sẽ nhìn thấy trên màn hình.

**Bản build này làm được gì:** đọc xem một token nhìn thấy những Business Manager nào.
**Không làm được gì:** tạo tài khoản quảng cáo, chia sẻ quyền, chia sẻ Pixel. Các hàm đó
*raise* theo thiết kế, và tầng transport bên dưới không có method nào ghi được — không có gì để
bật, cũng không có gì để lỡ tay bật quên tắt.

## 1. Cần có trước khi bắt đầu

Từ phía Meta (chi tiết ở `AUDIT_BEFORE_BUILD_A10.md` §6):

- Một **Meta App** (loại Business).
- Một **Business Manager** anh thật sự kiểm soát — đây là đích của lượt đọc đầu tiên.
- Một **System User** bên trong BM đó, đã tạo token.
- Quyền **`business_management`** (read) và **`ads_read`** đã được duyệt cho token đó.

- **BM id** của chính Business Manager đó (Business Settings → Thông tin doanh nghiệp). Bắt buộc
  với system user token — mục 5 giải thích vì sao. Đây không phải bí mật.

Ba thứ đầu tạo ở đâu, bấm nút nào → **mục 2** ngay bên dưới.

Và một quyết định: pin phiên bản Graph API nào. Mặc định là `v21.0`
(`META_GRAPH_API_VERSION`). Đổi nó phải là một quyết định có chủ đích, đi kèm một lần release —
không đổi tiện tay.

## 2. Tạo token ở đâu (đường đi trên giao diện Meta)

> Phần này viết theo **tên mục**, không phải ảnh chụp màn hình: Meta đổi giao diện Business
> Settings khá thường xuyên, và tên hiển thị còn khác nhau giữa UI tiếng Việt và tiếng Anh. Nếu
> tên mục anh thấy lệch so với dưới đây, bám theo *thứ tự* các bước — thứ tự thì ổn định.

**Bước A — Có một Meta App (làm một lần)**

1. Vào <https://developers.facebook.com/apps> → **Create App**.
2. Chọn loại **Business**. Đặt tên gì cũng được, tên này người ngoài không thấy.
3. Ghi lại **App ID**. Anh chưa cần App Secret cho A10 (chỉ đọc).

**Bước B — Gắn App đó vào Business Manager**

Vào <https://business.facebook.com/settings> → chọn đúng Business ở góc trên bên trái →
**Accounts** → **Apps** → **Add** → chọn App vừa tạo.

Đừng bỏ qua bước này. Nếu App chưa gắn vào BM thì ở Bước C nó **sẽ không xuất hiện** trong danh
sách app khi anh bấm tạo token — và triệu chứng đó rất dễ bị hiểu nhầm thành "App tạo hỏng".

**Bước C — Tạo System User và sinh token**

Vẫn trong Business Settings của BM đó:

1. **Users** → **System users** (URL trực tiếp: <https://business.facebook.com/settings/system-users>).
2. **Add** → đặt tên gợi nhớ, ví dụ `adsops-readonly` → vai trò **Employee access** là đủ cho
   A10. Chỉ chọn Admin access khi thật sự cần, và A10 thì không cần.
3. Chọn system user vừa tạo → **Assign assets** → gán các **Ad accounts** (và Business) mà anh
   muốn nó đọc được. System user chỉ nhìn thấy tài sản được gán cho nó — không gán thì probe vẫn
   chạy nhưng trả về danh sách rỗng.
4. **Generate new token** → chọn **App** ở Bước A → tick đúng hai quyền:
   **`business_management`** và **`ads_read`** → **Generate token**.

Anh phải là **admin của BM** mới thấy được các nút này. Nếu không thấy, vấn đề là quyền tài
khoản của anh trên BM chứ không phải anh làm sai bước.

**Token chỉ hiện ra đúng một lần.** Đóng hộp thoại là mất, phải sinh lại cái mới. Nên trước khi
bấm Generate, hãy mở sẵn chỗ anh định dán nó vào (mục 3 nói rõ chỗ nào là hợp lệ).

Về App Review: với system user đọc tài sản trong chính BM của anh, hai quyền trên thường dùng
được ngay mà không cần App Review. Tôi cố ý viết "thường" — cái này phụ thuộc trạng thái App của
anh và tôi không kiểm chứng được từ đây. Nếu thiếu quyền thật thì probe ở mục 4 sẽ báo
`permission_missing`, và đó chính là cách để biết chắc thay vì đoán.

## 3. Token để ở đâu

**Chỉ đặt trong biến môi trường của server, không ở đâu khác:**

```bash
META_ACCESS_TOKEN='<system user token>'
```

Không đưa vào file nào trong repo này. Không đưa vào database — sản phẩm này không có cột nào
cho nó và sẽ không sinh ra cột đó. Không đưa vào chat, ticket hay ảnh chụp màn hình.
`token_configured` trong API chỉ là một biến boolean được tính ra; bản thân token không bao giờ
rời khỏi phần cấu hình.

Nếu lỡ token bị dán vào chỗ không nên, coi như nó đã cháy: vào phần System User của BM thu hồi
rồi tạo token mới. Việc đó rẻ. Dọn hậu quả về sau thì không.

## 4. Cú gọi thật đầu tiên

Anh tự chạy, nên có thêm một người nữa cùng xem, và đọc kỹ output trước khi làm gì tiếp:

```bash
cd backend
.venv/bin/python scripts/a10_live_probe.py
```

Script tự hỏi token bằng một prompt ẩn — anh dán mã vào, Enter, màn hình không hiện gì cả. Token
nằm trong bộ nhớ tiến trình đúng một lượt gọi rồi mất.

**Đừng** gõ dạng `META_ACCESS_TOKEN='<token>' .venv/bin/python ...` trên một dòng. Dạng đó ghi
token vào `~/.bash_history` dưới dạng chữ thường và nằm lại đó rất lâu sau khi anh quên mất là
mình từng chạy nó. Prompt ẩn không đi vào history.

(Biến môi trường `META_ACCESS_TOKEN` nếu đã có sẵn thì vẫn được ưu tiên dùng — dành cho server đã
cấu hình, nơi không có ai ngồi gõ.)

Mỗi lần chạy tốn **2 lượt GET**, không phải một: `probe()` một lượt, `check_capability()` một
lượt nữa. Script in rõ số lượt trước khi gửi bất cứ thứ gì. Các cờ thêm lượt:

| Cờ | Thêm | Dùng khi |
|---|---|---|
| `--list` | +1 | Muốn in toàn bộ BM token nhìn thấy, không chỉ cái đầu |
| `--bm <id>` | +2 | `visible now : 0` — đọc `me` rồi đọc thẳng BM, để tách "token không thấy BM này" khỏi "sai edge" |
| `--discover` | +3 | Hỏi xem Meta có chịu nói business nào đứng sau token không |

**Chạy đúng thì trông như thế này:**

```
RESULT      : OK — the token can read Business Managers
visible now : 1 (limit was 1, so this is 'at least one', not a total)
  - 1234567890  Your Agency BM
```

**Từng loại lỗi nghĩa là gì:**

| Output | Thực chất đã xảy ra chuyện gì | Cần làm gì |
|---|---|---|
| `token_expired` | Token hết hạn, bị thu hồi, hoặc chưa bao giờ hợp lệ | Tạo System User token mới |
| `permission_missing` | Token vẫn ổn, nhưng thiếu `business_management`/`ads_read` — hoặc không có quyền trên BM đó | Cấp quyền trong BM rồi chạy lại |
| `rate_limited` | Đã chạm ngưỡng của Meta | Chờ. **Đừng** chạy probe lặp lại — chính việc đó gây ra lỗi này |
| `provider_server_error` | Meta trả 5xx, hoặc không kết nối được | Thử lại sau. Phía mình không có gì sai |
| `invalid_request` | Phiên bản Graph hoặc đường dẫn bị từ chối | Kiểm tra `META_GRAPH_API_VERSION` có khớp với thứ App của anh hỗ trợ không |
| `not_configured` | Meta trả 200 nhưng **rỗng**: chưa khai `META_BUSINESS_ID`, hoặc id đã khai không dẫn tới đâu | Khai BM id — xem mục 5. Đây không phải lỗi quyền: Meta không hề từ chối |

Riêng `not_configured` là mã đặc biệt: nó **không** đến từ Meta mà do sản phẩm tự kết luận, khi
cuộc gọi thành công nhưng không mang về gì. Trước đây chỗ này báo "OK" — xem mục 5 để hiểu vì
sao như vậy là sai.

Ghi kết quả vào `TEST_LOG.md` — ghi **hình dạng response thật**, không phải bản tóm tắt. Một cú
gọi thật mà không ai ghi lại thì coi như chưa từng xảy ra.

## 5. Trỏ sản phẩm vào kết nối thật

Chỉ làm sau khi probe chạy thành công:

**Trước hết, khai BM id vào cấu hình server:**

```bash
META_BUSINESS_ID='1993884657458857'
```

Bắt buộc khi dùng **system user token**, và lý do là chuyện đã kiểm chứng thật chứ không phải
suy đoán: Meta **không chịu nói** business nào đứng sau một system user token. Ngày 2026-09-10,
trên BM thật, hỏi ba cách đều không ra — `business` là trường thì trả `invalid_request` (không
có trường đó), `businesses` dù là trường mở rộng hay edge đều trả rỗng — trong khi đọc thẳng BM
theo id thì được. Một system user chỉ thuộc đúng một business, và Meta không cho hỏi là business
nào, nên id phải do người vận hành khai.

Khác với token, **BM id không phải bí mật** — nó hiện công khai trong Business Settings. Nó được
phép xuất hiện trong log và trong finding.

Sau đó:

1. Settings → **Meta connections** → tạo connection với environment là **`production`**.
2. Bấm **Check capability**. Đây là thứ *duy nhất* trong ứng dụng đang chạy có thể gọi Meta. Mỗi
   lần bấm tốn **2 lượt gọi** (một lượt kiểm tra capability, một lượt lấy danh sách BM), và cả
   hai đều có giới hạn rõ ràng.

**Phải đủ hai điều kiện độc lập** thì mới có thể xảy ra một cú gọi thật: connection được đánh
dấu `production` *và* server có `META_ACCESS_TOKEN`. Thiếu một trong hai thì vẫn dùng fake
provider. Một connection `production` trên server không có token sẽ **âm thầm quay về fake thay
vì báo lỗi ầm ĩ** — đây là cố ý: môi trường cấu hình sai thì nên thoái lui về "không gọi gì
thật", chứ không phải bất ngờ gọi thật.

Phần capability sẽ báo `create_ad_account: false`, `share_ad_account_access: false` và
`share_pixel_access: false` kèm lý do `not_supported`. **Như vậy là đúng**, không phải cấu hình
sai: bản build này không thực hiện được các thao tác đó, nên báo là "có sẵn" mới chính là bịa ra
một trạng thái tích cực không có thật.

**Còn `list_business_managers` thì phải hiểu thế này:** nó chỉ `true` khi thật sự đọc về được ít
nhất một BM. Cuộc gọi thành công nhưng rỗng sẽ ra `false` kèm `not_configured`, **không** phải
`true`.

Đây là chỗ đã từng sai và đã sửa. Bản trước lấy giá trị này từ "Meta có trả 200 không", nên với
system user token nó báo `true` trong khi danh sách BM rỗng hoàn toàn — và connection được lưu
lại thành "đã xác nhận capability, 0 Business Manager". Một cổng kiểm tra báo đạt cho thứ không
khám phá được gì. Trả về 200 mà không mang theo gì là **thiếu bằng chứng**, không phải bằng
chứng có quyền (rule 4).

## 6. Chuyện rate limit

Mọi cú gọi discovery đều là tường minh — do người bấm nút, hoặc do người chạy probe. Không có
gì poll, không có gì tự gọi lại khi tải trang, không có gì tự retry nền. Nếu thấy `rate_limited`
nghĩa là có thứ gì đó đang gọi nhiều hơn mức đáng ra — hãy tìm ra nó trước khi nghĩ đến chuyện
nâng giới hạn.

Header `X-Business-Use-Case-Usage` của Meta có được ghi lại và probe sẽ in ra, nhưng chỉ để quan
sát. Bản build này **không** tự điều tiết theo nó, và cũng không giả vờ là có.

## 7. Quét tài sản của BM (A10.1)

Sau khi kết nối chạy được, sản phẩm đọc được **tài khoản quảng cáo và Pixel** thuộc BM đã cấu
hình, rồi đối chiếu với registry nội bộ. Vẫn chỉ đọc.

Thử bằng dòng lệnh trước khi bấm trên giao diện:

```bash
META_BUSINESS_ID=<bm id> .venv/bin/python scripts/a10_live_probe.py --assets
```

Một điều cần nắm để không hiểu nhầm kết quả: hệ thống chỉ được phép kết luận một tài sản **vắng
mặt** khi lần quét đã nhìn đủ **mọi** edge bắt buộc — không phải khi "không có lỗi nào". Tài
khoản quảng cáo nằm trên hai edge (`owned_ad_accounts` và `client_ad_accounts`), và trên BM thật
của anh chúng chia đôi 2–2. Chỉ đọc một edge thì vẫn "thành công" nhưng mất một nửa.

Vì vậy mỗi kết quả đều kèm `coverage_status`. Chỉ `complete` mới cho phép kết luận vắng mặt, và
kết luận đó chỉ có nghĩa **"không được trả về trong lần quét hoàn chỉnh gần nhất"** — không phải
Meta đã xoá hay khoá gì. Chi tiết đầy đủ: `docs/META_READ_ONLY_DISCOVERY.md`.

## 8. Muốn bật ghi thì cần gì

Đó là một mini-spec sau, không phải một thay đổi cấu hình. Tối thiểu cần: các quyền bổ sung đã
qua App Review, xác nhận BM đích, điều kiện billing trên BM đó, và một lần phê duyệt riêng để
chạy. Hôm nay các hàm ghi *raise* chính là để việc bật chúng lên buộc phải là một phần công việc
có chủ đích, chứ không phải một cái cờ ai đó gạt.
