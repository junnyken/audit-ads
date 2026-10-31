import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Building2,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
  Layers,
  Play,
  Puzzle,
  ShieldCheck,
  Terminal,
  UserRoundCog,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Paged, ReferenceRecord } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import {
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadChromeExtensionZip,
  downloadSwitchyOmegaConfig,
  fetchRealLocalChromeProfiles,
  launchChromeWithExtensionPreview,
  parseProxyString,
} from '../lib/chromeProfileLauncher'

export default function ChromeExtensionPage() {
  const viasQuery = useQuery({
    queryKey: ['personal-account-references', 'ext-page'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=100'),
  })
  const localChrome = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    initialData: WORKSTATION_REAL_CHROME_PROFILES,
    retry: false,
  })

  const vias = viasQuery.data?.items ?? []
  const [selectedViaLabel, setSelectedViaLabel] = useState('Tài Khoản Chính (Via Tổng)')
  const [selectedProfile, setSelectedProfile] = useState('Chrome — Default · trieu (thientrieu753@gmail.com)')
  const [proxyInput, setProxyInput] = useState('VNPT Static IP — Line #1')

  const parsedProxy = parseProxyString(proxyInput)
  const shortFolder = selectedProfile.includes('Profile ')
    ? selectedProfile.match(/Profile\s+\d+/i)?.[0] ?? 'Default'
    : 'Default'

  return (
    <div className="space-y-6">
      {/* HERO BANNER */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Tiện ích Google Chrome chính thức · v2.1</Badge>
              <Badge tone="positive">Chuẩn Manifest V3 · Gói cài đặt .ZIP</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink">
              Trung tâm Tiện ích Google Chrome («AdsOps Companion») & Quy chuẩn Vận hành
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              Tiện ích <strong>AdsOps Companion (<code>.zip</code>)</strong> cài trực tiếp vào từng Hồ sơ Google Chrome giúp bạn định danh chính xác đang mở <strong>Via nào</strong>, bọc <strong>Proxy IPv4 riêng</strong> (tự động điền User/Pass ngầm), tự động bắt mã <strong>ID BM / ID TKQC</strong> từ tab Facebook đang mở và cung cấp 5 nút xử lý Kháng nghị / Thanh toán dư nợ 1 chạm.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/adsops-chrome-extension.zip"
              download="AdsOps-Chrome-Extension-v2.1.zip"
              className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-brand-fg hover:bg-brand-hover transition-colors"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Tải Gói Tiện Ích Chuẩn (.zip)</span>
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                launchChromeWithExtensionPreview(
                  'https://business.facebook.com/overview',
                  selectedProfile,
                  selectedViaLabel,
                  proxyInput,
                )
              }
            >
              <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Mở Chrome & Xem Tiện Ích Ngay
            </Button>
          </div>
        </div>

        {/* 4 PILLARS */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <UserRoundCog className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>1. Định danh Via & Hồ sơ Chrome</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Mỗi Profile Chrome gắn cố định 1 Via. Nhìn góc phải trình duyệt biết ngay đang cầm Via nào, chống đăng nhập nhầm nick.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>2. Bọc Proxy & Tự nạp mật khẩu</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Nhập <code>IP:Port:User:Pass</code> ngay trong tiện ích để bật/tắt Proxy riêng cho Profile đó và kiểm tra IP Public thật.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Terminal className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>3. Bắt nhanh ID BM & ID TKQC</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Tự động tách <code>act_id</code> và <code>business_id</code> từ thanh địa chỉ Facebook để sao chép hoặc đồng bộ về bảng điều khiển.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>4. Canh 4 Hạn mức An toàn Meta</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Kiểm soát ngưỡng: <strong>1 Via ≤ 2 BM gốc</strong> · <strong>BM XMDN (1→30+ TKQC)</strong> · <strong>1 Thẻ ≤ 3 TKQC</strong> · <strong>1 Proxy ≤ 2 Via</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* GENERATOR + LIVE PREVIEW */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Đóng gói Tiện ích Chrome (.zip) theo từng Via & Proxy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vias.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink">
                  1. Chọn nhanh từ Tài khoản Facebook (Via) đã khai báo:
                </label>
                <div className="flex flex-wrap gap-2">
                  {vias.map((v) => {
                    const lbl = String(v.label ?? '')
                    const prof = String(v.browser_profile_label ?? 'Chrome — Default')
                    const net = String(v.network_label ?? '')
                    const active = selectedViaLabel === lbl
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedViaLabel(lbl)
                          setSelectedProfile(prof)
                          setProxyInput(net)
                        }}
                        className={`rounded-md border px-3 py-1.5 text-left text-xs font-semibold transition ${
                          active
                            ? 'border-brand bg-brand-light text-brand-text'
                            : 'border-line bg-surface hover:bg-surface-muted text-ink'
                        }`}
                      >
                        <div>{lbl}</div>
                        <div className="text-[10px] font-normal text-ink-muted">{prof}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-bold text-ink" htmlFor="ext-via-name">
                  Tên định danh Via nạp sẵn vào Tiện ích:
                </label>
                <input
                  id="ext-via-name"
                  className="input text-xs"
                  value={selectedViaLabel}
                  onChange={(e) => setSelectedViaLabel(e.target.value)}
                  placeholder="VD: Via Dự Phòng Cụm BM #1"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-ink" htmlFor="ext-chrome-prof">
                  Hồ sơ Google Chrome thật trên máy:
                </label>
                <select
                  id="ext-chrome-prof"
                  className="input text-xs"
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                >
                  {(localChrome.data ?? WORKSTATION_REAL_CHROME_PROFILES).map((cp) => (
                    <option key={cp.folder} value={cp.label}>
                      {cp.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-ink" htmlFor="ext-proxy-str">
                Cấu hình Proxy nạp sẵn (<code>IP:Port:User:Pass</code> hoặc để trống):
              </label>
              <input
                id="ext-proxy-str"
                className="input font-mono text-xs"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder="VD: 103.145.67.89:8080:myuser:mypass"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="font-semibold text-ink-muted">Nhà cung cấp Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):</span>
                <a href="https://proxyvn.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-2 py-0.5 font-semibold text-brand-text hover:underline">
                  ProxyVN.vn ↗
                </a>
                <a href="https://zingproxy.com/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-2 py-0.5 font-semibold text-brand-text hover:underline">
                  ZingProxy.com ↗
                </a>
                <a href="https://muaproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-2 py-0.5 font-semibold text-brand-text hover:underline">
                  MuaProxy.vn ↗
                </a>
                <a href="https://vproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-2 py-0.5 font-semibold text-brand-text hover:underline">
                  VProxy.vn ↗
                </a>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Button
                type="button"
                onClick={() => downloadChromeExtensionZip(selectedViaLabel, shortFolder, proxyInput)}
              >
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Tải Tiện Ích Chrome Đã Cấu Hình (.zip)
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  launchChromeWithExtensionPreview(
                    'https://business.facebook.com/overview',
                    selectedProfile,
                    selectedViaLabel,
                    proxyInput,
                  )
                }
              >
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Mở Chrome & Xem Trực Tiếp Tiện Ích
              </Button>

              {parsedProxy && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => downloadSwitchyOmegaConfig(proxyInput, selectedViaLabel)}
                >
                  Xuất File SwitchyOmega (.bak)
                </Button>
              )}
            </div>

            {/* 4-STEP INSTALL GUIDE */}
            <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-2">
              <div className="text-xs font-bold text-ink">
                Hướng dẫn cài đặt gói <code>.zip</code> vào trình duyệt Google Chrome:
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-ink-muted">
                <li>
                  Bấm <strong>Tải Tiện Ích Chrome Đã Cấu Hình (.zip)</strong> ở trên rồi giải nén ra một thư mục (hoặc dùng thư mục đã tạo sẵn tại <code>Desktop\AdsOps_Tien_Ich_Chrome</code>).
                </li>
                <li>
                  Trên cửa sổ Chrome của Via, truy cập địa chỉ: <strong><code>chrome://extensions</code></strong> và bật công tắc <strong>Chế độ dành cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải.
                </li>
                <li>
                  Bấm nút <strong>Tải tiện ích đã giải nén (Load unpacked)</strong> ở góc trên bên trái → chọn thư mục vừa giải nén.
                </li>
                <li>
                  Bấm biểu tượng <strong>Mảnh ghép Tiện ích</strong> trên góc phải thanh công cụ Chrome → bấm nút <strong>Ghim (Pin)</strong> cạnh <strong>AdsOps Companion</strong> để hiện cố định huy hiệu <code>{parsedProxy ? 'PRX' : shortFolder.replace('Profile ', 'P').slice(0, 3).toUpperCase()}</code>.
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* LIVE EXTENSION POPUP PREVIEW */}
        <div className="lg:col-span-5 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Bản xem trước trực tiếp giao diện Tiện ích trên Chrome:
          </div>

          <div className="mx-auto w-full max-w-[370px] rounded-xl border border-line bg-surface p-4 shadow-md">
            <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-surface-muted px-3 py-1.5 text-xs">
              <span className="font-mono text-ink-muted truncate">business.facebook.com/overview</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-brand-text">
                <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                <span className={`rounded px-1.5 py-0.5 text-[10px] text-white ${parsedProxy ? 'bg-emerald-700' : 'bg-blue-700'}`}>
                  {parsedProxy ? 'PRX' : shortFolder.replace('Profile ', 'P').slice(0, 3).toUpperCase()}
                </span>
              </span>
            </div>

            <div className="rounded-lg border border-line bg-canvas p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[11px] font-extrabold text-brand-fg">
                    AO
                  </span>
                  <span className="text-xs font-extrabold text-ink">AdsOps Hộ Chiếu Via</span>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    parsedProxy
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                      : 'border-brand/40 bg-brand-light text-brand-text'
                  }`}
                >
                  {parsedProxy ? 'ĐANG BỌC PROXY' : 'MẠNG TRỰC TIẾP'}
                </span>
              </div>

              <div className="rounded-md border border-line bg-surface p-2.5 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  1. Định danh Via & Hồ sơ Chrome
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <div className="col-span-2 rounded border border-line bg-surface-muted px-2 py-1.5 font-semibold text-ink truncate">
                    {selectedViaLabel || 'Via Chính'}
                  </div>
                  <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-xs font-semibold text-ink">
                    {shortFolder}
                  </div>
                </div>

                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted pt-1">
                  2. Cấu hình Proxy riêng (IP:Port:User:Pass)
                </div>
                <div className="rounded border border-line bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-ink truncate">
                  {parsedProxy
                    ? `${parsedProxy.host}:${parsedProxy.port}${parsedProxy.user ? `:${parsedProxy.user}:••••` : ''}`
                    : proxyInput || 'Chưa gắn Proxy (Dùng mạng gốc)'}
                </div>

                <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[11px]">
                  <span className="text-ink-muted">IP Public thực tế:</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {parsedProxy ? parsedProxy.host : 'Tự động kiểm tra khi mở'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  3. Lối tắt xử lý nhanh trên đúng Via này
                </div>
                <a
                  href="https://business.facebook.com/accountquality"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded border border-danger-line bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger-text hover:opacity-90"
                >
                  <span>Chất lượng tài khoản & Kháng nghị Meta</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <a
                  href="https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded border border-brand/30 bg-brand-light px-2.5 py-1.5 text-xs font-semibold text-brand-text hover:opacity-90"
                >
                  <span>Thanh toán & Xử lý dư nợ (Billing)</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <a
                  href="https://business.facebook.com/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
                >
                  <span>Cài đặt Business Manager (BM Settings)</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <a
                  href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
                >
                  <span>Trình quản lý Quảng cáo (Ads Manager)</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* QUICK NAVIGATION CARDS */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Link to="/facebook-accounts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <UserRoundCog className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Tài khoản FB (Via) →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Gán Hồ sơ Chrome cố định & Proxy IPv4 cho từng Via.</p>
        </Link>
        <Link to="/business-managers" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Business Manager →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Theo dõi hạn mức BM1 / BM5 / BM10 (Đã XMDN) & đồng bộ Meta.</p>
        </Link>
        <Link to="/accounts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Tài khoản Quảng cáo →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Kiểm tra chi tiêu, trạng thái Meta & hạn mức 1 Thẻ ≤ 3 TKQC.</p>
        </Link>
        <Link to="/assets?tab=proxy-references" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <Layers className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Kho Proxy & Thẻ →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Quản lý danh sách Proxy IPv4 Dân cư tĩnh và Phương thức thanh toán.</p>
        </Link>
      </div>
    </div>
  )
}
