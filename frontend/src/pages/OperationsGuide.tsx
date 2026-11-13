import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
} from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { translateViStringToEn } from '../i18n/domAutoTranslate'
import type { AdAccount, FacebookIdentitySummary, Paged, ReferenceRecord } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'

const ANTI_DIE_SLIDES = [
  {
    id: 'formula',
    shortTab: '⚡ 1. Công Thức Vận Hành Tổng Quát',
    badge: 'CÔNG THỨC VÀNG CHỐNG DIE VIA',
    title: 'Công thức vận hành bất tử cho Agency chạy Ads khách hàng',
    summary:
      '1 Via Tổng (Chỉ giữ BM/TKQC, tuyệt đối không lên camp) + Mỗi cụm khách 1 Via Lên Camp riêng (1 Chrome Profile + 1 Proxy tĩnh) + Luôn có ≥ 2 Via Dự phòng đã ngâm > 7 ngày + Xoá sạch bài Rejected & Canh số dư thẻ.',
    bullets: [
      'Không bao giờ dùng chung 1 con Via vừa cầm BM gốc vừa bấm lên chiến dịch nhạy cảm cho khách.',
      'Khi Via Lên Camp bị hạn chế quảng cáo: chỉ mất 30 giây vào Via Tổng gỡ ra và thay Via Dự phòng vào — BM gốc & TKQC khách hàng an toàn 100%.',
      'Mỗi dòng Via trong mục «Tài khoản Facebook» đều đã được tích hợp Bộ chọn Phân tầng 3 lớp, Đồng hồ canh 72h ngâm & Cảnh báo rủi ro liên đới.',
    ],
  },
  {
    id: 'tiers',
    shortTab: '🏛️ 2. Phân Tầng 3 Lớp Via',
    badge: 'NGUYÊN TẮC TÁCH QUYỀN',
    title: 'Chia dàn Via thành 3 Lớp tách biệt hoàn toàn nhiệm vụ',
    summary:
      'Tuyệt đối tách bạch quyền Sở hữu Tài sản (Admin BM) và quyền Lên Chiến dịch (Advertiser TKQC):',
    bullets: [
      '🛡️ Lớp 1 — Via Tổng / Giữ Tài Sản (1–2 con, VD: Tài Khoản Chính): Cầm Admin BM gốc, giữ Page/Pixel. CẤM bấm tạo camp, CẤM gắn thẻ lỗi. Chỉ mở 1–2 lần/tuần để phân quyền.',
      '🚀 Lớp 2 — Via Lên Camp (4–5 con): Chỉ nhận quyền Nhà quảng cáo (Advertiser) trên TKQC của khách để lên bài hàng ngày.',
      '🌱 Lớp 3 — Via Dự Phòng Ngâm Sẵn (2–3 con): Đã đăng nhập Chrome riêng, ngâm đủ > 7 ngày, nằm im chờ đôn lên thay thế ngay khi Lớp 2 gãy.',
    ],
  },
  {
    id: 'isolation',
    shortTab: '🌐 3. Cách Ly Chrome & Proxy',
    badge: 'CHỐNG CHẾT CHÙM THEO IP / COOKIE',
    title: 'Cách ly tuyệt đối Hồ sơ Google Chrome thật & Proxy IPv4 Dân cư tĩnh',
    summary:
      '1 Hồ sơ Chrome = 1 Via cố định · 1 Proxy IPv4 Dân cư tĩnh VN (Viettel/VNPT/FPT) = Tối đa 1–2 Via cùng cụm BM:',
    bullets: [
      'Tuyệt đối không đăng xuất Via này để đăng nhập Via khác trên cùng 1 cửa sổ Chrome. Luôn bấm nút «🚀 Mở Chrome» trên bảng để mở đúng Profile.',
      'Mạng Wifi/dây gốc văn phòng chỉ dùng cho 2–3 Via Lớp 1. Từ Via thứ 4 trở đi (Lớp 2 & Lớp 3) nên gắn Proxy IPv4 Dân cư tĩnh riêng.',
      'Không dùng VPN miễn phí, 1.1.1.1 hoặc Proxy Datacenter giá rẻ vì dải IP đó bị Meta đánh dấu spam.',
    ],
  },
  {
    id: 'warmup',
    shortTab: '⏳ 4. Quy Trình Ngâm 72h Vàng',
    badge: 'CHỐNG CHECKPOINT 956 / 282',
    title: 'Quy tắc "Ngâm 72 Giờ Vàng & 7 Ngày Trust" khi mới đăng nhập Via',
    summary:
      '90% Via chết ngay tuần đầu là do vừa đăng nhập vào máy mới đã bấm vào Trình quản lý quảng cáo hoặc đổi mật khẩu ngay:',
    bullets: [
      '⏳ Giờ 0 – 72h (Ngày 1–3): Đăng nhập Chrome riêng + lấy mã 2FA 6 số ngay trên bảng. CẤM vào Ads Manager, CẤM đổi mật khẩu, CẤM đá thiết bị cũ. Mở xem Watch/Newsfeed 5–10 phút/ngày.',
      '🟡 Ngày 4 – Ngày 7: Bắt đầu nhận lời mời vào BM (ưu tiên mời qua Email doanh nghiệp thay vì kết bạn ồ ạt).',
      '✅ Sau Ngày 7: Thiết bị & IP đã được Meta ghi nhận Trusted Device — mới đá các thiết bị lạ cũ và bắt đầu lên camp.',
    ],
  },
  {
    id: 'reverse_ban',
    shortTab: '💳 5. Chặn Chết Ngược Từ TKQC',
    badge: 'VỆ SINH THẺ & BÀI TỪ CHỐI',
    title: 'Chặn "Chết ngược" từ Thẻ bị từ chối (Đỏ thẻ) & Bài quảng cáo vi phạm (Rejected)',
    summary:
      'Nhiều khi Via không tự chết mà bị khóa khả năng quảng cáo do TKQC bên dưới nợ cước hoặc giữ quá nhiều bài bị từ chối:',
    bullets: [
      '💳 Không để "Đỏ thẻ" 3 lần liên tiếp: Kiểm tra bảng «Tổng hợp Dư nợ theo từng Thẻ» ở trang Tài khoản quảng cáo để nạp đủ tiền trước ngày cắn bill (1 Thẻ ≤ 3 TKQC).',
      '🧹 Xoá ngay các bài quảng cáo bị Từ chối (Rejected Ads): Không để nguyên bài bị từ chối nằm tồn đọng trong TKQC — hãy Xoá (Delete) hẳn bài lỗi đó đi trước khi lên bài mới.',
      '🛡️ Kiểm tra Chất lượng tài khoản định kỳ bằng nút «🧹 Dọn bài Rejected» trên đúng Chrome Profile của Via.',
    ],
  },
  {
    id: 'passkey',
    shortTab: '🚫 6. Chặn & Tự Xoá Passkey',
    badge: 'CHỐNG KẸT KHÓA TRUY CẬP (PASSKEY)',
    title: 'Chặn đứng bảng Passkey (Windows Hello) & 1 chạm Tự động Xoá Passkey trong Account Center',
    summary:
      'Từ 2025–2026, Facebook liên tục bật bảng Windows Security đòi Khóa truy cập (Passkey) hoặc gạ tạo Passkey khi đăng nhập Via, làm kẹt cứng Via vào 1 máy tính:',
    bullets: [
      '🚫 Khiên Chặn Passkey Tự Động (passkey_shield.js): Tiện ích AdsOps Companion v2.5 Pro khóa thẳng hàm WebAuthn (PublicKeyCredential) ngay trước khi trang Facebook tải xong — bảng Windows Hello / QR Passkey sẽ KHÔNG BAO GIỜ nhảy lên nữa, ép Facebook chuyển thẳng về ô nhập mã 2FA 6 số.',
      '🗑️ Nút 1 Chạm «🚫 Quét & Xoá Passkey» trên bảng Via: Bấm 1 nút trên bảng Tài khoản Facebook (hoặc trong Popup tiện ích), trình duyệt sẽ mở thẳng trang Quản lý Passkey của Meta và tự động phát hiện + bấm Xoá sạch Passkey đang lưu.',
      '⚡ Tự động đóng bảng gạ Tạo Passkey & Tự bấm «Thử cách khác → Ứng dụng xác thực» nếu gặp Via cũ bị chủ trước cài Passkey.',
    ],
  },
] as const

export default function OperationsGuide() {
  const { language } = useI18n()
  const isEn = language === 'en'
  const [slideIdx, setSlideIdx] = useState(0)

  const viasQuery = useQuery({
    queryKey: ['personal-account-references', 'guide'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=200'),
  })
  const summaryQuery = useQuery({
    queryKey: ['facebook-identities', 'summary-guide'],
    queryFn: () => api.get<FacebookIdentitySummary[]>('/api/v1/facebook-identities/summary'),
  })
  const accountsQuery = useQuery({
    queryKey: ['accounts', 'guide'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const stats = useMemo(() => {
    const vias = viasQuery.data?.items ?? []
    const summaries = new Map((summaryQuery.data ?? []).map((s) => [s.id, s]))
    const accs = accountsQuery.data?.items ?? []

    let vault = 0
    let camp = 0
    let standby = 0
    for (const v of vias) {
      const notes = String(v.notes ?? '')
      const lbl = String(v.label ?? '').toLowerCase()
      const s = summaries.get(v.id)
      const bmCount = s?.business_manager_count ?? 0
      const adCount = s?.ad_account_count ?? 0
      if (/\[TIER:vault\]/i.test(notes)) vault++
      else if (/\[TIER:standby\]/i.test(notes)) standby++
      else if (/\[TIER:camp\]/i.test(notes)) camp++
      else if (bmCount >= 3 || lbl.includes('chính') || lbl.includes('tổng')) vault++
      else if (adCount === 0 || lbl.includes('mới') || lbl.includes('via 3')) standby++
      else camp++
    }

    const activeAccs = accs.filter((a) => a.status === 'active').length
    const debtAccs = accs.filter((a) => (Number(a.billing_meta?.balance_raw ?? a.spend_periods?.balance_raw ?? 0) || 0) > 0).length
    return {
      totalVias: vias.length,
      vault,
      camp,
      standby,
      totalAccs: accs.length,
      activeAccs,
      debtAccs,
    }
  }, [viasQuery.data, summaryQuery.data, accountsQuery.data])

  const rawSlide = ANTI_DIE_SLIDES[slideIdx] ?? ANTI_DIE_SLIDES[0]
  const activeSlide = isEn ? {
    ...rawSlide,
    shortTab: translateViStringToEn(rawSlide.shortTab),
    badge: translateViStringToEn(rawSlide.badge),
    title: translateViStringToEn(rawSlide.title),
    summary: translateViStringToEn(rawSlide.summary),
    bullets: rawSlide.bullets.map((b) => translateViStringToEn(b)),
  } : rawSlide

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Cẩm nang & Quy chuẩn Vận hành Agency</Badge>
              <Badge tone="positive">Chống Checkpoint 956/282 · Chống Chết Chùm BM & TKQC</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink">
              Hướng dẫn & Công Thức Vận Hành Chống Die Via / TKQC
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              Trang tổng hợp toàn bộ <strong>Công thức phân tầng 3 lớp Via</strong>, <strong>Quy trình ngâm 72 giờ vàng</strong>, <strong>Cách ly Hồ sơ Chrome & Proxy IPv4 tĩnh</strong>, cùng <strong>Hạn mức BM1 → BM5 → BM10 (XMDN)</strong> để đội ngũ vận hành tra cứu và áp dụng thống nhất.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary">
              <Link to="/facebook-accounts">
                <UserRoundCog className="mr-1.5 h-4 w-4" />
                Mở Bảng Phân Tầng Via ({stats.totalVias})
              </Link>
            </Button>
            <Button asChild>
              <Link to="/accounts">
                <CreditCard className="mr-1.5 h-4 w-4" />
                Mở Bảng TKQC & Dư Nợ Thẻ ({stats.totalAccs})
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* INTERACTIVE 5-STEP SLIDER: CÔNG THỨC VẬN HÀNH NÀY */}
      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm space-y-4" data-testid="anti-die-slider">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-extrabold text-brand-fg">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              SLIDER 5 BƯỚC: CÔNG THỨC VẬN HÀNH NÀY
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {ANTI_DIE_SLIDES.map((sl, idx) => (
                <button
                  key={sl.id}
                  type="button"
                  onClick={() => setSlideIdx(idx)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    slideIdx === idx
                      ? 'bg-brand-light text-brand-text border border-brand/40'
                      : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {sl.shortTab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-ink-muted">
              Bước {slideIdx + 1} / {ANTI_DIE_SLIDES.length}
            </span>
            <button
              type="button"
              onClick={() => setSlideIdx((prev) => (prev - 1 + ANTI_DIE_SLIDES.length) % ANTI_DIE_SLIDES.length)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-surface hover:bg-surface-muted text-ink"
              title="Slide trước"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSlideIdx((prev) => (prev + 1) % ANTI_DIE_SLIDES.length)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-surface hover:bg-surface-muted text-ink"
              title="Slide tiếp theo"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-12 items-start">
          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{activeSlide.badge}</Badge>
              <h2 className="text-base sm:text-lg font-extrabold text-ink">{activeSlide.title}</h2>
            </div>
            <div className="rounded-lg border border-brand/30 bg-brand-light/40 px-4 py-3 text-sm font-semibold leading-relaxed text-ink">
              💡 {activeSlide.summary}
            </div>
            <ul className="space-y-2 pl-5 list-disc text-sm text-ink-muted">
              {activeSlide.bullets.map((b, i) => (
                <li key={i} className="leading-relaxed">
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Right column: Live Radar of current workspace */}
          <div className="lg:col-span-4 rounded-xl border border-line bg-surface-muted/40 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between font-bold text-ink">
              <span>🛡️ Trạng thái Dàn Via thực tế của bạn</span>
              <Badge tone={stats.standby >= 2 ? 'positive' : 'caution'}>
                {stats.standby >= 2 ? 'Đạt chuẩn dự phòng' : 'Cần ≥ 2 Via dự phòng'}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Link
                to="/facebook-accounts"
                className="rounded-lg border border-line bg-surface p-2.5 hover:border-brand transition"
              >
                <div className="text-[11px] text-ink-muted">🛡️ Via Tổng</div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                  {stats.vault}
                </div>
                <div className="text-[10px] text-ink-faint">Giữ BM gốc</div>
              </Link>
              <Link
                to="/facebook-accounts"
                className="rounded-lg border border-line bg-surface p-2.5 hover:border-brand transition"
              >
                <div className="text-[11px] text-ink-muted">🚀 Lên Camp</div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-brand-text">
                  {stats.camp}
                </div>
                <div className="text-[10px] text-ink-faint">Chạy Ads khách</div>
              </Link>
              <Link
                to="/facebook-accounts"
                className="rounded-lg border border-line bg-surface p-2.5 hover:border-brand transition"
              >
                <div className="text-[11px] text-ink-muted">🌱 Dự Phòng</div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-amber-600 dark:text-amber-400">
                  {stats.standby}
                </div>
                <div className="text-[10px] text-ink-faint">Ngâm sẵn &gt; 7N</div>
              </Link>
            </div>

            <div className="border-t border-line pt-2.5 space-y-1.5">
              <div className="font-semibold text-ink">
                🌐 Chỗ mua & Quản lý Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a
                  href="https://proxyvn.vn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-line bg-surface px-2 py-1 font-semibold text-brand-text hover:border-brand hover:underline"
                >
                  🛒 ProxyVN.vn ↗
                </a>
                <a
                  href="https://zingproxy.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-line bg-surface px-2 py-1 font-semibold text-brand-text hover:border-brand hover:underline"
                >
                  🛒 ZingProxy.com ↗
                </a>
                <a
                  href="https://muaproxy.vn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-line bg-surface px-2 py-1 font-semibold text-brand-text hover:border-brand hover:underline"
                >
                  🛒 MuaProxy.vn ↗
                </a>
                <a
                  href="https://vproxy.vn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-line bg-surface px-2 py-1 font-semibold text-brand-text hover:border-brand hover:underline"
                >
                  🛒 VProxy.vn ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4 QUOTA PILLARS + XMDN CHECKLIST */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-brand-text" />
              <span>Bảng 4 Hạn Mức An Toàn Meta (Chống Chết Liên Đới)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">1. Hạn mức 1 Tài khoản Facebook (Via) → Business Manager</div>
              <div className="text-ink-muted leading-relaxed">
                • Mỗi Via cá nhân chỉ tự khởi tạo được <strong>tối đa 2 BM gốc</strong> (Via cổ tối đa 4 BM).<br />
                • Tuy nhiên, 1 Via Tổng có thể <strong>nhận quyền Quản trị / Partner không giới hạn số lượng BM</strong> do các Via khác share sang.
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">2. Hạn mức 1 Business Manager → Tài khoản quảng cáo (TKQC)</div>
              <div className="text-ink-muted leading-relaxed">
                • <strong>Chưa XMDN</strong>: Mới tạo chỉ được <strong>1 TKQC (BM1)</strong> → Sau khi cắn bill đầu tiên lên <strong>3–5 TKQC (BM5)</strong> (Trần tối đa khi chưa xác minh là 5 TKQC).<br />
                • <strong>Đã XMDN (Xác minh doanh nghiệp)</strong>: Mở khóa ngay <strong>10 TKQC (BM10)</strong> → Tiếp tục chi tiêu đều sẽ lên <strong>BM30, BM80, BM250+</strong>.
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">3. Hạn mức 1 Thẻ Visa / Mastercard → Tài khoản quảng cáo</div>
              <div className="text-ink-muted leading-relaxed">
                • <strong>Ngưỡng an toàn Agency</strong>: <strong>1 Thẻ chỉ gắn cho 1 – 3 TKQC</strong>.<br />
                • Dù Meta cho phép gắn tới 5–10 TKQC, nhưng nếu gắn quá 3 TKQC chung 1 thẻ thì khi 1 TKQC bị khóa phương thức thanh toán hoặc đỏ thẻ sẽ làm <strong>chết liên đới toàn bộ các TKQC dùng chung thẻ đó</strong>.
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">4. Hạn mức 1 Proxy IPv4 Dân cư tĩnh → Tài khoản Facebook (Via)</div>
              <div className="text-ink-muted leading-relaxed">
                • <strong>1 Proxy IPv4 Dân cư tĩnh VN = 1 đến tối đa 2 Via</strong> (cùng 1 cụm BM).<br />
                • Mạng Wifi văn phòng chỉ nuôi tối đa 2–3 Via chính.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-brand-text" />
              <span>Hồ sơ chuẩn để Xác Minh Doanh Nghiệp (XMDN lên BM10+)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">Nhóm 1: Giấy tờ pháp lý doanh nghiệp (Bản scan màu rõ 4 góc)</div>
              <div className="text-ink-muted leading-relaxed">
                • <strong>Giấy chứng nhận đăng ký doanh nghiệp (GPKD)</strong>: Thấy rõ Tên pháp nhân, Mã số thuế, Địa chỉ trụ sở, Người đại diện.<br />
                • <em>Khai báo trong Cài đặt BM phải khớp 100% từng dấu chấm, dấu phẩy với trên GPKD.</em>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">Nhóm 2: Giấy tờ xác minh Địa chỉ & Số điện thoại (Trùng GPKD)</div>
              <div className="text-ink-muted leading-relaxed">
                • <strong>Sao kê tài khoản ngân hàng của công ty</strong> (có tên công ty + địa chỉ trụ sở + mộc ngân hàng), hoặc<br />
                • <strong>Hóa đơn tiện ích đứng tên công ty</strong> (Hóa đơn điện, nước, cước Internet VNPT / Viettel / FPT).
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">Nhóm 3: Tên miền (Domain) & Chân trang Website (Footer)</div>
              <div className="text-ink-muted leading-relaxed">
                • Xác minh tên miền (Domain Verification) bằng bản ghi DNS TXT trong BM.<br />
                • Dưới chân trang (Footer) website <strong>bắt buộc hiển thị rõ</strong>: Tên công ty đầy đủ, Mã số thuế, Địa chỉ trụ sở và Số điện thoại trùng khớp 100% với GPKD.
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted/40 p-3 space-y-1">
              <div className="font-bold text-ink">Nhóm 4: Email theo tên miền & Bật bảo mật 2 lớp (2FA)</div>
              <div className="text-ink-muted leading-relaxed">
                • Dùng <strong>Email doanh nghiệp theo đuôi tên miền</strong> (VD: <code>admin@matbao.com</code>, không dùng <code>@gmail.com</code>) để nhận mã OTP 6 số duyệt XMDN ngay lập tức.<br />
                • Bật 2FA cho toàn bộ Quản trị viên trong BM trước khi bấm gửi duyệt.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
