import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Coffee,
  FolderOpen,
  GripVertical,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto } from '@/types'

const SPEED_PRESETS = [
  { label: '⚡ Turbo (8–15s)', min: 8, max: 15 },
  { label: '🚀 Nhanh (15–30s)', min: 15, max: 30 },
  { label: '🛡️ Chuẩn (35–65s)', min: 35, max: 65 },
  { label: '🐢 Ngâm kỹ (75–120s)', min: 75, max: 120 },
]

export function AutomationTab({ state }: { state: AppShellWebStateDto }) {
  const cfg = state.automationConfig

  // Batch Page Form State
  const [nicheKey, setNicheKey] = useState(cfg.batchNicheKey || state.nicheTemplates[0]?.value || 'beauty_spa')
  const [ownerBmId, setOwnerBmId] = useState(cfg.batchOwnerBmId || '__none__')
  const [batchCount, setBatchCount] = useState(String(cfg.batchCount))
  const [batchStagger, setBatchStagger] = useState(String(cfg.batchStaggerSec))
  const [batchPrefix, setBatchPrefix] = useState(cfg.batchPrefix)
  const [batchNames, setBatchNames] = useState(cfg.batchCustomNames)
  const [batchAutoSubmit, setBatchAutoSubmit] = useState(cfg.batchAutoSubmit)

  // Local Guard State
  const [autoKa, setAutoKa] = useState(cfg.autoKeepAliveScheduler)
  const [autoPipe, setAutoPipe] = useState(cfg.autoDailyFullPipeline)
  const [autoInvite, setAutoInvite] = useState(cfg.autoInvitePageFollowersOnWarmup)
  const [autoVaultBak, setAutoVaultBak] = useState(cfg.autoDailyVaultBackup)
  const [preProxy, setPreProxy] = useState(cfg.preCheckProxyBeforeLaunch)
  const [autoCloseTab, setAutoCloseTab] = useState(cfg.autoCloseKeepAliveTab)
  const [autoCloseWin, setAutoCloseWin] = useState(cfg.autoCloseKeepAliveWindow)
  const [schedCsv, setSchedCsv] = useState(cfg.autoPilotScheduleTimesCsv)
  const [startHour, setStartHour] = useState(String(cfg.autoKeepAliveStartHour))
  const [endHour, setEndHour] = useState(String(cfg.autoKeepAliveEndHour))
  const [maxPerIp, setMaxPerIp] = useState(String(cfg.maxViasPerProxyInBatch))
  const [maxDirect, setMaxDirect] = useState(String(cfg.maxDirectIpViasInBatch))

  // Visual Flow Builder #1-#5 Switches & Rest Range
  const [crossPage, setCrossPage] = useState(cfg.enableInternalPageCrossWarmup)
  const [preAdsBuf, setPreAdsBuf] = useState(cfg.enablePreAdsManagerWarmup)
  const [autoLikeCmt, setAutoLikeCmt] = useState(cfg.autoLikeCommentsOnPageInvite)
  const [autoTile, setAutoTile] = useState(cfg.autoTileWindowsOnBatch)
  const [restMin, setRestMin] = useState(String(cfg.queueRestMinSeconds))
  const [restMax, setRestMax] = useState(String(cfg.queueRestMaxSeconds))
  const [preAdsSec, setPreAdsSec] = useState(String(cfg.preAdsWarmupSeconds))
  const [prePageWarmup, setPrePageWarmup] = useState(cfg.enablePrePageCreationWarmup ?? true)
  const [prePageSec, setPrePageSec] = useState(String(cfg.prePageCreationWarmupSeconds ?? 35))
  const [cookieRobotUrls, setCookieRobotUrls] = useState(cfg.cookieRobotUrls ?? '')
  const [cookiePanelOpen, setCookiePanelOpen] = useState(false)
  const [flowViaId, setFlowViaId] = useState(
    cfg.flowSelectedViaId && cfg.flowSelectedViaId !== '__first__'
      ? cfg.flowSelectedViaId
      : state.vias[0]?.viaId || '__all__',
  )

  // Shield State
  const [soak72, setSoak72] = useState(cfg.enforceSoakQuarantine)
  const [siloIso, setSiloIso] = useState(cfg.enforceClientSilo)
  const [ipKill, setIpKill] = useState(cfg.ipLeakKillSwitchEnabled)
  const [autoCookie, setAutoCookie] = useState(cfg.autoRefreshCookieAfterKeepAlive)
  const [defMode, setDefMode] = useState(cfg.defaultWarmupMode || 'human_organic')
  const [soakHrs, setSoakHrs] = useState(String(cfg.soakQuarantineHours))
  const [cooldownHrs, setCooldownHrs] = useState(String(cfg.autoCooldownHours))

  // Cloud Cron State
  const [cronSync, setCronSync] = useState(cfg.cronAutoMetaSync)
  const [cronWarm, setCronWarm] = useState(cfg.cronAutoPageWarmup)
  const [cronSyncMin, setCronSyncMin] = useState(String(cfg.cronSyncIntervalMinutes))
  const [cronWarmGap, setCronWarmGap] = useState(String(cfg.cronWarmupMinGapHours))

  // Drag & Drop State for Flow Designer
  const [dragPayload, setDragPayload] = useState<string | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  useEffect(() => {
    setNicheKey(cfg.batchNicheKey || state.nicheTemplates[0]?.value || 'beauty_spa')
    setOwnerBmId(cfg.batchOwnerBmId || '__none__')
    setBatchCount(String(cfg.batchCount))
    setBatchStagger(String(cfg.batchStaggerSec))
    setBatchPrefix(cfg.batchPrefix)
    setBatchNames(cfg.batchCustomNames)
    setBatchAutoSubmit(cfg.batchAutoSubmit)
    setPrePageWarmup(cfg.enablePrePageCreationWarmup ?? true)
    setPrePageSec(String(cfg.prePageCreationWarmupSeconds ?? 35))
    setCookieRobotUrls(cfg.cookieRobotUrls ?? '')
    setAutoKa(cfg.autoKeepAliveScheduler)
    setAutoPipe(cfg.autoDailyFullPipeline)
    setAutoInvite(cfg.autoInvitePageFollowersOnWarmup)
    setAutoVaultBak(cfg.autoDailyVaultBackup)
    setPreProxy(cfg.preCheckProxyBeforeLaunch)
    setAutoCloseTab(cfg.autoCloseKeepAliveTab)
    setAutoCloseWin(cfg.autoCloseKeepAliveWindow)
    setSchedCsv(cfg.autoPilotScheduleTimesCsv)
    setStartHour(String(cfg.autoKeepAliveStartHour))
    setEndHour(String(cfg.autoKeepAliveEndHour))
    setMaxPerIp(String(cfg.maxViasPerProxyInBatch))
    setMaxDirect(String(cfg.maxDirectIpViasInBatch))
    setCrossPage(cfg.enableInternalPageCrossWarmup)
    setPreAdsBuf(cfg.enablePreAdsManagerWarmup)
    setAutoLikeCmt(cfg.autoLikeCommentsOnPageInvite)
    setAutoTile(cfg.autoTileWindowsOnBatch)
    setRestMin(String(cfg.queueRestMinSeconds))
    setRestMax(String(cfg.queueRestMaxSeconds))
    setPreAdsSec(String(cfg.preAdsWarmupSeconds))
    setSoak72(cfg.enforceSoakQuarantine)
    setSiloIso(cfg.enforceClientSilo)
    setIpKill(cfg.ipLeakKillSwitchEnabled)
    setAutoCookie(cfg.autoRefreshCookieAfterKeepAlive)
    setDefMode(cfg.defaultWarmupMode || 'human_organic')
    setSoakHrs(String(cfg.soakQuarantineHours))
    setCooldownHrs(String(cfg.autoCooldownHours))
    setCronSync(cfg.cronAutoMetaSync)
    setCronWarm(cfg.cronAutoPageWarmup)
    setCronSyncMin(String(cfg.cronSyncIntervalMinutes))
    setCronWarmGap(String(cfg.cronWarmupMinGapHours))
  }, [state.configRev])

  useEffect(() => {
    if (flowViaId === '__first__' && state.vias.length > 0) {
      setFlowViaId(state.vias[0].viaId)
    }
  }, [state.vias, flowViaId])

  const catalogByKey = useMemo(() => {
    const map = new Map(state.warmupCatalog.map((w) => [w.key, w]))
    return map
  }, [state.warmupCatalog])

  const filteredPlaybooks = useMemo(() => {
    return state.playbooks.filter(
      (p) =>
        state.playbookPlatformFilter === 'all' ||
        p.platform.toLowerCase() === state.playbookPlatformFilter.toLowerCase(),
    )
  }, [state.playbooks, state.playbookPlatformFilter])

  const activePb =
    filteredPlaybooks.find((p) => p.id === state.selectedPlaybookId) || filteredPlaybooks[0] || null

  const isCustomMode = cfg.warmupFlowMode === 'custom_sequence'
  const activeSeq =
    cfg.activeDisplaySequence.length > 0
      ? cfg.activeDisplaySequence
      : ['scroll_feed', 'watch_reels', 'read_notifications', 'refresh_cookie_and_close']

  const validViaCount = state.vias.filter((v) => !v.isInCooldown && v.canLaunch).length
  const directIpCount = state.vias.filter((v) => !v.networkLabel.trim()).length

  const sendSequenceUpdate = (nextSeq: string[]) => {
    sendDesktopCommand('update_flow_sequence', { sequence: nextSeq })
  }

  const handleDropAtIndex = (targetIdx: number) => {
    const payload = dragPayload
    setDragPayload(null)
    setDragOverIdx(null)
    if (!payload) return

    const next = [...activeSeq]
    if (payload.startsWith('step:')) {
      const fromIdx = Number(payload.slice(5))
      if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= next.length || fromIdx === targetIdx) {
        return
      }
      const [moved] = next.splice(fromIdx, 1)
      next.splice(Math.max(0, Math.min(next.length, targetIdx)), 0, moved)
      sendSequenceUpdate(next)
    } else if (payload.startsWith('lib:')) {
      const key = payload.slice(4)
      next.splice(Math.max(0, Math.min(next.length, targetIdx + 1)), 0, key)
      sendSequenceUpdate(next)
    }
  }

  const handleAppendCatalogAction = (key: string) => {
    const next = [...activeSeq]
    const insertAt = next.length > 0 && next[next.length - 1] === 'refresh_cookie_and_close' ? next.length - 1 : next.length
    next.splice(insertAt, 0, key)
    sendSequenceUpdate(next)
  }

  const flowPayload = {
    enableInternalPageCrossWarmup: crossPage,
    enablePreAdsManagerWarmup: preAdsBuf,
    autoLikeCommentsOnPageInvite: autoLikeCmt,
    autoTileWindowsOnBatch: autoTile,
    queueRestMinSeconds: Number(restMin) || 15,
    queueRestMaxSeconds: Number(restMax) || 32,
    preAdsWarmupSeconds: Number(preAdsSec) || 20,
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* LEFT COLUMN: Team Playbooks + Safe Batch Page Creation */}
      <div className="space-y-4 xl:col-span-5">
        {/* Team Playbooks Marketplace */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold">
                📚 Chợ Kịch Bản Team &amp; Chạy Lô Lệch Pha
              </CardTitle>
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('open_create_playbook')}>
                <Plus className="h-3.5 w-3.5" /> Tạo Kịch bản
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {[
                { key: 'all', label: 'Tất cả' },
                { key: 'meta', label: 'Meta Ads' },
                { key: 'google_ads', label: 'Google Ads' },
                { key: 'tiktok', label: 'TikTok Ads' },
                { key: 'multi', label: 'Đa nền tảng' },
              ].map((pl) => (
                <Button
                  key={pl.key}
                  size="sm"
                  variant={state.playbookPlatformFilter === pl.key ? 'default' : 'secondary'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => sendDesktopCommand('set_playbook_platform', { platform: pl.key })}
                >
                  {pl.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredPlaybooks.length === 0 || !activePb ? (
              <p className="text-xs text-muted-foreground">Không có kịch bản nào thuộc nền tảng này.</p>
            ) : (
              <>
                <Select
                  value={activePb.id}
                  onValueChange={(val) => sendDesktopCommand('select_playbook', { playbookId: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredPlaybooks.map((p) => {
                      const ratingTxt =
                        p.ratingCount > 0 && p.avgRating != null
                          ? `★${p.avgRating.toFixed(1)} (${p.ratingCount})`
                          : 'Chưa đánh giá'
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          [{p.platform.toUpperCase()}] {p.title} (v{p.versionTag} • {ratingTxt} • {p.runCount} lượt)
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>

                <div className="rounded-lg border border-border bg-background/50 p-2.5 text-xs text-muted-foreground space-y-1">
                  <p className="text-foreground">{activePb.description}</p>
                  <p className="font-mono text-[11px]">
                    Bước 1: {activePb.firstStepTarget} • Jitter: {activePb.defaultStaggerSec}s ±{activePb.jitterPct}% •{' '}
                    {activePb.authorName}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    onClick={() => sendDesktopCommand('run_playbook_batch', { playbookId: activePb.id })}
                  >
                    <Play className="h-3.5 w-3.5" /> Chạy Lô Kịch bản (Jitter)
                  </Button>

                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const mine = activePb.myRating === star
                      return (
                        <Button
                          key={star}
                          size="sm"
                          variant={mine ? 'default' : 'ghost'}
                          className="h-7 px-2 font-mono text-xs"
                          onClick={() =>
                            sendDesktopCommand('rate_playbook', { playbookId: activePb.id, stars: star })
                          }
                        >
                          <Star className={cn('h-3 w-3', mine && 'fill-current')} />
                          {star}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Safe Batch Page Creation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold">
              Tạo Page Hàng Loạt Theo Nhịp An Toàn (Multi-Via Queue)
            </CardTitle>
            <CardDescription>
              Chọn các Via còn hạn mức (Quota SAFE {cfg.maxSafeBatchNow}), nghỉ giãn cách + Jitter và tự kiểm tra Proxy
              trước khi mở Chrome Profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Ngành hàng &amp; Kịch bản bài đăng Warmup</Label>
              <Select value={nicheKey} onValueChange={setNicheKey}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.nicheTemplates.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">BM Đích (tùy chọn)</Label>
              <Select value={ownerBmId} onValueChange={setOwnerBmId}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(Không gắn sẵn — Kéo BM sau khi ngâm)</SelectItem>
                  {state.bms.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.externalId || b.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs">Số Page (1–20)</Label>
                <Input value={batchCount} onChange={(e) => setBatchCount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nghỉ (giây)</Label>
                <Input value={batchStagger} onChange={(e) => setBatchStagger(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tiền tố Brand</Label>
                <Input value={batchPrefix} onChange={(e) => setBatchPrefix(e.target.value)} placeholder="VD: Lumi Spa" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Danh sách Tên Page tùy chọn (1 dòng / Page)</Label>
              <Textarea
                rows={3}
                value={batchNames}
                onChange={(e) => setBatchNames(e.target.value)}
                placeholder="Mỗi dòng 1 tên Page riêng (để trống nếu muốn hệ thống tự phối tên theo ngành)"
                className="text-xs"
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
              <Label htmlFor="batch-auto-sub" className="cursor-pointer text-xs leading-snug">
                Extension tự điền Tên / Ngành / Bio và nhấn Tạo Page khi Chrome mở
              </Label>
              <Switch id="batch-auto-sub" checked={batchAutoSubmit} onCheckedChange={setBatchAutoSubmit} />
            </div>

            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pre-page-warmup" className="cursor-pointer text-xs font-medium leading-snug text-emerald-300">
                  🛡️ Đệm lướt Newsfeed trước khi mở trang Tạo Page (Chống chặn tạo)
                </Label>
                <Switch id="pre-page-warmup" checked={prePageWarmup} onCheckedChange={setPrePageWarmup} />
              </div>
              {prePageWarmup && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Thời gian đệm trước khi vào pages/creation:</span>
                  <Input
                    type="number"
                    min={10}
                    max={90}
                    value={prePageSec}
                    onChange={(e) => setPrePageSec(e.target.value)}
                    className="h-7 w-16 font-mono text-xs"
                  />
                  <span>giây (khuyên dùng 25–45s)</span>
                </div>
              )}
            </div>

            {(cfg.directIpViaCount ?? 0) > 0 && (cfg.directIpViaCount ?? 0) >= state.vias.length && state.vias.length > 0 && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                ⚠️ Hiện {cfg.directIpViaCount}/{state.vias.length} Via đang dùng chung Direct IP (Mạng gốc). Nên tạo
                1–2 Page/ca hoặc gắn Proxy riêng để tránh bị Meta chặn tạo Trang.
              </div>
            )}

            <Button
              className="w-full"
              onClick={() =>
                sendDesktopCommand('run_batch_create_pages', {
                  nicheKey,
                  ownerBmId: ownerBmId === '__none__' ? '' : ownerBmId,
                  count: Number(batchCount) || 3,
                  staggerSec: Number(batchStagger) || 65,
                  prefix: batchPrefix,
                  customNames: batchNames,
                  autoSubmit: batchAutoSubmit,
                  enablePrePageCreationWarmup: prePageWarmup,
                  prePageCreationWarmupSeconds: Number(prePageSec) || 35,
                })
              }
            >
              <Play className="h-4 w-4" />
              Khởi chạy Hàng đợi Tạo Page An Toàn
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN: Visual Flow Designer + Local Guard + Anti-Checkpoint Shield + Sessions + Cron */}
      <div className="space-y-4 xl:col-span-7">
        {/* Visual Action Flow Designer (v3.0.4 #1-#5 upgraded to shadcn/ui Drag-and-Drop) */}
        <Card className="border-primary/35">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-primary">
              <Sparkles className="h-4 w-4" />
              Trình Thiết Kế Kịch Bản Hành Vi Tự Nhiên &amp; Nhịp Nghỉ Đa Luồng (v{state.appVersion})
            </CardTitle>
            <CardDescription>
              Chọn Bốc thăm ngẫu nhiên mỗi ngày (mỗi Via 1 kịch bản khác nhau) hoặc Kéo-Thả / Bấm nối các hành động
              theo đúng trình tự bạn muốn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {/* Execution Bar Top */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 p-2.5">
              <div className="flex min-w-[210px] flex-1 items-center gap-2">
                <Select value={flowViaId} onValueChange={setFlowViaId}>
                  <SelectTrigger className="h-8 bg-background/80 text-xs">
                    <SelectValue placeholder="Chọn Via thực thi" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.vias.map((v) => (
                      <SelectItem key={v.viaId} value={v.viaId}>
                        👤 {v.label} ({v.profileDir})
                      </SelectItem>
                    ))}
                    <SelectItem value="__all__">🎯 Tất cả Via hợp lệ ({validViaCount})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    sendDesktopCommand('run_natural_flow', {
                      ...flowPayload,
                      viaId: flowViaId,
                      fastTest: true,
                    })
                  }
                >
                  <Play className="h-3.5 w-3.5" /> Test Nhanh 1 Via (5s/bước)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    sendDesktopCommand('run_natural_flow', {
                      ...flowPayload,
                      viaId: flowViaId,
                      fastTest: false,
                    })
                  }
                >
                  <Coffee className="h-3.5 w-3.5" /> Chạy Kịch Bản Ngay
                </Button>
              </div>
            </div>

            {directIpCount > cfg.maxDirectIpViasInBatch && (
              <p className="text-[11px] text-amber-300">
                💡 Đang giới hạn tối đa {cfg.maxDirectIpViasInBatch} Via Direct IP/ca để chống liên đới — có thể tăng ở
                mục Cấu hình Bảo vệ bên dưới.
              </p>
            )}

            {/* Mode Switch + Shuffle / Default */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={!isCustomMode ? 'default' : 'secondary'}
                onClick={() => sendDesktopCommand('set_flow_mode', { mode: 'daily_random' })}
              >
                🎲 Bốc thăm Ngẫu nhiên Mỗi Ngày
              </Button>
              <Button
                size="sm"
                variant={isCustomMode ? 'default' : 'secondary'}
                onClick={() => sendDesktopCommand('set_flow_mode', { mode: 'custom_sequence' })}
              >
                🧩 Tự Kéo-Thả &amp; Nối Chuỗi
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('reroll_daily_flow')}>
                <Shuffle className="h-3.5 w-3.5" /> Bốc thăm mẫu mới
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('reset_default_flow')}>
                <RotateCcw className="h-3.5 w-3.5" /> Mặc định
              </Button>
            </div>

            {/* Connected Drag-and-Drop Chain + Estimated Duration & Live Monitor */}
            {(() => {
              const lr = state.liveRunner
              const isRunnerActive = Boolean(lr?.isActive)
              const isRunnerDone = !isRunnerActive && Boolean(lr?.isCompleted)
              let estMinTotal = 0
              let estMaxTotal = 0
              for (const k of activeSeq) {
                const h = catalogByKey.get(k)?.durationHint || '10–15s'
                const nums = h.match(/\d+/g)?.map(Number) ?? [10, 15]
                estMinTotal += nums[0] ?? 10
                estMaxTotal += nums[1] ?? nums[0] ?? 15
              }
              const fastTotal = activeSeq.length * 5

              return (
                <>
                  {/* RPA-Grade Live Runner Monitor Box */}
                  <div
                    className={cn(
                      'rounded-lg border p-3 space-y-2.5 transition-all',
                      isRunnerActive
                        ? 'border-amber-400/60 bg-amber-950/20 shadow-xs'
                        : isRunnerDone
                        ? 'border-emerald-500/45 bg-emerald-950/15'
                        : 'border-border/80 bg-background/45',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            isRunnerActive
                              ? lr?.isPaused
                                ? 'warning'
                                : 'info'
                              : isRunnerDone
                              ? 'success'
                              : 'secondary'
                          }
                        >
                          {isRunnerActive
                            ? lr?.isPaused
                              ? `⏸ TẠM DỪNG (Bước ${lr.currentStepIndex}/${lr.totalSteps})`
                              : `📡 ĐANG CHẠY BƯỚC ${lr?.currentStepIndex}/${lr?.totalSteps}`
                            : isRunnerDone
                            ? '✓ ĐÃ HOÀN TẤT KỊCH BẢN'
                            : '📡 GIÁM SÁT TIẾN TRÌNH RPA'}
                        </Badge>
                        <span className="text-xs font-bold text-foreground">
                          {isRunnerActive
                            ? `Via: ${lr?.viaLabel} (${lr?.profileDir}) → ${lr?.currentStepTitle}`
                            : isRunnerDone
                            ? `Via: ${lr?.viaLabel} (${lr?.profileDir}) • Hoàn thành trong ${lr?.totalElapsedSec}s`
                            : `Tổng thời gian dự kiến (${activeSeq.length} bước): ~${estMinTotal}s–${estMaxTotal}s / Via (Test nhanh 5s/bước: ~${fastTotal}s)`}
                        </span>
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        🛡️ 0% Chiếm chuột &amp; Bàn phím (Chạy ngầm độc lập)
                      </Badge>
                    </div>

                    {isRunnerActive && lr && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="rounded-md border border-border/70 bg-card/80 px-2.5 py-1.5">
                            <div className="text-[10px] text-muted-foreground">Hành động đang thực hiện</div>
                            <div className="truncate text-xs font-bold text-amber-300">
                              Bước {lr.currentStepIndex}/{lr.totalSteps}: {lr.currentStepTitle}
                            </div>
                          </div>
                          <div className="rounded-md border border-border/70 bg-card/80 px-2.5 py-1.5">
                            <div className="text-[10px] text-muted-foreground">Thời gian bước hiện tại</div>
                            <div className="font-mono text-xs font-bold text-foreground tabular-nums">
                              ⏱️ Còn {lr.stepRemainingSec}s / {lr.stepDurationSec}s (đã qua {lr.stepElapsedSec}s)
                            </div>
                          </div>
                          <div className="rounded-md border border-border/70 bg-card/80 px-2.5 py-1.5">
                            <div className="text-[10px] text-muted-foreground">Tổng thời gian phiên Via</div>
                            <div className="font-mono text-xs font-bold text-emerald-300 tabular-nums">
                              Đã chạy: {lr.totalElapsedSec}s • Còn ~{lr.estimatedRemainingSec}s
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <span className="text-[11px] text-muted-foreground">
                            Tiến độ tổng thể: {lr.overallProgressPercent}% • Có thể Tạm dừng, Bỏ qua bước hoặc Dừng hẳn ngay lập tức
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => sendDesktopCommand('queue_toggle_pause')}
                            >
                              {lr.isPaused ? '▶ Tiếp tục chạy' : '⏸ Tạm dừng'}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => sendDesktopCommand('queue_skip_wait')}
                            >
                              ⏭ Bỏ qua bước này
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => sendDesktopCommand('queue_stop')}
                            >
                              ⏹ Dừng hẳn &amp; Đóng Auto
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className="rounded-lg border border-border bg-background/60 p-3 space-y-2"
                    onDragOver={(e) => e.preventDefault()}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
                      <span>
                        {isCustomMode
                          ? `🔗 Chuỗi trình tự đang chạy (${activeSeq.length} bước — Kéo thả trực tiếp các bước để đổi vị trí):`
                          : `🎲 Mẫu kịch bản bốc thăm hôm nay (${activeSeq.length} bước — Mỗi Via tự biến thiên thứ tự riêng):`}
                      </span>
                      <span className="font-mono text-[11px] text-primary">
                        ⏱️ Ước tính: ~{estMinTotal}s–{estMaxTotal}s (Test nhanh: ~{fastTotal}s)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeSeq.map((key, idx) => {
                        const meta = catalogByKey.get(key)
                        const title = meta?.shortTitle ?? key
                        const icon = meta?.icon ?? '⚡'
                        const durHint = meta?.durationHint ?? '10–14s'
                        const isStepRunningNow =
                          isRunnerActive && lr?.currentStepIndex === idx + 1
                        const isStepDoneNow =
                          (isRunnerActive && (lr?.currentStepIndex ?? 0) > idx + 1) || isRunnerDone
                        const canMoveLeft = idx > 0
                        const canMoveRight = idx < activeSeq.length - 1
                        const canRemove = activeSeq.length > 2
                        return (
                          <div key={`${key}-${idx}`} className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  draggable
                                  onDragStart={() => setDragPayload(`step:${idx}`)}
                                  onDragOver={(e) => {
                                    e.preventDefault()
                                    setDragOverIdx(idx)
                                  }}
                                  onDragLeave={() => setDragOverIdx(null)}
                                  onDrop={(e) => {
                                    e.preventDefault()
                                    handleDropAtIndex(idx)
                                  }}
                                  className={cn(
                                    'flex cursor-grab items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-semibold shadow-xs transition-all active:cursor-grabbing',
                                    dragOverIdx === idx
                                      ? 'border-emerald-400 ring-2 ring-emerald-500/30'
                                      : isStepRunningNow
                                      ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-500/30'
                                      : isStepDoneNow
                                      ? 'border-emerald-500/50 bg-emerald-500/10'
                                      : 'border-primary/50',
                                  )}
                                >
                                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                                  <span>
                                    {isStepDoneNow ? '✓ ' : isStepRunningNow ? '● ' : ''}
                                    {idx + 1}. {icon} {title}
                                  </span>
                                  <span
                                    className={cn(
                                      'rounded px-1.5 py-0.5 font-mono text-[10px]',
                                      isStepRunningNow
                                        ? 'bg-amber-500/30 font-bold text-amber-200'
                                        : 'bg-primary/15 text-primary',
                                    )}
                                  >
                                    {isStepRunningNow
                                      ? `Còn ${lr?.stepRemainingSec}s/${lr?.stepDurationSec}s`
                                      : durHint}
                                  </span>
                                  <div className="ml-0.5 flex items-center">
                                    {canMoveLeft && (
                                      <button
                                        type="button"
                                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                        onClick={() => {
                                          const next = [...activeSeq]
                                          ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                                          sendSequenceUpdate(next)
                                        }}
                                        title="Đẩy lên trước"
                                      >
                                        <ArrowLeft className="h-3 w-3" />
                                      </button>
                                    )}
                                    {canMoveRight && (
                                      <button
                                        type="button"
                                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                        onClick={() => {
                                          const next = [...activeSeq]
                                          ;[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]
                                          sendSequenceUpdate(next)
                                        }}
                                        title="Đẩy ra sau"
                                      >
                                        <ArrowRight className="h-3 w-3" />
                                      </button>
                                    )}
                                    {canRemove && (
                                      <button
                                        type="button"
                                        className="rounded p-0.5 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300"
                                        onClick={() => {
                                          const next = [...activeSeq]
                                          next.splice(idx, 1)
                                          sendSequenceUpdate(next)
                                        }}
                                        title="Gỡ bước này"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {meta ? `${meta.fullTitle} (${meta.durationHint}) — ${meta.description}` : key}
                              </TooltipContent>
                            </Tooltip>
                            {idx < activeSeq.length - 1 && <span className="text-xs font-bold text-primary">➔</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )
            })()}

            {/* Built-in 1-Click Account Care Presets (AdsPower-style) */}
            {(state.carePresets?.length ?? 0) > 0 && (
              <div className="space-y-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-[11px] font-semibold text-indigo-300">
                    ⚡ Bộ Kịch Bản Mẫu Chăm Sóc Tài Khoản (Áp dụng 1 chạm):
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-amber-300 hover:text-amber-200"
                    onClick={() => setCookiePanelOpen((v) => !v)}
                  >
                    🍪 Cấu hình Cookie Robot ({cfg.cookieRobotUrlCount ?? 0} web){cookiePanelOpen ? ' ▲' : ' ▼'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {state.carePresets!.map((preset) => (
                    <Tooltip key={preset.key}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2.5 text-[11px]"
                          onClick={() => sendDesktopCommand('apply_care_preset', { presetKey: preset.key })}
                        >
                          <span>
                            {preset.icon} {preset.title}
                          </span>
                          <span className="ml-1 rounded bg-background/60 px-1 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                            {preset.steps.length}b
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="font-semibold">{preset.title}</p>
                        <p className="text-xs opacity-90">{preset.subtitle}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>

                {cookiePanelOpen && (
                  <div className="mt-2 space-y-2 rounded-md border border-border bg-background/60 p-2.5">
                    <Label className="text-[11px] text-muted-foreground">
                      Danh sách website Cookie Robot ghé thu lịch sử sạch (mỗi dòng 1 link — bỏ qua check login FB khi đang ở web ngoài):
                    </Label>
                    <Textarea
                      rows={3}
                      value={cookieRobotUrls}
                      onChange={(e) => setCookieRobotUrls(e.target.value)}
                      placeholder="https://vnexpress.net/&#10;https://cafef.vn/&#10;https://shopee.vn/"
                      className="font-mono text-[11px]"
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => sendDesktopCommand('save_cookie_robot_urls', { cookieRobotUrls })}
                      >
                        💾 Lưu danh sách Web
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          sendDesktopCommand('run_cookie_robot_now', {
                            viaId: flowViaId,
                            cookieRobotUrls,
                          })
                        }
                      >
                        <Play className="h-3 w-3" /> Chạy Cookie Robot Ngay
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Catalog Chips (Click OR Drag into Chain!) */}
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">
                ➕ Kho {state.warmupCatalog.length} Hành Động Tương Tác &amp; Cookie Robot (Bấm hoặc kéo thả vào chuỗi phía trên):
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {state.warmupCatalog.map((act) => (
                  <Tooltip key={act.key}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        draggable
                        onDragStart={() => setDragPayload(`lib:${act.key}`)}
                        onClick={() => handleAppendCatalogAction(act.key)}
                        className="h-7 cursor-grab px-2.5 text-[11px]"
                      >
                        <span>
                          {act.icon} + {act.shortTitle}
                        </span>
                        <span className="ml-1 rounded bg-background/60 px-1 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                          {act.durationHint}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {act.fullTitle} ({act.durationHint}) — {act.description}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* #1-#5 Switches */}
            <div className="grid grid-cols-1 gap-2">
              {[
                {
                  id: 'sw-cross',
                  checked: crossPage,
                  onChange: setCrossPage,
                  label: '🤝 [#1 Nuôi chéo nội bộ] Cho Via ghé thăm & thả Like/Tim vào các Fanpage LIVE của bạn',
                },
                {
                  id: 'sw-preads',
                  checked: preAdsBuf,
                  onChange: setPreAdsBuf,
                  label: `🛡️ [#2 Đệm Chống Checkpoint] Lướt Newsfeed tự nhiên ${preAdsSec}s trước khi mở Ads Manager / BM`,
                },
                {
                  id: 'sw-likecmt',
                  checked: autoLikeCmt,
                  onChange: setAutoLikeCmt,
                  label: '💬 [#4 Tương tác Khách hàng] Tự động thả Tim/Like bình luận khách khi quét Business Suite',
                },
                {
                  id: 'sw-tile',
                  checked: autoTile,
                  onChange: setAutoTile,
                  label: '🪟 [#5 Đa luồng] Tự động xếp lưới cửa sổ Chrome (2x2 / 3x2) khi mở từ 2 luồng trở lên',
                },
              ].map((sw) => (
                <div
                  key={sw.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-1.5"
                >
                  <Label htmlFor={sw.id} className="cursor-pointer text-xs">
                    {sw.label}
                  </Label>
                  <Switch id={sw.id} checked={sw.checked} onCheckedChange={sw.onChange} />
                </div>
              ))}
            </div>

            {/* Min/Max Rest & Pre-Ads Inputs + Speed Presets */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs">Nghỉ tối thiểu (s)</Label>
                <Input value={restMin} onChange={(e) => setRestMin(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nghỉ tối đa (s)</Label>
                <Input value={restMax} onChange={(e) => setRestMax(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Đệm trước Ads (s)</Label>
                <Input value={preAdsSec} onChange={(e) => setPreAdsSec(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {SPEED_PRESETS.map((pr) => {
                const active = Number(restMin) === pr.min && Number(restMax) === pr.max
                return (
                  <Button
                    key={pr.label}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'secondary'}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => {
                      setRestMin(String(pr.min))
                      setRestMax(String(pr.max))
                      sendDesktopCommand('save_flow_controls', {
                        ...flowPayload,
                        queueRestMinSeconds: pr.min,
                        queueRestMaxSeconds: pr.max,
                      })
                    }}
                  >
                    {pr.label}
                  </Button>
                )
              })}
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => sendDesktopCommand('save_flow_controls', flowPayload)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Lưu Kịch bản &amp; Nhịp nghỉ (#1–#5)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Local Runner Trust & Auto-Pilot Schedule Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold">
              Cấu hình Bảo vệ Trust &amp; Đảo Ấm (Local Runner)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-1.5">
              {[
                {
                  id: 'lg-autoka',
                  checked: autoKa,
                  onChange: setAutoKa,
                  label: 'Tự động chạy Đảo Ấm khi phát hiện Via >3 ngày không hoạt động',
                },
                {
                  id: 'lg-autopipe',
                  checked: autoPipe,
                  onChange: setAutoPipe,
                  label: 'Tự động chạy Chu trình Auto-Pilot 5 Bước theo khung giờ hẹn',
                },
                {
                  id: 'lg-invite',
                  checked: autoInvite,
                  onChange: setAutoInvite,
                  label: `Tự động mời người bày tỏ cảm xúc Follow Fanpage (Max ${cfg.maxPageFollowerInvitesPerRun}/phiên • Đã gửi: ${cfg.totalPageFollowerInvitesSent})`,
                },
                {
                  id: 'lg-vaultbak',
                  checked: autoVaultBak,
                  onChange: setAutoVaultBak,
                  label: 'Tự động sao lưu Két DPAPI mỗi ngày (.adsopsvault AES-256-GCM • giữ 14 bản)',
                },
                {
                  id: 'lg-prepx',
                  checked: preProxy,
                  onChange: setPreProxy,
                  label: 'Kiểm tra Proxy Live trước khi mở Chrome (Proxy Die tự bỏ qua)',
                },
                {
                  id: 'lg-closetab',
                  checked: autoCloseTab,
                  onChange: setAutoCloseTab,
                  label: 'Tự đóng tab Đảo Ấm sau khi cuộn xong Newsfeed + Thông báo',
                },
                {
                  id: 'lg-closewin',
                  checked: autoCloseWin,
                  onChange: setAutoCloseWin,
                  label: 'Tự đóng gọn cửa sổ Chrome của Via ngay khi nhận tín hiệu KEEPALIVE_OK',
                },
              ].map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/35 px-3 py-1.5"
                >
                  <Label htmlFor={row.id} className="cursor-pointer text-xs">
                    {row.label}
                  </Label>
                  <Switch id={row.id} checked={row.checked} onCheckedChange={row.onChange} />
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Khung giờ hẹn Auto-Pilot tự động (HH:mm — cách nhau dấu phẩy)</Label>
              <Input value={schedCsv} onChange={(e) => setSchedCsv(e.target.value)} placeholder="08:30, 20:00" />
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Giờ bắt đầu</Label>
                <Input value={startHour} onChange={(e) => setStartHour(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Giờ nghỉ đêm</Label>
                <Input value={endHour} onChange={(e) => setEndHour(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Via/Proxy</Label>
                <Input value={maxPerIp} onChange={(e) => setMaxPerIp(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Direct IP/ca</Label>
                <Input value={maxDirect} onChange={(e) => setMaxDirect(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  sendDesktopCommand('save_local_guard_config', {
                    autoKeepAliveScheduler: autoKa,
                    autoDailyFullPipeline: autoPipe,
                    autoInvitePageFollowersOnWarmup: autoInvite,
                    autoDailyVaultBackup: autoVaultBak,
                    autoPilotScheduleTimesCsv: schedCsv,
                    preCheckProxyBeforeLaunch: preProxy,
                    autoCloseKeepAliveTab: autoCloseTab,
                    autoCloseKeepAliveWindow: autoCloseWin,
                    autoKeepAliveStartHour: Number(startHour) || 8,
                    autoKeepAliveEndHour: Number(endHour) || 22,
                    maxViasPerProxyInBatch: Number(maxPerIp) || 4,
                    maxDirectIpViasInBatch: Number(maxDirect) || 3,
                  })
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Lưu Luật Bảo vệ
              </Button>
              <Button size="sm" onClick={() => sendDesktopCommand('keepalive_due')}>
                <Coffee className="h-3.5 w-3.5" /> Đảo Ấm Via quá hạn ngay
              </Button>
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('run_autopilot')}>
                <Zap className="h-3.5 w-3.5 text-emerald-400" /> Auto-Pilot 5 Bước
              </Button>
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('batch_invite_followers')}>
                <UserPlus className="h-3.5 w-3.5" /> Mời Follow Page (Lô)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('open_auto_backup_folder')}>
                <FolderOpen className="h-3.5 w-3.5" /> Thư mục Auto-Backup
              </Button>
              {state.isAutoInviteRunning && (
                <Button variant="destructive" size="sm" onClick={() => sendDesktopCommand('cancel_auto_invite')}>
                  ⏹ Dừng Auto-Invite
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Anti-Checkpoint Shield, 72h Soak & Client Silo Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm font-bold text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              Khiên Chống Checkpoint, Ngâm 72h &amp; Cách Ly Đa Khách Hàng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-1.5">
              {[
                {
                  id: 'sh-soak',
                  checked: soak72,
                  onChange: setSoak72,
                  label: 'Khóa Tạo Page 72h khi mới thêm Via hoặc đổi Proxy (chỉ Đảo Ấm thụ động)',
                },
                {
                  id: 'sh-silo',
                  checked: siloIso,
                  onChange: setSiloIso,
                  label: 'Cách ly Silo Khách hàng (Chặn trùng Proxy / Profile chéo giữa các khách)',
                },
                {
                  id: 'sh-ipkill',
                  checked: ipKill,
                  onChange: setIpKill,
                  label: `Bật IP Leak Kill-Switch thời gian thực trong Extension v${state.extVersion}`,
                },
                {
                  id: 'sh-autock',
                  checked: autoCookie,
                  onChange: setAutoCookie,
                  label: 'Tự đồng bộ làm mới Cookie về Két DPAPI sau mỗi phiên Đảo Ấm OK',
                },
              ].map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/35 px-3 py-1.5"
                >
                  <Label htmlFor={item.id} className="cursor-pointer text-xs">
                    {item.label}
                  </Label>
                  <Switch id={item.id} checked={item.checked} onCheckedChange={item.onChange} />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Kịch bản Nuôi mặc định</Label>
                <Select value={defMode} onValueChange={setDefMode}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="human_organic">Nuôi Tương Tác Thật (Feed + Watch + Notif)</SelectItem>
                    <SelectItem value="soak_72h">Ngâm 72h Thụ Động (Chỉ Feed + Notif)</SelectItem>
                    <SelectItem value="bm_warmup">Nuôi Cầm BM (Anti-Deep-Link)</SelectItem>
                    <SelectItem value="pre_camp">Trước Lên Camp (Feed + Pages)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ngâm (giờ)</Label>
                <Input value={soakHrs} onChange={(e) => setSoakHrs(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cooldown (giờ)</Label>
                <Input value={cooldownHrs} onChange={(e) => setCooldownHrs(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  sendDesktopCommand('save_anti_checkpoint_shield', {
                    enforceSoakQuarantine: soak72,
                    enforceClientSilo: siloIso,
                    ipLeakKillSwitchEnabled: ipKill,
                    autoRefreshCookieAfterKeepAlive: autoCookie,
                    defaultWarmupMode: defMode,
                    soakQuarantineHours: Number(soakHrs) || 72,
                    autoCooldownHours: Number(cooldownHrs) || 24,
                  })
                }
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Lưu Khiên &amp; Cập nhật Extension
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('open_stewardship_log')}
              >
                Nhật ký Bảo vệ
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active Chrome Sessions Tracker Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold">Phiên Chrome Đang Mở (PID &amp; RAM)</CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                {['2x2', '3x2', '2x1'].map((g) => (
                  <Button
                    key={g}
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => sendDesktopCommand('tile_chrome_windows', { grid: g })}
                  >
                    Xếp {g.replace('x', '×')}
                  </Button>
                ))}
                <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => sendDesktopCommand('clean_ram')}>
                  <Trash2 className="h-3 w-3" /> Dọn Cache &amp; RAM
                </Button>
              </div>
            </div>
            <CardDescription className="font-mono text-[11px]">
              RAM trống: {state.workstation.availableRamMb.toLocaleString('en-US')}/
              {state.workstation.totalRamMb.toLocaleString('en-US')} MB ({state.workstation.freePercent}%) • Max luồng:{' '}
              {cfg.effectiveMaxConcurrent} • Watchdog: {cfg.browserHangTimeoutSeconds}s
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {cfg.useIsolatedProfiles ? (
              <Badge variant="success">
                🔒 Chế độ Chrome Cô lập thông minh (Tự mở Profile gốc nếu chưa lưu Cookie)
              </Badge>
            ) : (
              <Button size="sm" onClick={() => sendDesktopCommand('enable_isolated_profiles_now')}>
                🔒 Bật Cô lập Chrome ngay (Khắc phục gộp tab)
              </Button>
            )}

            {state.activeSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Chưa mở phiên Chrome nào từ AdsOps Desktop Pro trong phiên làm việc này.
              </p>
            ) : (
              <div className="space-y-2">
                {state.activeSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">
                        {s.viaLabel} • {s.profileDir}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        Mở lúc {s.startedAtLocal} • {s.url}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.alive ? 'success' : 'secondary'} className="text-[10px]">
                        {s.statusText}
                      </Badge>
                      {s.alive && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => sendDesktopCommand('close_browser_session', { sessionId: s.sessionId })}
                        >
                          Đóng cửa sổ
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cloud Cron Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-bold">
              <Bot className="h-4 w-4 text-primary" />
              Tự động hóa Cloud Server (Cron &amp; Nuôi Page)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/35 px-3 py-1.5">
                <Label htmlFor="cron-sync" className="cursor-pointer text-xs">
                  Tự động đồng bộ Meta BM/TKQC trên Cloud
                </Label>
                <Switch id="cron-sync" checked={cronSync} onCheckedChange={setCronSync} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/35 px-3 py-1.5">
                <Label htmlFor="cron-warm" className="cursor-pointer text-xs">
                  Tự động lên lịch Nuôi bài Fanpage định kỳ
                </Label>
                <Switch id="cron-warm" checked={cronWarm} onCheckedChange={setCronWarm} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs">Chu kỳ đồng bộ (phút)</Label>
                <Input value={cronSyncMin} onChange={(e) => setCronSyncMin(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Giãn cách bài Warmup (giờ)</Label>
                <Input value={cronWarmGap} onChange={(e) => setCronWarmGap(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Lần chạy cuối: {cfg.cronLastRunLocal}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    sendDesktopCommand('save_cloud_cron', {
                      autoMetaSync: cronSync,
                      syncIntervalMinutes: Number(cronSyncMin) || 60,
                      autoPageWarmup: cronWarm,
                      warmupMinGapHours: Number(cronWarmGap) || 8,
                    })
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Lưu Cloud Cron
                </Button>
                <Button size="sm" onClick={() => sendDesktopCommand('run_cloud_cron_now')}>
                  <RefreshCw className="h-3.5 w-3.5" /> Chạy Cloud Cron ngay
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
