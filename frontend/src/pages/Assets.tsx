import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Flag,
  Globe,
  Layers,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRoundCog,
  X,
} from 'lucide-react'
import FanpageControlCenter from '../components/FanpageControlCenter'
import { PageHeader } from '../components/page/PageHeader'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { launchInAssignedChromeProfile } from '../lib/chromeProfileLauncher'
import {
  BROWSER_REFERENCES,
  PAGES,
  PAYMENT_REFERENCES,
  PIXELS,
  PROXY_REFERENCES,
} from '../lib/resources'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'

const SPECS = [PAGES, PIXELS, PAYMENT_REFERENCES, BROWSER_REFERENCES, PROXY_REFERENCES]

interface LinkedAccItem {
  id: string
  display_name: string
  external_account_id: string | null
  status: string
  currency: string
  balance_minor?: number
  bm_name?: string | null
}

interface PixelOverviewItem {
  id: string
  name: string
  external_pixel_id: string | null
  status: string
  notes: string
  updated_at: string | null
  owner_bm_id: string | null
  owner_bm_name: string | null
  owner_bm_external_id: string | null
  holder_identity_id: string | null
  holder_label: string | null
  holder_browser_profile: string
  holder_network_label: string
  linked_ad_accounts: LinkedAccItem[]
  linked_ad_account_count: number
  restricted_ad_account_count: number
}

interface CardOverviewItem {
  id: string
  reference_code: string
  label: string
  provider: string
  billing_country: string
  currency: string
  status: string
  notes: string
  linked_ad_accounts: LinkedAccItem[]
  linked_ad_account_count: number
  active_ad_account_count: number
  restricted_ad_account_count: number
  total_balance_minor: number
  safety_status: 'SAFE' | 'WARNING' | 'DANGER'
}

interface BrowserOverviewItem {
  id: string
  profile_reference: string
  label: string
  provider: string
  local_or_remote: string
  status: string
  notes: string
  assigned_vias: {
    id: string
    label: string
    external_reference_id: string | null
    status: string
    network_label: string
  }[]
  via_count: number
  isolation_status: 'ISOLATED' | 'COLLISION' | 'STANDBY'
}

interface ProxyOverviewItem {
  id: string
  proxy_reference: string
  label: string
  provider: string
  country: string
  region: string
  protocol: string
  status: string
  notes: string
  assigned_vias: {
    id: string
    label: string
    external_reference_id: string | null
    browser_profile_label: string
  }[]
  via_count: number
  isolation_status: 'SAFE' | 'OVERLOADED'
}

interface AssetsOverviewResponse {
  pixels: PixelOverviewItem[]
  payment_cards: CardOverviewItem[]
  browser_profiles: BrowserOverviewItem[]
  proxies: ProxyOverviewItem[]
  summary: {
    pages_total: number
    pixels_total: number
    cards_total: number
    cards_danger_count: number
    browsers_total: number
    browsers_isolated_count: number
    proxies_total: number
    proxies_safe_count: number
  }
}

export default function Assets() {
  const { t, language } = useI18n()
  const isEn = language === 'en'
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab = SPECS.some((s) => s.key === requestedTab) ? requestedTab! : SPECS[0].key
  const [tab, setTab] = useState(initialTab)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [bannerMsg, setBannerMsg] = useState<string | null>(null)

  // Modals for Pixel / Card linking & creation
  const [editingPixel, setEditingPixel] = useState<PixelOverviewItem | null>(null)
  const [createPixelOpen, setCreatePixelOpen] = useState(false)
  const [pxName, setPxName] = useState('')
  const [pxExtId, setPxExtId] = useState('')
  const [pxBmId, setPxBmId] = useState('')
  const [pxAccIds, setPxAccIds] = useState<string[]>([])
  const [pxNotes, setPxNotes] = useState('')

  const [editingCard, setEditingCard] = useState<CardOverviewItem | null>(null)
  const [createCardOpen, setCreateCardOpen] = useState(false)
  const [cardCode, setCardCode] = useState('')
  const [cardLabel, setCardLabel] = useState('')
  const [cardProvider, setCardProvider] = useState('VISA')
  const [cardAccIds, setCardAccIds] = useState<string[]>([])
  const [cardNotes, setCardNotes] = useState('')

  const [createBrowserOpen, setCreateBrowserOpen] = useState(false)
  const [browserRef, setBrowserRef] = useState('')
  const [browserNotes, setBrowserNotes] = useState('')

  const [createProxyOpen, setCreateProxyOpen] = useState(false)
  const [proxyRef, setProxyRef] = useState('')
  const [proxyProvider, setProxyProvider] = useState('Viettel IDC')
  const [proxyRegion, setProxyRegion] = useState('HCM')
  const [proxyNotes, setProxyNotes] = useState('')

  const overviewQ = useQuery({
    queryKey: ['facebook-assets-overview'],
    queryFn: () => api.get<AssetsOverviewResponse>('/api/v1/facebook-assets/overview'),
  })

  const bmsQ = useQuery({
    queryKey: ['business-managers-all'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
  })

  const accountsQ = useQuery({
    queryKey: ['ad-accounts-all-for-assets'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const syncAllMut = useMutation({
    mutationFn: () => api.post<AssetsOverviewResponse>('/api/v1/facebook-assets/sync', {}),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      setBannerMsg(
        isEn
          ? `✅ Reconciled & synced all 5 Asset layers: ${res.summary.pages_total} Fanpages, ${res.summary.pixels_total} Pixels, ${res.summary.cards_total} Cards, ${res.summary.browsers_total} Chrome Profiles, and ${res.summary.proxies_total} Static Proxies.`
          : `✅ Đã đồng bộ & đối soát toàn bộ 5 lớp Tài sản: ${res.summary.pages_total} Fanpage, ${res.summary.pixels_total} Pixel, ${res.summary.cards_total} Thẻ thanh toán, ${res.summary.browsers_total} Hồ sơ Chrome và ${res.summary.proxies_total} Tuyến Proxy tĩnh.`,
      )
    },
  })

  const assignPixelMut = useMutation({
    mutationFn: (payload: {
      pixelId: string
      name: string
      external_pixel_id: string
      owner_bm_id: string
      ad_account_ids: string[]
      notes: string
    }) => {
      const { pixelId, ...body } = payload
      return api.post(`/api/v1/facebook-assets/pixels/${pixelId}/assign`, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setEditingPixel(null)
      setBannerMsg(
        isEn
          ? '✅ Updated Pixel / Dataset governance and linked Ad Accounts.'
          : '✅ Đã lưu phân quyền Dataset / Pixel và danh sách TKQC nhận dữ liệu.',
      )
    },
  })

  const createPixelMut = useMutation({
    mutationFn: async () => {
      const created = await api.post<ReferenceRecord>('/api/v1/pixels', {
        name: pxName.trim(),
        external_pixel_id: pxExtId.trim() || null,
        status: 'active',
        notes: pxNotes.trim(),
      })
      await api.post(`/api/v1/facebook-assets/pixels/${created.id}/assign`, {
        name: pxName.trim(),
        external_pixel_id: pxExtId.trim(),
        owner_bm_id: pxBmId,
        ad_account_ids: pxAccIds,
        notes: pxNotes.trim(),
      })
      return created
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setCreatePixelOpen(false)
      setBannerMsg(isEn ? '✅ Added new Pixel / Dataset.' : '✅ Đã thêm Dataset / Pixel mới và gán quyền chạy.')
    },
  })

  const assignCardMut = useMutation({
    mutationFn: (payload: {
      cardId: string
      label: string
      ad_account_ids: string[]
      notes: string
    }) => {
      const { cardId, ...body } = payload
      return api.post(`/api/v1/facebook-assets/cards/${cardId}/assign`, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setEditingCard(null)
      setBannerMsg(
        isEn
          ? '✅ Updated Payment Card links and enforced 1 Card ≤ 3 Ad Accounts safety.'
          : '✅ Đã cập nhật danh sách TKQC gắn với Thẻ thanh toán (đảm bảo ngưỡng an toàn 1 Thẻ ≤ 3 TKQC).',
      )
    },
  })

  const createCardMut = useMutation({
    mutationFn: async () => {
      const created = await api.post<ReferenceRecord>('/api/v1/payment-profile-references', {
        reference_code: cardCode.trim(),
        label: cardLabel.trim() || cardCode.trim(),
        provider: cardProvider,
        billing_country: 'VN',
        currency: 'VND',
        status: 'active',
        notes: cardNotes.trim(),
      })
      if (cardAccIds.length > 0) {
        await api.post(`/api/v1/facebook-assets/cards/${created.id}/assign`, {
          label: cardLabel.trim() || cardCode.trim(),
          ad_account_ids: cardAccIds,
          notes: cardNotes.trim(),
        })
      }
      return created
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setCreateCardOpen(false)
      setBannerMsg(isEn ? '✅ Added new Payment Card reference.' : '✅ Đã thêm Thẻ thanh toán mới vào sổ quản trị.')
    },
  })

  const createBrowserMut = useMutation({
    mutationFn: () =>
      api.post('/api/v1/browser-profile-references', {
        provider: 'chrome',
        profile_reference: browserRef.trim(),
        label: browserRef.trim(),
        local_or_remote: 'local',
        status: 'active',
        notes: browserNotes.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setCreateBrowserOpen(false)
      setBrowserRef('')
      setBrowserNotes('')
      setBannerMsg(isEn ? '✅ Added new isolated Chrome Profile.' : '✅ Đã thêm Hồ sơ Chrome cách ly mới.')
    },
  })

  const createProxyMut = useMutation({
    mutationFn: () =>
      api.post('/api/v1/proxy-references', {
        provider: proxyProvider.trim() || 'Viettel IDC',
        proxy_reference: proxyRef.trim(),
        label: proxyRef.trim(),
        country: 'VN',
        region: proxyRegion.trim() || 'HCM',
        protocol: 'HTTP',
        status: 'active',
        notes: proxyNotes.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-assets-overview'] })
      setCreateProxyOpen(false)
      setProxyRef('')
      setProxyNotes('')
      setBannerMsg(isEn ? '✅ Added new static residential Proxy cluster.' : '✅ Đã thêm tuyến Proxy IPv4 Dân cư tĩnh mới.')
    },
  })

  useEffect(() => {
    if (requestedTab && SPECS.some((s) => s.key === requestedTab) && requestedTab !== tab) {
      setTab(requestedTab)
    }
  }, [requestedTab, tab])

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab)
    setSearchParams({ tab: nextTab }, { replace: true })
  }

  const handleCopy = (val: string) => {
    void navigator.clipboard.writeText(val)
    setCopiedId(val)
    setTimeout(() => setCopiedId((prev) => (prev === val ? null : prev)), 1500)
  }

  const summary = overviewQ.data?.summary ?? {
    pages_total: 11,
    pixels_total: 7,
    cards_total: 7,
    cards_danger_count: 0,
    browsers_total: 9,
    browsers_isolated_count: 9,
    proxies_total: 5,
    proxies_safe_count: 5,
  }
  const pixels = overviewQ.data?.pixels ?? []
  const cards = overviewQ.data?.payment_cards ?? []
  const browsers = overviewQ.data?.browser_profiles ?? []
  const proxies = overviewQ.data?.proxies ?? []
  const allBms = bmsQ.data?.items ?? []
  const allAccounts = accountsQ.data?.items ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title={t('assets.title')} description={t('assets.desc')} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => syncAllMut.mutate()}
            disabled={syncAllMut.isPending}
            className="gap-1.5 font-semibold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncAllMut.isPending ? 'animate-spin' : ''}`} />
            <span>
              {syncAllMut.isPending
                ? isEn
                  ? 'Reconciling all 5 Asset layers...'
                  : 'Đang đồng bộ 5 lớp Tài sản...'
                : isEn
                  ? '🔄 Reconcile & Sync All 5 Asset Layers'
                  : '🔄 Đồng bộ & Đối soát Toàn bộ 5 Lớp Tài sản'}
            </span>
          </Button>
          <Link
            to="/operations-guide"
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-light px-3 py-1.5 text-xs font-bold text-brand-text hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {isEn
                ? '📖 Asset Isolation & Anti-Contagion Playbook →'
                : '📖 Quy chuẩn Cách ly Tài sản & Chống Chết Liên Đới →'}
            </span>
          </Link>
        </div>
      </div>

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="rounded p-0.5 hover:bg-emerald-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ASSET HEALTH & ISOLATION SUMMARY BAR */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => handleTabChange(PAGES.key)}
          className={`rounded-lg border p-3 text-left transition ${
            tab === PAGES.key ? 'border-brand bg-brand-light/20' : 'border-line bg-surface hover:border-brand'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Fanpages (Pages)' : 'Trang Fanpage'}</span>
            <Flag className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{summary.pages_total}</div>
          <div className="text-[11px] text-ink-muted">
            {isEn ? 'Held by Tier-1 Via, shared to Ad Accounts' : 'Giữ bởi Via Tổng (Lớp 1), share quyền cho TKQC'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PIXELS.key)}
          className={`rounded-lg border p-3 text-left transition ${
            tab === PIXELS.key ? 'border-brand bg-brand-light/20' : 'border-line bg-surface hover:border-brand'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Datasets / Pixel</span>
            <Layers className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{summary.pixels_total}</div>
          <div className="text-[11px] text-ink-muted">
            {isEn ? 'Share Partner via BM to preserve event data' : 'Share Partner qua BM để bảo toàn dữ liệu'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PAYMENT_REFERENCES.key)}
          className={`rounded-lg border p-3 text-left transition ${
            tab === PAYMENT_REFERENCES.key
              ? 'border-brand bg-brand-light/20'
              : 'border-line bg-surface hover:border-brand'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Payment Cards' : 'Thẻ Thanh Toán'}</span>
            <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{summary.cards_total}</div>
          <div className="text-[11px] text-ink-muted">
            {isEn ? 'Safety rule: 1 Card ≤ 3 Ad Accounts' : 'Quy tắc an toàn: 1 Thẻ ≤ 3 TKQC'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(BROWSER_REFERENCES.key)}
          className={`rounded-lg border p-3 text-left transition ${
            tab === BROWSER_REFERENCES.key
              ? 'border-brand bg-brand-light/20'
              : 'border-line bg-surface hover:border-brand'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Chrome Profiles' : 'Hồ sơ Chrome'}</span>
            <Monitor className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">
            {summary.browsers_isolated_count}/{summary.browsers_total}
          </div>
          <div className="text-[11px] text-ink-muted">
            {isEn ? 'Isolated: 1 Chrome Profile = 1 fixed Via' : 'Cách ly 1 Hồ sơ Chrome = 1 Via cố định'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PROXY_REFERENCES.key)}
          className={`rounded-lg border p-3 text-left transition ${
            tab === PROXY_REFERENCES.key
              ? 'border-brand bg-brand-light/20'
              : 'border-line bg-surface hover:border-brand'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Static IPv4 Proxies' : 'Proxy IPv4 Tĩnh'}</span>
            <Globe className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{summary.proxies_total}</div>
          <div className="text-[11px] text-ink-muted">
            {isEn ? 'VN Residential Static: 1 Proxy ≤ 2 Vias' : 'Chuẩn dân cư tĩnh VN: 1 Proxy ≤ 2 Via'}
          </div>
        </button>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList aria-label={t('assets.title')}>
          {SPECS.map((spec) => (
            <TabsTrigger key={spec.key} value={spec.key}>
              {t(spec.plural)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* TAB 1: FANPAGES */}
        <TabsContent value={PAGES.key}>
          <FanpageControlCenter embedded />
        </TabsContent>

        {/* TAB 2: DATASETS / PIXELS */}
        <TabsContent value={PIXELS.key}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Layers className="h-4 w-4 text-brand-text" />
                    <span>
                      {isEn
                        ? `Datasets / Meta Pixels & BM Partner Sharing Matrix (${pixels.length})`
                        : `Trung tâm Quản trị Datasets / Pixel & Ma trận Share Partner (${pixels.length})`}
                    </span>
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {isEn
                      ? 'Keep Pixels owned by the Central BM so conversion intelligence is never lost when an Ad Account is replaced.'
                      : 'Giữ Pixel thuộc quyền sở hữu của BM Trung tâm rồi Share Partner sang các TKQC để khi thay TKQC không bao giờ mất dữ liệu tệp khách hàng.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setPxName('')
                    setPxExtId('')
                    setPxBmId(allBms[0]?.id ?? '')
                    setPxAccIds([])
                    setPxNotes('')
                    setCreatePixelOpen(true)
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isEn ? '+ Add Dataset / Pixel' : '+ Thêm Dataset / Pixel mới'}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-y border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      <th className="px-3.5 py-2.5">{isEn ? '1. Dataset / Pixel & ID' : '1. Tên Dataset / Pixel & ID'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '2. Status' : '2. Trạng thái'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '3. Owner BM & Holder Via' : '3. BM Gốc Sở Hữu & Via Giữ'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '4. Linked Ad Accounts' : '4. TKQC Đang Nhận Pixel'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '5. Quick Actions' : '5. Mở Events Manager & Share'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pixels.map((px) => {
                      const extId = px.external_pixel_id ?? ''
                      const eventsUrl = extId
                        ? `https://business.facebook.com/events_manager2/list/pixel/${extId}/overview${
                            px.owner_bm_external_id ? `?business_id=${px.owner_bm_external_id}` : ''
                          }`
                        : 'https://business.facebook.com/events_manager2'
                      const bmPixelSettingsUrl =
                        extId && px.owner_bm_external_id
                          ? `https://business.facebook.com/settings/pixels/${extId}?business_id=${px.owner_bm_external_id}`
                          : eventsUrl

                      return (
                        <tr key={px.id} className="align-top hover:bg-surface-muted/30 transition">
                          <td className="px-3.5 py-3">
                            <div className="font-bold text-ink">{px.name}</div>
                            <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
                              <span>Pixel ID: {extId || '—'}</span>
                              {extId && (
                                <button
                                  type="button"
                                  onClick={() => handleCopy(extId)}
                                  className="inline-flex items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-sans hover:border-brand"
                                >
                                  {copiedId === extId ? (
                                    <Check className="h-3 w-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                  <span>{copiedId === extId ? (isEn ? 'Copied' : 'Đã chép') : 'Copy'}</span>
                                </button>
                              )}
                            </div>
                          </td>

                          <td className="px-3.5 py-3">
                            <Badge tone="positive">
                              {isEn ? '🟢 Active Dataset' : '🟢 Đang thu thập dữ liệu'}
                            </Badge>
                          </td>

                          <td className="px-3.5 py-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-ink">
                                <Building2 className="h-3.5 w-3.5 text-brand-text" />
                                <span>{px.owner_bm_name || (isEn ? 'Central BM' : 'BM Trung tâm')}</span>
                              </div>
                              {px.holder_label && (
                                <div className="text-[11px] text-ink-muted">
                                  🛡️ {px.holder_label} · <span className="font-mono">{px.holder_browser_profile}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="px-3.5 py-3">
                            {px.linked_ad_accounts.length === 0 ? (
                              <span className="text-[11px] text-ink-faint">
                                {isEn ? 'No Ad Account linked yet' : 'Chưa gán TKQC nhận dữ liệu'}
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {px.linked_ad_accounts.map((acc) => {
                                  const isBad = acc.status === 'restricted' || acc.status === 'disabled'
                                  return (
                                    <Link
                                      key={acc.id}
                                      to={`/accounts/${acc.id}`}
                                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium hover:underline ${
                                        isBad
                                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                          : 'border-line bg-surface-muted/60 text-ink'
                                      }`}
                                    >
                                      <span>{isBad ? '🔴' : '🟢'}</span>
                                      <span className="max-w-[140px] truncate">{acc.display_name}</span>
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </td>

                          <td className="px-3.5 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  launchInAssignedChromeProfile(
                                    bmPixelSettingsUrl,
                                    px.holder_browser_profile,
                                    px.holder_label || px.name,
                                    px.holder_network_label,
                                  )
                                  setBannerMsg(
                                    isEn
                                      ? `🚀 Opened BM Pixel Partner Settings in Chrome (${px.holder_browser_profile})`
                                      : `🚀 Đã mở Cài đặt Share Pixel trên Hồ sơ Chrome (${px.holder_browser_profile})`,
                                  )
                                }}
                                className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
                              >
                                <Globe className="h-3 w-3" />
                                <span>{isEn ? '🚀 Share in Chrome' : '🚀 Mở Chrome Share Pixel'}</span>
                              </button>

                              <a
                                href={eventsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                              >
                                <span>Events Manager</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPixel(px)
                                  setPxName(px.name)
                                  setPxExtId(px.external_pixel_id ?? '')
                                  setPxBmId(px.owner_bm_id ?? '')
                                  setPxAccIds(px.linked_ad_accounts.map((a) => a.id))
                                  setPxNotes(px.notes)
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                              >
                                <Settings2 className="h-3 w-3 text-brand-text" />
                                <span>{isEn ? 'Link Accounts' : 'Gán TKQC'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: PAYMENT CARDS */}
        <TabsContent value={PAYMENT_REFERENCES.key}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-4 w-4 text-emerald-500" />
                    <span>
                      {isEn
                        ? `Payment Cards & Contagion Guard: 1 Card ≤ 3 Ad Accounts (${cards.length})`
                        : `Quản trị Thẻ Thanh Toán & Chống Chết Liên Đới: 1 Thẻ ≤ 3 TKQC (${cards.length})`}
                    </span>
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {isEn
                      ? 'Never attach more than 3 Ad Accounts to a single Visa/Mastercard. Unlink disabled accounts immediately so a payment block does not cascade.'
                      : 'Tuyệt đối không gắn quá 3 TKQC chung 1 thẻ Visa/Mastercard. Khi có TKQC bị khóa/hạn chế, hãy gỡ thẻ hoặc ngắt liên kết ngay để không bị khóa phương thức thanh toán dây chuyền.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setCardCode('')
                    setCardLabel('')
                    setCardProvider('VISA')
                    setCardAccIds([])
                    setCardNotes('')
                    setCreateCardOpen(true)
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isEn ? '+ Add Payment Card' : '+ Thêm Thẻ Thanh Toán'}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-y border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      <th className="px-3.5 py-2.5">{isEn ? '1. Card Label & Last 4 Digits' : '1. Thẻ Thanh Toán (4 số cuối)'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '2. Safety Threshold (≤ 3 Acc)' : '2. Ngưỡng An Toàn (≤ 3 TKQC)'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '3. Unpaid Balance on Card' : '3. Tổng Dư Nợ Đang Gắn'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '4. Linked Ad Accounts' : '4. Danh Sách TKQC Dùng Thẻ Này'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '5. Actions' : '5. Tác Vụ Quản Trị'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cards.map((c) => (
                      <tr key={c.id} className="align-top hover:bg-surface-muted/30 transition">
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                              💳 {c.provider}
                            </span>
                            <span className="font-bold text-ink">{c.label}</span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-ink-muted">
                            {isEn ? 'Code:' : 'Mã thẻ:'} {c.reference_code} · {c.billing_country} ({c.currency})
                          </div>
                        </td>

                        <td className="px-3.5 py-3">
                          {c.safety_status === 'DANGER' ? (
                            <Badge tone="attention">
                              {isEn
                                ? `🔴 Danger (${c.linked_ad_account_count}/3 Acc · ${c.restricted_ad_account_count} Disabled)`
                                : `🔴 Nguy hiểm (${c.linked_ad_account_count}/3 TKQC · Có ${c.restricted_ad_account_count} TKQC lỗi)`}
                            </Badge>
                          ) : c.safety_status === 'WARNING' ? (
                            <Badge tone="caution">
                              {isEn ? `🟡 At Limit (3/3 Ad Accounts)` : `🟡 Chạm trần (3/3 TKQC — Không gắn thêm)`}
                            </Badge>
                          ) : (
                            <Badge tone="positive">
                              {isEn
                                ? `🟢 Safe (${c.linked_ad_account_count}/3 Ad Accounts)`
                                : `🟢 An toàn (${c.linked_ad_account_count}/3 TKQC)`}
                            </Badge>
                          )}
                        </td>

                        <td className="px-3.5 py-3 font-mono font-bold text-ink">
                          {c.total_balance_minor > 0
                            ? `${c.total_balance_minor.toLocaleString()} ₫`
                            : isEn
                              ? '0 ₫ (Paid)'
                              : '0 ₫ (Sạch cước)'}
                        </td>

                        <td className="px-3.5 py-3">
                          {c.linked_ad_accounts.length === 0 ? (
                            <span className="text-[11px] text-ink-faint">
                              {isEn ? 'Standby card (0 Ad Accounts)' : 'Thẻ dự phòng (Chưa gắn TKQC)'}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {c.linked_ad_accounts.map((acc) => {
                                const isBad = acc.status === 'restricted' || acc.status === 'disabled'
                                return (
                                  <Link
                                    key={acc.id}
                                    to={`/accounts/${acc.id}`}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium hover:underline ${
                                      isBad
                                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                        : 'border-line bg-surface-muted/60 text-ink'
                                    }`}
                                  >
                                    <span>{isBad ? '🔴' : '🟢'}</span>
                                    <span className="max-w-[140px] truncate">{acc.display_name}</span>
                                  </Link>
                                )
                              })}
                            </div>
                          )}
                        </td>

                        <td className="px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.restricted_ad_account_count > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const cleanIds = c.linked_ad_accounts
                                    .filter((a) => a.status === 'active')
                                    .map((a) => a.id)
                                  assignCardMut.mutate({
                                    cardId: c.id,
                                    label: c.label,
                                    ad_account_ids: cleanIds,
                                    notes: c.notes,
                                  })
                                }}
                                className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-rose-700"
                              >
                                {isEn ? '⚡ Unlink Disabled Now' : '⚡ Gỡ TKQC lỗi ngay'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCard(c)
                                setCardLabel(c.label)
                                setCardAccIds(c.linked_ad_accounts.map((a) => a.id))
                                setCardNotes(c.notes)
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                            >
                              <Settings2 className="h-3 w-3 text-brand-text" />
                              <span>{isEn ? 'Assign Accounts' : 'Gán / Gỡ TKQC'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: CHROME PROFILES */}
        <TabsContent value={BROWSER_REFERENCES.key}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Monitor className="h-4 w-4 text-brand-text" />
                    <span>
                      {isEn
                        ? `Isolated Google Chrome Profiles: 1 Profile = 1 Fixed Via (${browsers.length})`
                        : `Bảng Cách Ly Hồ Sơ Google Chrome: 1 Hồ Sơ = 1 Via Cố Định (${browsers.length})`}
                    </span>
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {isEn
                      ? 'Never log out of one Via to log into another inside the same Chrome Profile. Each Via is bound 1:1 to a dedicated Chrome folder.'
                      : 'Tuyệt đối không đăng xuất Via này để đăng nhập Via khác trên cùng 1 cửa sổ Chrome. Mỗi con Via được khóa cố định 1:1 vào 1 thư mục Hồ sơ Chrome riêng.'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setCreateBrowserOpen(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isEn ? '+ Add Chrome Profile' : '+ Thêm Hồ Sơ Chrome'}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-y border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      <th className="px-3.5 py-2.5">{isEn ? '1. Chrome Profile Folder' : '1. Thư Mục Hồ Sơ Chrome'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '2. 1:1 Isolation Status' : '2. Trạng Thái Cách Ly 1:1'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '3. Assigned Via (Facebook Account)' : '3. Tài Khoản Via Đang Ngâm'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '4. Bound Proxy Line' : '4. Tuyến Proxy Đang Bọc'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '5. 1-Click Launch' : '5. Khởi Động Nhanh'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {browsers.map((b) => {
                      const primaryVia = b.assigned_vias[0]
                      return (
                        <tr key={b.id} className="align-top hover:bg-surface-muted/30 transition">
                          <td className="px-3.5 py-3">
                            <div className="font-mono font-bold text-ink">{b.profile_reference}</div>
                            <div className="mt-0.5 text-[11px] text-ink-muted">{b.notes}</div>
                          </td>

                          <td className="px-3.5 py-3">
                            {b.isolation_status === 'ISOLATED' ? (
                              <Badge tone="positive">
                                {isEn ? '🟢 Isolated 1:1 (Safe)' : '🟢 Cách ly chuẩn 1:1 (An toàn)'}
                              </Badge>
                            ) : b.isolation_status === 'COLLISION' ? (
                              <Badge tone="attention">
                                {isEn ? `🔴 Collision (${b.via_count} Vias)` : `🔴 Trùng Profile (${b.via_count} Via)`}
                              </Badge>
                            ) : (
                              <Badge tone="muted">
                                {isEn ? '⚪ Standby Profile' : '⚪ Hồ sơ trống dự phòng'}
                              </Badge>
                            )}
                          </td>

                          <td className="px-3.5 py-3">
                            {b.assigned_vias.length === 0 ? (
                              <span className="text-ink-faint">{isEn ? 'Unassigned' : 'Chưa gán Via'}</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {b.assigned_vias.map((v) => (
                                  <Link
                                    key={v.id}
                                    to={`/facebook-accounts/${v.id}`}
                                    className="inline-flex items-center gap-1 rounded border border-brand/30 bg-brand-light/40 px-2 py-0.5 font-semibold text-brand-text hover:underline"
                                  >
                                    <UserRoundCog className="h-3 w-3" />
                                    <span>{v.label}</span>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </td>

                          <td className="px-3.5 py-3">
                            <span className="rounded bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-ink">
                              🌐 {primaryVia?.network_label || (isEn ? 'Office Direct IP' : 'Mạng gốc Văn phòng')}
                            </span>
                          </td>

                          <td className="px-3.5 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                launchInAssignedChromeProfile(
                                  'https://business.facebook.com/overview',
                                  b.profile_reference,
                                  primaryVia?.label || b.profile_reference,
                                  primaryVia?.network_label,
                                )
                                setBannerMsg(
                                  isEn
                                    ? `🚀 Launched isolated Chrome (${b.profile_reference})`
                                    : `🚀 Đã kích hoạt mở Hồ sơ Chrome cách ly (${b.profile_reference})`,
                                )
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
                            >
                              <Monitor className="h-3 w-3" />
                              <span>{isEn ? '🚀 Launch Chrome' : '🚀 Mở Chrome Này'}</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: STATIC PROXIES */}
        <TabsContent value={PROXY_REFERENCES.key}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-amber-500" />
                    <span>
                      {isEn
                        ? `Static Residential IPv4 Proxy Clusters: 1 Proxy ≤ 2 Vias (${proxies.length})`
                        : `Bảng Phân Cụm Proxy IPv4 Dân Cư Tĩnh: 1 Proxy ≤ 2 Via Cùng Cụm (${proxies.length})`}
                    </span>
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {isEn
                      ? 'Separate IPv4 residential lines by BM cluster so an IP flag never cascades across your entire Via fleet.'
                      : 'Phân tách dải IP dân cư tĩnh (Viettel / VNPT / FPT) theo từng cụm BM (tối đa 1–2 Via/Proxy) để không bao giờ bị Meta quét trùng IP chết chùm.'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setCreateProxyOpen(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isEn ? '+ Add Static Proxy' : '+ Thêm Tuyến Proxy Mới'}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-y border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      <th className="px-3.5 py-2.5">{isEn ? '1. Proxy Line / Cluster Label' : '1. Tên Tuyến Mạng / Cụm Proxy'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '2. ISP Provider & Region' : '2. Nhà Mạng & Khu Vực'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '3. Load Safety (≤ 2 Vias)' : '3. Tải An Toàn (≤ 2 Via/Proxy)'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '4. Vias Routed on This IP' : '4. Các Via Đang Đi Qua Tuyến Này'}</th>
                      <th className="px-3.5 py-2.5">{isEn ? '5. Extension Setup' : '5. Cài Vào Tiện Ích Chrome'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {proxies.map((pr) => (
                      <tr key={pr.id} className="align-top hover:bg-surface-muted/30 transition">
                        <td className="px-3.5 py-3">
                          <div className="font-bold text-ink">{pr.label}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{pr.notes}</div>
                        </td>

                        <td className="px-3.5 py-3">
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                            🌐 {pr.provider} · {pr.country}-{pr.region} ({pr.protocol})
                          </span>
                        </td>

                        <td className="px-3.5 py-3">
                          {pr.isolation_status === 'SAFE' ? (
                            <Badge tone="positive">
                              {isEn
                                ? `🟢 Safe Load (${pr.via_count}/2 Vias)`
                                : `🟢 Đúng chuẩn (${pr.via_count}/2 Via)`}
                            </Badge>
                          ) : (
                            <Badge tone="attention">
                              {isEn
                                ? `🔴 Overloaded (${pr.via_count}/2 Vias)`
                                : `🔴 Quá tải (${pr.via_count}/2 Via — Cần tách bớt)`}
                            </Badge>
                          )}
                        </td>

                        <td className="px-3.5 py-3">
                          {pr.assigned_vias.length === 0 ? (
                            <span className="text-ink-faint">{isEn ? 'Standby line (0 Vias)' : 'Tuyến dự phòng (0 Via)'}</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {pr.assigned_vias.map((v) => (
                                <Link
                                  key={v.id}
                                  to={`/facebook-accounts/${v.id}`}
                                  className="inline-flex items-center gap-1 rounded border border-line bg-surface-muted px-2 py-0.5 font-medium text-ink hover:border-brand"
                                >
                                  <span>🛡️ {v.label}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="px-3.5 py-3">
                          <Link
                            to="/chrome-extension"
                            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand-text hover:opacity-90"
                          >
                            <span>{isEn ? 'Configure in Extension →' : 'Nạp vào Extension →'}</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PIXEL MODAL */}
      {(editingPixel || createPixelOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-base font-bold text-ink">
                {editingPixel
                  ? isEn
                    ? `Configure Pixel & Partner Accounts: ${editingPixel.name}`
                    : `Phân quyền Dataset / Pixel & Gán TKQC: ${editingPixel.name}`
                  : isEn
                    ? 'Add New Dataset / Meta Pixel'
                    : 'Thêm Dataset / Meta Pixel Mới'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditingPixel(null)
                  setCreatePixelOpen(false)
                }}
                className="rounded p-1 text-ink-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">{isEn ? 'Dataset / Pixel Name *' : 'Tên Dataset / Pixel *'}</label>
                <input
                  type="text"
                  value={pxName}
                  onChange={(e) => setPxName(e.target.value)}
                  className="input text-xs"
                  placeholder="VD: Pixel Tbsupellex Official"
                />
              </div>
              <div>
                <label className="label text-xs">{isEn ? 'Meta Pixel ID' : 'Pixel ID trên Meta'}</label>
                <input
                  type="text"
                  value={pxExtId}
                  onChange={(e) => setPxExtId(e.target.value)}
                  className="input font-mono text-xs"
                  placeholder="VD: 208326118857780"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label text-xs">{isEn ? 'Owner Business Manager' : 'BM Gốc Sở Hữu Pixel'}</label>
                <select value={pxBmId} onChange={(e) => setPxBmId(e.target.value)} className="input text-xs">
                  <option value="">{isEn ? '— Select Owner BM —' : '— Chọn BM Sở hữu —'}</option>
                  {allBms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {String(b.name ?? b.id)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-line bg-surface-muted/40 p-3">
              <div className="text-xs font-bold text-ink">
                {isEn
                  ? `Ad Accounts Shared with This Pixel (${pxAccIds.length})`
                  : `Chọn Các TKQC Được Share Quyền Sử Dụng Pixel Này (${pxAccIds.length})`}
              </div>
              <div className="max-h-44 overflow-y-auto rounded border border-line bg-surface p-2 grid gap-1.5 sm:grid-cols-2">
                {allAccounts.map((acc) => {
                  const checked = pxAccIds.includes(acc.id)
                  const isBad = acc.status === 'restricted' || acc.status === 'disabled'
                  return (
                    <label
                      key={acc.id}
                      className={`flex cursor-pointer items-center gap-2 rounded border p-1.5 text-xs ${
                        checked ? 'border-brand bg-brand-light/30' : 'border-line/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setPxAccIds((prev) =>
                            prev.includes(acc.id) ? prev.filter((i) => i !== acc.id) : [...prev, acc.id],
                          )
                        }
                      />
                      <span className="truncate">
                        {isBad ? '🔴' : '🟢'} {acc.display_name}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingPixel(null)
                  setCreatePixelOpen(false)
                }}
              >
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              {editingPixel ? (
                <Button
                  size="sm"
                  disabled={!pxName.trim() || assignPixelMut.isPending}
                  onClick={() =>
                    assignPixelMut.mutate({
                      pixelId: editingPixel.id,
                      name: pxName,
                      external_pixel_id: pxExtId,
                      owner_bm_id: pxBmId,
                      ad_account_ids: pxAccIds,
                      notes: pxNotes,
                    })
                  }
                >
                  {isEn ? 'Save Pixel Links' : 'Lưu Phân Quyền Pixel'}
                </Button>
              ) : (
                <Button size="sm" disabled={!pxName.trim() || createPixelMut.isPending} onClick={() => createPixelMut.mutate()}>
                  {isEn ? 'Create Pixel' : 'Tạo Dataset / Pixel'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CARD MODAL */}
      {(editingCard || createCardOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-base font-bold text-ink">
                {editingCard
                  ? isEn
                    ? `Assign Ad Accounts to Card: ${editingCard.label} (Max 3 Recommended)`
                    : `Gán / Gỡ TKQC cho Thẻ: ${editingCard.label} (Khuyến nghị ≤ 3 TKQC)`
                  : isEn
                    ? 'Add Payment Card Reference'
                    : 'Thêm Thẻ Thanh Toán Mới'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditingCard(null)
                  setCreateCardOpen(false)
                }}
                className="rounded p-1 text-ink-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!editingCard && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label text-xs">{isEn ? 'Card Reference (Last 4 digits) *' : 'Mã Thẻ (4 số cuối) *'}</label>
                  <input
                    type="text"
                    value={cardCode}
                    onChange={(e) => setCardCode(e.target.value)}
                    placeholder="VD: VISA *9988"
                    className="input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">{isEn ? 'Card Network' : 'Loại Thẻ'}</label>
                  <select value={cardProvider} onChange={(e) => setCardProvider(e.target.value)} className="input text-xs">
                    <option value="VISA">VISA</option>
                    <option value="MASTERCARD">MASTERCARD</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="label text-xs">{isEn ? 'Display Label' : 'Tên Gợi Nhớ Thẻ'}</label>
              <input
                type="text"
                value={cardLabel}
                onChange={(e) => setCardLabel(e.target.value)}
                placeholder="VD: Visa ···· 9988 (Techcombank - Cụm QCT)"
                className="input text-xs"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-line bg-surface-muted/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink">
                  {isEn
                    ? `Ad Accounts Using This Card (${cardAccIds.length}/3 Safe Limit)`
                    : `Chọn TKQC Gắn Thẻ Này (${cardAccIds.length}/3 Ngưỡng An Toàn)`}
                </span>
                {cardAccIds.length > 3 && (
                  <span className="text-[11px] font-bold text-rose-600">
                    ⚠️ {isEn ? 'Exceeds 3 Ad Accounts safety rule!' : 'Đang vượt quá 3 TKQC/Thẻ!'}
                  </span>
                )}
              </div>
              <div className="max-h-44 overflow-y-auto rounded border border-line bg-surface p-2 grid gap-1.5 sm:grid-cols-2">
                {allAccounts.map((acc) => {
                  const checked = cardAccIds.includes(acc.id)
                  const isBad = acc.status === 'restricted' || acc.status === 'disabled'
                  return (
                    <label
                      key={acc.id}
                      className={`flex cursor-pointer items-center gap-2 rounded border p-1.5 text-xs ${
                        checked ? 'border-brand bg-brand-light/30' : 'border-line/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCardAccIds((prev) =>
                            prev.includes(acc.id) ? prev.filter((i) => i !== acc.id) : [...prev, acc.id],
                          )
                        }
                      />
                      <span className="truncate">
                        {isBad ? '🔴' : '🟢'} {acc.display_name}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingCard(null)
                  setCreateCardOpen(false)
                }}
              >
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              {editingCard ? (
                <Button
                  size="sm"
                  disabled={assignCardMut.isPending}
                  onClick={() =>
                    assignCardMut.mutate({
                      cardId: editingCard.id,
                      label: cardLabel,
                      ad_account_ids: cardAccIds,
                      notes: cardNotes,
                    })
                  }
                >
                  {isEn ? 'Save Card Assignments' : 'Lưu Gán Thẻ'}
                </Button>
              ) : (
                <Button size="sm" disabled={!cardCode.trim() || createCardMut.isPending} onClick={() => createCardMut.mutate()}>
                  {isEn ? 'Add Card' : 'Thêm Thẻ Mới'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BROWSER PROFILE MODAL */}
      {createBrowserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-ink">
              {isEn ? 'Add Isolated Chrome Profile' : 'Thêm Hồ Sơ Google Chrome Cách Ly'}
            </h2>
            <div>
              <label className="label text-xs">{isEn ? 'Chrome Profile Label *' : 'Tên Thư Mục Hồ Sơ Chrome *'}</label>
              <input
                type="text"
                value={browserRef}
                onChange={(e) => setBrowserRef(e.target.value)}
                placeholder="VD: Chrome — Profile 15 · Via Dự Phòng #3"
                className="input text-xs"
              />
            </div>
            <div>
              <label className="label text-xs">{isEn ? 'Notes' : 'Ghi chú cách ly'}</label>
              <input
                type="text"
                value={browserNotes}
                onChange={(e) => setBrowserNotes(e.target.value)}
                placeholder="VD: Dành riêng cho Via Dự Phòng BM Quảng Cáo Top"
                className="input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setCreateBrowserOpen(false)}>
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              <Button size="sm" disabled={!browserRef.trim() || createBrowserMut.isPending} onClick={() => createBrowserMut.mutate()}>
                {isEn ? 'Add Profile' : 'Lưu Hồ Sơ Chrome'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* PROXY MODAL */}
      {createProxyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-ink">
              {isEn ? 'Add Static Residential IPv4 Proxy Line' : 'Thêm Tuyến Proxy IPv4 Dân Cư Tĩnh'}
            </h2>
            <div>
              <label className="label text-xs">{isEn ? 'Cluster / Proxy Label *' : 'Tên Tuyến Proxy / Cụm BM *'}</label>
              <input
                type="text"
                value={proxyRef}
                onChange={(e) => setProxyRef(e.target.value)}
                placeholder="VD: Proxy Dân cư Tĩnh VN #6 — Cụm BM Mới"
                className="input text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">{isEn ? 'ISP Provider' : 'Nhà Mạng ISP'}</label>
                <input
                  type="text"
                  value={proxyProvider}
                  onChange={(e) => setProxyProvider(e.target.value)}
                  placeholder="Viettel IDC / VNPT / FPT"
                  className="input text-xs"
                />
              </div>
              <div>
                <label className="label text-xs">{isEn ? 'Region' : 'Khu Vực'}</label>
                <input
                  type="text"
                  value={proxyRegion}
                  onChange={(e) => setProxyRegion(e.target.value)}
                  placeholder="HCM / HN"
                  className="input text-xs"
                />
              </div>
            </div>
            <div>
              <label className="label text-xs">{isEn ? 'Notes' : 'Ghi chú'}</label>
              <input
                type="text"
                value={proxyNotes}
                onChange={(e) => setProxyNotes(e.target.value)}
                placeholder="VD: Tối đa 2 Via thuộc cùng cụm BM"
                className="input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setCreateProxyOpen(false)}>
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              <Button size="sm" disabled={!proxyRef.trim() || createProxyMut.isPending} onClick={() => createProxyMut.mutate()}>
                {isEn ? 'Add Proxy Line' : 'Lưu Tuyến Proxy'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
