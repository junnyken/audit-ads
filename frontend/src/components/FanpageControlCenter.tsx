import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flag,
  Globe,
  Layers,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { launchInAssignedChromeProfile } from '../lib/chromeProfileLauncher'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from './primitives/card'

export interface LinkedAdAccountItem {
  id: string
  link_id: string | null
  display_name: string
  external_account_id: string | null
  status: string
  currency: string
}

export interface FanpageSummaryItem {
  id: string
  name: string
  external_page_id: string | null
  url: string | null
  category: string | null
  status: string
  notes: string
  created_at: string | null
  updated_at: string | null
  archived_at: string | null
  health_status: 'LIVE' | 'RESTRICTED' | 'UNPUBLISHED' | 'APPEAL'
  is_published: boolean
  verification_status: string
  fan_count: number | null
  followers_count: number | null
  picture_url: string | null
  tasks: string[]
  source_edge: string
  owner_bm_id: string | null
  owner_bm_name: string | null
  owner_bm_external_id: string | null
  holder_identity_id: string | null
  holder_label: string | null
  holder_external_id: string | null
  holder_browser_profile: string
  holder_network_label: string
  linked_ad_accounts: LinkedAdAccountItem[]
  linked_ad_account_count: number
  restricted_ad_account_count: number
  contagion_risk: 'SAFE' | 'MEDIUM' | 'HIGH'
  last_synced_at: string | null
}

export interface FanpageSummaryResponse {
  items: FanpageSummaryItem[]
  summary: {
    total_pages: number
    live_pages: number
    restricted_or_unpublished_pages: number
    contagion_risk_pages: number
    isolated_with_holder_pages: number
    total_followers: number
  }
}

export default function FanpageControlCenter({ embedded = false }: { embedded?: boolean }) {
  const { language } = useI18n()
  const isEn = language === 'en'
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'LIVE' | 'RESTRICTED' | 'CONTAGION'>('ALL')
  const [bmFilter, setBmFilter] = useState<string>('ALL')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [bannerMsg, setBannerMsg] = useState<string | null>(null)
  const [checkingPageId, setCheckingPageId] = useState<string | null>(null)
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({})

  // Modal state for Edit / Governance / Link Ad Accounts
  const [editingPage, setEditingPage] = useState<FanpageSummaryItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // Form fields for Edit / Create
  const [formName, setFormName] = useState('')
  const [formExtId, setFormExtId] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formHealth, setFormHealth] = useState<'LIVE' | 'RESTRICTED' | 'UNPUBLISHED' | 'APPEAL'>('LIVE')
  const [formBmId, setFormBmId] = useState('')
  const [formHolderId, setFormHolderId] = useState('')
  const [formAccountIds, setFormAccountIds] = useState<string[]>([])
  const [formNotes, setFormNotes] = useState('')

  const pagesSummaryQ = useQuery({
    queryKey: ['facebook-pages-summary'],
    queryFn: () => api.get<FanpageSummaryResponse>('/api/v1/facebook-pages/summary'),
  })

  const bmsQ = useQuery({
    queryKey: ['business-managers-all'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
  })

  const viasQ = useQuery({
    queryKey: ['personal-account-references-all'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=200'),
  })

  const accountsQ = useQuery({
    queryKey: ['ad-accounts-all-for-pages'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const syncMetaMut = useMutation({
    mutationFn: () =>
      api.post<FanpageSummaryResponse & { synced_count: number; new_count: number; linked_account_count: number }>(
        '/api/v1/facebook-pages/sync-meta',
        {},
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      setBannerMsg(
        isEn
          ? `✅ Synced ${res.synced_count} Fanpages from Meta Graph API (${res.new_count} newly added, ${res.linked_account_count} ad account links updated).`
          : `✅ Đã quét & đồng bộ ${res.synced_count} Fanpage từ Meta Graph API (${res.new_count} Page mới, ${res.linked_account_count} liên kết TKQC được cập nhật).`,
      )
    },
  })

  const checkLiveMut = useMutation({
    mutationFn: (pageId: string) => {
      setCheckingPageId(pageId)
      return api.post<{ probed_graph_api: boolean; item: FanpageSummaryItem }>(
        `/api/v1/facebook-pages/${pageId}/check-live`,
        {},
      )
    },
    onSuccess: (res) => {
      setCheckingPageId(null)
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      if (res.item) {
        setBannerMsg(
          isEn
            ? `🔍 Checked live status for "${res.item.name}": ${res.item.health_status}${res.item.followers_count ? ` · ${res.item.followers_count.toLocaleString()} followers` : ''}.`
            : `🔍 Đã kiểm tra trạng thái thực tế Page «${res.item.name}»: ${res.item.health_status === 'LIVE' ? 'Đang Live (Hiển thị tốt)' : res.item.health_status}${res.item.followers_count ? ` · ${res.item.followers_count.toLocaleString()} lượt theo dõi` : ''}.`,
        )
      }
    },
    onError: () => {
      setCheckingPageId(null)
    },
  })

  const assignMut = useMutation({
    mutationFn: (payload: {
      pageId: string
      name: string
      external_page_id: string
      url: string
      category: string
      health_status: string
      owner_bm_id: string
      holder_identity_id: string
      ad_account_ids: string[]
      notes: string
    }) => {
      const { pageId, ...body } = payload
      return api.post(`/api/v1/facebook-pages/${pageId}/assign`, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      setEditingPage(null)
      setBannerMsg(
        isEn
          ? '✅ Saved Fanpage governance, holding Via/BM, and linked Ad Accounts.'
          : '✅ Đã lưu cấu hình phân quyền Fanpage, BM/Via Tổng giữ Page và danh sách TKQC được phép chạy.',
      )
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const created = await api.post<ReferenceRecord>('/api/v1/pages', {
        name: formName.trim(),
        external_page_id: formExtId.trim() || null,
        url: formUrl.trim() || (formExtId.trim() ? `https://www.facebook.com/${formExtId.trim()}` : null),
        category: formCategory.trim() || (isEn ? 'Business / Brand Page' : 'Trang Doanh nghiệp / Thương hiệu'),
        status: formHealth === 'LIVE' ? 'active' : 'inactive',
        notes: formNotes.trim(),
      })
      await api.post(`/api/v1/facebook-pages/${created.id}/assign`, {
        name: formName.trim(),
        external_page_id: formExtId.trim(),
        url: formUrl.trim() || (formExtId.trim() ? `https://www.facebook.com/${formExtId.trim()}` : ''),
        category: formCategory.trim() || (isEn ? 'Business / Brand Page' : 'Trang Doanh nghiệp / Thương hiệu'),
        health_status: formHealth,
        owner_bm_id: formBmId,
        holder_identity_id: formHolderId,
        ad_account_ids: formAccountIds,
        notes: formNotes.trim(),
      })
      return created
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      setCreateOpen(false)
      setBannerMsg(
        isEn
          ? '✅ Created new Fanpage and linked its Holding BM, Tier-1 Via, and Ad Accounts.'
          : '✅ Đã thêm Fanpage mới và gán BM sở hữu, Via Tổng giữ Page cùng các TKQC liên kết.',
      )
    },
  })

  const items = pagesSummaryQ.data?.items ?? []
  const summary = pagesSummaryQ.data?.summary ?? {
    total_pages: 0,
    live_pages: 0,
    restricted_or_unpublished_pages: 0,
    contagion_risk_pages: 0,
    isolated_with_holder_pages: 0,
    total_followers: 0,
  }

  const allBms = bmsQ.data?.items ?? []
  const allVias = viasQ.data?.items ?? []
  const allAccounts = accountsQ.data?.items ?? []

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (healthFilter === 'LIVE' && item.health_status !== 'LIVE') return false
      if (healthFilter === 'RESTRICTED' && item.health_status === 'LIVE') return false
      if (healthFilter === 'CONTAGION' && item.contagion_risk === 'SAFE') return false
      if (bmFilter !== 'ALL' && item.owner_bm_id !== bmFilter) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        (item.external_page_id ?? '').toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.owner_bm_name ?? '').toLowerCase().includes(q) ||
        (item.holder_label ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, search, healthFilter, bmFilter])

  const openEditModal = (item: FanpageSummaryItem) => {
    setEditingPage(item)
    setFormName(item.name)
    setFormExtId(item.external_page_id ?? '')
    setFormUrl(item.url ?? '')
    setFormCategory(item.category ?? '')
    setFormHealth(item.health_status)
    setFormBmId(item.owner_bm_id ?? '')
    setFormHolderId(item.holder_identity_id ?? '')
    setFormAccountIds(item.linked_ad_accounts.map((a) => a.id))
    setFormNotes(item.notes ?? '')
  }

  const openCreateModal = () => {
    setEditingPage(null)
    setFormName('')
    setFormExtId('')
    setFormUrl('')
    setFormCategory(isEn ? 'E-commerce / Brand Store' : 'Thương mại điện tử / Cửa hàng')
    setFormHealth('LIVE')
    setFormBmId(allBms[0]?.id ?? '')
    setFormHolderId(allVias[0]?.id ?? '')
    setFormAccountIds([])
    setFormNotes('')
    setCreateOpen(true)
  }

  const handleCopy = (val: string) => {
    void navigator.clipboard.writeText(val)
    setCopiedId(val)
    setTimeout(() => setCopiedId((prev) => (prev === val ? null : prev)), 1500)
  }

  const handleQuickUnlinkDisabled = (item: FanpageSummaryItem) => {
    const cleanIds = item.linked_ad_accounts
      .filter((a) => a.status !== 'restricted' && a.status !== 'disabled')
      .map((a) => a.id)
    assignMut.mutate({
      pageId: item.id,
      name: item.name,
      external_page_id: item.external_page_id ?? '',
      url: item.url ?? '',
      category: item.category ?? '',
      health_status: item.health_status,
      owner_bm_id: item.owner_bm_id ?? '',
      holder_identity_id: item.holder_identity_id ?? '',
      ad_account_ids: cleanIds,
      notes: item.notes,
    })
  }

  const toggleFormAccount = (accId: string) => {
    setFormAccountIds((prev) =>
      prev.includes(accId) ? prev.filter((id) => id !== accId) : [...prev, accId],
    )
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">
              {isEn ? 'Fanpage Control Center & Asset Isolation' : 'Trung tâm Quản trị Fanpage & Cách ly Tài sản'}
            </h1>
            <p className="text-xs text-ink-muted">
              {isEn
                ? 'Centralized Fanpage governance: hold Pages in Tier-1 Asset Vias & Central BMs, monitor Page publishing/restriction health, and prevent contagion bans from disabled Ad Accounts.'
                : 'Quản lý tập trung toàn bộ Fanpage: giữ quyền Admin gốc tại Via Tổng (Lớp 1) & BM Trung tâm, giám sát sức khỏe Page (Live / Hạn chế QC / Hủy đăng) và chặn chết liên đới từ TKQC bị khóa.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/operations-guide"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-light px-3 py-1.5 text-xs font-bold text-brand-text hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isEn ? '📖 Anti-Contagion Page Playbook →' : '📖 Quy tắc Bảo vệ Fanpage Chống Đỏ Page →'}</span>
            </Link>
          </div>
        </div>
      )}

      {/* GOLDEN RULE BANNER FOR FANPAGES */}
      <div className="rounded-xl border border-brand/30 bg-brand-light/30 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-brand-text">
              <ShieldCheck className="h-4 w-4" />
              <span>
                {isEn
                  ? 'GOLDEN RULE: ISOLATE FANPAGE ADMIN FROM AD CAMPAIGN VIAS'
                  : 'NGUYÊN TẮC VÀNG: TÁCH BẠCH QUYỀN SỞ HỮU FANPAGE KHỎI VIA LÊN CAMP'}
              </span>
            </div>
            <p data-detail-only="true" className="text-xs text-ink-muted">
              {isEn
                ? '1. Hold Fanpage Admin inside Central BM + Tier-1 Asset Via (never launch risky ads directly from the Via holding Page Admin) · 2. Share Page access to maximum 1–3 clean Ad Accounts · 3. Immediately unlink any Restricted/Disabled Ad Account to prevent reverse Page bans.'
                : '1. Giữ quyền Admin gốc của Fanpage tại BM Trung tâm + Via Tổng Lớp 1 (tuyệt đối không lấy Via cầm Page gốc đi bấm lên chiến dịch nhạy cảm) · 2. Mỗi Page chỉ nên gắn chạy cho 1–3 TKQC sạch cùng ngành · 3. Gỡ ngay các TKQC bị Vô hiệu hóa/Đỏ thẻ khỏi Page để tránh chết ngược Fanpage.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => syncMetaMut.mutate()}
              disabled={syncMetaMut.isPending}
              className="gap-1.5 font-semibold"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMetaMut.isPending ? 'animate-spin' : ''}`} />
              <span>
                {syncMetaMut.isPending
                  ? isEn
                    ? 'Scanning Meta Graph API...'
                    : 'Đang quét Meta Graph API...'
                  : isEn
                    ? '🔄 Sync Fanpages & Check Health from Meta'
                    : '🔄 Đồng bộ Fanpage & Quét Sức khỏe từ Meta'}
              </span>
            </Button>
            <Button size="sm" onClick={openCreateModal} className="gap-1.5 font-semibold">
              <Plus className="h-3.5 w-3.5" />
              <span>{isEn ? '+ Add Fanpage' : '+ Thêm Fanpage mới'}</span>
            </Button>
          </div>
        </div>
      </div>

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="rounded p-0.5 hover:bg-emerald-500/20"
            aria-label={isEn ? 'Close notification' : 'Đóng thông báo'}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 5 KPI CARDS (Hidden when embedded inside /assets to prevent duplicate KPI rows) */}
      {!embedded && (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setHealthFilter('ALL')}
          className={`rounded-xl border p-3.5 text-left transition ${
            healthFilter === 'ALL' ? 'border-brand bg-brand-light/20' : 'border-line bg-surface hover:border-brand/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Total Managed Fanpages' : 'Tổng Fanpage Quản Lý'}</span>
            <Flag className="h-4 w-4 text-brand-text" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-ink">{summary.total_pages}</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {summary.total_followers > 0
              ? isEn
                ? `${summary.total_followers.toLocaleString()} total followers across BMs`
                : `Tổng ${summary.total_followers.toLocaleString()} lượt theo dõi trên dàn BM`
              : isEn
                ? 'Synced from Business Managers & Via tokens'
                : 'Đồng bộ từ dàn BM & Token Via'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setHealthFilter('LIVE')}
          className={`rounded-xl border p-3.5 text-left transition ${
            healthFilter === 'LIVE'
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-line bg-surface hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span>{isEn ? '🟢 Live & Ready Pages' : '🟢 Page Đang Live (Sạch)'}</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {summary.live_pages}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Published & eligible for ad delivery' : 'Đang hiển thị công khai & chạy QC bình thường'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setHealthFilter('RESTRICTED')}
          className={`rounded-xl border p-3.5 text-left transition ${
            healthFilter === 'RESTRICTED'
              ? 'border-rose-500 bg-rose-500/10'
              : 'border-line bg-surface hover:border-rose-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-rose-600 dark:text-rose-400">
            <span>{isEn ? '🔴 Restricted / Unpublished' : '🔴 Hạn chế QC / Hủy đăng'}</span>
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-rose-600 dark:text-rose-400">
            {summary.restricted_or_unpublished_pages}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Needs appeal or immediate replacement' : 'Cần kháng nghị hoặc thay Page dự phòng'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setHealthFilter('CONTAGION')}
          className={`rounded-xl border p-3.5 text-left transition ${
            healthFilter === 'CONTAGION'
              ? 'border-amber-500 bg-amber-500/10'
              : 'border-line bg-surface hover:border-amber-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400">
            <span>{isEn ? '⚠️ Contagion Risk (Ad Accounts)' : '⚠️ Rủi ro Chết Liên Đới'}</span>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-amber-600 dark:text-amber-400">
            {summary.contagion_risk_pages}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Linked to disabled ad accounts or > 3 accounts' : 'Đang gắn TKQC bị khóa hoặc > 3 TKQC/Page'}
          </div>
        </button>

        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? '🛡️ Tier-1 Via & BM Isolation' : '🛡️ Cách Ly Via Tổng & BM'}</span>
            <UserRoundCog className="h-4 w-4 text-brand-text" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-ink">
            {summary.isolated_with_holder_pages}/{summary.total_pages}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Pages mapped to Holding BM & Chrome Profile' : 'Page đã định danh BM & Hồ sơ Chrome giữ gốc'}
          </div>
        </div>
      </div>
      )}

      {/* FILTER & SEARCH BAR */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isEn
                    ? 'Search by Fanpage name, Page ID, Category, Holding BM, or Via...'
                    : 'Tìm theo tên Fanpage, Page ID, Ngành hàng, Tên BM hoặc Via giữ Page...'
                }
                className="input pl-9 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bmFilter}
                onChange={(e) => setBmFilter(e.target.value)}
                className="input h-9 w-auto text-xs font-medium"
                aria-label={isEn ? 'Filter by Business Manager' : 'Lọc theo Business Manager'}
              >
                <option value="ALL">
                  {isEn ? `🏛️ All Business Managers (${allBms.length})` : `🏛️ Tất cả BM (${allBms.length})`}
                </option>
                {allBms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {String(b.name ?? b.id)}
                  </option>
                ))}
              </select>

              <div className="flex items-center rounded-lg border border-line bg-surface-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setHealthFilter('ALL')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    healthFilter === 'ALL' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? 'All' : 'Tất cả'} ({items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHealthFilter('LIVE')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    healthFilter === 'LIVE' ? 'bg-surface text-emerald-600 shadow-xs' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? '🟢 Live' : '🟢 Đang Live'} ({summary.live_pages})
                </button>
                <button
                  type="button"
                  onClick={() => setHealthFilter('RESTRICTED')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    healthFilter === 'RESTRICTED'
                      ? 'bg-surface text-rose-600 shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? '🔴 Restricted' : '🔴 Hạn chế / Ẩn'} ({summary.restricted_or_unpublished_pages})
                </button>
                <button
                  type="button"
                  onClick={() => setHealthFilter('CONTAGION')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    healthFilter === 'CONTAGION'
                      ? 'bg-surface text-amber-600 shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? '⚠️ Contagion Risk' : '⚠️ Rủi ro liên đới'} ({summary.contagion_risk_pages})
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MAIN FANPAGE CONTROL TABLE */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-brand-text" />
              <span>
                {isEn
                  ? `Managed Fanpages & Ad Account Isolation Matrix (${filteredItems.length})`
                  : `Bảng Phân Quyền Fanpage, Sức Khỏe Page & Ma Trận Gắn TKQC (${filteredItems.length})`}
              </span>
            </CardTitle>
            <span className="text-[11px] text-ink-muted">
              {isEn
                ? 'Safe threshold: 1 Fanpage ≤ 3 Active Ad Accounts in the same niche'
                : 'Ngưỡng an toàn: 1 Fanpage ≤ 3 TKQC đang chạy cùng ngành hàng'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-y border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  <th className="px-3.5 py-2.5">{isEn ? '1. Fanpage & Page ID' : '1. Trang Fanpage & Định danh'}</th>
                  <th className="px-3.5 py-2.5">{isEn ? '2. Page Health & Status' : '2. Sức khỏe Page'}</th>
                  <th className="px-3.5 py-2.5">{isEn ? '3. Holding BM & Tier-1 Via' : '3. BM Sở hữu & Via Giữ Page'}</th>
                  <th className="px-3.5 py-2.5">
                    {isEn ? '4. Linked Ad Accounts & Contagion' : '4. TKQC Đang Chạy & Liên Đới'}
                  </th>
                  <th className="px-3.5 py-2.5">
                    {isEn ? '5. 1-Click Chrome & Appeal' : '5. Mở Chrome & Kháng Nghị Page'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pagesSummaryQ.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                      {isEn ? 'Loading Fanpage inventory...' : 'Đang tải danh sách Fanpage...'}
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                      <div className="mx-auto max-w-md space-y-2">
                        <div className="font-semibold text-ink">
                          {isEn ? 'No Fanpages matched your current filter' : 'Chưa có Fanpage nào khớp bộ lọc hiện tại'}
                        </div>
                        <p className="text-xs">
                          {isEn
                            ? 'Click "Sync Fanpages & Check Health from Meta" to pull Pages from all Business Managers and Via tokens, or add a Fanpage manually.'
                            : 'Hãy bấm nút «Đồng bộ Fanpage & Quét Sức khỏe từ Meta» để tự động kéo toàn bộ Page từ dàn BM và Token Via về bảng, hoặc thêm Fanpage mới.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const extId = item.external_page_id ?? ''
                    const pageUrl = item.url || (extId ? `https://www.facebook.com/${extId}` : '')
                    const qualityUrl = extId
                      ? `https://business.facebook.com/accountquality/?landing_page=overview${
                          item.owner_bm_external_id ? `&business_id=${item.owner_bm_external_id}` : ''
                        }`
                      : 'https://business.facebook.com/accountquality'
                    const bmPageSettingsUrl =
                      extId && item.owner_bm_external_id
                        ? `https://business.facebook.com/settings/pages/${extId}?business_id=${item.owner_bm_external_id}`
                        : pageUrl || 'https://business.facebook.com/settings/pages'

                    return (
                      <tr key={item.id} className="align-top hover:bg-surface-muted/30 transition">
                        {/* COL 1: FANPAGE IDENTITY */}
                        <td className="px-3.5 py-3">
                          <div className="flex items-start gap-2.5">
                            {item.picture_url && !brokenImages[item.id] ? (
                              <img
                                src={item.picture_url}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                onError={() => setBrokenImages((prev) => ({ ...prev, [item.id]: true }))}
                                className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand/40 bg-brand-light text-xs font-extrabold text-brand-text shadow-xs">
                                {item.name
                                  .split(/\s+/)
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((w) => w[0])
                                  .join('')
                                  .toUpperCase() || item.name.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {pageUrl ? (
                                  <a
                                    href={pageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-bold text-ink hover:text-brand-text hover:underline"
                                  >
                                    {item.name}
                                  </a>
                                ) : (
                                  <span className="font-bold text-ink">{item.name}</span>
                                )}
                                {item.verification_status === 'blue_verified' && (
                                  <span
                                    title={isEn ? 'Blue Verified Fanpage' : 'Fanpage Tích Xanh'}
                                    className="inline-flex items-center rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-600"
                                  >
                                    ✓ Verified
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-muted">
                                <span>ID: {extId || (isEn ? 'Not set' : 'Chưa gán ID')}</span>
                                {extId && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(extId)}
                                    className="inline-flex items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-sans hover:border-brand"
                                    title={isEn ? 'Copy Page ID' : 'Sao chép Page ID'}
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

                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                                <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium text-ink">
                                  🏷️ {item.category || (isEn ? 'Brand Page' : 'Trang Thương hiệu')}
                                </span>
                                {(item.followers_count !== null || item.fan_count !== null) && (
                                  <span className="rounded bg-brand-light/50 px-1.5 py-0.5 font-semibold text-brand-text">
                                    👥 {(item.followers_count ?? item.fan_count ?? 0).toLocaleString()}{' '}
                                    {isEn ? 'followers' : 'theo dõi'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* COL 2: PAGE HEALTH & LIVE CHECK */}
                        <td className="px-3.5 py-3">
                          <div className="space-y-1.5">
                            {item.health_status === 'LIVE' && (
                              <Badge tone="positive">
                                {isEn ? '🟢 Live · Advertising Active' : '🟢 Đang Live · Chạy QC Tốt'}
                              </Badge>
                            )}
                            {item.health_status === 'RESTRICTED' && (
                              <Badge tone="attention">
                                {isEn ? '🔴 Restricted from Advertising' : '🔴 Hạn chế Quảng cáo (Đỏ Page)'}
                              </Badge>
                            )}
                            {item.health_status === 'APPEAL' && (
                              <Badge tone="caution">
                                {isEn ? '🟡 Appeal Submitted (Waiting)' : '🟡 Đang Kháng Nghị Meta'}
                              </Badge>
                            )}
                            {item.health_status === 'UNPUBLISHED' && (
                              <Badge tone="muted">
                                {isEn ? '⚪ Unpublished / Hidden Page' : '⚪ Đã Hủy Đăng (Ẩn Page)'}
                              </Badge>
                            )}

                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              <button
                                type="button"
                                onClick={() => checkLiveMut.mutate(item.id)}
                                disabled={checkingPageId === item.id}
                                className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                              >
                                <RefreshCw
                                  className={`h-3 w-3 ${checkingPageId === item.id ? 'animate-spin text-brand-text' : ''}`}
                                />
                                <span>
                                  {checkingPageId === item.id
                                    ? isEn
                                      ? 'Checking...'
                                      : 'Đang kiểm...'
                                    : isEn
                                      ? 'Check Live'
                                      : 'Kiểm tra Live'}
                                </span>
                              </button>
                            </div>

                            <div data-detail-only="true" className="text-[10px] text-ink-faint">
                              {item.tasks.includes('MANAGE')
                                ? isEn
                                  ? '🔑 Full Admin (MANAGE + ADVERTISE)'
                                  : '🔑 Quyền Quản trị viên (Full Admin)'
                                : isEn
                                  ? '🎯 Advertiser Role (ADVERTISE)'
                                  : '🎯 Quyền Nhà quảng cáo (Advertiser)'}
                            </div>
                          </div>
                        </td>

                        {/* COL 3: HOLDING BM & TIER-1 VIA */}
                        <td className="px-3.5 py-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-brand-text" />
                              {item.owner_bm_name ? (
                                <Link
                                  to="/business-managers"
                                  className="font-bold text-ink hover:text-brand-text hover:underline"
                                >
                                  {item.owner_bm_name}
                                </Link>
                              ) : (
                                <span className="text-ink-muted">
                                  {isEn ? 'Personal Page (Not in BM)' : 'Page Cá nhân (Chưa đưa vào BM)'}
                                </span>
                              )}
                            </div>

                            {item.holder_label && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                                  🛡️ {isEn ? 'Holder Via:' : 'Via giữ Page:'} {item.holder_label}
                                </span>
                                <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                                  💻 {item.holder_browser_profile}
                                </span>
                              </div>
                            )}

                            {item.notes && (
                              <div data-detail-only="true" className="text-[11px] text-ink-muted line-clamp-1" title={item.notes}>
                                📝 {item.notes}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* COL 4: LINKED AD ACCOUNTS & CONTAGION RISK */}
                        <td className="px-3.5 py-3">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.contagion_risk === 'HIGH' ? (
                                <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                                  ⚠️{' '}
                                  {isEn
                                    ? `Contagion Danger (${item.restricted_ad_account_count} Disabled Acc)`
                                    : `Nguy cơ chết liên đới (${item.restricted_ad_account_count} TKQC lỗi)`}
                                </span>
                              ) : item.contagion_risk === 'MEDIUM' ? (
                                <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                  ⚠️{' '}
                                  {isEn
                                    ? `${item.linked_ad_account_count} Ad Accounts (Limit ≤ 3)`
                                    : `Đang gắn ${item.linked_ad_account_count} TKQC (Khuyến nghị ≤ 3)`}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  ✅{' '}
                                  {isEn
                                    ? `Safe (${item.linked_ad_account_count}/3 Ad Accounts)`
                                    : `An toàn (${item.linked_ad_account_count}/3 TKQC)`}
                                </span>
                              )}

                              {item.restricted_ad_account_count > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleQuickUnlinkDisabled(item)}
                                  className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700"
                                >
                                  {isEn ? '⚡ Unlink Disabled Now' : '⚡ Gỡ TKQC lỗi ngay'}
                                </button>
                              )}
                            </div>

                            {item.linked_ad_accounts.length === 0 ? (
                              <div data-detail-only="true" className="text-[11px] text-ink-faint">
                                {isEn
                                  ? 'No Ad Account linked yet — click "Link Accounts" to assign'
                                  : 'Chưa gắn TKQC nào — bấm «Gán TKQC» để phân quyền chạy'}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {item.linked_ad_accounts.map((acc) => {
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
                                      title={`${acc.display_name} (${acc.external_account_id ?? ''}) - ${acc.status}`}
                                    >
                                      <span>{isBad ? '🔴' : '🟢'}</span>
                                      <span className="max-w-[140px] truncate">{acc.display_name}</span>
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* COL 5: 1-CLICK CHROME & GOVERNANCE ACTIONS */}
                        <td className="px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                launchInAssignedChromeProfile(
                                  bmPageSettingsUrl,
                                  item.holder_browser_profile || 'Profile 1',
                                  item.holder_label || item.name,
                                  item.holder_network_label,
                                )
                                setBannerMsg(
                                  isEn
                                    ? `🚀 Launched Chrome (${item.holder_browser_profile || 'Profile 1'}) for ${item.holder_label || item.name}`
                                    : `🚀 Đã mở Hồ sơ Chrome (${item.holder_browser_profile || 'Profile 1'}) của Via giữ Page: ${item.holder_label || item.name}`,
                                )
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
                              title={
                                isEn
                                  ? `Open ${item.holder_browser_profile} of ${item.holder_label ?? 'Holding Via'}`
                                  : `Mở đúng ${item.holder_browser_profile} của Via giữ Page (${item.holder_label ?? 'Via Tổng'})`
                              }
                            >
                              <Globe className="h-3 w-3" />
                              <span>{isEn ? '🚀 Open Holder Chrome' : '🚀 Mở Chrome Via Giữ'}</span>
                            </button>

                            <a
                              href={qualityUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                              title={
                                isEn
                                  ? 'Open Meta Account Quality to check Page restrictions or submit appeal'
                                  : 'Mở Trang Chất lượng Tài khoản Meta để kiểm tra hạn chế hoặc kháng nghị Page'
                              }
                            >
                              <ShieldAlert className="h-3 w-3" />
                              <span>{isEn ? 'Appeal / Quality' : 'Kháng nghị Page'}</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>

                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                            >
                              <Settings2 className="h-3 w-3 text-brand-text" />
                              <span>{isEn ? 'Link Accounts / Edit' : 'Gán TKQC / Phân quyền'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* MODAL FOR EDITING / CREATING FANPAGE & LINKING AD ACCOUNTS */}
      {(editingPage || createOpen) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">
                  {editingPage
                    ? isEn
                      ? `Configure Fanpage & Ad Account Access: ${editingPage.name}`
                      : `Phân quyền Fanpage & Gán TKQC chạy quảng cáo: ${editingPage.name}`
                    : isEn
                      ? 'Add New Fanpage & Assign Holding BM / Via'
                      : 'Thêm Fanpage mới & Gán BM / Via Tổng giữ Page'}
                </h2>
                <p className="text-xs text-ink-muted">
                  {isEn
                    ? 'Assign the Central Business Manager, Tier-1 Holding Via, Page Health status, and which Ad Accounts are allowed to run ads on this Page.'
                    : 'Chỉ định rõ BM Trung tâm sở hữu, Via Tổng (Lớp 1) cầm quyền Admin, trạng thái sức khỏe Page và chọn các TKQC được phép chạy quảng cáo trên Page này.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingPage(null)
                  setCreateOpen(false)
                }}
                className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">{isEn ? 'Fanpage Name *' : 'Tên Trang Fanpage *'}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={isEn ? 'e.g. Bep Meo Map Official' : 'VD: Bếp Mèo Mặp'}
                  className="input text-xs"
                />
              </div>

              <div>
                <label className="label text-xs">{isEn ? 'Meta Page ID' : 'Page ID trên Meta'}</label>
                <input
                  type="text"
                  value={formExtId}
                  onChange={(e) => setFormExtId(e.target.value)}
                  placeholder="VD: 310024955529015"
                  className="input font-mono text-xs"
                />
              </div>

              <div>
                <label className="label text-xs">{isEn ? 'Category / Niche' : 'Ngành hàng / Danh mục Page'}</label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder={isEn ? 'e.g. Restaurant / E-commerce' : 'VD: Quán ăn / Thời trang / Mỹ phẩm'}
                  className="input text-xs"
                />
              </div>

              <div>
                <label className="label text-xs">
                  {isEn ? 'Page Health Status' : 'Trạng thái Sức khỏe Page'}
                </label>
                <select
                  value={formHealth}
                  onChange={(e) =>
                    setFormHealth(e.target.value as 'LIVE' | 'RESTRICTED' | 'UNPUBLISHED' | 'APPEAL')
                  }
                  className="input text-xs font-semibold"
                >
                  <option value="LIVE">
                    {isEn ? '🟢 LIVE — Active & Eligible for Ads' : '🟢 Đang Live — Hiển thị & Chạy QC bình thường'}
                  </option>
                  <option value="RESTRICTED">
                    {isEn ? '🔴 RESTRICTED — Advertising Restricted' : '🔴 Hạn chế QC — Đỏ Page (Cấm chạy Ads)'}
                  </option>
                  <option value="APPEAL">
                    {isEn ? '🟡 APPEAL — Appeal Submitted to Meta' : '🟡 Đang kháng nghị — Chờ Meta duyệt lại'}
                  </option>
                  <option value="UNPUBLISHED">
                    {isEn ? '⚪ UNPUBLISHED — Hidden / Unpublished' : '⚪ Đã hủy đăng — Đang ẩn Page'}
                  </option>
                </select>
              </div>

              <div>
                <label className="label text-xs">
                  {isEn ? '🏛️ Holding Business Manager (Owner BM)' : '🏛️ BM Trung tâm Sở hữu Page'}
                </label>
                <select
                  value={formBmId}
                  onChange={(e) => setFormBmId(e.target.value)}
                  className="input text-xs"
                >
                  <option value="">{isEn ? '— Not in BM (Personal Page) —' : '— Chưa đưa vào BM (Page Cá nhân) —'}</option>
                  {allBms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {String(b.name ?? b.id)} {b.external_id ? `(${String(b.external_id)})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label text-xs">
                  {isEn ? '🛡️ Tier-1 Holding Via (Page Admin)' : '🛡️ Via Tổng (Lớp 1) Giữ Quyền Admin Gốc'}
                </label>
                <select
                  value={formHolderId}
                  onChange={(e) => setFormHolderId(e.target.value)}
                  className="input text-xs"
                >
                  <option value="">{isEn ? '— Auto-assign from BM Admin —' : '— Tự động lấy theo Admin BM —'}</option>
                  {allVias.map((v) => (
                    <option key={v.id} value={v.id}>
                      {String(v.label ?? v.id)}{' '}
                      {v.browser_profile_label ? `· 💻 ${String(v.browser_profile_label)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="label text-xs">{isEn ? 'Page URL' : 'Đường dẫn URL Fanpage'}</label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://www.facebook.com/..."
                  className="input text-xs"
                />
              </div>
            </div>

            {/* AD ACCOUNT LINKING MATRIX */}
            <div className="space-y-2 rounded-lg border border-line bg-surface-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                    <Link2 className="h-3.5 w-3.5 text-brand-text" />
                    <span>
                      {isEn
                        ? `Linked Ad Accounts Running on This Page (${formAccountIds.length} selected)`
                        : `Gán Tài Khoản Quảng Cáo (TKQC) Được Chạy Trên Page Này (${formAccountIds.length} TKQC)`}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    {isEn
                      ? 'Recommended: link 1–3 Active Ad Accounts per Page. Avoid linking Disabled/Restricted accounts.'
                      : 'Khuyến nghị an toàn: Gắn 1–3 TKQC đang hoạt động tốt. Tránh gắn các TKQC đang bị Vô hiệu hóa/Hạn chế.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {formBmId && (
                    <button
                      type="button"
                      onClick={() => {
                        const sameBmActiveIds = allAccounts
                          .filter(
                            (a) =>
                              a.business_manager_id === formBmId &&
                              a.status === 'active',
                          )
                          .slice(0, 3)
                          .map((a) => a.id)
                        setFormAccountIds(sameBmActiveIds)
                      }}
                      className="rounded border border-brand/40 bg-brand-light px-2 py-1 text-[10px] font-bold text-brand-text hover:opacity-90"
                    >
                      {isEn ? '⚡ Select Active Accounts in Same BM (≤3)' : '⚡ Chọn TKQC Sạch cùng BM (≤3)'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const cleanOnly = formAccountIds.filter((id) => {
                        const acc = allAccounts.find((a) => a.id === id)
                        return acc && acc.status === 'active'
                      })
                      setFormAccountIds(cleanOnly)
                    }}
                    className="rounded border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:border-brand"
                  >
                    {isEn ? '🧹 Uncheck Disabled Accounts' : '🧹 Bỏ chọn các TKQC bị khóa'}
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto rounded border border-line bg-surface p-2 grid gap-1.5 sm:grid-cols-2">
                {allAccounts.map((acc) => {
                  const checked = formAccountIds.includes(acc.id)
                  const isBad = acc.status === 'restricted' || acc.status === 'disabled'
                  return (
                    <label
                      key={acc.id}
                      className={`flex cursor-pointer items-center gap-2 rounded border p-1.5 text-xs transition ${
                        checked
                          ? isBad
                            ? 'border-rose-500 bg-rose-500/10'
                            : 'border-brand bg-brand-light/30'
                          : 'border-line/60 hover:bg-surface-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFormAccount(acc.id)}
                        className="rounded border-line"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 font-medium text-ink truncate">
                          <span>{isBad ? '🔴' : '🟢'}</span>
                          <span className="truncate">{acc.display_name}</span>
                        </div>
                        <div className="text-[10px] font-mono text-ink-muted truncate">
                          {acc.external_account_id} {acc.business_manager_name ? `· ${acc.business_manager_name}` : ''}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="label text-xs">{isEn ? 'Operational Notes' : 'Ghi chú vận hành Fanpage'}</label>
              <textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder={
                  isEn
                    ? 'e.g. Main Page for F&B campaigns, held by Via Tong #1...'
                    : 'VD: Page chính chạy chiến dịch F&B, giữ Admin bởi Via Tổng #1...'
                }
                className="input text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingPage(null)
                  setCreateOpen(false)
                }}
              >
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              {editingPage ? (
                <Button
                  size="sm"
                  disabled={!formName.trim() || assignMut.isPending}
                  onClick={() =>
                    assignMut.mutate({
                      pageId: editingPage.id,
                      name: formName,
                      external_page_id: formExtId,
                      url: formUrl,
                      category: formCategory,
                      health_status: formHealth,
                      owner_bm_id: formBmId,
                      holder_identity_id: formHolderId,
                      ad_account_ids: formAccountIds,
                      notes: formNotes,
                    })
                  }
                >
                  {assignMut.isPending
                    ? isEn
                      ? 'Saving...'
                      : 'Đang lưu...'
                    : isEn
                      ? 'Save Fanpage Governance'
                      : 'Lưu Phân Quyền & Liên Kết TKQC'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!formName.trim() || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending
                    ? isEn
                      ? 'Creating...'
                      : 'Đang tạo...'
                    : isEn
                      ? 'Create Fanpage & Assign'
                      : 'Tạo Fanpage & Gán Quyền'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
