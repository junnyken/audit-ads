export type PaletteKey = 'obsidian' | 'emerald'

export type DesktopViewKey =
  | 'overview'
  | 'vias'
  | 'automation'
  | 'pages_bm'
  | 'ad_accounts'
  | 'health_tokens'
  | 'workspace_ops'
  | 'settings'

export interface WebOptionDto {
  value: string
  label: string
  hint?: string | null
}

export interface LiveTotpItemDto {
  valid: boolean
  code6: string
  formattedCode: string
  secondsRemaining: number
  justCopied: boolean
}

export interface WebViaRuntimeDto {
  isBrowserRunning: boolean
  activeRamMb: number
  activeCpuPercent: number
}

export interface WebNavBadgesDto {
  overview: string
  vias: string
  automation: string
  healthTokens: string
  workspaceOps: string
}

export interface OverviewKpiDto {
  totalVias: number
  cookieVaultCount: number
  dueKeepAliveCount: number
  twoFaReadyCount: number
  totalPages: number
  adsReadyPages: number
  totalFollowersInvited: number
  totalAdAccounts: number
  activeAdAccounts: number
  openAlertCount: number
  criticalHealthCount: number
  bridgePort: number
  bridgeOnline: boolean
  extVersion: string
  activeBrowsers: number
  liveProxyVias: number
  directIpVias: number
  nativeProfileReadyCount: number
  maxDirectIpPerBatch: number
}

export interface OverviewQueueDto {
  isActive: boolean
  phase: string
  kind: string
  checkingProxy: boolean
  currentIndex: number
  totalCount: number
  launchedCount: number
  skippedCount: number
  countdownSeconds: number
  summaryText: string
  detailText: string
  progressPercent: number
}

export interface OverviewWorkstationDto {
  availableRamMb: number
  totalRamMb: number
  freePercent: number
  recommendedConcurrent: number
  isLowRam: boolean
}

export interface OverviewAlertGroupDto {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  summary: string
  accountNames: string[]
  bmNames: string[]
  count: number
  alertIds: string[]
  firstAccountSearch: string
}

export interface OverviewActivityItemDto {
  id: string
  title: string
  detail: string
  createdAt: string
}

export interface WebViaItemDto {
  viaId: string
  label: string
  displayName: string
  externalReferenceId: string
  profileDir: string
  browserProfileLabel: string
  roleTier: string
  clientGroup: string
  defaultWarmupMode: string
  antidetectEngine: string
  antidetectEngineLabel: string
  antidetectProfileId: string
  networkLabel: string
  proxyHostPort: string
  proxyStatus: string
  proxyLatencyMs: number | null
  trustScore: number
  trustSummary: string
  warmupLabel: string
  warmupPhase: string
  idleDays: number
  hasVaultCookie: boolean
  hasTwoFa: boolean
  needsKeepAlive: boolean
  isInCooldown: boolean
  cooldownReason: string
  cooldownUntilLocal: string
  hasSiloConflict: boolean
  siloConflictDetail: string
  isBrowserRunning: boolean
  activeRamMb: number
  activeCpuPercent: number
  holdingPagesCount: number
  holdingLimit: number
  adAccountsCount: number
  ownerMemberId: string
  ownerMemberName: string
  canLaunch: boolean
  denyReason: string
  quotaStatus: string
  hasTimezoneMismatch: boolean
  timezoneWarning: string
  envViewport?: string
  envCountry?: string
  envLang?: string
  envTimezone?: string
  webRtcLocked?: boolean
  customTag?: string
  recoveryEmail?: string
  hasRecoveryMail?: boolean
  hasMailTwoFa?: boolean
  unusedBackupCodesCount?: number
  preBakeSessionsCount?: number
  requiredPreBakeSessions?: number
  recoveryReadinessScore?: number
  incubationStageKey?: string
  incubationStageLabel?: string
}

export interface WebEmbryoFactoryConfigDto {
  enabled: boolean
  spawnIntervalDays: number
  requiredSessions: number
  maxPendingEmbryos: number
  proxyPoolRaw: string
  proxyPoolValidCount: number
  defaultClientGroup: string
  customDomain: string
  lastSpawnLocal: string
  nextSpawnHint: string
  preBakingCount: number
  readyToBornCount: number
  isSilentPreBakeRunning: boolean
}

export interface WebClientStandbyPoolRowDto {
  clientGroup: string
  activePrimaryCount: number
  standbyReadyCount: number
  incubatingCount: number
  missingRecoveryMailCount: number
  hasStandbyDeficit: boolean
}

export interface WebWarmupActionDto {
  key: string
  icon: string
  shortTitle: string
  fullTitle: string
  durationHint: string
  category: string
  description: string
}

export interface WebPlaybookDto {
  id: string
  title: string
  platform: string
  description: string
  versionTag: string
  defaultStaggerSec: number
  jitterPct: number
  authorName: string
  avgRating: number | null
  ratingCount: number
  runCount: number
  myRating: number | null
  firstStepTarget: string
}

export interface WebBrowserSessionDto {
  sessionId: string
  pid: number | null
  viaLabel: string
  profileDir: string
  url: string
  startedAtLocal: string
  alive: boolean
  delegatedToSharedBroker: boolean
  statusText: string
}

export interface WebAutomationConfigDto {
  warmupFlowMode: string
  activeDisplaySequence: string[]
  customWarmupSequence: string[]
  enableInternalPageCrossWarmup: boolean
  enablePreAdsManagerWarmup: boolean
  preAdsWarmupSeconds: number
  autoLikeCommentsOnPageInvite: boolean
  autoTileWindowsOnBatch: boolean
  queueRestMinSeconds: number
  queueRestMaxSeconds: number
  flowSelectedViaId: string
  batchNicheKey: string
  batchOwnerBmId: string
  batchCount: number
  batchStaggerSec: number
  batchPrefix: string
  batchCustomNames: string
  batchAutoSubmit: boolean
  enablePrePageCreationWarmup?: boolean
  prePageCreationWarmupSeconds?: number
  cookieRobotUrls?: string
  cookieRobotUrlCount?: number
  maxSafeBatchNow: number
  directIpViaCount?: number
  autoKeepAliveScheduler: boolean
  autoDailyFullPipeline: boolean
  autoInvitePageFollowersOnWarmup: boolean
  maxPageFollowerInvitesPerRun: number
  totalPageFollowerInvitesSent: number
  autoSilentInviteEnabled?: boolean
  autoSilentInviteIntervalMinutes?: number
  lastAutoSilentInviteLocal?: string
  isSilentInviteRunning?: boolean
  autoDailyVaultBackup: boolean
  autoPilotScheduleTimesCsv: string
  preCheckProxyBeforeLaunch: boolean
  autoCloseKeepAliveTab: boolean
  autoCloseKeepAliveWindow: boolean
  autoKeepAliveStartHour: number
  autoKeepAliveEndHour: number
  maxViasPerProxyInBatch: number
  maxDirectIpViasInBatch: number
  enforceSoakQuarantine: boolean
  enforceClientSilo: boolean
  ipLeakKillSwitchEnabled: boolean
  autoRefreshCookieAfterKeepAlive: boolean
  defaultWarmupMode: string
  soakQuarantineHours: number
  autoCooldownHours: number
  useIsolatedProfiles: boolean
  effectiveMaxConcurrent: number
  browserHangTimeoutSeconds: number
  cronAutoMetaSync: boolean
  cronSyncIntervalMinutes: number
  cronAutoPageWarmup: boolean
  cronWarmupMinGapHours: number
  cronLastRunLocal: string
}

export interface WebBmDto {
  id: string
  name: string
  externalId: string
  status: string
}

export interface WebPixelDto {
  id: string
  name: string
  externalPixelId: string
  status: string
}

export interface WebSeoChecklistDto {
  key: string
  label: string
  ready: boolean
}

export interface WebDomainSeoDto {
  customDomain: string
  effectivePublicUrl: string
  checklist: WebSeoChecklistDto[]
}

export interface WebCarePresetDto {
  key: string
  icon: string
  title: string
  subtitle: string
  restMinSeconds: number
  restMaxSeconds: number
  steps: string[]
}

export interface WebPageNurtureConfigDto {
  mode: 'post' | 'share' | 'alternate' | string
  assetsDir: string
  enableImageHashJitter: boolean
  shareSourceUrls: string
  captionSpintax: string
  shareSourceCount: number
  imagesFoundCount: number
  autoSilentPageNurtureEnabled?: boolean
  autoSilentPageNurtureIntervalHours?: number
  lastAutoSilentPageNurtureLocal?: string
  isSilentPageNurtureRunning?: boolean
}

export interface WebFanpageDto {
  id: string
  name: string
  externalPageId: string
  category: string
  healthStatus: string
  isUnsyncedDraft: boolean
  adsReady: boolean
  soakRemainingHours: number
  followersCount: number | null
  pendingInviteCount: number | null
  warmupPostsCount: number
  shareCount?: number
  lifecycleDay?: number
  lifecycleLabel?: string
  ownerBmId: string
  ownerBmName: string
  linkedAdAccountCount: number
  selectedHolderTag: string
  effectiveHolderLabel: string
  url: string
  contagionRisk: string
  isRunningInvite: boolean
}

export interface WebSpendBucketDto {
  currency: string
  accountsIncluded: number
  todayText: string
  last7dText: string
  mtdText: string
}

export interface WebAdAccountDto {
  id: string
  displayName: string
  externalAccountId: string
  currency: string
  status: string
  isActive: boolean
  balanceText: string
  thresholdText: string
  dailyLimitText: string
  spendTodayText: string
  spend7dText: string
  bmName: string
  viaLabels: string
  paymentCard: string
}

export interface WebHealthKpiDto {
  critical: number
  warning: number
  attentionNeeded: number
  clearSignals: number
  totalActive: number
  staleData: number
  tokenConfiguredCount: number
  metaConnectionCount: number
  draftCount: number
  draftBlockingCount: number
}

export interface WebMetaConnectionDto {
  id: string
  label: string
  environment: string
  readerSource: string
  bmReference: string
  status: string
  tokenConfigured: boolean
  badgeLabel: string
  lastCheckedLocal: string
}

export interface WebAccountHealthRowDto {
  adAccountId: string
  displayName: string
  externalAccountId: string
  businessManagerName: string
  viaLabel: string
  healthStatus: string
  readinessStatus: string
  topReasonText: string
  openCriticalCount: number
  openWarningCount: number
  openAttentionCount: number
}

export interface WebCampaignDraftDto {
  id: string
  title: string
  accountName: string
  objective: string
  draftStatus: string
  openBlockingCount: number
  openWarningCount: number
}

export interface WebReadinessSummaryDto {
  operationallyReady: number
  readyWithWarnings: number
  notReady: number
  unknown: number
}

export interface WebReadinessGroupDto {
  message: string
  severity: string
  accountCount: number
}

export interface WebReadinessRowDto {
  adAccountId: string
  displayName: string
  externalAccountId: string
  status: string
  readinessStatus: string
  completedItemCount: number
  requiredItemCount: number
  reasonText: string
}

export interface WebAuditLogDto {
  id: string
  createdAtLocal: string
  action: string
  entityType: string
  entityId: string
  actorEmail: string
}

export interface WebRetainersSummaryDto {
  totalContracts: number
  daysRemainingInMonth: number
  totalCommittedVnd: number
  totalMtdSpendVnd: number
  totalUnpaidBalanceVnd: number
  totalSettlementMtdVnd: number
}

export interface WebRetainerDto {
  id: string
  contractCode: string
  clientName: string
  projectName: string
  billingCycle: string
  accountCount: number
  agencyFeePercent: number
  metaTaxPercent: number
  pacingStatus: string
  pacingPercent: number
  spendMtdVnd: number
  committedBudgetVnd: number
  totalBillableMtdVnd: number
  recommendedDailyVnd: number
}

export interface WebTeamSummaryDto {
  seatLimit: number | null
  activeMembers: number
  pendingInvitations: number
  planReference: string
}

export interface WebTeamMemberDto {
  id: string
  email: string
  fullName: string
  role: string
  status: string
  isSuspended: boolean
  canManage: boolean
  nextRole: string
  scopeDetail: string
}

export interface WebTeamInvitationDto {
  id: string
  emailNormalized: string
  invitedRole: string
  status: string
  tokenLastFour: string
  expiresAt: string
}

export interface WebTelegramChatDto {
  chatId: string
  label: string
}

export interface WebDeviceSessionDto {
  id: string
  title: string
  subtitle: string
  isCurrent: boolean
}

export interface WebSettingsDto {
  backendBaseUrl: string
  userEmail: string
  authErrorMessage: string
  authSuccessMessage: string
  hasCommunityQuota: boolean
  communityTier: string
  viasUsed: number
  maxVias: number
  adAccountsUsed: number
  maxAdAccounts: number
  useIsolatedProfiles: boolean
  uriProtocolRegistered: boolean
  autoStartEnabled: boolean
  chromeProfileSummary: string
  maskedBridgeToken: string
  defaultBrowserEngine: string
  antidetectApiBaseUrl: string
  maxConcurrentBrowsers: number
  enableChromeAntidetectShield: boolean
  lowRamFarmMode: boolean
  autoScaleConcurrentByRam: boolean
  autoFailoverToChromeNative: boolean
  antidetectStatusMessage: string
  antidetectProfilesCount: number
  maxViasPerProxyInBatch: number
  maxPagesPerProxyInBatch: number
  sameProxyMinStaggerSeconds: number
  autoKeepAliveScheduler: boolean
  preCheckProxyBeforeLaunch: boolean
  vaultSecretCount: number
  stewardshipRecordCount: number
  telegramActive: boolean
  botConfigured: boolean
  telegramDesc: string
  telegramEnabled: boolean
  notifyAdAccountDisabled: boolean
  notifyBillingFailed: boolean
  notifyPageRestricted: boolean
  notifyRetainerOverspend: boolean
  quietHoursRespect: boolean
  telegramStatusMessage: string
  telegramStatusOk: boolean
  detectedTelegramChats: WebTelegramChatDto[]
  deviceSessions: WebDeviceSessionDto[]
  signatureStatus: string
  hasEmbeddedSignature: boolean
  shaShort: string
  updateStatusText: string
  latestAvailableVersion: string
  hasUpdateManifest: boolean
  isNewerUpdate: boolean
}

export interface AppShellWebStateDto {
  type: 'full_state'
  appVersion: string
  extVersion: string
  activeView: DesktopViewKey
  palette: PaletteKey
  isLoggedIn: boolean
  hasLoadedOnce: boolean
  isBusy: boolean
  isAuthExpired: boolean
  isOfflineSnapshot: boolean
  offlineSnapshotAt: string
  errorBannerText: string
  userDisplay: string
  userEmail: string
  userRole: string
  workspaceDisplay: string
  lastSyncedAt: string
  autoDailyPipeline: boolean
  configRev: number
  isAutoInviteRunning: boolean
  activeAutoInvitePageId: string
  navBadges: WebNavBadgesDto
  kpi: OverviewKpiDto
  queue: OverviewQueueDto
  workstation: OverviewWorkstationDto
  groupedAlerts: OverviewAlertGroupDto[]
  cloudLogs: OverviewActivityItemDto[]
  runtimeLogs: string[]
  vias: WebViaItemDto[]
  standbyPoolMatrix?: WebClientStandbyPoolRowDto[]
  embryoFactory?: WebEmbryoFactoryConfigDto
  totpMap: Record<string, LiveTotpItemDto>
  chromeProfiles: WebOptionDto[]
  supportedEngines: WebOptionDto[]
  teamMemberOptions: WebOptionDto[]
  automationConfig: WebAutomationConfigDto
  warmupCatalog: WebWarmupActionDto[]
  carePresets?: WebCarePresetDto[]
  nicheTemplates: WebOptionDto[]
  playbooks: WebPlaybookDto[]
  selectedPlaybookId: string
  playbookPlatformFilter: string
  activeSessions: WebBrowserSessionDto[]
  bms: WebBmDto[]
  pixels: WebPixelDto[]
  domainSeo: WebDomainSeoDto
  pageNurture?: WebPageNurtureConfigDto
  fanpages: WebFanpageDto[]
  pageHolderOptions: WebOptionDto[]
  spendCurrencies: WebSpendBucketDto[]
  adAccounts: WebAdAccountDto[]
  adSearch?: string
  adFilter?: string
  healthKpi: WebHealthKpiDto
  metaConnections: WebMetaConnectionDto[]
  accountHealthRows: WebAccountHealthRowDto[]
  campaignDrafts: WebCampaignDraftDto[]
  readinessSummary: WebReadinessSummaryDto
  readinessGroups: WebReadinessGroupDto[]
  readinessRows: WebReadinessRowDto[]
  auditLogs: WebAuditLogDto[]
  retainersSummary: WebRetainersSummaryDto
  retainers: WebRetainerDto[]
  teamLocked: boolean
  teamSummary: WebTeamSummaryDto | null
  teamMembers: WebTeamMemberDto[]
  teamInvitations: WebTeamInvitationDto[]
  settings: WebSettingsDto
  liveRunner?: WebLiveRunnerStatusDto
}

export interface WebLiveRunnerStepDto {
  index: number
  key: string
  icon: string
  title: string
  durationSec: number
  status: 'done' | 'running' | 'pending' | string
}

export interface WebLiveRunnerStatusDto {
  isActive: boolean
  isPaused: boolean
  isCompleted: boolean
  viaId: string
  viaLabel: string
  profileDir: string
  engineModeLabel: string
  currentStepIndex: number
  totalSteps: number
  currentStepTitle: string
  stepDurationSec: number
  stepElapsedSec: number
  stepRemainingSec: number
  stepProgressPercent: number
  totalElapsedSec: number
  estimatedTotalSec: number
  estimatedRemainingSec: number
  overallProgressPercent: number
  steps: WebLiveRunnerStepDto[]
}

export interface AppShellLiveTickDto {
  type: 'live_tick'
  isBusy: boolean
  isAutoInviteRunning: boolean
  activeAutoInvitePageId: string
  errorBannerText: string
  isAuthExpired: boolean
  navBadges: WebNavBadgesDto
  kpi: OverviewKpiDto
  queue: OverviewQueueDto
  workstation: OverviewWorkstationDto
  totpMap: Record<string, LiveTotpItemDto>
  viaRuntimeMap: Record<string, WebViaRuntimeDto>
  activeSessions: WebBrowserSessionDto[]
  runtimeLogs: string[]
  liveRunner?: WebLiveRunnerStatusDto
}
