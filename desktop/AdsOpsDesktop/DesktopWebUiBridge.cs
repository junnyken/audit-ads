using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace AdsOpsDesktop;

public sealed class OverviewKpiDto
{
    public int TotalVias { get; set; }
    public int CookieVaultCount { get; set; }
    public int DueKeepAliveCount { get; set; }
    public int TwoFaReadyCount { get; set; }
    public int TotalPages { get; set; }
    public int AdsReadyPages { get; set; }
    public int TotalFollowersInvited { get; set; }
    public int TotalAdAccounts { get; set; }
    public int ActiveAdAccounts { get; set; }
    public int OpenAlertCount { get; set; }
    public int CriticalHealthCount { get; set; }
    public int BridgePort { get; set; }
    public bool BridgeOnline { get; set; }
    public string ExtVersion { get; set; } = DesktopAppInfo.ExtVersion;
    public int ActiveBrowsers { get; set; }
    public int LiveProxyVias { get; set; }
    public int DirectIpVias { get; set; }
    public int NativeProfileReadyCount { get; set; }
    public int MaxDirectIpPerBatch { get; set; } = 3;
}

public sealed class OverviewQueueDto
{
    public bool IsActive { get; set; }
    public string Phase { get; set; } = "Idle";
    public string Kind { get; set; } = "KeepAlive";
    public bool CheckingProxy { get; set; }
    public int CurrentIndex { get; set; }
    public int TotalCount { get; set; }
    public int LaunchedCount { get; set; }
    public int SkippedCount { get; set; }
    public int CountdownSeconds { get; set; }
    public string SummaryText { get; set; } = "";
    public string DetailText { get; set; } = "";
    public int ProgressPercent { get; set; }
}

public sealed class OverviewWorkstationDto
{
    public ulong AvailableRamMb { get; set; }
    public ulong TotalRamMb { get; set; }
    public int FreePercent { get; set; }
    public int RecommendedConcurrent { get; set; }
    public bool IsLowRam { get; set; }
}

public sealed class OverviewAlertGroupDto
{
    public string Key { get; set; } = "";
    public string Severity { get; set; } = "warning";
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public List<string> AccountNames { get; set; } = new();
    public List<string> BmNames { get; set; } = new();
    public int Count { get; set; }
    public List<string> AlertIds { get; set; } = new();
    public string FirstAccountSearch { get; set; } = "";
}

public sealed class OverviewViaRowDto
{
    public string ViaId { get; set; } = "";
    public string Label { get; set; } = "";
    public string ProfileDir { get; set; } = "";
    public string RoleTier { get; set; } = "";
    public string ProxyStatus { get; set; } = "UNCHECKED";
    public string NetworkLabel { get; set; } = "";
    public int TrustScore { get; set; }
    public bool HasVaultCookie { get; set; }
    public bool HasTwoFa { get; set; }
    public bool NeedsKeepAlive { get; set; }
    public bool IsBrowserRunning { get; set; }
    public double ActiveRamMb { get; set; }
    public string QuotaStatus { get; set; } = "SAFE";
    public string WarmupLabel { get; set; } = "";
}

public sealed class OverviewFanpageRowDto
{
    public string PageId { get; set; } = "";
    public string Name { get; set; } = "";
    public int? FollowersCount { get; set; }
    public string HolderLabel { get; set; } = "";
    public int? PendingInviteCount { get; set; }
    public bool AdsReady { get; set; }
}

public sealed class OverviewActivityItemDto
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Detail { get; set; } = "";
    public string CreatedAt { get; set; } = "";
}

public sealed class OverviewWebStateDto
{
    public string AppVersion { get; set; } = DesktopAppInfo.Version;
    public string ExtVersion { get; set; } = DesktopAppInfo.ExtVersion;
    public string Palette { get; set; } = "obsidian";
    public bool IsLoggedIn { get; set; }
    public bool IsBusy { get; set; }
    public bool IsOfflineSnapshot { get; set; }
    public string OfflineSnapshotAt { get; set; } = "";
    public string UserDisplay { get; set; } = "";
    public string WorkspaceDisplay { get; set; } = "";
    public string LastSyncedAt { get; set; } = "—";
    public bool AutoDailyPipeline { get; set; }
    public OverviewKpiDto Kpi { get; set; } = new();
    public OverviewQueueDto Queue { get; set; } = new();
    public OverviewWorkstationDto Workstation { get; set; } = new();
    public List<OverviewAlertGroupDto> GroupedAlerts { get; set; } = new();
    public List<OverviewViaRowDto> Vias { get; set; } = new();
    public List<OverviewFanpageRowDto> Fanpages { get; set; } = new();
    public List<OverviewActivityItemDto> CloudLogs { get; set; } = new();
    public List<string> RuntimeLogs { get; set; } = new();
}

// ---------- Full 8-Tab shadcn/ui App Shell DTOs (v3.2.0) ----------

public sealed class WebOptionDto
{
    public string Value { get; set; } = "";
    public string Label { get; set; } = "";
    public string? Hint { get; set; }
}

public sealed class LiveTotpItemDto
{
    public bool Valid { get; set; }
    public string Code6 { get; set; } = "";
    public string FormattedCode { get; set; } = "Chưa gắn 2FA";
    public int SecondsRemaining { get; set; }
    public bool JustCopied { get; set; }
}

public sealed class WebViaRuntimeDto
{
    public bool IsBrowserRunning { get; set; }
    public double ActiveRamMb { get; set; }
    public double ActiveCpuPercent { get; set; }
}

public sealed class WebViaItemDto
{
    public string ViaId { get; set; } = "";
    public string Label { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalReferenceId { get; set; } = "";
    public string ProfileDir { get; set; } = "";
    public string BrowserProfileLabel { get; set; } = "";
    public string RoleTier { get; set; } = "camp";
    public string ClientGroup { get; set; } = "";
    public string DefaultWarmupMode { get; set; } = "human_organic";
    public string AntidetectEngine { get; set; } = "chrome_native";
    public string AntidetectEngineLabel { get; set; } = "Chrome Gốc (Native)";
    public string AntidetectProfileId { get; set; } = "";
    public string NetworkLabel { get; set; } = "";
    public string ProxyHostPort { get; set; } = "";
    public string ProxyStatus { get; set; } = "UNCHECKED";
    public int? ProxyLatencyMs { get; set; }
    public int TrustScore { get; set; } = 100;
    public string TrustSummary { get; set; } = "";
    public string WarmupLabel { get; set; } = "";
    public string WarmupPhase { get; set; } = "trusted";
    public double IdleDays { get; set; }
    public bool HasVaultCookie { get; set; }
    public bool HasTwoFa { get; set; }
    public bool NeedsKeepAlive { get; set; }
    public bool IsInCooldown { get; set; }
    public string CooldownReason { get; set; } = "";
    public string CooldownUntilLocal { get; set; } = "";
    public bool HasSiloConflict { get; set; }
    public string SiloConflictDetail { get; set; } = "";
    public bool IsBrowserRunning { get; set; }
    public double ActiveRamMb { get; set; }
    public double ActiveCpuPercent { get; set; }
    public int HoldingPagesCount { get; set; }
    public int HoldingLimit { get; set; } = 10;
    public int AdAccountsCount { get; set; }
    public string OwnerMemberId { get; set; } = "";
    public string OwnerMemberName { get; set; } = "";
    public bool CanLaunch { get; set; } = true;
    public string DenyReason { get; set; } = "";
    public string QuotaStatus { get; set; } = "SAFE";
    public bool HasTimezoneMismatch { get; set; }
    public string TimezoneWarning { get; set; } = "";
}

public sealed class WebWarmupActionDto
{
    public string Key { get; set; } = "";
    public string Icon { get; set; } = "";
    public string ShortTitle { get; set; } = "";
    public string FullTitle { get; set; } = "";
    public string DurationHint { get; set; } = "";
    public string Category { get; set; } = "";
    public string Description { get; set; } = "";
}

public sealed class WebPlaybookDto
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Platform { get; set; } = "meta";
    public string Description { get; set; } = "";
    public string VersionTag { get; set; } = "1.0.0";
    public int DefaultStaggerSec { get; set; } = 55;
    public int JitterPct { get; set; } = 35;
    public string AuthorName { get; set; } = "";
    public double? AvgRating { get; set; }
    public int RatingCount { get; set; }
    public int RunCount { get; set; }
    public int? MyRating { get; set; }
    public string FirstStepTarget { get; set; } = "https://www.facebook.com/";
}

public sealed class WebBrowserSessionDto
{
    public string SessionId { get; set; } = "";
    public int? Pid { get; set; }
    public string ViaLabel { get; set; } = "";
    public string ProfileDir { get; set; } = "";
    public string Url { get; set; } = "";
    public string StartedAtLocal { get; set; } = "";
    public bool Alive { get; set; }
    public bool DelegatedToSharedBroker { get; set; }
    public string StatusText { get; set; } = "";
}

public sealed class WebAutomationConfigDto
{
    public string WarmupFlowMode { get; set; } = "daily_random";
    public List<string> ActiveDisplaySequence { get; set; } = new();
    public List<string> CustomWarmupSequence { get; set; } = new();
    public bool EnableInternalPageCrossWarmup { get; set; } = true;
    public bool EnablePreAdsManagerWarmup { get; set; } = true;
    public int PreAdsWarmupSeconds { get; set; } = 20;
    public bool AutoLikeCommentsOnPageInvite { get; set; } = true;
    public bool AutoTileWindowsOnBatch { get; set; } = true;
    public int QueueRestMinSeconds { get; set; } = 15;
    public int QueueRestMaxSeconds { get; set; } = 32;
    public string FlowSelectedViaId { get; set; } = "__first__";

    // Batch Create Page
    public string BatchNicheKey { get; set; } = "beauty_spa";
    public string BatchOwnerBmId { get; set; } = "";
    public int BatchCount { get; set; } = 3;
    public int BatchStaggerSec { get; set; } = 65;
    public string BatchPrefix { get; set; } = "";
    public string BatchCustomNames { get; set; } = "";
    public bool BatchAutoSubmit { get; set; } = true;
    public int MaxSafeBatchNow { get; set; }

    // Local Guard
    public bool AutoKeepAliveScheduler { get; set; } = true;
    public bool AutoDailyFullPipeline { get; set; }
    public bool AutoInvitePageFollowersOnWarmup { get; set; } = true;
    public int MaxPageFollowerInvitesPerRun { get; set; } = 25;
    public int TotalPageFollowerInvitesSent { get; set; }
    public bool AutoDailyVaultBackup { get; set; } = true;
    public string AutoPilotScheduleTimesCsv { get; set; } = "08:30, 20:00";
    public bool PreCheckProxyBeforeLaunch { get; set; } = true;
    public bool AutoCloseKeepAliveTab { get; set; } = true;
    public bool AutoCloseKeepAliveWindow { get; set; } = true;
    public int AutoKeepAliveStartHour { get; set; } = 8;
    public int AutoKeepAliveEndHour { get; set; } = 22;
    public int MaxViasPerProxyInBatch { get; set; } = 4;
    public int MaxDirectIpViasInBatch { get; set; } = 3;

    // Anti-Checkpoint Shield
    public bool EnforceSoakQuarantine { get; set; } = true;
    public bool EnforceClientSilo { get; set; } = true;
    public bool IpLeakKillSwitchEnabled { get; set; } = true;
    public bool AutoRefreshCookieAfterKeepAlive { get; set; } = true;
    public string DefaultWarmupMode { get; set; } = "human_organic";
    public int SoakQuarantineHours { get; set; } = 72;
    public int AutoCooldownHours { get; set; } = 24;

    // Active Browser Tracker meta
    public bool UseIsolatedProfiles { get; set; } = true;
    public int EffectiveMaxConcurrent { get; set; } = 4;
    public int BrowserHangTimeoutSeconds { get; set; } = 210;

    // Cloud Cron
    public bool CronAutoMetaSync { get; set; }
    public int CronSyncIntervalMinutes { get; set; } = 60;
    public bool CronAutoPageWarmup { get; set; }
    public int CronWarmupMinGapHours { get; set; } = 8;
    public string CronLastRunLocal { get; set; } = "Chưa chạy";
}

public sealed class WebBmDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ExternalId { get; set; } = "";
    public string Status { get; set; } = "";
}

public sealed class WebPixelDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ExternalPixelId { get; set; } = "";
    public string Status { get; set; } = "";
}

public sealed class WebSeoChecklistDto
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public bool Ready { get; set; }
}

public sealed class WebDomainSeoDto
{
    public string CustomDomain { get; set; } = "";
    public string EffectivePublicUrl { get; set; } = "https://adsops-app.vibe.tinhgon.xyz";
    public List<WebSeoChecklistDto> Checklist { get; set; } = new();
}

public sealed class WebFanpageDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ExternalPageId { get; set; } = "";
    public string Category { get; set; } = "";
    public string HealthStatus { get; set; } = "LIVE";
    public bool IsUnsyncedDraft { get; set; }
    public bool AdsReady { get; set; }
    public double SoakRemainingHours { get; set; }
    public long? FollowersCount { get; set; }
    public int? PendingInviteCount { get; set; }
    public int WarmupPostsCount { get; set; }
    public string OwnerBmId { get; set; } = "";
    public string OwnerBmName { get; set; } = "";
    public int LinkedAdAccountCount { get; set; }
    public string SelectedHolderTag { get; set; } = "";
    public string EffectiveHolderLabel { get; set; } = "";
    public string Url { get; set; } = "";
    public string ContagionRisk { get; set; } = "SAFE";
    public bool IsRunningInvite { get; set; }
}

public sealed class WebSpendBucketDto
{
    public string Currency { get; set; } = "VND";
    public int AccountsIncluded { get; set; }
    public string TodayText { get; set; } = "—";
    public string Last7dText { get; set; } = "—";
    public string MtdText { get; set; } = "—";
}

public sealed class WebAdAccountDto
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalAccountId { get; set; } = "";
    public string Currency { get; set; } = "VND";
    public string Status { get; set; } = "";
    public bool IsActive { get; set; }
    public string BalanceText { get; set; } = "—";
    public string ThresholdText { get; set; } = "—";
    public string DailyLimitText { get; set; } = "—";
    public string SpendTodayText { get; set; } = "—";
    public string Spend7dText { get; set; } = "—";
    public string BmName { get; set; } = "";
    public string ViaLabels { get; set; } = "";
    public string PaymentCard { get; set; } = "";
}

public sealed class WebHealthKpiDto
{
    public int Critical { get; set; }
    public int Warning { get; set; }
    public int AttentionNeeded { get; set; }
    public int ClearSignals { get; set; }
    public int TotalActive { get; set; }
    public int StaleData { get; set; }
    public int TokenConfiguredCount { get; set; }
    public int MetaConnectionCount { get; set; }
    public int DraftCount { get; set; }
    public int DraftBlockingCount { get; set; }
}

public sealed class WebMetaConnectionDto
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string Environment { get; set; } = "";
    public string ReaderSource { get; set; } = "";
    public string BmReference { get; set; } = "";
    public string Status { get; set; } = "";
    public bool TokenConfigured { get; set; }
    public string BadgeLabel { get; set; } = "";
    public string LastCheckedLocal { get; set; } = "";
}

public sealed class WebAccountHealthRowDto
{
    public string AdAccountId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalAccountId { get; set; } = "";
    public string BusinessManagerName { get; set; } = "";
    public string ViaLabel { get; set; } = "";
    public string HealthStatus { get; set; } = "";
    public string ReadinessStatus { get; set; } = "";
    public string TopReasonText { get; set; } = "—";
    public int OpenCriticalCount { get; set; }
    public int OpenWarningCount { get; set; }
    public int OpenAttentionCount { get; set; }
}

public sealed class WebCampaignDraftDto
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string AccountName { get; set; } = "";
    public string Objective { get; set; } = "";
    public string DraftStatus { get; set; } = "DRAFT";
    public int OpenBlockingCount { get; set; }
    public int OpenWarningCount { get; set; }
}

public sealed class WebReadinessSummaryDto
{
    public int OperationallyReady { get; set; }
    public int ReadyWithWarnings { get; set; }
    public int NotReady { get; set; }
    public int Unknown { get; set; }
}

public sealed class WebReadinessGroupDto
{
    public string Message { get; set; } = "";
    public string Severity { get; set; } = "warning";
    public int AccountCount { get; set; }
}

public sealed class WebReadinessRowDto
{
    public string AdAccountId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalAccountId { get; set; } = "";
    public string Status { get; set; } = "";
    public string ReadinessStatus { get; set; } = "";
    public int CompletedItemCount { get; set; }
    public int RequiredItemCount { get; set; }
    public string ReasonText { get; set; } = "";
}

public sealed class WebAuditLogDto
{
    public string Id { get; set; } = "";
    public string CreatedAtLocal { get; set; } = "";
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string ActorEmail { get; set; } = "";
}

public sealed class WebRetainersSummaryDto
{
    public int TotalContracts { get; set; }
    public int DaysRemainingInMonth { get; set; }
    public long TotalCommittedVnd { get; set; }
    public long TotalMtdSpendVnd { get; set; }
    public long TotalUnpaidBalanceVnd { get; set; }
    public long TotalSettlementMtdVnd { get; set; }
}

public sealed class WebRetainerDto
{
    public string Id { get; set; } = "";
    public string ContractCode { get; set; } = "";
    public string ClientName { get; set; } = "";
    public string ProjectName { get; set; } = "";
    public string BillingCycle { get; set; } = "";
    public int AccountCount { get; set; }
    public double AgencyFeePercent { get; set; }
    public double MetaTaxPercent { get; set; }
    public string PacingStatus { get; set; } = "ON_TRACK";
    public double PacingPercent { get; set; }
    public long SpendMtdVnd { get; set; }
    public long CommittedBudgetVnd { get; set; }
    public long TotalBillableMtdVnd { get; set; }
    public long RecommendedDailyVnd { get; set; }
}

public sealed class WebTeamSummaryDto
{
    public int? SeatLimit { get; set; }
    public int ActiveMembers { get; set; }
    public int PendingInvitations { get; set; }
    public string PlanReference { get; set; } = "";
}

public sealed class WebTeamMemberDto
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Role { get; set; } = "";
    public string Status { get; set; } = "";
    public bool IsSuspended { get; set; }
    public bool CanManage { get; set; }
    public string NextRole { get; set; } = "operator";
    public string ScopeDetail { get; set; } = "";
}

public sealed class WebTeamInvitationDto
{
    public string Id { get; set; } = "";
    public string EmailNormalized { get; set; } = "";
    public string InvitedRole { get; set; } = "";
    public string Status { get; set; } = "";
    public string TokenLastFour { get; set; } = "";
    public string ExpiresAt { get; set; } = "";
}

public sealed class WebTelegramChatDto
{
    public string ChatId { get; set; } = "";
    public string Label { get; set; } = "";
}

public sealed class WebDeviceSessionDto
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public bool IsCurrent { get; set; }
}

public sealed class WebSettingsDto
{
    public string BackendBaseUrl { get; set; } = DesktopConfig.DefaultBackendUrl;
    public string UserEmail { get; set; } = "";
    public string AuthErrorMessage { get; set; } = "";
    public string AuthSuccessMessage { get; set; } = "";
    public bool HasCommunityQuota { get; set; }
    public string CommunityTier { get; set; } = "AGENCY";
    public int ViasUsed { get; set; }
    public int MaxVias { get; set; } = 500;
    public int AdAccountsUsed { get; set; }
    public int MaxAdAccounts { get; set; } = 500;
    public bool UseIsolatedProfiles { get; set; } = true;
    public bool UriProtocolRegistered { get; set; }
    public bool AutoStartEnabled { get; set; }
    public string ChromeProfileSummary { get; set; } = "";
    public string MaskedBridgeToken { get; set; } = "";
    public string DefaultBrowserEngine { get; set; } = "chrome_native";
    public string AntidetectApiBaseUrl { get; set; } = "";
    public int MaxConcurrentBrowsers { get; set; } = 6;
    public bool EnableChromeAntidetectShield { get; set; } = true;
    public bool LowRamFarmMode { get; set; } = true;
    public bool AutoScaleConcurrentByRam { get; set; } = true;
    public bool AutoFailoverToChromeNative { get; set; }
    public string AntidetectStatusMessage { get; set; } = "";
    public int AntidetectProfilesCount { get; set; }
    public int MaxViasPerProxyInBatch { get; set; } = 4;
    public int MaxPagesPerProxyInBatch { get; set; } = 2;
    public int SameProxyMinStaggerSeconds { get; set; } = 55;
    public bool AutoKeepAliveScheduler { get; set; } = true;
    public bool PreCheckProxyBeforeLaunch { get; set; } = true;
    public int VaultSecretCount { get; set; }
    public int StewardshipRecordCount { get; set; }
    public bool TelegramActive { get; set; }
    public bool BotConfigured { get; set; }
    public string TelegramDesc { get; set; } = "";
    public bool TelegramEnabled { get; set; }
    public bool NotifyAdAccountDisabled { get; set; } = true;
    public bool NotifyBillingFailed { get; set; } = true;
    public bool NotifyPageRestricted { get; set; } = true;
    public bool NotifyRetainerOverspend { get; set; } = true;
    public bool QuietHoursRespect { get; set; }
    public string TelegramStatusMessage { get; set; } = "";
    public bool TelegramStatusOk { get; set; }
    public List<WebTelegramChatDto> DetectedTelegramChats { get; set; } = new();
    public List<WebDeviceSessionDto> DeviceSessions { get; set; } = new();
    public string SignatureStatus { get; set; } = "";
    public bool HasEmbeddedSignature { get; set; }
    public string ShaShort { get; set; } = "";
    public string UpdateStatusText { get; set; } = "";
    public string LatestAvailableVersion { get; set; } = "";
    public bool HasUpdateManifest { get; set; }
    public bool IsNewerUpdate { get; set; }
}

public sealed class WebNavBadgesDto
{
    public string Overview { get; set; } = "";
    public string Vias { get; set; } = "";
    public string Automation { get; set; } = "";
    public string HealthTokens { get; set; } = "";
    public string WorkspaceOps { get; set; } = "";
}

public sealed class AppShellWebStateDto
{
    public string Type { get; set; } = "full_state";
    public string AppVersion { get; set; } = DesktopAppInfo.Version;
    public string ExtVersion { get; set; } = DesktopAppInfo.ExtVersion;
    public string ActiveView { get; set; } = "overview";
    public string Palette { get; set; } = "obsidian";
    public bool IsLoggedIn { get; set; }
    public bool HasLoadedOnce { get; set; }
    public bool IsBusy { get; set; }
    public bool IsAuthExpired { get; set; }
    public bool IsOfflineSnapshot { get; set; }
    public string OfflineSnapshotAt { get; set; } = "";
    public string ErrorBannerText { get; set; } = "";
    public string UserDisplay { get; set; } = "";
    public string UserEmail { get; set; } = "";
    public string UserRole { get; set; } = "";
    public string WorkspaceDisplay { get; set; } = "AdsOps Workspace";
    public string LastSyncedAt { get; set; } = "—";
    public bool AutoDailyPipeline { get; set; }
    public int ConfigRev { get; set; }
    public bool IsAutoInviteRunning { get; set; }
    public string ActiveAutoInvitePageId { get; set; } = "";

    public WebNavBadgesDto NavBadges { get; set; } = new();
    public OverviewKpiDto Kpi { get; set; } = new();
    public OverviewQueueDto Queue { get; set; } = new();
    public OverviewWorkstationDto Workstation { get; set; } = new();
    public List<OverviewAlertGroupDto> GroupedAlerts { get; set; } = new();
    public List<OverviewActivityItemDto> CloudLogs { get; set; } = new();
    public List<string> RuntimeLogs { get; set; } = new();

    // Tab 2: Multi-Via
    public List<WebViaItemDto> Vias { get; set; } = new();
    public Dictionary<string, LiveTotpItemDto> TotpMap { get; set; } = new();
    public List<WebOptionDto> ChromeProfiles { get; set; } = new();
    public List<WebOptionDto> SupportedEngines { get; set; } = new();
    public List<WebOptionDto> TeamMemberOptions { get; set; } = new();

    // Tab 3: Automation
    public WebAutomationConfigDto AutomationConfig { get; set; } = new();
    public List<WebWarmupActionDto> WarmupCatalog { get; set; } = new();
    public List<WebOptionDto> NicheTemplates { get; set; } = new();
    public List<WebPlaybookDto> Playbooks { get; set; } = new();
    public string SelectedPlaybookId { get; set; } = "";
    public string PlaybookPlatformFilter { get; set; } = "all";
    public List<WebBrowserSessionDto> ActiveSessions { get; set; } = new();

    // Tab 4: Fanpage & BM
    public List<WebBmDto> Bms { get; set; } = new();
    public List<WebPixelDto> Pixels { get; set; } = new();
    public WebDomainSeoDto DomainSeo { get; set; } = new();
    public List<WebFanpageDto> Fanpages { get; set; } = new();
    public List<WebOptionDto> PageHolderOptions { get; set; } = new();

    // Tab 5: Ad Accounts
    public List<WebSpendBucketDto> SpendCurrencies { get; set; } = new();
    public List<WebAdAccountDto> AdAccounts { get; set; } = new();
    public string AdSearch { get; set; } = "";
    public string AdFilter { get; set; } = "all";

    // Tab 6: Health & Tokens
    public WebHealthKpiDto HealthKpi { get; set; } = new();
    public List<WebMetaConnectionDto> MetaConnections { get; set; } = new();
    public List<WebAccountHealthRowDto> AccountHealthRows { get; set; } = new();
    public List<WebCampaignDraftDto> CampaignDrafts { get; set; } = new();
    public WebReadinessSummaryDto ReadinessSummary { get; set; } = new();
    public List<WebReadinessGroupDto> ReadinessGroups { get; set; } = new();
    public List<WebReadinessRowDto> ReadinessRows { get; set; } = new();
    public List<WebAuditLogDto> AuditLogs { get; set; } = new();

    // Tab 7: Workspace & Retainers
    public WebRetainersSummaryDto RetainersSummary { get; set; } = new();
    public List<WebRetainerDto> Retainers { get; set; } = new();
    public bool TeamLocked { get; set; }
    public WebTeamSummaryDto? TeamSummary { get; set; }
    public List<WebTeamMemberDto> TeamMembers { get; set; } = new();
    public List<WebTeamInvitationDto> TeamInvitations { get; set; } = new();

    // Tab 8: Settings & Vault
    public WebSettingsDto Settings { get; set; } = new();

    // Live Runner Step-by-Step Telemetry
    public WebLiveRunnerStatusDto LiveRunner { get; set; } = new();
}

public sealed class WebLiveRunnerStepDto
{
    public int Index { get; set; }
    public string Key { get; set; } = "";
    public string Icon { get; set; } = "⚡";
    public string Title { get; set; } = "";
    public int DurationSec { get; set; }
    public string Status { get; set; } = "pending";
}

public sealed class WebLiveRunnerStatusDto
{
    public bool IsActive { get; set; }
    public bool IsPaused { get; set; }
    public bool IsCompleted { get; set; }
    public string ViaId { get; set; } = "";
    public string ViaLabel { get; set; } = "";
    public string ProfileDir { get; set; } = "";
    public string EngineModeLabel { get; set; } = "0% chiếm chuột • Chạy ngầm";
    public int CurrentStepIndex { get; set; }
    public int TotalSteps { get; set; }
    public string CurrentStepTitle { get; set; } = "";
    public int StepDurationSec { get; set; }
    public int StepElapsedSec { get; set; }
    public int StepRemainingSec { get; set; }
    public int StepProgressPercent { get; set; }
    public int TotalElapsedSec { get; set; }
    public int EstimatedTotalSec { get; set; }
    public int EstimatedRemainingSec { get; set; }
    public int OverallProgressPercent { get; set; }
    public List<WebLiveRunnerStepDto> Steps { get; set; } = new();
}

public sealed class AppShellLiveTickDto
{
    public string Type { get; set; } = "live_tick";
    public bool IsBusy { get; set; }
    public bool IsAutoInviteRunning { get; set; }
    public string ActiveAutoInvitePageId { get; set; } = "";
    public string ErrorBannerText { get; set; } = "";
    public bool IsAuthExpired { get; set; }
    public WebNavBadgesDto NavBadges { get; set; } = new();
    public OverviewKpiDto Kpi { get; set; } = new();
    public OverviewQueueDto Queue { get; set; } = new();
    public OverviewWorkstationDto Workstation { get; set; } = new();
    public Dictionary<string, LiveTotpItemDto> TotpMap { get; set; } = new();
    public Dictionary<string, WebViaRuntimeDto> ViaRuntimeMap { get; set; } = new();
    public List<WebBrowserSessionDto> ActiveSessions { get; set; } = new();
    public List<string> RuntimeLogs { get; set; } = new();
    public WebLiveRunnerStatusDto LiveRunner { get; set; } = new();
}

/// <summary>
/// Giải nén bundle giao diện React + shadcn/ui được nhúng trong AdsOpsDesktop.exe và tuần tự hóa State sang WebView2.
/// </summary>
public static class DesktopWebUiBridge
{
    private static readonly JsonSerializerOptions CamelJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private static readonly object ExtractLock = new();

    public static string EnsureExtractedAssets()
    {
        lock (ExtractLock)
        {
            var asm = Assembly.GetExecutingAssembly();
            var resName = asm.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith("webui_bundle.zip", StringComparison.OrdinalIgnoreCase))
                ?? throw new FileNotFoundException("Không tìm thấy tài nguyên nhúng webui_bundle.zip.");

            byte[] zipBytes;
            using (var stream = asm.GetManifestResourceStream(resName)!)
            using (var ms = new MemoryStream())
            {
                stream.CopyTo(ms);
                zipBytes = ms.ToArray();
            }

            var hashBytes = SHA256.HashData(zipBytes);
            var hash12 = Convert.ToHexString(hashBytes)[..12].ToLowerInvariant();
            var targetDir = Path.Combine(DesktopConfig.AppDataRoot, "WebUi", hash12);
            var indexPath = Path.Combine(targetDir, "index.html");
            var markerPath = Path.Combine(targetDir, ".ready");

            if (File.Exists(indexPath) && File.Exists(markerPath))
            {
                return targetDir;
            }

            Directory.CreateDirectory(targetDir);
            using (var zipStream = new MemoryStream(zipBytes, writable: false))
            using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
            {
                archive.ExtractToDirectory(targetDir, overwriteFiles: true);
            }
            File.WriteAllText(markerPath, hash12);
            return targetDir;
        }
    }

    public static string BuildOverviewStateJson(OverviewWebStateDto state)
        => JsonSerializer.Serialize(state, CamelJsonOptions);

    public static string BuildShellStateJson(AppShellWebStateDto state)
        => JsonSerializer.Serialize(state, CamelJsonOptions);

    public static string BuildLiveTickJson(AppShellLiveTickDto tick)
        => JsonSerializer.Serialize(tick, CamelJsonOptions);
}
