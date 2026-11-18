import type { AppShellLiveTickDto, AppShellWebStateDto } from '@/types'

export function sendDesktopCommand(action: string, payload?: Record<string, unknown>): void {
  const msg = { action, ...(payload ?? {}) }
  const host = window.chrome?.webview
  if (host) {
    host.postMessage(msg)
    return
  }
  console.debug('[DesktopUi] Bridge command (preview mode):', msg)
}

export function subscribeDesktopState(
  onFullState: (state: AppShellWebStateDto) => void,
  onLiveTick: (tick: AppShellLiveTickDto) => void,
): () => void {
  const host = window.chrome?.webview
  if (!host) {
    return () => {}
  }

  const handler = (ev: { data: unknown }) => {
    try {
      const raw = ev.data
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!parsed || typeof parsed !== 'object') return

      if (parsed.type === 'live_tick') {
        onLiveTick(parsed as AppShellLiveTickDto)
      } else if ('kpi' in parsed) {
        onFullState(parsed as AppShellWebStateDto)
      }
    } catch (err) {
      console.error('[DesktopUi] Failed to parse host state payload', err)
    }
  }

  host.addEventListener('message', handler)
  sendDesktopCommand('ready')
  return () => host.removeEventListener('message', handler)
}

export function mergeLiveTick(
  prev: AppShellWebStateDto,
  tick: AppShellLiveTickDto,
): AppShellWebStateDto {
  const runtimeMap = tick.viaRuntimeMap || {}
  const updatedVias =
    prev.vias.length > 0 && Object.keys(runtimeMap).length > 0
      ? prev.vias.map((v) => {
          const rt = runtimeMap[v.viaId]
          return rt
            ? {
                ...v,
                isBrowserRunning: rt.isBrowserRunning,
                activeRamMb: rt.activeRamMb,
                activeCpuPercent: rt.activeCpuPercent,
              }
            : v
        })
      : prev.vias

  const activeId = (tick.activeAutoInvitePageId || '').toLowerCase()
  const updatedFanpages =
    prev.fanpages.length > 0
      ? prev.fanpages.map((fp) => ({
          ...fp,
          isRunningInvite:
            tick.isAutoInviteRunning &&
            Boolean(
              activeId &&
                (fp.id.toLowerCase() === activeId || fp.externalPageId.toLowerCase() === activeId),
            ),
        }))
      : prev.fanpages

  return {
    ...prev,
    isBusy: tick.isBusy,
    isAutoInviteRunning: tick.isAutoInviteRunning,
    activeAutoInvitePageId: tick.activeAutoInvitePageId,
    errorBannerText: tick.errorBannerText,
    isAuthExpired: tick.isAuthExpired,
    navBadges: tick.navBadges,
    kpi: tick.kpi,
    queue: tick.queue,
    workstation: tick.workstation,
    totpMap: tick.totpMap,
    activeSessions: tick.activeSessions,
    runtimeLogs: tick.runtimeLogs,
    liveRunner: tick.liveRunner ?? prev.liveRunner,
    vias: updatedVias,
    fanpages: updatedFanpages,
  }
}

export const PREVIEW_FALLBACK_STATE: AppShellWebStateDto = {
  type: 'full_state',
  appVersion: '3.2.0',
  extVersion: '2.10.2',
  activeView: 'overview',
  palette: 'obsidian',
  isLoggedIn: false,
  hasLoadedOnce: false,
  isBusy: false,
  isAuthExpired: false,
  isOfflineSnapshot: false,
  offlineSnapshotAt: '',
  errorBannerText: '',
  userDisplay: 'Đang kết nối...',
  userEmail: '',
  userRole: 'owner',
  workspaceDisplay: 'AdsOps Desktop Pro',
  lastSyncedAt: '—',
  autoDailyPipeline: false,
  configRev: 1,
  isAutoInviteRunning: false,
  activeAutoInvitePageId: '',
  navBadges: { overview: '', vias: '', automation: '', healthTokens: '', workspaceOps: '' },
  kpi: {
    totalVias: 0,
    cookieVaultCount: 0,
    dueKeepAliveCount: 0,
    twoFaReadyCount: 0,
    totalPages: 0,
    adsReadyPages: 0,
    totalFollowersInvited: 0,
    totalAdAccounts: 0,
    activeAdAccounts: 0,
    openAlertCount: 0,
    criticalHealthCount: 0,
    bridgePort: 17890,
    bridgeOnline: true,
    extVersion: '2.10.2',
    activeBrowsers: 0,
    liveProxyVias: 0,
    directIpVias: 0,
    nativeProfileReadyCount: 0,
    maxDirectIpPerBatch: 3,
  },
  queue: {
    isActive: false,
    phase: 'Idle',
    kind: 'KeepAlive',
    checkingProxy: false,
    currentIndex: 0,
    totalCount: 0,
    launchedCount: 0,
    skippedCount: 0,
    countdownSeconds: 0,
    summaryText: 'Sẵn sàng nhận lệnh',
    detailText: '',
    progressPercent: 0,
  },
  workstation: {
    availableRamMb: 0,
    totalRamMb: 0,
    freePercent: 100,
    recommendedConcurrent: 2,
    isLowRam: false,
  },
  groupedAlerts: [],
  cloudLogs: [],
  runtimeLogs: [],
  vias: [],
  totpMap: {},
  chromeProfiles: [],
  supportedEngines: [{ value: 'chrome_native', label: 'Chrome Gốc (Native)' }],
  teamMemberOptions: [],
  automationConfig: {
    warmupFlowMode: 'daily_random',
    activeDisplaySequence: ['scroll_feed', 'watch_reels', 'read_notifications', 'refresh_cookie_and_close'],
    customWarmupSequence: ['scroll_feed', 'watch_reels', 'read_notifications', 'refresh_cookie_and_close'],
    enableInternalPageCrossWarmup: true,
    enablePreAdsManagerWarmup: true,
    preAdsWarmupSeconds: 20,
    autoLikeCommentsOnPageInvite: true,
    autoTileWindowsOnBatch: true,
    queueRestMinSeconds: 15,
    queueRestMaxSeconds: 32,
    flowSelectedViaId: '__first__',
    batchNicheKey: 'beauty_spa',
    batchOwnerBmId: '',
    batchCount: 3,
    batchStaggerSec: 65,
    batchPrefix: '',
    batchCustomNames: '',
    batchAutoSubmit: true,
    maxSafeBatchNow: 0,
    autoKeepAliveScheduler: true,
    autoDailyFullPipeline: false,
    autoInvitePageFollowersOnWarmup: true,
    maxPageFollowerInvitesPerRun: 25,
    totalPageFollowerInvitesSent: 0,
    autoDailyVaultBackup: true,
    autoPilotScheduleTimesCsv: '08:30, 20:00',
    preCheckProxyBeforeLaunch: true,
    autoCloseKeepAliveTab: true,
    autoCloseKeepAliveWindow: true,
    autoKeepAliveStartHour: 8,
    autoKeepAliveEndHour: 22,
    maxViasPerProxyInBatch: 4,
    maxDirectIpViasInBatch: 3,
    enforceSoakQuarantine: true,
    enforceClientSilo: true,
    ipLeakKillSwitchEnabled: true,
    autoRefreshCookieAfterKeepAlive: true,
    defaultWarmupMode: 'human_organic',
    soakQuarantineHours: 72,
    autoCooldownHours: 24,
    useIsolatedProfiles: true,
    effectiveMaxConcurrent: 4,
    browserHangTimeoutSeconds: 210,
    cronAutoMetaSync: false,
    cronSyncIntervalMinutes: 60,
    cronAutoPageWarmup: false,
    cronWarmupMinGapHours: 8,
    cronLastRunLocal: 'Chưa chạy',
  },
  warmupCatalog: [],
  nicheTemplates: [],
  playbooks: [],
  selectedPlaybookId: '',
  playbookPlatformFilter: 'all',
  activeSessions: [],
  bms: [],
  pixels: [],
  domainSeo: {
    customDomain: '',
    effectivePublicUrl: 'https://adsops-app.vibe.tinhgon.xyz',
    checklist: [],
  },
  fanpages: [],
  pageHolderOptions: [],
  spendCurrencies: [],
  adAccounts: [],
  adSearch: '',
  adFilter: 'all',
  healthKpi: {
    critical: 0,
    warning: 0,
    attentionNeeded: 0,
    clearSignals: 0,
    totalActive: 0,
    staleData: 0,
    tokenConfiguredCount: 0,
    metaConnectionCount: 0,
    draftCount: 0,
    draftBlockingCount: 0,
  },
  metaConnections: [],
  accountHealthRows: [],
  campaignDrafts: [],
  readinessSummary: { operationallyReady: 0, readyWithWarnings: 0, notReady: 0, unknown: 0 },
  readinessGroups: [],
  readinessRows: [],
  auditLogs: [],
  retainersSummary: {
    totalContracts: 0,
    daysRemainingInMonth: 12,
    totalCommittedVnd: 0,
    totalMtdSpendVnd: 0,
    totalUnpaidBalanceVnd: 0,
    totalSettlementMtdVnd: 0,
  },
  retainers: [],
  teamLocked: false,
  teamSummary: null,
  teamMembers: [],
  teamInvitations: [],
  settings: {
    backendBaseUrl: 'https://audit-ads-backend.vibe1.tinhgon.xyz',
    userEmail: '',
    authErrorMessage: '',
    authSuccessMessage: '',
    hasCommunityQuota: false,
    communityTier: 'AGENCY',
    viasUsed: 0,
    maxVias: 500,
    adAccountsUsed: 0,
    maxAdAccounts: 500,
    useIsolatedProfiles: true,
    uriProtocolRegistered: false,
    autoStartEnabled: false,
    chromeProfileSummary: '',
    maskedBridgeToken: '••••••••',
    defaultBrowserEngine: 'chrome_native',
    antidetectApiBaseUrl: '',
    maxConcurrentBrowsers: 6,
    enableChromeAntidetectShield: true,
    lowRamFarmMode: true,
    autoScaleConcurrentByRam: true,
    autoFailoverToChromeNative: false,
    antidetectStatusMessage: '',
    antidetectProfilesCount: 0,
    maxViasPerProxyInBatch: 4,
    maxPagesPerProxyInBatch: 2,
    sameProxyMinStaggerSeconds: 55,
    autoKeepAliveScheduler: true,
    preCheckProxyBeforeLaunch: true,
    vaultSecretCount: 0,
    stewardshipRecordCount: 0,
    telegramActive: false,
    botConfigured: false,
    telegramDesc: '',
    telegramEnabled: false,
    notifyAdAccountDisabled: true,
    notifyBillingFailed: true,
    notifyPageRestricted: true,
    notifyRetainerOverspend: true,
    quietHoursRespect: false,
    telegramStatusMessage: '',
    telegramStatusOk: true,
    detectedTelegramChats: [],
    deviceSessions: [],
    signatureStatus: '',
    hasEmbeddedSignature: false,
    shaShort: '',
    updateStatusText: '',
    latestAvailableVersion: '',
    hasUpdateManifest: false,
    isNewerUpdate: false,
  },
}
