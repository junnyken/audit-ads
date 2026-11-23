import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Coffee,
  Cookie,
  Cpu,
  Dices,
  FolderOpen,
  GripVertical,
  Info,
  Layers,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SkipForward,
  SlidersHorizontal,
  Square,
  Star,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleVia, useShellUi } from '@/lib/shell-context'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto } from '@/types'

const SPEED_PRESETS = [
  { key: 'turbo', label: 'Turbo (8–15s)', min: 8, max: 15 },
  { key: 'fast', label: 'Nhanh (15–30s)', min: 15, max: 30 },
  { key: 'standard', label: 'Chuẩn (35–65s)', min: 35, max: 65 },
  { key: 'deep', label: 'Ngâm kỹ (75–120s)', min: 75, max: 120 },
]

export function AutomationTab({ state }: { state: AppShellWebStateDto }) {
  const { platformScope } = useShellUi()
  const cfg = state.automationConfig

  const [studioTab, setStudioTab] = useState<'flow' | 'playbooks' | 'batch_pages' | 'shields_guard' | 'sessions_cron'>('flow')

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

  // Flow Builder Switches, Presets, Catalog Drawers
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
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [timingOpen, setTimingOpen] = useState(false)

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

  const catalogByKey = useMemo(() => new Map(state.warmupCatalog.map((w) => [w.key, w])), [state.warmupCatalog])
  const metaVias = useMemo(() => state.vias.filter((v) => !isGoogleVia(v)), [state.vias])

  const scopedViasForSelect = useMemo(() => {
    if (platformScope === 'google_ads') {
      const gVias = state.vias.filter((v) => isGoogleVia(v))
      return gVias.length > 0 ? gVias : state.vias
    }
    return platformScope === 'meta' ? metaVias : state.vias
  }, [state.vias, metaVias, platformScope])

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
    <div className="space-y-4">
      {/* Contextual Google Ads Silo Notice */}
      {platformScope === 'google_ads' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/6 px-4 py-2.5">
          <StatusDot
            tone="live"
            label="Chế độ Google Ads 1:1 · Tách biệt quy trình Nuôi Meta/Fanpage; chỉ chạy Playbook Google Ads & Khiên Silo."
            labelClassName="text-xs font-medium text-foreground"
          />
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => sendDesktopCommand('open_google_ads_script_wizard')}
          >
            <Code2 className="h-3.5 w-3.5 text-emerald-500" /> Mã Google Ads Script
          </Button>
        </div>
      )}

      {/* TOP STUDIO MODE NAVIGATION (Zero asymmetric dead space!) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={studioTab}
          onChange={setStudioTab}
          items={[
            { value: 'flow', label: 'Thiết kế Kịch bản', count: activeSeq.length },
            { value: 'playbooks', label: 'Chợ Kịch bản Team', count: filteredPlaybooks.length },
            { value: 'batch_pages', label: 'Tạo Page An Toàn' },
            { value: 'shields_guard', label: 'Luật & Khiên Bảo vệ' },
            { value: 'sessions_cron', label: 'Phiên Chrome & Cron', count: state.activeSessions.length },
          ]}
        />

        {isRunnerActive && (
          <StatusDot
            tone="warning"
            label={`RPA đang chạy Bước ${lr?.currentStepIndex}/${lr?.totalSteps}`}
            labelClassName="font-mono text-xs"
          />
        )}
      </div>

      {/* STUDIO TAB 1: BEHAVIORAL WORKFLOW STUDIO (Full-Width Balanced Canvas) */}
      {studioTab === 'flow' && (
        <div className="space-y-4">
          {/* Control Header Strip */}
          <section className="studio-panel p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="w-64">
                  <Select value={flowViaId} onValueChange={setFlowViaId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Chọn Via thực thi" />
                    </SelectTrigger>
                    <SelectContent>
                      {scopedViasForSelect.map((v) => (
                        <SelectItem key={v.viaId} value={v.viaId}>
                          {v.label} ({v.profileDir})
                        </SelectItem>
                      ))}
                      <SelectItem value="__all__">Tất cả Via hợp lệ ({validViaCount})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <SegmentedTabs
                  value={isCustomMode ? 'custom_sequence' : 'daily_random'}
                  onChange={(m) => sendDesktopCommand('set_flow_mode', { mode: m })}
                  items={[
                    { value: 'daily_random', label: 'Bốc thăm hàng ngày' },
                    { value: 'custom_sequence', label: 'Tự Kéo-Thả' },
                  ]}
                />

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => sendDesktopCommand('reroll_daily_flow')}
                  title="Bốc thăm mẫu hành vi khác"
                >
                  <Shuffle className="h-3.5 w-3.5" /> Đổi mẫu
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => sendDesktopCommand('reset_default_flow')}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Mặc định
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1.5 text-xs',
                    timingOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setTimingOpen((v) => !v)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Nhịp nghỉ ({restMin}–{restMax}s)
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    sendDesktopCommand('run_natural_flow', {
                      ...flowPayload,
                      viaId: flowViaId,
                      fastTest: true,
                    })
                  }
                >
                  <Play className="h-3.5 w-3.5" /> Test nhanh (5s)
                </Button>

                <Button
                  size="sm"
                  className="h-8 text-xs font-semibold"
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
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Đang giới hạn tối đa {cfg.maxDirectIpViasInBatch} Via Direct IP/ca để chống liên đới — điều chỉnh tại mục Luật &amp; Khiên Bảo vệ.
                </span>
              </div>
            )}

            {/* RPA Live Runner Status */}
            <div
              className={cn(
                'rounded-lg border px-3.5 py-2.5 transition-colors',
                isRunnerActive
                  ? 'border-amber-500/40 bg-amber-500/8'
                  : isRunnerDone
                  ? 'border-emerald-500/35 bg-emerald-500/8'
                  : 'border-border/70 bg-muted/25',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <StatusDot
                    tone={
                      isRunnerActive
                        ? lr?.isPaused
                          ? 'warning'
                          : 'info'
                        : isRunnerDone
                        ? 'live'
                        : 'muted'
                    }
                    label={
                      isRunnerActive
                        ? lr?.isPaused
                          ? `Tạm dừng (${lr.currentStepIndex}/${lr.totalSteps})`
                          : `Đang chạy Bước ${lr?.currentStepIndex}/${lr?.totalSteps}`
                        : isRunnerDone
                        ? 'Hoàn tất kịch bản'
                        : 'RPA sẵn sàng'
                    }
                    labelClassName="text-xs font-semibold"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {isRunnerActive
                      ? `${lr?.viaLabel} (${lr?.profileDir}) → ${lr?.currentStepTitle}`
                      : isRunnerDone
                      ? `${lr?.viaLabel} · Hoàn thành trong ${lr?.totalElapsedSec}s`
                      : `Tổng dự kiến (${activeSeq.length} bước): ~${estMinTotal}–${estMaxTotal}s / Via (Test 5s: ~${fastTotal}s)`}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
                  0% Chiếm chuột &amp; bàn phím
                </span>
              </div>

              {isRunnerActive && lr && (
                <div className="mt-2.5 space-y-2">
                  <Progress value={lr.overallProgressPercent} className="h-1.5" />
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                    <span className="text-foreground">
                      Bước hiện tại: còn {lr.stepRemainingSec}s/{lr.stepDurationSec}s · Tổng: {lr.totalElapsedSec}s (còn ~{lr.estimatedRemainingSec}s)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" className="h-6 px-2 text-[11px]" onClick={() => sendDesktopCommand('queue_toggle_pause')}>
                        {lr.isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        {lr.isPaused ? 'Tiếp tục' : 'Tạm dừng'}
                      </Button>
                      <Button variant="secondary" size="sm" className="h-6 px-2 text-[11px]" onClick={() => sendDesktopCommand('queue_skip_wait')}>
                        <SkipForward className="h-3 w-3" /> Bỏ qua
                      </Button>
                      <Button variant="destructive" size="sm" className="h-6 px-2 text-[11px]" onClick={() => sendDesktopCommand('queue_stop')}>
                        <Square className="h-3 w-3" /> Dừng
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Connected Step Pipeline Track */}
          <section className="studio-panel overflow-hidden" onDragOver={(e) => e.preventDefault()}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <Dices className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  {isCustomMode
                    ? `Chuỗi trình tự đang chạy (${activeSeq.length} bước — Kéo thả để đổi vị trí)`
                    : `Mẫu kịch bản bốc thăm (${activeSeq.length} bước — Tự biến thiên thứ tự cho mỗi Via)`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-primary tabular-nums">
                  <Clock className="mr-1 inline h-3 w-3" />~{estMinTotal}–{estMaxTotal}s
                </span>
                <Button
                  variant={catalogOpen ? 'default' : 'secondary'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setCatalogOpen((v) => !v)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm hành động ({state.warmupCatalog.length})
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 p-4">
              {activeSeq.map((key, idx) => {
                const meta = catalogByKey.get(key)
                const title = meta?.shortTitle ?? key
                const durHint = meta?.durationHint ?? '10–14s'
                const isStepRunningNow = isRunnerActive && lr?.currentStepIndex === idx + 1
                const isStepDoneNow =
                  (isRunnerActive && (lr?.currentStepIndex ?? 0) > idx + 1) || isRunnerDone
                const canMoveLeft = idx > 0
                const canMoveRight = idx < activeSeq.length - 1
                const canRemove = activeSeq.length > 2
                return (
                  <div key={`${key}-${idx}`} className="flex items-center gap-2">
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
                            'group relative flex cursor-grab items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all active:cursor-grabbing',
                            dragOverIdx === idx
                              ? 'border-emerald-500 ring-2 ring-emerald-500/25'
                              : isStepRunningNow
                              ? 'border-amber-500 bg-amber-500/10'
                              : isStepDoneNow
                              ? 'border-emerald-500/40 bg-emerald-500/8'
                              : 'border-border/80 bg-card hover:border-primary/45',
                          )}
                        >
                          <GripVertical className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground" />
                          <span className="font-mono text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="font-medium text-foreground">{title}</span>
                          {isStepDoneNow && <Check className="h-3 w-3 text-emerald-500" />}
                          {isStepRunningNow && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          )}
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                            {isStepRunningNow
                              ? `${lr?.stepRemainingSec}s`
                              : durHint}
                          </span>
                          <div className="flex items-center opacity-40 transition-opacity group-hover:opacity-100">
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
                                className="rounded p-0.5 text-muted-foreground hover:bg-rose-500/15 hover:text-rose-500"
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
                    {idx < activeSeq.length - 1 && (
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/45" />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Expandable Action Catalog Shelf */}
            {catalogOpen && (
              <div className="border-t border-border/70 bg-muted/20 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Bấm hoặc kéo thả từ kho {state.warmupCatalog.length} hành động vào chuỗi phía trên
                  </span>
                  <button
                    type="button"
                    onClick={() => setCatalogOpen(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Đóng
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {state.warmupCatalog.map((act) => (
                    <Tooltip key={act.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDragPayload(`lib:${act.key}`)}
                          onClick={() => handleAppendCatalogAction(act.key)}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/75 bg-card px-2.5 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/40"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Plus className="h-3 w-3 shrink-0 text-primary" />
                            <span className="truncate font-medium text-foreground">{act.shortTitle}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                            {act.durationHint}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {act.fullTitle} ({act.durationHint}) — {act.description}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}

            {/* Expandable Timing & #1-#5 Behavior Drawer */}
            {timingOpen && (
              <div className="border-t border-border/70 bg-muted/20 p-4 space-y-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      id: 'sw-cross',
                      checked: crossPage,
                      onChange: setCrossPage,
                      label: '[#1 Nuôi chéo] Via ghé thăm & thả Like/Tim Fanpage LIVE',
                    },
                    {
                      id: 'sw-preads',
                      checked: preAdsBuf,
                      onChange: setPreAdsBuf,
                      label: `[#2 Đệm Checkpoint] Lướt Newsfeed ${preAdsSec}s trước khi mở Ads Manager`,
                    },
                    {
                      id: 'sw-likecmt',
                      checked: autoLikeCmt,
                      onChange: setAutoLikeCmt,
                      label: '[#4 Chăm khách] Tự thả Tim/Like bình luận Business Suite',
                    },
                    {
                      id: 'sw-tile',
                      checked: autoTile,
                      onChange: setAutoTile,
                      label: '[#5 Đa luồng] Tự xếp lưới cửa sổ Chrome (2×2 / 3×2)',
                    },
                  ].map((sw) => (
                    <div
                      key={sw.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/75 bg-card px-3 py-2"
                    >
                      <Label htmlFor={sw.id} className="cursor-pointer text-xs leading-snug">
                        {sw.label}
                      </Label>
                      <Switch id={sw.id} checked={sw.checked} onCheckedChange={sw.onChange} />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Nghỉ tối thiểu (s)</Label>
                    <Input value={restMin} onChange={(e) => setRestMin(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nghỉ tối đa (s)</Label>
                    <Input value={restMax} onChange={(e) => setRestMax(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Đệm trước Ads (s)</Label>
                    <Input value={preAdsSec} onChange={(e) => setPreAdsSec(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                  </div>
                  <div className="flex items-end">
                    <Button size="sm" className="h-8 w-full text-xs" onClick={() => sendDesktopCommand('save_flow_controls', flowPayload)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Lưu Nhịp nghỉ (#1–#5)
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {SPEED_PRESETS.map((pr) => {
                    const active = Number(restMin) === pr.min && Number(restMax) === pr.max
                    return (
                      <Button
                        key={pr.key}
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
                </div>
              </div>
            )}
          </section>

          {/* Bottom Balanced Row: 1-Click Account Care Presets + Cookie Robot Config */}
          {(state.carePresets?.length ?? 0) > 0 && (
            <section className="studio-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-semibold text-foreground">
                    Bộ Kịch Bản Mẫu Chăm Sóc Tài Khoản (Áp dụng 1 chạm)
                  </h3>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setCookiePanelOpen((v) => !v)}
                >
                  <Cookie className="h-3.5 w-3.5 text-amber-500" />
                  Cookie Robot ({cfg.cookieRobotUrlCount ?? 0} web)
                </Button>
              </div>

              <div className="grid grid-cols-1 divide-y divide-border/65 sm:grid-cols-2 sm:divide-x lg:grid-cols-5 lg:divide-y-0">
                {state.carePresets!.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => sendDesktopCommand('apply_care_preset', { presetKey: preset.key })}
                    className="group flex flex-col justify-between p-4 text-left transition-colors hover:bg-muted/35"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        {preset.title}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                        {preset.steps.length} bước
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{preset.subtitle}</p>
                  </button>
                ))}
              </div>

              {cookiePanelOpen && (
                <div className="space-y-2.5 border-t border-border/70 bg-muted/20 p-4">
                  <Label className="text-xs text-muted-foreground">
                    Danh sách website Cookie Robot ghé thu lịch sử sạch (mỗi dòng 1 link — bỏ qua check login FB khi đang ở web ngoài):
                  </Label>
                  <Textarea
                    rows={3}
                    value={cookieRobotUrls}
                    onChange={(e) => setCookieRobotUrls(e.target.value)}
                    placeholder="https://vnexpress.net/&#10;https://cafef.vn/&#10;https://shopee.vn/"
                    className="font-mono text-xs"
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => sendDesktopCommand('save_cookie_robot_urls', { cookieRobotUrls })}
                    >
                      <Save className="h-3 w-3" /> Lưu danh sách Web
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
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
            </section>
          )}
        </div>
      )}

      {/* STUDIO TAB 2: TEAM PLAYBOOKS & BATCH JITTER RUNNER (Full Width, Balanced!) */}
      {studioTab === 'playbooks' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/70 px-5 py-3.5">
            <SegmentedTabs
              value={state.playbookPlatformFilter}
              onChange={(pl) => sendDesktopCommand('set_playbook_platform', { platform: pl })}
              items={[
                { value: 'all', label: 'Tất cả' },
                { value: 'meta', label: 'Meta Ads' },
                { value: 'google_ads', label: 'Google Ads' },
                { value: 'tiktok', label: 'TikTok Ads' },
                { value: 'multi', label: 'Đa nền tảng' },
              ]}
            />

            <Button size="sm" className="h-8 text-xs font-semibold" onClick={() => sendDesktopCommand('open_create_playbook')}>
              <Plus className="h-3.5 w-3.5" /> Tạo Kịch bản Mới
            </Button>
          </div>

          {filteredPlaybooks.length === 0 || !activePb ? (
            <div className="p-10 text-center text-xs text-muted-foreground">
              Không có kịch bản nào thuộc nền tảng này.
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-border/70 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
              {/* Left List of Playbooks */}
              <div className="divide-y divide-border/60 lg:col-span-5">
                {filteredPlaybooks.map((p) => {
                  const selected = p.id === activePb.id
                  const ratingTxt =
                    p.ratingCount > 0 && p.avgRating != null ? `${p.avgRating.toFixed(1)}★` : 'Mới'
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => sendDesktopCommand('select_playbook', { playbookId: p.id })}
                      className={cn(
                        'w-full px-5 py-3.5 text-left transition-colors hover:bg-muted/35',
                        selected && 'bg-primary/6',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('truncate text-xs font-semibold', selected ? 'text-primary' : 'text-foreground')}>
                          {p.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                          {p.platform.toUpperCase()} · {ratingTxt}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{p.description}</p>
                    </button>
                  )
                })}
              </div>

              {/* Right Selected Playbook Inspector & Jitter Launch */}
              <div className="flex flex-col justify-between gap-5 p-6 lg:col-span-7">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium uppercase text-foreground">
                      {activePb.platform} · v{activePb.versionTag}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {activePb.runCount} lượt chạy · Tác giả: {activePb.authorName}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{activePb.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{activePb.description}</p>
                  <div className="rounded-lg border border-border/75 bg-muted/25 p-3 font-mono text-[11px] text-muted-foreground">
                    Bước 1: {activePb.firstStepTarget} · Jitter: {activePb.defaultStaggerSec}s ±{activePb.jitterPct}%
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const mine = activePb.myRating === star
                      return (
                        <Button
                          key={star}
                          size="sm"
                          variant={mine ? 'default' : 'ghost'}
                          className="h-7 px-2 font-mono text-xs tabular-nums"
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

                  <Button
                    size="sm"
                    onClick={() => sendDesktopCommand('run_playbook_batch', { playbookId: activePb.id })}
                  >
                    <Play className="h-3.5 w-3.5" /> Chạy Lô Kịch bản (Jitter)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* STUDIO TAB 3: SAFE BATCH PAGE CREATION */}
      {studioTab === 'batch_pages' && (
        <div className="mx-auto max-w-3xl">
          <section className="studio-panel overflow-hidden">
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Layers className="h-4 w-4 text-primary" />
                Tạo Page Hàng Loạt Theo Nhịp An Toàn (Multi-Via Queue)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Chọn các Via còn hạn mức (Quota SAFE {cfg.maxSafeBatchNow}), nghỉ giãn cách + Jitter và tự kiểm tra Proxy trước khi mở Chrome Profile.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ngành hàng &amp; Kịch bản bài đăng Warmup</Label>
                  <Select value={nicheKey} onValueChange={setNicheKey}>
                    <SelectTrigger className="h-8 text-xs">
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
                    <SelectTrigger className="h-8 text-xs">
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
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Số Page (1–20)</Label>
                  <Input value={batchCount} onChange={(e) => setBatchCount(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nghỉ giữa mỗi Page (giây)</Label>
                  <Input value={batchStagger} onChange={(e) => setBatchStagger(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tiền tố Brand</Label>
                  <Input
                    value={batchPrefix}
                    onChange={(e) => setBatchPrefix(e.target.value)}
                    placeholder="VD: Lumi Spa"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Danh sách Tên Page tùy chọn (1 dòng / Page)</Label>
                <Textarea
                  rows={4}
                  value={batchNames}
                  onChange={(e) => setBatchNames(e.target.value)}
                  placeholder="Mỗi dòng 1 tên Page riêng (để trống nếu muốn hệ thống tự phối tên theo ngành)"
                  className="text-xs"
                />
              </div>

              <div className="divide-y divide-border/65 rounded-lg border border-border/75">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <Label htmlFor="batch-auto-sub" className="cursor-pointer text-xs leading-snug">
                    Extension tự điền Tên / Ngành / Bio và nhấn Tạo Page khi Chrome mở
                  </Label>
                  <Switch id="batch-auto-sub" checked={batchAutoSubmit} onCheckedChange={setBatchAutoSubmit} />
                </div>

                <div className="space-y-2 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="pre-page-warmup"
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      Đệm lướt Newsfeed trước khi mở trang Tạo Page (Chống chặn tạo)
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
                        className="h-7 w-16 font-mono text-xs tabular-nums"
                      />
                      <span>giây (khuyên dùng 25–45s)</span>
                    </div>
                  )}
                </div>
              </div>

              {(cfg.directIpViaCount ?? 0) > 0 &&
                (cfg.directIpViaCount ?? 0) >= state.vias.length &&
                state.vias.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>
                      Hiện {cfg.directIpViaCount}/{state.vias.length} Via đang dùng chung Direct IP (Mạng gốc). Nên tạo 1–2 Page/ca hoặc gắn Proxy riêng để tránh Meta chặn tạo Trang.
                    </span>
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
            </div>
          </section>
        </div>
      )}

      {/* STUDIO TAB 4: LOCAL GUARD RULES & ANTI-CHECKPOINT SHIELD */}
      {studioTab === 'shields_guard' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="studio-panel overflow-hidden">
            <div className="border-b border-border/70 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Coffee className="h-4 w-4 text-primary" />
                Bảo vệ Trust &amp; Đảo Ấm (Local Runner)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Quản lý khung giờ tự động Đảo Ấm, Auto-Pilot 5 bước &amp; giới hạn cùng IP
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="divide-y divide-border/60 rounded-lg border border-border/75">
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
                    label: `Tự động mời cảm xúc Follow Fanpage (Max ${cfg.maxPageFollowerInvitesPerRun}/phiên · Đã gửi ${cfg.totalPageFollowerInvitesSent})`,
                  },
                  {
                    id: 'lg-vaultbak',
                    checked: autoVaultBak,
                    onChange: setAutoVaultBak,
                    label: 'Tự động sao lưu Két DPAPI mỗi ngày (.adsopsvault · giữ 14 bản)',
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
                    label: 'Tự đóng gọn cửa sổ Chrome của Via ngay khi nhận KEEPALIVE_OK',
                  },
                ].map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <Label htmlFor={row.id} className="cursor-pointer text-xs">
                      {row.label}
                    </Label>
                    <Switch id={row.id} checked={row.checked} onCheckedChange={row.onChange} />
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Khung giờ hẹn Auto-Pilot tự động (HH:mm — cách nhau dấu phẩy)</Label>
                <Input
                  value={schedCsv}
                  onChange={(e) => setSchedCsv(e.target.value)}
                  placeholder="08:30, 20:00"
                  className="h-8 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Giờ bắt đầu</Label>
                  <Input value={startHour} onChange={(e) => setStartHour(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Giờ nghỉ đêm</Label>
                  <Input value={endHour} onChange={(e) => setEndHour(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Via/Proxy</Label>
                  <Input value={maxPerIp} onChange={(e) => setMaxPerIp(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Direct IP</Label>
                  <Input value={maxDirect} onChange={(e) => setMaxDirect(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
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
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('keepalive_due')}>
                  <Coffee className="h-3.5 w-3.5" /> Đảo Ấm Via quá hạn
                </Button>
                <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('run_autopilot')}>
                  <Zap className="h-3.5 w-3.5 text-emerald-500" /> Auto-Pilot
                </Button>
                <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('batch_invite_followers')}>
                  <UserPlus className="h-3.5 w-3.5" /> Mời Follow lô
                </Button>
                <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('open_auto_backup_folder')}>
                  <FolderOpen className="h-3.5 w-3.5" /> Auto-Backup
                </Button>
                {state.isAutoInviteRunning && (
                  <Button variant="destructive" size="sm" onClick={() => sendDesktopCommand('cancel_auto_invite')}>
                    <Square className="h-3.5 w-3.5" /> Dừng Auto-Invite
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className="studio-panel overflow-hidden">
            <div className="border-b border-border/70 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Khiên Chống Checkpoint, Ngâm 72h &amp; Silo Khách hàng
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ngăn chặn khóa hàng loạt nhờ Silo Khách hàng, Khóa ngâm 72h &amp; IP Leak Kill-Switch
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                {[
                  {
                    id: 'sh-soak',
                    checked: soak72,
                    onChange: setSoak72,
                    label: 'Khóa Tạo Page 72h khi mới thêm Via hoặc đổi Proxy',
                  },
                  {
                    id: 'sh-silo',
                    checked: siloIso,
                    onChange: setSiloIso,
                    label: 'Cách ly Silo Khách hàng (Chặn trùng Proxy / Profile chéo)',
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
                  <div key={item.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
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
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="human_organic">Nuôi Tương Tác Thật</SelectItem>
                      <SelectItem value="soak_72h">Ngâm 72h Thụ Động</SelectItem>
                      <SelectItem value="bm_warmup">Nuôi Cầm BM (Anti-Deep-Link)</SelectItem>
                      <SelectItem value="pre_camp">Trước Lên Camp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ngâm (giờ)</Label>
                  <Input value={soakHrs} onChange={(e) => setSoakHrs(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cooldown (giờ)</Label>
                  <Input value={cooldownHrs} onChange={(e) => setCooldownHrs(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
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
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('open_stewardship_log')}>
                  Nhật ký Bảo vệ
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* STUDIO TAB 5: CHROME SESSIONS & CLOUD CRON */}
      {studioTab === 'sessions_cron' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="studio-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Cpu className="h-4 w-4 text-primary" />
                  Phiên Chrome Đang Mở
                </h2>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  RAM trống {state.workstation.availableRamMb.toLocaleString('en-US')}/{state.workstation.totalRamMb.toLocaleString('en-US')} MB ({state.workstation.freePercent}%) · Max {cfg.effectiveMaxConcurrent} luồng
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {['2x2', '3x2', '2x1'].map((g) => (
                  <Button
                    key={g}
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2 font-mono text-xs"
                    onClick={() => sendDesktopCommand('tile_chrome_windows', { grid: g })}
                  >
                    {g.replace('x', '×')}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => sendDesktopCommand('clean_ram')}>
                  <Trash2 className="h-3 w-3" /> Dọn RAM
                </Button>
              </div>
            </div>

            <div className="p-5 space-y-3">
              {cfg.useIsolatedProfiles ? (
                <StatusDot
                  tone="live"
                  label="Chế độ Chrome Cô lập thông minh đang bật"
                  labelClassName="text-xs font-medium text-foreground"
                />
              ) : (
                <Button size="sm" onClick={() => sendDesktopCommand('enable_isolated_profiles_now')}>
                  <Lock className="h-3.5 w-3.5" /> Bật Cô lập Chrome ngay (Khắc phục gộp tab)
                </Button>
              )}

              {state.activeSessions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/75 p-6 text-center text-xs text-muted-foreground">
                  Chưa mở phiên Chrome nào từ AdsOps Desktop Pro trong phiên làm việc này.
                </p>
              ) : (
                <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                  {state.activeSessions.map((s) => (
                    <div key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {s.viaLabel} · {s.profileDir}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                          Mở lúc {s.startedAtLocal} · {s.url}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusDot tone={s.alive ? 'live' : 'muted'} label={s.statusText} labelClassName="text-[11px]" />
                        {s.alive && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => sendDesktopCommand('close_browser_session', { sessionId: s.sessionId })}
                          >
                            Đóng
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="studio-panel overflow-hidden">
            <div className="border-b border-border/70 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                Tự động hóa Cloud Server (Cron &amp; Nuôi Page)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cấu hình lịch đồng bộ Meta BM/TKQC &amp; đăng bài Warmup định kỳ từ Backend Cloud
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <Label htmlFor="cron-sync" className="cursor-pointer text-xs">
                    Tự động đồng bộ Meta BM/TKQC trên Cloud
                  </Label>
                  <Switch id="cron-sync" checked={cronSync} onCheckedChange={setCronSync} />
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <Label htmlFor="cron-warm" className="cursor-pointer text-xs">
                    Tự động lên lịch Nuôi bài Fanpage định kỳ
                  </Label>
                  <Switch id="cron-warm" checked={cronWarm} onCheckedChange={setCronWarm} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Chu kỳ đồng bộ (phút)</Label>
                  <Input value={cronSyncMin} onChange={(e) => setCronSyncMin(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Giãn cách bài Warmup (giờ)</Label>
                  <Input value={cronWarmGap} onChange={(e) => setCronWarmGap(e.target.value)} className="h-8 font-mono tabular-nums text-xs" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                <span className="tabular-nums">Lần chạy cuối: {cfg.cronLastRunLocal}</span>
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
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
