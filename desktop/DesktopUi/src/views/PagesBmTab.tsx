import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Globe,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

  useEffect(() => {
    setCustomDomain(state.domainSeo.customDomain)
  }, [state.configRev, state.domainSeo.customDomain])

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

  const filterChips = [
    { key: 'all', label: `Tất cả (${state.fanpages.length})` },
    { key: 'unsynced', label: `Nháp chưa khớp (${state.fanpages.filter((x) => x.isUnsyncedDraft).length})` },
    { key: 'need_claim', label: `Chưa kéo BM (${state.fanpages.filter((x) => !x.ownerBmId.trim()).length})` },
    { key: 'need_warmup', label: `Cần Ngâm/Nuôi (${state.fanpages.filter((x) => !x.adsReady).length})` },
    {
      key: 'restricted',
      label: `Rủi ro/Hạn chế (${state.fanpages.filter((x) => x.healthStatus.toUpperCase() !== 'LIVE').length})`,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Business Managers Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">
            Business Manager đang quản lý ({state.bms.length})
          </h2>
          <Button size="sm" onClick={() => sendDesktopCommand('open_create_bm')}>
            <Plus className="h-3.5 w-3.5" /> Thêm BM
          </Button>
        </div>

        {state.bms.length === 0 ? (
          <Card>
            <CardContent className="p-3.5 text-xs text-muted-foreground">
              Chưa có Business Manager nào trên Workspace. Nhấn &apos;+ Thêm BM&apos; hoặc gắn Token EAAB để tự đồng bộ.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {state.bms.map((bm) => (
              <Card key={bm.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="truncate text-xs font-bold text-foreground" title={bm.name}>
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
                    <Globe className="h-3 w-3" /> Mở Cài đặt BM
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Meta Pixels + Domain & SEO Row */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold">Meta Pixels ({state.pixels.length})</CardTitle>
              <Button size="sm" onClick={() => sendDesktopCommand('open_create_pixel')}>
                <Plus className="h-3.5 w-3.5" /> Tạo Pixel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {state.pixels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Chưa có Meta Pixel nào trong Workspace. Nhấn &apos;+ Tạo Pixel&apos; để lưu Pixel ID.
              </p>
            ) : (
              state.pixels.slice(0, 8).map((px) => (
                <div
                  key={px.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2"
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
            <CardTitle className="text-sm font-bold">Tên miền riêng &amp; SEO Readiness</CardTitle>
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
                <CheckCircle2 className="h-3.5 w-3.5" /> Lưu Tên miền
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {state.domainSeo.checklist.map((c) => (
                <Badge key={c.key} variant={c.ready ? 'success' : 'secondary'} className="text-[11px]">
                  {c.ready ? '✓ ' : '○ '}
                  {c.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fanpage Search, Filter & Batch Toolbar */}
      <Card>
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên Page, ID Page, Via cầm..."
                className="pl-8"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_pages_csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('sync_meta_pages')}>
              <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ Page Meta
            </Button>
            <Button size="sm" onClick={() => sendDesktopCommand('batch_invite_followers')}>
              <UserPlus className="h-3.5 w-3.5" /> Mời Follow Lô
            </Button>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('batch_warmup_pages')}>
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" /> Nuôi lô (Max 10)
            </Button>
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

      {/* Fanpage Rows */}
      {state.fanpages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Globe className="h-9 w-9 text-muted-foreground" />
            <div>
              <div className="text-sm font-bold text-foreground">Chưa có Fanpage nào được đồng bộ</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Nhấn Đồng bộ Page từ Meta để quét toàn bộ Fanpage từ Token / BM hiện có.
              </p>
            </div>
            <Button onClick={() => sendDesktopCommand('sync_meta_pages')}>
              <RefreshCw className="h-4 w-4" /> Đồng bộ Page từ Meta
            </Button>
          </CardContent>
        </Card>
      ) : filteredPages.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            Không có Fanpage nào khớp bộ lọc hiện tại.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.45fr_0.95fr_1.35fr_auto] items-center gap-3 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:grid">
            <div>FANPAGE &amp; TRẠNG THÁI ADS</div>
            <div>TĂNG TRƯỞNG &amp; TIẾN ĐỘ NUÔI</div>
            <div>CHỌN VIA &amp; CHROME PROFILE CẦM PAGE</div>
            <div className="text-right">THAO TÁC NHANH</div>
          </div>

          {filteredPages.map((pg) => (
            <FanpageRowCard key={pg.id} page={pg} holderOptions={state.pageHolderOptions} />
          ))}
        </div>
      )}
    </div>
  )
}

function FanpageRowCard({
  page,
  holderOptions,
}: {
  page: WebFanpageDto
  holderOptions: AppShellWebStateDto['pageHolderOptions']
}) {
  const live = page.healthStatus.toUpperCase() === 'LIVE'
  const warmPct = page.adsReady ? 100 : Math.min(95, Math.max(18, page.warmupPostsCount * 33.3))

  const hasSelectedOpt = holderOptions.some((o) => o.value === page.selectedHolderTag)
  const effectiveSelectVal = hasSelectedOpt ? page.selectedHolderTag : holderOptions[0]?.value || '__default__'

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="grid grid-cols-1 items-center gap-3 p-3 lg:grid-cols-[1.45fr_0.95fr_1.35fr_auto]">
        {/* Col 1: Identity */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold',
              live
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-300',
            )}
          >
            {getPageInitials(page.name)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-bold text-foreground">{page.name}</span>
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

        {/* Col 2: Growth & Pending Invites */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-bold text-emerald-400">
              {page.followersCount != null ? `${page.followersCount.toLocaleString('en-US')} theo dõi` : '— theo dõi'}
            </span>
            <span
              className={cn(
                'truncate text-[11px] font-semibold',
                page.pendingInviteCount != null && page.pendingInviteCount > 0
                  ? 'text-amber-400'
                  : 'text-muted-foreground',
              )}
            >
              {page.pendingInviteCount != null
                ? page.pendingInviteCount > 0
                  ? `🔔 ${page.pendingInviteCount} người cần mời`
                  : `✓ 0 cần mời • ${page.warmupPostsCount} bài nuôi`
                : `Chưa quét cần mời • ${page.warmupPostsCount} bài nuôi`}
            </span>
          </div>
          <Progress
            value={warmPct}
            className="h-1.5"
            indicatorClassName={page.adsReady ? 'bg-emerald-500' : 'bg-indigo-500'}
          />
        </div>

        {/* Col 3: Direct Via & Chrome Profile Holder Selector */}
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
            <div className="truncate text-xs font-semibold text-foreground">
              Via: {page.effectiveHolderLabel}
            </div>
          )}
          <div
            className={cn(
              'truncate px-0.5 text-[11px]',
              page.ownerBmName ? 'text-muted-foreground' : 'text-amber-400',
            )}
          >
            BM: {page.ownerBmName || 'Chưa kéo BM'} • TKQC: {page.linkedAdAccountCount}
          </div>
        </div>

        {/* Col 4: Fast Actions */}
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
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => sendDesktopCommand('invite_single_page', { pageId: page.id })}
          >
            <UserPlus className="h-3 w-3" />
            Mời Follow{page.pendingInviteCount ? ` (${page.pendingInviteCount})` : ''}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs text-emerald-300"
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
              <DropdownMenuItem onClick={() => sendDesktopCommand('scan_mbs_invite_now', { pageId: page.id })}>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Quét số người cần mời &amp; Gửi lời mời trên Chrome đang mở
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_claim_bm_dialog', { pageId: page.id })}>
                <Building2 className="h-3.5 w-3.5 text-indigo-400" />
                Kéo Fanpage vào Business Manager (Claim BM)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('check_page_live', { pageId: page.id })}>
                <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                Kiểm tra trạng thái Live trên Facebook (Check Live)
              </DropdownMenuItem>
              {page.isUnsyncedDraft && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-rose-400 focus:text-rose-300"
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
