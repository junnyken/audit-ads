using System;
using System.Collections.Generic;
using System.Globalization;
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
    public string EnvViewport { get; set; } = "1440×900";
    public string EnvCountry { get; set; } = "VN";
    public string EnvLang { get; set; } = "vi-VN";
    public string EnvTimezone { get; set; } = "Asia/Ho_Chi_Minh";
    public bool WebRtcLocked { get; set; } = true;
    public string CustomTag { get; set; } = "";
    public string RecoveryEmail { get; set; } = "";
    public bool HasRecoveryMail { get; set; }
    public bool HasMailTwoFa { get; set; }
    public int UnusedBackupCodesCount { get; set; }
    public int PreBakeSessionsCount { get; set; }
    public int RequiredPreBakeSessions { get; set; } = 3;
    public int RecoveryReadinessScore { get; set; }
    public string IncubationStageKey { get; set; } = "standby_ready";
    public string IncubationStageLabel { get; set; } = "";
    public string AccountPlatform { get; set; } = "meta";
    public string GoogleAdsCustomerId { get; set; } = "";
}

public sealed class WebEmbryoFactoryConfigDto
{
    public bool Enabled { get; set; }
    public int SpawnIntervalDays { get; set; } = 3;
    public int RequiredSessions { get; set; } = 3;
    public int MaxPendingEmbryos { get; set; } = 3;
    public string ProxyPoolRaw { get; set; } = "";
    public int ProxyPoolValidCount { get; set; }
    public string DefaultClientGroup { get; set; } = "";
    public string CustomDomain { get; set; } = "";
    public string LastSpawnLocal { get; set; } = "Chưa tạo";
    public string NextSpawnHint { get; set; } = "";
    public int PreBakingCount { get; set; }
    public int ReadyToBornCount { get; set; }
    public bool IsSilentPreBakeRunning { get; set; }
}

public sealed class WebClientStandbyPoolRowDto
{
    public string ClientGroup { get; set; } = "Chung (Agency Pool)";
    public int ActivePrimaryCount { get; set; }
    public int StandbyReadyCount { get; set; }
    public int IncubatingCount { get; set; }
    public int MissingRecoveryMailCount { get; set; }
    public bool HasStandbyDeficit { get; set; }
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
    public bool EnablePrePageCreationWarmup { get; set; } = true;
    public int PrePageCreationWarmupSeconds { get; set; } = 35;
    public string CookieRobotUrls { get; set; } = "";
    public int CookieRobotUrlCount { get; set; }
    public int MaxSafeBatchNow { get; set; }
    public int DirectIpViaCount { get; set; }

    // Local Guard
    public bool AutoKeepAliveScheduler { get; set; } = true;
    public bool AutoDailyFullPipeline { get; set; }
    public bool AutoInvitePageFollowersOnWarmup { get; set; } = true;
    public int MaxPageFollowerInvitesPerRun { get; set; } = 25;
    public int TotalPageFollowerInvitesSent { get; set; }
    public bool AutoSilentInviteEnabled { get; set; }
    public int AutoSilentInviteIntervalMinutes { get; set; } = 60;
    public string LastAutoSilentInviteLocal { get; set; } = "Chưa chạy";
    public bool IsSilentInviteRunning { get; set; }
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

public sealed class WebCarePresetDto
{
    public string Key { get; set; } = "";
    public string Icon { get; set; } = "";
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public int RestMinSeconds { get; set; } = 20;
    public int RestMaxSeconds { get; set; } = 40;
    public List<string> Steps { get; set; } = new();
}

public sealed class WebPageNurtureConfigDto
{
    public string Mode { get; set; } = "alternate"; // "post" | "share" | "alternate"
    public string AssetsDir { get; set; } = "";
    public bool EnableImageHashJitter { get; set; } = true;
    public string ShareSourceUrls { get; set; } = "";
    public string CaptionSpintax { get; set; } = "";
    public int ShareSourceCount { get; set; }
    public int ImagesFoundCount { get; set; }
    public bool AutoSilentPageNurtureEnabled { get; set; }
    public int AutoSilentPageNurtureIntervalHours { get; set; } = 12;
    public string LastAutoSilentPageNurtureLocal { get; set; } = "Chưa chạy";
    public bool IsSilentPageNurtureRunning { get; set; }
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
    public int ShareCount { get; set; }
    public int LifecycleDay { get; set; } = 1;
    public string LifecycleLabel { get; set; } = "";
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
    public bool NotifyThreshold80 { get; set; } = true;
    public bool NotifySpendSpike { get; set; } = true;
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
    public bool UpdateRequired { get; set; }
    public string MinSupportedVersion { get; set; } = "";
    public bool HasPortableBackupPassphrase { get; set; }
    public string CustomAutoBackupFolder { get; set; } = "";
    public string EffectiveAutoBackupFolder { get; set; } = "";
    public List<VaultBackupFileInfoDto> AutoBackupFiles { get; set; } = new();
    public string PortableBackupStatusMessage { get; set; } = "";
    public string PortableBackupPreviewJson { get; set; } = "";
    public string LicenseStatus { get; set; } = "unlimited";
    public bool LicenseIsReadOnly { get; set; }
    public int? LicenseDaysRemaining { get; set; }
    public string LicenseExpiresAt { get; set; } = "";
    public int MaxDesktopDevices { get; set; } = 10;
    public int ActiveDesktopDevices { get; set; }
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
    public List<WebClientStandbyPoolRowDto> StandbyPoolMatrix { get; set; } = new();
    public WebEmbryoFactoryConfigDto EmbryoFactory { get; set; } = new();
    public Dictionary<string, LiveTotpItemDto> TotpMap { get; set; } = new();
    public List<WebOptionDto> ChromeProfiles { get; set; } = new();
    public List<WebOptionDto> SupportedEngines { get; set; } = new();
    public List<WebOptionDto> TeamMemberOptions { get; set; } = new();

    // Tab 3: Automation
    public WebAutomationConfigDto AutomationConfig { get; set; } = new();
    public List<WebWarmupActionDto> WarmupCatalog { get; set; } = new();
    public List<WebCarePresetDto> CarePresets { get; set; } = new();
    public List<WebOptionDto> NicheTemplates { get; set; } = new();
    public List<WebPlaybookDto> Playbooks { get; set; } = new();
    public string SelectedPlaybookId { get; set; } = "";
    public string PlaybookPlatformFilter { get; set; } = "all";
    public List<WebBrowserSessionDto> ActiveSessions { get; set; } = new();

    // Tab 4: Fanpage & BM
    public List<WebBmDto> Bms { get; set; } = new();
    public List<WebPixelDto> Pixels { get; set; } = new();
    public WebDomainSeoDto DomainSeo { get; set; } = new();
    public WebPageNurtureConfigDto PageNurture { get; set; } = new();
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

    // v4.2.0 Operational 7d Telemetry, Proxy Cluster Health & Early Financial Risks
    public WebOperationalTelemetryDto OperationalTelemetry { get; set; } = new();
}

public sealed class WebProxyClusterHealthDto
{
    public string ProxyKey { get; set; } = "";
    public bool IsDirectIp { get; set; }
    public int ViaCount { get; set; }
    public int LiveCount { get; set; }
    public int DeadCount { get; set; }
    public int IncidentCount7d { get; set; }
    public string Status { get; set; } = "HEALTHY";
    public string SampleViaLabels { get; set; } = "";
}

public sealed class WebEarlyAccountRiskDto
{
    public string AdAccountId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalAccountId { get; set; } = "";
    public string Platform { get; set; } = "meta";
    public string Kind { get; set; } = "billing_threshold_80";
    public string Severity { get; set; } = "warning";
    public double RatioPct { get; set; }
    public string CurrentText { get; set; } = "";
    public string ReferenceText { get; set; } = "";
    public string Currency { get; set; } = "VND";
    public string PaymentCard { get; set; } = "";
    public string Summary { get; set; } = "";
}

public sealed class WebOperationalTelemetryDto
{
    public int KeepAliveOk7d { get; set; }
    public int KeepAliveFail7d { get; set; }
    public double KeepAliveRatePct { get; set; } = -1;
    public int PageNurtureOk7d { get; set; }
    public int PageNurtureFallback7d { get; set; }
    public int PageNurtureFail7d { get; set; }
    public double PageNurtureRatePct { get; set; } = -1;
    public int TotalHealthyProxies { get; set; }
    public int TotalProblemProxies { get; set; }
    public int ThresholdWarningsCount { get; set; }
    public int SpendSpikesCount { get; set; }
    public List<WebProxyClusterHealthDto> ProxyClusters { get; set; } = new();
    public List<WebEarlyAccountRiskDto> EarlyAccountRisks { get; set; } = new();
}

public static class OperationalTelemetryCalculator
{
    private static bool TryParseDecimal(string? raw, out decimal value)
    {
        value = 0m;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var clean = raw.Trim().Replace(",", "");
        return decimal.TryParse(clean, NumberStyles.Any, CultureInfo.InvariantCulture, out value);
    }

    private static string FormatMoney(decimal amount, string currency)
    {
        var cur = (currency ?? "VND").Trim().ToUpperInvariant();
        if (cur == "VND") return $"{Math.Round(amount):N0} ₫";
        return $"{amount:N2} {cur}";
    }

    public static WebOperationalTelemetryDto Compute(
        IReadOnlyList<WebViaItemDto> vias,
        IReadOnlyList<StewardshipSafetyEventDto> localEvents,
        IReadOnlyList<ViaActivityLogDto> cloudLogs,
        IReadOnlyList<AdAccountItemDto> adAccounts,
        DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var cutoff = now.AddDays(-7);

        int kaOk = 0;
        int kaFail = 0;
        int pnOk = 0;
        int pnFallback = 0;
        int pnFail = 0;

        var incidentsByViaKey = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var deadProxyEvents7d = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void BumpViaIncident(string? viaId, string? viaLabel)
        {
            if (!string.IsNullOrWhiteSpace(viaId))
            {
                var k = viaId.Trim();
                incidentsByViaKey[k] = incidentsByViaKey.TryGetValue(k, out var cur) ? cur + 1 : 1;
            }
            if (!string.IsNullOrWhiteSpace(viaLabel))
            {
                var k = viaLabel.Trim();
                incidentsByViaKey[k] = incidentsByViaKey.TryGetValue(k, out var cur) ? cur + 1 : 1;
            }
        }

        foreach (var ev in localEvents)
        {
            if (DateTimeOffset.TryParse(ev.TimestampUtc, out var ts) && ts < cutoff) continue;
            var et = (ev.EventType ?? "").Trim().ToUpperInvariant();
            switch (et)
            {
                case "KEEPALIVE_OK":
                    kaOk++;
                    break;
                case "COOLDOWN_IP_LEAK":
                case "COOLDOWN_CHECKPOINT":
                case "IP_LEAK_BLOCKED":
                case "SAFETY_CHALLENGE":
                case "COOKIE_LOGGED_OUT":
                case "BROWSER_HANG_REAPED":
                    kaFail++;
                    BumpViaIncident(ev.ViaId, ev.ViaLabel);
                    break;
                case "PAGE_NURTURE_OK":
                    pnOk++;
                    break;
                case "PAGE_NURTURE_FALLBACK_OK":
                    pnOk++;
                    pnFallback++;
                    break;
                case "PAGE_NURTURE_FAIL":
                case "PAGE_NURTURE_NO_COOKIE":
                    pnFail++;
                    BumpViaIncident(ev.ViaId, ev.ViaLabel);
                    break;
                case "PROXY_CHECK_DEAD":
                    if (!string.IsNullOrWhiteSpace(ev.ViaLabel))
                        deadProxyEvents7d.Add(ev.ViaLabel.Trim());
                    break;
            }
        }

        // Supplement with Cloud logs if local event log has few/no cloud entries
        foreach (var cl in cloudLogs)
        {
            if (DateTimeOffset.TryParse(cl.CreatedAt, out var cts) && cts < cutoff) continue;
            var act = (cl.Action ?? "").Trim().ToLowerInvariant();
            if (act == "page.via_keepalive" && kaOk == 0) kaOk++;
            else if (act == "page.warmup_posted" && pnOk == 0) pnOk++;
            else if (act == "page.via_alert")
            {
                if (localEvents.All(e => !e.EventType.Equals("COOLDOWN_IP_LEAK", StringComparison.OrdinalIgnoreCase) && !e.EventType.Equals("COOLDOWN_CHECKPOINT", StringComparison.OrdinalIgnoreCase)))
                {
                    kaFail++;
                    BumpViaIncident(cl.ViaId, cl.ViaLabel);
                }
            }
        }

        var kaTotal = kaOk + kaFail;
        var pnTotal = pnOk + pnFail;
        double kaRate = kaTotal > 0 ? Math.Round((kaOk * 100.0) / kaTotal, 1) : -1;
        double pnRate = pnTotal > 0 ? Math.Round((pnOk * 100.0) / pnTotal, 1) : -1;

        var clusterDict = new Dictionary<string, (bool isDirect, int viaCnt, int liveCnt, int deadCnt, int inc7d, List<string> labels)>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in vias)
        {
            var rawHp = string.IsNullOrWhiteSpace(v.ProxyHostPort) ? "Direct IP (Mạng gốc)" : v.ProxyHostPort.Trim();
            var isDirect = string.IsNullOrWhiteSpace(v.ProxyHostPort);
            if (!clusterDict.TryGetValue(rawHp, out var b))
            {
                b = (isDirect, 0, 0, 0, 0, new List<string>());
            }
            b.viaCnt++;
            if (string.Equals(v.ProxyStatus, "LIVE", StringComparison.OrdinalIgnoreCase)) b.liveCnt++;
            else if (string.Equals(v.ProxyStatus, "DEAD", StringComparison.OrdinalIgnoreCase)) b.deadCnt++;

            int inc = 0;
            if (!string.IsNullOrWhiteSpace(v.ViaId) && incidentsByViaKey.TryGetValue(v.ViaId.Trim(), out var c1)) inc += c1;
            else if (!string.IsNullOrWhiteSpace(v.Label) && incidentsByViaKey.TryGetValue(v.Label.Trim(), out var c2)) inc += c2;
            b.inc7d += inc;

            if (b.labels.Count < 4 && !string.IsNullOrWhiteSpace(v.Label)) b.labels.Add(v.Label);
            clusterDict[rawHp] = b;
        }

        var clusters = new List<WebProxyClusterHealthDto>();
        int healthyProxies = 0;
        int problemProxies = 0;
        foreach (var kv in clusterDict)
        {
            var b = kv.Value;
            var status = (b.deadCnt > 0 || deadProxyEvents7d.Contains(kv.Key))
                ? "DEAD"
                : b.inc7d > 0
                ? "INCIDENT"
                : ((b.isDirect && b.viaCnt > 3) || (!b.isDirect && b.viaCnt > 4))
                ? "CROWDED"
                : "HEALTHY";

            if (status == "HEALTHY") healthyProxies++;
            else problemProxies++;

            clusters.Add(new WebProxyClusterHealthDto
            {
                ProxyKey = kv.Key,
                IsDirectIp = b.isDirect,
                ViaCount = b.viaCnt,
                LiveCount = b.liveCnt,
                DeadCount = b.deadCnt,
                IncidentCount7d = b.inc7d,
                Status = status,
                SampleViaLabels = string.Join(", ", b.labels),
            });
        }

        static int RankCluster(string s) => s switch { "DEAD" => 0, "INCIDENT" => 1, "CROWDED" => 2, _ => 3 };
        clusters = clusters
            .OrderBy(c => RankCluster(c.Status))
            .ThenByDescending(c => c.DeadCount + c.IncidentCount7d)
            .ThenByDescending(c => c.ViaCount)
            .ToList();

        var risks = new List<WebEarlyAccountRiskDto>();
        foreach (var acc in adAccounts)
        {
            var extId = (acc.ExternalAccountId ?? "").Trim();
            var isGoogle = extId.StartsWith("gads_", StringComparison.OrdinalIgnoreCase);
            var plat = isGoogle ? "google_ads" : "meta";
            var cur = string.IsNullOrWhiteSpace(acc.Currency) ? "VND" : acc.Currency.Trim().ToUpperInvariant();
            var noiseFloor = cur == "VND" ? 50000m : 5m;
            var card = acc.BillingMeta?.PaymentCardDisplay ?? "";

            var balText = AdAccountBillingMetaDto.AsOptionalString(acc.BillingMeta?.BalanceRaw) ?? acc.SpendPeriods?.BalanceText;
            var threshText = AdAccountBillingMetaDto.AsOptionalString(acc.BillingMeta?.BillingThresholdRaw);
            if (TryParseDecimal(balText, out var bal) && TryParseDecimal(threshText, out var thresh) && thresh > 0m && bal > 0m)
            {
                var pct = Math.Round((double)(bal / thresh * 100m), 1);
                if (pct >= 80.0)
                {
                    risks.Add(new WebEarlyAccountRiskDto
                    {
                        AdAccountId = acc.Id,
                        DisplayName = acc.DisplayName,
                        ExternalAccountId = extId,
                        Platform = plat,
                        Kind = "billing_threshold_80",
                        Severity = pct >= 95.0 ? "critical" : "warning",
                        RatioPct = pct,
                        CurrentText = FormatMoney(bal, cur),
                        ReferenceText = FormatMoney(thresh, cur),
                        Currency = cur,
                        PaymentCard = card,
                        Summary = $"Dư nợ đạt {pct:0.0}% ngưỡng thanh toán ({FormatMoney(bal, cur)} / {FormatMoney(thresh, cur)}).",
                    });
                }
            }

            if (!isGoogle && TryParseDecimal(acc.SpendPeriods?.AmountSpentText, out var spent) && TryParseDecimal(acc.SpendPeriods?.SpendCapText, out var cap) && cap > 0m && spent > 0m)
            {
                var pct = Math.Round((double)(spent / cap * 100m), 1);
                if (pct >= 85.0)
                {
                    risks.Add(new WebEarlyAccountRiskDto
                    {
                        AdAccountId = acc.Id,
                        DisplayName = acc.DisplayName,
                        ExternalAccountId = extId,
                        Platform = plat,
                        Kind = "spend_cap_85",
                        Severity = pct >= 97.0 ? "critical" : "warning",
                        RatioPct = pct,
                        CurrentText = FormatMoney(spent, cur),
                        ReferenceText = FormatMoney(cap, cur),
                        Currency = cur,
                        PaymentCard = card,
                        Summary = $"Chi tiêu đạt {pct:0.0}% Spend Cap ({FormatMoney(spent, cur)} / {FormatMoney(cap, cur)}).",
                    });
                }
            }

            if (TryParseDecimal(acc.SpendPeriods?.TodayText, out var todayAmt) && todayAmt > 0m)
            {
                var dailyLimText = AdAccountBillingMetaDto.AsOptionalString(acc.BillingMeta?.MetaDailyLimitRaw);
                bool spiked = false;
                if (TryParseDecimal(dailyLimText, out var dailyLim) && dailyLim > 0m && todayAmt >= dailyLim * 1.25m && (todayAmt - dailyLim) >= noiseFloor)
                {
                    var pct = Math.Round((double)(todayAmt / dailyLim * 100m), 1);
                    risks.Add(new WebEarlyAccountRiskDto
                    {
                        AdAccountId = acc.Id,
                        DisplayName = acc.DisplayName,
                        ExternalAccountId = extId,
                        Platform = plat,
                        Kind = "daily_spend_spike",
                        Severity = pct >= 180.0 ? "critical" : "warning",
                        RatioPct = pct,
                        CurrentText = FormatMoney(todayAmt, cur),
                        ReferenceText = FormatMoney(dailyLim, cur),
                        Currency = cur,
                        PaymentCard = card,
                        Summary = $"Chi tiêu hôm nay ({FormatMoney(todayAmt, cur)}) vượt {pct:0}% giới hạn ngày ({FormatMoney(dailyLim, cur)}).",
                    });
                    spiked = true;
                }

                if (!spiked && TryParseDecimal(acc.SpendPeriods?.Last7dText, out var last7dAmt) && last7dAmt > 0m)
                {
                    var priorTotal = Math.Max(0m, last7dAmt - todayAmt);
                    var avgPrior = priorTotal / 6m;
                    if (avgPrior > 0m && todayAmt >= avgPrior * 1.8m && (todayAmt - avgPrior) >= noiseFloor)
                    {
                        var mult = todayAmt / avgPrior;
                        var pct = Math.Round((double)(mult * 100m), 1);
                        risks.Add(new WebEarlyAccountRiskDto
                        {
                            AdAccountId = acc.Id,
                            DisplayName = acc.DisplayName,
                            ExternalAccountId = extId,
                            Platform = plat,
                            Kind = "daily_spend_spike",
                            Severity = mult >= 2.5m ? "critical" : "warning",
                            RatioPct = pct,
                            CurrentText = FormatMoney(todayAmt, cur),
                            ReferenceText = FormatMoney(avgPrior, cur),
                            Currency = cur,
                            PaymentCard = card,
                            Summary = $"Chi tiêu hôm nay đạt {FormatMoney(todayAmt, cur)} — gấp {mult:0.0}x TB ngày ({FormatMoney(avgPrior, cur)}).",
                        });
                    }
                }
            }
        }

        risks = risks
            .OrderBy(r => r.Severity == "critical" ? 0 : 1)
            .ThenByDescending(r => r.RatioPct)
            .ToList();

        return new WebOperationalTelemetryDto
        {
            KeepAliveOk7d = kaOk,
            KeepAliveFail7d = kaFail,
            KeepAliveRatePct = kaRate,
            PageNurtureOk7d = pnOk,
            PageNurtureFallback7d = pnFallback,
            PageNurtureFail7d = pnFail,
            PageNurtureRatePct = pnRate,
            TotalHealthyProxies = healthyProxies,
            TotalProblemProxies = problemProxies,
            ThresholdWarningsCount = risks.Count(r => r.Kind is "billing_threshold_80" or "spend_cap_85"),
            SpendSpikesCount = risks.Count(r => r.Kind == "daily_spend_spike"),
            ProxyClusters = clusters,
            EarlyAccountRisks = risks,
        };
    }
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

    private const int MaxAssetFiles = 4096;
    private const long MaxAssetSize = 32L * 1024 * 1024;
    private const long MaxAssetTotal = 128L * 1024 * 1024;

    private static void RejectReparsePath(string path)
    {
        for (var dir = new DirectoryInfo(path); dir != null; dir = dir.Parent)
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Web UI cache contains a reparse point.");
    }

    private static Dictionary<string, byte[]> ReadSafeAssets(byte[] zipBytes)
    {
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { ".html", ".js", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf" };
        using var archive = new ZipArchive(new MemoryStream(zipBytes, writable: false), ZipArchiveMode.Read);
        if (archive.Entries.Count == 0 || archive.Entries.Count > MaxAssetFiles)
            throw new InvalidDataException("Invalid asset count.");
        long total = 0;
        foreach (var entry in archive.Entries)
        {
            var name = entry.FullName;
            var parts = name.Split('/');
            // Reject directory records too: bundles must contain only nonempty regular files.
            if (name.Contains('\\') || name.Contains(':') || Path.IsPathRooted(name)
                || parts.Any(p => p.Length == 0 || p == "." || p == ".."
                    || p.EndsWith('.') || p.EndsWith(' ')
                    || System.Text.RegularExpressions.Regex.IsMatch(p, @"^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                    || p.Any(c => c < 32 || "<>\"|?*".Contains(c)))
                || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000
                || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0
                || !allowed.Contains(Path.GetExtension(name))
                || entry.Length <= 0 || entry.Length > MaxAssetSize
                || (total += entry.Length) > MaxAssetTotal || files.ContainsKey(name))
                throw new InvalidDataException("Unsafe Web UI asset.");
            using var input = entry.Open();
            using var output = new MemoryStream();
            var buffer = new byte[81920];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) != 0)
            {
                if (output.Length + read > entry.Length || output.Length + read > MaxAssetSize)
                    throw new InvalidDataException("Asset exceeds declared size.");
                output.Write(buffer, 0, read);
            }
            if (output.Length != entry.Length) throw new InvalidDataException("Incomplete asset.");
            files.Add(name, output.ToArray());
        }
        if (!files.ContainsKey("index.html") || files.Keys.Count(n => Path.GetFileName(n).Equals("index.html", StringComparison.OrdinalIgnoreCase)) != 1)
            throw new InvalidDataException("Expected single root index.html.");
        return files;
    }

    private static bool ValidateAssetCache(string root, Dictionary<string, byte[]> files)
    {
        RejectReparsePath(root);
        if (!Directory.Exists(root)) return false;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(pending.Pop()))
            {
                var attrs = File.GetAttributes(path);
                if ((attrs & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Linked cache asset.");
                var relative = Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
                if ((attrs & FileAttributes.Directory) != 0)
                {
                    if (!files.Keys.Any(n => n.StartsWith(relative + "/", StringComparison.OrdinalIgnoreCase))) return false;
                    pending.Push(path);
                    continue;
                }
                if (relative == ".ready") continue;
                if (!files.TryGetValue(relative, out var expected) || !seen.Add(relative)) return false;
                if (new FileInfo(path).Length != expected.Length) return false;
                using var stream = File.OpenRead(path);
                if (!SHA256.HashData(stream).SequenceEqual(SHA256.HashData(expected))) return false;
            }
        }
        return seen.Count == files.Count;
    }

    public static string EnsureExtractedAssets()
    {
        lock (ExtractLock)
        {
            var asm = Assembly.GetExecutingAssembly();
            var resName = asm.GetManifestResourceNames()
                .Single(n => n.EndsWith("webui_bundle.zip", StringComparison.OrdinalIgnoreCase));
            using var resource = asm.GetManifestResourceStream(resName)
                ?? throw new FileNotFoundException("Missing embedded Web UI.");
            if (resource.Length > MaxAssetTotal) throw new InvalidDataException("Bundle too large.");
            using var ms = new MemoryStream();
            resource.CopyTo(ms);
            var zipBytes = ms.ToArray();
            var files = ReadSafeAssets(zipBytes);
            var hash = Convert.ToHexString(SHA256.HashData(zipBytes)).ToLowerInvariant();
            var cacheRoot = Path.GetFullPath(Path.Combine(DesktopConfig.AppDataRoot, "WebUi"));
            var targetDir = Path.Combine(cacheRoot, hash);
            RejectReparsePath(cacheRoot);
            Directory.CreateDirectory(cacheRoot);
            if (ValidateAssetCache(targetDir, files)) return targetDir;

            // Preserve invalid cache and user data; publish a fresh verified sibling, no recursive deletion.
            var tempDir = Path.Combine(cacheRoot, hash + ".tmp-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);
            foreach (var asset in files)
            {
                var path = Path.GetFullPath(Path.Combine(tempDir, asset.Key));
                if (!path.StartsWith(tempDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Asset outside cache.");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                output.Write(asset.Value);
            }
            if (!ValidateAssetCache(tempDir, files)) throw new InvalidDataException("Cache verification failed.");
            File.WriteAllText(Path.Combine(tempDir, ".ready"), hash);
            var backup = targetDir + ".backup-" + Guid.NewGuid().ToString("N");
            RejectReparsePath(targetDir);
            var moved = false;
            var published = false;
            try
            {
                if (Directory.Exists(targetDir)) { Directory.Move(targetDir, backup); moved = true; }
                Directory.Move(tempDir, targetDir);
                published = true;
                if (!ValidateAssetCache(targetDir, files)) throw new InvalidDataException("Published cache invalid.");
            }
            catch
            {
                // Keep failed publication for diagnosis, restore previous directory if present.
                if (published && Directory.Exists(targetDir)) Directory.Move(targetDir, tempDir + ".failed");
                if (moved) Directory.Move(backup, targetDir);
                throw;
            }
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
