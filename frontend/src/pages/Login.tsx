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
  const { t, language } = useI18n()
  const isEn = language === 'en'
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
              <nav
                aria-label={isEn ? 'Home navigation' : 'Điều hướng trang chủ'}
                className="hidden md:flex items-center gap-6 text-xs font-semibold text-ink-muted"
              >
                <a href="#tien-ich-chrome" className="hover:text-ink transition-colors">
                  {isEn ? 'Chrome Extension (.zip)' : 'Tiện ích Chrome (.zip)'}
                </a>
                <a href="#ung-dung-thuc-te" className="hover:text-ink transition-colors">
                  {isEn ? 'Features & Workflow' : 'Công dụng & Vận hành'}
                </a>
                <a href="#han-muc-meta" className="hover:text-ink transition-colors">
                  {isEn ? '4 Meta Safe Limits' : '4 Hạn mức an toàn Meta'}
                </a>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadChromeExtensionZip()}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isEn ? 'Download Extension (.zip)' : 'Tải Tiện ích Chrome (.zip)'}</span>
              </button>
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
                <span>
                  {isEn
                    ? 'Meta Ad Account Governance & Google Chrome Extension Suite'
                    : 'Hệ thống Quản trị Tài khoản Quảng cáo Meta & Tiện ích Google Chrome'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.2]">
                {isEn
                  ? 'Centralize 20+ Business Managers, isolate Chrome Profiles, and auto-route dedicated Proxies per Via'
                  : 'Kiểm soát tập trung dàn 20+ BM, cách ly Hồ sơ Chrome và tự động bọc Proxy riêng cho từng Via'}
              </h1>

              <p className="text-sm sm:text-base leading-relaxed text-ink-muted">
                {isEn ? (
                  <>
                    <strong>AdsOps Control Center</strong> eliminates chain-ban risks across multi-account operations: sync live spend via <strong>Partner Business Managers</strong>, and pair with the <strong>Google Chrome Extension (AdsOps Companion .zip)</strong> to identify each Via, block Passkey prompts, auto-fill 2FA, route IPv4 Proxies, and launch the exact appeal/billing browser in 1 click.
                  </>
                ) : (
                  <>
                    <strong>AdsOps Control Center</strong> giải quyết bài toán chết liên đới khi vận hành nhiều tài khoản quảng cáo: đồng bộ chi tiêu thực tế qua <strong>BM Trung tâm (Partner)</strong>, kết hợp với <strong>Tiện ích Google Chrome (AdsOps Companion .zip)</strong> để định danh từng Via, tự động nạp Proxy IPv4 và mở đúng trình duyệt kháng nghị/thanh toán chỉ với 1 thao tác.
                  </>
                )}
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
                    {isEn ? '≤ 3 Ad Accts' : '≤ 3 TKQC'}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-ink-muted">
                    {isEn ? 'Safe Limit / 1 Card' : 'Ngưỡng an toàn / 1 Thẻ'}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base sm:text-lg font-extrabold text-ink tabular-nums">
                    {isEn ? '60 Days' : '60 Ngày'}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-ink-muted">
                    {isEn ? 'Multi-BM Token Sync' : 'Đồng bộ Token Đa BM'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => downloadChromeExtensionZip()}
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {isEn
                      ? 'Download Google Chrome Extension (.zip)'
                      : 'Tải Tiện ích Google Chrome (.zip)'}
                  </span>
                </button>
                <a
                  href="#tien-ich-chrome"
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-muted transition-colors"
                >
                  <Puzzle className="h-4 w-4 text-brand-text" aria-hidden="true" />
                  <span>
                    {isEn
                      ? 'Preview Extension UI & Setup Guide'
                      : 'Xem giao diện & cách dùng Tiện ích'}
                  </span>
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
                    {isEn ? 'Internal Security' : 'Bảo mật nội bộ'}
                  </span>
                </div>

                <h2 id="login-title" className="mb-4 text-base font-bold text-ink">
                  {isEn ? 'Sign in to Admin Control Center' : 'Đăng nhập Bảng điều khiển Quản trị'}
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
                  <span>
                    {isEn
                      ? 'Need the browser extension for your Vias?'
                      : 'Cần gói tiện ích cho trình duyệt Via?'}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadChromeExtensionZip()}
                    className="font-semibold text-brand-text hover:underline"
                  >
                    {isEn ? 'Download .zip now →' : 'Tải file .zip ngay →'}
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
                  <span>
                    {isEn
                      ? 'Official Google Chrome Extension · Manifest V3 (.zip)'
                      : 'Tiện ích Google Chrome chính thức · Chuẩn Manifest V3 (.zip)'}
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-extrabold text-ink">
                  {isEn
                    ? 'What does the «AdsOps Companion» Chrome Extension do?'
                    : 'Tiện ích «AdsOps Companion» trên Google Chrome dùng để làm gì?'}
                </h2>

                <p className="text-sm text-ink-muted leading-relaxed">
                  {isEn ? (
                    <>
                      When managing multiple Facebook accounts (Vias) across separate Chrome Profiles, opening the wrong profile or forgetting to enable a Proxy can trigger Meta IP correlation and chain-ban your entire BM cluster. The <strong>AdsOps Companion (<code>.zip</code>)</strong> pins directly to each Chrome Profile toolbar to solve 4 core tasks:
                    </>
                  ) : (
                    <>
                      Khi bạn nuôi nhiều tài khoản Facebook (Via) trên nhiều Hồ sơ Chrome khác nhau, việc mở nhầm trình duyệt hoặc quên bật Proxy rất dễ khiến Meta quét trùng IP và khoá liên đới cả dàn BM. Tiện ích <strong>AdsOps Companion (file chuẩn <code>.zip</code>)</strong> gắn trực tiếp lên góc phải mỗi Hồ sơ Chrome để giải quyết 4 việc:
                    </>
                  )}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <UserRoundCog className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn
                          ? '1. Via Identity Passport & Anti-Passkey'
                          : '1. Hộ chiếu định danh Via & Profile'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      {isEn ? (
                        <>
                          Clearly displays <strong>which Via</strong> (e.g. <em>BM1 Backup Via</em>) and <strong>Chrome Folder</strong> (<code>Profile 10</code>) you are in, blocks Windows Hello Passkey popups, and auto-fills 6-digit 2FA codes.
                        </>
                      ) : (
                        <>
                          Hiển thị rõ trên thanh công cụ Chrome bạn đang ở <strong>Via nào</strong> (VD: <em>Via Dự Phòng BM1</em>) và <strong>Thư mục Chrome nào</strong> (<code>Profile 10</code>), chống thao tác nhầm tài khoản.
                        </>
                      )}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn
                          ? '2. Proxy Routing & Auto Auth + WebRTC Shield'
                          : '2. Bọc Proxy & Tự điền User/Pass'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      {isEn ? (
                        <>
                          Enter <code>IP:Port:User:Pass</code> directly in the extension to route traffic for that specific Chrome Profile, silently authenticate, block WebRTC leaks, and verify live Public IP.
                        </>
                      ) : (
                        <>
                          Nhập trực tiếp <code>IP:Port:User:Pass</code> ngay trong tiện ích để định tuyến riêng cho Profile Chrome đó, tự động điền mật khẩu ngầm và kiểm tra IP thật.
                        </>
                      )}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Terminal className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn
                          ? '3. Auto-Detect BM ID, Ad Account ID & Token'
                          : '3. Tự động bắt ID BM & ID TKQC'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      {isEn ? (
                        <>
                          Whenever you open <em>Ads Manager</em> or <em>BM Settings</em> on Facebook, the extension automatically extracts <code>act_id</code>, <code>business_id</code>, Cookies, and <code>EAAB</code> Tokens in 1 click.
                        </>
                      ) : (
                        <>
                          Khi mở tab <em>Ads Manager</em> hoặc <em>BM Settings</em> trên Facebook, tiện ích tự tách mã <code>act_id</code> và <code>business_id</code> để bạn sao chép hoặc đồng bộ 1 chạm.
                        </>
                      )}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <ShieldCheck className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn
                          ? '4. 1-Click Appeal, Billing & Passkey Removal'
                          : '4. Lối tắt Kháng nghị & Thanh toán'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      {isEn ? (
                        <>
                          Built-in shortcuts to open <strong>Account Quality (Appeals)</strong>, <strong>Billing & Balances</strong>, <strong>BM Settings</strong>, and <strong>1-Click Auto-Delete Passkey</strong> right inside the browser.
                        </>
                      ) : (
                        <>
                          Tích hợp sẵn các nút mở thẳng trang <strong>Chất lượng tài khoản (Kháng nghị)</strong>, <strong>Thanh toán dư nợ (Billing)</strong> và <strong>Cài đặt BM</strong> ngay trên trình duyệt.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* HƯỚNG DẪN CÀI FILE .ZIP VÀO CHROME */}
                <div className="rounded-lg border border-line bg-surface p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-ink">
                      {isEn ? (
                        <>
                          4 Steps to install <code>AdsOps-Chrome-Extension.zip</code> in Google Chrome:
                        </>
                      ) : (
                        <>
                          Hướng dẫn 4 bước cài gói <code>AdsOps-Chrome-Extension.zip</code> vào Google Chrome:
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadChromeExtensionZip()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {isEn ? 'Download .zip Package (v2.4 Pro)' : 'Tải gói chuẩn .zip (v2.4 Pro)'}
                      </span>
                    </button>
                  </div>
                  <ol className="grid gap-2 sm:grid-cols-2 text-xs text-ink-muted list-decimal pl-4">
                    <li>
                      {isEn ? (
                        <>
                          Download <strong><code>AdsOps-Chrome-Extension-v2.4.zip</code></strong> and extract it to a permanent folder on your computer.
                        </>
                      ) : (
                        <>
                          Tải file <strong><code>AdsOps-Chrome-Extension-v2.4.zip</code></strong> và giải nén ra một thư mục cố định trên máy.
                        </>
                      )}
                    </li>
                    <li>
                      {isEn ? (
                        <>
                          Open your Via&apos;s Google Chrome profile and navigate to: <strong><code>chrome://extensions</code></strong>.
                        </>
                      ) : (
                        <>
                          Mở Hồ sơ Google Chrome của Via, nhập vào thanh địa chỉ: <strong><code>chrome://extensions</code></strong>.
                        </>
                      )}
                    </li>
                    <li>
                      {isEn ? (
                        <>
                          Enable the <strong>Developer mode</strong> toggle in the top-right corner.
                        </>
                      ) : (
                        <>
                          Bật công tắc <strong>Chế độ dành cho nhà phát triển</strong> (<em>Developer mode</em>) ở góc trên bên phải.
                        </>
                      )}
                    </li>
                    <li>
                      {isEn ? (
                        <>
                          Click <strong>Load unpacked</strong> → select the extracted folder and pin the extension to your toolbar.
                        </>
                      ) : (
                        <>
                          Bấm <strong>Tải tiện ích đã giải nén</strong> (<em>Load unpacked</em>) → chọn thư mục vừa giải nén và bấm Ghim lên thanh công cụ.
                        </>
                      )}
                    </li>
                  </ol>
                </div>
              </div>

              {/* CỘT PHẢI: KHUNG MÔ PHỎNG TRỰC QUAN TIỆN ÍCH CHROME */}
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
                        <span className="text-xs font-extrabold text-ink">
                          {isEn ? 'AdsOps Via Passport' : 'AdsOps Hộ Chiếu Via'}
                        </span>
                      </div>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                        {isEn ? 'PROXY ACTIVE' : 'ĐANG BỌC PROXY'}
                      </span>
                    </div>

                    <div className="rounded-md border border-brand/30 bg-brand-light/50 p-2.5 text-xs">
                      <div className="font-semibold text-brand-text">
                        {isEn ? 'Meta IDs detected on active tab:' : 'Phát hiện ID Meta trên tab hiện tại:'}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-ink">
                        {isEn
                          ? 'Auto-reads act_id & business_id from open tab'
                          : 'Tự động đọc act_id & business_id từ tab đang mở'}
                      </div>
                    </div>

                    <div className="rounded-md border border-line bg-surface p-2.5 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                        {isEn ? '1. Via Identity & Chrome Profile' : '1. Định danh Via & Hồ sơ Chrome'}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        <div className="col-span-2 rounded border border-line bg-surface-muted px-2 py-1.5 font-semibold text-ink truncate">
                          {isEn ? 'Backup Via · BM Cluster #1' : 'Via Dự Phòng Cụm BM #1'}
                        </div>
                        <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-xs font-semibold text-ink">
                          Profile 10
                        </div>
                      </div>

                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted pt-1">
                        {isEn
                          ? '2. Dedicated Proxy (IP:Port:User:Pass)'
                          : '2. Cấu hình Proxy riêng (IP:Port:User:Pass)'}
                      </div>
                      <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-ink truncate">
                        {isEn
                          ? 'IP:Port:User:Pass (Silent background auth)'
                          : 'IP:Port:User:Pass (Tự động điền xác thực ngầm)'}
                      </div>

                      <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[11px]">
                        <span className="text-ink-muted">
                          {isEn ? 'Live Public IP:' : 'IP Public thực tế:'}
                        </span>
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {isEn ? 'Auto-verifies live Public IP' : 'Tự động kiểm tra IP Public thực tế'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                        {isEn
                          ? '3. Quick Actions on this Via Profile'
                          : '3. Lối tắt xử lý nhanh trên đúng Via này'}
                      </div>
                      <div className="flex items-center justify-between rounded border border-danger-line bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger-text">
                        <span>
                          {isEn
                            ? 'Account Quality & Meta Appeals'
                            : 'Chất lượng tài khoản & Kháng nghị Meta'}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                      <div className="flex items-center justify-between rounded border border-brand/30 bg-brand-light px-2.5 py-1.5 text-xs font-semibold text-brand-text">
                        <span>
                          {isEn
                            ? 'Billing & Balance Settlement'
                            : 'Thanh toán & Xử lý dư nợ (Billing)'}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                      <div className="flex items-center justify-between rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink">
                        <span>
                          {isEn
                            ? 'Business Manager Settings (BM)'
                            : 'Cài đặt Business Manager (BM Settings)'}
                        </span>
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
                {isEn
                  ? 'End-to-End Agency Workflow & 4 Meta Safe Limits'
                  : 'Quy trình vận hành khép kín từ A–Z & 4 Hạn mức an toàn Meta'}
              </h2>
              <p className="text-sm text-ink-muted">
                {isEn
                  ? 'Engineered for multi-BM media buying teams: strictly separate admin ownership, isolated browser environments, and payment card risk limits.'
                  : 'Thiết kế chuẩn mực dành cho đội ngũ vận hành nhiều BM: tách biệt rõ quyền quản trị, môi trường trình duyệt và hạn mức thẻ thanh toán.'}
              </p>
            </div>

            <div id="han-muc-meta" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '1. Via → BM Limit' : '1. Hạn mức Via → BM'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? 'Max 1–2 Root BMs / Via' : 'Tối đa 1–2 BM gốc / Via'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn ? (
                    <>
                      Each Via can create up to 2 BMs (aged Vias up to 4). For safety, assign <strong>1 Root Via + 1 Standby Via</strong> per BM cluster and share <strong>Partner</strong> access to your Master BM.
                    </>
                  ) : (
                    <>
                      Mỗi Via chỉ tự tạo được 2 BM (Via cổ 4 BM). Để an toàn, mỗi cụm BM dùng <strong>1 Via gốc + 1 Via dự phòng</strong> (nằm im kháng nghị/bill) và share quyền <strong>Partner</strong> về BM Tổng.
                    </>
                  )}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '2. BM → Ad Account Limit' : '2. Hạn mức BM → TKQC'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? 'BM1 → BM5 → BM10+ (Verified)' : 'BM1 → BM5 → BM10+ (XMDN)'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn ? (
                    <>
                      New BMs start with 1 Ad Account; after the first paid bill they unlock 3–5; completing <strong>Business Verification</strong> unlocks <strong>10 → 30 → 250+ Ad Accounts</strong>.
                    </>
                  ) : (
                    <>
                      BM mới tạo được 1 TKQC; sau bill đầu tiên tăng lên 3–5 TKQC; khi <strong>Xác minh doanh nghiệp (XMDN)</strong> sẽ mở hạn mức <strong>10 → 30 → 250+ TKQC</strong>.
                    </>
                  )}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '3. 1 Card → Ad Accounts' : '3. Hạn mức 1 Thẻ → TKQC'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? 'Safe: 1–3 Ad Accts / Card' : 'An toàn 1–3 TKQC / Thẻ'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn ? (
                    <>
                      While Meta technically allows 9–10 accounts per card, link at most <strong>1–3 Ad Accounts per card</strong> in production to prevent chain payment bans when one account is flagged.
                    </>
                  ) : (
                    <>
                      Trần kỹ thuật Meta cho phép 9–10 TKQC/thẻ, nhưng thực chiến chỉ gắn <strong>tối đa 1–3 TKQC / 1 thẻ</strong> để tránh chết liên đới (bão thẻ) khi 1 TKQC bị khoá.
                    </>
                  )}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '4. 1 Proxy → Vias' : '4. Hạn mức 1 Proxy → Via'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? '1–2 Vias / 1 Static IPv4' : '1–2 Via / 1 Proxy IPv4'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn ? (
                    <>
                      Use <strong>Static Residential IPv4 Proxies (VN)</strong>. Assign at most <strong>1–2 Vias</strong> from the same BM cluster per Proxy; keep local office Wi-Fi limited to 2–3 primary Vias.
                    </>
                  ) : (
                    <>
                      Sử dụng <strong>Proxy IPv4 Dân cư tĩnh VN (Viettel/VNPT/FPT)</strong>. Mỗi Proxy chỉ nuôi <strong>1–2 Via</strong> cùng cụm BM; mạng Wifi gốc chỉ dùng tối đa 2–3 Via đầu.
                    </>
                  )}
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-line bg-surface py-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 text-xs text-ink-muted">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-brand-text" aria-hidden="true" />
              <span>
                {isEn
                  ? 'AdsOps Control Center · Meta Ad Account Governance & Chrome Extension v2.4 Pro'
                  : 'AdsOps Control Center · Hệ thống Quản trị Tài khoản Quảng cáo & Tiện ích Chrome v2.4 Pro'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => downloadChromeExtensionZip()}
                className="font-semibold text-brand-text hover:underline"
              >
                {isEn ? 'Download Chrome Extension (.zip)' : 'Tải Tiện ích Chrome (.zip)'}
              </button>
              <span>{isEn ? 'Manifest V3 Standard' : 'Chuẩn Manifest V3'}</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
