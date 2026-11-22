import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Building2,
  CheckCircle2,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

  const filterChips = [
    { key: 'all', label: `Tất cả (${state.fanpages.length})` },
    { key: 'unsynced', label: `Nháp (${state.fanpages.filter((x) => x.isUnsyncedDraft).length})` },
    { key: 'need_claim', label: `Chưa kéo BM (${state.fanpages.filter((x) => !x.ownerBmId.trim()).length})` },
    { key: 'need_warmup', label: `Cần nuôi (${state.fanpages.filter((x) => !x.adsReady).length})` },
    {
      key: 'restricted',
      label: `Hạn chế (${state.fanpages.filter((x) => x.healthStatus.toUpperCase() !== 'LIVE').length})`,
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
    <Tabs defaultValue="pages" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="pages">Fanpage ({state.fanpages.length})</TabsTrigger>
          <TabsTrigger value="content_nurture">Kho ảnh &amp; Nuôi bài 14 ngày</TabsTrigger>
          <TabsTrigger value="bms_assets">
            Business Manager ({state.bms.length}) &amp; Pixel ({state.pixels.length})
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_pages_csv')}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('sync_meta_pages')}>
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ Page Meta
          </Button>
          <Button size="sm" onClick={() => sendDesktopCommand('open_create_bm')}>
            <Plus className="h-3.5 w-3.5" /> Thêm BM
          </Button>
        </div>
      </div>

      {/* SUB-TAB 1: FANPAGES */}
      <TabsContent value="pages" className="mt-0 space-y-3.5">
        <Card>
          <CardContent className="space-y-3 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên Fanpage, ID Page, Via cầm..."
                  className="pl-8"
                />
              </div>
              <Button size="sm" onClick={() => sendDesktopCommand('batch_invite_followers')}>
                <UserPlus className="h-3.5 w-3.5" /> Mời Follow lô
              </Button>
              {state.automationConfig.isSilentInviteRunning ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => sendDesktopCommand('cancel_silent_invite')}
                >
                  <Square className="h-3.5 w-3.5" /> Dừng mời ẩn
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => sendDesktopCommand('silent_invite_batch_pages')}
                  title="Chạy ẩn hoàn toàn ngoài màn hình, tự quét Cảm xúc & Bình luận"
                >
                  <Ghost className="h-3.5 w-3.5 text-emerald-500" /> Mời ẩn lô
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('batch_warmup_pages')}>
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Nuôi lô (Max 10)
              </Button>
            </div>

            {/* Silent Background Auto-Invite Scheduler Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2.5">
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
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(state.automationConfig.autoSilentInviteIntervalMinutes ?? 60)}
                  onValueChange={(val) =>
                    sendDesktopCommand('save_silent_invite_config', {
                      enabled: Boolean(state.automationConfig.autoSilentInviteEnabled),
                      intervalMinutes: Number(val) || 60,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Mỗi 30 phút</SelectItem>
                    <SelectItem value="60">Mỗi 60 phút</SelectItem>
                    <SelectItem value="120">Mỗi 2 giờ</SelectItem>
                    <SelectItem value="240">Mỗi 4 giờ</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {state.automationConfig.isSilentInviteRunning
                    ? 'Đang quét & mời ẩn...'
                    : `Gần nhất: ${state.automationConfig.lastAutoSilentInviteLocal || 'Chưa chạy'}`}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {filterChips.map((ch) => (
                <Button
                  key={ch.key}
                  type="button"
                  size="sm"
                  variant={statusFilter === ch.key ? 'default' : 'secondary'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setStatusFilter(ch.key)}
                >
                  {ch.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {state.fanpages.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Globe className="h-9 w-9 text-muted-foreground" />
              <div>
                <div className="text-sm font-semibold text-foreground">Chưa có Fanpage nào</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nhấn Đồng bộ Page Meta để nạp toàn bộ Fanpage từ Token / BM.
                </p>
              </div>
              <Button onClick={() => sendDesktopCommand('sync_meta_pages')}>
                <RefreshCw className="h-4 w-4" /> Đồng bộ Page Meta
              </Button>
            </CardContent>
          </Card>
        ) : filteredPages.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-xs text-muted-foreground">
              Không có Fanpage khớp bộ lọc hiện tại.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredPages.map((pg) => (
              <FanpageRowCard
                key={pg.id}
                page={pg}
                holderOptions={state.pageHolderOptions}
                onInspect={() => setInspectedPage(pg)}
              />
            ))}
          </div>
        )}
      </TabsContent>

      {/* SUB-TAB 2: HYBRID CONTENT NURTURE CENTER */}
      <TabsContent value="content_nurture" className="mt-0">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Trung tâm Nuôi Fanpage 14 Ngày (Ảnh + Caption Spin + Share)
                </CardTitle>
                <CardDescription className="text-xs">
                  Tự đổi hash 1px ảnh nguồn hoặc tự vẽ ảnh Card 1080×1080 khi thư mục ảnh đang trống.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="font-mono text-[11px]">
                {pn?.imagesFoundCount ?? 0} ảnh • {pn?.shareSourceCount ?? 0} link nguồn
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
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

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
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
                  className="h-8 text-xs"
                  onClick={() => {
                    saveNurtureConfig()
                    sendDesktopCommand('page_nurture_batch_run', { mode: nurtureMode, viaBrowser: true })
                  }}
                >
                  <Play className="h-3.5 w-3.5" /> Chạy lô mở Chrome
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
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
                  <Bot className="mr-1 inline h-3.5 w-3.5 text-primary" />
                  Tự động Nuôi Page 14 ngày chạy ẩn định kỳ
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pn?.autoSilentPageNurtureIntervalHours ?? 12)}
                  onValueChange={(val) =>
                    sendDesktopCommand('save_silent_page_nurture_config', {
                      enabled: Boolean(pn?.autoSilentPageNurtureEnabled),
                      intervalHours: Number(val) || 12,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">Mỗi 6 giờ</SelectItem>
                    <SelectItem value="12">Mỗi 12 giờ</SelectItem>
                    <SelectItem value="24">Mỗi 24 giờ</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {pn?.isSilentPageNurtureRunning
                    ? 'Đang đăng/share ẩn...'
                    : `Gần nhất: ${pn?.lastAutoSilentPageNurtureLocal || 'Chưa chạy'}`}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* SUB-TAB 3: BUSINESS MANAGERS, PIXELS & DOMAIN SEO */}
      <TabsContent value="bms_assets" className="mt-0 space-y-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Business Manager đang quản lý ({state.bms.length})
            </h2>
            <Button size="sm" onClick={() => sendDesktopCommand('open_create_bm')}>
              <Plus className="h-3.5 w-3.5" /> Thêm BM
            </Button>
          </div>

          {state.bms.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-xs text-muted-foreground">
                Chưa có Business Manager nào trên Workspace. Nhấn Thêm BM hoặc gắn Token EAAB để tự đồng bộ.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {state.bms.map((bm) => (
                <Card key={bm.id}>
                  <CardContent className="space-y-2 p-3">
                    <div className="truncate text-xs font-semibold text-foreground" title={bm.name}>
                      {bm.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      ID: {bm.externalId || '—'} • {bm.status}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-full text-xs"
                      onClick={() => sendDesktopCommand('open_bm_settings', { bmId: bm.id })}
                    >
                      <Globe className="h-3 w-3" /> Mở cài đặt BM
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Meta Pixels ({state.pixels.length})</CardTitle>
                <Button size="sm" onClick={() => sendDesktopCommand('open_create_pixel')}>
                  <Plus className="h-3.5 w-3.5" /> Tạo Pixel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.pixels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Chưa có Meta Pixel nào trong Workspace. Nhấn Tạo Pixel để lưu Pixel ID.
                </p>
              ) : (
                state.pixels.slice(0, 8).map((px) => (
                  <div
                    key={px.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">{px.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        Pixel ID: {px.externalPixelId || '—'} • {px.status}
                      </div>
                    </div>
                    {px.externalPixelId && (
                      <Button
                        variant="secondary"
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
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tên miền riêng &amp; SEO Readiness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="font-mono text-[11px] text-primary">
                URL hiệu lực: {state.domainSeo.effectivePublicUrl}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="https://app.thuonghieu.vn (để trống = mặc định)"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => sendDesktopCommand('save_domain_seo', { customDomain })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Lưu tên miền
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {state.domainSeo.checklist.map((c) => (
                  <Badge key={c.key} variant={c.ready ? 'success' : 'secondary'} className="text-[11px]">
                    {c.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* FANPAGE RIGHT INSPECTOR DRAWER */}
      <InspectorDrawer
        open={Boolean(liveInspected)}
        onOpenChange={(o) => !o && setInspectedPage(null)}
        title={liveInspected?.name || ''}
        subtitle={
          liveInspected ? `ID: ${liveInspected.externalPageId || 'Chờ đồng bộ'} • ${liveInspected.category || 'Chung'}` : ''
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
                    {liveInspected.warmupPostsCount} bài • {liveInspected.shareCount ?? 0} share
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
    </Tabs>
  )
}

function FanpageRowCard({
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
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="grid grid-cols-1 items-center gap-3 p-3 lg:grid-cols-[1.45fr_0.95fr_1.35fr_auto]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-semibold',
              live
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
            )}
          >
            {getPageInitials(page.name)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onInspect}
                className="truncate text-left text-sm font-semibold text-foreground hover:text-primary"
              >
                {page.name}
              </button>
              <Badge variant={live ? 'success' : 'destructive'} className="px-1.5 py-0 text-[10px]">
                {page.isUnsyncedDraft ? 'NHÁP' : page.healthStatus}
              </Badge>
              {page.adsReady ? (
                <Badge variant="info" className="px-1.5 py-0 text-[10px]">
                  Sẵn sàng Ads
                </Badge>
              ) : page.soakRemainingHours > 0 ? (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  Ngâm {page.soakRemainingHours.toFixed(0)}h
                </Badge>
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              ID: {page.externalPageId || 'Chờ đồng bộ'} • {page.category || 'Chưa rõ ngành'}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {page.followersCount != null ? `${page.followersCount.toLocaleString('en-US')} theo dõi` : '— theo dõi'}
            </span>
            <span
              className={cn(
                'truncate text-[11px] font-medium',
                page.pendingInviteCount != null && page.pendingInviteCount > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
            >
              {page.pendingInviteCount != null
                ? page.pendingInviteCount > 0
                  ? `${page.pendingInviteCount} cần mời`
                  : `0 cần mời • ${page.warmupPostsCount} bài`
                : `${page.warmupPostsCount} bài nuôi`}
            </span>
          </div>
          <Progress
            value={warmPct}
            className="h-1.5"
            indicatorClassName={page.adsReady ? 'bg-emerald-500' : 'bg-primary'}
          />
          {page.lifecycleLabel && (
            <div className="truncate font-mono text-[10px] text-muted-foreground">{page.lifecycleLabel}</div>
          )}
        </div>

        <div className="min-w-0 space-y-1">
          {holderOptions.length > 0 ? (
            <Select
              value={effectiveSelectVal}
              onValueChange={(val) =>
                sendDesktopCommand('set_page_holder', { pageId: page.id, holderTag: val })
              }
            >
              <SelectTrigger className="h-7 text-xs">
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
            BM: {page.ownerBmName || 'Chưa kéo BM'} • TKQC: {page.linkedAdAccountCount}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
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
            className="h-7 w-7 px-0"
            title="Xem chi tiết Page"
            onClick={onInspect}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => sendDesktopCommand('invite_single_page', { pageId: page.id })}
          >
            <UserPlus className="h-3 w-3" />
            Mời{page.pendingInviteCount ? ` (${page.pendingInviteCount})` : ''}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => sendDesktopCommand('silent_invite_single_page', { pageId: page.id })}
            title="Mời ẩn hoàn toàn ngoài màn hình"
          >
            <Ghost className="h-3 w-3 text-emerald-500" /> Ẩn
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => sendDesktopCommand('open_warmup_post_dialog', { pageId: page.id })}
          >
            Nuôi bài
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => sendDesktopCommand('open_page_browser', { pageId: page.id })}
          >
            Mở Page
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-7 w-7 px-0">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
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
      </CardContent>
    </Card>
  )
}
