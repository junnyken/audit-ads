import { useState } from 'react'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
  Layers,
  Lock,
  Puzzle,
  ShieldCheck,
  Terminal,
  UserRoundCog,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Field } from '../components/ui'
import { TooltipProvider } from '../components/primitives/tooltip'
import { BrandMark } from '../components/shell/BrandMark'
import { LanguageToggle } from '../components/shell/LanguageToggle'
import { ThemeToggle } from '../components/shell/ThemeToggle'
import { useI18n } from '../i18n'
import { ApiError } from '../lib/api'
import { downloadChromeExtensionZip } from '../lib/chromeProfileLauncher'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-canvas text-ink">
        {/* STICKY WEBSITE HEADER */}
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-8">
              <BrandMark />
              <nav aria-label="Điều hướng trang chủ" className="hidden md:flex items-center gap-6 text-xs font-semibold text-ink-muted">
                <a href="#tien-ich-chrome" className="hover:text-ink transition-colors">
                  Tiện ích Chrome (.zip)
                </a>
                <a href="#ung-dung-thuc-te" className="hover:text-ink transition-colors">
                  Công dụng & Vận hành
                </a>
                <a href="#han-muc-meta" className="hover:text-ink transition-colors">
                  4 Hạn mức an toàn Meta
                </a>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/adsops-chrome-extension.zip"
                download="AdsOps-Chrome-Extension-v2.1.zip"
                className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tải Tiện ích Chrome (.zip)</span>
              </a>
              <ThemeToggle />
              <LanguageToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* SECTION 1: HERO & LOGIN */}
          <section className="grid items-center gap-10 py-10 lg:grid-cols-12 lg:py-14 border-b border-line">
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-brand-text">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Hệ thống Quản trị Tài khoản Quảng cáo Meta & Tiện ích Google Chrome</span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.2]">
                Kiểm soát tập trung dàn 20+ BM, cách ly Hồ sơ Chrome và tự động bọc Proxy riêng cho từng Via
              </h1>

              <p className="text-sm sm:text-base leading-relaxed text-ink-muted">
                <strong>AdsOps Control Center</strong> giải quyết bài toán chết liên đới khi vận hành nhiều tài khoản quảng cáo: đồng bộ chi tiêu thực tế qua <strong>BM Trung tâm (Partner)</strong>, kết hợp với <strong>Tiện ích Google Chrome (AdsOps Companion .zip)</strong> để định danh từng Via, tự động nạp Proxy IPv4 và mở đúng trình duyệt kháng nghị/thanh toán chỉ với 1 thao tác.
              </p>

              {/* 3 KEY METRICS (TABULAR-NUMS) */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base sm:text-lg font-extrabold text-brand-text tabular-nums">
                    1 : 1 : 1
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-ink-muted">
                    1 Chrome · 1 Via · 1 Proxy
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base sm:text-lg font-extrabold text-ink tabular-nums">
                    ≤ 3 TKQC
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-ink-muted">
                    Ngưỡng an toàn / 1 Thẻ
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base sm:text-lg font-extrabold text-ink tabular-nums">
                    60 Ngày
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-ink-muted">
                    Đồng bộ Token Đa BM
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="/adsops-chrome-extension.zip"
                  download="AdsOps-Chrome-Extension-v2.1.zip"
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Tải Tiện ích Google Chrome (.zip)</span>
                </a>
                <a
                  href="#tien-ich-chrome"
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-muted transition-colors"
                >
                  <Puzzle className="h-4 w-4 text-brand-text" aria-hidden="true" />
                  <span>Xem giao diện & cách dùng Tiện ích</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* LOGIN CARD */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <form
                onSubmit={submit}
                className="w-full max-w-md rounded-xl border border-line bg-surface p-6 sm:p-7 shadow-md"
                aria-labelledby="login-title"
              >
                <div className="flex items-center justify-between border-b border-line pb-4 mb-5">
                  <div>
                    <BrandMark />
                    <p className="mt-1 text-xs text-ink-muted">{t('common.appTagline')}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Bảo mật nội bộ
                  </span>
                </div>

                <h2 id="login-title" className="mb-4 text-base font-bold text-ink">
                  Đăng nhập Bảng điều khiển Quản trị
                </h2>

                <div className="space-y-3.5">
                  <Field label={t('login.email')} required htmlFor="email">
                    <input
                      id="email"
                      className="input"
                      type="email"
                      autoComplete="username"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </Field>
                  <Field label={t('login.password')} required htmlFor="password">
                    <input
                      id="password"
                      className="input"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </Field>
                </div>

                {error && (
                  <p role="alert" className="tone-attention mt-3 rounded-md border px-3 py-2 text-sm">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary mt-5 w-full py-2.5 text-sm font-semibold" disabled={busy}>
                  {busy ? t('login.submitting') : t('login.submit')}
                </button>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-muted">
                  <span>Cần gói tiện ích cho trình duyệt Via?</span>
                  <button
                    type="button"
                    onClick={() => downloadChromeExtensionZip()}
                    className="font-semibold text-brand-text hover:underline"
                  >
                    Tải file .zip ngay →
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* SECTION 2: GIỚI THIỆU & TẢI TIỆN ÍCH GOOGLE CHROME (.ZIP) */}
          <section id="tien-ich-chrome" className="py-12 border-b border-line">
            <div className="grid items-start gap-8 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-7">
                <div className="inline-flex items-center gap-2 rounded-md bg-brand-light px-2.5 py-1 text-xs font-bold text-brand-text">
                  <Puzzle className="h-4 w-4" aria-hidden="true" />
                  <span>Tiện ích Google Chrome chính thức · Chuẩn Manifest V3 (.zip)</span>
                </div>

                <h2 className="text-xl sm:text-2xl font-extrabold text-ink">
                  Tiện ích «AdsOps Companion» trên Google Chrome dùng để làm gì?
                </h2>

                <p className="text-sm text-ink-muted leading-relaxed">
                  Khi bạn nuôi nhiều tài khoản Facebook (Via) trên nhiều Hồ sơ Chrome khác nhau, việc mở nhầm trình duyệt hoặc quên bật Proxy rất dễ khiến Meta quét trùng IP và khoá liên đới cả dàn BM. Tiện ích <strong>AdsOps Companion (file chuẩn <code>.zip</code>)</strong> gắn trực tiếp lên góc phải mỗi Hồ sơ Chrome để giải quyết 4 việc:
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <UserRoundCog className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>1. Hộ chiếu định danh Via & Profile</span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      Hiển thị rõ trên thanh công cụ Chrome bạn đang ở <strong>Via nào</strong> (VD: <em>Via Dự Phòng BM1</em>) và <strong>Thư mục Chrome nào</strong> (<code>Profile 10</code>), chống thao tác nhầm tài khoản.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>2. Bọc Proxy & Tự điền User/Pass</span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      Nhập trực tiếp <code>IP:Port:User:Pass</code> ngay trong tiện ích để định tuyến riêng cho Profile Chrome đó, tự động điền mật khẩu ngầm và kiểm tra IP thật.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Terminal className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>3. Tự động bắt ID BM & ID TKQC</span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      Khi mở tab <em>Ads Manager</em> hoặc <em>BM Settings</em> trên Facebook, tiện ích tự tách mã <code>act_id</code> và <code>business_id</code> để bạn sao chép hoặc đồng bộ 1 chạm.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <ShieldCheck className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>4. Lối tắt Kháng nghị & Thanh toán</span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      Tích hợp sẵn các nút mở thẳng trang <strong>Chất lượng tài khoản (Kháng nghị)</strong>, <strong>Thanh toán dư nợ (Billing)</strong> và <strong>Cài đặt BM</strong> ngay trên trình duyệt.
                    </p>
                  </div>
                </div>

                {/* HƯỚNG DẪN CÀI FILE .ZIP VÀO CHROME */}
                <div className="rounded-lg border border-line bg-surface p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-ink">
                      Hướng dẫn 4 bước cài gói <code>AdsOps-Chrome-Extension.zip</code> vào Google Chrome:
                    </div>
                    <a
                      href="/adsops-chrome-extension.zip"
                      download="AdsOps-Chrome-Extension-v2.1.zip"
                      className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Tải gói chuẩn .zip (v2.1)</span>
                    </a>
                  </div>
                  <ol className="grid gap-2 sm:grid-cols-2 text-xs text-ink-muted list-decimal pl-4">
                    <li>
                      Tải file <strong><code>AdsOps-Chrome-Extension-v2.1.zip</code></strong> và giải nén ra một thư mục cố định trên máy.
                    </li>
                    <li>
                      Mở Hồ sơ Google Chrome của Via, nhập vào thanh địa chỉ: <strong><code>chrome://extensions</code></strong>.
                    </li>
                    <li>
                      Bật công tắc <strong>Chế độ dành cho nhà phát triển</strong> (<em>Developer mode</em>) ở góc trên bên phải.
                    </li>
                    <li>
                      Bấm <strong>Tải tiện ích đã giải nén</strong> (<em>Load unpacked</em>) → chọn thư mục vừa giải nén và bấm Ghim lên thanh công cụ.
                    </li>
                  </ol>
                </div>
              </div>

              {/* CỘT PHẢI: KHUNG MÔ PHỎNG TRỰC QUAN TIỆN ÍCH CHROME (CLEAN UI, NO EMOJI CLUTTER) */}
              <div className="lg:col-span-5">
                <div className="mx-auto max-w-[370px] rounded-xl border border-line bg-surface p-4 shadow-md">
                  <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-surface-muted px-3 py-1.5 text-xs">
                    <span className="font-mono text-ink-muted truncate">business.facebook.com/accountquality</span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-brand-text">
                      <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] text-white">PRX</span>
                    </span>
                  </div>

                  {/* Extension Popup Frame */}
                  <div className="rounded-lg border border-line bg-canvas p-3.5 space-y-3">
                    <div className="flex items-center justify-between border-b border-line pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[11px] font-extrabold text-brand-fg">
                          AO
                        </span>
                        <span className="text-xs font-extrabold text-ink">AdsOps Hộ Chiếu Via</span>
                      </div>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                        ĐANG BỌC PROXY
                      </span>
                    </div>

                    <div className="rounded-md border border-brand/30 bg-brand-light/50 p-2.5 text-xs">
                      <div className="font-semibold text-brand-text">Phát hiện ID Meta trên tab hiện tại:</div>
                      <div className="mt-0.5 font-mono text-[11px] text-ink">BM ID: 102968402561310 · TKQC: 4166221836835661</div>
                    </div>

                    <div className="rounded-md border border-line bg-surface p-2.5 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                        1. Định danh Via & Hồ sơ Chrome
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        <div className="col-span-2 rounded border border-line bg-surface-muted px-2 py-1.5 font-semibold text-ink truncate">
                          Via Dự Phòng Cụm BM #1
                        </div>
                        <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-xs font-semibold text-ink">
                          Profile 10
                        </div>
                      </div>

                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted pt-1">
                        2. Cấu hình Proxy riêng (IP:Port:User:Pass)
                      </div>
                      <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-ink truncate">
                        103.145.67.89:8080:viettel_isp:••••••
                      </div>

                      <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[11px]">
                        <span className="text-ink-muted">IP Public thực tế:</span>
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          103.145.67.89 (VNPT/Viettel)
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                        3. Lối tắt xử lý nhanh trên đúng Via này
                      </div>
                      <div className="flex items-center justify-between rounded border border-danger-line bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger-text">
                        <span>Chất lượng tài khoản & Kháng nghị Meta</span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                      <div className="flex items-center justify-between rounded border border-brand/30 bg-brand-light px-2.5 py-1.5 text-xs font-semibold text-brand-text">
                        <span>Thanh toán & Xử lý dư nợ (Billing)</span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                      <div className="flex items-center justify-between rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink">
                        <span>Cài đặt Business Manager (BM Settings)</span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3: 4 TRỤ CỘT ỨNG DỤNG THỰC TẾ & 4 HẠN MỨC AN TOÀN META */}
          <section id="ung-dung-thuc-te" className="py-12 border-b border-line space-y-8">
            <div className="max-w-3xl space-y-2">
              <h2 className="text-xl sm:text-2xl font-extrabold text-ink">
                Quy trình vận hành khép kín từ A–Z & 4 Hạn mức an toàn Meta
              </h2>
              <p className="text-sm text-ink-muted">
                Thiết kế chuẩn mực dành cho đội ngũ vận hành nhiều BM: tách biệt rõ quyền quản trị, môi trường trình duyệt và hạn mức thẻ thanh toán.
              </p>
            </div>

            <div id="han-muc-meta" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  1. Hạn mức Via → BM
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  Tối đa 1–2 BM gốc / Via
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Mỗi Via chỉ tự tạo được 2 BM (Via cổ 4 BM). Để an toàn, mỗi cụm BM dùng <strong>1 Via gốc + 1 Via dự phòng</strong> (nằm im kháng nghị/bill) và share quyền <strong>Partner</strong> về BM Tổng.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  2. Hạn mức BM → TKQC
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  BM1 → BM5 → BM10+ (XMDN)
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  BM mới tạo được 1 TKQC; sau bill đầu tiên tăng lên 3–5 TKQC; khi <strong>Xác minh doanh nghiệp (XMDN)</strong> sẽ mở hạn mức <strong>10 → 30 → 250+ TKQC</strong>.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  3. Hạn mức 1 Thẻ → TKQC
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  An toàn 1–3 TKQC / Thẻ
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Trần kỹ thuật Meta cho phép 9–10 TKQC/thẻ, nhưng thực chiến chỉ gắn <strong>tối đa 1–3 TKQC / 1 thẻ</strong> để tránh chết liên đới (bão thẻ) khi 1 TKQC bị khoá.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  4. Hạn mức 1 Proxy → Via
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  1–2 Via / 1 Proxy IPv4
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Sử dụng <strong>Proxy IPv4 Dân cư tĩnh VN (Viettel/VNPT/FPT)</strong>. Mỗi Proxy chỉ nuôi <strong>1–2 Via</strong> cùng cụm BM; mạng Wifi gốc chỉ dùng tối đa 2–3 Via đầu.
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-line bg-surface py-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 text-xs text-ink-muted">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-brand-text" aria-hidden="true" />
              <span>AdsOps Control Center · Hệ thống Quản trị Tài khoản Quảng cáo & Tiện ích Chrome v2.1</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="/adsops-chrome-extension.zip" download="AdsOps-Chrome-Extension-v2.1.zip" className="font-semibold text-brand-text hover:underline">
                Tải Tiện ích Chrome (.zip)
              </a>
              <span>Chuẩn Manifest V3</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
