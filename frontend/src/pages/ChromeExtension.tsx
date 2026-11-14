import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Layers,
  Play,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRoundCog,
} from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import {
  type ExtensionBundledAccount,
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadAllViasExtensionsBundleZip,
  downloadChromeExtensionZip,
  resolveChromeProfileDirectory,
  downloadSwitchyOmegaConfig,
  downloadWindowsChromeLauncherBat,
  fetchRealLocalChromeProfiles,
  launchChromeWithExtensionPreview,
  launchInAssignedChromeProfile,
  parseProxyString,
} from '../lib/chromeProfileLauncher'

interface IdentitySummary {
  id: string
  label: string
  business_manager_count: number
  ad_account_count: number
}

const LEGACY_MOCK_NETWORKS = [
  'vnpt static ip — line #',
  'fpt static ip — line #',
  'viettel residential — line #',
  'mobile 4g/5g vn — line #',
]

function cleanRealProxy(val?: unknown): string {
  const s = String(val ?? '').trim()
  if (!s) return ''
  const lower = s.toLowerCase()
  if (LEGACY_MOCK_NETWORKS.some((p) => lower.startsWith(p))) return ''
  return s
}

function extractBase32Secret(vaultRef?: unknown): string {
  const raw = String(vaultRef ?? '').trim()
  if (!raw || raw.startsWith('meta-user://') || raw.startsWith('http')) return ''
  const stripped = raw.replace(/^2fa:\/\//i, '').replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z2-7]{12,128}$/.test(stripped) ? stripped : ''
}

function inferTierFromVia(notesRaw: unknown, labelRaw: unknown, bmCount: number, adCount: number): 'vault' | 'camp' | 'standby' {
  const notes = String(notesRaw ?? '')
  const m = notes.match(/\[TIER:(vault|camp|standby)\]/i)
  if (m) return m[1].toLowerCase() as 'vault' | 'camp' | 'standby'
  const lbl = String(labelRaw ?? '').toLowerCase()
  if (bmCount >= 3 || lbl.includes('chính') || lbl.includes('tổng')) return 'vault'
  if (adCount === 0 || lbl.includes('mới') || lbl.includes('via 3')) return 'standby'
  return 'camp'
}

function base32ToBytes(b32: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (let i = 0; i < b32.length; i++) {
    const idx = alphabet.indexOf(b32[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

async function generateTotpCode(secretBase32: string): Promise<string> {
  const keyBytes = base32ToBytes(secretBase32)
  if (!keyBytes.length) return ''
  const epochSec = Math.floor(Date.now() / 1000)
  const counter = Math.floor(epochSec / 30)
  const counterBytes = new Uint8Array(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await window.crypto.subtle.sign('HMAC', cryptoKey, counterBytes as unknown as BufferSource))
  const offset = sig[sig.length - 1] & 0x0f
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function fmtMoney(raw: string | number | null | undefined, currency?: string | null): string {
  const n = Number(raw ?? 0) || 0
  if ((currency || 'VND') === 'USD') return `${n.toLocaleString('en-US')} USD`
  return `${n.toLocaleString('vi-VN')} ₫`
}

export default function ChromeExtension() {
  const { language } = useI18n()
  void language
  const viasQuery = useQuery({
    queryKey: ['personal-account-references', 'ext-page'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=100'),
  })

  const summaryQuery = useQuery({
    queryKey: ['facebook-identities', 'summary-ext'],
    queryFn: () => api.get<IdentitySummary[]>('/api/v1/facebook-identities/summary'),
  })

  const accountsQuery = useQuery({
    queryKey: ['ad-accounts', 'ext-page'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const localChrome = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    staleTime: 60_000,
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
  const [viaTier, setViaTier] = useState<'vault' | 'camp' | 'standby'>('vault')
  const [twoFaInput, setTwoFaInput] = useState('')
  const [proxyInput, setProxyInput] = useState('')
  const [liveOtp, setLiveOtp] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(30)
  const [copiedOtp, setCopiedOtp] = useState(false)
  const twoFaInputRef = useRef<HTMLInputElement | null>(null)
  const didInitRef = useRef(false)

  // Initialize from real database record on first load
  useEffect(() => {
    if (didInitRef.current || vias.length === 0) return
    didInitRef.current = true
    const preferred =
      vias.find((v) => String(v.label ?? '').toLowerCase().includes('chính')) ?? vias[0]
    if (preferred) {
      const sum = summaryById.get(preferred.id)
      const bmCount = sum?.business_manager_count ?? 0
      const adCount = sum?.ad_account_count ?? 0
      setSelectedViaId(preferred.id)
      setSelectedViaLabel(String(preferred.label ?? 'Tài Khoản Chính'))
      if (preferred.browser_profile_label) {
        setSelectedProfile(String(preferred.browser_profile_label))
      }
      setProxyInput(cleanRealProxy(preferred.network_label))
      setTwoFaInput(extractBase32Secret(preferred.vault_reference))
      setViaTier(inferTierFromVia(preferred.notes, preferred.label, bmCount, adCount))
    }
  }, [vias, summaryById])

  // Live 2FA OTP ticker when twoFaInput has a valid Base32 secret
  useEffect(() => {
    const clean = extractBase32Secret(twoFaInput)
    if (!clean) {
      setLiveOtp('')
      return
    }
    let mounted = true
    const tick = async () => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30)
      if (mounted) setSecondsLeft(rem)
      try {
        const code = await generateTotpCode(clean)
        if (mounted) setLiveOtp(code)
      } catch {
        if (mounted) setLiveOtp('')
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [twoFaInput])

  const parsedProxy = parseProxyString(proxyInput)
  const shortFolder = selectedProfile.includes('Profile ')
    ? selectedProfile.match(/Profile\s+\d+/i)?.[0] ?? 'Default'
    : 'Default'

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
              <Badge tone="info">Tiện ích Google Chrome chính thức · v2.8 Pro (Đảo Ấm Sinh Học Đa Lộ Trình + Bắt Bệnh Văng Cookie + Full Auto-Pilot)</Badge>
              <Badge tone="positive">Manifest V3 · Chặn &amp; Tự Xoá Passkey 1 Chạm + 2FA Tự Điền + Khóa WebRTC</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink">
              Trung tâm Tiện ích Google Chrome («AdsOps Companion Pro»)
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              Đóng gói riêng file <code>.zip</code> cho từng Hồ sơ Chrome của Via: tích hợp sẵn <strong>Danh sách TKQC &amp; Dư nợ thật</strong>, <strong>Bộ lấy mã 2FA 6 số &amp; Tự điền vào Facebook</strong>, <strong>Khóa chống rò rỉ IP thật qua WebRTC</strong>, <strong>Xuất/Nạp Cookie &amp; Bắt Token EAAB</strong> <strong>Full Auto-Pilot Tạo Fanpage giãn nhịp an toàn (tự bấm + tự dừng nếu gặp Checkpoint/CAPTCHA)</strong> cùng <strong>Thanh HUD cảnh báo Lớp Via</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() =>
                downloadChromeExtensionZip(
                  selectedViaLabel,
                  shortFolder,
                  proxyInput,
                  bundledForZip,
                  twoFaInput,
                  viaTier,
                )
              }
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>Tải Gói Tiện Ích v2.8 (.zip) Cho {selectedViaLabel}</span>
            </Button>
            {vias.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300 font-bold"
                onClick={() => {
                  const specs = vias.map((v) => {
                    const vLbl = String(v.label ?? 'Via')
                    const vLblLow = vLbl.toLowerCase()
                    const vSum = summaryById.get(v.id)
                    const folder = resolveChromeProfileDirectory(
                      String(v.browser_profile_label ?? ''),
                      vLbl,
                    )
                    const matchedAccs = allAccounts.filter(
                      (acc) =>
                        Array.isArray(acc?.facebook_identities) &&
                        acc.facebook_identities.some(
                          (fid) => fid?.id === v.id || String(fid?.label || '').toLowerCase() === vLblLow,
                        ),
                    )
                    const accPool = matchedAccs.length > 0 ? matchedAccs : allAccounts
                    const bundled: ExtensionBundledAccount[] = accPool.map((a) => ({
                      name: a.display_name || a.external_account_id || 'TKQC',
                      external_account_id: a.external_account_id || '',
                      status: a.status,
                      currency: a.currency || 'VND',
                      balance_raw: a.billing_meta?.balance_raw ?? a.spend_periods?.balance_raw ?? null,
                      billing_threshold_raw: a.billing_meta?.billing_threshold_raw ?? null,
                      next_bill_date: a.billing_meta?.next_bill_date ?? null,
                      meta_daily_limit_raw: a.billing_meta?.meta_daily_limit_raw ?? null,
                      payment_card_display: a.billing_meta?.payment_card_display ?? null,
                      business_legal_name: a.billing_meta?.business_legal_name ?? null,
                      bm_name: a.business_manager_name ?? null,
                    }))
                    return {
                      viaName: vLbl,
                      profileDir: folder,
                      rawProxy: cleanRealProxy(v.network_label),
                      bundledAccounts: bundled,
                      twoFaSecret: extractBase32Secret(v.vault_reference),
                      viaTier: inferTierFromVia(
                        v.notes,
                        v.label,
                        vSum?.business_manager_count ?? 0,
                        vSum?.ad_account_count ?? 0,
                      ),
                    }
                  })
                  downloadAllViasExtensionsBundleZip(specs)
                }}
                title="Đóng gói sẵn thư mục AdsOps Companion v2.8 riêng cho từng Via vào chung 1 file .zip để cài nhanh hàng loạt"
              >
                <Layers className="mr-1.5 h-4 w-4" aria-hidden="true" />
                <span>📦 Tải Trọn Bộ v2.8 Cho Tất Cả {vias.length} Via (.zip)</span>
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={downloadWindowsChromeLauncherBat}
              title="Chạy 1 lần trên máy Windows để kích hoạt Cầu nối ngầm 127.0.0.1:17890 & adsops-chrome:// mở đa Chrome không hiện popup hỏi"
            >
              <Terminal className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>Cài Đặt Tự Động Mở Chrome (.bat)</span>
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
              <span>Mở Chrome ({shortFolder}) Ngay</span>
            </Button>
          </div>
        </div>

        {/* 4 CORE CAPABILITIES */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <CreditCard className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>1. Bảng Dư nợ, Ngưỡng &amp; Thẻ TKQC</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Hiển thị ngay trong Popup danh sách TKQC của Via: <strong>Dư nợ hiện tại, Ngưỡng thanh toán, Giới hạn ngày (DSL)</strong> và mã <strong>Thẻ Visa/Mastercard</strong>.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <KeyRound className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>2. Mã 2FA 6 số &amp; Tự điền 1 chạm</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Tự động sinh mã 2FA 6 số ngay trong Tiện ích Chrome và hỗ trợ nút <strong>«⚡ Tự điền FB»</strong> vào thẳng trang đăng nhập Facebook đang mở.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Sparkles className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>3. Xuất/Nạp Cookie &amp; Bắt Token EAAB</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Hỗ trợ <strong>Chép/Nạp Cookie Facebook</strong> để đăng nhập Via mới không cần mật khẩu (chống CP 956) và bắt nhanh Token <code>EAAB...</code>.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Globe className="h-4 w-4 text-brand-text shrink-0" aria-hidden="true" />
              <span>4. Bọc Proxy IPv4 &amp; Khóa rò IP WebRTC</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Bọc Proxy riêng cho từng Hồ sơ Chrome, tự điền mật khẩu ngầm và bật <strong>WebRTC Leak Shield</strong> chặn lộ IP Wifi gốc của văn phòng.
            </p>
          </div>
        </div>
      </div>

      {/* GENERATOR + LIVE PREVIEW */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle>Đóng gói Tiện ích Chrome (.zip) theo từng Via &amp; Hồ sơ Chrome</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vias.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink">
                  1. Chọn Tài khoản Facebook (Via) để nạp sẵn cấu hình thật vào Tiện ích:
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {vias.map((v) => {
                    const lbl = String(v.label ?? '')
                    const prof = String(v.browser_profile_label || 'Chrome — Default · trieu (thientrieu753@gmail.com)')
                    const net = cleanRealProxy(v.network_label)
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
                          setTwoFaInput(extractBase32Secret(v.vault_reference))
                          setViaTier(inferTierFromVia(v.notes, v.label, bmCount, adCount))
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
                  2. Tên định danh Via nạp sẵn:
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
                  3. Hồ sơ Google Chrome thật trên máy:
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-bold text-ink" htmlFor="ext-via-tier">
                  4. Phân tầng Lớp Via (Hiển thị trên thanh HUD):
                </label>
                <select
                  id="ext-via-tier"
                  className="input text-xs font-semibold"
                  value={viaTier}
                  onChange={(e) => setViaTier(e.target.value as 'vault' | 'camp' | 'standby')}
                >
                  <option value="vault">🛡️ Lớp 1: Via Tổng (Chỉ giữ BM - CẤM LÊN CAMP)</option>
                  <option value="camp">🚀 Lớp 2: Via Lên Camp (Chạy Ads khách)</option>
                  <option value="standby">🌱 Lớp 3: Via Dự Phòng (Ngâm sẵn &gt; 7 ngày)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-ink" htmlFor="ext-twofa-secret">
                  5. Khóa 2FA Base32 nạp sẵn (Tùy chọn):
                </label>
                <input
                  id="ext-twofa-secret"
                  ref={twoFaInputRef}
                  className="input font-mono text-xs"
                  value={twoFaInput}
                  onChange={(e) => setTwoFaInput(e.target.value)}
                  placeholder="Dán khóa Base32 để tiện ích tự sinh 6 số 2FA"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-ink" htmlFor="ext-proxy-str">
                6. Cấu hình Proxy IPv4 riêng (<code>IP:Port:User:Pass</code> — để trống nếu dùng Mạng gốc):
              </label>
              <input
                id="ext-proxy-str"
                className="input font-mono text-xs"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder="Để trống = Mạng gốc · Hoặc nhập IP:Port:User:Pass thật của bạn"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="font-semibold text-ink-muted">Mua &amp; Quản lý Proxy IPv4 Dân cư tĩnh VN (1–2 Via/Proxy):</span>
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

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="button"
                onClick={() =>
                  downloadChromeExtensionZip(
                    selectedViaLabel,
                    shortFolder,
                    proxyInput,
                    bundledForZip,
                    twoFaInput,
                    viaTier,
                  )
                }
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
                Mở Chrome ({shortFolder})
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-ink">
                  Hướng dẫn cài đặt gói <code>.zip</code> &amp; kích hoạt mở Chrome tự động:
                </div>
                <button
                  type="button"
                  onClick={downloadWindowsChromeLauncherBat}
                  className="text-[11px] font-bold text-brand-text hover:underline"
                >
                  ⚡ Tải thêm file kích hoạt mở Chrome tự động (.bat) →
                </button>
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-ink-muted">
                <li>
                  Bấm <strong>Tải Tiện Ích Chrome Đã Cấu Hình (.zip)</strong> ở trên rồi giải nén ra một thư mục cố định trên máy.
                </li>
                <li>
                  Trên cửa sổ Chrome của Via ({shortFolder}), truy cập <strong><code>chrome://extensions</code></strong> và bật công tắc <strong>Chế độ dành cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải.
                </li>
                <li>
                  Bấm nút <strong>Tải tiện ích đã giải nén (Load unpacked)</strong> ở góc trên bên trái → chọn thư mục vừa giải nén.
                </li>
                <li>
                  Bấm biểu tượng <strong>Mảnh ghép Tiện ích</strong> trên góc phải Chrome → bấm <strong>Ghim (Pin)</strong> cạnh <strong>AdsOps Companion Pro</strong>.
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* LIVE EXTENSION POPUP PREVIEW WITH REAL AD ACCOUNTS & WORKING BUTTONS */}
        <div className="lg:col-span-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Bản xem trước trực tiếp khi mở Tiện ích trên Chrome ({selectedViaLabel}):
            </span>
            <Badge tone="info">{viaAccounts.length} TKQC thật được nạp sẵn</Badge>
          </div>

          <div className="mx-auto w-full max-w-[460px] rounded-xl border border-line bg-surface p-4 shadow-md">
            {/* Browser URL bar */}
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
                    <div className="text-xs font-extrabold text-ink">AdsOps Companion v2.8 Pro (Đảo Ấm Sinh Học Đa Lộ Trình + Bắt Bệnh Văng Cookie + Full Auto-Pilot)</div>
                    <div className="text-[10px] text-ink-muted">
                      Hồ sơ: {shortFolder} · Via: {selectedViaLabel} (
                      {viaTier === 'vault' ? '🛡️ Via Tổng' : viaTier === 'standby' ? '🌱 Dự Phòng' : '🚀 Lên Camp'})
                    </div>
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

              {/* Section 1: Anti-Passkey Shield, Live 2FA OTP & WebRTC Lock (100% Interactive) */}
              <div className="rounded-md border border-line bg-surface p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  <span>1. 🚫 Chặn Passkey · 🔑 2FA &amp; Khóa WebRTC</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" /> Passkey &amp; WebRTC Lock
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs">
                  <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                    🚫 Đã chặn bảng Windows Hello / Passkey
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      launchInAssignedChromeProfile(
                        'https://accountscenter.facebook.com/password_and_security/passkeys?adsops_auto_delete_passkey=1',
                        selectedProfile,
                        selectedViaLabel,
                        proxyInput,
                      )
                    }
                    className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700"
                    title="Mở Account Center trên đúng Chrome của Via này và tự động bấm Xoá Passkey"
                  >
                    🗑️ 1 Chạm Tự Xoá Passkey
                  </button>
                </div>
                {liveOtp ? (
                  <div className="flex items-center justify-between gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold tracking-widest text-emerald-700 dark:text-emerald-300">
                        {liveOtp.slice(0, 3)} {liveOtp.slice(3)}
                      </span>
                      <span className="font-mono text-[10px] text-ink-muted">({secondsLeft}s)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(liveOtp)
                        setCopiedOtp(true)
                        setTimeout(() => setCopiedOtp(false), 1500)
                      }}
                      className="inline-flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-[10px] font-bold text-brand-fg hover:opacity-90"
                    >
                      {copiedOtp ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedOtp ? 'Đã chép 6 số' : 'Sao chép 2FA'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded border border-line bg-canvas px-2.5 py-1.5 text-xs">
                    <span className="text-[11px] text-ink-muted">Chưa nạp khóa 2FA cho {selectedViaLabel}</span>
                    <button
                      type="button"
                      onClick={() => twoFaInputRef.current?.focus()}
                      className="rounded border border-brand/40 bg-brand-light px-2 py-0.5 text-[10.5px] font-bold text-brand-text hover:opacity-90"
                    >
                      + Nhập khóa 2FA ở mục 5
                    </button>
                  </div>
                )}
              </div>

              {/* Section 2: KPI Summary of Via's Ad Accounts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  <span>2. Tài khoản quảng cáo thuộc {selectedViaLabel}</span>
                  <span className="font-mono text-brand-text">{viaAccounts.length} TKQC</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-line bg-surface p-2 text-center">
                    <div className="text-[10px] text-ink-muted">Đang hoạt động</div>
                    <div className="mt-0.5 font-mono text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                      {kpiStats.active} TK
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-2 text-center">
                    <div className="text-[10px] text-ink-muted">Nợ / Hạn chế</div>
                    <div className="mt-0.5 font-mono text-xs font-extrabold text-amber-600 dark:text-amber-400">
                      {kpiStats.restricted} TK
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-2 text-center">
                    <div className="text-[10px] text-ink-muted">Tổng dư nợ</div>
                    <div className="mt-0.5 font-mono text-xs font-extrabold text-danger-text truncate">
                      {fmtMoney(kpiStats.totalDebtVnd, 'VND')}
                    </div>
                  </div>
                </div>

                {/* Scrollable list of real Ad Accounts */}
                <div className="max-h-[210px] space-y-1.5 overflow-y-auto pr-1">
                  {viaAccounts.slice(0, 20).map((acc) => {
                    const actId = String(acc.external_account_id || '').replace(/^act_/i, '')
                    const bal = acc.billing_meta?.balance_raw ?? acc.spend_periods?.balance_raw ?? '0'
                    const thresh = acc.billing_meta?.billing_threshold_raw
                    const dsl = acc.billing_meta?.meta_daily_limit_raw
                    const card = acc.billing_meta?.payment_card_display || 'Chưa gắn thẻ'
                    const billingUrl = `https://business.facebook.com/billing_hub/accounts/details?act=${encodeURIComponent(actId)}`
                    const adsUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actId)}`

                    return (
                      <div key={acc.id} className="rounded-md border border-line bg-surface p-2 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-ink truncate" title={acc.display_name}>
                            {acc.display_name}{' '}
                            <span className="font-mono text-[10px] font-normal text-ink-muted">({actId})</span>
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
                                ? 'Nợ cước'
                                : 'Đã đóng'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-ink-muted">
                          <span>
                            Dư nợ: <strong className="font-mono text-ink">{fmtMoney(bal, acc.currency)}</strong>
                            {thresh ? ` · Ngưỡng: ${fmtMoney(thresh, acc.currency)}` : ''}
                            {dsl ? ` · GH: ${fmtMoney(dsl, acc.currency)}` : ''}
                          </span>
                          <span className="font-mono text-[10.5px] font-semibold text-brand-text">💳 {card}</span>
                        </div>

                        <div className="flex items-center justify-between border-t border-dashed border-line pt-1 text-[10.5px]">
                          <span className="text-ink-muted truncate max-w-[220px]">
                            {acc.billing_meta?.business_legal_name || acc.business_manager_name || 'BM Meta'}
                          </span>
                          <div className="flex items-center gap-2 font-semibold">
                            <button
                              type="button"
                              onClick={() =>
                                launchInAssignedChromeProfile(billingUrl, selectedProfile, selectedViaLabel, proxyInput)
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

              {/* Section 3: Environment & Direct Launch Actions */}
              <div className="rounded-md border border-line bg-surface p-2.5 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    3. Mở nhanh trang Meta trên đúng Chrome ({shortFolder})
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {parsedProxy ? `Proxy: ${parsedProxy.host}:${parsedProxy.port}` : '🌐 Mạng gốc'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      launchInAssignedChromeProfile(
                        'https://business.facebook.com/accountquality',
                        selectedProfile,
                        selectedViaLabel,
                        proxyInput,
                      )
                    }
                    className="flex items-center justify-between rounded border border-danger-line bg-danger-soft px-2 py-1 text-[11px] font-semibold text-danger-text hover:opacity-90"
                  >
                    <span>🛡️ Kháng nghị Meta</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      launchInAssignedChromeProfile(
                        'https://business.facebook.com/billing_hub/accounts',
                        selectedProfile,
                        selectedViaLabel,
                        proxyInput,
                      )
                    }
                    className="flex items-center justify-between rounded border border-brand/30 bg-brand-light px-2 py-1 text-[11px] font-semibold text-brand-text hover:opacity-90"
                  >
                    <span>💳 Billing Hub Meta</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </button>
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
          <p className="mt-1 text-xs text-ink-muted">Gán Hồ sơ Chrome cố định, phân tầng 3 lớp &amp; lấy mã 2FA 6 số.</p>
        </Link>
        <Link to="/business-managers" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Business Manager →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Theo dõi hạn mức BM1 / BM5 / BM10 (Đã XMDN) &amp; đồng bộ Meta.</p>
        </Link>
        <Link to="/accounts" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            <span>Quản lý Tài khoản Quảng cáo →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Kiểm tra chi tiêu, dư nợ &amp; hạn mức 1 Thẻ ≤ 3 TKQC.</p>
        </Link>
        <Link to="/operations-guide" className="rounded-lg border border-line bg-surface p-3.5 hover:border-brand transition-colors">
          <div className="flex items-center gap-2 text-xs font-bold text-brand-text">
            <Layers className="h-4 w-4" aria-hidden="true" />
            <span>Hướng dẫn &amp; Công thức Vận hành →</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Xem Slider 5 bước chống die Via/TKQC &amp; Checklist XMDN.</p>
        </Link>
      </div>
    </div>
  )
}
