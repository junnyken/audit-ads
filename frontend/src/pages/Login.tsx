import { useState } from 'react'
import {
  ArrowRight,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Flag,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Puzzle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TrendingUp,
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
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const currentHost =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'adsops-app.vibe.tinhgon.xyz'

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

  const eightModules = [
    {
      icon: Building2,
      tag: isEn ? 'Module 01 · Multi-BM' : 'Phân hệ 01 · Đa BM',
      title: isEn
        ? 'Central BM & Partner Ad Account Registry (100–500+ Accounts)'
        : 'Quản trị Đa BM Trung tâm & 100–500+ Tài khoản Quảng cáo (TKQC)',
      desc: isEn
        ? 'Separate Tier-1 Asset Vault BMs from Partner Media-Buying BMs. Sync live spend (Today, 7-Day, MTD, Lifetime), balances, and account health across hundreds of VND & USD accounts in one click.'
        : 'Phân tách chuẩn mực giữa BM Trung tâm giữ tài sản gốc (Tier-1) và BM Chạy Ads (Partner). Đồng bộ chi tiêu thực tế (Hôm nay, 7 ngày, Tháng MTD, Lũy kế), dư nợ và sức khỏe của hàng trăm TKQC tiền VND & USD chỉ với 1 cú nhấp.',
    },
    {
      icon: Calculator,
      tag: isEn ? 'Module 02 · Agency Billing' : 'Phân hệ 02 · Quyết toán KH',
      title: isEn
        ? 'Client Retainer, Budget Pacing & Monthly Settlement Center'
        : 'Theo dõi Ngân sách Cam kết (Pacing) & Bảng Quyết Toán Cuối Tháng',
      desc: isEn
        ? 'Group multiple Ad Accounts into one Client Contract. Automatically convert USD to VND, track monthly budget pacing, add Agency Management Fee (5%–15%) + Meta Tax (5%–10%), and export PDF/Excel/Zalo statements.'
        : 'Gom nhiều TKQC vào 1 Hợp đồng Khách hàng. Tự động quy đổi USD sang VNĐ, đo tiến độ cắn ngân sách cam kết, cộng Phí quản lý Agency (5%–15%) + Thuế nhà thầu Meta (5%–10%) và xuất Phiếu quyết toán PDF/Excel/Zalo gửi khách.',
    },
    {
      icon: Flag,
      tag: isEn ? 'Module 03 · Fanpage Vault' : 'Phân hệ 03 · Quản trị Fanpage',
      title: isEn
        ? 'Fanpage Control Center & Reverse-Ban Protection'
        : 'Trung tâm Quản trị Fanpage & Chống Khóa Ngược từ TKQC',
      desc: isEn
        ? 'Monitor published status, Admin vs Advertiser roles, follower counts, and enforce the ≤ 3 Active Ad Accounts per Page rule. Unlink restricted accounts immediately to keep your Pages alive.'
        : 'Giám sát trạng thái Live/Hạn chế quảng cáo, quyền Admin vs Advertiser và cưỡng chế quy tắc 1 Fanpage ≤ 3 TKQC. Cảnh báo gỡ ngay các TKQC bị vô hiệu hóa để bảo vệ Fanpage gốc không bị khóa liên đới.',
    },
    {
      icon: KeyRound,
      tag: isEn ? 'Module 04 · 3-Tier Vias & 2FA' : 'Phân hệ 04 · Via & OTP 2FA',
      title: isEn
        ? '3-Tier Facebook Via Governance, Live 2FA OTP & Passkey Cleaner'
        : 'Quản lý Dàn Via 3 Tầng, Lấy Mã OTP 2FA Trực tiếp & Quét Xóa Passkey',
      desc: isEn
        ? 'Classify Vias into Tier-1 (BM Holder), Tier-2 (Media Buyer), and Tier-3 (Standby). Generate 6-digit TOTP codes in browser, track 72h warm-up timers, and remove Windows Hello/Passkey prompts.'
        : 'Phân tầng rõ rệt Via Giữ BM Gốc (Tier-1), Via Lên Camp (Tier-2) và Via Dự Phòng (Tier-3). Lấy mã OTP 2FA 6 số trực tiếp trên bảng điều khiển, đếm ngược ngâm Via 72h và quét xóa Passkey chống Checkpoint.',
    },
    {
      icon: CreditCard,
      tag: isEn ? 'Module 05 · Payment Safety' : 'Phân hệ 05 · Thẻ Thanh toán',
      title: isEn
        ? 'Visa/Mastercard Isolation Matrix (≤ 3 Ad Accounts / Card)'
        : 'Ma trận Cách ly Thẻ Thanh toán Visa/Mastercard (≤ 3 TKQC / Thẻ)',
      desc: isEn
        ? 'Audit every card last-4 digits across your BMs, monitor unpaid balances against billing thresholds, and prevent chain payment flags by keeping each card under 3 active Ad Accounts.'
        : 'Kiểm toán từng đầu thẻ Visa/Mastercard trên toàn bộ dàn BM, theo dõi tổng dư nợ chờ thanh toán và ngăn chặn bão khóa thẻ (Payment Flag) bằng ngưỡng an toàn tối đa 3 TKQC trên 1 thẻ.',
    },
    {
      icon: RefreshCw,
      tag: isEn ? 'Module 06 · Pixel & Dataset' : 'Phân hệ 06 · Pixel & Dataset',
      title: isEn
        ? 'Central Dataset / Pixel Vault & Partner Sharing'
        : 'Kho Lưu trữ Pixel / Dataset Trung tâm & Chia sẻ Partner',
      desc: isEn
        ? 'Hold Pixels inside your Tier-1 Central BM and share Partner access to media-buying Ad Accounts so conversion history and AI learning phase survive even when an Ad Account is replaced.'
        : 'Giữ Pixel/Dataset trong BM Trung tâm và cấp quyền Partner sang các TKQC chạy chiến dịch, giúp bảo toàn 100% dữ liệu chuyển đổi và tệp đối tượng học máy ngay cả khi phải thay TKQC mới.',
    },
    {
      icon: Puzzle,
      tag: isEn ? 'Module 07 · Chrome Extension' : 'Phân hệ 07 · Tiện ích Chrome',
      title: isEn
        ? 'AdsOps Companion Chrome Extension (.zip) & Static IPv4 Proxy'
        : 'Tiện ích Chrome AdsOps Companion (.zip) & Bọc Proxy IPv4 Tĩnh',
      desc: isEn
        ? 'Manifest V3 Chrome Extension that displays a Via Passport badge on every browser window, auto-authenticates HTTP/SOCKS5 proxies (IP:Port:User:Pass), and blocks WebRTC local IP leaks.'
        : 'Tiện ích chuẩn Manifest V3 gắn hộ chiếu định danh Via lên góc Chrome, tự động nạp Proxy IPv4 tĩnh kèm điền sẵn User/Pass và chặn rò rỉ WebRTC để mỗi Hồ sơ Chrome là một thiết bị độc lập.',
    },
    {
      icon: ShieldAlert,
      tag: isEn ? 'Module 08 · Security & RBAC' : 'Phân hệ 08 · Cảnh báo & Kiểm toán',
      title: isEn
        ? 'Real-Time Contagion Alerts, Team RBAC & Immutable Audit Log'
        : 'Cảnh báo Rủi ro Thời gian thực, Phân quyền Team & Nhật ký Kiểm toán',
      desc: isEn
        ? 'Assign Owner, Admin, Media Buyer, and Viewer seats with strict workspace isolation, Fernet AES-128 encrypted token vaults, and full audit trails of every operational change.'
        : 'Phân quyền 4 cấp (Owner, Admin, Media Buyer, Viewer) cô lập theo từng không gian làm việc, mã hóa khóa bí mật chuẩn Fernet AES-128 và lưu vết toàn bộ lịch sử thao tác của đội ngũ.',
    },
  ]

  const faqs = [
    {
      q: isEn
        ? '1. Can AdsOps Control Center handle 100 to 500+ Ad Accounts across multiple Business Managers?'
        : '1. Hệ thống có quản lý nổi quy mô từ 100 đến 500+ Tài khoản Quảng cáo (TKQC) trên nhiều BM không?',
      a: isEn
        ? 'Yes. The system supports unlimited Meta Business Manager connections and System User tokens. A single click syncs all owned and client Ad Accounts, Fanpages, Pixels, and Payment Cards into PostgreSQL with instant filtering by BM, status, currency, and risk level.'
        : 'Hoàn toàn đáp ứng tốt. Hệ thống cho phép kết nối không giới hạn số lượng BM và System User Token. Chỉ với 1 cú nhấp đồng bộ, toàn bộ TKQC sở hữu (owned) và TKQC khách hàng (client), Fanpage, Pixel, Thẻ thanh toán được đồng bộ về cơ sở dữ liệu với bộ lọc tức thì theo từng BM, trạng thái, tiền tệ và mức độ rủi ro.',
    },
    {
      q: isEn
        ? '2. How does the Client Retainer & Monthly Settlement table calculate Agency Fees and Meta Taxes?'
        : '2. Bảng Quyết Toán Ngân sách Khách hàng cuối tháng tính Phí quản lý Agency và Thuế Meta như thế nào?',
      a: isEn
        ? 'You can group any number of VND and USD Ad Accounts into a Client Contract, set a monthly committed budget, Agency Management Fee (5%–15%), and Meta Foreign Contractor Withholding Tax (5%–10%). The system calculates Total Settlement = Real Meta Spend + Agency Fee + Meta Tax and exports directly to PDF, Excel/CSV, or Zalo/Telegram.'
        : 'Bạn có thể gom bất kỳ số lượng TKQC (cả tiền VND và USD tự quy đổi theo tỷ giá cấu hình) vào 1 Hợp đồng Khách hàng, thiết lập Ngân sách cam kết tháng, % Phí quản lý Agency (5%–15%) và % Thuế nhà thầu Meta (5%–10%). Hệ thống tự động tính Tổng Quyết Toán = Chi tiêu thực tế Meta + Phí Agency + Thuế Meta và xuất ngay ra PDF, Excel/CSV hoặc tin nhắn Zalo/Telegram.',
    },
    {
      q: isEn
        ? '3. Why do I need the AdsOps Companion Chrome Extension (.zip) instead of regular browser profiles?'
        : '3. Tại sao cần cài thêm Tiện ích Chrome AdsOps Companion (.zip) thay vì chỉ mở Hồ sơ Chrome thông thường?',
      a: isEn
        ? 'Standard Chrome profiles share your computer’s local IP address and do not auto-fill proxy credentials. AdsOps Companion locks each Chrome Profile to a dedicated static IPv4 proxy, auto-completes proxy username/password prompts, blocks WebRTC IP leaks, and displays which Via and BM belong to that window.'
        : 'Hồ sơ Chrome thông thường vẫn dùng chung địa chỉ IP mạng gốc và thường xuyên hỏi lại mật khẩu Proxy gây gián đoạn hoặc lộ IP thật. Tiện ích AdsOps Companion khóa chặt từng Hồ sơ Chrome vào 1 Proxy IPv4 riêng, tự động điền User/Pass ngầm, chặn rò rỉ WebRTC và hiển thị rõ Hộ chiếu định danh Via ngay trên thanh công cụ.',
    },
    {
      q: isEn
        ? '4. How are Meta Access Tokens, 2FA Secret Keys, and Client Data protected against security leaks?'
        : '4. Token Meta, Khóa 2FA và Dữ liệu Khách hàng được bảo mật bằng những lớp công nghệ nào?',
      a: isEn
        ? 'All Meta tokens and 2FA secrets are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256) and never exposed in browser bundles or logs. Passwords use 260,000-iteration PBKDF2-HMAC-SHA256, sessions are revocable per device, and strict Content-Security-Policy (CSP), HSTS, X-Frame-Options DENY, and atomic rate limiting protect every API endpoint.'
        : 'Toàn bộ Token Meta và Khóa 2FA được mã hóa trong kho lưu trữ bằng chuẩn Fernet (AES-128-CBC + HMAC-SHA256) và không bao giờ lộ ra trình duyệt hay nhật ký hệ thống. Mật khẩu băm bằng PBKDF2-HMAC-SHA256 (260.000 vòng lặp), phiên đăng nhập quản lý theo từng thiết bị kèm lớp bảo vệ CSP, HSTS, chống nhúng iframe (X-Frame-Options DENY) và giới hạn tần suất chống dò mật khẩu.',
    },
    {
      q: isEn
        ? '5. When I switch this website to my own custom domain later, will SEO and Sitemap work automatically?'
        : '5. Sau này khi tôi đổi sang Tên miền (Domain) riêng của công ty thì SEO, Sitemap và Cấu hình có tự động nhận không?',
      a: isEn
        ? 'Yes, 100% automatic. Both /robots.txt, /sitemap.xml, runtime API discovery (/config.js), Canonical URLs, OpenGraph tags, and Schema.org JSON-LD dynamically read the active domain host without requiring code changes.'
        : 'Tự động 100%. Toàn bộ đường dẫn /robots.txt, /sitemap.xml, cấu hình API thời gian thực (/config.js), thẻ Canonical URL, OpenGraph và dữ liệu có cấu trúc Schema.org JSON-LD đều tự động nhận diện theo tên miền mới của bạn mà không cần sửa lại mã nguồn.',
    },
  ]

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-canvas text-ink">
        {/* STICKY WEBSITE HEADER */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <a href="#top" className="focus:outline-none">
                <BrandMark />
              </a>
              <nav
                aria-label={isEn ? 'Primary website navigation' : 'Điều hướng trang chủ'}
                className="hidden lg:flex items-center gap-5 text-xs font-semibold text-ink-muted"
              >
                <a href="#he-sinh-thai-8-phan-he" className="hover:text-ink transition-colors">
                  {isEn ? '8-in-1 Ecosystem' : 'Hệ sinh thái 8 Phân hệ'}
                </a>
                <a href="#quyet-toan-agency" className="hover:text-ink transition-colors">
                  {isEn ? 'Retainer & Billing' : 'Quyết toán & Ngân sách'}
                </a>
                <a href="#tien-ich-chrome" className="hover:text-ink transition-colors">
                  {isEn ? 'Chrome Extension (.zip)' : 'Tiện ích Chrome (.zip)'}
                </a>
                <a href="#han-muc-meta" className="hover:text-ink transition-colors">
                  {isEn ? '4 Safe Limits' : '4 Hạn mức An toàn'}
                </a>
                <a href="#bao-mat-he-thong" className="hover:text-ink transition-colors">
                  {isEn ? 'Security & SEO' : 'Bảo mật & Chuẩn SEO'}
                </a>
                <a href="#cau-hoi-thuong-gap" className="hover:text-ink transition-colors">
                  {isEn ? 'FAQ' : 'Hỏi đáp (FAQ)'}
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
                <span className="hidden sm:inline">
                  {isEn ? 'Download Extension (.zip)' : 'Tải Tiện ích Chrome (.zip)'}
                </span>
                <span className="sm:hidden">.ZIP</span>
              </button>
              <ThemeToggle />
              <LanguageToggle />
            </div>
          </div>
        </header>

        <main id="top" className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* SECTION 1: HERO & LOGIN PORTAL */}
          <section className="grid items-center gap-10 py-10 lg:grid-cols-12 lg:py-14 border-b border-line">
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-brand/40 bg-brand-light/40 px-3.5 py-1 text-xs font-semibold text-brand-text">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'Enterprise Meta Ads Governance · Multi-BM · Anti-Contagion · Agency Settlement'
                    : 'Nền tảng Quản trị Meta Ads Chuẩn Agency · Đa BM · Chống Chết Chùm · Quyết Toán Tự Động'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.2]">
                {isEn
                  ? 'Centralize 20–500+ Meta Ad Accounts, isolate Chrome & Proxies per Via, and automate monthly Client Settlements'
                  : 'Kiểm soát tập trung 20–500+ Tài khoản Quảng cáo Meta, cách ly Hồ sơ Chrome · Proxy từng Via và tự động xuất Bảng Quyết Toán Khách Hàng'}
              </h1>

              <p className="text-sm sm:text-base text-ink-secondary leading-relaxed">
                {isEn ? (
                  <>
                    <strong className="font-semibold text-ink">AdsOps Control Center</strong> is an end-to-end operating system for Meta Ads Agencies and Media-Buying Teams: synchronize live spend across <strong className="font-semibold text-ink">Central &amp; Partner BMs</strong>, protect <strong className="font-semibold text-ink">Fanpages, Pixels &amp; Payment Cards</strong> from chain bans, isolate every Via with the <strong className="font-semibold text-ink">AdsOps Companion Chrome Extension (.zip)</strong>, and generate client billing statements (including 5%–15% Agency Fee &amp; 5%–10% Meta Tax) in one click.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-ink">AdsOps Control Center</strong> giải quyết trọn vẹn bài toán vận hành của một Meta Ads Agency chuyên nghiệp: đồng bộ chi tiêu thực tế qua <strong className="font-semibold text-ink">BM Trung tâm &amp; Partner</strong>, bảo vệ <strong className="font-semibold text-ink">Fanpage, Pixel &amp; Thẻ thanh toán</strong> khỏi chết liên đới, định danh &amp; bọc Proxy riêng cho từng Via bằng <strong className="font-semibold text-ink">Tiện ích Chrome (AdsOps Companion .zip)</strong>, đồng thời tự động tính <strong className="font-semibold text-ink">Bảng quyết toán ngân sách cuối tháng</strong> (cộng Phí Agency 5%–15% &amp; Thuế Meta 5%–10%) gửi thẳng cho khách hàng.
                  </>
                )}
              </p>

              {/* 4 KEY METRIC PILLS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base font-bold text-ink tabular-nums">8 Phân hệ</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {isEn ? 'BM · Ad Acct · Page · Pixel · Retainer' : 'BM · TKQC · Page · Pixel · Quyết toán'}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base font-bold text-ink tabular-nums">1 : 1 : 1</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {isEn ? '1 Chrome · 1 Via · 1 Proxy' : '1 Chrome · 1 Via · 1 Proxy'}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base font-bold text-ink tabular-nums">
                    {isEn ? '≤ 3 Accts' : '≤ 3 TKQC'}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {isEn ? 'Safe limit / Card & Page' : 'Ngưỡng an toàn / Thẻ & Page'}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="font-mono text-base font-bold text-emerald-500 tabular-nums">
                    {isEn ? '5%–15% Fee' : '5%–15% Phí'}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {isEn ? 'Auto Client Settlement' : 'Tự động quyết toán khách'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => downloadChromeExtensionZip()}
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-xs sm:text-sm font-semibold text-brand-fg shadow-xs hover:bg-brand-hover transition-colors"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {isEn ? 'Download Google Chrome Extension (.zip)' : 'Tải Tiện ích Google Chrome (.zip)'}
                  </span>
                </button>
                <a
                  href="#he-sinh-thai-8-phan-he"
                  className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 py-2.5 text-xs sm:text-sm font-semibold text-ink hover:bg-muted transition-colors"
                >
                  <span>{isEn ? 'Explore 8 Agency Modules' : 'Khám phá 8 Phân hệ Quản trị'}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* LOGIN CARD */}
            <aside className="lg:col-span-5" aria-label={isEn ? 'Operator sign in' : 'Đăng nhập quản trị'}>
              <div className="rounded-xl border border-line-strong bg-surface p-6 sm:p-7 shadow-md">
                <div className="mb-5 flex items-center justify-between border-b border-line pb-4">
                  <BrandMark />
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {isEn ? 'OWASP Hardened' : 'Bảo mật Đa lớp'}
                  </span>
                </div>

                <h2 className="text-base font-bold text-ink">
                  {isEn ? 'Sign in to Agency Control Center' : 'Đăng nhập Bảng điều khiển Quản trị'}
                </h2>
                <p className="mt-1 text-xs text-ink-muted">
                  {isEn
                    ? 'Protected by PBKDF2-SHA256, Fernet AES-128 Vault & Device Session Registry.'
                    : 'Bảo vệ bởi mã hóa Fernet AES-128, PBKDF2-SHA256 & Kiểm soát phiên theo thiết bị.'}
                </p>

                <form onSubmit={submit} className="mt-5 space-y-4">
                  {error && (
                    <div
                      role="alert"
                      className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink"
                    >
                      {error}
                    </div>
                  )}

                  <Field label={t('login.email')} htmlFor="login-email" required>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
                    />
                  </Field>

                  <Field label={t('login.password')} htmlFor="login-password" required>
                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg shadow-xs hover:bg-brand-hover disabled:opacity-50 transition-colors"
                  >
                    {busy ? t('login.submitting') : t('login.submit')}
                  </button>
                </form>

                <div className="mt-5 border-t border-line pt-4 flex items-center justify-between text-xs text-ink-muted">
                  <span>{isEn ? 'Need the Via browser extension?' : 'Cần gói tiện ích cho trình duyệt Via?'}</span>
                  <button
                    type="button"
                    onClick={() => downloadChromeExtensionZip()}
                    className="font-semibold text-brand-text hover:underline"
                  >
                    {isEn ? 'Download .zip now →' : 'Tải file .zip ngay →'}
                  </button>
                </div>
              </div>
            </aside>
          </section>

          {/* SECTION 2: 8-PILLAR AGENCY ECOSYSTEM */}
          <section id="he-sinh-thai-8-phan-he" className="py-12 border-b border-line space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-brand-text">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'Complete 8-Module Meta Ads Agency Architecture'
                    : 'Kiến trúc 8 Phân hệ Khép kín cho Meta Ads Agency'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-ink">
                {isEn
                  ? 'Every Account & Asset an Agency Needs — Managed in One Unified Platform'
                  : 'Mọi Tài khoản & Tài sản Agency cần quản lý — Hội tụ trong 1 Hệ thống Duy nhất'}
              </h2>
              <p className="text-sm text-ink-muted max-w-3xl">
                {isEn
                  ? 'Built to scale seamlessly from 10 to 500+ Ad Accounts: from Via warm-up and BM asset isolation to live spend monitoring and automated monthly client billing.'
                  : 'Thiết kế chuyên sâu để mở rộng từ 10 lên 500+ Tài khoản Quảng cáo mà không sợ chết chùm: khép kín từ khâu Nuôi Via/BM ➔ Cô lập Tài sản (Page/Pixel/Thẻ/Chrome/Proxy) ➔ Canh Ngân sách ➔ Xuất Bảng Quyết Toán Thu Tiền Khách Hàng.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {eightModules.map((m, idx) => {
                const Icon = m.icon
                return (
                  <article
                    key={idx}
                    className="rounded-xl border border-line bg-surface p-4 flex flex-col justify-between space-y-3 hover:border-brand/50 transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light text-brand-text">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <span className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-[10px] font-bold text-ink-muted">
                          {m.tag}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-ink leading-snug">{m.title}</h3>
                      <p className="text-xs text-ink-muted leading-relaxed">{m.desc}</p>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {/* SECTION 3: CLIENT RETAINER, BUDGET PACING & MONTHLY SETTLEMENT SHOWCASE */}
          <section id="quyet-toan-agency" className="py-12 border-b border-line">
            <div className="grid gap-8 lg:grid-cols-12 items-center">
              <div className="space-y-4 lg:col-span-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-brand-text">
                  <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isEn
                      ? 'Client Retainer & Automated Monthly Settlement'
                      : 'Theo dõi Ngân sách Cam kết & Quyết toán Cuối tháng Tự động'}
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-bold text-ink">
                  {isEn
                    ? 'Group multiple Ad Accounts into 1 Client Contract & export Monthly Settlements in 1 click'
                    : 'Gom nhiều TKQC vào 1 Hợp đồng Khách hàng & Xuất Bảng Quyết Toán Chi Phí chỉ với 1 cú nhấp'}
                </h2>

                <p className="text-sm text-ink-secondary leading-relaxed">
                  {isEn
                    ? 'Stop manually copying spend numbers from dozens of VND and USD Ad Accounts into spreadsheets at month-end. AdsOps automatically groups accounts per client, tracks real-time budget pacing, and computes the exact billable amount:'
                    : 'Loại bỏ hoàn toàn việc cuối tháng kế toán và Account phải cộng tay từng TKQC tiền VND và USD trên Excel. Hệ thống tự động gom nhóm nhiều TKQC theo từng Hợp đồng Khách hàng / Dự án, đo tốc độ cắn ngân sách (Pacing) và tính chuẩn xác số tiền phải thu:'}
                </p>

                <div className="space-y-2.5 pt-1">
                  <div className="rounded-lg border border-line bg-surface p-3.5 flex items-start gap-3">
                    <TrendingUp className="h-4 w-4 text-brand-text shrink-0 mt-0.5" />
                    <div className="text-xs text-ink-muted leading-relaxed">
                      <strong className="text-ink font-semibold">
                        {isEn
                          ? 'Real-Time Budget Pacing & Daily Spend Recommendation:'
                          : 'Thanh tiến độ Pacing & Gợi ý ngân sách/ngày:'}
                      </strong>{' '}
                      {isEn
                        ? 'Track % MTD spend vs committed retainer budget and automatically calculate recommended daily spend for the remaining days of the month.'
                        : 'Báo ngay % ngân sách đã chạy trong tháng so với cam kết và tự động chia số tiền khuyến nghị cần chạy mỗi ngày cho những ngày còn lại trong tháng.'}
                    </div>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-3.5 flex items-start gap-3">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-ink-muted leading-relaxed">
                      <strong className="text-ink font-semibold">
                        {isEn
                          ? 'Transparent 4-Column Agency Billing Formula:'
                          : 'Công thức Quyết toán 4 Cột Minh bạch Chuẩn Agency:'}
                      </strong>{' '}
                      {isEn
                        ? '(1) Live Meta Spend + (2) Agency Management Fee (5%–15%) + (3) Meta Foreign Contractor Tax (5%–10%) = (4) Total Client Settlement.'
                        : '(1) Chi tiêu thực tế Meta + (2) Phí quản lý & tối ưu Agency (5%–15%) + (3) Thuế nhà thầu Meta (5%–10%) = (4) Tổng Quyết Toán Thanh Toán.'}
                    </div>
                  </div>
                </div>
              </div>

              {/* VISUAL SETTLEMENT STATEMENT PREVIEW CARD */}
              <div className="lg:col-span-6">
                <div className="rounded-xl border border-line-strong bg-surface p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                    <div>
                      <span className="rounded bg-brand/15 px-2 py-0.5 font-mono text-[11px] font-bold text-brand-text">
                        HD-MB-2026-01
                      </span>
                      <h3 className="mt-1 text-sm font-bold text-ink">
                        {isEn
                          ? 'Sample Contract: Enterprise Client (6 Grouped Ad Accounts)'
                          : 'Minh họa Hợp đồng: Cụm 6 TKQC (Tự động quy đổi VND & USD)'}
                      </h3>
                    </div>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                      {isEn ? 'Live Meta Graph Sync' : 'Đồng bộ Meta Thời gian thực'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="rounded-lg border border-line bg-canvas p-2.5">
                      <div className="text-[10px] font-bold uppercase text-ink-muted">
                        {isEn ? '1. Net Meta Spend' : '1. Chi tiêu gốc Meta'}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-ink">25.643.338 ₫</div>
                      <div className="text-[10px] text-ink-muted">6 TKQC (VND &amp; USD)</div>
                    </div>
                    <div className="rounded-lg border border-line bg-canvas p-2.5">
                      <div className="text-[10px] font-bold uppercase text-ink-muted">
                        {isEn ? '2. Agency Fee (10%)' : '2. Phí Agency (10%)'}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-brand-text">+ 2.564.334 ₫</div>
                      <div className="text-[10px] text-ink-muted">{isEn ? 'Configurable 5–15%' : 'Tùy chỉnh 5%–15%'}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-canvas p-2.5">
                      <div className="text-[10px] font-bold uppercase text-ink-muted">
                        {isEn ? '3. Meta Tax (5%)' : '3. Thuế Meta (5%)'}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-amber-500">+ 1.282.167 ₫</div>
                      <div className="text-[10px] text-ink-muted">{isEn ? 'Configurable 5–10%' : 'Tùy chỉnh 5%–10%'}</div>
                    </div>
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5">
                      <div className="text-[10px] font-bold uppercase text-emerald-400">
                        {isEn ? '4. Total Settlement' : '4. Tổng Quyết Toán'}
                      </div>
                      <div className="mt-1 font-mono text-sm font-extrabold text-emerald-400">29.489.839 ₫</div>
                      <div className="text-[10px] text-emerald-300/80">
                        {isEn ? 'PDF · Excel · Zalo' : 'Xuất PDF · Excel · Zalo'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-ink-muted flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {isEn
                        ? '✓ Includes Printable Client Statement with Dual Signature Blocks & UTF-8 Excel CSV'
                        : '✓ Hỗ trợ In Phiếu Quyết Toán có khung ký xác nhận 2 bên & Xuất file Excel CSV chuẩn tiếng Việt'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 4: CHROME EXTENSION SHOWCASE */}
          <section id="tien-ich-chrome" className="py-12 border-b border-line">
            <div className="grid gap-8 lg:grid-cols-12 items-center">
              <div className="space-y-4 lg:col-span-7">
                <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-brand-text">
                  <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isEn
                      ? 'Official Google Chrome Extension · Manifest V3 (.zip)'
                      : 'Tiện ích Google Chrome chính thức · Chuẩn Manifest V3 (.zip)'}
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-bold text-ink">
                  {isEn
                    ? 'What does the "AdsOps Companion" Chrome Extension do?'
                    : 'Tiện ích «AdsOps Companion» trên Google Chrome dùng để làm gì?'}
                </h2>

                <p className="text-sm text-ink-secondary leading-relaxed">
                  {isEn ? (
                    <>
                      When operating multiple Facebook accounts (Vias) across separate Chrome Profiles, opening the wrong browser window or forgetting to enable a Proxy easily triggers Meta IP sweeps and chain-bans across your BMs. The <strong className="font-semibold text-ink">AdsOps Companion (.zip)</strong> extension sits inside each Chrome Profile to automate 4 critical protections:
                    </>
                  ) : (
                    <>
                      Khi bạn nuôi nhiều tài khoản Facebook (Via) trên nhiều Hồ sơ Chrome khác nhau, việc mở nhầm trình duyệt hoặc quên bật Proxy rất dễ khiến Meta quét trùng IP và khoá liên đới cả dàn BM. Tiện ích <strong className="font-semibold text-ink">AdsOps Companion (file chuẩn .zip)</strong> gắn trực tiếp lên góc phải mỗi Hồ sơ Chrome để giải quyết 4 việc:
                    </>
                  )}
                </p>

                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <UserRoundCog className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>{isEn ? '1. Via & Profile Passport' : '1. Hộ chiếu định danh Via & Profile'}</span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      {isEn
                        ? 'Displays clearly on the Chrome toolbar which Via (#12, Standby BM Via #1) and Chrome Profile folder (Profile 4, Profile 10) you are using.'
                        : 'Hiển thị rõ trên thanh công cụ Chrome bạn đang ở Via nào (#12, Via Dự Phòng BM #1) và Thư mục Chrome nào (Profile 4, Profile 10) để không bao giờ đăng nhập nhầm.'}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn ? '2. Proxy Routing & Auto User/Pass' : '2. Bọc Proxy & Tự điền User/Pass'}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      {isEn
                        ? 'Enter IP:Port:User:Pass directly inside the extension to route traffic exclusively for that Chrome Profile and auto-fill proxy authentication.'
                        : 'Nhập trực tiếp IP:Port:User:Pass ngay trong tiện ích để định tuyến riêng cho Profile đó, tự động điền mật khẩu Proxy ngầm và chặn rò rỉ IP gốc qua WebRTC.'}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <ExternalLink className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>
                        {isEn ? '3. Auto-Detect Meta IDs on Active Tab' : '3. Tự bắt ID TKQC & BM trên Tab đang mở'}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      {isEn
                        ? 'While browsing Ads Manager or Business Settings, the extension automatically extracts act_id and business_id for instant lookup.'
                        : 'Khi bạn mở Ads Manager hoặc Business Settings, tiện ích tự đọc act_id và business_id trên đường dẫn để đối chiếu trạng thái ngay lập tức.'}
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      <Terminal className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
                      <span>{isEn ? '4. 1-Click Appeal & Billing Shortcuts' : '4. Mở nhanh Kháng nghị & Thanh toán'}</span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      {isEn
                        ? 'Built-in quick buttons to open Account Quality (Appeals), Billing & Cards, Ads Manager, and IP Check right inside the isolated profile.'
                        : 'Tích hợp sẵn cụm nút mở thẳng chất lượng tài khoản (Account Quality), Thanh toán (Billing), Trình quản lý QC và Kiểm tra IP ngay trong Profile.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* CHROME EXTENSION MOCKUP */}
              <div className="lg:col-span-5">
                <div className="rounded-xl border border-line-strong bg-surface p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-line pb-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-brand text-[11px] font-extrabold text-brand-fg">
                        AO
                      </span>
                      <div>
                        <div className="text-xs font-bold text-ink">
                          {isEn ? 'AdsOps Via Passport' : 'AdsOps Hộ Chiếu Via'}
                        </div>
                        <div className="text-[11px] text-ink-muted">Chrome Extension · Manifest V3</div>
                      </div>
                    </div>
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                      {isEn ? 'PROXY ACTIVE' : 'ĐANG BỌC PROXY'}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-md border border-line bg-canvas p-2.5">
                      <div className="text-[10px] font-bold uppercase text-ink-muted">
                        {isEn ? '1. Via Identity & Chrome Folder' : '1. Định danh Via & Hồ sơ Chrome'}
                      </div>
                      <div className="mt-1 flex items-center justify-between font-mono text-xs text-ink">
                        <span>{isEn ? 'Primary Master Via' : 'Tài khoản Chính (Master)'}</span>
                        <span className="text-brand-text">Chrome — Default</span>
                      </div>
                    </div>

                    <div className="rounded-md border border-line bg-canvas p-2.5">
                      <div className="text-[10px] font-bold uppercase text-ink-muted">
                        {isEn ? '2. Dedicated Proxy (IP:Port:User:Pass)' : '2. Cấu hình Proxy riêng (IP:Port:User:Pass)'}
                      </div>
                      <div className="mt-1 font-mono text-xs text-ink">
                        HTTP · Auto-Auth · WebRTC Leak Blocked
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => downloadChromeExtensionZip()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {isEn ? 'Download adsops-chrome-extension.zip' : 'Tải gói adsops-chrome-extension.zip'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 5: 4 META SAFE LIMITS */}
          <section id="han-muc-meta" className="py-12 border-b border-line space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-ink">
                {isEn
                  ? '4 Meta Anti-Contagion Safety Limits Enforced Automatically (2025–2026)'
                  : '4 Hạn mức An toàn Thực chiến trên Meta được Hệ thống Kiểm toán Tự động (2025–2026)'}
              </h2>
              <p className="text-sm text-ink-muted">
                {isEn
                  ? 'Recommended operational thresholds to prevent chain restrictions across your Business Managers, Cards, Fanpages, and Vias.'
                  : 'Ngưỡng cấu hình khuyến nghị được tích hợp sẵn trong bộ quy tắc kiểm toán để bảo vệ dàn tài khoản khỏi quét liên đới.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '1. 1 Via → Create BMs' : '1. Hạn mức 1 Via → Tạo BM'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? 'Max 2 Root BMs / Via' : 'Tối đa 2 BM Gốc / Via'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'A personal Facebook account can create at most 2 root BMs, but can receive Admin/Employee invites to 10–30+ existing BMs after 72h warm-up.'
                    : 'Mỗi tài khoản Facebook cá nhân chỉ tự khởi tạo được tối đa 2 BM gốc, nhưng có thể nhận lời mời làm Quản trị viên cho 10–30+ BM sau khi ngâm đủ 72h.'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-light text-brand-text">
                  <Flag className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {isEn ? '2. 1 Fanpage → Ad Accounts' : '2. Hạn mức 1 Fanpage → TKQC'}
                </div>
                <div className="font-mono text-base font-extrabold text-ink tabular-nums">
                  {isEn ? 'Safe: 1–3 Ad Accts / Page' : 'An toàn 1–3 TKQC / Page'}
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Hold Fanpage Admin inside your Tier-1 Central BM and share Advertiser access to at most 1–3 active Ad Accounts in the same niche.'
                    : 'Giữ quyền Admin Fanpage trong BM Trung tâm (Tier-1) và chỉ chia sẻ quyền Nhà quảng cáo cho tối đa 1–3 TKQC sạch cùng ngành hàng.'}
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
                  {isEn
                    ? 'Link at most 1–3 Ad Accounts per Visa/Mastercard in production to prevent chain payment bans when one account is flagged.'
                    : 'Chỉ gắn tối đa 1–3 TKQC trên 1 đầu thẻ Visa/Mastercard để tránh chết liên đới (bão thẻ) khi 1 tài khoản bị gắn cờ thanh toán.'}
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
                  {isEn
                    ? 'Use Static Residential IPv4 Proxies. Assign 1 dedicated Chrome Profile per Via and at most 1–2 Vias from the same BM cluster per Proxy.'
                    : 'Mỗi Via cố định 1 Hồ sơ Chrome riêng biệt; mỗi Proxy IPv4 Dân cư tĩnh chỉ nuôi tối đa 1–2 Via thuộc cùng cụm BM.'}
                </p>
              </div>
            </div>
          </section>

          {/* SECTION 6: SECURITY HARDENING & CUSTOM DOMAIN SEO ARCHITECTURE */}
          <section id="bao-mat-he-thong" className="py-12 border-b border-line space-y-6">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'OWASP ASVS Security Hardening & Domain-Ready SEO'
                    : 'Kiến trúc Bảo mật Chuẩn OWASP ASVS & Sẵn sàng Chuyển đổi Tên miền SEO'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-ink">
                {isEn
                  ? '6-Layer Enterprise Security & Zero-Config Custom Domain Migration'
                  : 'Bảo mật 6 Lớp Cấp Doanh nghiệp & Tự động Thích ứng khi Đổi Tên Miền Mới'}
              </h2>
              <p className="text-sm text-ink-muted max-w-3xl">
                {isEn
                  ? 'Every credential, session, and API endpoint is hardened to protect agency tokens and client financial statements.'
                  : 'Toàn bộ mã nguồn Backend, Frontend và Nginx đã được rà soát, gia cố bảo mật và tối ưu chuẩn SEO Google để bạn có thể trỏ bất kỳ tên miền thương hiệu nào về sau.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '1. Fernet AES-128-CBC + HMAC-SHA256 Secret Vault'
                      : '1. Kho khóa Fernet AES-128-CBC + HMAC-SHA256'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Meta Graph API tokens and 2FA TOTP secrets are encrypted at rest with CREDENTIAL_VAULT_KEY and automatically redacted from logs and error responses.'
                    : 'Token Meta Graph API và Khóa 2FA được mã hóa bằng CREDENTIAL_VAULT_KEY, tự động che giấu (redaction) tuyệt đối khỏi log và phản hồi API.'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <Lock className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '2. PBKDF2-SHA256 (260k) & Device Session Registry'
                      : '2. Mật khẩu PBKDF2-SHA256 (260k vòng) & Quản lý Phiên'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'JWT tokens are bound to server-side session IDs and separated by token_use (dashboard vs extension), allowing instant remote session revocation.'
                    : 'JWT gắn chặt với phiên máy chủ (session_id) và tách biệt phạm vi token_use (Dashboard vs Extension), cho phép thu hồi phiên từ xa tức thì.'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <Layers className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '3. Multi-Tenant Isolation & 4-Tier RBAC'
                      : '3. Cô lập Workspace & Phân quyền 4 Cấp (RBAC)'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Every query and mutation enforces workspace_id ownership and role checks (Owner, Admin, Media Buyer, Viewer) to prevent IDOR and unauthorized edits.'
                    : 'Mọi truy vấn và thao tác ghi đều kiểm tra chéo workspace_id và vai trò (Owner, Admin, Media Buyer, Viewer), chống truy cập trái phép (IDOR/BFLA).'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '4. Atomic Rate Limiting & Anti-Bruteforce'
                      : '4. Giới hạn Tần suất (Rate Limit) Chống Brute-Force'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Login and sensitive endpoints enforce trusted-proxy-hop IP rate limiting with Retry-After and X-RateLimit headers.'
                    : 'Cổng đăng nhập và API được bảo vệ bởi bộ đếm giới hạn tốc độ theo IP thực (chống giả mạo X-Forwarded-For) kèm cảnh báo 429 Retry-After.'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '5. Hardened CSP, HSTS, X-Frame-Options & Permissions-Policy'
                      : '5. Gia cố Header An ninh CSP, HSTS & Chống Clickjacking'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Strict Content-Security-Policy (allowing only self, configured API origin, and verified Meta CDN), HSTS, nosniff, and frame-ancestors none.'
                    : 'Cấu hình Content-Security-Policy nghiêm ngặt (chỉ cho phép origin hợp lệ & ảnh CDN Meta), HSTS, X-Frame-Options DENY và khóa quyền camera/micro/usb.'}
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <Globe className="h-4 w-4 text-emerald-500" />
                  <span>
                    {isEn
                      ? '6. Dynamic Domain-Ready SEO (Sitemap, Robots & JSON-LD)'
                      : '6. Chuẩn SEO Tự động Nhận diện Tên Miền Mới'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Dynamic /robots.txt, /sitemap.xml, Canonical URLs, OpenGraph, and Schema.org JSON-LD automatically adapt to any new custom domain you attach.'
                    : 'Tích hợp sẵn /robots.txt, /sitemap.xml, Canonical URL, OpenGraph và Schema.org JSON-LD tự động cập nhật theo tên miền mới ngay khi bạn trỏ DNS.'}
                </p>
              </div>
            </div>
          </section>

          {/* SECTION 7: SEO FAQ ACCORDION */}
          <section id="cau-hoi-thuong-gap" className="py-12 space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-ink">
                {isEn
                  ? 'Frequently Asked Questions (Meta Ads Agency Governance & Billing)'
                  : 'Câu hỏi Thường gặp về Quản trị Tài khoản Quảng cáo Meta & Quyết toán Agency'}
              </h2>
              <p className="text-sm text-ink-muted">
                {isEn
                  ? 'Everything you need to know about scaling to 100+ Ad Accounts, isolating Vias, and switching to your custom domain.'
                  : 'Giải đáp chi tiết về khả năng mở rộng 100+ tài khoản, cơ chế cách ly Via/Chrome/Proxy, bảo mật dữ liệu và chuyển đổi tên miền.'}
              </p>
            </div>

            <div className="space-y-2.5">
              {faqs.map((item, idx) => {
                const isOpen = openFaq === idx
                return (
                  <div key={idx} className="rounded-lg border border-line bg-surface overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left text-xs sm:text-sm font-bold text-ink hover:bg-muted/50 transition-colors"
                    >
                      <span>{item.q}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${
                          isOpen ? 'rotate-180 text-brand-text' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t border-line bg-canvas/50 px-4 py-3 text-xs sm:text-sm text-ink-muted leading-relaxed">
                        {item.a}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </main>

        {/* ENTERPRISE SEO FOOTER */}
        <footer className="border-t border-line bg-surface py-8">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="space-y-2">
                <BrandMark />
                <p className="text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Enterprise Meta Ad Account Governance, Multi-BM Asset Isolation, Chrome Via Passport & Automated Client Retainer Settlement.'
                    : 'Hệ thống Quản trị Tài khoản Quảng cáo Meta, Cách ly Tài sản Đa BM, Hộ chiếu Via trên Chrome & Quyết toán Ngân sách Khách hàng Tự động.'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="font-bold uppercase tracking-wider text-ink">
                  {isEn ? 'Core Modules' : 'Phân hệ Cốt lõi'}
                </div>
                <ul className="space-y-1.5 text-ink-muted">
                  <li>
                    <a href="#he-sinh-thai-8-phan-he" className="hover:text-ink">
                      {isEn ? 'Ad Accounts & Multi-BM Sync' : 'Quản lý TKQC & Đồng bộ Đa BM'}
                    </a>
                  </li>
                  <li>
                    <a href="#quyet-toan-agency" className="hover:text-ink">
                      {isEn ? 'Client Retainers & Monthly Billing' : 'Ngân sách Cam kết & Quyết toán KH'}
                    </a>
                  </li>
                  <li>
                    <a href="#he-sinh-thai-8-phan-he" className="hover:text-ink">
                      {isEn ? 'Fanpage & Pixel Control Center' : 'Trung tâm Quản trị Fanpage & Pixel'}
                    </a>
                  </li>
                  <li>
                    <a href="#he-sinh-thai-8-phan-he" className="hover:text-ink">
                      {isEn ? '3-Tier Vias & Live 2FA OTP' : 'Quản lý Dàn Via 3 Tầng & Mã 2FA'}
                    </a>
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="font-bold uppercase tracking-wider text-ink">
                  {isEn ? 'Security & SEO Standards' : 'Tiêu chuẩn Bảo mật & SEO'}
                </div>
                <ul className="space-y-1.5 text-ink-muted">
                  <li>
                    <a href="#bao-mat-he-thong" className="hover:text-ink">
                      {isEn ? 'OWASP ASVS Hardened Architecture' : 'Bảo mật 6 Lớp Chuẩn OWASP ASVS'}
                    </a>
                  </li>
                  <li>
                    <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="hover:text-ink">
                      {isEn ? 'Dynamic XML Sitemap (/sitemap.xml)' : 'Sơ đồ trang tự động (/sitemap.xml)'}
                    </a>
                  </li>
                  <li>
                    <a href="/robots.txt" target="_blank" rel="noreferrer" className="hover:text-ink">
                      {isEn ? 'Search Engine Rules (/robots.txt)' : 'Cấu hình Bot tìm kiếm (/robots.txt)'}
                    </a>
                  </li>
                  <li>
                    <a href="#cau-hoi-thuong-gap" className="hover:text-ink">
                      {isEn ? 'Schema.org JSON-LD Structured Data' : 'Dữ liệu cấu trúc Schema.org JSON-LD'}
                    </a>
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="font-bold uppercase tracking-wider text-ink">
                  {isEn ? 'Browser Extension & Domain' : 'Tiện ích Trình duyệt & Tên miền'}
                </div>
                <p className="text-ink-muted leading-relaxed">
                  {isEn ? 'Active Domain:' : 'Tên miền đang hoạt động:'}{' '}
                  <span className="font-mono font-semibold text-ink">{currentHost}</span>
                </p>
                <button
                  type="button"
                  onClick={() => downloadChromeExtensionZip()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand/20 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isEn ? 'Download Chrome Extension (.zip)' : 'Tải Tiện ích Chrome (.zip)'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'AdsOps Control Center · Enterprise Meta Ads Governance, Retainer Billing & Chrome Extension Suite'
                    : 'AdsOps Control Center · Hệ thống Quản trị Tài khoản Quảng cáo Meta, Quyết toán Ngân sách & Tiện ích Chrome'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span>{isEn ? '100% Real Meta Graph Data' : '100% Dữ liệu Meta Thật'}</span>
                <span>·</span>
                <span>{isEn ? 'Custom-Domain SEO Ready' : 'Chuẩn SEO Sẵn sàng Đổi Tên Miền'}</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
