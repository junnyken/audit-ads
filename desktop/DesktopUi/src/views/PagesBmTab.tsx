import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileSpreadsheet,
  FolderOpen,
  Ghost,
  Globe,
  Image as ImageIcon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InspectorDrawer, InspectorSection } from '@/components/ui/inspector-drawer'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentedTabs, StatusDot } from '@/components/ui/studio-primitives'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { sendDesktopCommand } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto, WebFanpageDto } from '@/types'

function getPageInitials(name: string): string {
  const words = (name || 'FP').split(/[\s\-_]+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
  return (name || 'FP').slice(0, 2).toUpperCase()
}

export function PagesBmTab({ state }: { state: AppShellWebStateDto }) {
  const [activeSubTab, setActiveSubTab] = useState<'pages' | 'content_nurture' | 'bms_assets'>('pages')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [customDomain, setCustomDomain] = useState(state.domainSeo.customDomain)
  const [inspectedPage, setInspectedPage] = useState<WebFanpageDto | null>(null)

  const pn = state.pageNurture
  const [nurtureMode, setNurtureMode] = useState(pn?.mode || 'alternate')
  const [assetsDir, setAssetsDir] = useState(pn?.assetsDir || '')
  const [hashJitter, setHashJitter] = useState(pn?.enableImageHashJitter ?? true)
  const [shareUrls, setShareUrls] = useState(pn?.shareSourceUrls || '')
  const [captionSpin, setCaptionSpin] = useState(pn?.captionSpintax || '')

  useEffect(() => {
    setCustomDomain(state.domainSeo.customDomain)
  }, [state.configRev, state.domainSeo.customDomain])

  useEffect(() => {
    if (!pn) return
    setNurtureMode(pn.mode || 'alternate')
    setAssetsDir(pn.assetsDir || '')
    setHashJitter(pn.enableImageHashJitter ?? true)
    setShareUrls(pn.shareSourceUrls || '')
    setCaptionSpin(pn.captionSpintax || '')
  }, [state.configRev, pn?.mode, pn?.assetsDir, pn?.enableImageHashJitter, pn?.shareSourceUrls, pn?.captionSpintax])

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.fanpages.filter((p) => {
      const okTab =
        statusFilter === 'unsynced'
          ? p.isUnsyncedDraft
          : statusFilter === 'need_claim'
          ? !p.ownerBmId.trim()
          : statusFilter === 'need_warmup'
          ? !p.adsReady || p.warmupPostsCount < 2
          : statusFilter === 'restricted'
          ? p.healthStatus.toUpperCase() !== 'LIVE' || p.contagionRisk.toUpperCase() !== 'SAFE'
          : true
      if (!okTab) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.externalPageId.toLowerCase().includes(q) ||
        p.effectiveHolderLabel.toLowerCase().includes(q)
      )
    })
  }, [state.fanpages, search, statusFilter])

  const liveInspected = useMemo(
    () => (inspectedPage ? state.fanpages.find((p) => p.id === inspectedPage.id) ?? inspectedPage : null),
    [inspectedPage, state.fanpages],
  )

  const filterTabs = [
    { value: 'all', label: 'Tất cả', count: state.fanpages.length },
    { value: 'unsynced', label: 'Nháp', count: state.fanpages.filter((x) => x.isUnsyncedDraft).length },
    { value: 'need_claim', label: 'Chưa kéo BM', count: state.fanpages.filter((x) => !x.ownerBmId.trim()).length },
    { value: 'need_warmup', label: 'Cần nuôi', count: state.fanpages.filter((x) => !x.adsReady).length },
    {
      value: 'restricted',
      label: 'Hạn chế',
      count: state.fanpages.filter((x) => x.healthStatus.toUpperCase() !== 'LIVE').length,
    },
  ]

  function saveNurtureConfig() {
    sendDesktopCommand('save_page_nurture_config', {
      mode: nurtureMode,
      assetsDir,
      enableImageHashJitter: hashJitter,
      shareSourceUrls: shareUrls,
      captionSpintax: captionSpin,
    })
  }

  return (
    <div className="space-y-4">
      {/* Top Studio Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={activeSubTab}
          onChange={setActiveSubTab}
          items={[
            { value: 'pages', label: 'Fanpage', count: state.fanpages.length },
            { value: 'content_nurture', label: 'Kho ảnh & Nuôi 14 ngày' },
            { value: 'bms_assets', label: 'BM & Pixel', count: state.bms.length + state.pixels.length },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => sendDesktopCommand('export_pages_csv')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => sendDesktopCommand('sync_meta_pages')}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ Page Meta
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs font-semibold" onClick={() => sendDesktopCommand('open_create_bm')}>
            <Plus className="h-3.5 w-3.5" /> Thêm BM
          </Button>
        </div>
      </div>

      {/* SUB-TAB 1: FANPAGES */}
      {activeSubTab === 'pages' && (
        <div className="space-y-3.5">
          {/* Single-Line Filter + Batch Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SegmentedTabs items={filterTabs} value={statusFilter} onChange={setStatusFilter} />

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-52 sm:w-60">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm Fanpage, ID, Via..."
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {state.automationConfig.isSilentInviteRunning && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => sendDesktopCommand('cancel_silent_invite')}
                >
                  <Square className="h-3.5 w-3.5" /> Dừng mời ẩn
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs">
                    Thao tác lô <ChevronDown className="h-3 w-3 opacity-65" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onClick={() => sendDesktopCommand('batch_invite_followers')}>
                    <UserPlus className="h-3.5 w-3.5 text-primary" />
                    Mời Follow lô (Mở Chrome)
                  </DropdownMenuItem>
                  {!state.automationConfig.isSilentInviteRunning && (
                    <DropdownMenuItem onClick={() => sendDesktopCommand('silent_invite_batch_pages')}>
                      <Ghost className="h-3.5 w-3.5 text-emerald-500" />
                      Mời ẩn lô ngoài màn hình
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => sendDesktopCommand('batch_warmup_pages')}>
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Nuôi lô (Tối đa 10 Fanpage)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Slim Auto-Invite Scheduler Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/75 bg-muted/25 px-4 py-2">
            <div className="flex items-center gap-2.5">
              <Switch
                id="auto-silent-invite"
                checked={Boolean(state.automationConfig.autoSilentInviteEnabled)}
                onCheckedChange={(checked) =>
                  sendDesktopCommand('save_silent_invite_config', {
                    enabled: checked,
                    intervalMinutes: state.automationConfig.autoSilentInviteIntervalMinutes ?? 60,
                  })
                }
              />
              <Label htmlFor="auto-silent-invite" className="cursor-pointer text-xs font-medium text-foreground">
                Tự động quét &amp; mời Follow chạy ẩn định kỳ
              </Label>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Select
                value={String(state.automationConfig.autoSilentInviteIntervalMinutes ?? 60)}
                onValueChange={(val) =>
                  sendDesktopCommand('save_silent_invite_config', {
                    enabled: Boolean(state.automationConfig.autoSilentInviteEnabled),
                    intervalMinutes: Number(val) || 60,
                  })
                }
              >
                <SelectTrigger className="h-7 w-28 bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Mỗi 30 phút</SelectItem>
                  <SelectItem value="60">Mỗi 60 phút</SelectItem>
                  <SelectItem value="120">Mỗi 2 giờ</SelectItem>
                  <SelectItem value="240">Mỗi 4 giờ</SelectItem>
                </SelectContent>
              </Select>
              <StatusDot
                tone={state.automationConfig.isSilentInviteRunning ? 'live' : 'muted'}
                label={
                  state.automationConfig.isSilentInviteRunning
                    ? 'Đang mời ẩn...'
                    : `Gần nhất: ${state.automationConfig.lastAutoSilentInviteLocal || 'Chưa chạy'}`
                }
                labelClassName="font-mono text-[11px]"
              />
            </div>
          </div>

          {/* Unified Hairline Fanpage Table */}
          {state.fanpages.length === 0 ? (
            <div className="studio-panel flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Globe className="h-9 w-9 text-muted-foreground/60" />
              <div>
                <div className="text-sm font-semibold text-foreground">Chưa có Fanpage nào</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nhấn Đồng bộ Page Meta để nạp toàn bộ Fanpage từ Token / BM.
                </p>
              </div>
              <Button size="sm" onClick={() => sendDesktopCommand('sync_meta_pages')}>
                <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ Page Meta
              </Button>
            </div>
          ) : filteredPages.length === 0 ? (
            <div className="studio-panel py-10 text-center text-xs text-muted-foreground">
              Không có Fanpage khớp bộ lọc hiện tại.
            </div>
          ) : (
            <div className="studio-panel overflow-hidden">
              <div className="hidden grid-cols-[1.45fr_0.95fr_1.25fr_170px] items-center gap-3 border-b border-border/75 bg-muted/25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/85 lg:grid">
                <div>Fanpage &amp; Trạng thái</div>
                <div>Theo dõi &amp; Nuôi 14N</div>
                <div>Via cầm &amp; BM</div>
                <div className="text-right">Thao tác</div>
              </div>
              <div className="divide-y divide-border/55">
                {filteredPages.map((pg) => (
                  <FanpageStudioRow
                    key={pg.id}
                    page={pg}
                    holderOptions={state.pageHolderOptions}
                    onInspect={() => setInspectedPage(pg)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: HYBRID CONTENT NURTURE CENTER */}
      {activeSubTab === 'content_nurture' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Trung tâm Nuôi Fanpage 14 Ngày (Ảnh + Caption Spin + Share)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tự đổi hash 1px ảnh nguồn hoặc tự vẽ ảnh Card 1080×1080 khi thư mục ảnh đang trống.
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {pn?.imagesFoundCount ?? 0} ảnh · {pn?.shareSourceCount ?? 0} link nguồn
            </span>
          </div>

          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Chế độ nuôi nội dung</Label>
                <Select value={nurtureMode} onValueChange={setNurtureMode}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alternate">Xen kẽ Đăng Ảnh + Chia sẻ bài (Khuyên dùng)</SelectItem>
                    <SelectItem value="post">Chỉ Đăng bài (Text Spin + Ảnh đổi hash)</SelectItem>
                    <SelectItem value="share">Chỉ Chia sẻ bài (tự fallback đăng ảnh nếu trống)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 lg:col-span-2">
                <Label className="text-xs">Thư mục Kho Ảnh (avatars / covers / posts)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={assetsDir}
                    onChange={(e) => setAssetsDir(e.target.value)}
                    placeholder="Mặc định: %LOCALAPPDATA%\AdsOpsDesktop\PageAssets"
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={() =>
                      sendDesktopCommand('open_page_assets_dir', { nicheKey: state.automationConfig.batchNicheKey })
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Mở thư mục
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Danh sách URL nguồn chia sẻ (mỗi dòng 1 link)</Label>
                <Textarea
                  rows={4}
                  value={shareUrls}
                  onChange={(e) => setShareUrls(e.target.value)}
                  placeholder="https://www.facebook.com/page_uy_tin/posts/123456"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mẫu Caption Spintax ({'{A|B|C}'}, {'{page_name}'}, {'{niche}'})</Label>
                <Textarea
                  rows={4}
                  value={captionSpin}
                  onChange={(e) => setCaptionSpin(e.target.value)}
                  placeholder="{Chào ngày mới|Góc chia sẻ hay} cùng {page_name}!"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/65 pt-3.5">
              <div className="flex items-center gap-2.5">
                <Switch id="img-hash-jitter" checked={hashJitter} onCheckedChange={setHashJitter} />
                <Label htmlFor="img-hash-jitter" className="cursor-pointer text-xs">
                  Xóa EXIF &amp; biến đổi 1px hash ảnh chống trùng MD5/SHA-256 trước khi đăng
                </Label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={saveNurtureConfig}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Lưu cấu hình
                </Button>
                {pn?.isSilentPageNurtureRunning ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => sendDesktopCommand('cancel_silent_page_nurture')}
                  >
                    <Square className="h-3.5 w-3.5" /> Dừng nuôi ẩn
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      saveNurtureConfig()
                      sendDesktopCommand('silent_page_nurture_batch', { mode: nurtureMode })
                    }}
                  >
                    <Ghost className="h-3.5 w-3.5 text-emerald-500" /> Đăng/Share ẩn lô
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  onClick={() => {
                    saveNurtureConfig()
                    sendDesktopCommand('page_nurture_batch_run', { mode: nurtureMode, viaBrowser: true })
                  }}
                >
                  <Play className="h-3.5 w-3.5" /> Chạy lô mở Chrome
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/75 bg-muted/25 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <Switch
                  id="auto-silent-page-nurture"
                  checked={Boolean(pn?.autoSilentPageNurtureEnabled)}
                  onCheckedChange={(checked) =>
                    sendDesktopCommand('save_silent_page_nurture_config', {
                      enabled: checked,
                      intervalHours: pn?.autoSilentPageNurtureIntervalHours ?? 12,
                    })
                  }
                />
                <Label htmlFor="auto-silent-page-nurture" className="cursor-pointer text-xs font-medium text-foreground">
                  <Bot className="mr-1.5 inline h-3.5 w-3.5 text-primary" />
                  Tự động Nuôi Page 14 ngày chạy ẩn định kỳ
                </Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Select
                  value={String(pn?.autoSilentPageNurtureIntervalHours ?? 12)}
                  onValueChange={(val) =>
                    sendDesktopCommand('save_silent_page_nurture_config', {
                      enabled: Boolean(pn?.autoSilentPageNurtureEnabled),
                      intervalHours: Number(val) || 12,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">Mỗi 6 giờ</SelectItem>
                    <SelectItem value="12">Mỗi 12 giờ</SelectItem>
                    <SelectItem value="24">Mỗi 24 giờ</SelectItem>
                  </SelectContent>
                </Select>
                <StatusDot
                  tone={pn?.isSilentPageNurtureRunning ? 'live' : 'muted'}
                  label={
                    pn?.isSilentPageNurtureRunning
                      ? 'Đang chạy ẩn...'
                      : `Gần nhất: ${pn?.lastAutoSilentPageNurtureLocal || 'Chưa chạy'}`
                  }
                  labelClassName="font-mono text-[11px]"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SUB-TAB 3: BUSINESS MANAGERS, PIXELS & DOMAIN SEO */}
      {activeSubTab === 'bms_assets' && (
        <div className="space-y-4">
          <section className="studio-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-5 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Business Manager đang quản lý ({state.bms.length})
              </h2>
              <Button size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('open_create_bm')}>
                <Plus className="h-3.5 w-3.5" /> Thêm BM
              </Button>
            </div>
            {state.bms.length === 0 ? (
              <div className="p-5 text-xs text-muted-foreground">
                Chưa có Business Manager nào trên Workspace. Nhấn Thêm BM hoặc gắn Token EAAB để tự đồng bộ.
              </div>
            ) : (
              <div className="grid grid-cols-1 divide-y divide-border/70 sm:grid-cols-2 sm:divide-x lg:grid-cols-3 xl:grid-cols-5">
                {state.bms.map((bm) => (
                  <div key={bm.id} className="flex flex-col justify-between gap-3 p-4">
                    <div>
                      <div className="truncate text-xs font-semibold text-foreground" title={bm.name}>
                        {bm.name}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        ID: {bm.externalId || '—'} · {bm.status}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-full text-xs"
                      onClick={() => sendDesktopCommand('open_bm_settings', { bmId: bm.id })}
                    >
                      <Globe className="h-3 w-3" /> Mở cài đặt BM
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="studio-panel overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">Meta Pixels ({state.pixels.length})</h2>
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => sendDesktopCommand('open_create_pixel')}>
                  <Plus className="h-3.5 w-3.5" /> Tạo Pixel
                </Button>
              </div>
              {state.pixels.length === 0 ? (
                <p className="p-5 text-xs text-muted-foreground">
                  Chưa có Meta Pixel nào trong Workspace. Nhấn Tạo Pixel để lưu Pixel ID.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {state.pixels.slice(0, 8).map((px) => (
                    <div key={px.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">{px.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          Pixel ID: {px.externalPixelId || '—'} · {px.status}
                        </div>
                      </div>
                      {px.externalPixelId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2.5 text-xs"
                          onClick={() =>
                            sendDesktopCommand('copy_text', { text: px.externalPixelId, label: 'Pixel ID' })
                          }
                        >
                          <Copy className="h-3 w-3" /> Copy ID
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="studio-panel space-y-3 p-5">
              <h2 className="text-sm font-semibold text-foreground">Tên miền riêng &amp; SEO Readiness</h2>
              <div className="font-mono text-[11px] text-primary">
                URL hiệu lực: {state.domainSeo.effectivePublicUrl}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="https://app.thuonghieu.vn (để trống = mặc định)"
                  className="h-8 text-xs"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => sendDesktopCommand('save_domain_seo', { customDomain })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Lưu tên miền
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {state.domainSeo.checklist.map((c) => (
                  <StatusDot key={c.key} tone={c.ready ? 'live' : 'muted'} label={c.label} labelClassName="text-[11px]" />
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* FANPAGE RIGHT INSPECTOR DRAWER */}
      <InspectorDrawer
        open={Boolean(liveInspected)}
        onOpenChange={(o) => !o && setInspectedPage(null)}
        title={liveInspected?.name || ''}
        subtitle={
          liveInspected ? `ID: ${liveInspected.externalPageId || 'Chờ đồng bộ'} · ${liveInspected.category || 'Chung'}` : ''
        }
        badge={
          liveInspected && (
            <Badge variant={liveInspected.healthStatus.toUpperCase() === 'LIVE' ? 'success' : 'destructive'}>
              {liveInspected.isUnsyncedDraft ? 'NHÁP' : liveInspected.healthStatus}
            </Badge>
          )
        }
        footer={
          liveInspected && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('silent_invite_single_page', { pageId: liveInspected.id })}
              >
                <Ghost className="h-3.5 w-3.5 text-emerald-500" /> Mời ẩn
              </Button>
              <Button
                size="sm"
                onClick={() => sendDesktopCommand('open_page_browser', { pageId: liveInspected.id })}
              >
                <Globe className="h-3.5 w-3.5" /> Mở Page trên Chrome
              </Button>
            </div>
          )
        }
      >
        {liveInspected && (
          <div className="space-y-3 text-xs">
            <InspectorSection title="Sức khỏe & Vòng đời nuôi 14 ngày">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Theo dõi:</dt>
                  <dd className="font-mono font-semibold">
                    {liveInspected.followersCount != null ? liveInspected.followersCount.toLocaleString('en-US') : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Bài nuôi / Share:</dt>
                  <dd className="font-mono">
                    {liveInspected.warmupPostsCount} bài · {liveInspected.shareCount ?? 0} share
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">BM &amp; TKQC:</dt>
                  <dd>
                    {liveInspected.ownerBmName || 'Chưa kéo BM'} ({liveInspected.linkedAdAccountCount} TKQC)
                  </dd>
                </div>
                {liveInspected.lifecycleLabel && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Giai đoạn:</dt>
                    <dd className="text-right font-medium text-primary">{liveInspected.lifecycleLabel}</dd>
                  </div>
                )}
              </dl>
            </InspectorSection>

            <InspectorSection title="Thao tác Nuôi & Kéo BM nhanh">
              <div className="grid grid-cols-1 gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('silent_page_nurture_single', { pageId: liveInspected.id, mode: 'post' })}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-500" /> Đăng bài Ảnh chạy ẩn
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('silent_page_nurture_single', { pageId: liveInspected.id, mode: 'share' })}
                >
                  <Share2 className="h-3.5 w-3.5 text-primary" /> Chia sẻ bài nguồn chạy ẩn
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('open_claim_bm_dialog', { pageId: liveInspected.id })}
                >
                  <Building2 className="h-3.5 w-3.5 text-primary" /> Kéo Fanpage vào Business Manager
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('check_page_live', { pageId: liveInspected.id })}
                >
                  <RefreshCw className="h-3.5 w-3.5 text-emerald-500" /> Kiểm tra trạng thái LIVE (Check Live)
                </Button>
              </div>
            </InspectorSection>
          </div>
        )}
      </InspectorDrawer>
    </div>
  )
}

function FanpageStudioRow({
  page,
  holderOptions,
  onInspect,
}: {
  page: WebFanpageDto
  holderOptions: AppShellWebStateDto['pageHolderOptions']
  onInspect: () => void
}) {
  const live = page.healthStatus.toUpperCase() === 'LIVE'
  const warmPct = page.adsReady ? 100 : Math.min(95, Math.max(18, page.warmupPostsCount * 33.3))

  const hasSelectedOpt = holderOptions.some((o) => o.value === page.selectedHolderTag)
  const effectiveSelectVal = hasSelectedOpt ? page.selectedHolderTag : holderOptions[0]?.value || '__default__'

  return (
    <div className="group grid grid-cols-1 items-center gap-3 px-4 studio-row-cell transition-colors hover:bg-muted/30 lg:grid-cols-[1.45fr_0.95fr_1.25fr_170px]">
      {/* Col 1: Page Monogram + Name + StatusDot */}
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-semibold',
            live
              ? 'border-border/80 bg-muted/55 text-foreground/85'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-500',
          )}
        >
          {getPageInitials(page.name)}
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onInspect}
              className="truncate text-left text-[13px] font-semibold text-foreground transition-colors hover:text-primary"
            >
              {page.name}
            </button>
            <StatusDot
              tone={live ? 'live' : 'critical'}
              label={page.isUnsyncedDraft ? 'Nháp' : page.healthStatus}
              labelClassName="font-mono text-[10.5px]"
            />
            {page.adsReady ? (
              <span className="rounded bg-primary/10 px-1.5 py-[1px] font-mono text-[10px] font-medium text-primary">
                Ads Ready
              </span>
            ) : page.soakRemainingHours > 0 ? (
              <span className="rounded bg-amber-500/10 px-1.5 py-[1px] font-mono text-[10px] text-amber-600 dark:text-amber-400">
                Ngâm {page.soakRemainingHours.toFixed(0)}h
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground/85">
            ID {page.externalPageId || 'Chờ đồng bộ'} · {page.category || 'Chưa rõ ngành'}
          </div>
        </div>
      </div>

      {/* Col 2: Followers + Ultra-thin 2px Warmup Track */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {page.followersCount != null ? `${page.followersCount.toLocaleString('en-US')} theo dõi` : '—'}
          </span>
          <span
            className={cn(
              'truncate font-mono text-[10.5px] tabular-nums',
              page.pendingInviteCount != null && page.pendingInviteCount > 0
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
          >
            {page.pendingInviteCount != null && page.pendingInviteCount > 0
              ? `${page.pendingInviteCount} cần mời`
              : `${page.warmupPostsCount} bài`}
          </span>
        </div>
        <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all', page.adsReady ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${warmPct}%` }}
          />
        </div>
        {page.lifecycleLabel && (
          <div className="truncate font-mono text-[10px] text-muted-foreground/80">{page.lifecycleLabel}</div>
        )}
      </div>

      {/* Col 3: Holder Select & BM Metadata */}
      <div className="min-w-0 space-y-1">
        {holderOptions.length > 0 ? (
          <Select
            value={effectiveSelectVal}
            onValueChange={(val) =>
              sendDesktopCommand('set_page_holder', { pageId: page.id, holderTag: val })
            }
          >
            <SelectTrigger className="h-7 border-border/75 bg-transparent text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {holderOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="truncate text-xs font-medium text-foreground">Via: {page.effectiveHolderLabel}</div>
        )}
        <div
          className={cn(
            'truncate px-0.5 text-[11px]',
            page.ownerBmName ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          BM: {page.ownerBmName || 'Chưa kéo BM'} · {page.linkedAdAccountCount} TKQC
        </div>
      </div>

      {/* Col 4: Quiet Progressive Actions (Eye + 1 Contextual CTA + Overflow Menu) */}
      <div className="flex items-center justify-end gap-1">
        {page.isRunningInvite && (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => sendDesktopCommand('cancel_auto_invite')}
          >
            <Square className="h-3 w-3" /> Dừng
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
          title="Xem chi tiết Page"
          onClick={onInspect}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 border-border/80 bg-transparent px-2.5 text-xs font-medium hover:border-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          onClick={() => sendDesktopCommand('invite_single_page', { pageId: page.id })}
        >
          <UserPlus className="h-3 w-3" />
          Mời{page.pendingInviteCount ? ` (${page.pendingInviteCount})` : ''}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onClick={() => sendDesktopCommand('open_page_browser', { pageId: page.id })}>
              <Globe className="h-3.5 w-3.5 text-primary" />
              Mở Page trên Chrome
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendDesktopCommand('silent_invite_single_page', { pageId: page.id })}>
              <Ghost className="h-3.5 w-3.5 text-emerald-500" />
              Mời Follow ẩn hoàn toàn ngoài màn hình
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendDesktopCommand('open_warmup_post_dialog', { pageId: page.id })}>
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Đăng bài nuôi Page ngay
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => sendDesktopCommand('silent_page_nurture_single', { pageId: page.id, mode: 'post' })}
            >
              <ImageIcon className="h-3.5 w-3.5 text-emerald-500" />
              Đăng bài Ảnh chạy ẩn (100% Tự động)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => sendDesktopCommand('silent_page_nurture_single', { pageId: page.id, mode: 'share' })}
            >
              <Share2 className="h-3.5 w-3.5 text-primary" />
              Chia sẻ bài nguồn chạy ẩn (100% Tự động)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => sendDesktopCommand('page_nurture_single_post', { pageId: page.id, viaBrowser: true })}
            >
              <ImageIcon className="h-3.5 w-3.5 text-emerald-500" />
              Đăng bài nuôi Page (Mở Chrome)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => sendDesktopCommand('page_nurture_single_share', { pageId: page.id, viaBrowser: true })}
            >
              <Share2 className="h-3.5 w-3.5 text-primary" />
              Chia sẻ bài nguồn (Mở Chrome)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendDesktopCommand('open_page_setup_assets', { pageId: page.id })}>
              <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
              Hoàn thiện hồ sơ (Avatar/Cover + Page)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => sendDesktopCommand('scan_mbs_invite_now', { pageId: page.id })}>
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              Quét &amp; gửi lời mời trên Chrome đang mở
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendDesktopCommand('open_claim_bm_dialog', { pageId: page.id })}>
              <Building2 className="h-3.5 w-3.5 text-primary" />
              Kéo Fanpage vào Business Manager
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendDesktopCommand('check_page_live', { pageId: page.id })}>
              <RefreshCw className="h-3.5 w-3.5 text-emerald-500" />
              Kiểm tra trạng thái Live trên Facebook
            </DropdownMenuItem>
            {page.isUnsyncedDraft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-rose-500 focus:text-rose-500"
                  onClick={() => sendDesktopCommand('discard_page_draft', { pageId: page.id })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa bản nháp Fanpage này
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
