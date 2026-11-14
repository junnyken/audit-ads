import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Coffee,
  Copy,
  ExternalLink,
  Flag,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  UserRoundCog,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import {
  buildViaKeepAliveUrl,
  computeSafeViaRestSeconds,
  downloadBatchPageCreationBat,
  downloadUniquePageMediaZip,
  downloadWindowsChromeLauncherBat,
  launchInAssignedChromeProfile,
  planHumanKeepAliveRoute,
  probeLocalDesktopBridge,
  withAutoSubmitPageUrl,
  type BatchChromePageTask,
} from '../lib/chromeProfileLauncher'
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
  warmup_posts_count?: number
  warmup_score?: number
  warmup_stage?: 'NEW_RAW' | 'NURTURING' | 'READY'
  last_warmup_at?: string | null
  bio_description?: string
  is_unsynced_draft?: boolean
  via_created_at?: string | null
  soak_remaining_hours?: number
  ads_ready?: boolean
}

export interface ViaQuotaItem {
  via_id: string
  label: string
  external_reference_id: string | null
  browser_profile: string
  network_label: string
  via_tier: 'veteran_xmdt' | 'standard_via'
  holding_pages_count: number
  holding_page_names: string[]
  created_today_count: number
  created_7d_count: number
  warmup_posts_count: number
  daily_limit: number
  weekly_limit: number
  holding_limit: number
  cooldown_hours: number
  cooldown_remaining_minutes?: number
  last_via_created_at?: string | null
  warning_reasons?: string[]
  quota_status: 'SAFE' | 'NEAR_LIMIT' | 'COOLDOWN' | 'LIMIT_REACHED'
  last_activity_at: string | null
  idle_days?: number
  keepalive_interval_days?: number
  needs_keepalive?: boolean
  last_keepalive_at?: string | null
  last_keepalive_route?: string | null
}

export interface QuotaAlertsSummary {
  total_vias: number
  safe_vias_count: number
  near_limit_vias_count: number
  cooldown_vias_count: number
  limit_reached_vias_count: number
  max_safe_batch_now: number
  unproxied_vias_count?: number
  ip_cluster_advisory?: string | null
  flagged_vias: Array<{
    via_id: string
    label: string
    browser_profile: string
    quota_status: 'NEAR_LIMIT' | 'COOLDOWN' | 'LIMIT_REACHED'
    cooldown_remaining_minutes: number
    warning_reasons: string[]
  }>
}

export interface BatchCreatedPageTask extends BatchChromePageTask {
  page_id: string
  category: string
  bio_description: string
  warmup_post_text: string
  via_id: string
  network_label: string
  batch_index: number
  batch_size: number
}

export interface ViaActivityLogItem {
  id: string
  created_at: string
  action: string
  action_label: string
  via_id: string
  via_label: string
  browser_profile: string
  page_id: string
  page_name: string
  category: string
  detail: string
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
  via_quotas?: ViaQuotaItem[]
  via_activity_logs?: ViaActivityLogItem[]
  quota_alerts_summary?: QuotaAlertsSummary
}

const VIA_PAGE_TEMPLATES = [
  {
    key: 'beauty_spa',
    badge: '💄 Mỹ phẩm & Spa',
    namePrefix: 'Viện Chăm Sóc Sắc Đẹp & Da Liễu Chuẩn Y Khoa',
    category: 'Sức khỏe / Sắc đẹp (Health & Beauty)',
    bio: 'Chuyên gia giải pháp chăm sóc da chuyên sâu, trẻ hóa làn da tự nhiên và phân phối mỹ phẩm chính hãng an toàn cho phụ nữ Việt.',
    warmupPost: '✨ Bí quyết giữ làn da căng bóng, khỏe mạnh tự nhiên mỗi ngày chỉ với 3 bước làm sạch và cấp ẩm chuẩn khoa học tại nhà. Chị em cùng lưu lại để áp dụng ngay nhé! 🌿💧 #ChamSocDa #LamDepAnToan',
  },
  {
    key: 'fashion_store',
    badge: '👗 Thời trang & Phụ kiện',
    namePrefix: 'Thời Trang Thiết Kế Thanh Lịch & Hiện Đại',
    category: 'Thương hiệu Quần áo / Thời trang (Clothing Brand)',
    bio: 'Bộ sưu tập thời trang công sở & dạo phố thiết kế tinh tế, chất liệu cao cấp, tôn dáng và bảo hành đường may trọn đời.',
    warmupPost: '👗 Gợi ý phối đồ thanh lịch cho tuần làm việc mới tràn đầy năng lượng! Sự kết hợp giữa gam màu trung tính và phom dáng chuẩn giúp nàng tự tin trong mọi cuộc gặp gỡ. ✨👜 #ThoiTrangThietKe #PhongCachCongSo',
  },
  {
    key: 'home_decor',
    badge: '🛋️ Nội thất & Gia dụng',
    namePrefix: 'Không Gian Sống Tinh Tế — Nội Thất & Decor',
    category: 'Cửa hàng Nội thất & Gia dụng (Home & Living)',
    bio: 'Giải pháp thiết kế nội thất thông minh và phụ kiện trang trí tổ ấm hiện đại, tối ưu diện tích và nâng tầm chất lượng sống.',
    warmupPost: '🏡 Một góc nhỏ bình yên trong ngôi nhà được bài trí gọn gàng với ánh sáng ấm áp sẽ giúp bạn tái tạo năng lượng sau ngày dài làm việc. Bạn thích phong cách tối giản hay Bắc Âu? 🌿🛋️ #KhongGianSong #NoiThatHienDai',
  },
  {
    key: 'fnb_cuisine',
    badge: '🍜 Ẩm thực & F&B',
    namePrefix: 'Bếp Ngon Bản Địa — Hương Vị Truyền Thống',
    category: 'Nhà hàng / Dịch vụ Ẩm thực (Restaurant & Cafe)',
    bio: 'Thưởng thức hương vị ẩm thực tươi ngon mỗi ngày từ nguyên liệu tuyển chọn kỹ lưỡng, không gian ấm cúng cho gia đình và bạn bè.',
    warmupPost: '🍲 Không gì tuyệt vời hơn bữa cơm sum vầy cùng gia đình với những món ăn nóng hổi, đậm đà hương vị truyền thống. Chúc cả nhà một ngày cuối tuần thật ngon miệng và ấm áp! 🥢🍃 #AmThucViet #MonNgonMoiNgay',
  },
  {
    key: 'tech_saas',
    badge: '💻 Công nghệ & Giải pháp Số',
    namePrefix: 'Giải Pháp Chuyển Đổi Số & Vận Hành Doanh Nghiệp',
    category: 'Công ty Công nghệ / Phần mềm (Information Technology)',
    bio: 'Cung cấp nền tảng quản trị tự động hóa, tối ưu hiệu suất vận hành và bảo mật dữ liệu toàn diện cho doanh nghiệp SME.',
    warmupPost: '🚀 Chuyển đổi số bắt đầu từ việc chuẩn hóa quy trình làm việc hàng ngày. Tối ưu 30% thời gian vận hành giúp đội ngũ tập trung vào sáng tạo và chăm sóc khách hàng tốt hơn! 💡📊 #ChuyenDoiSo #QuanTriDoanhNghiep',
  },
  {
    key: 'real_estate',
    badge: '🏠 Bất động sản & Đầu tư',
    namePrefix: 'Tư Vấn An Cư & Đầu Tư Bất Động Sản Bền Vững',
    category: 'Dịch vụ Bất động sản (Real Estate Service)',
    bio: 'Cập nhật thông tin quy hoạch minh bạch, phân tích pháp lý chuẩn xác và đồng hành cùng nhà đầu tư lựa chọn bất động sản giá trị thực.',
    warmupPost: '🏙️ 3 tiêu chí cốt lõi khi lựa chọn không gian an cư lâu dài cho gia đình trẻ: Pháp lý minh bạch, kết nối hạ tầng thuận tiện và hệ sinh thái tiện ích xanh nội khu. 🌳🏡 #AnCuLacNghiep #BatDongSanBenVung',
  },
]

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

  // Via Page Creator, Quota Guardrails & Auto-Rotation Batch Studio state
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioTab, setStudioTab] = useState<'batch' | 'create' | 'warmup' | 'logs'>('batch')
  const [studioViaId, setStudioViaId] = useState('')
  const [studioBmId, setStudioBmId] = useState('')
  const [studioPageName, setStudioPageName] = useState('')
  const [studioCategory, setStudioCategory] = useState('Thương mại điện tử / Cửa hàng')
  const [studioBio, setStudioBio] = useState(VIA_PAGE_TEMPLATES[0].bio)
  const [studioWarmupPost, setStudioWarmupPost] = useState(VIA_PAGE_TEMPLATES[0].warmupPost)
  const [forceOverrideQuota, setForceOverrideQuota] = useState(false)
  const [batchNicheKey, setBatchNicheKey] = useState('beauty_spa')
  const [batchBrandPrefix, setBatchBrandPrefix] = useState('')
  const [batchCustomNames, setBatchCustomNames] = useState('')
  const [batchCount, setBatchCount] = useState(3)
  const [batchStaggerSeconds, setBatchStaggerSeconds] = useState(22)
  const [batchQueue, setBatchQueue] = useState<BatchCreatedPageTask[]>([])
  const [batchQueueIdx, setBatchQueueIdx] = useState(0)
  const [autoSubmitMode, setAutoSubmitMode] = useState(true)
  const [preCheckProxy, setPreCheckProxy] = useState(true)
  const [warmupBeforeCreate, setWarmupBeforeCreate] = useState(true)
  const [autoUploadMedia, setAutoUploadMedia] = useState(true)
  const [autoCloseTab, setAutoCloseTab] = useState(true)
  const [autoRunner, setAutoRunner] = useState<{
    phase: 'idle' | 'running' | 'paused' | 'syncing' | 'done'
    currentIdx: number
    total: number
    countdownSec: number
    lastJitterSec: number
    currentViaLabel: string
    currentPageName: string
    bridgeMode: 'bridge' | 'protocol' | null
    skippedProxyCount: number
    checkingProxy: boolean
    nightPaused: boolean
    isKeepAliveRun: boolean
  }>({
    phase: 'idle',
    currentIdx: 0,
    total: 0,
    countdownSec: 0,
    lastJitterSec: 0,
    currentViaLabel: '',
    currentPageName: '',
    bridgeMode: null,
    skippedProxyCount: 0,
    checkingProxy: false,
    nightPaused: false,
    isKeepAliveRun: false,
  })
  const runnerTasksRef = useRef<BatchCreatedPageTask[]>([])
  const runnerStateRef = useRef(autoRunner)
  runnerStateRef.current = autoRunner
  const usedProxyCountsRef = useRef<Record<string, number>>({})
  const autoRunAfterCreateRef = useRef(true)
  const autoSyncTimerRef = useRef<number | null>(null)
  const staggerSecondsRef = useRef(batchStaggerSeconds)
  staggerSecondsRef.current = batchStaggerSeconds
  const autoSubmitModeRef = useRef(autoSubmitMode)
  autoSubmitModeRef.current = autoSubmitMode
  const preCheckProxyRef = useRef(preCheckProxy)
  preCheckProxyRef.current = preCheckProxy
  const warmupBeforeCreateRef = useRef(warmupBeforeCreate)
  warmupBeforeCreateRef.current = warmupBeforeCreate
  const autoUploadMediaRef = useRef(autoUploadMedia)
  autoUploadMediaRef.current = autoUploadMedia
  const autoCloseTabRef = useRef(autoCloseTab)
  autoCloseTabRef.current = autoCloseTab
  const [warmupTargetPageId, setWarmupTargetPageId] = useState('')
  const [warmupMessage, setWarmupMessage] = useState(VIA_PAGE_TEMPLATES[0].warmupPost)
  const [logViaFilter, setLogViaFilter] = useState('ALL')

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

  const desktopBridgeQ = useQuery({
    queryKey: ['local-desktop-bridge'],
    queryFn: () => probeLocalDesktopBridge(),
    refetchInterval: 10000,
  })
  const bridgeProbe = desktopBridgeQ.data

  const accountsQ = useQuery({
    queryKey: ['ad-accounts-all-for-pages'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const syncMetaMut = useMutation({
    mutationFn: () =>
      api.post<
        FanpageSummaryResponse & {
          synced_count: number
          new_count: number
          linked_account_count: number
          bm_claimed_count?: number
        }
      >('/api/v1/facebook-pages/sync-meta', {}),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      const bmClaimSuffix = res.bm_claimed_count
        ? isEn
          ? `, ${res.bm_claimed_count} claimed to BM`
          : `, tự động gom ${res.bm_claimed_count} Page về BM`
        : ''
      setBannerMsg(
        isEn
          ? `✅ Synced ${res.synced_count} Fanpages from Meta Graph API (${res.new_count} newly added, ${res.linked_account_count} ad account links updated${bmClaimSuffix}).`
          : `✅ Đã quét & đồng bộ ${res.synced_count} Fanpage từ Meta Graph API (${res.new_count} Page mới, ${res.linked_account_count} liên kết TKQC được cập nhật${bmClaimSuffix}).`,
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

  const syncMetaRef = useRef(syncMetaMut)
  syncMetaRef.current = syncMetaMut

  const extractProxyHostPort = (raw: string): string => {
    const clean = (raw || '').trim()
    if (!clean) return ''
    const withoutScheme = clean.replace(/^(https?|socks5h?|socks4):\/\//i, '')
    if (withoutScheme.includes('@')) {
      const hostPart = withoutScheme.split('@').pop() || ''
      return hostPart.split('/')[0].toLowerCase()
    }
    const segs = withoutScheme.split(':')
    if (segs.length >= 2) {
      return `${segs[0]}:${segs[1]}`.toLowerCase()
    }
    return withoutScheme.toLowerCase()
  }

  const activateBatchTaskAtIndex = async (
    tasks: BatchCreatedPageTask[],
    idx: number,
    baseStaggerSec: number,
    prevBridgeMode: 'bridge' | 'protocol' | null = null,
    isKeepAliveOverride?: boolean,
    skippedCountOverride?: number,
  ): Promise<void> => {
    const task = tasks[idx]
    if (!task) return
    const isKeepAlive =
      typeof isKeepAliveOverride === 'boolean' ? isKeepAliveOverride : runnerStateRef.current.isKeepAliveRun
    const prevSkipped =
      typeof skippedCountOverride === 'number'
        ? skippedCountOverride
        : runnerStateRef.current.skippedProxyCount

    setBatchQueueIdx(idx)

    const finishOrSkipNext = (nextSkipped: number, reasonBanner: string) => {
      setBannerMsg(reasonBanner)
      const nextIdx = idx + 1
      if (nextIdx < tasks.length && runnerStateRef.current.phase !== 'idle') {
        void activateBatchTaskAtIndex(
          tasks,
          nextIdx,
          baseStaggerSec,
          prevBridgeMode,
          isKeepAlive,
          nextSkipped,
        )
      } else {
        const doneState = {
          phase: 'done' as const,
          currentIdx: idx,
          total: tasks.length,
          countdownSec: 0,
          lastJitterSec: 0,
          currentViaLabel: task.via_label,
          currentPageName: task.page_name,
          bridgeMode: prevBridgeMode,
          skippedProxyCount: nextSkipped,
          checkingProxy: false,
          nightPaused: false,
          isKeepAliveRun: isKeepAlive,
        }
        runnerStateRef.current = doneState
        setAutoRunner(doneState)
        if (!isKeepAlive && tasks.length > nextSkipped) {
          syncMetaRef.current.mutate()
        }
      }
    }

    const proxyStr = (task.network_label || '').trim()
    const hostPort = extractProxyHostPort(proxyStr)

    if (hostPort && !isKeepAlive && (usedProxyCountsRef.current[hostPort] || 0) >= 2) {
      const nextSkip = prevSkipped + 1
      finishOrSkipNext(
        nextSkip,
        `⚠️ Đã bỏ qua Via «${task.via_label}» vì Proxy (${hostPort}) đã gánh ≥ 2 Via trong cùng lô (chống quét chùm IP).`,
      )
      return
    }

    if (preCheckProxyRef.current && proxyStr) {
      const checkingState = {
        phase: 'running' as const,
        currentIdx: idx,
        total: tasks.length,
        countdownSec: baseStaggerSec,
        lastJitterSec: 0,
        currentViaLabel: task.via_label,
        currentPageName: task.page_name,
        bridgeMode: prevBridgeMode,
        skippedProxyCount: prevSkipped,
        checkingProxy: true,
        nightPaused: false,
        isKeepAliveRun: isKeepAlive,
      }
      runnerStateRef.current = checkingState
      setAutoRunner(checkingState)

      try {
        const res = await Promise.race([
          api.post<{ ok?: boolean; status?: string; normalized_key?: string; message?: string }>(
            '/api/v1/proxies/check-live',
            {
              proxy_string: proxyStr,
              via_label: task.via_label,
              notify_on_dead: true,
              timeout_seconds: 4.0,
            },
          ),
          new Promise<{ status?: string }>((resolve) =>
            window.setTimeout(() => resolve({ status: 'TIMEOUT_SKIP_GATE' }), 5000),
          ),
        ])
        if (runnerStateRef.current.phase === 'idle') return
        if (res.status === 'DEAD' || res.status === 'INVALID') {
          const nextSkip = prevSkipped + 1
          finishOrSkipNext(
            nextSkip,
            `🛑 Đã tự động bỏ qua Via «${task.via_label}» do Proxy ${res.status} (đã gửi cảnh báo Telegram) — chuyển sang Via kế tiếp!`,
          )
          return
        }
      } catch {
        // Proceed gracefully if server probe request itself could not complete
      }
    }

    if (hostPort) {
      usedProxyCountsRef.current[hostPort] = (usedProxyCountsRef.current[hostPort] || 0) + 1
    }

    if (!isKeepAlive && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(`${task.page_name}\n\nTiểu sử: ${task.bio_description}\n\nBài mồi:\n${task.warmup_post_text}`)
        .catch(() => {})
    }

    const targetUrl = isKeepAlive
      ? buildViaKeepAliveUrl({ autoCloseTab: autoCloseTabRef.current, viaLabel: task.via_label })
      : withAutoSubmitPageUrl(task.launch_url, {
          autoSubmit: autoSubmitModeRef.current,
          warmupBeforeCreate: warmupBeforeCreateRef.current,
          autoUploadMedia: autoUploadMediaRef.current,
          autoCloseTab: autoCloseTabRef.current,
        })

    void launchInAssignedChromeProfile(
      targetUrl,
      task.browser_profile,
      task.via_label,
      task.network_label,
    ).then((mode) => {
      runnerStateRef.current = { ...runnerStateRef.current, bridgeMode: mode }
      setAutoRunner((prev) => ({ ...prev, bridgeMode: mode }))
    })

    if (idx >= tasks.length - 1) {
      const syncState = {
        phase: 'syncing' as const,
        currentIdx: idx,
        total: tasks.length,
        countdownSec: isKeepAlive ? 32 : warmupBeforeCreateRef.current ? 40 : 24,
        lastJitterSec: 0,
        currentViaLabel: task.via_label,
        currentPageName: task.page_name,
        bridgeMode: prevBridgeMode,
        skippedProxyCount: prevSkipped,
        checkingProxy: false,
        nightPaused: false,
        isKeepAliveRun: isKeepAlive,
      }
      runnerStateRef.current = syncState
      setAutoRunner(syncState)
    } else {
      const rest = computeSafeViaRestSeconds(baseStaggerSec)
      const nextState = {
        phase: 'running' as const,
        currentIdx: idx,
        total: tasks.length,
        countdownSec: rest.totalSeconds,
        lastJitterSec: rest.jitterSeconds,
        currentViaLabel: task.via_label,
        currentPageName: task.page_name,
        bridgeMode: prevBridgeMode,
        skippedProxyCount: prevSkipped,
        checkingProxy: false,
        nightPaused: false,
        isKeepAliveRun: isKeepAlive,
      }
      runnerStateRef.current = nextState
      setAutoRunner(nextState)
    }
  }

  const startWebAutoRunner = (
    tasks: BatchCreatedPageTask[],
    baseStaggerSec: number,
    isKeepAlive = false,
  ) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return
    runnerTasksRef.current = tasks
    usedProxyCountsRef.current = {}
    const initState = {
      phase: 'running' as const,
      currentIdx: 0,
      total: tasks.length,
      countdownSec: baseStaggerSec,
      lastJitterSec: 0,
      currentViaLabel: tasks[0].via_label,
      currentPageName: tasks[0].page_name,
      bridgeMode: null as 'bridge' | 'protocol' | null,
      skippedProxyCount: 0,
      checkingProxy: false,
      nightPaused: false,
      isKeepAliveRun: isKeepAlive,
    }
    runnerStateRef.current = initState
    setAutoRunner(initState)
    void activateBatchTaskAtIndex(tasks, 0, baseStaggerSec, null, isKeepAlive, 0)
  }

  const stopWebAutoRunner = () => {
    const stopped = {
      phase: 'idle' as const,
      currentIdx: 0,
      total: 0,
      countdownSec: 0,
      lastJitterSec: 0,
      currentViaLabel: '',
      currentPageName: '',
      bridgeMode: null,
      skippedProxyCount: 0,
      checkingProxy: false,
      nightPaused: false,
      isKeepAliveRun: false,
    }
    runnerStateRef.current = stopped
    setAutoRunner(stopped)
  }

  const launchHumanKeepAliveForVias = (picked: ViaQuotaItem[]) => {
    if (!Array.isArray(picked) || picked.length === 0) return
    const now = new Date()
    const totalMins = now.getHours() * 60 + now.getMinutes()
    if (totalMins < 8 * 60 || totalMins > 22 * 60 + 30) {
      const ok = window.confirm(
        '🌙 Hiện đang ngoài khung giờ sinh hoạt tự nhiên (08:00–22:30). Đảo ấm đêm khuya kém tự nhiên hơn ban ngày — bạn vẫn muốn chạy ngay chứ?',
      )
      if (!ok) return
    }

    const plans = picked.map((v) => planHumanKeepAliveRoute(v.via_tier))
    const tasks: BatchCreatedPageTask[] = picked.map((v, idx) => ({
      page_id: `keepalive-${v.via_id}`,
      page_name: `Đảo ấm v2.9 (${v.label} · ${plans[idx].routeSummary})`,
      category: 'Keep-Alive Cookie',
      bio_description: `Đảo ấm sinh học (${plans[idx].routeSummary} • ~${plans[idx].estimatedSeconds}s)`,
      warmup_post_text: '',
      via_id: v.via_id,
      via_label: v.label,
      browser_profile: v.browser_profile,
      network_label: v.network_label,
      launch_url: buildViaKeepAliveUrl({
        autoCloseTab,
        viaLabel: v.label,
        viaTier: v.via_tier,
        routeSteps: plans[idx].steps,
      }),
      batch_index: idx + 1,
      batch_size: picked.length,
    }))

    void api
      .post('/api/v1/facebook-pages/via-keepalive-log', {
        vias: picked.map((v, idx) => ({
          via_id: v.via_id,
          via_label: v.label,
          browser_profile: v.browser_profile,
          via_tier: v.via_tier,
          route_summary: plans[idx].routeSummary,
          duration_sec: plans[idx].estimatedSeconds,
        })),
      })
      .then(() => qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] }))
      .catch(() => {})

    const spacingSec =
      picked.length === 1 ? 18 : Math.max(48, Math.min(batchStaggerSeconds, 75))
    startWebAutoRunner(tasks, spacingSec, true)
    setBannerMsg(
      `☕ Bắt đầu Đảo Ấm Sinh Học v2.9 cho ${picked.length} Via (đa lộ trình Newsfeed / Thông báo / Trang / Business Suite BM + giữ nguyên tab nếu văng Cookie)!`,
    )
  }

  useEffect(() => {
    return () => {
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (autoRunner.phase !== 'running' && autoRunner.phase !== 'syncing') return
    const timer = window.setInterval(() => {
      const cur = runnerStateRef.current
      if (cur.phase === 'paused' || cur.phase === 'idle' || cur.phase === 'done' || cur.checkingProxy) return

      if (cur.phase === 'syncing') {
        if (cur.countdownSec > 1) {
          const next = { ...cur, countdownSec: cur.countdownSec - 1 }
          runnerStateRef.current = next
          setAutoRunner(next)
          return
        }
        const doneState = { ...cur, phase: 'done' as const, countdownSec: 0, nightPaused: false }
        runnerStateRef.current = doneState
        setAutoRunner(doneState)
        if (cur.isKeepAliveRun) {
          setBannerMsg(
            `☕ Đã hoàn tất đảo ấm Cookie tự nhiên cho ${cur.total - cur.skippedProxyCount} Via! Các tab an toàn sẽ tự đóng gọn.`,
          )
        } else {
          syncMetaRef.current.mutate()
          setBannerMsg(
            '🤖 ✅ Hoàn tất chuỗi Full Automatic v2.9! Hệ thống đã tự quét đồng bộ Page ID mới + gom Page về BM qua Meta Graph API.',
          )
        }
        return
      }

      if ((!cur.isKeepAliveRun && staggerSecondsRef.current >= 900) || (cur.isKeepAliveRun && cur.total >= 3)) {
        const nowClock = new Date()
        const totalMins = nowClock.getHours() * 60 + nowClock.getMinutes()
        const isNight = totalMins < 8 * 60 || totalMins > 22 * 60 + 30
        if (isNight) {
          if (!cur.nightPaused) {
            const np = { ...cur, nightPaused: true }
            runnerStateRef.current = np
            setAutoRunner(np)
          }
          return
        }
        if (cur.nightPaused) {
          const dp = { ...cur, nightPaused: false }
          runnerStateRef.current = dp
          setAutoRunner(dp)
        }
      }

      if (cur.countdownSec > 1) {
        const next = { ...cur, countdownSec: cur.countdownSec - 1 }
        runnerStateRef.current = next
        setAutoRunner(next)
        return
      }

      const tasks = runnerTasksRef.current
      const nextIdx = cur.currentIdx + 1
      if (nextIdx >= tasks.length) {
        const syncState = {
          ...cur,
          phase: 'syncing' as const,
          countdownSec: cur.isKeepAliveRun ? 32 : warmupBeforeCreateRef.current ? 40 : 24,
        }
        runnerStateRef.current = syncState
        setAutoRunner(syncState)
        return
      }
      void activateBatchTaskAtIndex(tasks, nextIdx, staggerSecondsRef.current, cur.bridgeMode, cur.isKeepAliveRun, cur.skippedProxyCount)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoRunner.phase])

  const viaCreateLaunchMut = useMutation({
    mutationFn: (payload: {
      via_id: string
      owner_bm_id: string
      page_name: string
      category: string
      bio_description: string
      warmup_post_text: string
      browser_profile: string
      via_label: string
      network_label: string
      force_override?: boolean
      auto_submit?: boolean
    }) =>
      api.post<FanpageSummaryResponse & { item: FanpageSummaryItem; launch_url: string }>(
        '/api/v1/facebook-pages/via-create-launch',
        payload,
      ),
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      const textToCopy = `${vars.page_name}\n\nTiểu sử: ${vars.bio_description}\n\nBài đăng mồi đầu tiên:\n${vars.warmup_post_text}`
      void navigator.clipboard.writeText(textToCopy)
      const isAuto = autoSubmitModeRef.current
      const useWarmup = warmupBeforeCreateRef.current
      void launchInAssignedChromeProfile(
        withAutoSubmitPageUrl(res.launch_url || 'https://www.facebook.com/pages/creation/', {
          autoSubmit: isAuto,
          warmupBeforeCreate: useWarmup,
          autoUploadMedia: autoUploadMediaRef.current,
          autoCloseTab: autoCloseTabRef.current,
        }),
        vars.browser_profile || 'Profile 1',
        vars.via_label || 'Via Giữ Page',
        vars.network_label || '',
      )
      if (isAuto) {
        if (autoSyncTimerRef.current !== null) {
          window.clearTimeout(autoSyncTimerRef.current)
        }
        autoSyncTimerRef.current = window.setTimeout(
          () => {
            syncMetaRef.current.mutate()
          },
          useWarmup ? 44_000 : 26_000,
        )
      }
      setStudioPageName('')
      setForceOverrideQuota(false)
      setBannerMsg(
        isEn
          ? `🌱 Created & logged Page "${vars.page_name}" under Via "${vars.via_label}" and launched Chrome (${vars.browser_profile})!`
          : isAuto
            ? `🤖 [Full Automatic v2.9] Đã lưu Page «${vars.page_name}» + mở Chrome (${vars.browser_profile}) ${useWarmup ? 'lướt ấm 15s rồi ' : ''}tự điền, gắn ảnh độc bản & tạo Page tự nhiên!`
            : `🌱 Đã lưu Fanpage «${vars.page_name}» + ghi nhận định mức cho Via «${vars.via_label}», đã mở Chrome (${vars.browser_profile}) tự điền chờ bạn bấm Tạo Trang!`,
      )
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Via đã chạm định mức cảnh báo an toàn.'
      setBannerMsg(msg)
    },
  })

  const viaBatchCreateMut = useMutation({
    mutationFn: (payload: {
      count: number
      niche_key: string
      brand_prefix: string
      custom_names: string
      owner_bm_id: string
      stagger_seconds: number
      auto_submit?: boolean
    }) =>
      api.post<
        FanpageSummaryResponse & {
          created_count: number
          requested_count: number
          skipped_due_to_quota: number
          stagger_seconds: number
          quota_warning_message: string | null
          batch_items: BatchCreatedPageTask[]
        }
      >('/api/v1/facebook-pages/via-batch-create', payload),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      const itemsList = res.batch_items ?? []
      setBatchQueue(itemsList)
      setBatchQueueIdx(0)
      const warnSuffix = res.quota_warning_message ? ` ${res.quota_warning_message}` : ''
      if (autoRunAfterCreateRef.current && itemsList.length > 0) {
        startWebAutoRunner(itemsList, res.stagger_seconds || staggerSecondsRef.current)
        setBannerMsg(
          `🤖 Đã khởi tạo lô ${res.created_count} Page & BẮT ĐẦU CHẠY FULL AUTOMATIC (mỗi Via nghỉ an toàn giãn nhịp ${res.stagger_seconds}s + ngẫu nhiên chống quét)!${warnSuffix}`,
        )
      } else {
        setBannerMsg(
          `⚡ Đã khởi tạo lô ${res.created_count} Fanpage và xoay vòng ${res.created_count} Via khỏe (1 Via = tối đa 1 Page/đợt). Bấm Chạy Full Automatic hoặc tải .bat bên dưới!${warnSuffix}`,
        )
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Không đủ Via sạch để tạo lô mới.'
      setBannerMsg(msg)
    },
  })

  const batchWarmupMut = useMutation({
    mutationFn: () => api.post<FanpageSummaryResponse & { nurtured_count: number; graph_published_count: number }>('/api/v1/facebook-pages/batch-warmup', { max_pages: 10 }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      setBannerMsg(
        `✍️ Đã nuôi hàng loạt ${res.nurtured_count} Fanpage thiếu bài mồi (${res.graph_published_count} Page tự đăng ngầm qua Meta Graph API, còn lại đã lưu nhật ký & kịch bản chuẩn)!`,
      )
    },
  })

  const discardDraftMut = useMutation({
    mutationFn: (pageId: string) =>
      api.delete<FanpageSummaryResponse & { discarded_page_id: string }>(`/api/v1/facebook-pages/${pageId}/draft`),
    onSuccess: (_res, pageId) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      setBatchQueue((prev) => prev.filter((item) => item.page_id !== pageId))
      setBannerMsg('🗑️ Đã hủy bản nháp Fanpage và hoàn lại định mức tạo Page cho Via!')
    },
  })

  const claimPageToBmMut = useMutation({
    mutationFn: (payload: { pageId: string; businessManagerId?: string }) =>
      api.post<FanpageSummaryResponse & { claimed: boolean; bm_name: string; message: string }>(
        `/api/v1/facebook-pages/${payload.pageId}/claim-to-bm`,
        payload.businessManagerId ? { business_manager_id: payload.businessManagerId } : {},
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      setBannerMsg(`🏛️ ${res.message}${res.bm_name ? ` (${res.bm_name})` : ''}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Chưa gom được Page về BM — Kiểm tra lại quyền Admin BM của Token.'
      setBannerMsg(`⚠️ ${msg}`)
    },
  })

  const warmupPostMut = useMutation({
    mutationFn: (payload: {
      pageId: string
      pageName: string
      externalPageId: string | null
      pageUrl: string | null
      viaId: string
      viaLabel: string
      browserProfile: string
      networkLabel: string
      message: string
      postMode: 'graph_api_or_assist' | 'chrome_assist'
    }) =>
      api.post<FanpageSummaryResponse & { delivery_mode: string; item: FanpageSummaryItem }>(
        `/api/v1/facebook-pages/${payload.pageId}/warmup-post`,
        {
          message: payload.message,
          via_id: payload.viaId,
          via_label: payload.viaLabel,
          browser_profile: payload.browserProfile,
          post_mode: payload.postMode,
        },
      ),
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      void navigator.clipboard.writeText(vars.message)
      if (vars.postMode === 'chrome_assist' || res.delivery_mode !== 'GRAPH_API_PUBLISHED') {
        const targetFbUrl =
          vars.pageUrl ||
          (vars.externalPageId ? `https://www.facebook.com/${vars.externalPageId}` : 'https://www.facebook.com/pages/?category=your_pages')
        launchInAssignedChromeProfile(
          targetFbUrl,
          vars.browserProfile || 'Profile 1',
          vars.viaLabel || vars.pageName,
          vars.networkLabel || '',
        )
      }
      setBannerMsg(
        res.delivery_mode === 'GRAPH_API_PUBLISHED'
          ? `✅ Đã tự động đăng bài mồi lên Fanpage «${vars.pageName}» qua Meta Graph API và lưu vào Nhật ký hoạt động của Via «${vars.viaLabel}»!`
          : `✍️ Đã sao chép bài mồi, lưu vào Nhật ký nuôi Page vĩnh viễn của Via «${vars.viaLabel}» và mở Chrome (${vars.browserProfile}) để bạn dán đăng 1 chạm!`,
      )
    },
  })

  const cronStatusQ = useQuery({
    queryKey: ['automation-cron-status'],
    queryFn: () =>
      api.get<{
        auto_meta_sync_enabled: boolean
        sync_interval_minutes: number
        auto_page_warmup_enabled: boolean
        warmup_min_gap_hours: number
        last_run_at: string | null
      }>('/api/v1/automation-cron/status'),
  })

  const runAutoCronMut = useMutation({
    mutationFn: () =>
      api.post<{
        run_summary: { sync_executed?: boolean; warmup_posts_published?: number; alerts_dispatched?: number }
      }>('/api/v1/automation-cron/run-now', { sync: true, warmup: true }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['automation-cron-status'] })
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      const s = res.run_summary
      setBannerMsg(
        `⚡ Auto-Cron hoàn tất: ${s.sync_executed ? 'Đã đồng bộ Meta' : 'Bỏ qua Sync'} · Tự đăng ${
          s.warmup_posts_published ?? 0
        } bài mồi nuôi Page · Gửi ${s.alerts_dispatched ?? 0} báo động Telegram.`,
      )
    },
  })

  const items = pagesSummaryQ.data?.items ?? []
  const viaQuotas = pagesSummaryQ.data?.via_quotas ?? []
  const viaActivityLogs = pagesSummaryQ.data?.via_activity_logs ?? []
  const quotaAlerts: QuotaAlertsSummary = pagesSummaryQ.data?.quota_alerts_summary ?? {
    total_vias: viaQuotas.length,
    safe_vias_count: viaQuotas.filter((v) => v.quota_status === 'SAFE' || v.quota_status === 'NEAR_LIMIT').length,
    near_limit_vias_count: viaQuotas.filter((v) => v.quota_status === 'NEAR_LIMIT').length,
    cooldown_vias_count: viaQuotas.filter((v) => v.quota_status === 'COOLDOWN').length,
    limit_reached_vias_count: viaQuotas.filter((v) => v.quota_status === 'LIMIT_REACHED').length,
    max_safe_batch_now: viaQuotas.filter((v) => v.quota_status === 'SAFE' || v.quota_status === 'NEAR_LIMIT').length,
    flagged_vias: [],
  }
  const eligibleBatchVias = useMemo(
    () =>
      [...viaQuotas]
        .filter((v) => v.quota_status === 'SAFE' || v.quota_status === 'NEAR_LIMIT')
        .sort((a, b) => {
          const rankA = a.quota_status === 'SAFE' ? 0 : 1
          const rankB = b.quota_status === 'SAFE' ? 0 : 1
          if (rankA !== rankB) return rankA - rankB
          return a.holding_pages_count - b.holding_pages_count || a.created_7d_count - b.created_7d_count
        }),
    [viaQuotas],
  )
  const underNurturedCount = useMemo(
    () => items.filter((it) => it.health_status === 'LIVE' && (it.warmup_posts_count ?? 1) < 3).length,
    [items],
  )
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
            <Button
              size="sm"
              variant={studioOpen ? 'default' : 'secondary'}
              onClick={() => {
                if (!studioViaId && (viaQuotas[0]?.via_id || allVias[0]?.id)) {
                  setStudioViaId(viaQuotas[0]?.via_id || String(allVias[0]?.id || ''))
                }
                if (!studioBmId && allBms[0]?.id) {
                  setStudioBmId(String(allBms[0].id))
                }
                if (!warmupTargetPageId && items[0]?.id) {
                  setWarmupTargetPageId(items[0].id)
                }
                setStudioOpen((prev) => !prev)
              }}
              className="gap-1.5 font-bold border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {isEn
                  ? '🌱 Via Page Creator & Auto-Warmup Studio'
                  : '🌱 Tạo Page bằng Via & Nuôi Page Sống Lâu (Định mức & Nhật ký)'}
              </span>
            </Button>
            <Button size="sm" onClick={openCreateModal} className="gap-1.5 font-semibold">
              <Plus className="h-3.5 w-3.5" />
              <span>{isEn ? '+ Add Fanpage' : '+ Thêm Fanpage mới'}</span>
            </Button>
          </div>
        </div>
      </div>

      {cronStatusQ.data && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-ink">
            <span className="font-semibold">⏱️ Auto-Cron chạy ngầm:</span>
            <span className="text-ink-muted">
              {cronStatusQ.data.auto_meta_sync_enabled
                ? `Đồng bộ Meta mỗi ${cronStatusQ.data.sync_interval_minutes}p`
                : 'Auto Sync tắt'}{' '}
              ·{' '}
              {cronStatusQ.data.auto_page_warmup_enabled
                ? `Tự rải bài mồi nuôi Page mỗi ${cronStatusQ.data.warmup_min_gap_hours}h (tới đủ 3 bài)`
                : 'Tự nuôi Page tắt'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={runAutoCronMut.isPending}
              onClick={() => runAutoCronMut.mutate()}
            >
              {runAutoCronMut.isPending ? 'Đang chạy Auto-Cron...' : '⚡ Chạy Auto-Cron ngay'}
            </Button>
            <Link to="/settings" className="font-semibold text-brand-text hover:underline">
              Đổi lịch →
            </Link>
          </div>
        </div>
      )}

      {/* GLOBAL VIA PAGE QUOTA ALERT BAR (Always warns when any Via hits Limit / Cooldown / Near Limit) */}
      {(quotaAlerts.limit_reached_vias_count > 0 || quotaAlerts.cooldown_vias_count > 0 || quotaAlerts.near_limit_vias_count > 0) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
            quotaAlerts.limit_reached_vias_count > 0
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-bold">
              ⚠️ Cảnh báo Định mức Tạo Page của Via:
            </span>
            <span>
              {quotaAlerts.limit_reached_vias_count > 0 && (
                <strong className="mr-2">🔴 {quotaAlerts.limit_reached_vias_count} Via chạm trần định mức</strong>
              )}
              {quotaAlerts.cooldown_vias_count > 0 && (
                <strong className="mr-2">⏳ {quotaAlerts.cooldown_vias_count} Via đang nghỉ Cooldown</strong>
              )}
              {quotaAlerts.near_limit_vias_count > 0 && (
                <strong className="mr-2">🟡 {quotaAlerts.near_limit_vias_count} Via sắp chạm trần</strong>
              )}
              <span>
                — Hiện còn <strong>🟢 {quotaAlerts.max_safe_batch_now} Via sạch</strong> sẵn sàng xoay vòng tạo Page an toàn ngay.
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {quotaAlerts.flagged_vias.slice(0, 2).map((fv) => (
              <span
                key={fv.via_id}
                className="rounded border border-current/25 bg-surface/60 px-2 py-0.5 text-[10.5px] font-semibold"
                title={fv.warning_reasons.join(' · ')}
              >
                {fv.quota_status === 'LIMIT_REACHED' ? '🔴' : fv.quota_status === 'COOLDOWN' ? '⏳' : '🟡'} {fv.label}
                {fv.cooldown_remaining_minutes > 0
                  ? ` (${Math.floor(fv.cooldown_remaining_minutes / 60)}h${String(fv.cooldown_remaining_minutes % 60).padStart(2, '0')}p)`
                  : ''}
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                setStudioTab('batch')
                setStudioOpen(true)
              }}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
            >
              ⚡ Xoay vòng {quotaAlerts.max_safe_batch_now} Via sạch
            </button>
          </div>
        </div>
      )}

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

      {/* VIA PAGE CREATOR, QUOTA GUARDRAIL & MULTI-VIA BATCH STUDIO */}
      {studioOpen && (
        <Card className="border-emerald-500/40 bg-surface shadow-md">
          <CardHeader className="border-b border-line pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {isEn
                      ? 'Multi-Via Auto-Rotation Batch Page Creator, Quota Guardrails & Activity History'
                      : 'Studio Tạo Page Hàng Loạt Đa Via (Auto Xoay Vòng), Chốt Chặn Cảnh Báo & Nhật Ký Vĩnh Viễn'}
                  </span>
                </CardTitle>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Xoay vòng 1 Page = 1 Via sạch, tự Spin Tên/Tiểu sử không trùng, chạy Full Automatic 1 chạm trên Web với khoảng nghỉ giãn nhịp + cộng ngẫu nhiên chống Checkpoint.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStudioTab('batch')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    studioTab === 'batch'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'border border-line bg-surface-muted text-ink hover:border-emerald-500/50'
                  }`}
                >
                  ⚡ 1. Tạo Hàng Loạt Đa Via ({quotaAlerts.max_safe_batch_now} Via sẵn)
                </button>
                <button
                  type="button"
                  onClick={() => setStudioTab('create')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    studioTab === 'create'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'border border-line bg-surface-muted text-ink hover:border-emerald-500/50'
                  }`}
                >
                  🌱 2. Tạo Lẻ & Cảnh Báo Via ({viaQuotas.length} Via)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!warmupTargetPageId && items[0]?.id) setWarmupTargetPageId(items[0].id)
                    setStudioTab('warmup')
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    studioTab === 'warmup'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'border border-line bg-surface-muted text-ink hover:border-emerald-500/50'
                  }`}
                >
                  ✍️ 3. Auto Nuôi Page ({underNurturedCount} cần nuôi)
                </button>
                <button
                  type="button"
                  onClick={() => setStudioTab('logs')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    studioTab === 'logs'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'border border-line bg-surface-muted text-ink hover:border-emerald-500/50'
                  }`}
                >
                  📜 4. Nhật Ký Lưu Vĩnh Viễn ({viaActivityLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStudioOpen(false)}
                  className="rounded-lg border border-line px-2 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
                >
                  ✕ Đóng
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 p-4">
            {/* CLEAN AUTOMATION MODE BAR */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-muted/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-ink">Chế độ thao tác trên Chrome:</span>
                <button
                  type="button"
                  onClick={() => setAutoSubmitMode(true)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                    autoSubmitMode
                      ? 'border-emerald-500 bg-emerald-600 text-white shadow-xs'
                      : 'border-line bg-surface text-ink hover:border-emerald-500/40'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span>🤖 Full Automatic (Tự điền + Tự bấm Tạo &amp; Hoàn tất)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoSubmitMode(false)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                    !autoSubmitMode
                      ? 'border-sky-500 bg-sky-600 text-white shadow-xs'
                      : 'border-line bg-surface text-ink hover:border-sky-500/40'
                  }`}
                >
                  <span>👀 Bán tự động (Tự điền, chờ bấm tay)</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {bridgeProbe?.isDesktopApp ? (
                  <span
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 font-extrabold text-emerald-700 dark:text-emerald-300"
                    title="Ứng dụng Windows AdsOps Desktop Pro đang chạy ngầm trên máy (127.0.0.1:17890)"
                  >
                    💻 App Windows Desktop Pro Đang Chạy (v{bridgeProbe.version || '1.1'})
                  </span>
                ) : bridgeProbe?.online ? (
                  <span className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 font-bold text-sky-700 dark:text-sky-300">
                    ⚡ Cầu nối .bat Đang Chạy
                  </span>
                ) : null}
                <a
                  href="/downloads/AdsOps-Desktop-Pro-v1.1.zip"
                  download
                  className="rounded border border-indigo-500/45 bg-indigo-500/15 px-2 py-1 font-bold text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-300"
                  title="Tải App Windows AdsOps Desktop Pro v1.1 (.exe chạy ngầm System Tray 24/7, tự cài Extension v2.9.1, Cầu nối 2 chiều tự bắt Page ID & báo Telegram)"
                >
                  💻 Tải App Windows v1.1 (.zip)
                </a>
                <button
                  type="button"
                  onClick={downloadWindowsChromeLauncherBat}
                  className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                  title="Chạy 1 lần duy nhất để bật Cầu nối ngầm 127.0.0.1:17890 mở đa Chrome không hiện hộp thoại hỏi"
                >
                  ⚡ Bật Cầu nối Mở Ngầm (.bat 1 lần)
                </button>
                <Link
                  to="/chrome-extension"
                  className="rounded border border-line bg-surface px-2 py-1 font-bold text-brand-text hover:underline"
                >
                  Cài Extension v2.9.1 ↗
                </Link>
              </div>
            </div>

            {/* V2.9 PRO SAFETY TOGGLES & COOKIE KEEP-ALIVE */}
            {(() => {
              const idleVias = viaQuotas.filter((v) => v.needs_keepalive)
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-extrabold text-emerald-700 dark:text-emerald-300">✨ Bảo vệ v2.9 Pro:</span>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={preCheckProxy}
                        onChange={(e) => setPreCheckProxy(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      <span>🛡️ Check Proxy sống 2s</span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={warmupBeforeCreate}
                        onChange={(e) => setWarmupBeforeCreate(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      <span>🌿 Lướt ấm 15s trước khi tạo</span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={autoUploadMedia}
                        onChange={(e) => setAutoUploadMedia(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      <span>🖼️ Tự gắn Avatar/Cover độc bản</span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={autoCloseTab}
                        onChange={(e) => setAutoCloseTab(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      <span>🧹 Tự đóng Tab khi xong</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={viaQuotas.length === 0 || autoRunner.phase === 'running' || autoRunner.phase === 'syncing'}
                    onClick={() => {
                      const picked = (idleVias.length > 0 ? idleVias : viaQuotas.slice(0, 8)).slice(0, 12)
                      launchHumanKeepAliveForVias(picked)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/45 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-200"
                    title="Đảo Ấm Sinh Học v2.9 (chu kỳ lệch pha 2.5–4.5 ngày): đa lộ trình Newsfeed / Thông báo / Quản lý Trang / Business Suite BM, giữ nguyên tab nếu văng Cookie"
                  >
                    <Coffee className="h-3.5 w-3.5" />
                    <span>
                      ☕ Đảo Ấm Sinh Học v2.9 ({idleVias.length > 0 ? `${idleVias.length} Via cần ấm` : `${Math.min(viaQuotas.length, 8)} Via`})
                    </span>
                  </button>
                </div>
              )
            })()}

            {/* LIVE WEB AUTO-RUNNER MONITOR (PAGE CREATION & KEEP-ALIVE) */}
            {autoRunner.phase !== 'idle' && (
              <div className="space-y-2 rounded-xl border-2 border-emerald-500/50 bg-surface p-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {autoRunner.isKeepAliveRun ? (
                      <Coffee className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="font-extrabold text-ink">
                      {autoRunner.checkingProxy &&
                        `🛡️ Đang kiểm tra Proxy sống (${autoRunner.currentIdx + 1}/${autoRunner.total}) cho Via ${autoRunner.currentViaLabel}...`}
                      {!autoRunner.checkingProxy &&
                        autoRunner.nightPaused &&
                        `🌙 Tạm nghỉ khung giờ đêm 22:30–08:00 (Via ${autoRunner.currentIdx + 1}/${autoRunner.total}) — Tự chạy tiếp lúc 08:00 sáng`}
                      {!autoRunner.checkingProxy &&
                        !autoRunner.nightPaused &&
                        autoRunner.phase === 'running' &&
                        `${autoRunner.isKeepAliveRun ? '☕ Đang Đảo Ấm Cookie' : '🤖 Đang chạy Automatic'} (${autoRunner.currentIdx + 1}/${autoRunner.total}) · Đang mở: ${autoRunner.currentViaLabel}`}
                      {autoRunner.phase === 'paused' &&
                        `⏸️ Đã tạm dừng ở Via ${autoRunner.currentIdx + 1}/${autoRunner.total} (${autoRunner.currentViaLabel})`}
                      {autoRunner.phase === 'syncing' &&
                        (autoRunner.isKeepAliveRun
                          ? `☕ Đã mở đủ ${autoRunner.total}/${autoRunner.total} Via đảo ấm — Hoàn tất sau ${autoRunner.countdownSec}s...`
                          : `🔄 Đã mở đủ ${autoRunner.total}/${autoRunner.total} Via — Đang đợi ${autoRunner.countdownSec}s rồi tự đồng bộ Page ID + gom về BM...`)}
                      {autoRunner.phase === 'done' &&
                        (autoRunner.isKeepAliveRun
                          ? `✅ Hoàn tất đảo ấm Cookie ${autoRunner.total - autoRunner.skippedProxyCount}/${autoRunner.total} Via an toàn!`
                          : `✅ Hoàn tất tự động ${autoRunner.total - autoRunner.skippedProxyCount}/${autoRunner.total} Via & đã kích hoạt đồng bộ Meta!`)}
                    </span>
                    {autoRunner.phase === 'running' && !autoRunner.checkingProxy && !autoRunner.nightPaused && (
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300">
                        ⏳ Nghỉ an toàn {autoRunner.countdownSec}s (+{autoRunner.lastJitterSec}s ngẫu nhiên)
                      </span>
                    )}
                    {autoRunner.skippedProxyCount > 0 && (
                      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10.5px] font-bold text-rose-700 dark:text-rose-300">
                        🛑 Đã bỏ qua {autoRunner.skippedProxyCount} Via lỗi/trùng Proxy
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {autoRunner.phase === 'running' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const p = { ...runnerStateRef.current, phase: 'paused' as const }
                            runnerStateRef.current = p
                            setAutoRunner(p)
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                        >
                          <Pause className="h-3 w-3" />
                          <span>Tạm dừng</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const tasks = runnerTasksRef.current
                            const nextIdx = runnerStateRef.current.currentIdx + 1
                            if (nextIdx < tasks.length) {
                              void activateBatchTaskAtIndex(
                                tasks,
                                nextIdx,
                                staggerSecondsRef.current,
                                runnerStateRef.current.bridgeMode,
                                runnerStateRef.current.isKeepAliveRun,
                                runnerStateRef.current.skippedProxyCount,
                              )
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                        >
                          <SkipForward className="h-3 w-3" />
                          <span>Mở ngay Via kế</span>
                        </button>
                      </>
                    )}
                    {autoRunner.phase === 'paused' && (
                      <button
                        type="button"
                        onClick={() => {
                          const r = { ...runnerStateRef.current, phase: 'running' as const }
                          runnerStateRef.current = r
                          setAutoRunner(r)
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                      >
                        <Play className="h-3 w-3" />
                        <span>Tiếp tục</span>
                      </button>
                    )}
                    {(autoRunner.phase === 'running' || autoRunner.phase === 'paused' || autoRunner.phase === 'syncing' || autoRunner.phase === 'done') && (
                      <button
                        type="button"
                        onClick={stopWebAutoRunner}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
                      >
                        <Square className="h-3 w-3" />
                        <span>{autoRunner.phase === 'done' ? 'Đóng' : 'Dừng Auto'}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      autoRunner.isKeepAliveRun ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${autoRunner.total > 0 ? Math.round(((autoRunner.currentIdx + 1) / autoRunner.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
                  <span>Phiên hiện tại: <strong className="text-ink">{autoRunner.currentPageName}</strong></span>
                  <span>
                    {autoRunner.bridgeMode === 'bridge'
                      ? '⚡ Đang mở qua Cầu nối ngầm 127.0.0.1:17890 (0 hộp thoại hỏi)'
                      : autoRunner.bridgeMode === 'protocol'
                        ? '🔗 Đang mở qua adsops-chrome:// (khuyên chạy .bat Cầu nối 1 lần để 0 popup)'
                        : '🚀 Đang kết nối trình duyệt Chrome Profile...'}
                  </span>
                </div>
              </div>
            )}

            {/* TAB 1: AUTO-ROTATING MULTI-VIA BATCH PAGE CREATOR */}
            {studioTab === 'batch' && (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-12">
                  {/* Left Config */}
                  <div className="space-y-3 rounded-xl border border-line bg-surface-muted/30 p-3.5 lg:col-span-7">
                    <div>
                      <div className="text-xs font-bold text-ink">
                        1. Chọn Ngành hàng — Hệ thống tự Spin Tên, Tiểu sử & Bài mồi khác nhau cho từng Page (Chống quét trùng lặp)
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {VIA_PAGE_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => setBatchNicheKey(tpl.key)}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                              batchNicheKey === tpl.key
                                ? 'border-emerald-500 bg-emerald-600 text-white'
                                : 'border-line bg-surface text-ink hover:border-emerald-500/50'
                            }`}
                          >
                            {tpl.badge}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <div>
                        <label className="label text-xs">Số Page cần tạo đợt này</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={batchCount}
                          onChange={(e) => setBatchCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                          className="input text-xs font-bold"
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[3, 5, Math.max(1, quotaAlerts.max_safe_batch_now)].map((preset, i) => (
                            <button
                              key={`${preset}-${i}`}
                              type="button"
                              onClick={() => setBatchCount(preset)}
                              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:border-emerald-500"
                            >
                              {i === 2 ? `Tối đa sạch (${preset})` : `${preset} Page`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="label text-xs">Khoảng nghỉ an toàn (+ngẫu nhiên 4–12s/Via)</label>
                        <select
                          value={batchStaggerSeconds}
                          onChange={(e) => setBatchStaggerSeconds(Number(e.target.value))}
                          className="input text-xs font-semibold"
                        >
                          <option value={22}>22s + ngẫu nhiên 4–10s / Via (Khuyên dùng)</option>
                          <option value={32}>32s + ngẫu nhiên 5–12s / Via (Siêu an toàn)</option>
                          <option value={45}>45s + ngẫu nhiên 5–12s / Via (Nuôi kỹ tự nhiên)</option>
                          <option value={1800}>⏳ Drip 30 phút / Via (+ngẫu nhiên, tự nghỉ đêm 22h–08h)</option>
                          <option value={3600}>⏳ Drip 60 phút / Via (+ngẫu nhiên, nuôi siêu tự nhiên)</option>
                        </select>
                      </div>

                      <div>
                        <label className="label text-xs">Gắn vào BM Trung tâm</label>
                        <select
                          value={studioBmId || (allBms[0]?.id ?? '')}
                          onChange={(e) => setStudioBmId(e.target.value)}
                          className="input text-xs"
                        >
                          <option value="">— Giữ tại Via trước —</option>
                          {allBms.map((b) => (
                            <option key={b.id} value={b.id}>
                              🏛️ {String(b.name ?? b.id)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="label text-xs">Tiền tố Thương hiệu (Tuỳ chọn — VD: Mắt Bão / Aura)</label>
                        <input
                          type="text"
                          value={batchBrandPrefix}
                          onChange={(e) => setBatchBrandPrefix(e.target.value)}
                          placeholder="Để trống để hệ thống tự sinh tên chuẩn ngành..."
                          className="input text-xs"
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Hoặc dán danh sách Tên Page riêng (Mỗi dòng 1 tên)</label>
                        <textarea
                          rows={2}
                          value={batchCustomNames}
                          onChange={(e) => setBatchCustomNames(e.target.value)}
                          placeholder="Để trống để hệ thống tự Spin không trùng..."
                          className="input text-xs"
                        />
                      </div>
                    </div>

                    {batchCount > eligibleBatchVias.length && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                        ⚠️ Bạn đang yêu cầu tạo <strong>{batchCount} Page</strong>, nhưng hiện chỉ có{' '}
                        <strong>{eligibleBatchVias.length} Via sạch</strong> (nguyên tắc an toàn: 1 Via chỉ tạo tối đa 1 Page/đợt). Hệ thống sẽ tự động giới hạn tạo đúng <strong>{eligibleBatchVias.length} Page</strong> trên các Via sạch để chống Checkpoint!
                      </div>
                    )}

                    {quotaAlerts.ip_cluster_advisory && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-800 dark:text-sky-200">
                        <span>{quotaAlerts.ip_cluster_advisory}</span>
                        <span className="flex items-center gap-2 shrink-0 font-bold">
                          <Link to="/facebook-accounts" className="underline hover:opacity-80">
                            Cấu hình Proxy Via ↗
                          </Link>
                          <Link to="/chrome-extension" className="underline hover:opacity-80">
                            Tải Bộ Extension v2.9.1 ↗
                          </Link>
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-ink-muted">
                        🛡️ Nghỉ giãn nhịp <strong>{batchStaggerSeconds}s + random 4–12s</strong> giữa mỗi Via · Tự dừng ngay nếu FB hỏi xác minh · Tự quét <code>Page ID</code> sau khi xong.
                      </span>
                      <Button
                        size="sm"
                        disabled={eligibleBatchVias.length === 0 || viaBatchCreateMut.isPending}
                        onClick={() => {
                          autoRunAfterCreateRef.current = true
                          viaBatchCreateMut.mutate({
                            count: batchCount,
                            niche_key: batchNicheKey,
                            brand_prefix: batchBrandPrefix,
                            custom_names: batchCustomNames,
                            owner_bm_id: studioBmId || String(allBms[0]?.id || ''),
                            stagger_seconds: batchStaggerSeconds,
                            auto_submit: autoSubmitMode,
                          })
                        }}
                        className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold shadow-xs"
                      >
                        {autoSubmitMode ? <Bot className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                        <span>
                          {viaBatchCreateMut.isPending
                            ? 'Đang tạo lô & khởi chạy Auto...'
                            : autoSubmitMode
                              ? `🤖 Tạo & Chạy Full Automatic (${Math.min(batchCount, eligibleBatchVias.length)} Page)`
                              : `🚀 Khởi Tạo Lô ${Math.min(batchCount, eligibleBatchVias.length)} Page (Bán tự động)`}
                        </span>
                      </Button>
                    </div>
                  </div>

                  {/* Right Preview: Eligible & Flagged Vias */}
                  <div className="space-y-2 lg:col-span-5">
                    <div className="flex items-center justify-between text-xs font-bold text-ink">
                      <span>2. Phân bổ tự động (1 Page = 1 Via sạch)</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {eligibleBatchVias.length}/{viaQuotas.length} Via sẵn sàng
                      </span>
                    </div>
                    <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                      {viaQuotas.map((vq) => {
                        const willRunIdx = eligibleBatchVias.findIndex((e) => e.via_id === vq.via_id)
                        const isPicked = willRunIdx >= 0 && willRunIdx < batchCount
                        return (
                          <div
                            key={vq.via_id}
                            className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                              isPicked
                                ? 'border-emerald-500/50 bg-emerald-500/10'
                                : vq.quota_status === 'LIMIT_REACHED' || vq.quota_status === 'COOLDOWN'
                                  ? 'border-rose-500/30 bg-rose-500/5 opacity-80'
                                  : 'border-line bg-surface'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-ink">
                                {isPicked ? `✅ #${willRunIdx + 1} · ` : ''}🛡️ {vq.label}
                              </span>
                              {vq.quota_status === 'SAFE' && (
                                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                  🟢 An toàn ({vq.holding_pages_count}/{vq.holding_limit})
                                </span>
                              )}
                              {vq.quota_status === 'NEAR_LIMIT' && (
                                <span className="font-bold text-amber-700 dark:text-amber-300">
                                  🟡 Sắp chạm trần ({vq.holding_pages_count}/{vq.holding_limit})
                                </span>
                              )}
                              {vq.quota_status === 'COOLDOWN' && (
                                <span className="font-bold text-amber-700 dark:text-amber-300">
                                  ⏳ Nghỉ Cooldown ({Math.floor((vq.cooldown_remaining_minutes ?? 0) / 60)}h{String((vq.cooldown_remaining_minutes ?? 0) % 60).padStart(2, '0')}p)
                                </span>
                              )}
                              {vq.quota_status === 'LIMIT_REACHED' && (
                                <span className="font-bold text-rose-700 dark:text-rose-300">
                                  🔴 Bỏ qua (Chạm trần)
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1.5 font-mono text-[10px] text-ink-muted">
                              <span>💻 {vq.browser_profile} · Hôm nay {vq.created_today_count}/{vq.daily_limit} · Tuần {vq.created_7d_count}/{vq.weekly_limit}</span>
                              <span className="inline-flex items-center gap-1.5">
                                {vq.needs_keepalive ? (
                                  <span className="font-sans font-bold text-amber-700 dark:text-amber-300">
                                    ☕ Nghỉ {vq.idle_days}d/{vq.keepalive_interval_days ?? 3}d — Nên đảo ấm
                                  </span>
                                ) : vq.last_keepalive_route ? (
                                  <span className="font-sans text-emerald-700 dark:text-emerald-300" title={vq.last_keepalive_route}>
                                    ☕ Ấm: {vq.last_keepalive_route.slice(0, 34)}{vq.last_keepalive_route.length > 34 ? '…' : ''}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={autoRunner.phase === 'running' || autoRunner.phase === 'syncing'}
                                  onClick={() => launchHumanKeepAliveForVias([vq])}
                                  className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-amber-800 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200"
                                  title="Đảo ấm sinh học riêng cho Via này (đa lộ trình + tự giữ tab nếu văng Cookie)"
                                >
                                  ☕ Đảo ấm
                                </button>
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* POST-CREATION BATCH EXECUTION QUEUE & LIVE AUTO-RUNNER */}
                {batchQueue.length > 0 && (
                  <div className="space-y-3 rounded-xl border-2 border-emerald-500/50 bg-emerald-500/5 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                          🎯 Hàng đợi {batchQueue.length} Page đã lưu vào Hệ thống
                        </div>
                        <p className="text-[11px] text-ink-muted">
                          Bấm <strong>🤖 Chạy Full Automatic</strong> để Web tự mở từng Via giãn nhịp ({batchStaggerSeconds}s + ngẫu nhiên), Extension v2.9.1 tự bấm Tạo Trang và tự quét Page ID sau khi xong.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => startWebAutoRunner(batchQueue, batchStaggerSeconds)}
                          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span>🤖 Chạy Full Automatic ({batchQueue.length} Via)</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void downloadUniquePageMediaZip(
                              batchQueue.map((t) => ({ page_name: t.page_name, category: t.category })),
                            )
                            setBannerMsg(
                              `🎨 Đã tạo & tải bộ ${batchQueue.length} cặp Ảnh Avatar + Cover 100% Độc Bản (khác mã hash chống trùng lặp)!`,
                            )
                          }}
                          className="gap-1.5 border-violet-500/40 bg-surface font-bold text-violet-700 dark:text-violet-300"
                          title="Tự vẽ bộ Avatar 800x800 + Cover 1640x624 khác mã Hash cho từng Page trong lô"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>🎨 Bộ Ảnh Độc Bản</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => downloadBatchPageCreationBat(batchQueue, batchStaggerSeconds, autoSubmitMode)}
                          className="gap-1.5 border-line bg-surface font-semibold text-ink"
                        >
                          <span>📥 Dự phòng .bat</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const task = batchQueue[batchQueueIdx % batchQueue.length]
                            if (!task) return
                            void navigator.clipboard.writeText(
                              `${task.page_name}\n\nTiểu sử: ${task.bio_description}\n\nBài mồi:\n${task.warmup_post_text}`,
                            )
                            void launchInAssignedChromeProfile(
                              withAutoSubmitPageUrl(task.launch_url, {
                                autoSubmit: autoSubmitMode,
                                warmupBeforeCreate,
                                autoUploadMedia,
                                autoCloseTab,
                              }),
                              task.browser_profile,
                              task.via_label,
                              task.network_label,
                            )
                            setBatchQueueIdx((prev) => (prev + 1 < batchQueue.length ? prev + 1 : 0))
                            setBannerMsg(
                              `🚀 Đã mở lẻ [${task.batch_index}/${task.batch_size}] Via «${task.via_label}» (${task.browser_profile}) cho Page «${task.page_name}»!`,
                            )
                          }}
                          className="gap-1.5 bg-surface font-semibold text-ink"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span>
                            ▶️ Mở Lẻ ({(batchQueueIdx % batchQueue.length) + 1}/{batchQueue.length})
                          </span>
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {batchQueue.map((task, idx) => (
                        <div
                          key={task.page_id}
                          className={`rounded-lg border p-2.5 text-xs ${
                            idx === batchQueueIdx % batchQueue.length
                              ? 'border-emerald-500 bg-surface shadow-xs'
                              : 'border-line bg-surface/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-ink truncate">
                              #{task.batch_index}. {task.page_name}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(`${task.page_name}\n${task.bio_description}`)
                                void launchInAssignedChromeProfile(
                                  withAutoSubmitPageUrl(task.launch_url, {
                                autoSubmit: autoSubmitMode,
                                warmupBeforeCreate,
                                autoUploadMedia,
                                autoCloseTab,
                              }),
                                  task.browser_profile,
                                  task.via_label,
                                  task.network_label,
                                )
                              }}
                              className="shrink-0 rounded bg-brand px-2 py-0.5 text-[10px] font-bold text-white hover:opacity-90"
                            >
                              Mở Chrome ↗
                            </button>
                            <button
                              type="button"
                              onClick={() => discardDraftMut.mutate(task.page_id)}
                              disabled={discardDraftMut.isPending}
                              title="Hủy bản nháp này và hoàn lại định mức Via"
                              className="shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-500/20"
                            >
                              ✕ Hủy
                            </button>
                          </div>
                          <div className="mt-1 text-[10.5px] text-ink-muted">
                            🛡️ {task.via_label} · <span className="font-mono">{task.browser_profile}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CREATE SINGLE PAGE VIA CHROME PROFILE + QUOTA MATRIX */}
            {studioTab === 'create' && (() => {
              const activeViaId = studioViaId || viaQuotas[0]?.via_id || ''
              const selectedQuota = viaQuotas.find((v) => v.via_id === activeViaId)
              const isBlockedQuota =
                selectedQuota?.quota_status === 'LIMIT_REACHED' || selectedQuota?.quota_status === 'COOLDOWN'
              const nextSafeVia = viaQuotas.find(
                (v) => v.via_id !== activeViaId && (v.quota_status === 'SAFE' || v.quota_status === 'NEAR_LIMIT'),
              )
              return (
              <div className="grid gap-4 lg:grid-cols-12">
                {/* Left: Via Quota Selector */}
                <div className="space-y-2.5 lg:col-span-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink">
                      1. Chọn Tài khoản Via (Lớp 1 / Dự phòng) để Tạo & Giữ Page
                    </span>
                    <span className="text-[11px] text-ink-muted">Bấm chọn Via bên dưới</span>
                  </div>
                  <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                    {viaQuotas.map((vq) => {
                      const isSelected = vq.via_id === activeViaId
                      return (
                        <button
                          key={vq.via_id}
                          type="button"
                          onClick={() => {
                            setStudioViaId(vq.via_id)
                            setForceOverrideQuota(false)
                          }}
                          className={`w-full rounded-xl border p-2.5 text-left transition ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
                              : 'border-line bg-surface hover:border-emerald-500/40'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-xs font-bold text-ink">
                              🛡️ {vq.label}{' '}
                              <span className="font-mono text-[10px] font-normal text-ink-muted">
                                ({vq.browser_profile})
                              </span>
                            </span>
                            {vq.quota_status === 'SAFE' && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                🟢 An toàn tạo tiếp
                              </span>
                            )}
                            {vq.quota_status === 'NEAR_LIMIT' && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                🟡 Sắp chạm trần ({vq.holding_pages_count}/{vq.holding_limit})
                              </span>
                            )}
                            {vq.quota_status === 'COOLDOWN' && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                ⏳ Nghỉ Cooldown ({Math.floor((vq.cooldown_remaining_minutes ?? 0) / 60)}h{String((vq.cooldown_remaining_minutes ?? 0) % 60).padStart(2, '0')}p)
                              </span>
                            )}
                            {vq.quota_status === 'LIMIT_REACHED' && (
                              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                                🔴 Chạm trần cảnh báo ({vq.holding_pages_count}/{vq.holding_limit} Page)
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">
                              Hôm nay: <strong>{vq.created_today_count}/{vq.daily_limit}</strong>
                            </span>
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">
                              7 ngày: <strong>{vq.created_7d_count}/{vq.weekly_limit}</strong>
                            </span>
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">
                              Đang giữ: <strong>{vq.holding_pages_count}/{vq.holding_limit} Page</strong>
                            </span>
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">
                              Bài mồi: <strong>{vq.warmup_posts_count}</strong>
                            </span>
                          </div>
                          {vq.warning_reasons && vq.warning_reasons.length > 0 && (
                            <div className="mt-1 text-[10.5px] font-medium text-rose-700 dark:text-rose-300">
                              ⚠️ {vq.warning_reasons[0]}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Right: Smart Page Template & 1-Click Chrome Auto-Create with Inline Quota Guardrail */}
                <div className="space-y-3 rounded-xl border border-line bg-surface-muted/30 p-3.5 lg:col-span-7">
                  {selectedQuota && selectedQuota.warning_reasons && selectedQuota.warning_reasons.length > 0 && (
                    <div
                      className={`space-y-2 rounded-lg border p-3 text-xs ${
                        isBlockedQuota
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                      }`}
                    >
                      <div className="font-bold">
                        {isBlockedQuota
                          ? `🛑 Cảnh báo Chặn An Toàn cho Via «${selectedQuota.label}»:`
                          : `⚠️ Via «${selectedQuota.label}» sắp chạm ngưỡng an toàn:`}
                      </div>
                      <ul className="list-disc pl-4 text-[11px] space-y-0.5">
                        {selectedQuota.warning_reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      {isBlockedQuota && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {nextSafeVia && (
                            <button
                              type="button"
                              onClick={() => {
                                setStudioViaId(nextSafeVia.via_id)
                                setForceOverrideQuota(false)
                              }}
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                            >
                              🔀 Đổi ngay sang Via An Toàn ({nextSafeVia.label})
                            </button>
                          )}
                          <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={forceOverrideQuota}
                              onChange={(e) => setForceOverrideQuota(e.target.checked)}
                            />
                            <span>Tôi hiểu rủi ro Checkpoint &amp; vẫn muốn ép tạo trên Via này</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-bold text-ink">
                      2. Chọn Mẫu Ngành Hàng Chuẩn Chính Sách (Tự điền Tên Page + Hạng mục + Tiểu sử + Bài mồi)
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {VIA_PAGE_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.key}
                          type="button"
                          onClick={() => {
                            const suffix = Math.floor(100 + Math.random() * 899)
                            setStudioPageName(`${tpl.namePrefix} #${suffix}`)
                            setStudioCategory(tpl.category)
                            setStudioBio(tpl.bio)
                            setStudioWarmupPost(tpl.warmupPost)
                          }}
                          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300"
                        >
                          {tpl.badge}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="label text-xs">Tên Fanpage cần tạo *</label>
                      <input
                        type="text"
                        value={studioPageName}
                        onChange={(e) => setStudioPageName(e.target.value)}
                        placeholder="VD: Viện Chăm Sóc Sắc Đẹp & Da Liễu #208"
                        className="input text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <label className="label text-xs">Hạng mục (Category)</label>
                      <input
                        type="text"
                        value={studioCategory}
                        onChange={(e) => setStudioCategory(e.target.value)}
                        className="input text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label text-xs">Đưa vào BM Trung tâm quản lý</label>
                      <select
                        value={studioBmId || (allBms[0]?.id ?? '')}
                        onChange={(e) => setStudioBmId(e.target.value)}
                        className="input text-xs"
                      >
                        <option value="">— Giữ ở Via cá nhân trước, đưa vào BM sau —</option>
                        {allBms.map((b) => (
                          <option key={b.id} value={b.id}>
                            🏛️ {String(b.name ?? b.id)} {b.external_id ? `(${String(b.external_id)})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label text-xs">Tiểu sử chuẩn SEO (Tự điền vào ô Bio của Facebook)</label>
                      <textarea
                        rows={2}
                        value={studioBio}
                        onChange={(e) => setStudioBio(e.target.value)}
                        className="input text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label text-xs">Bài đăng mồi đầu tiên (Kèm lưu nhật ký nuôi Page)</label>
                      <textarea
                        rows={2}
                        value={studioWarmupPost}
                        onChange={(e) => setStudioWarmupPost(e.target.value)}
                        className="input text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-ink-muted">
                      💡 Hệ thống sẽ: (1) Lưu Page &amp; Nhật ký Via, (2) Mở đúng Chrome của Via đã chọn và (3) {autoSubmitMode ? 'Extension v2.9.1 tự điền + tự bấm Tạo Trang giãn nhịp an toàn (tự quét Page ID sau 26s).' : 'Extension v2.9.1 tự điền sẵn Tên + Tiểu sử chờ bạn kiểm tra & bấm Tạo Trang.'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!studioPageName.trim()}
                      onClick={() => {
                        void downloadUniquePageMediaZip([
                          { page_name: studioPageName.trim(), category: studioCategory.trim() },
                        ])
                        setBannerMsg(`🎨 Đã tải Avatar + Ảnh Bìa Độc Bản cho Page «${studioPageName.trim()}»!`)
                      }}
                      className="gap-1.5 font-semibold"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>🎨 Ảnh Avatar/Cover Độc Bản</span>
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !studioPageName.trim() ||
                        viaCreateLaunchMut.isPending ||
                        (isBlockedQuota && !forceOverrideQuota)
                      }
                      onClick={() => {
                        const chosenVia = viaQuotas.find((v) => v.via_id === activeViaId)
                        viaCreateLaunchMut.mutate({
                          via_id: activeViaId || String(allVias[0]?.id || ''),
                          owner_bm_id: studioBmId || String(allBms[0]?.id || ''),
                          page_name: studioPageName.trim(),
                          category: studioCategory.trim(),
                          bio_description: studioBio.trim(),
                          warmup_post_text: studioWarmupPost.trim(),
                          browser_profile: chosenVia?.browser_profile || 'Chrome — Default',
                          via_label: chosenVia?.label || 'Tài Khoản Chính',
                          network_label: chosenVia?.network_label || '',
                          force_override: forceOverrideQuota,
                          auto_submit: autoSubmitMode,
                        })
                      }}
                      className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span>
                        {viaCreateLaunchMut.isPending
                          ? 'Đang lưu & khởi chạy...'
                          : isBlockedQuota && !forceOverrideQuota
                            ? '🔒 Đang khóa an toàn (Hãy đổi Via sạch hoặc tick xác nhận)'
                            : autoSubmitMode
                              ? '🤖 Lưu Hệ Thống & Chạy Full Automatic Trên Chrome Via'
                              : '🚀 Lưu Hệ Thống & Mở Chrome Via Tự Điền (Chờ Bấm Tay)'}
                      </span>
                    </Button>
                    </div>
                  </div>
                </div>
              </div>
              )
            })()}

            {/* TAB 3: AUTO BATCH WARM-UP + SINGLE WARM-UP */}
            {studioTab === 'warmup' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                  <div>
                    <div className="font-bold text-emerald-800 dark:text-emerald-200">
                      ⚡ Nuôi Page Hàng Loạt Tự Động ({underNurturedCount} Fanpage đang có &lt; 3 bài mồi)
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      Tự động sinh bài mồi khác nhau theo ngành hàng, ưu tiên đăng ngầm qua Meta Graph API (nếu đã đồng bộ Token Page) và ghi nhận điểm Trust vào Database.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={underNurturedCount === 0 || batchWarmupMut.isPending}
                    onClick={() => batchWarmupMut.mutate()}
                    className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      {batchWarmupMut.isPending
                        ? 'Đang nuôi hàng loạt...'
                        : `⚡ 1 Chạm Nuôi Hàng Loạt ${underNurturedCount} Page Yếu Trust`}
                    </span>
                  </Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-12">
                  <div className="space-y-2.5 lg:col-span-5">
                    <div className="text-xs font-bold text-ink">
                      Hoặc chọn riêng 1 Fanpage cần Đăng Bài Mồi Nuôi Độ Trust
                    </div>
                    <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                      {items.map((pg) => {
                        const activePid = warmupTargetPageId || items[0]?.id || ''
                        const isSel = pg.id === activePid
                        const wScore = pg.warmup_score ?? 65
                        const wPosts = pg.warmup_posts_count ?? 1
                        return (
                          <button
                            key={pg.id}
                            type="button"
                            onClick={() => setWarmupTargetPageId(pg.id)}
                            className={`w-full rounded-xl border p-2.5 text-left transition ${
                              isSel
                                ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
                                : 'border-line bg-surface hover:border-emerald-500/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-ink">{pg.name}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  wScore >= 75
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                🌱 Trust {wScore}% · {wPosts} bài mồi
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                              <span>🛡️ Via: {pg.holder_label || 'Via Tổng'}</span>
                              <span className="font-mono text-[10px]">({pg.holder_browser_profile})</span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-line bg-surface-muted/30 p-3.5 lg:col-span-7">
                    <div>
                      <div className="text-xs font-bold text-ink">
                        Chọn kịch bản bài mồi tự nhiên (Tương tác sạch, không từ khóa vi phạm chính sách)
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {VIA_PAGE_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => setWarmupMessage(tpl.warmupPost)}
                            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-emerald-500"
                          >
                            {tpl.badge}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label text-xs">Nội dung bài đăng nuôi Page *</label>
                      <textarea
                        rows={4}
                        value={warmupMessage}
                        onChange={(e) => setWarmupMessage(e.target.value)}
                        className="input text-xs"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!warmupMessage.trim() || warmupPostMut.isPending}
                        onClick={() => {
                          const targetPg = items.find((x) => x.id === (warmupTargetPageId || items[0]?.id))
                          if (!targetPg) return
                          warmupPostMut.mutate({
                            pageId: targetPg.id,
                            pageName: targetPg.name,
                            externalPageId: targetPg.external_page_id,
                            pageUrl: targetPg.url,
                            viaId: targetPg.holder_identity_id || '',
                            viaLabel: targetPg.holder_label || 'Via Tổng',
                            browserProfile: targetPg.holder_browser_profile || 'Profile 1',
                            networkLabel: targetPg.holder_network_label || '',
                            message: warmupMessage.trim(),
                            postMode: 'chrome_assist',
                          })
                        }}
                        className="gap-1.5 font-semibold"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        <span>🌐 Copy Bài + Mở Chrome Via Đăng &amp; Lưu Nhật Ký</span>
                      </Button>
                      <Button
                        size="sm"
                        disabled={!warmupMessage.trim() || warmupPostMut.isPending}
                        onClick={() => {
                          const targetPg = items.find((x) => x.id === (warmupTargetPageId || items[0]?.id))
                          if (!targetPg) return
                          warmupPostMut.mutate({
                            pageId: targetPg.id,
                            pageName: targetPg.name,
                            externalPageId: targetPg.external_page_id,
                            pageUrl: targetPg.url,
                            viaId: targetPg.holder_identity_id || '',
                            viaLabel: targetPg.holder_label || 'Via Tổng',
                            browserProfile: targetPg.holder_browser_profile || 'Profile 1',
                            networkLabel: targetPg.holder_network_label || '',
                            message: warmupMessage.trim(),
                            postMode: 'graph_api_or_assist',
                          })
                        }}
                        className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>⚡ Đăng Bài Mồi (Graph API / Ghi Nhật Ký Nuôi Page)</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: PERSISTENT VIA ACTIVITY LOGS (STORED IN POSTGRESQL AUDIT_LOGS) */}
            {studioTab === 'logs' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-ink">
                    📜 Lịch sử hoạt động của từng Via (Lưu vĩnh viễn trong PostgreSQL — mở lại trình duyệt bất cứ lúc nào đều xem lại được)
                  </div>
                  <select
                    value={logViaFilter}
                    onChange={(e) => setLogViaFilter(e.target.value)}
                    className="input h-8 w-auto text-xs font-semibold"
                  >
                    <option value="ALL">🛡️ Tất cả Via ({viaActivityLogs.length} hoạt động)</option>
                    {viaQuotas.map((vq) => (
                      <option key={vq.via_id} value={vq.via_id}>
                        {vq.label} ({vq.browser_profile})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 text-[11px] font-bold text-ink-muted">
                        <th className="px-3 py-2">Thời gian</th>
                        <th className="px-3 py-2">Tài khoản Via &amp; Hồ sơ Chrome</th>
                        <th className="px-3 py-2">Hoạt động</th>
                        <th className="px-3 py-2">Fanpage mục tiêu</th>
                        <th className="px-3 py-2">Chi tiết lưu trữ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {viaActivityLogs
                        .filter((lg) => logViaFilter === 'ALL' || lg.via_id === logViaFilter)
                        .map((lg) => (
                          <tr key={lg.id} className="hover:bg-surface-muted/30">
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-muted">
                              {new Date(lg.created_at).toLocaleString('vi-VN')}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-bold text-ink">🛡️ {lg.via_label}</div>
                              <div className="font-mono text-[10px] text-ink-muted">💻 {lg.browser_profile}</div>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                                  lg.action === 'page.via_created'
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : lg.action === 'page.warmup_posted'
                                    ? 'bg-brand-light text-brand-text'
                                    : 'bg-surface-muted text-ink'
                                }`}
                              >
                                {lg.action_label}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-semibold text-ink">{lg.page_name}</td>
                            <td className="px-3 py-2 text-[11px] text-ink-muted">{lg.detail}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
                                {extId ? (
                                  <span>ID: {extId}</span>
                                ) : (
                                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                    📝 Nháp chờ tạo FB / Đồng bộ Meta
                                  </span>
                                )}
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
                              <button
                                type="button"
                                onClick={() => {
                                  setWarmupTargetPageId(item.id)
                                  setStudioTab('warmup')
                                  setStudioOpen(true)
                                }}
                                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                                title="Đăng bài mồi nuôi độ Trust cho Fanpage này và lưu lịch sử hoạt động Via"
                              >
                                <span>🌱 Trust {item.warmup_score ?? 65}% ({item.warmup_posts_count ?? 1} bài)</span>
                              </button>
                              {(item.soak_remaining_hours ?? 0) > 0 && (
                                <span
                                  className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300"
                                  title="Khuyến nghị ngâm đủ 48h–72h và 3 bài mồi trước khi gắn TKQC lên chiến dịch"
                                >
                                  ⏳ Ngâm còn {item.soak_remaining_hours}h/48h
                                </span>
                              )}
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
                                const targetLaunchUrl = !extId
                                  ? `https://www.facebook.com/pages/creation/?adsops_page_name=${encodeURIComponent(item.name)}&adsops_page_cat=${encodeURIComponent(item.category || '')}&adsops_page_bio=${encodeURIComponent((item.bio_description || item.notes || '').slice(0, 240))}`
                                  : bmPageSettingsUrl
                                launchInAssignedChromeProfile(
                                  targetLaunchUrl,
                                  item.holder_browser_profile || 'Profile 1',
                                  item.holder_label || item.name,
                                  item.holder_network_label,
                                )
                                setBannerMsg(
                                  !extId
                                    ? `🚀 Đã mở Chrome (${item.holder_browser_profile || 'Profile 1'}) của Via «${item.holder_label || item.name}» tới trang Tạo Page để Extension tự điền «${item.name}»!`
                                    : isEn
                                      ? `🚀 Launched Chrome (${item.holder_browser_profile || 'Profile 1'}) for ${item.holder_label || item.name}`
                                      : `🚀 Đã mở Hồ sơ Chrome (${item.holder_browser_profile || 'Profile 1'}) của Via giữ Page: ${item.holder_label || item.name}`,
                                )
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
                              title={
                                !extId
                                  ? `Mở ${item.holder_browser_profile} tại trang Tạo Page & tự điền tên «${item.name}»`
                                  : isEn
                                    ? `Open ${item.holder_browser_profile} of ${item.holder_label ?? 'Holding Via'}`
                                    : `Mở đúng ${item.holder_browser_profile} của Via giữ Page (${item.holder_label ?? 'Via Tổng'})`
                              }
                            >
                              <Globe className="h-3 w-3" />
                              <span>{!extId ? '🌱 Mở Tạo Trên FB' : isEn ? '🚀 Open Holder Chrome' : '🚀 Mở Chrome Via Giữ'}</span>
                            </button>

                            {!extId && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void downloadUniquePageMediaZip([
                                      { page_name: item.name, category: item.category || '' },
                                    ])
                                    setBannerMsg(`🎨 Đã tải Ảnh Avatar + Cover Độc Bản cho Page «${item.name}»!`)
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-500/20"
                                  title="Tạo & tải cặp Avatar 800x800 + Cover 1640x624 khác mã Hash"
                                >
                                  <ImageIcon className="h-3 w-3" />
                                  <span>Ảnh Độc Bản</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => discardDraftMut.mutate(item.id)}
                                  disabled={discardDraftMut.isPending}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
                                  title="Hủy bản nháp này & hoàn lại định mức tạo Page cho Via"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span>Hủy nháp</span>
                                </button>
                              </>
                            )}

                            {Boolean(extId) && !item.owner_bm_id && allBms.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  claimPageToBmMut.mutate({
                                    pageId: item.id,
                                    businessManagerId: studioBmId || String(allBms[0]?.id || ''),
                                  })
                                }
                                disabled={claimPageToBmMut.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
                                title="Gọi Meta Graph API gán quyền sở hữu Fanpage này về Business Manager trung tâm"
                              >
                                <Building2 className="h-3 w-3" />
                                <span>🏛️ Gom về BM</span>
                              </button>
                            )}

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

            {editingPage &&
              ((editingPage.soak_remaining_hours ?? 0) > 0 ||
                (editingPage.warmup_posts_count ?? 3) < 3 ||
                !editingPage.external_page_id) && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <strong>⚠️ Khuyến nghị kỹ thuật Chống Chết Page Mới:</strong> Page này{' '}
                  {!editingPage.external_page_id ? 'chưa đồng bộ Page ID thật từ Meta · ' : ''}
                  {(editingPage.soak_remaining_hours ?? 0) > 0
                    ? `đang trong thời gian ngâm (còn ${editingPage.soak_remaining_hours}h / 48h) · `
                    : ''}
                  {(editingPage.warmup_posts_count ?? 3) < 3
                    ? `mới có ${editingPage.warmup_posts_count ?? 0}/3 bài mồi nuôi Trust.`
                    : ''}
                  <span className="block mt-0.5 text-[11px]">
                    Bạn nên hoàn tất tạo trên Facebook, bấm <strong>🔄 Đồng bộ Meta</strong>, nuôi đủ 3 bài mồi và ngâm đủ 48h rồi mới gán TKQC chạy chiến dịch!
                  </span>
                </div>
              )}

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
