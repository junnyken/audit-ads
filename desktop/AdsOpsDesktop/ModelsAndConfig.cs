using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
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
    [JsonPropertyName("browser_profile_label")] public string BrowserProfileLabel { get; set; } = "";
    [JsonPropertyName("network_label")] public string NetworkLabel { get; set; } = "";
    [JsonPropertyName("vault_reference")] public string VaultReference { get; set; } = "";
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
}

public sealed class PagedPersonalAccountsDto
{
    [JsonPropertyName("items")] public List<PersonalAccountRefDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
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
    [JsonPropertyName("daily_limit")] public int DailyLimit { get; set; } = 1;
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
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "";
    [JsonPropertyName("page_name")] public string PageName { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
}

public sealed class FacebookPagesSummaryDto
{
    [JsonPropertyName("via_quotas")] public List<ViaQuotaDto> ViaQuotas { get; set; } = new();
    [JsonPropertyName("via_activity_logs")] public List<ViaActivityLogDto> ViaActivityLogs { get; set; } = new();
}

public sealed class ProxyCheckResultDto
{
    [JsonPropertyName("status")] public string Status { get; set; } = "UNKNOWN";
    [JsonPropertyName("normalized_key")] public string? NormalizedKey { get; set; }
    [JsonPropertyName("latency_ms")] public int? LatencyMs { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("telegram_notified")] public bool TelegramNotified { get; set; }
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

public sealed class ViaWorkspaceEntry
{
    public string ViaId { get; set; } = "";
    public string Label { get; set; } = "";
    public string BrowserProfileLabel { get; set; } = "";
    public string ProfileDir { get; set; } = "Default";
    public string NetworkLabel { get; set; } = "";
    public string TwoFaSecret { get; set; } = "";
    public string ViaTier { get; set; } = "camp";
    public string BackendTier { get; set; } = "standard_via";
    public int HoldingPagesCount { get; set; }
    public int CreatedTodayCount { get; set; }
    public int DailyLimit { get; set; } = 1;
    public string QuotaStatus { get; set; } = "SAFE";
    public double IdleDays { get; set; }
    public double KeepAliveIntervalDays { get; set; } = 3.0;
    public bool NeedsKeepAlive { get; set; }
    public string ExtensionFolder { get; set; } = "";
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
