import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { Paged, ReferenceRecord } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import {
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadChromeExtensionPackageBat,
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
      {/* HERO BANNER — GIỚI THIỆU WEBSITE & TIỆN ÍCH CHROME */}
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Nền tảng Quản trị Quảng cáo Meta & Tiện ích Chrome</Badge>
              <Badge tone="positive">Chuẩn Manifest V3 · Tích hợp Proxy Tự động</Badge>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">
              AdsOps Control Center & Tiện ích Google Chrome («AdsOps Hộ Chiếu Via»)
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              Hệ thống trung tâm giúp bạn <strong>quản lý dàn 20+ Business Manager (BM) và hàng chục Tài khoản quảng cáo (TKQC)</strong> từ A–Z trên một màn hình duy nhất, kết hợp với <strong>Tiện ích Google Chrome chuyên dụng</strong> để tự động cách ly từng Via vào đúng Hồ sơ trình duyệt thật kèm Proxy riêng — chống chết dàn (liên đới) tuyệt đối.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() =>
                launchChromeWithExtensionPreview(
                  'https://business.facebook.com/overview',
                  selectedProfile,
                  selectedViaLabel,
                  proxyInput,
                )
              }
            >
              🚀 Mở Chrome & Xem Ngay Tiện Ích
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadChromeExtensionPackageBat(selectedViaLabel, shortFolder, proxyInput)}
            >
              📦 Tải Tiện Ích Chrome (.bat ra Desktop)
            </Button>
          </div>
        </div>

        {/* 4 TRỤ CỘT: DÙNG ĐỂ LÀM GÌ & TẬN DỤNG TRONG VIỆC GÌ */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted/50 p-3.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-brand-text">
              1. Tận dụng Quản lý Đa BM & Chi tiêu
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">
              Kết nối <strong>BM Trung tâm (Partner)</strong> để tự động đồng bộ chi tiêu (<em>Hôm nay, 7 Ngày, Tháng này</em>) và trạng thái sống/chết của <strong>toàn bộ BM & TKQC</strong> về một bảng mà không cần đăng nhập vào từng Via để xem.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/50 p-3.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              2. Tận dụng Cách ly Via & Chống chết dàn
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">
              Áp dụng quy chuẩn <strong>1 Hồ sơ Chrome = 1 Via = 1 Proxy</strong>. Khi TKQC bị vô hiệu hoá hoặc nợ bill, bấm <strong>🚀 Mở Chrome</strong> là máy tự mở đúng trình duyệt của <strong>Via dự phòng</strong> để kháng nghị/thanh toán ngay.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/50 p-3.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              3. Tận dụng Tiện ích Chrome Hộ Chiếu Via
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">
              Tiện ích nằm ngay góc phải Google Chrome: hiển thị <strong>Tên Via đang mở</strong>, tự động nạp <strong>Proxy IP:Port:User:Pass</strong> không cần gõ mật khẩu, kiểm tra <strong>IP thật</strong> và có sẵn <strong>5 nút kháng nghị / thanh toán 1 chạm</strong>.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/50 p-3.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-400">
              4. Tận dụng Canh 4 Hạn mức Vàng Meta
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">
              Tự động đếm và cảnh báo màu khi vượt ngưỡng: <strong>1 Via ≤ 2 BM gốc</strong> · <strong>BM XMDN (1 → 10 → 30+ TKQC)</strong> · <strong>1 Thẻ Visa/Master ≤ 3 TKQC</strong> (chống bão thẻ) · <strong>1 Proxy ≤ 2 Via</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* KHU VỰC TRÌNH TẠO TIỆN ÍCH & MÔ PHỎNG SỐNG ĐỘNG TRÊN CHROME */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* CỘT TRÁI (7 CỘT): CẤU HÌNH & KÍCH HOẠT TIỆN ÍCH CHROME */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>🧩 Trình Kích Hoạt & Cài Đặt Tiện Ích Google Chrome</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-brand/30 bg-brand-soft/15 p-3 text-xs text-ink">
              <strong>Vì sao trước đó bạn chưa nhìn thấy biểu tượng Tiện ích trên Chrome?</strong>
              <p className="mt-1 text-ink-muted">
                Mặc định Google Chrome giấu các tiện ích mới vào bên trong biểu tượng <strong>Mảnh ghép (🧩 Tiện ích)</strong> ở góc trên bên phải trình duyệt. Khi bạn bấm nút <strong>«🚀 Mở Chrome & Hiển Thị Ngay Tiện Ích»</strong> bên dưới, hệ thống sẽ vừa nạp tiện ích vào Chrome vừa <strong>bật sẵn giao diện Tiện ích lên một tab trực quan</strong> để bạn thấy ngay lập tức!
              </p>
            </div>

            {vias.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink">
                  1. Chọn nhanh từ Tài khoản Facebook (Via) đã khai báo của bạn:
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
                        <div>👤 {lbl}</div>
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
                  Tên định danh Via hiển thị trên Tiện ích:
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
                Proxy gắn vào Tiện ích (Định dạng <code>IP:Port:User:Pass</code> hoặc tên nhà mạng):
              </label>
              <input
                id="ext-proxy-str"
                className="input font-mono text-xs"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder="VD: 103.145.67.89:8080:myuser:mypass"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="font-semibold text-ink-muted">Mua Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):</span>
                <a href="https://proxyvn.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:underline">
                  🛒 ProxyVN.vn ↗
                </a>
                <a href="https://zingproxy.com/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:underline">
                  🛒 ZingProxy.com ↗
                </a>
                <a href="https://muaproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:underline">
                  🛒 MuaProxy.vn ↗
                </a>
                <a href="https://vproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:underline">
                  🛒 VProxy.vn ↗
                </a>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Button
                type="button"
                onClick={() =>
                  launchChromeWithExtensionPreview(
                    'https://business.facebook.com/overview',
                    selectedProfile,
                    selectedViaLabel,
                    proxyInput,
                  )
                }
              >
                🚀 Mở Chrome & Hiển Thị Ngay Tiện Ích
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadChromeExtensionPackageBat(selectedViaLabel, shortFolder, proxyInput)}
              >
                📦 Tải Gói Tiện Ích (.bat ra Desktop)
              </Button>

              {parsedProxy && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => downloadSwitchyOmegaConfig(proxyInput, selectedViaLabel)}
                >
                  🔌 Xuất File SwitchyOmega (.bak)
                </Button>
              )}
            </div>

            {/* HƯỚNG DẪN GHIM TIỆN ÍCH LÊN THANH CÔNG CỤ CHROME */}
            <div className="rounded-lg border border-line bg-surface-muted p-3.5 space-y-2">
              <div className="text-xs font-extrabold text-ink">
                📌 Cách ghim biểu tượng «🛡️ AdsOps Hộ Chiếu Via» ra ngoài góc phải Chrome (Chỉ làm 1 lần):
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-ink-muted">
                <li>
                  Bấm nút <strong>🚀 Mở Chrome & Hiển Thị Ngay Tiện Ích</strong> ở trên (Thư mục tiện ích cũng đã được tạo sẵn trên máy của bạn tại <code>Desktop\AdsOps_Tien_Ich_Chrome</code>).
                </li>
                <li>
                  Trên góc trên bên phải cửa sổ Google Chrome vừa mở, bấm vào biểu tượng <strong>Mảnh ghép 🧩 (Tiện ích / Extensions)</strong>.
                </li>
                <li>
                  Bấm vào nút <strong>Ghim 📌 (Pin)</strong> bên cạnh dòng <strong>AdsOps Companion · {shortFolder}</strong> — biểu tượng huy hiệu xanh <strong><code>{parsedProxy ? 'PRX' : shortFolder.replace('Profile ', 'P').slice(0, 3).toUpperCase()}</code></strong> sẽ hiện cố định trên thanh công cụ Chrome!
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* CỘT PHẢI (5 CỘT): MÔ PHỎNG TRỰC QUAN POPUP TIỆN ÍCH CHROME */}
        <div className="lg:col-span-5 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            👁️ Bản Xem Trước Trực Tiếp Giao Diện Tiện Ích Trên Chrome (Live Preview):
          </div>

          <div className="mx-auto w-full max-w-[360px] rounded-xl border-2 border-slate-300 bg-[#f8fafc] p-4 text-[#0f172a] shadow-lg">
            {/* Chrome Toolbar Mockup */}
            <div className="mb-3 flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
              <span className="truncate font-mono">🔒 business.facebook.com</span>
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-900">
                🧩 <span className={`rounded px-1 text-[10px] text-white ${parsedProxy ? 'bg-green-600' : 'bg-blue-600'}`}>
                  {parsedProxy ? 'PRX' : shortFolder.replace('Profile ', 'P').slice(0, 3).toUpperCase()}
                </span>
              </span>
            </div>

            {/* Popup Header */}
            <div className="flex items-center justify-between border-b border-slate-300 pb-2.5 mb-2.5">
              <div className="text-[13px] font-extrabold text-slate-900">🛡️ AdsOps Hộ Chiếu Via</div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  parsedProxy
                    ? 'border-green-300 bg-green-100 text-green-800'
                    : 'border-blue-300 bg-blue-100 text-blue-800'
                }`}
              >
                {parsedProxy ? '🟢 ĐÃ BỌC PROXY' : '🔵 CHROME CỐ ĐỊNH'}
              </span>
            </div>

            {/* Card 1: Via & Chrome Profile */}
            <div className="rounded-lg border border-slate-300 bg-white p-2.5 mb-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Tài khoản Via & Hồ sơ Chrome
              </div>
              <div className="mt-0.5 text-[13px] font-bold text-slate-950">{selectedViaLabel || 'Via Chính'}</div>
              <div className="mt-0.5 text-[11px] text-slate-700">
                📁 Thư mục Chrome: <strong>{shortFolder}</strong>
              </div>
            </div>

            {/* Card 2: Proxy / Network */}
            <div className="rounded-lg border border-slate-300 bg-white p-2.5 mb-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Kết nối Mạng / Proxy
              </div>
              <div className="mt-0.5 text-[12px] font-bold text-slate-900 break-all">
                {parsedProxy
                  ? `${parsedProxy.scheme.toUpperCase()}://${parsedProxy.host}:${parsedProxy.port}${
                      parsedProxy.user ? ' (Đã tự nạp User/Pass)' : ''
                    }`
                  : proxyInput || 'Mạng trực tiếp (Chưa gắn Proxy)'}
              </div>
              <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-slate-200 pt-1.5 text-[11px]">
                <span className="text-slate-600">IP Public hiện tại:</span>
                <span className="font-mono font-bold text-teal-700">
                  {parsedProxy ? parsedProxy.host : 'Tự động kiểm tra khi mở'}
                </span>
              </div>
            </div>

            {/* 5 Quick Action Buttons */}
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Lối tắt xử lý nhanh Meta trên đúng Via này
            </div>
            <div className="space-y-1.5">
              <a
                href="https://business.facebook.com/accountquality"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-800 hover:bg-red-100"
              >
                <span>🛡️ Chất lượng TK & Kháng nghị Meta</span>
                <span>↗</span>
              </a>
              <a
                href="https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-blue-300 bg-blue-50 px-2.5 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100"
              >
                <span>💳 Thanh toán & Xử lý Dư nợ (Billing)</span>
                <span>↗</span>
              </a>
              <a
                href="https://business.facebook.com/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
              >
                <span>🏢 Cài đặt Business Manager (BM)</span>
                <span>↗</span>
              </a>
              <a
                href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
              >
                <span>📊 Trình quản lý Quảng cáo (Ads Manager)</span>
                <span>↗</span>
              </a>
              <a
                href="https://iphey.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
              >
                <span>🔍 Kiểm tra độ sạch IP & Vân tay máy (Iphey)</span>
                <span>↗</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* LIÊN KẾT NHANH ĐẾN CÁC PHÂN HỆ TRONG HỆ THỐNG */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Link to="/facebook-accounts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand">
          <div className="text-xs font-bold text-brand-text">👤 Quản lý Tài khoản FB (Via) →</div>
          <p className="mt-1 text-[11px] text-ink-muted">Gán Hồ sơ Chrome cố định & Proxy IPv4 cho từng Via.</p>
        </Link>
        <Link to="/business-managers" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand">
          <div className="text-xs font-bold text-brand-text">🏢 Quản lý Business Manager →</div>
          <p className="mt-1 text-[11px] text-ink-muted">Theo dõi hạn mức BM1 / BM5 / BM10 (Đã XMDN) & đồng bộ Meta.</p>
        </Link>
        <Link to="/accounts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand">
          <div className="text-xs font-bold text-brand-text">💳 Quản lý Tài khoản Quảng cáo →</div>
          <p className="mt-1 text-[11px] text-ink-muted">Kiểm tra chi tiêu, trạng thái Meta & hạn mức 1 Thẻ ≤ 3 TKQC.</p>
        </Link>
        <Link to="/alerts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand">
          <div className="text-xs font-bold text-brand-text">🔔 Cảnh báo & Kháng nghị nhanh →</div>
          <p className="mt-1 text-[11px] text-ink-muted">Phát hiện TKQC bị vô hiệu hoá & bấm 1 chạm mở đúng Chrome xử lý.</p>
        </Link>
      </div>
    </div>
  )
}
