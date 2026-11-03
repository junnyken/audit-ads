import { useMemo, useState } from 'react'
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
  Sparkles,
  UserRoundCog,
} from 'lucide-react'
import { api } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'

interface IdentitySummary {
  id: string
  business_manager_count: number
  ad_account_count: number
}
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import {
  type ExtensionBundledAccount,
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadChromeExtensionZip,
  downloadSwitchyOmegaConfig,
  fetchRealLocalChromeProfiles,
  launchChromeWithExtensionPreview,
  launchInAssignedChromeProfile,
  parseProxyString,
} from '../lib/chromeProfileLauncher'

function formatVnd(raw?: string | number | null, currency = 'VND'): string {
  const n = Number(raw ?? 0) || 0
  if (currency === 'USD') {
    return `${n.toLocaleString('en-US')} USD`
  }
  return `${n.toLocaleString('vi-VN')} ₫`
}

export default function ChromeExtensionPage() {
  const viasQuery = useQuery({
    queryKey: ['personal-account-references', 'ext-page'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=100'),
  })
  const summaryQuery = useQuery({
    queryKey: ['facebook-identities-summary', 'ext-page'],
    queryFn: () => api.get<IdentitySummary[]>('/api/v1/facebook-identities/summary'),
  })
  const accountsQuery = useQuery({
    queryKey: ['ad-accounts', 'ext-page'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=100'),
  })
  const localChrome = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    initialData: WORKSTATION_REAL_CHROME_PROFILES,
    retry: false,
  })

  const vias = viasQuery.data?.items ?? []
  const summaries = summaryQuery.data ?? []
  const allAccounts = accountsQuery.data?.items ?? []

  const summaryById = useMemo(() => {
    const map = new Map<string, IdentitySummary>()
    if (Array.isArray(summaries)) {
      for (const s of summaries) {
        if (s && s.id) {
          map.set(String(s.id), s)
        }
      }
    }
    return map
  }, [summaries])

  const [selectedViaId, setSelectedViaId] = useState<string>('')
  const [selectedViaLabel, setSelectedViaLabel] = useState('Tài Khoản Chính')
  const [selectedProfile, setSelectedProfile] = useState('Chrome — Default · trieu (thientrieu753@gmail.com)')
  const [proxyInput, setProxyInput] = useState('')

  const parsedProxy = parseProxyString(proxyInput)
  const shortFolder = selectedProfile.includes('Profile ')
    ? selectedProfile.match(/Profile\s+\d+/i)?.[0] ?? 'Default'
    : 'Default'

  // Accounts linked to the currently selected Via (fallback to all accounts if Tài Khoản Chính or none matched)
  const viaAccounts = useMemo(() => {
    if (!Array.isArray(allAccounts) || !allAccounts.length) return []
    const selLower = String(selectedViaLabel || '').toLowerCase()
    const matched = allAccounts.filter((acc) =>
      Array.isArray(acc?.facebook_identities) &&
      acc.facebook_identities.some((fid) => {
        const fidLabel = String(fid?.label || '').toLowerCase()
        return (
          (selectedViaId && fid?.id === selectedViaId) ||
          (fidLabel && (fidLabel === selLower || selLower.includes(fidLabel)))
        )
      }),
    )
    return matched.length > 0 ? matched : allAccounts
  }, [allAccounts, selectedViaId, selectedViaLabel])

  const kpiStats = useMemo(() => {
    let active = 0
    let restricted = 0
    let disabled = 0
    let totalDebtVnd = 0
    for (const a of viaAccounts) {
      if (a.status === 'active') active++
      else if (a.status === 'restricted') restricted++
      else disabled++
      const bal = Number(a.billing_meta?.balance_raw ?? a.spend_periods?.balance_raw ?? 0) || 0
      if ((a.currency || 'VND') !== 'USD') {
        totalDebtVnd += bal
      }
    }
    return { active, restricted, disabled, totalDebtVnd }
  }, [viaAccounts])

  const bundledForZip: ExtensionBundledAccount[] = useMemo(
    () =>
      viaAccounts.map((a) => ({
        name: a.display_name,
        external_account_id: a.external_account_id || '',
        status: a.status,
        currency: a.currency || 'VND',
        balance_raw: a.billing_meta?.balance_raw ?? a.spend_periods?.balance_raw ?? '0',
        billing_threshold_raw: a.billing_meta?.billing_threshold_raw ?? null,
        next_bill_date: a.billing_meta?.next_bill_date ?? null,
        meta_daily_limit_raw: a.billing_meta?.meta_daily_limit_raw ?? null,
        payment_card_display: a.billing_meta?.payment_card_display ?? null,
        business_legal_name: a.billing_meta?.business_legal_name ?? null,
        bm_name: a.business_manager_name ?? null,
      })),
    [viaAccounts],
  )

  return (
    <div className="space-y-6">
      {/* HERO BANNER */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Tiện ích Google Chrome chính thức · v2.2</Badge>
              <Badge tone="positive">Chuẩn Manifest V3 · Tích hợp Quản lý TKQC & Billing</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink">
              Trung tâm Tiện ích Google Chrome («AdsOps Companion»)
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              Khi mở Tiện ích <strong>AdsOps Companion</strong> trên góc phải Google Chrome, tiện ích hiển thị trực tiếp <strong>Danh sách TKQC thuộc Via đó</strong> (kèm <strong>Dư nợ, Ngưỡng thanh toán, Giới hạn chi tiêu ngày, Thẻ Visa/Mastercard, Trạng thái sống/chết</strong>), tự động định danh Hồ sơ Chrome, kiểm tra IP Public thật và bọc Proxy IPv4 riêng cho từng Via.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => downloadChromeExtensionZip(selectedViaLabel, shortFolder, proxyInput, bundledForZip)}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>Tải Gói Tiện Ích Đã Kèm Dữ Liệu TKQC (.zip)</span>
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
              Mở Chrome & Xem Tiện Ích Ngay
            </Button>
          </div>
        </div>

        {/* 4 PILLARS OF WHAT THE EXTENSION SHOWS */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <CreditCard className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>1. Bảng Dư nợ, Ngưỡng & Thẻ TKQC</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Hiển thị ngay trong Popup danh sách TKQC của Via: <strong>Dư nợ hiện tại, Số dư đạt (Ngưỡng), Ngày TT, Giới hạn ngày (DSL)</strong> và mã <strong>Thẻ Visa/Mastercard</strong>.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <UserRoundCog className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>2. Định danh Via & Hồ sơ Chrome</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Mỗi Profile Chrome gắn cố định 1 Via. Nhìn góc phải trình duyệt biết ngay đang cầm Via nào, nắm bao nhiêu BM & TKQC, chống đăng nhập nhầm nick.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Sparkles className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>3. Tự bắt ID & Đọc Billing Meta</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Khi mở tab Facebook / Billing Hub, tự động tách <code>act_id</code>, <code>business_id</code> và hỗ trợ mở nhanh trang Thanh toán / Kháng nghị của từng TKQC.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>4. Bọc Proxy IPv4 & Kiểm tra IP thật</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Nhập <code>IP:Port:User:Pass</code> để bọc Proxy riêng cho Profile Chrome đó (tự điền mật khẩu ngầm) và kiểm tra IP Public thực tế ngay lập tức.
            </p>
          </div>
        </div>
      </div>

      {/* GENERATOR + LIVE PREVIEW */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle>Đóng gói Tiện ích Chrome (.zip) theo từng Via & Hồ sơ Chrome</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vias.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink">
                  1. Chọn Tài khoản Facebook (Via) để nạp sẵn danh sách BM & TKQC vào Tiện ích:
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {vias.map((v) => {
                    const lbl = String(v.label ?? '')
                    const prof = String(v.browser_profile_label ?? 'Chrome — Default · trieu (thientrieu753@gmail.com)')
                    const net = String(v.network_label ?? '')
                    const sum = summaryById.get(v.id)
                    const bmCount = sum?.business_manager_count ?? 0
                    const adCount = sum?.ad_account_count ?? 0
                    const active = selectedViaLabel === lbl
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedViaId(v.id)
                          setSelectedViaLabel(lbl)
                          setSelectedProfile(prof)
                          setProxyInput(net)
                        }}
                        className={`rounded-lg border p-2.5 text-left text-xs transition ${
                          active
                            ? 'border-brand bg-brand-light text-brand-text ring-1 ring-brand/30'
                            : 'border-line bg-surface hover:bg-surface-muted text-ink'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold truncate">{lbl}</span>
                          <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">
                            {bmCount} BM · {adCount} TKQC
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-ink-muted">{prof}</div>
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
                  placeholder="VD: Tài Khoản Chính"
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
                Cấu hình Proxy IPv4 riêng (<code>IP:Port:User:Pass</code> — để trống nếu dùng Mạng gốc):
              </label>
              <input
                id="ext-proxy-str"
                className="input font-mono text-xs"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder="Để trống = Mạng gốc · Hoặc nhập VD: 103.145.67.89:8080:user:pass"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="font-semibold text-ink-muted">Mua & Quản lý Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):</span>
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
                onClick={() => downloadChromeExtensionZip(selectedViaLabel, shortFolder, proxyInput, bundledForZip)}
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
                  Bấm <strong>Tải Tiện Ích Chrome Đã Cấu Hình (.zip)</strong> ở trên rồi giải nén ra một thư mục cố định.
                </li>
                <li>
                  Trên cửa sổ Chrome của Via, truy cập <strong><code>chrome://extensions</code></strong> và bật công tắc <strong>Chế độ dành cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải.
                </li>
                <li>
                  Bấm nút <strong>Tải tiện ích đã giải nén (Load unpacked)</strong> ở góc trên bên trái → chọn thư mục vừa giải nén.
                </li>
                <li>
                  Bấm biểu tượng <strong>Mảnh ghép Tiện ích</strong> trên góc phải Chrome → bấm <strong>Ghim (Pin)</strong> cạnh <strong>AdsOps Companion</strong> để mở bảng quản lý TKQC bất kỳ lúc nào.
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* LIVE EXTENSION POPUP PREVIEW WITH REAL AD ACCOUNTS */}
        <div className="lg:col-span-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Bản xem trước trực tiếp khi mở Tiện ích trên Chrome ({selectedViaLabel}):
            </span>
            <Badge tone="info">{viaAccounts.length} TKQC thật được nạp sẵn</Badge>
          </div>

          <div className="mx-auto w-full max-w-[460px] rounded-xl border border-line bg-surface p-4 shadow-md">
            {/* Mock Browser URL bar */}
            <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-surface-muted px-3 py-1.5 text-xs">
              <span className="font-mono text-ink-muted truncate">business.facebook.com/billing_hub/accounts</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-brand-text">
                <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                <span className={`rounded px-1.5 py-0.5 text-[10px] text-white ${parsedProxy ? 'bg-emerald-700' : 'bg-blue-700'}`}>
                  {parsedProxy ? 'PRX' : shortFolder.replace('Profile ', 'P').slice(0, 3).toUpperCase()}
                </span>
              </span>
            </div>

            {/* Actual Extension Popup UI */}
            <div className="rounded-lg border border-line bg-canvas p-3.5 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[11px] font-extrabold text-brand-fg">
                    AO
                  </span>
                  <div>
                    <div className="text-xs font-extrabold text-ink">AdsOps Companion · Quản lý TKQC</div>
                    <div className="text-[10px] text-ink-muted">Hồ sơ: {shortFolder} · Via: {selectedViaLabel}</div>
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    parsedProxy
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                      : 'border-brand/40 bg-brand-light text-brand-text'
                  }`}
                >
                  {parsedProxy ? '🛡️ ĐANG BỌC PROXY' : '🌐 MẠNG GỐC'}
                </span>
              </div>

              {/* Section 1: KPI Summary of Via's Ad Accounts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  <span>1. Tổng quan Sức khỏe & Dư nợ TKQC của Via này</span>
                  <span className="font-mono text-brand-text">{viaAccounts.length} TKQC</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-line bg-surface p-2">
                    <div className="text-[10px] text-ink-muted">Đang hoạt động</div>
                    <div className="mt-0.5 font-mono text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                      {kpiStats.active} TK
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-2">
                    <div className="text-[10px] text-ink-muted">Nợ cước / Đã đóng</div>
                    <div className="mt-0.5 font-mono text-sm font-extrabold text-amber-600 dark:text-amber-400">
                      {kpiStats.restricted} / {kpiStats.disabled}
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-2">
                    <div className="text-[10px] text-ink-muted">Tổng dư nợ hiện tại</div>
                    <div className="mt-0.5 font-mono text-xs font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">
                      {formatVnd(kpiStats.totalDebtVnd, 'VND')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Real-time Ad Account List inside the Extension Popup */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  <span>2. Chi tiết Dư nợ, Ngưỡng, GH ngày & Thẻ từng TKQC</span>
                  <span className="text-[10px] font-normal text-ink-faint">Cuộn để xem hết</span>
                </div>
                <div className="max-h-[250px] space-y-1.5 overflow-y-auto pr-1">
                  {viaAccounts.map((acc) => {
                    const bm = acc.billing_meta
                    const curr = acc.currency || 'VND'
                    const bal = bm?.balance_raw ?? acc.spend_periods?.balance_raw ?? '0'
                    const numBal = Number(bal) || 0
                    const thresh = bm?.billing_threshold_raw
                    const nextDate = bm?.next_bill_date
                    const dsl = bm?.meta_daily_limit_raw
                    const card = bm?.payment_card_display
                    const biz = bm?.business_legal_name
                    const actRaw = (acc.external_account_id || '').replace(/^act_/i, '')
                    const billUrl = `https://business.facebook.com/billing_hub/accounts/details?act=${encodeURIComponent(actRaw)}`
                    const adsUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actRaw)}`

                    return (
                      <div
                        key={acc.id}
                        className="rounded-md border border-line bg-surface p-2 text-[11px] space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-ink truncate">
                            {acc.display_name}{' '}
                            <span className="font-mono text-[10px] font-normal text-ink-muted">({actRaw})</span>
                          </div>
                          <Badge
                            tone={
                              acc.status === 'active'
                                ? 'positive'
                                : acc.status === 'restricted'
                                  ? 'caution'
                                  : 'attention'
                            }
                          >
                            {acc.status === 'active'
                              ? 'Hoạt động'
                              : acc.status === 'restricted'
                                ? 'Có dư nợ'
                                : 'Đã đóng'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1 text-[10.5px]">
                          <span>
                            <span className="text-ink-muted">Dư nợ: </span>
                            <strong
                              className={`font-mono ${
                                numBal > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-ink'
                              }`}
                            >
                              {formatVnd(bal, curr)}
                            </strong>
                            {thresh ? (
                              <span className="text-ink-muted">
                                {' '}
                                / Ngưỡng: <strong className="font-mono text-ink">{formatVnd(thresh, curr)}</strong>
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono font-semibold text-brand-text">
                            {card ? `💳 ${card}` : 'Chưa gắn thẻ'}
                          </span>
                        </div>

                        {(nextDate || dsl) && (
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-ink-muted">
                            {nextDate ? <span>📅 Ngày TT: <strong className="text-ink">{nextDate}</strong></span> : <span />}
                            {dsl ? <span>⚡ GH ngày: <strong className="font-mono text-ink">{formatVnd(dsl, curr)}</strong></span> : null}
                          </div>
                        )}

                        <div className="flex items-center justify-between border-t border-dashed border-line/70 pt-1 text-[10px]">
                          <span className="truncate text-ink-muted max-w-[230px]">
                            {biz ? `🏢 ${biz}` : `BM: ${acc.business_manager_name || 'Meta'}`}
                          </span>
                          <div className="flex items-center gap-2 font-semibold">
                            <button
                              type="button"
                              onClick={() =>
                                launchInAssignedChromeProfile(billUrl, selectedProfile, selectedViaLabel, proxyInput)
                              }
                              className="text-brand-text hover:underline"
                            >
                              Billing ↗
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                launchInAssignedChromeProfile(adsUrl, selectedProfile, selectedViaLabel, proxyInput)
                              }
                              className="text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                              Ads ↗
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Section 3: Environment & Proxy status */}
              <div className="rounded-md border border-line bg-surface p-2.5 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    3. Môi trường Mạng & Proxy của Hồ sơ {shortFolder}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {parsedProxy ? `Proxy: ${parsedProxy.host}:${parsedProxy.port}` : '🌐 Mạng gốc (Chưa gắn Proxy riêng)'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <a
                    href="https://business.facebook.com/accountquality"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded border border-danger-line bg-danger-soft px-2 py-1 text-[11px] font-semibold text-danger-text hover:opacity-90"
                  >
                    <span>🛡️ Kháng nghị Meta</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                  <a
                    href="https://business.facebook.com/billing_hub/accounts"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded border border-brand/30 bg-brand-light px-2 py-1 text-[11px] font-semibold text-brand-text hover:opacity-90"
                  >
                    <span>💳 Billing Hub Meta</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
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
