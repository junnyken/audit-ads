using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Web;
using Microsoft.Win32;

namespace AdsOpsDesktop;

/// <summary>Native Windows DPAPI wrapper (crypt32.dll) with zero external NuGet packages.</summary>
public static class WindowsDpapi
{
    private const uint CryptprotectUiForbidden = 0x1;

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DataBlob pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static byte[] Protect(byte[] plainBytes)
    {
        if (plainBytes.Length == 0) return Array.Empty<byte>();
        var inPtr = Marshal.AllocHGlobal(plainBytes.Length);
        try
        {
            Marshal.Copy(plainBytes, 0, inPtr, plainBytes.Length);
            var inBlob = new DataBlob { cbData = plainBytes.Length, pbData = inPtr };
            if (!CryptProtectData(ref inBlob, "AdsOpsDesktop", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CryptprotectUiForbidden, out var outBlob))
            {
                throw new InvalidOperationException($"CryptProtectData failed: {Marshal.GetLastWin32Error()}");
            }
            try
            {
                var result = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
                return result;
            }
            finally
            {
                LocalFree(outBlob.pbData);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(inPtr);
        }
    }

    public static byte[] Unprotect(byte[] cipherBytes)
    {
        if (cipherBytes.Length == 0) return Array.Empty<byte>();
        var inPtr = Marshal.AllocHGlobal(cipherBytes.Length);
        try
        {
            Marshal.Copy(cipherBytes, 0, inPtr, cipherBytes.Length);
            var inBlob = new DataBlob { cbData = cipherBytes.Length, pbData = inPtr };
            if (!CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CryptprotectUiForbidden, out var outBlob))
            {
                throw new InvalidOperationException($"CryptUnprotectData failed: {Marshal.GetLastWin32Error()}");
            }
            try
            {
                var result = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
                return result;
            }
            finally
            {
                LocalFree(outBlob.pbData);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(inPtr);
        }
    }

    public static string ProtectString(string plainText)
    {
        if (string.IsNullOrEmpty(plainText)) return "";
        return Convert.ToBase64String(Protect(Encoding.UTF8.GetBytes(plainText)));
    }

    public static string UnprotectString(string base64Cipher)
    {
        if (string.IsNullOrWhiteSpace(base64Cipher)) return "";
        return Encoding.UTF8.GetString(Unprotect(Convert.FromBase64String(base64Cipher)));
    }
}

public sealed class DesktopConfig
{
    public const string DefaultBackendUrl = "https://audit-ads-backend.vibe1.tinhgon.xyz";
    public const string DefaultWebAppUrl = "https://adsops-app.vibe.tinhgon.xyz";

    public string BackendBaseUrl { get; set; } = DefaultBackendUrl;
    public string WebAppUrl { get; set; } = DefaultWebAppUrl;
    public string UserEmail { get; set; } = "";
    public string EncryptedJwtBase64 { get; set; } = "";
    public bool UseIsolatedProfiles { get; set; } = false;
    public bool AutoKeepAliveScheduler { get; set; } = true;
    public int BridgePort { get; set; } = 17890;

    // Automation Suite Preferences (v2.0)
    public int AutoKeepAliveStartHour { get; set; } = 8;
    public int AutoKeepAliveEndHour { get; set; } = 22;
    public int AutoKeepAliveMinGapMinutes { get; set; } = 20;
    public int DefaultStaggerSeconds { get; set; } = 65;
    public bool PreCheckProxyBeforeLaunch { get; set; } = true;
    public int MaxViasPerProxyInBatch { get; set; } = 2;
    public bool WarmupBeforeCreate { get; set; } = true;
    public bool AutoUploadMedia { get; set; } = true;
    public bool AutoCloseKeepAliveTab { get; set; } = true;

    [JsonIgnore]
    public string AccessToken
    {
        get
        {
            try { return WindowsDpapi.UnprotectString(EncryptedJwtBase64); }
            catch { return ""; }
        }
        set
        {
            EncryptedJwtBase64 = string.IsNullOrEmpty(value) ? "" : WindowsDpapi.ProtectString(value);
        }
    }

    public string GetJwt() => string.IsNullOrWhiteSpace(EncryptedJwtBase64) ? "" : WindowsDpapi.UnprotectString(EncryptedJwtBase64);

    public void SetJwt(string? jwt)
    {
        EncryptedJwtBase64 = string.IsNullOrWhiteSpace(jwt) ? "" : WindowsDpapi.ProtectString(jwt.Trim());
    }

    public static string AppDataRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AdsOpsDesktop");

    public static string ConfigFilePath => Path.Combine(AppDataRoot, "config.json");

    public static DesktopConfig Load(string? customPath = null)
    {
        var path = customPath ?? ConfigFilePath;
        try
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path, Encoding.UTF8);
                var cfg = JsonSerializer.Deserialize<DesktopConfig>(json);
                if (cfg != null)
                {
                    if (string.IsNullOrWhiteSpace(cfg.BackendBaseUrl)) cfg.BackendBaseUrl = DefaultBackendUrl;
                    if (string.IsNullOrWhiteSpace(cfg.WebAppUrl)) cfg.WebAppUrl = DefaultWebAppUrl;
                    if (cfg.BridgePort <= 0) cfg.BridgePort = 17890;
                    if (cfg.DefaultStaggerSeconds < 18) cfg.DefaultStaggerSeconds = 65;
                    if (cfg.MaxViasPerProxyInBatch < 1) cfg.MaxViasPerProxyInBatch = 2;
                    if (cfg.AutoKeepAliveMinGapMinutes < 5) cfg.AutoKeepAliveMinGapMinutes = 20;
                    return cfg;
                }
            }
        }
        catch
        {
            // Fall back to fresh defaults on corrupted config
        }
        return new DesktopConfig();
    }

    public void Save(string? customPath = null)
    {
        var path = customPath ?? ConfigFilePath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json, new UTF8Encoding(false));
    }
}

public sealed record ParsedViaNotes(string Tier, string WarmupStartIso, string CleanNotes);
public sealed record ViaWarmupStatus(int HoursElapsed, int DaysElapsed, string Phase, string Label, string Hint);

public static class ViaMetadataParser
{
    private static readonly Regex TierRegex = new(@"\[TIER:(vault|hold|camp|standby)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WarmupRegex = new(@"\[WARMUP:([0-9T:.\-]+Z?)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static ParsedViaNotes ParseNotes(string? notesRaw, string? label, int bmCount = 0, int adCount = 0)
    {
        var notes = notesRaw ?? "";
        var tm = TierRegex.Match(notes);
        var wm = WarmupRegex.Match(notes);

        var tier = "camp";
        if (tm.Success)
        {
            tier = tm.Groups[1].Value.ToLowerInvariant();
            if (tier == "hold") tier = "vault";
        }
        else
        {
            var lblLow = (label ?? "").ToLowerInvariant();
            if (bmCount >= 3 || lblLow.Contains("chính") || lblLow.Contains("tổng") || lblLow.Contains("xmdt"))
            {
                tier = "vault";
            }
            else if (adCount == 0 && (lblLow.Contains("mới") || lblLow.Contains("dự phòng") || lblLow.Contains("standby")))
            {
                tier = "standby";
            }
        }

        var warmupIso = wm.Success ? wm.Groups[1].Value : "";
        var clean = TierRegex.Replace(notes, "");
        clean = WarmupRegex.Replace(clean, "").Trim();
        return new ParsedViaNotes(tier, warmupIso, clean);
    }

    public static string BuildNotes(string? cleanNotes, string tier, string warmupStartIso)
    {
        var rawTier = (tier ?? "").Trim().ToLowerInvariant();
        var safeTier = rawTier switch
        {
            "vault" or "hold" => "vault",
            "standby" => "standby",
            _ => "camp",
        };
        var tags = new List<string> { $"[TIER:{safeTier}]" };
        if (!string.IsNullOrWhiteSpace(warmupStartIso))
        {
            tags.Add($"[WARMUP:{warmupStartIso.Trim()}]");
        }
        var prefix = string.Join(" ", tags);
        var tail = (cleanNotes ?? "").Trim();
        return string.IsNullOrEmpty(tail) ? prefix : $"{prefix} {tail}";
    }

    public static ViaWarmupStatus ComputeWarmupStatus(string? warmupStartIso, DateTimeOffset? now = null)
    {
        var refNow = now ?? DateTimeOffset.UtcNow;
        if (string.IsNullOrWhiteSpace(warmupStartIso) ||
            !DateTimeOffset.TryParse(warmupStartIso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsedStart))
        {
            return new ViaWarmupStatus(
                240,
                10,
                "trusted",
                "Đã Trust >7 ngày",
                "Via chưa gắn mốc ngâm mới — xem như thiết bị đã quen (có thể gắn lại mốc nếu mới login).");
        }

        var diff = refNow - parsedStart;
        if (diff < TimeSpan.Zero) diff = TimeSpan.Zero;
        var hours = (int)Math.Floor(diff.TotalHours);
        var days = (int)Math.Floor(diff.TotalDays);

        if (hours < 72)
        {
            return new ViaWarmupStatus(
                hours,
                days,
                "72h_lock",
                $"Ngâm 72h vàng ({hours}/72h)",
                "72h đầu: CẤM vào Ads Manager, CẤM đổi pass/2FA. Chỉ lướt Newsfeed thụ động.");
        }
        if (days < 7)
        {
            return new ViaWarmupStatus(
                hours,
                days,
                "7d_warmup",
                $"Ngâm ngày {days}/7",
                "Ngày 4–7: Nhận BM qua mail an toàn, hạn chế thao tác mạnh.");
        }
        return new ViaWarmupStatus(
            hours,
            days,
            "trusted",
            $"Đã Trust ({days} ngày)",
            "Thiết bị Chrome + IP đã quen, vận hành ổn định.");
    }
}

public sealed class LoginResponseDto
{
    [JsonPropertyName("access_token")] public string AccessToken { get; set; } = "";
    [JsonPropertyName("expires_at")] public string? ExpiresAt { get; set; }
}

public sealed class WorkspaceDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
}

public sealed class CurrentUserDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("email")] public string Email { get; set; } = "";
    [JsonPropertyName("full_name")] public string FullName { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("workspace")] public WorkspaceDto? Workspace { get; set; }
}

public sealed class PersonalAccountRefDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = "";
    [JsonPropertyName("external_reference_id")] public string? ExternalReferenceId { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "unknown";
    [JsonPropertyName("browser_profile_label")] public string BrowserProfileLabel { get; set; } = "";
    [JsonPropertyName("network_label")] public string NetworkLabel { get; set; } = "";
    [JsonPropertyName("vault_reference")] public string VaultReference { get; set; } = "";
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
}

public sealed class PagedPersonalAccountsDto
{
    [JsonPropertyName("items")] public List<PersonalAccountRefDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class PersonalAccountUpsertRequestDto
{
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = "";
    [JsonPropertyName("external_reference_id")] public string? ExternalReferenceId { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "active";
    [JsonPropertyName("browser_profile_label")] public string BrowserProfileLabel { get; set; } = "";
    [JsonPropertyName("network_label")] public string NetworkLabel { get; set; } = "";
    [JsonPropertyName("vault_reference")] public string VaultReference { get; set; } = "";
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
}

public sealed class BusinessManagerItemDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("external_id")] public string? ExternalId { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "unknown";
}

public sealed class PagedBusinessManagersDto
{
    [JsonPropertyName("items")] public List<BusinessManagerItemDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class AdAccountBillingMetaDto
{
    [JsonPropertyName("balance_raw")] public JsonElement? BalanceRaw { get; set; }
    [JsonPropertyName("billing_threshold_raw")] public JsonElement? BillingThresholdRaw { get; set; }
    [JsonPropertyName("next_bill_date")] public string? NextBillDate { get; set; }
    [JsonPropertyName("meta_daily_limit_raw")] public JsonElement? MetaDailyLimitRaw { get; set; }
    [JsonPropertyName("payment_card_display")] public string? PaymentCardDisplay { get; set; }
    [JsonPropertyName("business_legal_name")] public string? BusinessLegalName { get; set; }

    public static string? AsOptionalString(JsonElement? el)
    {
        if (!el.HasValue) return null;
        var v = el.Value;
        return v.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            _ => v.ToString(),
        };
    }
}

public sealed class AdAccountSpendPeriodsDto
{
    [JsonPropertyName("balance_raw")] public JsonElement? BalanceRaw { get; set; }
}

public sealed class AdAccountIdentityLinkDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("browser_profile_label")] public string BrowserProfileLabel { get; set; } = "";
}

public sealed class AdAccountItemDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = "";
    [JsonPropertyName("external_account_id")] public string ExternalAccountId { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("currency")] public string Currency { get; set; } = "VND";
    [JsonPropertyName("business_manager_name")] public string? BusinessManagerName { get; set; }
    [JsonPropertyName("billing_meta")] public AdAccountBillingMetaDto? BillingMeta { get; set; }
    [JsonPropertyName("spend_periods")] public AdAccountSpendPeriodsDto? SpendPeriods { get; set; }
    [JsonPropertyName("facebook_identities")] public List<AdAccountIdentityLinkDto> FacebookIdentities { get; set; } = new();
}

public sealed class PagedAdAccountsDto
{
    [JsonPropertyName("items")] public List<AdAccountItemDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class BundledExtensionAccountDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("external_account_id")] public string ExternalAccountId { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("currency")] public string Currency { get; set; } = "VND";
    [JsonPropertyName("balance_raw")] public string? BalanceRaw { get; set; }
    [JsonPropertyName("billing_threshold_raw")] public string? BillingThresholdRaw { get; set; }
    [JsonPropertyName("next_bill_date")] public string? NextBillDate { get; set; }
    [JsonPropertyName("meta_daily_limit_raw")] public string? MetaDailyLimitRaw { get; set; }
    [JsonPropertyName("payment_card_display")] public string? PaymentCardDisplay { get; set; }
    [JsonPropertyName("business_legal_name")] public string? BusinessLegalName { get; set; }
    [JsonPropertyName("bm_name")] public string? BmName { get; set; }

    public static BundledExtensionAccountDto FromApi(AdAccountItemDto a) => new()
    {
        Name = string.IsNullOrWhiteSpace(a.DisplayName) ? (string.IsNullOrWhiteSpace(a.ExternalAccountId) ? "TKQC" : a.ExternalAccountId) : a.DisplayName,
        ExternalAccountId = a.ExternalAccountId ?? "",
        Status = a.Status ?? "",
        Currency = string.IsNullOrWhiteSpace(a.Currency) ? "VND" : a.Currency,
        BalanceRaw = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BalanceRaw)
                     ?? AdAccountBillingMetaDto.AsOptionalString(a.SpendPeriods?.BalanceRaw),
        BillingThresholdRaw = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BillingThresholdRaw),
        NextBillDate = a.BillingMeta?.NextBillDate,
        MetaDailyLimitRaw = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.MetaDailyLimitRaw),
        PaymentCardDisplay = a.BillingMeta?.PaymentCardDisplay,
        BusinessLegalName = a.BillingMeta?.BusinessLegalName,
        BmName = a.BusinessManagerName,
    };
}

public sealed class FanpageItemDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("external_page_id")] public string? ExternalPageId { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("health_status")] public string HealthStatus { get; set; } = "LIVE";
    [JsonPropertyName("fan_count")] public long? FanCount { get; set; }
    [JsonPropertyName("followers_count")] public long? FollowersCount { get; set; }
    [JsonPropertyName("owner_bm_id")] public string? OwnerBmId { get; set; }
    [JsonPropertyName("owner_bm_name")] public string? OwnerBmName { get; set; }
    [JsonPropertyName("holder_identity_id")] public string? HolderIdentityId { get; set; }
    [JsonPropertyName("holder_label")] public string? HolderLabel { get; set; }
    [JsonPropertyName("holder_browser_profile")] public string HolderBrowserProfile { get; set; } = "";
    [JsonPropertyName("holder_network_label")] public string HolderNetworkLabel { get; set; } = "";
    [JsonPropertyName("linked_ad_account_count")] public int LinkedAdAccountCount { get; set; }
    [JsonPropertyName("restricted_ad_account_count")] public int RestrictedAdAccountCount { get; set; }
    [JsonPropertyName("contagion_risk")] public string ContagionRisk { get; set; } = "SAFE";
    [JsonPropertyName("warmup_posts_count")] public int WarmupPostsCount { get; set; }
    [JsonPropertyName("warmup_stage")] public string? WarmupStage { get; set; }
    [JsonPropertyName("is_unsynced_draft")] public bool IsUnsyncedDraft { get; set; }
    [JsonPropertyName("soak_remaining_hours")] public double SoakRemainingHours { get; set; }
    [JsonPropertyName("ads_ready")] public bool AdsReady { get; set; }
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
}

public sealed class FacebookPagesSummaryStatsDto
{
    [JsonPropertyName("total_pages")] public int TotalPages { get; set; }
    [JsonPropertyName("live_pages")] public int LivePages { get; set; }
    [JsonPropertyName("restricted_or_unpublished_pages")] public int RestrictedOrUnpublishedPages { get; set; }
    [JsonPropertyName("contagion_risk_pages")] public int ContagionRiskPages { get; set; }
    [JsonPropertyName("total_followers")] public long TotalFollowers { get; set; }
}

public sealed class QuotaAlertsSummaryDto
{
    [JsonPropertyName("total_vias")] public int TotalVias { get; set; }
    [JsonPropertyName("safe_vias_count")] public int SafeViasCount { get; set; }
    [JsonPropertyName("near_limit_vias_count")] public int NearLimitViasCount { get; set; }
    [JsonPropertyName("cooldown_vias_count")] public int CooldownViasCount { get; set; }
    [JsonPropertyName("limit_reached_vias_count")] public int LimitReachedViasCount { get; set; }
    [JsonPropertyName("max_safe_batch_now")] public int MaxSafeBatchNow { get; set; }
    [JsonPropertyName("ip_cluster_advisory")] public string? IpClusterAdvisory { get; set; }
}

public sealed class ViaQuotaDto
{
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "";
    [JsonPropertyName("network_label")] public string NetworkLabel { get; set; } = "";
    [JsonPropertyName("via_tier")] public string ViaTier { get; set; } = "standard_via";
    [JsonPropertyName("holding_pages_count")] public int HoldingPagesCount { get; set; }
    [JsonPropertyName("created_today_count")] public int CreatedTodayCount { get; set; }
    [JsonPropertyName("created_7d_count")] public int Created7dCount { get; set; }
    [JsonPropertyName("daily_limit")] public int DailyLimit { get; set; } = 1;
    [JsonPropertyName("weekly_limit")] public int WeeklyLimit { get; set; } = 4;
    [JsonPropertyName("holding_limit")] public int HoldingLimit { get; set; } = 10;
    [JsonPropertyName("cooldown_remaining_minutes")] public int CooldownRemainingMinutes { get; set; }
    [JsonPropertyName("quota_status")] public string QuotaStatus { get; set; } = "SAFE";
    [JsonPropertyName("idle_days")] public double IdleDays { get; set; }
    [JsonPropertyName("keepalive_interval_days")] public double KeepAliveIntervalDays { get; set; } = 3.0;
    [JsonPropertyName("needs_keepalive")] public bool NeedsKeepAlive { get; set; }
    [JsonPropertyName("last_keepalive_at")] public string? LastKeepAliveAt { get; set; }
    [JsonPropertyName("last_keepalive_route")] public string? LastKeepAliveRoute { get; set; }
}

public sealed class ViaActivityLogDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = "";
    [JsonPropertyName("action")] public string Action { get; set; } = "";
    [JsonPropertyName("action_label")] public string ActionLabel { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "";
    [JsonPropertyName("page_name")] public string PageName { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
}

public sealed class FacebookPagesSummaryDto
{
    [JsonPropertyName("items")] public List<FanpageItemDto> Items { get; set; } = new();
    [JsonPropertyName("summary")] public FacebookPagesSummaryStatsDto? Summary { get; set; }
    [JsonPropertyName("via_quotas")] public List<ViaQuotaDto> ViaQuotas { get; set; } = new();
    [JsonPropertyName("via_activity_logs")] public List<ViaActivityLogDto> ViaActivityLogs { get; set; } = new();
    [JsonPropertyName("quota_alerts_summary")] public QuotaAlertsSummaryDto? QuotaAlertsSummary { get; set; }
}

public sealed class ProxyCheckResultDto
{
    [JsonPropertyName("status")] public string Status { get; set; } = "UNKNOWN";
    [JsonPropertyName("normalized_key")] public string? NormalizedKey { get; set; }
    [JsonPropertyName("exit_ip")] public string? ExitIp { get; set; }
    [JsonPropertyName("country_code")] public string? CountryCode { get; set; }
    [JsonPropertyName("latency_ms")] public int? LatencyMs { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("telegram_notified")] public bool TelegramNotified { get; set; }
}

public sealed class ProxyBatchCheckResponseDto
{
    [JsonPropertyName("checked_count")] public int CheckedCount { get; set; }
    [JsonPropertyName("live_count")] public int LiveCount { get; set; }
    [JsonPropertyName("dead_count")] public int DeadCount { get; set; }
    [JsonPropertyName("results")] public List<ProxyCheckResultDto> Results { get; set; } = new();
    [JsonPropertyName("health_map")] public Dictionary<string, ProxyCheckResultDto> HealthMap { get; set; } = new();
}

public sealed class ViaBatchCreateRequestDto
{
    [JsonPropertyName("count")] public int Count { get; set; } = 3;
    [JsonPropertyName("niche_key")] public string NicheKey { get; set; } = "beauty_spa";
    [JsonPropertyName("brand_prefix")] public string BrandPrefix { get; set; } = "";
    [JsonPropertyName("custom_names")] public string CustomNames { get; set; } = "";
    [JsonPropertyName("owner_bm_id")] public string OwnerBmId { get; set; } = "";
    [JsonPropertyName("stagger_seconds")] public int StaggerSeconds { get; set; } = 60;
    [JsonPropertyName("auto_submit")] public bool AutoSubmit { get; set; } = true;
}

public sealed class BatchPageTaskDto
{
    [JsonPropertyName("page_id")] public string PageId { get; set; } = "";
    [JsonPropertyName("page_name")] public string PageName { get; set; } = "";
    [JsonPropertyName("category")] public string Category { get; set; } = "";
    [JsonPropertyName("bio_description")] public string BioDescription { get; set; } = "";
    [JsonPropertyName("warmup_post_text")] public string WarmupPostText { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "Default";
    [JsonPropertyName("network_label")] public string NetworkLabel { get; set; } = "";
    [JsonPropertyName("launch_url")] public string LaunchUrl { get; set; } = "";
    [JsonPropertyName("batch_index")] public int BatchIndex { get; set; }
    [JsonPropertyName("batch_size")] public int BatchSize { get; set; }
}

public sealed class ViaBatchCreateResponseDto
{
    [JsonPropertyName("created_count")] public int CreatedCount { get; set; }
    [JsonPropertyName("requested_count")] public int RequestedCount { get; set; }
    [JsonPropertyName("skipped_due_to_quota")] public int SkippedDueToQuota { get; set; }
    [JsonPropertyName("stagger_seconds")] public int StaggerSeconds { get; set; }
    [JsonPropertyName("quota_warning_message")] public string? QuotaWarningMessage { get; set; }
    [JsonPropertyName("batch_items")] public List<BatchPageTaskDto> BatchItems { get; set; } = new();
}

public sealed class SyncPagesResponseDto
{
    [JsonPropertyName("synced_count")] public int SyncedCount { get; set; }
    [JsonPropertyName("new_count")] public int NewCount { get; set; }
    [JsonPropertyName("linked_account_count")] public int LinkedAccountCount { get; set; }
    [JsonPropertyName("bm_claimed_count")] public int BmClaimedCount { get; set; }
}

public sealed class QuickSyncResponseDto
{
    [JsonPropertyName("ok")] public bool Ok { get; set; } = true;
    [JsonPropertyName("message")] public string? Message { get; set; }
}

public sealed class CheckPageLiveResponseDto
{
    [JsonPropertyName("probed_graph_api")] public bool ProbedGraphApi { get; set; }
    [JsonPropertyName("item")] public FanpageItemDto? Item { get; set; }
}

public sealed class ClaimPageResponseDto
{
    [JsonPropertyName("claimed")] public bool Claimed { get; set; }
    [JsonPropertyName("bm_name")] public string BmName { get; set; } = "";
    [JsonPropertyName("message")] public string Message { get; set; } = "";
}

public sealed class WarmupPostResponseDto
{
    [JsonPropertyName("delivery_mode")] public string DeliveryMode { get; set; } = "";
    [JsonPropertyName("item")] public FanpageItemDto? Item { get; set; }
}

public sealed class BatchWarmupResponseDto
{
    [JsonPropertyName("nurtured_count")] public int NurturedCount { get; set; }
    [JsonPropertyName("graph_published_count")] public int GraphPublishedCount { get; set; }
}

public sealed class AlertSummaryDto
{
    [JsonPropertyName("open_critical")] public int OpenCritical { get; set; }
    [JsonPropertyName("open_warning")] public int OpenWarning { get; set; }
    [JsonPropertyName("open_info")] public int OpenInfo { get; set; }
    [JsonPropertyName("acknowledged")] public int Acknowledged { get; set; }
    [JsonPropertyName("total_active")] public int TotalActive { get; set; }
    [JsonPropertyName("recipient_configured")] public bool RecipientConfigured { get; set; }
}

public sealed class AlertItemDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("severity")] public string Severity { get; set; } = "warning";
    [JsonPropertyName("status")] public string Status { get; set; } = "open";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("summary")] public string Summary { get; set; } = "";
    [JsonPropertyName("source_label")] public string? SourceLabel { get; set; }
    [JsonPropertyName("account_display_name")] public string? AccountDisplayName { get; set; }
    [JsonPropertyName("business_manager_name")] public string? BusinessManagerName { get; set; }
    [JsonPropertyName("last_observed_at")] public string? LastObservedAt { get; set; }
}

public sealed class PagedAlertsDto
{
    [JsonPropertyName("items")] public List<AlertItemDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class AutomationCronStatusDto
{
    [JsonPropertyName("auto_meta_sync_enabled")] public bool AutoMetaSyncEnabled { get; set; }
    [JsonPropertyName("sync_interval_minutes")] public int SyncIntervalMinutes { get; set; } = 60;
    [JsonPropertyName("auto_page_warmup_enabled")] public bool AutoPageWarmupEnabled { get; set; }
    [JsonPropertyName("warmup_min_gap_hours")] public int WarmupMinGapHours { get; set; } = 8;
    [JsonPropertyName("last_run_at")] public string? LastRunAt { get; set; }
}

public sealed class AutomationCronRunResponseDto
{
    [JsonPropertyName("status")] public AutomationCronStatusDto? Status { get; set; }
    [JsonPropertyName("run_summary")] public JsonElement? RunSummary { get; set; }
}

public sealed class TelegramTestSendResponseDto
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("message")] public string Message { get; set; } = "";
}

public sealed class BrowserEventPayloadDto
{
    [JsonPropertyName("event_type")] public string EventType { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "";
    [JsonPropertyName("page_id")] public string PageId { get; set; } = "";
    [JsonPropertyName("external_page_id")] public string ExternalPageId { get; set; } = "";
    [JsonPropertyName("page_name")] public string PageName { get; set; } = "";
    [JsonPropertyName("page_url")] public string PageUrl { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
    [JsonPropertyName("route_summary")] public string RouteSummary { get; set; } = "";
    [JsonPropertyName("duration_sec")] public int DurationSec { get; set; }
    [JsonPropertyName("via_tier")] public string ViaTier { get; set; } = "standard_via";
}

public sealed class BrowserEventResponseDto
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("event_type")] public string? EventType { get; set; }
    [JsonPropertyName("matched_page_id")] public string? MatchedPageId { get; set; }
    [JsonPropertyName("external_page_id")] public string? ExternalPageId { get; set; }
    [JsonPropertyName("auto_claimed_bm")] public bool AutoClaimedBm { get; set; }
    [JsonPropertyName("telegram_notified")] public bool TelegramNotified { get; set; }
}

public sealed record PageNicheTemplate(
    string Key,
    string Label,
    string DefaultCategory,
    string DefaultWarmupPost);

public static class PageNicheTemplates
{
    public static readonly IReadOnlyList<PageNicheTemplate> All = new[]
    {
        new PageNicheTemplate(
            "beauty_spa",
            "Mỹ phẩm & Spa Da liễu",
            "Sức khỏe / Sắc đẹp (Health & Beauty)",
            "✨ Bí quyết giữ làn da căng bóng, khỏe mạnh tự nhiên mỗi ngày chỉ với 3 bước làm sạch và cấp ẩm chuẩn khoa học tại nhà. 🌿💧 #ChamSocDa #LamDepAnToan"),
        new PageNicheTemplate(
            "fashion_store",
            "Thời trang & Phụ kiện",
            "Thương hiệu Quần áo (Clothing Brand)",
            "👗 Gợi ý phối đồ thanh lịch cho tuần làm việc mới tràn đầy năng lượng! Sự kết hợp giữa gam màu trung tính và phom dáng chuẩn giúp bạn tự tin hơn mỗi ngày. ✨ #ThoiTrangThietKe"),
        new PageNicheTemplate(
            "home_decor",
            "Nội thất & Gia dụng",
            "Cửa hàng Nội thất & Gia dụng (Home & Living)",
            "🏡 Một góc nhỏ bình yên trong ngôi nhà được bài trí gọn gàng với ánh sáng ấm áp sẽ giúp bạn tái tạo năng lượng sau ngày dài làm việc. 🌿🛋️ #KhongGianSong"),
        new PageNicheTemplate(
            "fnb_cuisine",
            "Ẩm thực & F&B",
            "Nhà hàng / Dịch vụ Ẩm thực (Restaurant & Cafe)",
            "🍲 Không gì tuyệt vời hơn bữa cơm sum vầy cùng gia đình với những món ăn nóng hổi, đậm đà hương vị truyền thống. 🥢🍃 #AmThucViet #MonNgonMoiNgay"),
        new PageNicheTemplate(
            "tech_saas",
            "Công nghệ & Giải pháp Số",
            "Công ty Công nghệ / Phần mềm (Information Technology)",
            "🚀 Chuyển đổi số bắt đầu từ việc chuẩn hóa quy trình làm việc hàng ngày. Tối ưu 30% thời gian vận hành giúp đội ngũ tập trung vào khách hàng tốt hơn! 💡📊"),
        new PageNicheTemplate(
            "real_estate",
            "Bất động sản & Đầu tư",
            "Dịch vụ Bất động sản (Real Estate Service)",
            "🏙️ 3 tiêu chí cốt lõi khi lựa chọn không gian an cư lâu dài: Pháp lý minh bạch, kết nối hạ tầng thuận tiện và hệ sinh thái tiện ích xanh nội khu. 🌳🏡"),
    };
}

public sealed class ViaWorkspaceEntry
{
    public string ViaId { get; set; } = "";
    public string Label { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string ExternalReferenceId { get; set; } = "";
    public string BrowserProfileLabel { get; set; } = "";
    public string ProfileDir { get; set; } = "Default";
    public string NetworkLabel { get; set; } = "";
    public string Notes { get; set; } = "";
    public string CleanNotes { get; set; } = "";
    public string RoleTier { get; set; } = "camp";
    public string WarmupStartIso { get; set; } = "";
    public string WarmupLabel { get; set; } = "";
    public string WarmupPhase { get; set; } = "trusted";
    public string TwoFaSecret { get; set; } = "";
    public string ViaTier { get; set; } = "camp";
    public string BackendTier { get; set; } = "standard_via";
    public int HoldingPagesCount { get; set; }
    public int HoldingLimit { get; set; } = 10;
    public int CreatedTodayCount { get; set; }
    public int Created7dCount { get; set; }
    public int DailyLimit { get; set; } = 1;
    public int CooldownRemainingMinutes { get; set; }
    public string QuotaStatus { get; set; } = "SAFE";
    public double IdleDays { get; set; }
    public double KeepAliveIntervalDays { get; set; } = 3.0;
    public bool NeedsKeepAlive { get; set; }
    public string ProxyLastStatus { get; set; } = "UNCHECKED";
    public int? ProxyLatencyMs { get; set; }
    public string? ProxyExitIp { get; set; }
    public string ExtensionFolder { get; set; } = "";
    public bool IsSelected { get; set; }
    public List<BundledExtensionAccountDto> BundledAccounts { get; set; } = new();
}

public sealed class LocalViaSecretRecord
{
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("profile_dir")] public string ProfileDir { get; set; } = "";
    [JsonPropertyName("protected_cookie_b64")] public string ProtectedCookieB64 { get; set; } = "";
    [JsonPropertyName("protected_twofa_b64")] public string ProtectedTwoFaB64 { get; set; } = "";
    [JsonPropertyName("updated_at_utc")] public string UpdatedAtUtc { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class PlainViaSecretBackupEntry
{
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("profile_dir")] public string ProfileDir { get; set; } = "";
    [JsonPropertyName("cookie_raw")] public string CookieRaw { get; set; } = "";
    [JsonPropertyName("two_fa_secret")] public string TwoFaSecret { get; set; } = "";
    [JsonPropertyName("updated_at_utc")] public string UpdatedAtUtc { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed record LocalVaultLookupResult(
    bool Found,
    string ViaId,
    string ViaLabel,
    string ProfileDir,
    string CookieRaw,
    string TwoFaSecret,
    string UpdatedAtUtc);

/// <summary>100% local DPAPI-encrypted store for per-Via Cookie &amp; 2FA secrets (never transmitted to Cloud API).</summary>
public sealed class LocalSecretVaultStore
{
    private static readonly Lazy<LocalSecretVaultStore> _default =
        new(() => new LocalSecretVaultStore(Path.Combine(DesktopConfig.AppDataRoot, "local_secrets_dpapi.json")));

    public static LocalSecretVaultStore Default => _default.Value;

    private readonly string _filePath;
    private readonly object _gate = new();
    private List<LocalViaSecretRecord> _records = new();

    public LocalSecretVaultStore(string filePath)
    {
        _filePath = filePath;
        LoadFromDisk();
    }

    private void LoadFromDisk()
    {
        lock (_gate)
        {
            try
            {
                if (File.Exists(_filePath))
                {
                    var txt = File.ReadAllText(_filePath, Encoding.UTF8);
                    _records = JsonSerializer.Deserialize<List<LocalViaSecretRecord>>(txt) ?? new();
                }
            }
            catch
            {
                _records = new();
            }
        }
    }

    private void SaveToDiskLocked()
    {
        var dir = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(_records, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_filePath, json, new UTF8Encoding(false));
    }

    private static string BuildCanonicalKey(string viaId, string profileDir, string viaLabel)
    {
        var id = (viaId ?? "").Trim();
        if (!string.IsNullOrEmpty(id)) return $"id:{id.ToLowerInvariant()}";
        var prof = (profileDir ?? "").Trim().ToLowerInvariant();
        var lbl = (viaLabel ?? "").Trim().ToLowerInvariant();
        return $"local:{prof}::{lbl}";
    }

    private LocalViaSecretRecord? FindRecordLocked(string? viaId, string? profileDir, string? viaLabel)
    {
        var id = (viaId ?? "").Trim();
        var prof = (profileDir ?? "").Trim();
        var lbl = (viaLabel ?? "").Trim();

        if (!string.IsNullOrEmpty(id))
        {
            var byId = _records.FirstOrDefault(r => string.Equals(r.ViaId, id, StringComparison.OrdinalIgnoreCase));
            if (byId != null) return byId;
        }
        if (!string.IsNullOrEmpty(prof) && !string.IsNullOrEmpty(lbl))
        {
            var exactBoth = _records.FirstOrDefault(r =>
                string.Equals(r.ProfileDir, prof, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(r.ViaLabel, lbl, StringComparison.OrdinalIgnoreCase));
            if (exactBoth != null) return exactBoth;
        }
        if (!string.IsNullOrEmpty(lbl))
        {
            var byLbl = _records.FirstOrDefault(r => string.Equals(r.ViaLabel, lbl, StringComparison.OrdinalIgnoreCase));
            if (byLbl != null) return byLbl;
        }
        if (!string.IsNullOrEmpty(prof))
        {
            var byProf = _records.Where(r => string.Equals(r.ProfileDir, prof, StringComparison.OrdinalIgnoreCase)).ToList();
            if (byProf.Count == 1) return byProf[0];
        }
        return null;
    }

    private static string SafeUnprotect(string cipherB64)
    {
        if (string.IsNullOrWhiteSpace(cipherB64)) return "";
        try { return WindowsDpapi.UnprotectString(cipherB64); }
        catch { return ""; }
    }

    public LocalVaultLookupResult Upsert(
        string? viaId,
        string? viaLabel,
        string? profileDir,
        string? cookieRaw,
        string? twoFaSecret,
        bool allowOverwriteEmpty = false)
    {
        var cleanId = (viaId ?? "").Trim();
        var cleanLbl = (viaLabel ?? "").Trim();
        var cleanProf = (profileDir ?? "").Trim();
        var cleanCk = (cookieRaw ?? "").Trim();
        var clean2Fa = new string((twoFaSecret ?? "").Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();

        lock (_gate)
        {
            var rec = FindRecordLocked(cleanId, cleanProf, cleanLbl);
            if (rec == null)
            {
                rec = new LocalViaSecretRecord
                {
                    Key = BuildCanonicalKey(cleanId, cleanProf, cleanLbl),
                    ViaId = cleanId,
                    ViaLabel = cleanLbl,
                    ProfileDir = cleanProf,
                };
                _records.Add(rec);
            }
            if (!string.IsNullOrEmpty(cleanId)) rec.ViaId = cleanId;
            if (!string.IsNullOrEmpty(cleanLbl)) rec.ViaLabel = cleanLbl;
            if (!string.IsNullOrEmpty(cleanProf)) rec.ProfileDir = cleanProf;

            if (allowOverwriteEmpty || !string.IsNullOrEmpty(cleanCk))
            {
                rec.ProtectedCookieB64 = string.IsNullOrEmpty(cleanCk) ? "" : WindowsDpapi.ProtectString(cleanCk);
            }
            if (allowOverwriteEmpty || !string.IsNullOrEmpty(clean2Fa))
            {
                rec.ProtectedTwoFaB64 = string.IsNullOrEmpty(clean2Fa) ? "" : WindowsDpapi.ProtectString(clean2Fa);
            }
            rec.UpdatedAtUtc = DateTime.UtcNow.ToString("O");
            SaveToDiskLocked();

            return new LocalVaultLookupResult(
                true,
                rec.ViaId,
                rec.ViaLabel,
                rec.ProfileDir,
                SafeUnprotect(rec.ProtectedCookieB64),
                SafeUnprotect(rec.ProtectedTwoFaB64),
                rec.UpdatedAtUtc);
        }
    }

    public LocalVaultLookupResult Find(string? viaId, string? profileDir, string? viaLabel)
    {
        lock (_gate)
        {
            var rec = FindRecordLocked(viaId, profileDir, viaLabel);
            if (rec == null)
            {
                return new LocalVaultLookupResult(false, "", "", "", "", "", "");
            }
            var ck = SafeUnprotect(rec.ProtectedCookieB64);
            var tfa = SafeUnprotect(rec.ProtectedTwoFaB64);
            var hasData = !string.IsNullOrEmpty(ck) || !string.IsNullOrEmpty(tfa);
            return new LocalVaultLookupResult(hasData, rec.ViaId, rec.ViaLabel, rec.ProfileDir, ck, tfa, rec.UpdatedAtUtc);
        }
    }

    public List<PlainViaSecretBackupEntry> ExportPlainEntries()
    {
        lock (_gate)
        {
            return _records.Select(r => new PlainViaSecretBackupEntry
            {
                ViaId = r.ViaId,
                ViaLabel = r.ViaLabel,
                ProfileDir = r.ProfileDir,
                CookieRaw = SafeUnprotect(r.ProtectedCookieB64),
                TwoFaSecret = SafeUnprotect(r.ProtectedTwoFaB64),
                UpdatedAtUtc = r.UpdatedAtUtc,
            })
            .Where(e => !string.IsNullOrEmpty(e.CookieRaw) || !string.IsNullOrEmpty(e.TwoFaSecret))
            .ToList();
        }
    }

    public int ImportPlainEntries(IEnumerable<PlainViaSecretBackupEntry>? entries)
    {
        if (entries == null) return 0;
        int imported = 0;
        foreach (var e in entries)
        {
            if (string.IsNullOrEmpty(e.CookieRaw) && string.IsNullOrEmpty(e.TwoFaSecret)) continue;
            Upsert(e.ViaId, e.ViaLabel, e.ProfileDir, e.CookieRaw, e.TwoFaSecret, allowOverwriteEmpty: false);
            imported++;
        }
        return imported;
    }
}

public sealed class ParsedAdsOpsUri
{
    public string Profile { get; init; } = "Default";
    public string Name { get; init; } = "";
    public string Proxy { get; init; } = "";
    public string Url { get; init; } = "";
}

public static class ProtocolRegistrar
{
    private const string UriKeyPath = @"Software\Classes\adsops-chrome";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "AdsOpsDesktopPro";

    public static bool IsUriProtocolRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(UriKeyPath + @"\shell\open\command");
            var cmd = key?.GetValue(null) as string ?? "";
            return cmd.Contains("AdsOpsDesktop", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static void RegisterUriProtocol(string? exePath = null)
    {
        var exe = exePath ?? Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName ?? "";
        if (string.IsNullOrWhiteSpace(exe)) throw new InvalidOperationException("Không xác định được đường dẫn AdsOpsDesktop.exe.");

        using var root = Registry.CurrentUser.CreateSubKey(UriKeyPath);
        root.SetValue(null, "URL:AdsOps Chrome Profile Launcher");
        root.SetValue("URL Protocol", "");

        using var icon = root.CreateSubKey("DefaultIcon");
        icon.SetValue(null, $"\"{exe}\",0");

        using var cmd = root.CreateSubKey(@"shell\open\command");
        cmd.SetValue(null, $"\"{exe}\" --uri \"%1\"");
    }

    public static bool IsAutoStartEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            var val = key?.GetValue(RunValueName) as string ?? "";
            return !string.IsNullOrWhiteSpace(val);
        }
        catch { return false; }
    }

    public static void SetAutoStart(bool enabled, string? exePath = null)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
        if (!enabled)
        {
            key.DeleteValue(RunValueName, throwOnMissingValue: false);
            return;
        }
        var exe = exePath ?? Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName ?? "";
        key.SetValue(RunValueName, $"\"{exe}\" --minimized");
    }

    public static bool TryParseAdsOpsUri(string rawUri, out ParsedAdsOpsUri parsed)
    {
        parsed = new ParsedAdsOpsUri();
        if (string.IsNullOrWhiteSpace(rawUri)) return false;
        if (!Uri.TryCreate(rawUri.Trim(), UriKind.Absolute, out var uri)) return false;
        if (!string.Equals(uri.Scheme, "adsops-chrome", StringComparison.OrdinalIgnoreCase)) return false;

        var qs = HttpUtility.ParseQueryString(uri.Query);
        var url = (qs["url"] ?? "").Trim();
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return false;

        var prof = (qs["profile"] ?? "Default").Trim();
        if (string.IsNullOrWhiteSpace(prof)) prof = "Default";
        parsed = new ParsedAdsOpsUri
        {
            Profile = prof,
            Name = (qs["name"] ?? "").Trim(),
            Proxy = (qs["proxy"] ?? "").Trim(),
            Url = url,
        };
        return true;
    }
}
