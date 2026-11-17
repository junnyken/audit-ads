using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
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
    public const int CurrentMigrationVersion = 302;
    internal static string? AppDataRootOverride { get; set; }

    public string BackendBaseUrl { get; set; } = DefaultBackendUrl;
    public string WebAppUrl { get; set; } = DefaultWebAppUrl;
    public string UserEmail { get; set; } = "";
    public string EncryptedJwtBase64 { get; set; } = "";
    public string EncryptedPasswordBase64 { get; set; } = "";
    public bool UseIsolatedProfiles { get; set; } = true;
    public bool AutoKeepAliveScheduler { get; set; } = true;
    public int BridgePort { get; set; } = 17890;

    // Automation Suite Preferences (v2.0 -> v2.6.1 Anti-Checkpoint)
    public int AutoKeepAliveStartHour { get; set; } = 8;
    public int AutoKeepAliveEndHour { get; set; } = 22;
    public int AutoKeepAliveMinGapMinutes { get; set; } = 20;
    public int DefaultStaggerSeconds { get; set; } = 65;
    public bool PreCheckProxyBeforeLaunch { get; set; } = true;
    public int MaxViasPerProxyInBatch { get; set; } = 4;
    public int MaxDirectIpViasInBatch { get; set; } = 3;
    public int MaxPagesPerProxyInBatch { get; set; } = 2;
    public int SameProxyMinStaggerSeconds { get; set; } = 55;
    public int BrowserHangTimeoutSeconds { get; set; } = 210;
    public bool WarmupBeforeCreate { get; set; } = true;
    public bool AutoUploadMedia { get; set; } = true;
    public bool AutoCloseKeepAliveTab { get; set; } = true;
    public bool AutoCloseKeepAliveWindow { get; set; } = true;
    public bool EnforceSoakQuarantine { get; set; } = true;
    public int SoakQuarantineHours { get; set; } = 72;
    public bool EnforceClientSilo { get; set; } = true;
    public int AutoCooldownHours { get; set; } = 24;
    public string DefaultWarmupMode { get; set; } = "human_organic";
    public bool AutoRefreshCookieAfterKeepAlive { get; set; } = true;
    public bool IpLeakKillSwitchEnabled { get; set; } = true;
    public int ConfigMigrationVersion { get; set; } = 0;

    // v2.5.0 Zero-Trust Bridge Token + 5-Engine Antidetect + Performance Farm Controls
    public string EncryptedBridgeTokenBase64 { get; set; } = "";
    public string DefaultBrowserEngine { get; set; } = "chrome_native";
    public string AntidetectApiBaseUrl { get; set; } = "";
    public string EncryptedAntidetectApiKeyBase64 { get; set; } = "";
    public bool EnableChromeAntidetectShield { get; set; } = true;
    public bool LowRamFarmMode { get; set; } = true;
    public int MaxConcurrentBrowsers { get; set; } = 6;
    // v2.6.0 Workstation RAM Auto-Cap & Auto-Failover
    public bool AutoScaleConcurrentByRam { get; set; } = true;
    public bool AutoFailoverToChromeNative { get; set; } = false;
    // v2.6.4 Daily 5-Step Auto-Pilot Pipeline
    public bool AutoDailyFullPipeline { get; set; } = false;
    public string LastAutoPipelineDateLocal { get; set; } = "";
    // v2.6.5 Auto-Invite Page Followers (Meta Business Suite / Post Reactors)
    public bool AutoInvitePageFollowersOnWarmup { get; set; } = true;
    public int MaxPageFollowerInvitesPerRun { get; set; } = 25;
    public int TotalPageFollowerInvitesSent { get; set; } = 0;
    // v3.0.0 UI/UX Pro Max Theme Palette ("obsidian" | "emerald")
    public string UiThemePalette { get; set; } = "obsidian";
    // v3.0.1 Per-Fanpage & Per-AdAccount Via / Chrome Profile Pinning
    public Dictionary<string, string> PageHolderViaOverrides { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> AdAccountViaOverrides { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    // v3.0.2 Per-Fanpage Pending Follower Invites Counter (detected from Meta Business Suite)
    public Dictionary<string, int> PagePendingInviteCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);

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

    [JsonIgnore]
    public string AntidetectApiKey
    {
        get
        {
            try { return WindowsDpapi.UnprotectString(EncryptedAntidetectApiKeyBase64); }
            catch { return ""; }
        }
        set
        {
            EncryptedAntidetectApiKeyBase64 = string.IsNullOrWhiteSpace(value) ? "" : WindowsDpapi.ProtectString(value.Trim());
        }
    }

    public string GetJwt() => string.IsNullOrWhiteSpace(EncryptedJwtBase64) ? "" : WindowsDpapi.UnprotectString(EncryptedJwtBase64);

    public void SetJwt(string? jwt)
    {
        EncryptedJwtBase64 = string.IsNullOrWhiteSpace(jwt) ? "" : WindowsDpapi.ProtectString(jwt.Trim());
    }

    public string GetSavedPassword()
    {
        try
        {
            return string.IsNullOrWhiteSpace(EncryptedPasswordBase64) ? "" : WindowsDpapi.UnprotectString(EncryptedPasswordBase64);
        }
        catch
        {
            return "";
        }
    }

    public void SetSavedPassword(string? pwd)
    {
        EncryptedPasswordBase64 = string.IsNullOrEmpty(pwd) ? "" : WindowsDpapi.ProtectString(pwd);
    }

    public string GetOrCreateBridgeToken(string? customPath = null)
    {
        if (!string.IsNullOrWhiteSpace(EncryptedBridgeTokenBase64))
        {
            try
            {
                var existing = WindowsDpapi.UnprotectString(EncryptedBridgeTokenBase64);
                if (!string.IsNullOrWhiteSpace(existing) && existing.Length >= 32)
                {
                    return existing;
                }
            }
            catch
            {
                // Regenerate fresh DPAPI-protected bridge token if corrupted or from another Windows profile
            }
        }
        return RotateBridgeToken(customPath);
    }

    public string RotateBridgeToken(string? customPath = null)
    {
        var fresh = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        EncryptedBridgeTokenBase64 = WindowsDpapi.ProtectString(fresh);
        try { Save(customPath); } catch { }
        return fresh;
    }

    public static string AppDataRoot =>
        !string.IsNullOrWhiteSpace(AppDataRootOverride)
            ? AppDataRootOverride!
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AdsOpsDesktop");

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
                    cfg.MaxViasPerProxyInBatch = Math.Clamp(cfg.MaxViasPerProxyInBatch < 1 ? 4 : cfg.MaxViasPerProxyInBatch, 1, 50);
                    cfg.MaxDirectIpViasInBatch = Math.Clamp(cfg.MaxDirectIpViasInBatch < 1 ? 3 : cfg.MaxDirectIpViasInBatch, 1, 20);
                    cfg.MaxPagesPerProxyInBatch = Math.Clamp(cfg.MaxPagesPerProxyInBatch < 1 ? 2 : cfg.MaxPagesPerProxyInBatch, 1, 20);
                    cfg.SameProxyMinStaggerSeconds = Math.Clamp(cfg.SameProxyMinStaggerSeconds < 15 ? 55 : cfg.SameProxyMinStaggerSeconds, 15, 300);
                    cfg.BrowserHangTimeoutSeconds = Math.Clamp(cfg.BrowserHangTimeoutSeconds < 60 ? 210 : cfg.BrowserHangTimeoutSeconds, 60, 900);
                    cfg.MaxConcurrentBrowsers = Math.Clamp(cfg.MaxConcurrentBrowsers < 1 ? 6 : cfg.MaxConcurrentBrowsers, 1, 30);
                    cfg.DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(cfg.DefaultBrowserEngine);
                    if (cfg.AutoKeepAliveMinGapMinutes < 5) cfg.AutoKeepAliveMinGapMinutes = 20;
                    if (cfg.SoakQuarantineHours < 12 || cfg.SoakQuarantineHours > 336) cfg.SoakQuarantineHours = 72;
                    if (cfg.AutoCooldownHours < 1 || cfg.AutoCooldownHours > 168) cfg.AutoCooldownHours = 24;
                    cfg.MaxPageFollowerInvitesPerRun = Math.Clamp(cfg.MaxPageFollowerInvitesPerRun < 5 ? 25 : cfg.MaxPageFollowerInvitesPerRun, 5, 50);
                    cfg.PageHolderViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    cfg.AdAccountViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    cfg.PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    if (string.IsNullOrWhiteSpace(cfg.DefaultWarmupMode)) cfg.DefaultWarmupMode = "human_organic";
                    if (cfg.ConfigMigrationVersion < 261)
                    {
                        if (cfg.MaxViasPerProxyInBatch == 2) cfg.MaxViasPerProxyInBatch = 4;
                        cfg.UseIsolatedProfiles = true;
                    }
                    if (cfg.ConfigMigrationVersion < CurrentMigrationVersion)
                    {
                        cfg.ConfigMigrationVersion = CurrentMigrationVersion;
                        try { cfg.Save(path); } catch { }
                    }
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

    public DesktopConfig CloneWithoutSecrets()
    {
        var json = JsonSerializer.Serialize(this);
        var copy = JsonSerializer.Deserialize<DesktopConfig>(json) ?? new DesktopConfig();
        copy.EncryptedJwtBase64 = "";
        copy.EncryptedPasswordBase64 = "";
        copy.EncryptedBridgeTokenBase64 = "";
        copy.EncryptedAntidetectApiKeyBase64 = "";
        return copy;
    }

    public void ApplyPreferencesFrom(DesktopConfig? src)
    {
        if (src == null) return;
        UseIsolatedProfiles = src.UseIsolatedProfiles;
        AutoKeepAliveScheduler = src.AutoKeepAliveScheduler;
        if (src.BridgePort > 0) BridgePort = src.BridgePort;
        AutoKeepAliveStartHour = Math.Clamp(src.AutoKeepAliveStartHour, 0, 22);
        AutoKeepAliveEndHour = Math.Clamp(src.AutoKeepAliveEndHour, 1, 23);
        AutoKeepAliveMinGapMinutes = Math.Max(5, src.AutoKeepAliveMinGapMinutes);
        DefaultStaggerSeconds = Math.Max(18, src.DefaultStaggerSeconds);
        PreCheckProxyBeforeLaunch = src.PreCheckProxyBeforeLaunch;
        MaxViasPerProxyInBatch = Math.Clamp(src.MaxViasPerProxyInBatch < 1 ? 4 : src.MaxViasPerProxyInBatch, 1, 50);
        MaxDirectIpViasInBatch = Math.Clamp(src.MaxDirectIpViasInBatch < 1 ? 3 : src.MaxDirectIpViasInBatch, 1, 20);
        MaxPagesPerProxyInBatch = Math.Clamp(src.MaxPagesPerProxyInBatch < 1 ? 2 : src.MaxPagesPerProxyInBatch, 1, 20);
        SameProxyMinStaggerSeconds = Math.Clamp(src.SameProxyMinStaggerSeconds < 15 ? 55 : src.SameProxyMinStaggerSeconds, 15, 300);
        BrowserHangTimeoutSeconds = Math.Clamp(src.BrowserHangTimeoutSeconds < 60 ? 210 : src.BrowserHangTimeoutSeconds, 60, 900);
        WarmupBeforeCreate = src.WarmupBeforeCreate;
        AutoUploadMedia = src.AutoUploadMedia;
        AutoCloseKeepAliveTab = src.AutoCloseKeepAliveTab;
        AutoCloseKeepAliveWindow = src.AutoCloseKeepAliveWindow;
        EnforceSoakQuarantine = src.EnforceSoakQuarantine;
        SoakQuarantineHours = Math.Clamp(src.SoakQuarantineHours < 12 ? 72 : src.SoakQuarantineHours, 12, 336);
        EnforceClientSilo = src.EnforceClientSilo;
        AutoCooldownHours = Math.Clamp(src.AutoCooldownHours < 1 ? 24 : src.AutoCooldownHours, 1, 168);
        DefaultWarmupMode = string.IsNullOrWhiteSpace(src.DefaultWarmupMode) ? "human_organic" : src.DefaultWarmupMode.Trim();
        AutoRefreshCookieAfterKeepAlive = src.AutoRefreshCookieAfterKeepAlive;
        IpLeakKillSwitchEnabled = src.IpLeakKillSwitchEnabled;
        DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(src.DefaultBrowserEngine);
        AntidetectApiBaseUrl = (src.AntidetectApiBaseUrl ?? "").Trim();
        EnableChromeAntidetectShield = src.EnableChromeAntidetectShield;
        LowRamFarmMode = src.LowRamFarmMode;
        MaxConcurrentBrowsers = Math.Clamp(src.MaxConcurrentBrowsers < 1 ? 6 : src.MaxConcurrentBrowsers, 1, 30);
        AutoScaleConcurrentByRam = src.AutoScaleConcurrentByRam;
        AutoFailoverToChromeNative = src.AutoFailoverToChromeNative;
        AutoDailyFullPipeline = src.AutoDailyFullPipeline;
        if (!string.IsNullOrWhiteSpace(src.LastAutoPipelineDateLocal))
        {
            LastAutoPipelineDateLocal = src.LastAutoPipelineDateLocal.Trim();
        }
        AutoInvitePageFollowersOnWarmup = src.AutoInvitePageFollowersOnWarmup;
        MaxPageFollowerInvitesPerRun = Math.Clamp(src.MaxPageFollowerInvitesPerRun < 5 ? 25 : src.MaxPageFollowerInvitesPerRun, 5, 50);
        if (src.TotalPageFollowerInvitesSent > TotalPageFollowerInvitesSent)
        {
            TotalPageFollowerInvitesSent = src.TotalPageFollowerInvitesSent;
        }
        if (!string.IsNullOrWhiteSpace(src.UiThemePalette))
        {
            UiThemePalette = src.UiThemePalette.Trim().ToLowerInvariant();
        }
        if (src.PageHolderViaOverrides != null && src.PageHolderViaOverrides.Count > 0)
        {
            PageHolderViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in src.PageHolderViaOverrides)
            {
                if (!string.IsNullOrWhiteSpace(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
                {
                    PageHolderViaOverrides[kv.Key] = kv.Value;
                }
            }
        }
        if (src.AdAccountViaOverrides != null && src.AdAccountViaOverrides.Count > 0)
        {
            AdAccountViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in src.AdAccountViaOverrides)
            {
                if (!string.IsNullOrWhiteSpace(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
                {
                    AdAccountViaOverrides[kv.Key] = kv.Value;
                }
            }
        }
        if (src.PagePendingInviteCounts != null && src.PagePendingInviteCounts.Count > 0)
        {
            PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in src.PagePendingInviteCounts)
            {
                if (!string.IsNullOrWhiteSpace(kv.Key) && kv.Value >= 0)
                {
                    PagePendingInviteCounts[kv.Key] = kv.Value;
                }
            }
        }
        ConfigMigrationVersion = CurrentMigrationVersion;
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

public sealed record ParsedViaNotes(
    string Tier,
    string WarmupStartIso,
    string CleanNotes,
    string ClientGroup = "",
    string WarmupMode = "human_organic",
    string AntidetectEngine = "chrome_native",
    string AntidetectProfileId = "");
public sealed record ViaWarmupStatus(int HoursElapsed, int DaysElapsed, string Phase, string Label, string Hint);

public static class ViaMetadataParser
{
    private static readonly Regex TierRegex = new(@"\[TIER:(vault|hold|camp|standby)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WarmupRegex = new(@"\[WARMUP:([0-9T:.\-]+Z?)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ClientRegex = new(@"\[CLIENT:([^\[\]\r\n]{1,64})\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WarmupModeRegex = new(@"\[WMODE:(soak_72h|human_organic|bm_warmup|pre_camp)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AntidetectEngineRegex = new(@"\[ADENG:(chrome_native|adspower|dolphin_anty|hidemyacc|genlogin|gologin)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AntidetectIdRegex = new(@"\[ADID:([^\[\]\r\n]{1,64})\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string NormalizeWarmupMode(string? raw)
    {
        var m = (raw ?? "").Trim().ToLowerInvariant();
        return m switch
        {
            "soak_72h" => "soak_72h",
            "bm_warmup" => "bm_warmup",
            "pre_camp" => "pre_camp",
            _ => "human_organic",
        };
    }

    public static ParsedViaNotes ParseNotes(string? notesRaw, string? label, int bmCount = 0, int adCount = 0)
    {
        var notes = notesRaw ?? "";
        var tm = TierRegex.Match(notes);
        var wm = WarmupRegex.Match(notes);
        var cm = ClientRegex.Match(notes);
        var wmm = WarmupModeRegex.Match(notes);
        var adm = AntidetectEngineRegex.Match(notes);
        var adid = AntidetectIdRegex.Match(notes);

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
        var clientGroup = cm.Success ? cm.Groups[1].Value.Trim() : "";
        var warmupMode = wmm.Success ? NormalizeWarmupMode(wmm.Groups[1].Value) : "human_organic";
        var antidetectEngine = adm.Success ? AntidetectBrowserConnector.NormalizeEngine(adm.Groups[1].Value) : "chrome_native";
        var antidetectProfileId = adid.Success ? adid.Groups[1].Value.Trim() : "";

        var clean = TierRegex.Replace(notes, " ");
        clean = WarmupRegex.Replace(clean, " ");
        clean = ClientRegex.Replace(clean, " ");
        clean = WarmupModeRegex.Replace(clean, " ");
        clean = AntidetectEngineRegex.Replace(clean, " ");
        clean = AntidetectIdRegex.Replace(clean, " ");
        clean = Regex.Replace(clean, @"\s+", " ").Trim();
        return new ParsedViaNotes(tier, warmupIso, clean, clientGroup, warmupMode, antidetectEngine, antidetectProfileId);
    }

    public static string BuildNotes(
        string? cleanNotes,
        string tier,
        string warmupStartIso,
        string? clientGroup = null,
        string? warmupMode = null,
        string? antidetectEngine = null,
        string? antidetectProfileId = null)
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
        var safeClient = Regex.Replace((clientGroup ?? "").Trim(), @"[\[\]\r\n]+", "");
        if (safeClient.Length > 64) safeClient = safeClient[..64].Trim();
        if (!string.IsNullOrEmpty(safeClient))
        {
            tags.Add($"[CLIENT:{safeClient}]");
        }
        var normMode = NormalizeWarmupMode(warmupMode);
        if (!string.IsNullOrWhiteSpace(warmupMode) && normMode != "human_organic")
        {
            tags.Add($"[WMODE:{normMode}]");
        }
        var normEng = AntidetectBrowserConnector.NormalizeEngine(antidetectEngine);
        var safeAdId = Regex.Replace((antidetectProfileId ?? "").Trim(), @"[\[\]\r\n]+", "");
        if (safeAdId.Length > 64) safeAdId = safeAdId[..64].Trim();
        if (normEng != "chrome_native" || !string.IsNullOrEmpty(safeAdId))
        {
            tags.Add($"[ADENG:{normEng}]");
            if (!string.IsNullOrEmpty(safeAdId))
            {
                tags.Add($"[ADID:{safeAdId}]");
            }
        }
        var prefix = string.Join(" ", tags);
        var tail = (cleanNotes ?? "").Trim();
        return string.IsNullOrEmpty(tail) ? prefix : $"{prefix} {tail}";
    }

    public static ViaWarmupStatus ComputeWarmupStatus(string? warmupStartIso, DateTimeOffset? now = null, int soakHours = 72)
    {
        var refNow = now ?? DateTimeOffset.UtcNow;
        var effectiveSoak = Math.Clamp(soakHours, 12, 336);
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

        if (hours < effectiveSoak)
        {
            return new ViaWarmupStatus(
                hours,
                days,
                "72h_lock",
                $"Ngâm {effectiveSoak}h vàng ({hours}/{effectiveSoak}h)",
                $"{effectiveSoak}h đầu: CẤM tạo Page hàng loạt, CẤM vào Ads Manager, CẤM đổi pass/2FA. Chỉ lướt Newsfeed thụ động.");
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
    [JsonPropertyName("plan_tier")] public string PlanTier { get; set; } = "agency";
    [JsonPropertyName("max_vias")] public int MaxVias { get; set; } = 500;
    [JsonPropertyName("max_ad_accounts")] public int MaxAdAccounts { get; set; } = 500;
    [JsonPropertyName("max_members")] public int MaxMembers { get; set; } = 25;
    [JsonPropertyName("community_status")] public string CommunityStatus { get; set; } = "active";
}

public sealed class CurrentUserDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("email")] public string Email { get; set; } = "";
    [JsonPropertyName("full_name")] public string FullName { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("is_platform_admin")] public bool IsPlatformAdmin { get; set; }
    [JsonPropertyName("workspace")] public WorkspaceDto? Workspace { get; set; }
}

public sealed class PersonalAccountRefDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = "";
    [JsonPropertyName("external_reference_id")] public string? ExternalReferenceId { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "unknown";
    [JsonPropertyName("timezone")] public string? Timezone { get; set; }
    [JsonPropertyName("owner_member_id")] public string? OwnerMemberId { get; set; }
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
    [JsonPropertyName("today_partial_raw")] public JsonElement? TodayPartialRaw { get; set; }
    [JsonPropertyName("last_7d_raw")] public JsonElement? Last7dRaw { get; set; }
    [JsonPropertyName("mtd_raw")] public JsonElement? MtdRaw { get; set; }
    [JsonPropertyName("amount_spent_raw")] public JsonElement? AmountSpentRaw { get; set; }
    [JsonPropertyName("balance_raw")] public JsonElement? BalanceRaw { get; set; }
    [JsonPropertyName("spend_cap_raw")] public JsonElement? SpendCapRaw { get; set; }

    public string TodayText => AdAccountBillingMetaDto.AsOptionalString(TodayPartialRaw) ?? "";
    public string Last7dText => AdAccountBillingMetaDto.AsOptionalString(Last7dRaw) ?? "";
    public string MtdText => AdAccountBillingMetaDto.AsOptionalString(MtdRaw) ?? "";
    public string AmountSpentText => AdAccountBillingMetaDto.AsOptionalString(AmountSpentRaw) ?? "";
    public string BalanceText => AdAccountBillingMetaDto.AsOptionalString(BalanceRaw) ?? "";
    public string SpendCapText => AdAccountBillingMetaDto.AsOptionalString(SpendCapRaw) ?? "";
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
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "UNKNOWN";
    [JsonPropertyName("normalized_key")] public string? NormalizedKey { get; set; }
    [JsonPropertyName("exit_ip")] public string? ExitIp { get; set; }
    [JsonPropertyName("country_code")] public string? CountryCode { get; set; }
    [JsonPropertyName("timezone")] public string? Timezone { get; set; }
    [JsonPropertyName("expected_timezone")] public string? ExpectedTimezone { get; set; }
    [JsonPropertyName("timezone_match")] public bool? TimezoneMatch { get; set; }
    [JsonPropertyName("timezone_warning")] public string? TimezoneWarning { get; set; }
    [JsonPropertyName("latency_ms")] public int? LatencyMs { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("error_summary")] public string? ErrorSummary { get; set; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; set; }
    [JsonPropertyName("telegram_notified")] public bool TelegramNotified { get; set; }
}

public static class ProxyTimezoneHelper
{
    public static string NormalizeTimezone(string? raw)
    {
        var s = (raw ?? "").Trim().ToLowerInvariant();
        return s switch
        {
            "asia/saigon" => "asia/ho_chi_minh",
            "asia/ho_chi_minh" => "asia/ho_chi_minh",
            "asia/calcutta" => "asia/kolkata",
            "europe/kiev" => "europe/kyiv",
            "us/eastern" => "america/new_york",
            "us/central" => "america/chicago",
            "us/pacific" => "america/los_angeles",
            _ => s,
        };
    }

    public static (bool? Match, string? Warning) EvaluateMatch(string? exitTimezone, string? exitCountry, string? expectedTimezone)
    {
        var exNorm = NormalizeTimezone(exitTimezone);
        var expNorm = NormalizeTimezone(expectedTimezone);
        if (string.IsNullOrEmpty(exNorm) || string.IsNullOrEmpty(expNorm))
        {
            return (null, null);
        }
        if (string.Equals(exNorm, expNorm, StringComparison.OrdinalIgnoreCase))
        {
            return (true, null);
        }
        var countrySuffix = string.IsNullOrWhiteSpace(exitCountry) ? "" : $" ({exitCountry})";
        return (false, $"Lệch múi giờ: Proxy IP ở {exitTimezone}{countrySuffix} nhưng cấu hình Via/Máy là {expectedTimezone}");
    }
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

    public string GetLocalizedTitle()
    {
        var t = (Title ?? "").Trim();
        if (string.IsNullOrEmpty(t)) return "Cảnh báo hệ thống";
        if (t.Equals("Meta reports the account as not operable", StringComparison.OrdinalIgnoreCase))
            return "Meta báo TKQC ngừng hoạt động (Closed / Not Operable)";
        if (t.Equals("Account status is disabled", StringComparison.OrdinalIgnoreCase))
            return "Tài khoản quảng cáo đã bị vô hiệu hóa (Disabled)";
        if (t.Equals("Account status is restricted", StringComparison.OrdinalIgnoreCase))
            return "Tài khoản quảng cáo đang bị hạn chế (Restricted)";
        if (t.Equals("Meta reports a pending payment or review state", StringComparison.OrdinalIgnoreCase))
            return "TKQC đang chờ thanh toán dư nợ hoặc xét duyệt";
        if (t.Contains("unsettled balance", StringComparison.OrdinalIgnoreCase))
            return "Tài khoản quảng cáo còn dư nợ chưa thanh toán";
        if (t.Contains("spend cap", StringComparison.OrdinalIgnoreCase) || t.Contains("spending limit", StringComparison.OrdinalIgnoreCase))
            return "Tài khoản quảng cáo sắp/đã chạm giới hạn chi tiêu";
        return t;
    }

    public string GetLocalizedSummary()
    {
        var s = (Summary ?? "").Trim();
        if (string.IsNullOrEmpty(s)) return "";
        if (s.Equals("The recorded account status is disabled.", StringComparison.OrdinalIgnoreCase))
            return "Trạng thái TKQC ghi nhận từ Meta đang bị vô hiệu hóa (Disabled). Cần kiểm tra kháng nghị hoặc chuyển sang TKQC dự phòng.";
        if (s.Equals("The recorded account status is restricted.", StringComparison.OrdinalIgnoreCase))
            return "Trạng thái TKQC ghi nhận từ Meta đang bị hạn chế quảng cáo (Restricted). Hãy kiểm tra Chất lượng Tài khoản.";
        if (s.Contains("Meta returned account_status 101", StringComparison.OrdinalIgnoreCase))
        {
            var reasonMatch = Regex.Match(s, @"disable reason:\s*([^.;]+)", RegexOptions.IgnoreCase);
            var reasonTxt = reasonMatch.Success && !reasonMatch.Groups[1].Value.Trim().Equals("NONE (0)", StringComparison.OrdinalIgnoreCase)
                ? $" Lý do khóa: {reasonMatch.Groups[1].Value.Trim()}."
                : " Chưa có lý do khóa cụ thể (NONE).";
            return $"Meta trả về account_status 101 (Đã đóng / Ngừng hoạt động).{reasonTxt}";
        }
        if (s.Contains("Meta returned account_status 3", StringComparison.OrdinalIgnoreCase))
            return "Meta trả về account_status 3 (Dư nợ chưa thanh toán / Unsettled). Cần thanh toán thẻ trong Billing Hub.";
        if (s.Contains("Meta returned account_status 2", StringComparison.OrdinalIgnoreCase))
            return "Meta trả về account_status 2 (TKQC bị vô hiệu hóa). Cần kiểm tra kháng nghị hoặc thay TKQC mới.";
        return s;
    }

    public static string FormatIsoTimestampLocal(string? isoRaw, string fallback = "Chưa chạy")
    {
        var clean = (isoRaw ?? "").Trim();
        if (string.IsNullOrEmpty(clean)) return fallback;
        if (DateTimeOffset.TryParse(clean, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            return parsed.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss", CultureInfo.InvariantCulture);
        }
        return clean;
    }
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
    [JsonPropertyName("antidetect_engine")] public string AntidetectEngine { get; set; } = "chrome_native";
    [JsonPropertyName("antidetect_profile_id")] public string AntidetectProfileId { get; set; } = "";
    [JsonPropertyName("workstation")] public string Workstation { get; set; } = "";
    [JsonPropertyName("startup_ms")] public int? StartupMs { get; set; }
    [JsonPropertyName("failover_from")] public string FailoverFrom { get; set; } = "";
    [JsonPropertyName("target_url")] public string TargetUrl { get; set; } = "";
}

public sealed class BrowserEventResponseDto
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("event_type")] public string? EventType { get; set; }
    [JsonPropertyName("matched_page_id")] public string? MatchedPageId { get; set; }
    [JsonPropertyName("external_page_id")] public string? ExternalPageId { get; set; }
    [JsonPropertyName("auto_claimed_bm")] public bool AutoClaimedBm { get; set; }
    [JsonPropertyName("telegram_notified")] public bool TelegramNotified { get; set; }
    [JsonPropertyName("close_sender_window")] public bool CloseSenderWindow { get; set; }
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
    public string Status { get; set; } = "active";
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

    // v2.4 Anti-Checkpoint & Multi-Client Stewardship fields
    public string ClientGroup { get; set; } = "";
    public string DefaultWarmupMode { get; set; } = "human_organic";
    public int SoakHoursRemaining { get; set; }
    public bool IsInSoakQuarantine { get; set; }
    public DateTimeOffset? CooldownUntilUtc { get; set; }
    public string CooldownReason { get; set; } = "";
    public bool IsInCooldown => CooldownUntilUtc.HasValue && CooldownUntilUtc.Value > DateTimeOffset.UtcNow;
    public bool HasSiloConflict { get; set; }
    public string SiloConflictDetail { get; set; } = "";
    public int SharedProxyViaCount { get; set; } = 1;
    public int TrustScore { get; set; } = 100;
    public string TrustSummary { get; set; } = "";
    public DateTimeOffset? LastCookieRefreshUtc { get; set; }
    public int KeepAliveSuccessCount { get; set; }
    public string AntidetectEngine { get; set; } = "chrome_native";
    public string AntidetectProfileId { get; set; } = "";
    public string OwnerMemberId { get; set; } = "";
    public string OwnerMemberName { get; set; } = "";
    public string Timezone { get; set; } = "";
    public string ProxyTimezone { get; set; } = "";
    public bool HasTimezoneMismatch { get; set; }
    public string TimezoneWarning { get; set; } = "";
    public bool IsBrowserRunning { get; set; }
    public double ActiveRamMb { get; set; }
    public double ActiveCpuPercent { get; set; }
    public bool HasVaultCookie { get; set; }
    public bool HasLocalTwoFa { get; set; }
}

public sealed class AutomationPlaybookStepDto
{
    [JsonPropertyName("action")] public string Action { get; set; } = "open_url";
    [JsonPropertyName("target")] public string Target { get; set; } = "";
    [JsonPropertyName("wait_sec")] public int WaitSec { get; set; } = 10;
    [JsonPropertyName("note")] public string Note { get; set; } = "";
}

public sealed class AutomationPlaybookDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "meta";
    [JsonPropertyName("category")] public string Category { get; set; } = "warmup";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("version_tag")] public string VersionTag { get; set; } = "1.0.0";
    [JsonPropertyName("changelog")] public string Changelog { get; set; } = "";
    [JsonPropertyName("steps")] public List<AutomationPlaybookStepDto> Steps { get; set; } = new();
    [JsonPropertyName("default_stagger_sec")] public int DefaultStaggerSec { get; set; } = 55;
    [JsonPropertyName("jitter_pct")] public int JitterPct { get; set; } = 35;
    [JsonPropertyName("is_builtin")] public bool IsBuiltin { get; set; }
    [JsonPropertyName("author_name")] public string AuthorName { get; set; } = "";
    [JsonPropertyName("avg_rating")] public double? AvgRating { get; set; }
    [JsonPropertyName("rating_count")] public int RatingCount { get; set; }
    [JsonPropertyName("run_count")] public int RunCount { get; set; }
    [JsonPropertyName("my_rating")] public int? MyRating { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }

    public static List<AutomationPlaybookDto> GetDefaultBuiltinPlaybooks() => new()
    {
        new AutomationPlaybookDto
        {
            Id = "builtin-meta-soak-72h",
            Slug = "meta-soak-72h-feed-watch",
            Title = "Meta 72h Vàng — Đảo Ấm Newsfeed & Watch (Chống Checkpoint)",
            Platform = "meta",
            Category = "warmup",
            Description = "Cuộn Newsfeed, xem Facebook Watch ngắn và đọc Thông báo ngẫu nhiên. Tuyệt đối KHÔNG mở Trình quản lý Quảng cáo.",
            VersionTag = "2.6.5",
            DefaultStaggerSec = 60,
            JitterPct = 35,
            IsBuiltin = true,
            AuthorName = "AdsOps Pro Built-in",
            Steps = new List<AutomationPlaybookStepDto>
            {
                new() { Action = "open_url", Target = "https://www.facebook.com/?adsops_keepalive_session=1", WaitSec = 25, Note = "Đảo Ấm Newsfeed & Notifications" },
            },
        },
        new AutomationPlaybookDto
        {
            Id = "builtin-meta-page-invite-followers",
            Slug = "meta-page-auto-invite-followers",
            Title = "Meta Business Suite — Tự Động Mời Người Thả Cảm Xúc Theo Dõi Fanpage",
            Platform = "meta",
            Category = "page_growth",
            Description = "Mở Meta Business Suite mục 'Phát triển đối tượng -> Tiếp cận những người đã bày tỏ cảm xúc với nội dung của bạn' và tự động bấm Gửi lời mời theo nhịp Jitter 3-6s.",
            VersionTag = "2.6.5",
            DefaultStaggerSec = 65,
            JitterPct = 35,
            IsBuiltin = true,
            AuthorName = "AdsOps Pro Built-in",
            Steps = new List<AutomationPlaybookStepDto>
            {
                new() { Action = "open_url", Target = "https://business.facebook.com/latest/home?adsops_auto_invite_followers=1&adsops_auto_close=1", WaitSec = 35, Note = "Tự động gửi lời mời theo dõi Fanpage cho người tương tác" },
            },
        },
        new AutomationPlaybookDto
        {
            Id = "builtin-meta-bm-precheck",
            Slug = "meta-bm-adsmanager-warm",
            Title = "Meta Cầm BM & Ads Manager Thụ Động (Anti-Deep-Link)",
            Platform = "meta",
            Category = "bm_warmup",
            Description = "Mở Facebook Feed 20s trước khi vào Cài đặt BM / Ads Manager để giữ độ tin cậy cho Via Hold BM.",
            VersionTag = "2.6.5",
            DefaultStaggerSec = 75,
            JitterPct = 35,
            IsBuiltin = true,
            AuthorName = "AdsOps Pro Built-in",
            Steps = new List<AutomationPlaybookStepDto>
            {
                new() { Action = "open_url", Target = "https://www.facebook.com/?adsops_keepalive_session=1&adsops_ka_mode=bm_warmup", WaitSec = 30, Note = "Feed rồi sang BM" },
            },
        },
        new AutomationPlaybookDto
        {
            Id = "builtin-google-tiktok-warm",
            Slug = "multi-platform-billing-check",
            Title = "Đa Nền Tảng — Kiểm Tra Trang Chủ & Billing (Google / TikTok Ads)",
            Platform = "multi",
            Category = "audit",
            Description = "Giữ phiên đăng nhập sạch trước khi mở Trình quản lý Quảng cáo Google / TikTok.",
            VersionTag = "2.6.5",
            DefaultStaggerSec = 65,
            JitterPct = 30,
            IsBuiltin = true,
            AuthorName = "AdsOps Pro Built-in",
            Steps = new List<AutomationPlaybookStepDto>
            {
                new() { Action = "open_url", Target = "https://www.facebook.com/", WaitSec = 20, Note = "Mở phiên trình duyệt sạch" },
            },
        },
    };
}

public sealed class ProfileLaunchAuditDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("action")] public string Action { get; set; } = "";
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
    [JsonPropertyName("actor_email")] public string ActorEmail { get; set; } = "";
    [JsonPropertyName("actor_name")] public string ActorName { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("antidetect_engine")] public string AntidetectEngine { get; set; } = "chrome_native";
    [JsonPropertyName("antidetect_profile_id")] public string AntidetectProfileId { get; set; } = "";
    [JsonPropertyName("browser_profile")] public string BrowserProfile { get; set; } = "";
    [JsonPropertyName("workstation")] public string Workstation { get; set; } = "";
    [JsonPropertyName("startup_ms")] public int? StartupMs { get; set; }
    [JsonPropertyName("failover_from")] public string FailoverFrom { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
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

    public static void CleanupLegacyPythonBridgeAutostart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            key?.DeleteValue("AdsOpsChromeBridge", throwOnMissingValue: false);
        }
        catch
        {
            // Ignore restricted registry environments
        }
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

public sealed class MetaConnectionDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("environment")] public string Environment { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("token_configured")] public bool TokenConfigured { get; set; }
    [JsonPropertyName("reader_source")] public string ReaderSource { get; set; } = "";
    [JsonPropertyName("business_manager_reference")] public string? BusinessManagerReference { get; set; }
    [JsonPropertyName("business_manager_source")] public string BusinessManagerSource { get; set; } = "";
    [JsonPropertyName("last_capability_check_at")] public string? LastCapabilityCheckAt { get; set; }
}

public sealed class HealthSummaryDto
{
    [JsonPropertyName("total_active")] public int TotalActive { get; set; }
    [JsonPropertyName("critical")] public int Critical { get; set; }
    [JsonPropertyName("warning")] public int Warning { get; set; }
    [JsonPropertyName("attention_needed")] public int AttentionNeeded { get; set; }
    [JsonPropertyName("unknown")] public int Unknown { get; set; }
    [JsonPropertyName("clear_signals")] public int ClearSignals { get; set; }
    [JsonPropertyName("stale_data")] public int StaleData { get; set; }
}

public sealed class AccountHealthRowDto
{
    [JsonPropertyName("ad_account_id")] public string AdAccountId { get; set; } = "";
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = "";
    [JsonPropertyName("external_account_id")] public string? ExternalAccountId { get; set; }
    [JsonPropertyName("business_manager_name")] public string? BusinessManagerName { get; set; }
    [JsonPropertyName("personal_account_reference_label")] public string? PersonalAccountReferenceLabel { get; set; }
    [JsonPropertyName("account_status")] public string AccountStatus { get; set; } = "";
    [JsonPropertyName("readiness_status")] public string ReadinessStatus { get; set; } = "";
    [JsonPropertyName("health_status")] public string HealthStatus { get; set; } = "";
    [JsonPropertyName("freshness_status")] public string FreshnessStatus { get; set; } = "";
    [JsonPropertyName("open_critical_count")] public int OpenCriticalCount { get; set; }
    [JsonPropertyName("open_warning_count")] public int OpenWarningCount { get; set; }
    [JsonPropertyName("open_attention_count")] public int OpenAttentionCount { get; set; }
    [JsonPropertyName("last_evaluated_at")] public string? LastEvaluatedAt { get; set; }
    [JsonPropertyName("top_reason")] public JsonElement? TopReason { get; set; }

    public string GetTopReasonText()
    {
        if (!TopReason.HasValue || TopReason.Value.ValueKind != JsonValueKind.Object) return "—";
        var obj = TopReason.Value;
        foreach (var prop in new[] { "title", "rule_name", "summary", "why_it_matters", "signal_key" })
        {
            if (obj.TryGetProperty(prop, out var val) && val.ValueKind == JsonValueKind.String)
            {
                var txt = val.GetString();
                if (!string.IsNullOrWhiteSpace(txt)) return txt.Trim();
            }
        }
        return "—";
    }
}

public sealed class PagedAccountHealthDto
{
    [JsonPropertyName("items")] public List<AccountHealthRowDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class CampaignDraftDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("ad_account_id")] public string? AdAccountId { get; set; }
    [JsonPropertyName("account_display_name")] public string? AccountDisplayName { get; set; }
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("objective")] public string? Objective { get; set; }
    [JsonPropertyName("draft_status")] public string DraftStatus { get; set; } = "";
    [JsonPropertyName("open_blocking_count")] public int OpenBlockingCount { get; set; }
    [JsonPropertyName("open_warning_count")] public int OpenWarningCount { get; set; }
    [JsonPropertyName("last_evaluated_at")] public string? LastEvaluatedAt { get; set; }
}

public sealed class PagedCampaignDraftsDto
{
    [JsonPropertyName("items")] public List<CampaignDraftDto> Items { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed record ParsedBulkViaRow(
    int RowNumber,
    string RawLine,
    string Label,
    string ExternalReferenceId,
    string TwoFaSecret,
    string CookieRaw,
    string ProxyRaw,
    string ProxyHostPort,
    string AssignedProfile,
    string RoleTier,
    string WarmupStartIso,
    string CleanNotes,
    int StrippedSecretsCount,
    string DuplicateProxyWarning,
    bool HasValidPayload);

public sealed record ViaBulkParseSummary(
    List<ParsedBulkViaRow> Rows,
    HashSet<string> DuplicateProxyHosts,
    int SkippedEmptyCount,
    int WarningCount);

/// <summary>
/// Parses multi-line Via lists (UID|Pass|2FA|Cookie|Mail|Proxy) while stripping passwords/emails from Cloud fields.
/// </summary>
public static class ViaBulkImportParser
{
    private static readonly Regex UidRx = new(@"^\d{8,22}$", RegexOptions.Compiled);
    private static readonly Regex CookieUidRx = new(@"(?:^|[;\s])c_user=(\d{6,22})\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex TwoFaPrefixRx = new(@"^(?:2fa|secret|otp)\s*[:=]\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PureBase32Rx = new(@"^[A-Z2-7]{16,64}$", RegexOptions.Compiled);

    private static bool TryExtractTwoFa(string token, out string normalized)
    {
        normalized = "";
        if (string.IsNullOrWhiteSpace(token)) return false;
        var hasPrefix = TwoFaPrefixRx.IsMatch(token.Trim());
        var t = TwoFaPrefixRx.Replace(token.Trim(), "");
        t = t.Replace("-", "", StringComparison.Ordinal).Replace(" ", "", StringComparison.Ordinal);
        // Reject CamelCase passwords (e.g., MatKhauBiMat...) unless explicitly prefixed with 2fa:/secret:
        if (!hasPrefix && t.Any(char.IsUpper) && t.Any(char.IsLower)) return false;
        t = TotpService.NormalizeBase32Secret(t);
        if (!PureBase32Rx.IsMatch(t)) return false;
        if (!TotpService.ComputeTotp(t).Valid) return false;
        normalized = t;
        return true;
    }

    public static ViaBulkParseSummary ParseBulkText(
        string? rawText,
        string labelPrefix,
        string defaultTier,
        IReadOnlyList<ViaWorkspaceEntry>? existingVias,
        bool autoAssignProfile,
        string warmupStartIso = "",
        int maxSafePerProxy = 4)
    {
        var prefix = string.IsNullOrWhiteSpace(labelPrefix) ? "Via Nhập" : labelPrefix.Trim();
        var tier = (defaultTier ?? "").Trim().ToLowerInvariant() switch
        {
            "vault" or "hold" => "vault",
            "standby" => "standby",
            _ => "camp",
        };

        var usedProfiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var existingProxyCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        if (existingVias != null)
        {
            foreach (var v in existingVias)
            {
                var pd = ExtensionProvisioner.ResolveProfileDirectory(v.BrowserProfileLabel, v.Label);
                if (!string.IsNullOrWhiteSpace(pd)) usedProfiles.Add(pd);
                var hp = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
                if (!string.IsNullOrWhiteSpace(hp))
                {
                    existingProxyCounts[hp] = existingProxyCounts.GetValueOrDefault(hp) + 1;
                }
            }
        }

        var draftRows = new List<ParsedBulkViaRow>();
        var batchProxyCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int skippedEmpty = 0;
        int nextProfileNum = 1;

        string AllocateNextProfile()
        {
            if (!autoAssignProfile) return "Default";
            while (nextProfileNum <= 999)
            {
                var candidate = $"Profile {nextProfileNum}";
                nextProfileNum++;
                if (!usedProfiles.Contains(candidate))
                {
                    usedProfiles.Add(candidate);
                    return candidate;
                }
            }
            return "Default";
        }

        var lines = (rawText ?? "").Replace("\r\n", "\n").Split('\n');
        int validSeq = 0;
        foreach (var rawLine in lines)
        {
            var trimmedLine = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(trimmedLine))
            {
                skippedEmpty++;
                continue;
            }

            var cols = trimmedLine.Contains('|')
                ? trimmedLine.Split('|')
                : trimmedLine.Contains('\t')
                    ? trimmedLine.Split('\t')
                    : new[] { trimmedLine };

            string uid = "";
            string twoFa = "";
            string cookie = "";
            string proxy = "";
            string explicitLabel = "";
            int strippedSecrets = 0;

            for (int c = 0; c < cols.Length; c++)
            {
                var tok = cols[c].Trim();
                if (string.IsNullOrEmpty(tok)) continue;

                if (tok.Contains("c_user=", StringComparison.OrdinalIgnoreCase) ||
                    (tok.Contains("xs=", StringComparison.OrdinalIgnoreCase) && tok.Contains(';')))
                {
                    cookie = tok;
                    if (string.IsNullOrEmpty(uid))
                    {
                        var cm = CookieUidRx.Match(tok);
                        if (cm.Success) uid = cm.Groups[1].Value;
                    }
                    continue;
                }

                if (ExtensionProvisioner.ParseProxy(tok) != null)
                {
                    proxy = tok;
                    continue;
                }

                if (TryExtractTwoFa(tok, out var norm2Fa))
                {
                    twoFa = norm2Fa;
                    continue;
                }

                if (UidRx.IsMatch(tok))
                {
                    if (string.IsNullOrEmpty(uid)) uid = tok;
                    else strippedSecrets++;
                    continue;
                }

                if (tok.Contains('@'))
                {
                    strippedSecrets++;
                    continue;
                }

                // First non-secret column may be a friendly Via label; later plain columns are treated as passwords/emails and stripped.
                if (c == 0 && string.IsNullOrEmpty(explicitLabel) && !tok.Contains(' '))
                {
                    // Could be single-token name or non-numeric username; allow with spaces if user wrote a readable Via name
                    explicitLabel = tok;
                }
                else if (c == 0 && string.IsNullOrEmpty(explicitLabel))
                {
                    explicitLabel = tok;
                }
                else
                {
                    strippedSecrets++;
                }
            }

            validSeq++;
            var finalLabel = !string.IsNullOrEmpty(explicitLabel)
                ? explicitLabel
                : !string.IsNullOrEmpty(uid)
                    ? $"{prefix} {uid[^Math.Min(4, uid.Length)..]}"
                    : $"{prefix} {validSeq:00}";

            var prof = AllocateNextProfile();
            var hp = AutomationQueueEngine.ExtractProxyHostPort(proxy);
            if (!string.IsNullOrEmpty(hp))
            {
                batchProxyCounts[hp] = batchProxyCounts.GetValueOrDefault(hp) + 1;
            }

            var cleanNotes = ViaMetadataParser.BuildNotes("", tier, warmupStartIso ?? "");
            var hasPayload = !string.IsNullOrEmpty(uid) || !string.IsNullOrEmpty(cookie) || !string.IsNullOrEmpty(twoFa) || !string.IsNullOrEmpty(proxy);
            draftRows.Add(new ParsedBulkViaRow(
                validSeq,
                trimmedLine,
                finalLabel,
                uid,
                twoFa,
                cookie,
                proxy,
                hp,
                prof,
                tier,
                warmupStartIso ?? "",
                cleanNotes,
                strippedSecrets,
                "",
                hasPayload));
        }

        // Second pass: mark duplicate proxy IPs against existing Vias and within this batch
        var dupHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var finalRows = new List<ParsedBulkViaRow>(draftRows.Count);
        int warningCount = 0;

        foreach (var r in draftRows)
        {
            string warn = "";
            if (!string.IsNullOrEmpty(r.ProxyHostPort))
            {
                var exCount = existingProxyCounts.GetValueOrDefault(r.ProxyHostPort);
                var bCount = batchProxyCounts.GetValueOrDefault(r.ProxyHostPort);
                var totalOnIp = exCount + bCount;
                var safeCap = Math.Clamp(maxSafePerProxy, 1, 50);
                if (exCount > 0 || bCount > 1)
                {
                    warn = totalOnIp <= safeCap
                        ? $"ℹ️ Cụm Proxy Dân cư {r.ProxyHostPort} ({totalOnIp}/{safeCap} Via — Trong ngưỡng an toàn)"
                        : $"⚠️ Quá tải Proxy {r.ProxyHostPort} ({totalOnIp} Via > ngưỡng {safeCap} Via/IP)";
                }

                if (!string.IsNullOrEmpty(warn))
                {
                    dupHosts.Add(r.ProxyHostPort);
                    warningCount++;
                }
            }
            finalRows.Add(r with { DuplicateProxyWarning = warn });
        }

        return new ViaBulkParseSummary(finalRows, dupHosts, skippedEmpty, warningCount);
    }
}

/// <summary>
/// RFC 4180 UTF-8-with-BOM CSV builder with Excel formula-injection neutralization.
/// </summary>
public static class CsvExporter
{
    public static string EscapeCell(string? raw)
    {
        var s = (raw ?? "").Replace("\0", "", StringComparison.Ordinal);
        if (s.Length > 0 && (s[0] == '=' || s[0] == '+' || s[0] == '-' || s[0] == '@' || s[0] == '\t' || s[0] == '\r'))
        {
            s = "'" + s;
        }
        if (s.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0)
        {
            return "\"" + s.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
        }
        return s;
    }

    public static byte[] BuildCsvBytes(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string?>> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", headers.Select(EscapeCell)));
        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(",", row.Select(EscapeCell)));
        }
        var utf8Bom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true);
        var preamble = utf8Bom.GetPreamble();
        var body = utf8Bom.GetBytes(sb.ToString());
        var result = new byte[preamble.Length + body.Length];
        Buffer.BlockCopy(preamble, 0, result, 0, preamble.Length);
        Buffer.BlockCopy(body, 0, result, preamble.Length, body.Length);
        return result;
    }
}

public sealed class AutoConnectTokenBridgeRequest
{
    [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
    [JsonPropertyName("browser_profile_label")] public string? BrowserProfileLabel { get; set; }
    [JsonPropertyName("network_label")] public string? NetworkLabel { get; set; }
    [JsonPropertyName("via_label")] public string? ViaLabel { get; set; }
    [JsonPropertyName("via_id")] public string? ViaId { get; set; }
}

public sealed class AutoConnectTokenResponseDto
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("external_reference_id")] public string? ExternalReferenceId { get; set; }
    [JsonPropertyName("email_hint")] public string? EmailHint { get; set; }
    [JsonPropertyName("linked_business_managers")] public int? LinkedBusinessManagers { get; set; }
}

public sealed class AutoConnectTokenBridgeResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("external_reference_id")] public string? ExternalReferenceId { get; set; }
    [JsonPropertyName("email_hint")] public string? EmailHint { get; set; }
    [JsonPropertyName("linked_business_managers")] public int? LinkedBusinessManagers { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public sealed class TelegramBotConfigDto
{
    [JsonPropertyName("enabled")] public bool Enabled { get; set; }
    [JsonPropertyName("bot_configured")] public bool BotConfigured { get; set; }
    [JsonPropertyName("bot_source")] public string? BotSource { get; set; }
    [JsonPropertyName("bot_mask")] public string? BotMask { get; set; }
    [JsonPropertyName("bot_username")] public string? BotUsername { get; set; }
    [JsonPropertyName("bot_name")] public string? BotName { get; set; }
    [JsonPropertyName("chat_configured")] public bool ChatConfigured { get; set; }
    [JsonPropertyName("chat_id_masked")] public string? ChatIdMasked { get; set; }
    [JsonPropertyName("notify_ad_account_disabled")] public bool NotifyAdAccountDisabled { get; set; } = true;
    [JsonPropertyName("notify_billing_failed")] public bool NotifyBillingFailed { get; set; } = true;
    [JsonPropertyName("notify_page_restricted")] public bool NotifyPageRestricted { get; set; } = true;
    [JsonPropertyName("notify_retainer_overspend")] public bool NotifyRetainerOverspend { get; set; } = true;
    [JsonPropertyName("quiet_hours_respect")] public bool QuietHoursRespect { get; set; }
}

public sealed class TelegramDetectedChatDto
{
    [JsonPropertyName("chat_id")] public JsonElement? ChatIdRaw { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }

    public string ChatIdText => AdAccountBillingMetaDto.AsOptionalString(ChatIdRaw) ?? "";
}

public sealed class TelegramDetectChatsResponseDto
{
    [JsonPropertyName("chats")] public List<TelegramDetectedChatDto> Chats { get; set; } = new();
    [JsonPropertyName("hint")] public string? Hint { get; set; }
}

public sealed class SpendCurrencyBucketDto
{
    [JsonPropertyName("currency")] public string Currency { get; set; } = "";
    [JsonPropertyName("total_raw")] public JsonElement? TotalRaw { get; set; }
    [JsonPropertyName("today_partial_raw")] public JsonElement? TodayPartialRaw { get; set; }
    [JsonPropertyName("last_7d_raw")] public JsonElement? Last7dRaw { get; set; }
    [JsonPropertyName("mtd_raw")] public JsonElement? MtdRaw { get; set; }
    [JsonPropertyName("amount_spent_raw")] public JsonElement? AmountSpentRaw { get; set; }
    [JsonPropertyName("accounts_included")] public int AccountsIncluded { get; set; }
    [JsonPropertyName("accounts_without_row")] public int AccountsWithoutRow { get; set; }
    [JsonPropertyName("accounts_not_current")] public int AccountsNotCurrent { get; set; }
    [JsonPropertyName("accounts_currency_conflict")] public int AccountsCurrencyConflict { get; set; }
    [JsonPropertyName("complete")] public bool Complete { get; set; }

    public string TotalText => AdAccountBillingMetaDto.AsOptionalString(TotalRaw) ?? "—";
    public string TodayPartialText => AdAccountBillingMetaDto.AsOptionalString(TodayPartialRaw) ?? "—";
    public string Last7dText => AdAccountBillingMetaDto.AsOptionalString(Last7dRaw) ?? "—";
    public string MtdText => AdAccountBillingMetaDto.AsOptionalString(MtdRaw) ?? "—";
}

public sealed class SpendSummaryDto
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; set; }
    [JsonPropertyName("total_accounts")] public int TotalAccounts { get; set; }
    [JsonPropertyName("accounts_unattributed")] public int AccountsUnattributed { get; set; }
    [JsonPropertyName("currencies")] public List<SpendCurrencyBucketDto> Currencies { get; set; } = new();
    [JsonPropertyName("complete")] public bool Complete { get; set; }
    [JsonPropertyName("disclaimer")] public string? Disclaimer { get; set; }
}

public sealed class DeviceSessionDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("session_type")] public string? SessionType { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("browser_family")] public string? BrowserFamily { get; set; }
    [JsonPropertyName("os_family")] public string? OsFamily { get; set; }
    [JsonPropertyName("last_seen_at")] public DateTimeOffset? LastSeenAt { get; set; }
    [JsonPropertyName("created_at")] public DateTimeOffset CreatedAt { get; set; }
    [JsonPropertyName("expires_at")] public DateTimeOffset ExpiresAt { get; set; }
    [JsonPropertyName("revoked_at")] public DateTimeOffset? RevokedAt { get; set; }
    [JsonPropertyName("revoked_reason")] public string? RevokedReason { get; set; }
    [JsonPropertyName("is_current")] public bool IsCurrent { get; set; }
}

public sealed class RevokeSessionResultDto
{
    [JsonPropertyName("revoked_count")] public int RevokedCount { get; set; }
}

public sealed class TrackedChromeSessionDto
{
    [JsonPropertyName("session_id")] public string SessionId { get; set; } = "";
    [JsonPropertyName("pid")] public int? Pid { get; set; }
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("profile_dir")] public string ProfileDir { get; set; } = "Default";
    [JsonPropertyName("url")] public string Url { get; set; } = "";
    [JsonPropertyName("started_at")] public DateTimeOffset StartedAt { get; set; }
    [JsonPropertyName("keep_alive_closed")] public bool KeepAliveClosed { get; set; }
    [JsonPropertyName("hung_reaped")] public bool HungReaped { get; set; }
    [JsonPropertyName("delegated_to_shared_broker")] public bool DelegatedToSharedBroker { get; set; }
    [JsonPropertyName("isolated_mode")] public bool IsolatedMode { get; set; } = true;
    [JsonPropertyName("closed_at")] public DateTimeOffset? ClosedAt { get; set; }
    [JsonPropertyName("alive")] public bool Alive { get; set; }
    [JsonPropertyName("ram_mb")] public double RamMb { get; set; }
    [JsonPropertyName("cpu_percent")] public double CpuPercent { get; set; }
    [JsonPropertyName("antidetect_engine")] public string AntidetectEngine { get; set; } = "chrome_native";
    [JsonPropertyName("status_text")] public string StatusText { get; set; } = "";
}

public sealed class ChromeSessionTracker
{
    public static ChromeSessionTracker Default { get; } = new();

    private readonly object _gate = new();
    private readonly List<TrackedChromeSessionDto> _sessions = new();
    private readonly Dictionary<int, (TimeSpan TotalCpu, DateTime SampleUtc)> _cpuSamples = new();

    public static bool IsSupportedBrowserProcessName(string? name)
    {
        var s = (name ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(s)) return false;
        return s.Contains("chrome", StringComparison.Ordinal)
            || s.Contains("orbita", StringComparison.Ordinal)
            || s.Contains("sunbrowser", StringComparison.Ordinal)
            || s.Contains("anty", StringComparison.Ordinal)
            || s.Contains("dolphin", StringComparison.Ordinal)
            || s.Contains("hidemyacc", StringComparison.Ordinal)
            || s.Contains("genlogin", StringComparison.Ordinal)
            || s.Contains("chromium", StringComparison.Ordinal)
            || s.Contains("brave", StringComparison.Ordinal)
            || s.Contains("msedge", StringComparison.Ordinal);
    }

    public TrackedChromeSessionDto RecordLaunch(
        int? pid,
        string? viaId,
        string? viaLabel,
        string? profileDir,
        string url,
        string antidetectEngine = "chrome_native",
        bool delegatedToSharedBroker = false,
        bool isolatedMode = true)
    {
        var entry = new TrackedChromeSessionDto
        {
            SessionId = Guid.NewGuid().ToString("N")[..10],
            Pid = pid,
            ViaId = viaId ?? "",
            ViaLabel = string.IsNullOrWhiteSpace(viaLabel) ? (profileDir ?? "Chrome Profile") : viaLabel.Trim(),
            ProfileDir = string.IsNullOrWhiteSpace(profileDir) ? "Default" : profileDir.Trim(),
            Url = url,
            AntidetectEngine = AntidetectBrowserConnector.NormalizeEngine(antidetectEngine),
            DelegatedToSharedBroker = delegatedToSharedBroker,
            IsolatedMode = isolatedMode,
            StartedAt = DateTimeOffset.UtcNow,
        };
        lock (_gate)
        {
            _sessions.Insert(0, entry);
            if (_sessions.Count > 30)
            {
                _sessions.RemoveRange(30, _sessions.Count - 30);
            }
        }
        return CloneWithProcessProbe(entry, _cpuSamples, _gate);
    }

    public void MarkKeepAliveClosed(string? viaId, string? viaLabel, string? profileDir)
    {
        lock (_gate)
        {
            var match = _sessions.FirstOrDefault(s =>
                !s.ClosedAt.HasValue &&
                ((!string.IsNullOrWhiteSpace(viaId) && string.Equals(s.ViaId, viaId, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(profileDir) && string.Equals(s.ProfileDir, profileDir, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(viaLabel) && string.Equals(s.ViaLabel, viaLabel, StringComparison.OrdinalIgnoreCase))));
            if (match != null)
            {
                match.KeepAliveClosed = true;
                match.ClosedAt = DateTimeOffset.UtcNow;
            }
        }
    }

    public List<TrackedChromeSessionDto> GetSnapshot()
    {
        List<TrackedChromeSessionDto> copy;
        lock (_gate)
        {
            copy = _sessions.ToList();
            return copy.Select(s => CloneWithProcessProbe(s, _cpuSamples, _gate)).ToList();
        }
    }

    public bool TryCloseSession(string sessionId, out string message)
    {
        TrackedChromeSessionDto? target;
        lock (_gate)
        {
            target = _sessions.FirstOrDefault(s => string.Equals(s.SessionId, sessionId, StringComparison.OrdinalIgnoreCase));
        }
        if (target == null)
        {
            message = "Không tìm thấy phiên Chrome trong danh sách theo dõi.";
            return false;
        }
        if (target.DelegatedToSharedBroker)
        {
            target.ClosedAt = DateTimeOffset.UtcNow;
            message = $"Đã gỡ theo dõi phiên {target.ProfileDir} trên Chrome Gốc (đóng trực tiếp cửa sổ Chrome để tránh tắt các Profile khác).";
            return true;
        }
        if (!target.Pid.HasValue || target.Pid.Value <= 0)
        {
            target.ClosedAt ??= DateTimeOffset.UtcNow;
            message = "Phiên trình duyệt này không có PID trực tiếp.";
            return false;
        }
        try
        {
            using var proc = System.Diagnostics.Process.GetProcessById(target.Pid.Value);
            if (proc.HasExited)
            {
                target.ClosedAt ??= DateTimeOffset.UtcNow;
                message = $"Tiến trình trình duyệt PID {target.Pid.Value} đã thoát trước đó.";
                return true;
            }
            if (!IsSupportedBrowserProcessName(proc.ProcessName))
            {
                message = $"PID {target.Pid.Value} không còn là tiến trình trình duyệt ({proc.ProcessName}).";
                return false;
            }
            var sent = proc.CloseMainWindow();
            if (!sent)
            {
                proc.Kill(entireProcessTree: false);
            }
            target.ClosedAt = DateTimeOffset.UtcNow;
            message = $"Đã đóng an toàn cửa sổ trình duyệt PID {target.Pid.Value} ({target.ProfileDir}).";
            return true;
        }
        catch (ArgumentException)
        {
            target.ClosedAt ??= DateTimeOffset.UtcNow;
            message = $"Tiến trình trình duyệt PID {target.Pid.Value} đã kết thúc.";
            return true;
        }
        catch (Exception ex)
        {
            message = $"Không thể đóng PID {target.Pid.Value}: {ex.Message}";
            return false;
        }
    }

    private static TrackedChromeSessionDto CloneWithProcessProbe(
        TrackedChromeSessionDto src,
        Dictionary<int, (TimeSpan TotalCpu, DateTime SampleUtc)> cpuSamples,
        object gate)
    {
        bool alive = false;
        double ramMb = 0;
        double cpuPct = 0;
        if (!src.ClosedAt.HasValue && src.Pid.HasValue && src.Pid.Value > 0)
        {
            try
            {
                using var proc = System.Diagnostics.Process.GetProcessById(src.Pid.Value);
                if (!proc.HasExited && IsSupportedBrowserProcessName(proc.ProcessName))
                {
                    alive = true;
                    proc.Refresh();
                    ramMb = Math.Round(proc.WorkingSet64 / (1024.0 * 1024.0), 1);

                    var nowUtc = DateTime.UtcNow;
                    var curCpu = proc.TotalProcessorTime;
                    lock (gate)
                    {
                        if (cpuSamples.TryGetValue(proc.Id, out var prev))
                        {
                            var wallMs = (nowUtc - prev.SampleUtc).TotalMilliseconds;
                            if (wallMs >= 150)
                            {
                                var cpuDeltaMs = Math.Max(0, (curCpu - prev.TotalCpu).TotalMilliseconds);
                                cpuPct = Math.Round(cpuDeltaMs / (wallMs * Math.Max(1, Environment.ProcessorCount)) * 100.0, 1);
                                cpuSamples[proc.Id] = (curCpu, nowUtc);
                            }
                        }
                        else
                        {
                            cpuSamples[proc.Id] = (curCpu, nowUtc);
                        }
                    }
                }
            }
            catch
            {
                alive = false;
            }

            if (!alive && !src.ClosedAt.HasValue && src.Pid.HasValue && src.Pid.Value > 0 &&
                (DateTimeOffset.UtcNow - src.StartedAt).TotalSeconds >= 2.0)
            {
                src.ClosedAt = DateTimeOffset.UtcNow;
            }
        }

        string status = src.HungReaped
            ? "⏱️ Đã tự đóng do treo quá hạn"
            : src.KeepAliveClosed
                ? "Đã tự đóng sau Keep-Alive"
                : alive
                    ? (src.DelegatedToSharedBroker
                        ? $"Đang mở • Chrome Gốc (PID {src.Pid} • {ramMb:0.0} MB)"
                        : $"Đang mở (PID {src.Pid} • {ramMb:0.0} MB • {cpuPct:0.0}% CPU)")
                    : src.ClosedAt.HasValue
                        ? "Đã đóng cửa sổ"
                        : src.Pid.HasValue
                            ? "Đã mở cửa sổ Chrome"
                            : "Không có PID";

        return new TrackedChromeSessionDto
        {
            SessionId = src.SessionId,
            Pid = src.Pid,
            ViaId = src.ViaId,
            ViaLabel = src.ViaLabel,
            ProfileDir = src.ProfileDir,
            Url = src.Url,
            StartedAt = src.StartedAt,
            KeepAliveClosed = src.KeepAliveClosed,
            HungReaped = src.HungReaped,
            DelegatedToSharedBroker = src.DelegatedToSharedBroker,
            IsolatedMode = src.IsolatedMode,
            ClosedAt = src.ClosedAt,
            Alive = alive,
            RamMb = ramMb,
            CpuPercent = cpuPct,
            AntidetectEngine = src.AntidetectEngine,
            StatusText = status,
        };
    }

    public List<TrackedChromeSessionDto> ReapHungSessions(int timeoutSeconds)
    {
        var reaped = new List<TrackedChromeSessionDto>();
        if (timeoutSeconds < 0) return reaped;
        var now = DateTimeOffset.UtcNow;
        List<TrackedChromeSessionDto> candidates;
        lock (_gate)
        {
            candidates = _sessions
                .Where(s => !s.ClosedAt.HasValue &&
                            !s.DelegatedToSharedBroker &&
                            s.Pid.HasValue &&
                            s.Pid.Value > 0 &&
                            (now - s.StartedAt).TotalSeconds >= timeoutSeconds)
                .ToList();
            foreach (var c in candidates)
            {
                try
                {
                    using var proc = System.Diagnostics.Process.GetProcessById(c.Pid!.Value);
                    if (!proc.HasExited && IsSupportedBrowserProcessName(proc.ProcessName))
                    {
                        if (!proc.CloseMainWindow())
                        {
                            proc.Kill(entireProcessTree: false);
                        }
                    }
                }
                catch
                {
                    // Process already exited or unreachable; mark closed so queue doesn't stall
                }
                c.HungReaped = true;
                c.ClosedAt = now;
                reaped.Add(CloneWithProcessProbe(c, _cpuSamples, _gate));
            }
        }
        return reaped;
    }
}

public static class DesktopAppInfo
{
    public const string Version = "3.0.2";
    public const string DisplayVersion = "v3.0.2";
    public const string ExtVersion = "2.10.0";
    public const string DefaultManifestUrl = "https://adsops-app.vibe.tinhgon.xyz/downloads/AdsOps-Desktop-Pro-latest.json";

    /// <summary>
    /// Chuẩn hóa chuỗi proxy thành khóa scheme://host:port viết thường giống parse_proxy_spec trên Backend.
    /// </summary>
    public static string NormalizeProxyKey(string? raw)
    {
        var clean = (raw ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(clean) || clean.Length > 256) return string.Empty;

        var m4 = Regex.Match(clean, @"^([A-Za-z0-9.\-]+):(\d{1,5}):([^:\s]+):(.+)$");
        if (m4.Success && int.TryParse(m4.Groups[2].Value, out var p4) && p4 is >= 1 and <= 65535)
        {
            return $"http://{m4.Groups[1].Value.ToLowerInvariant()}:{p4}";
        }

        var m2 = Regex.Match(clean, @"^([A-Za-z0-9.\-]+):(\d{1,5})$");
        if (m2.Success && int.TryParse(m2.Groups[2].Value, out var p2) && p2 is >= 1 and <= 65535)
        {
            return $"http://{m2.Groups[1].Value.ToLowerInvariant()}:{p2}";
        }

        var mu = Regex.Match(clean, @"^(https?|socks5h?|socks4)://(?:([^:@\s]+)(?::([^@\s]*))?@)?([A-Za-z0-9.\-]+):(\d{1,5})(?:/.*)?$", RegexOptions.IgnoreCase);
        if (mu.Success && int.TryParse(mu.Groups[5].Value, out var pu) && pu is >= 1 and <= 65535)
        {
            return $"{mu.Groups[1].Value.ToLowerInvariant()}://{mu.Groups[4].Value.ToLowerInvariant()}:{pu}";
        }

        return clean.ToLowerInvariant();
    }
}

// ---------- Group 1: Proxy Live Health + Extension Billing Auto-Sync DTOs ----------

public sealed class PagedResponse<T>
{
    [JsonPropertyName("items")] public List<T> Items { get; set; } = new();
    [JsonPropertyName("page")] public int Page { get; set; }
    [JsonPropertyName("page_size")] public int PageSize { get; set; }
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class ProxyHealthMapResponseDto
{
    [JsonPropertyName("health_map")] public Dictionary<string, ProxyCheckResultDto> HealthMap { get; set; } = new();
}

public sealed class BillingSyncRequestDto
{
    [JsonPropertyName("external_account_id")] public string ExternalAccountId { get; set; } = string.Empty;
    [JsonPropertyName("billing_threshold_raw")] public string? BillingThresholdRaw { get; set; }
    [JsonPropertyName("next_bill_date")] public string? NextBillDate { get; set; }
    [JsonPropertyName("meta_daily_limit_raw")] public string? MetaDailyLimitRaw { get; set; }
    [JsonPropertyName("payment_card_display")] public string? PaymentCardDisplay { get; set; }
    [JsonPropertyName("balance_raw")] public string? BalanceRaw { get; set; }
    [JsonPropertyName("via_id")] public string? ViaId { get; set; }
    [JsonPropertyName("via_label")] public string? ViaLabel { get; set; }
    [JsonPropertyName("browser_profile")] public string? BrowserProfile { get; set; }
}

public sealed class BillingSyncResponseDto
{
    [JsonPropertyName("status")] public string Status { get; set; } = string.Empty;
    [JsonPropertyName("ad_account_id")] public string? AdAccountId { get; set; }
    [JsonPropertyName("updated_fields")] public List<string>? UpdatedFields { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

// ---------- Group 2: Native Win32 Chrome Window Grid Tiler + Self-Updater ----------

public sealed class TileWindowsRequestDto
{
    [JsonPropertyName("grid")] public string? Grid { get; set; }
    [JsonPropertyName("pids")] public List<int>? Pids { get; set; }
}

public sealed class TileWindowsResultDto
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("grid")] public string Grid { get; set; } = "2x2";
    [JsonPropertyName("tiled_count")] public int TiledCount { get; set; }
    [JsonPropertyName("screen")] public string Screen { get; set; } = string.Empty;
    [JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [JsonPropertyName("error")] public string? Error { get; set; }
}

/// <summary>Sắp xếp các cửa sổ Chrome đang mở thành lưới 2x2 / 3x2 / 2x1 / 3x3 bằng Win32 User32.</summary>
public static class WindowTilerService
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const int SwRestore = 9;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    public static (int Cols, int Rows, string Normalized) ParseGridSpec(string? spec)
    {
        var clean = (spec ?? "2x2").Trim().ToLowerInvariant().Replace("×", "x");
        return clean switch
        {
            "2x1" => (2, 1, "2x1"),
            "1x2" => (1, 2, "1x2"),
            "3x2" => (3, 2, "3x2"),
            "3x3" => (3, 3, "3x3"),
            _ => (2, 2, "2x2"),
        };
    }

    public static TileWindowsResultDto TileChromeWindows(string? gridSpec, IReadOnlyCollection<int>? prioritizedPids = null)
    {
        var (cols, rows, normalized) = ParseGridSpec(gridSpec);
        var prioritySet = new HashSet<int>(prioritizedPids ?? Array.Empty<int>());

        var chromePids = new HashSet<int>();
        foreach (var proc in Process.GetProcessesByName("chrome"))
        {
            try { chromePids.Add(proc.Id); }
            catch { }
            finally { proc.Dispose(); }
        }

        if (chromePids.Count == 0 && prioritySet.Count == 0)
        {
            return new TileWindowsResultDto
            {
                Ok = false,
                Grid = normalized,
                TiledCount = 0,
                Message = "Chưa phát hiện cửa sổ Chrome nào đang mở để xếp lưới.",
                Error = "no_chrome_windows",
            };
        }

        var candidates = new List<(IntPtr Handle, int Pid, bool IsPriority)>();
        EnumWindows((hWnd, lParam) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            _ = GetWindowThreadProcessId(hWnd, out var pidU);
            var pid = unchecked((int)pidU);
            var isPri = prioritySet.Contains(pid);
            if (!isPri && !chromePids.Contains(pid)) return true;
            if (GetWindowTextLength(hWnd) <= 0 && !isPri) return true;
            candidates.Add((hWnd, pid, isPri));
            return true;
        }, IntPtr.Zero);

        var ordered = candidates
            .GroupBy(c => c.Handle)
            .Select(g => g.First())
            .OrderByDescending(c => c.IsPriority)
            .ThenBy(c => c.Pid)
            .ThenBy(c => c.Handle.ToInt64())
            .ToList();

        if (ordered.Count == 0)
        {
            return new TileWindowsResultDto
            {
                Ok = false,
                Grid = normalized,
                TiledCount = 0,
                Message = "Không tìm thấy cửa sổ Chrome hợp lệ (có thể đã thu nhỏ hoàn toàn).",
                Error = "no_visible_windows",
            };
        }

        var screens = System.Windows.Forms.Screen.AllScreens;
        var primary = System.Windows.Forms.Screen.PrimaryScreen ?? (screens.Length > 0 ? screens[0] : null);
        System.Drawing.Rectangle area = primary?.WorkingArea ?? new System.Drawing.Rectangle(0, 0, 1920, 1040);

        const int gap = 4;
        var capacity = cols * rows;
        var toTile = ordered.Take(capacity).ToList();
        var cellW = Math.Max(320, (area.Width - gap * (cols + 1)) / cols);
        var cellH = Math.Max(240, (area.Height - gap * (rows + 1)) / rows);

        var moved = 0;
        for (var i = 0; i < toTile.Count; i++)
        {
            var col = i % cols;
            var row = i / cols;
            var x = area.X + gap + col * (cellW + gap);
            var y = area.Y + gap + row * (cellH + gap);
            var hWnd = toTile[i].Handle;
            if (IsIconic(hWnd))
            {
                ShowWindow(hWnd, SwRestore);
            }
            if (SetWindowPos(hWnd, IntPtr.Zero, x, y, cellW, cellH, SwpNoZOrder | SwpNoActivate | SwpShowWindow))
            {
                moved++;
            }
        }

        return new TileWindowsResultDto
        {
            Ok = moved > 0,
            Grid = normalized,
            TiledCount = moved,
            Screen = $"{area.Width}x{area.Height}",
            Message = $"Đã xếp {moved}/{ordered.Count} cửa sổ Chrome theo lưới {normalized} ({area.Width}×{area.Height}).",
        };
    }
}

public sealed class CommunityQuotaDto
{
    [JsonPropertyName("plan_tier")] public string PlanTier { get; set; } = "community_free";
    [JsonPropertyName("community_status")] public string CommunityStatus { get; set; } = "active";
    [JsonPropertyName("max_vias")] public int MaxVias { get; set; } = 10;
    [JsonPropertyName("vias_used")] public int ViasUsed { get; set; }
    [JsonPropertyName("max_ad_accounts")] public int MaxAdAccounts { get; set; } = 5;
    [JsonPropertyName("ad_accounts_used")] public int AdAccountsUsed { get; set; }
    [JsonPropertyName("max_members")] public int MaxMembers { get; set; } = 2;
    [JsonPropertyName("members_used")] public int MembersUsed { get; set; }
    [JsonPropertyName("invited_by_code")] public string? InvitedByCode { get; set; }
    [JsonPropertyName("is_platform_admin")] public bool IsPlatformAdmin { get; set; }
}

public sealed class CloudSnapshotPayload
{
    [JsonPropertyName("user_email")] public string UserEmail { get; set; } = "";
    [JsonPropertyName("saved_at_utc")] public string SavedAtUtc { get; set; } = DateTime.UtcNow.ToString("O");
    [JsonPropertyName("current_user")] public CurrentUserDto? CurrentUser { get; set; }
    [JsonPropertyName("personal_accounts")] public List<PersonalAccountRefDto> PersonalAccounts { get; set; } = new();
    [JsonPropertyName("business_managers")] public List<BusinessManagerItemDto> BusinessManagers { get; set; } = new();
    [JsonPropertyName("ad_accounts")] public List<AdAccountItemDto> AdAccounts { get; set; } = new();
    [JsonPropertyName("pages_summary")] public FacebookPagesSummaryDto? PagesSummary { get; set; }
    [JsonPropertyName("health_summary")] public HealthSummaryDto? HealthSummary { get; set; }
    [JsonPropertyName("community_quota")] public CommunityQuotaDto? CommunityQuota { get; set; }
    [JsonPropertyName("playbooks")] public List<AutomationPlaybookDto> Playbooks { get; set; } = new();
}

/// <summary>Lưu đệm bảng dữ liệu Cloud gần nhất được mã hóa Windows DPAPI để App chạy mượt ngay cả khi mất mạng hoặc Cloud bảo trì.</summary>
public static class CloudSnapshotCacheStore
{
    public static string DefaultCachePath => Path.Combine(DesktopConfig.AppDataRoot, "cloud_snapshot.dpapi");

    public static void Save(CloudSnapshotPayload payload, string? customPath = null)
    {
        if (payload == null) return;
        var path = customPath ?? DefaultCachePath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var plainBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        var encBytes = WindowsDpapi.Protect(plainBytes);
        File.WriteAllBytes(path, encBytes);
    }

    public static CloudSnapshotPayload? Load(string? expectedUserEmail = null, string? customPath = null)
    {
        var path = customPath ?? DefaultCachePath;
        try
        {
            if (!File.Exists(path)) return null;
            var encBytes = File.ReadAllBytes(path);
            if (encBytes.Length == 0) return null;
            var plainBytes = WindowsDpapi.Unprotect(encBytes);
            var payload = JsonSerializer.Deserialize<CloudSnapshotPayload>(Encoding.UTF8.GetString(plainBytes));
            if (payload == null) return null;
            if (!string.IsNullOrWhiteSpace(expectedUserEmail) &&
                !string.IsNullOrWhiteSpace(payload.UserEmail) &&
                !string.Equals(payload.UserEmail.Trim(), expectedUserEmail.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return payload;
        }
        catch
        {
            return null;
        }
    }
}

public sealed record BinaryIntegrityReport(
    string ExePath,
    string Sha256Hex,
    long SizeBytes,
    string SignatureStatus,
    string SignerSubject,
    bool HasEmbeddedSignature);

/// <summary>Kiểm tra mã băm SHA-256 thực tế và chứng chỉ chữ ký số Authenticode của tệp EXE đang chạy.</summary>
public static class BinaryIntegrityInspector
{
    public static BinaryIntegrityReport InspectCurrentProcess()
    {
        var path = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "AdsOpsDesktop.exe");
        return InspectFile(path);
    }

    public static BinaryIntegrityReport InspectFile(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
        {
            return new BinaryIntegrityReport(filePath ?? "", "", 0, "FILE_NOT_FOUND", "", false);
        }

        var fi = new FileInfo(filePath);
        string shaHex;
        using (var fs = File.OpenRead(filePath))
        {
            shaHex = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
        }

        string sigStatus = "Unsigned (SHA-256 Verified)";
        string signerSubject = "";
        bool hasSig = false;
        try
        {
            var rawCertBytes = System.Security.Cryptography.X509Certificates.X509Certificate2.GetCertContentType(filePath);
            if (rawCertBytes == System.Security.Cryptography.X509Certificates.X509ContentType.Authenticode)
            {
                var cert = new System.Security.Cryptography.X509Certificates.X509Certificate2(filePath);
                hasSig = true;
                signerSubject = cert.Subject ?? "";
                var expired = DateTime.Now > cert.NotAfter;
                sigStatus = expired ? "Signed (Certificate Expired)" : "Authenticode Signed";
                cert.Dispose();
            }
        }
        catch
        {
            // Normal unsigned executable falls through cleanly
        }

        return new BinaryIntegrityReport(filePath, shaHex, fi.Length, sigStatus, signerSubject, hasSig);
    }
}

public sealed class UpdateManifestDto
{
    [JsonPropertyName("version")] public string Version { get; set; } = string.Empty;
    [JsonPropertyName("ext_version")] public string ExtVersion { get; set; } = string.Empty;
    [JsonPropertyName("release_notes")] public string ReleaseNotes { get; set; } = string.Empty;
    [JsonPropertyName("download_url")] public string DownloadUrl { get; set; } = string.Empty;
    [JsonPropertyName("mirror_urls")] public List<string>? MirrorUrls { get; set; }
    [JsonPropertyName("authenticode_signed")] public bool AuthenticodeSigned { get; set; }
    [JsonPropertyName("sha256")] public string? Sha256 { get; set; }
    [JsonPropertyName("size_bytes")] public long SizeBytes { get; set; }
    [JsonPropertyName("published_at")] public string? PublishedAt { get; set; }
}

public sealed class SelfUpdateCheckResultDto
{
    public bool Ok { get; set; }
    public bool UpdateAvailable { get; set; }
    public string CurrentVersion { get; set; } = DesktopAppInfo.Version;
    public string LatestVersion { get; set; } = string.Empty;
    public UpdateManifestDto? Manifest { get; set; }
    public string? Error { get; set; }
}

/// <summary>Kiểm tra manifest phát hành, tải gói ZIP an toàn (hỗ trợ đa mirror CDN) và chạy script PowerShell tự cập nhật EXE.</summary>
public static class SelfUpdateService
{
    public static bool IsNewerVersion(string? candidate, string current = DesktopAppInfo.Version)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return false;
        static System.Version? ParseClean(string raw)
        {
            var s = raw.Trim().TrimStart('v', 'V');
            var plusIdx = s.IndexOfAny(new[] { '-', '+' });
            if (plusIdx > 0) s = s[..plusIdx];
            return System.Version.TryParse(s, out var v) ? v : null;
        }
        var cVer = ParseClean(candidate);
        var curVer = ParseClean(current);
        if (cVer == null || curVer == null)
        {
            return !string.Equals(candidate.Trim().TrimStart('v', 'V'), current.Trim().TrimStart('v', 'V'), StringComparison.OrdinalIgnoreCase);
        }
        return cVer > curVer;
    }

    public static async Task<SelfUpdateCheckResultDto> FetchManifestAsync(HttpClient http, string? manifestUrl = null, CancellationToken ct = default)
    {
        var url = string.IsNullOrWhiteSpace(manifestUrl) ? DesktopAppInfo.DefaultManifestUrl : manifestUrl.Trim();
        try
        {
            using var resp = await http.GetAsync(url, ct);
            var json = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                return new SelfUpdateCheckResultDto { Ok = false, Error = $"HTTP {(int)resp.StatusCode} khi kiểm tra bản mới." };
            }
            var manifest = JsonSerializer.Deserialize<UpdateManifestDto>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (manifest == null || string.IsNullOrWhiteSpace(manifest.Version))
            {
                return new SelfUpdateCheckResultDto { Ok = false, Error = "Manifest cập nhật thiếu trường version." };
            }
            return new SelfUpdateCheckResultDto
            {
                Ok = true,
                UpdateAvailable = IsNewerVersion(manifest.Version, DesktopAppInfo.Version),
                CurrentVersion = DesktopAppInfo.Version,
                LatestVersion = manifest.Version,
                Manifest = manifest,
            };
        }
        catch (Exception ex)
        {
            return new SelfUpdateCheckResultDto { Ok = false, Error = ex.Message };
        }
    }

    public static async Task<string> DownloadValidateExtractAndSpawnUpdaterAsync(
        HttpClient http,
        UpdateManifestDto manifest,
        int currentPid,
        string appDir,
        string exeName = "AdsOpsDesktop.exe",
        Action<string>? log = null,
        CancellationToken ct = default)
    {
        var candidateUrls = new List<string>();
        if (!string.IsNullOrWhiteSpace(manifest.DownloadUrl)) candidateUrls.Add(manifest.DownloadUrl.Trim());
        if (manifest.MirrorUrls != null)
        {
            foreach (var mu in manifest.MirrorUrls)
            {
                var clean = (mu ?? "").Trim();
                if (!string.IsNullOrWhiteSpace(clean) && !candidateUrls.Contains(clean, StringComparer.OrdinalIgnoreCase))
                {
                    candidateUrls.Add(clean);
                }
            }
        }
        if (candidateUrls.Count == 0)
        {
            throw new InvalidOperationException("Manifest thiếu download_url.");
        }

        var rootTemp = Path.Combine(Path.GetTempPath(), "AdsOpsDesktopUpdate");
        Directory.CreateDirectory(rootTemp);
        var stamp = DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture);
        var zipPath = Path.Combine(rootTemp, $"update_{stamp}.zip");
        var stagingDir = Path.Combine(rootTemp, $"staging_{stamp}");

        byte[]? zipBytes = null;
        Exception? lastErr = null;
        foreach (var srcUrl in candidateUrls)
        {
            try
            {
                log?.Invoke($"Đang tải bản cập nhật {manifest.Version} từ {srcUrl}...");
                var candidateBytes = await http.GetByteArrayAsync(srcUrl, ct);
                if (candidateBytes.Length < 100 || candidateBytes[0] != 0x50 || candidateBytes[1] != 0x4B)
                {
                    throw new InvalidDataException("Tệp tải về không phải định dạng ZIP hợp lệ (PK header mismatch).");
                }
                if (!string.IsNullOrWhiteSpace(manifest.Sha256))
                {
                    var actualHash = Convert.ToHexString(SHA256.HashData(candidateBytes)).ToLowerInvariant();
                    if (!string.Equals(actualHash, manifest.Sha256.Trim().ToLowerInvariant(), StringComparison.Ordinal))
                    {
                        throw new InvalidDataException("Mã kiểm tra SHA-256 gói cập nhật không khớp.");
                    }
                }
                zipBytes = candidateBytes;
                break;
            }
            catch (Exception ex)
            {
                lastErr = ex;
                log?.Invoke($"Nguồn {srcUrl} thất bại ({ex.Message}), thử mirror tiếp theo...");
            }
        }

        if (zipBytes == null)
        {
            throw lastErr ?? new InvalidOperationException("Không tải được gói cập nhật từ bất kỳ nguồn nào.");
        }

        await File.WriteAllBytesAsync(zipPath, zipBytes, ct);
        Directory.CreateDirectory(stagingDir);
        ZipFile.ExtractToDirectory(zipPath, stagingDir, overwriteFiles: true);

        var stagedExe = Path.Combine(stagingDir, exeName);
        if (!File.Exists(stagedExe))
        {
            throw new FileNotFoundException($"Gói ZIP thiếu tệp thực thi {exeName}.");
        }

        var psScriptPath = Path.Combine(rootTemp, "apply_update.ps1");
        static string EscPs(string s) => s.Replace("'", "''");
        var psLines = new[]
        {
            $"$targetPid = {currentPid}",
            $"$staging = '{EscPs(stagingDir)}'",
            $"$dest = '{EscPs(appDir)}'",
            $"$zip = '{EscPs(zipPath)}'",
            $"$exe = '{EscPs(Path.Combine(appDir, exeName))}'",
            "for ($i = 0; $i -lt 60; $i++) {",
            "  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue",
            "  if (-not $p) { break }",
            "  Start-Sleep -Milliseconds 500",
            "}",
            "Copy-Item -Path (Join-Path $staging '*') -Destination $dest -Recurse -Force",
            "Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue",
            "Remove-Item -Path $zip -Force -ErrorAction SilentlyContinue",
            "if (Test-Path $exe) { Start-Process -FilePath $exe }",
        };
        await File.WriteAllTextAsync(
            psScriptPath,
            string.Join("\r\n", psLines) + "\r\n",
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: true),
            ct);

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{psScriptPath}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(psi);
        log?.Invoke($"Đã sẵn sàng cập nhật v{manifest.Version}, đang khởi động lại ứng dụng...");
        return stagingDir;
    }
}

// ---------- Group 3: Readiness Board, Health Signals & Live Audit Logs ----------

public sealed class HealthSignalDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("ad_account_id")] public string AdAccountId { get; set; } = string.Empty;
    [JsonPropertyName("rule_key")] public string RuleKey { get; set; } = string.Empty;
    [JsonPropertyName("rule_version")] public int RuleVersion { get; set; }
    [JsonPropertyName("signal_key")] public string SignalKey { get; set; } = string.Empty;
    [JsonPropertyName("category")] public string Category { get; set; } = string.Empty;
    [JsonPropertyName("severity")] public string Severity { get; set; } = "warning";
    [JsonPropertyName("status")] public string Status { get; set; } = "open";
    [JsonPropertyName("source_type")] public string SourceType { get; set; } = string.Empty;
    [JsonPropertyName("observed_at")] public string? ObservedAt { get; set; }
    [JsonPropertyName("last_evaluated_at")] public string? LastEvaluatedAt { get; set; }
    [JsonPropertyName("acknowledgement_note")] public string? AcknowledgementNote { get; set; }
    [JsonPropertyName("resolution_reason")] public string? ResolutionReason { get; set; }
    [JsonPropertyName("rule_name")] public string? RuleName { get; set; }
    [JsonPropertyName("why_it_matters")] public string? WhyItMatters { get; set; }
    [JsonPropertyName("recommended_next_step")] public string? RecommendedNextStep { get; set; }
    [JsonPropertyName("resolution_guidance")] public string? ResolutionGuidance { get; set; }
}

public sealed class ReadinessSummaryDto
{
    [JsonPropertyName("total_active")] public int TotalActive { get; set; }
    [JsonPropertyName("operationally_ready")] public int OperationallyReady { get; set; }
    [JsonPropertyName("ready_with_warnings")] public int ReadyWithWarnings { get; set; }
    [JsonPropertyName("not_ready")] public int NotReady { get; set; }
    [JsonPropertyName("unknown")] public int Unknown { get; set; }
    [JsonPropertyName("archived")] public int Archived { get; set; }
}

public sealed class ReadinessReasonDto
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [JsonPropertyName("severity")] public string Severity { get; set; } = "warning";
}

public sealed class ReadinessBoardRowDto
{
    [JsonPropertyName("ad_account_id")] public string AdAccountId { get; set; } = string.Empty;
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = string.Empty;
    [JsonPropertyName("external_account_id")] public string ExternalAccountId { get; set; } = string.Empty;
    [JsonPropertyName("readiness_status")] public string ReadinessStatus { get; set; } = "unknown";
    [JsonPropertyName("status")] public string Status { get; set; } = string.Empty;
    [JsonPropertyName("required_item_count")] public int RequiredItemCount { get; set; }
    [JsonPropertyName("completed_item_count")] public int CompletedItemCount { get; set; }
    [JsonPropertyName("reasons")] public List<ReadinessReasonDto> Reasons { get; set; } = new();
}

public sealed class ReadinessBoardAccountRefDto
{
    [JsonPropertyName("ad_account_id")] public string AdAccountId { get; set; } = string.Empty;
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = string.Empty;
}

public sealed class ReadinessBoardGroupDto
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [JsonPropertyName("severity")] public string Severity { get; set; } = string.Empty;
    [JsonPropertyName("accounts")] public List<ReadinessBoardAccountRefDto> Accounts { get; set; } = new();
}

public sealed class ReadinessBoardDto
{
    [JsonPropertyName("rows")] public List<ReadinessBoardRowDto> Rows { get; set; } = new();
    [JsonPropertyName("groups")] public List<ReadinessBoardGroupDto> Groups { get; set; } = new();
}

public sealed class AuditLogEntryDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("actor_id")] public string? ActorId { get; set; }
    [JsonPropertyName("actor_email")] public string? ActorEmail { get; set; }
    [JsonPropertyName("action")] public string Action { get; set; } = string.Empty;
    [JsonPropertyName("entity_type")] public string EntityType { get; set; } = string.Empty;
    [JsonPropertyName("entity_id")] public string EntityId { get; set; } = string.Empty;
    [JsonPropertyName("request_id")] public string? RequestId { get; set; }
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = string.Empty;
}

// ---------- Group 4: Pixels, Domain SEO, Client Retainers & Team/Seats ----------

public sealed class PixelDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("external_pixel_id")] public string? ExternalPixelId { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "unknown";
    [JsonPropertyName("notes")] public string Notes { get; set; } = string.Empty;
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
}

public sealed class DomainSeoChecklistItemDto
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("label")] public string Label { get; set; } = string.Empty;
    [JsonPropertyName("ready")] public bool Ready { get; set; }
}

public sealed class DomainSeoConfigDto
{
    [JsonPropertyName("custom_domain")] public string CustomDomain { get; set; } = string.Empty;
    [JsonPropertyName("effective_public_url")] public string EffectivePublicUrl { get; set; } = string.Empty;
    [JsonPropertyName("default_env_cors_count")] public int DefaultEnvCorsCount { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
    [JsonPropertyName("seo_checklist")] public List<DomainSeoChecklistItemDto> SeoChecklist { get; set; } = new();
}

public sealed class RetainerLinkedAccountDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = string.Empty;
    [JsonPropertyName("external_account_id")] public string ExternalAccountId { get; set; } = string.Empty;
    [JsonPropertyName("bm_name")] public string? BmName { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = string.Empty;
    [JsonPropertyName("currency")] public string Currency { get; set; } = "VND";
    [JsonPropertyName("payment_card_display")] public string? PaymentCardDisplay { get; set; }
    [JsonPropertyName("today_vnd")] public long TodayVnd { get; set; }
    [JsonPropertyName("last_7d_vnd")] public long Last7dVnd { get; set; }
    [JsonPropertyName("mtd_vnd")] public long MtdVnd { get; set; }
    [JsonPropertyName("lifetime_vnd")] public long LifetimeVnd { get; set; }
    [JsonPropertyName("balance_vnd")] public long BalanceVnd { get; set; }
}

public sealed class ClientRetainerItemDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("contract_code")] public string ContractCode { get; set; } = string.Empty;
    [JsonPropertyName("client_name")] public string ClientName { get; set; } = string.Empty;
    [JsonPropertyName("project_name")] public string ProjectName { get; set; } = string.Empty;
    [JsonPropertyName("contact_email")] public string ContactEmail { get; set; } = string.Empty;
    [JsonPropertyName("tax_id")] public string TaxId { get; set; } = string.Empty;
    [JsonPropertyName("billing_cycle")] public string BillingCycle { get; set; } = string.Empty;
    [JsonPropertyName("committed_budget_vnd")] public long CommittedBudgetVnd { get; set; }
    [JsonPropertyName("agency_fee_percent")] public double AgencyFeePercent { get; set; }
    [JsonPropertyName("meta_tax_percent")] public double MetaTaxPercent { get; set; }
    [JsonPropertyName("usd_to_vnd_rate")] public double UsdToVndRate { get; set; } = 25400;
    [JsonPropertyName("notes")] public string Notes { get; set; } = string.Empty;
    [JsonPropertyName("ad_account_ids")] public List<string> AdAccountIds { get; set; } = new();
    [JsonPropertyName("linked_accounts")] public List<RetainerLinkedAccountDto> LinkedAccounts { get; set; } = new();
    [JsonPropertyName("account_count")] public int AccountCount { get; set; }
    [JsonPropertyName("spend_today_vnd")] public long SpendTodayVnd { get; set; }
    [JsonPropertyName("spend_7d_vnd")] public long Spend7dVnd { get; set; }
    [JsonPropertyName("spend_mtd_vnd")] public long SpendMtdVnd { get; set; }
    [JsonPropertyName("spend_lifetime_vnd")] public long SpendLifetimeVnd { get; set; }
    [JsonPropertyName("unpaid_balance_vnd")] public long UnpaidBalanceVnd { get; set; }
    [JsonPropertyName("agency_fee_mtd_vnd")] public long AgencyFeeMtdVnd { get; set; }
    [JsonPropertyName("meta_tax_mtd_vnd")] public long MetaTaxMtdVnd { get; set; }
    [JsonPropertyName("total_billable_mtd_vnd")] public long TotalBillableMtdVnd { get; set; }
    [JsonPropertyName("agency_fee_lifetime_vnd")] public long AgencyFeeLifetimeVnd { get; set; }
    [JsonPropertyName("meta_tax_lifetime_vnd")] public long MetaTaxLifetimeVnd { get; set; }
    [JsonPropertyName("total_billable_lifetime_vnd")] public long TotalBillableLifetimeVnd { get; set; }
    [JsonPropertyName("pacing_percent")] public double PacingPercent { get; set; }
    [JsonPropertyName("pacing_status")] public string PacingStatus { get; set; } = "ON_TRACK";
    [JsonPropertyName("remaining_budget_vnd")] public long RemainingBudgetVnd { get; set; }
    [JsonPropertyName("recommended_daily_vnd")] public long RecommendedDailyVnd { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
}

public sealed class ClientRetainersSummaryDto
{
    [JsonPropertyName("total_contracts")] public int TotalContracts { get; set; }
    [JsonPropertyName("total_committed_vnd")] public long TotalCommittedVnd { get; set; }
    [JsonPropertyName("total_mtd_spend_vnd")] public long TotalMtdSpendVnd { get; set; }
    [JsonPropertyName("total_lifetime_spend_vnd")] public long TotalLifetimeSpendVnd { get; set; }
    [JsonPropertyName("total_unpaid_balance_vnd")] public long TotalUnpaidBalanceVnd { get; set; }
    [JsonPropertyName("total_settlement_mtd_vnd")] public long TotalSettlementMtdVnd { get; set; }
    [JsonPropertyName("total_settlement_lifetime_vnd")] public long TotalSettlementLifetimeVnd { get; set; }
    [JsonPropertyName("days_remaining_in_month")] public int DaysRemainingInMonth { get; set; }
}

public sealed class ClientRetainersOverviewDto
{
    [JsonPropertyName("items")] public List<ClientRetainerItemDto> Items { get; set; } = new();
    [JsonPropertyName("summary")] public ClientRetainersSummaryDto Summary { get; set; } = new();
}

public sealed class TeamSummaryDto
{
    [JsonPropertyName("seat_limit")] public int? SeatLimit { get; set; }
    [JsonPropertyName("active_members")] public int ActiveMembers { get; set; }
    [JsonPropertyName("available_seats")] public int? AvailableSeats { get; set; }
    [JsonPropertyName("pending_invitations")] public int PendingInvitations { get; set; }
    [JsonPropertyName("plan_reference")] public string? PlanReference { get; set; }
}

public sealed class TeamMemberDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("user_id")] public string UserId { get; set; } = string.Empty;
    [JsonPropertyName("email")] public string Email { get; set; } = string.Empty;
    [JsonPropertyName("full_name")] public string FullName { get; set; } = string.Empty;
    [JsonPropertyName("role")] public string Role { get; set; } = "operator";
    [JsonPropertyName("status")] public string Status { get; set; } = "active";
    [JsonPropertyName("is_archived")] public bool IsArchived { get; set; }
    [JsonPropertyName("assigned_business_manager_count")] public int AssignedBusinessManagerCount { get; set; }
    [JsonPropertyName("assigned_ad_account_count")] public int AssignedAdAccountCount { get; set; }
    [JsonPropertyName("active_session_count")] public int ActiveSessionCount { get; set; }
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = string.Empty;
}

public sealed class TeamInvitationDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("email_normalized")] public string EmailNormalized { get; set; } = string.Empty;
    [JsonPropertyName("invited_role")] public string InvitedRole { get; set; } = "operator";
    [JsonPropertyName("status")] public string Status { get; set; } = "pending";
    [JsonPropertyName("token_last_four")] public string? TokenLastFour { get; set; }
    [JsonPropertyName("expires_at")] public string ExpiresAt { get; set; } = string.Empty;
    [JsonPropertyName("sent_at")] public string? SentAt { get; set; }
    [JsonPropertyName("accepted_at")] public string? AcceptedAt { get; set; }
}

public sealed class TeamInvitationCreateResponseDto
{
    [JsonPropertyName("invitation")] public TeamInvitationDto Invitation { get; set; } = new();
    [JsonPropertyName("invite_link_token")] public string InviteLinkToken { get; set; } = string.Empty;
}

// ---------- v2.4 Anti-Checkpoint, Cooldown & Multi-Client Stewardship ----------

public sealed class ViaStewardshipRecord
{
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("last_proxy_key")] public string LastProxyKey { get; set; } = "";
    [JsonPropertyName("proxy_changed_utc")] public string ProxyChangedUtc { get; set; } = "";
    [JsonPropertyName("cooldown_until_utc")] public string CooldownUntilUtc { get; set; } = "";
    [JsonPropertyName("cooldown_reason")] public string CooldownReason { get; set; } = "";
    [JsonPropertyName("keep_alive_success_count")] public int KeepAliveSuccessCount { get; set; }
    [JsonPropertyName("last_keep_alive_utc")] public string LastKeepAliveUtc { get; set; } = "";
    [JsonPropertyName("last_cookie_refresh_utc")] public string LastCookieRefreshUtc { get; set; } = "";
}

public sealed class StewardshipSafetyEventDto
{
    [JsonPropertyName("timestamp_utc")] public string TimestampUtc { get; set; } = DateTime.UtcNow.ToString("O");
    [JsonPropertyName("event_type")] public string EventType { get; set; } = "";
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("client_group")] public string ClientGroup { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
}

public sealed class ViaStewardshipDocument
{
    [JsonPropertyName("records")] public List<ViaStewardshipRecord> Records { get; set; } = new();
    [JsonPropertyName("events")] public List<StewardshipSafetyEventDto> Events { get; set; } = new();
}

/// <summary>Stores per-Via proxy transitions (72h soak quarantine), safety cooldowns, and audit events locally.</summary>
public sealed class ViaStewardshipStore
{
    private static readonly Lazy<ViaStewardshipStore> _default =
        new(() => new ViaStewardshipStore(Path.Combine(DesktopConfig.AppDataRoot, "via_stewardship.json")));

    public static ViaStewardshipStore Default => _default.Value;

    private readonly string _filePath;
    private readonly object _gate = new();
    private ViaStewardshipDocument _doc = new();

    public ViaStewardshipStore(string filePath)
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
                    _doc = JsonSerializer.Deserialize<ViaStewardshipDocument>(txt) ?? new ViaStewardshipDocument();
                }
            }
            catch
            {
                _doc = new ViaStewardshipDocument();
            }
            _doc.Records ??= new List<ViaStewardshipRecord>();
            _doc.Events ??= new List<StewardshipSafetyEventDto>();
        }
    }

    private void SaveToDiskLocked()
    {
        var dir = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(_doc, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_filePath, json, new UTF8Encoding(false));
    }

    private ViaStewardshipRecord GetOrCreateRecordLocked(string? viaId, string? viaLabel)
    {
        var id = (viaId ?? "").Trim();
        var lbl = (viaLabel ?? "").Trim();

        ViaStewardshipRecord? match = null;
        if (!string.IsNullOrEmpty(id))
        {
            match = _doc.Records.FirstOrDefault(r => string.Equals(r.ViaId, id, StringComparison.OrdinalIgnoreCase));
        }
        if (match == null && !string.IsNullOrEmpty(lbl))
        {
            match = _doc.Records.FirstOrDefault(r => string.Equals(r.ViaLabel, lbl, StringComparison.OrdinalIgnoreCase));
        }

        if (match == null)
        {
            var key = !string.IsNullOrEmpty(id) ? $"id:{id.ToLowerInvariant()}" : $"lbl:{lbl.ToLowerInvariant()}";
            match = new ViaStewardshipRecord
            {
                Key = key,
                ViaId = id,
                ViaLabel = lbl,
            };
            _doc.Records.Add(match);
        }
        else
        {
            if (!string.IsNullOrEmpty(id)) match.ViaId = id;
            if (!string.IsNullOrEmpty(lbl)) match.ViaLabel = lbl;
        }
        return match;
    }

    private void AppendEventLocked(string eventType, string? viaId, string? viaLabel, string? clientGroup, string detail)
    {
        _doc.Events.Insert(0, new StewardshipSafetyEventDto
        {
            TimestampUtc = DateTimeOffset.UtcNow.ToString("O"),
            EventType = (eventType ?? "").Trim().ToUpperInvariant(),
            ViaId = (viaId ?? "").Trim(),
            ViaLabel = string.IsNullOrWhiteSpace(viaLabel) ? "Via" : viaLabel.Trim(),
            ClientGroup = (clientGroup ?? "").Trim(),
            Detail = (detail ?? "").Trim(),
        });
        if (_doc.Events.Count > 250)
        {
            _doc.Events.RemoveRange(250, _doc.Events.Count - 250);
        }
    }

    private static ViaStewardshipRecord CloneRecord(ViaStewardshipRecord src) => new()
    {
        Key = src.Key,
        ViaId = src.ViaId,
        ViaLabel = src.ViaLabel,
        LastProxyKey = src.LastProxyKey,
        ProxyChangedUtc = src.ProxyChangedUtc,
        CooldownUntilUtc = src.CooldownUntilUtc,
        CooldownReason = src.CooldownReason,
        KeepAliveSuccessCount = src.KeepAliveSuccessCount,
        LastKeepAliveUtc = src.LastKeepAliveUtc,
        LastCookieRefreshUtc = src.LastCookieRefreshUtc,
    };

    public ViaStewardshipRecord GetOrTrackProxy(string? viaId, string? viaLabel, string? currentProxyRaw)
    {
        var normKey = DesktopAppInfo.NormalizeProxyKey(currentProxyRaw);
        lock (_gate)
        {
            var rec = GetOrCreateRecordLocked(viaId, viaLabel);
            bool dirty = false;
            if (!string.IsNullOrEmpty(normKey))
            {
                if (!string.IsNullOrEmpty(rec.LastProxyKey) &&
                    !string.Equals(rec.LastProxyKey, normKey, StringComparison.OrdinalIgnoreCase))
                {
                    rec.ProxyChangedUtc = DateTimeOffset.UtcNow.ToString("O");
                    AppendEventLocked(
                        "PROXY_CHANGED_QUARANTINE",
                        rec.ViaId,
                        rec.ViaLabel,
                        "",
                        $"Đổi Proxy ({rec.LastProxyKey} -> {normKey}) — Kích hoạt khóa ngâm thiết bị mới");
                    dirty = true;
                }
                if (!string.Equals(rec.LastProxyKey, normKey, StringComparison.OrdinalIgnoreCase))
                {
                    rec.LastProxyKey = normKey;
                    dirty = true;
                }
            }
            else if (!string.IsNullOrEmpty(rec.LastProxyKey))
            {
                rec.LastProxyKey = "";
                dirty = true;
            }
            if (dirty) SaveToDiskLocked();
            return CloneRecord(rec);
        }
    }

    public void TriggerCooldown(string? viaId, string? viaLabel, string? clientGroup, int hours, string reason, string eventType = "SAFETY_COOLDOWN")
    {
        var effectiveHours = Math.Clamp(hours, 1, 168);
        var cleanReason = string.IsNullOrWhiteSpace(reason) ? "Kích hoạt Cooldown bảo vệ tài khoản" : reason.Trim();
        lock (_gate)
        {
            var rec = GetOrCreateRecordLocked(viaId, viaLabel);
            rec.CooldownUntilUtc = DateTimeOffset.UtcNow.AddHours(effectiveHours).ToString("O");
            rec.CooldownReason = cleanReason;
            AppendEventLocked(eventType, rec.ViaId, rec.ViaLabel, clientGroup, $"Đóng băng {effectiveHours}h: {cleanReason}");
            SaveToDiskLocked();
        }
    }

    public void ClearCooldown(string? viaId, string? viaLabel)
    {
        lock (_gate)
        {
            var rec = GetOrCreateRecordLocked(viaId, viaLabel);
            rec.CooldownUntilUtc = "";
            rec.CooldownReason = "";
            AppendEventLocked("COOLDOWN_CLEARED", rec.ViaId, rec.ViaLabel, "", "Gỡ đóng băng Cooldown thủ công trên Desktop");
            SaveToDiskLocked();
        }
    }

    public int ClearAllCooldowns()
    {
        lock (_gate)
        {
            int cleared = 0;
            foreach (var rec in _doc.Records)
            {
                if (!string.IsNullOrWhiteSpace(rec.CooldownUntilUtc))
                {
                    rec.CooldownUntilUtc = "";
                    rec.CooldownReason = "";
                    cleared++;
                }
            }
            if (cleared > 0)
            {
                AppendEventLocked("COOLDOWN_CLEARED_ALL", "", "Tất cả Via", "", $"Đã gỡ đóng băng Cooldown hàng loạt cho {cleared} Via");
                SaveToDiskLocked();
            }
            return cleared;
        }
    }

    public void RecordKeepAliveSuccess(string? viaId, string? viaLabel, string? clientGroup, string? detail = null)
    {
        lock (_gate)
        {
            var rec = GetOrCreateRecordLocked(viaId, viaLabel);
            rec.KeepAliveSuccessCount++;
            rec.LastKeepAliveUtc = DateTimeOffset.UtcNow.ToString("O");
            AppendEventLocked(
                "KEEPALIVE_OK",
                rec.ViaId,
                rec.ViaLabel,
                clientGroup,
                string.IsNullOrWhiteSpace(detail) ? "Hoàn tất phiên Đảo Ấm an toàn" : detail.Trim());
            SaveToDiskLocked();
        }
    }

    public void RecordCookieRefresh(string? viaId, string? viaLabel, string? clientGroup)
    {
        lock (_gate)
        {
            var rec = GetOrCreateRecordLocked(viaId, viaLabel);
            rec.LastCookieRefreshUtc = DateTimeOffset.UtcNow.ToString("O");
            AppendEventLocked(
                "VAULT_COOKIE_REFRESHED",
                rec.ViaId,
                rec.ViaLabel,
                clientGroup,
                "Extension tự động làm mới Cookie c_user/xs vào Két DPAPI Local");
            SaveToDiskLocked();
        }
    }

    public void AppendEvent(string eventType, string? viaId, string? viaLabel, string? clientGroup, string detail)
    {
        lock (_gate)
        {
            AppendEventLocked(eventType, viaId, viaLabel, clientGroup, detail);
            SaveToDiskLocked();
        }
    }

    public List<StewardshipSafetyEventDto> GetRecentEvents(int max = 100)
    {
        var take = Math.Clamp(max, 1, 250);
        lock (_gate)
        {
            return _doc.Events.Take(take).ToList();
        }
    }

    public ViaStewardshipDocument ExportSnapshot()
    {
        lock (_gate)
        {
            return new ViaStewardshipDocument
            {
                Records = _doc.Records.Select(CloneRecord).ToList(),
                Events = _doc.Events.Select(e => new StewardshipSafetyEventDto
                {
                    TimestampUtc = e.TimestampUtc,
                    EventType = e.EventType,
                    ViaId = e.ViaId,
                    ViaLabel = e.ViaLabel,
                    ClientGroup = e.ClientGroup,
                    Detail = e.Detail,
                }).ToList(),
            };
        }
    }

    public int ImportSnapshot(ViaStewardshipDocument? snap)
    {
        if (snap == null) return 0;
        int merged = 0;
        lock (_gate)
        {
            if (snap.Records != null)
            {
                foreach (var src in snap.Records)
                {
                    if (src == null || (string.IsNullOrWhiteSpace(src.ViaId) && string.IsNullOrWhiteSpace(src.ViaLabel)))
                        continue;
                    var dst = GetOrCreateRecordLocked(src.ViaId, src.ViaLabel);
                    if (!string.IsNullOrWhiteSpace(src.LastProxyKey)) dst.LastProxyKey = src.LastProxyKey.Trim();
                    if (!string.IsNullOrWhiteSpace(src.ProxyChangedUtc)) dst.ProxyChangedUtc = src.ProxyChangedUtc.Trim();
                    if (!string.IsNullOrWhiteSpace(src.CooldownUntilUtc)) dst.CooldownUntilUtc = src.CooldownUntilUtc.Trim();
                    if (!string.IsNullOrWhiteSpace(src.CooldownReason)) dst.CooldownReason = src.CooldownReason.Trim();
                    if (src.KeepAliveSuccessCount > dst.KeepAliveSuccessCount) dst.KeepAliveSuccessCount = src.KeepAliveSuccessCount;
                    if (!string.IsNullOrWhiteSpace(src.LastKeepAliveUtc) &&
                        string.CompareOrdinal(src.LastKeepAliveUtc, dst.LastKeepAliveUtc) > 0)
                    {
                        dst.LastKeepAliveUtc = src.LastKeepAliveUtc.Trim();
                    }
                    if (!string.IsNullOrWhiteSpace(src.LastCookieRefreshUtc) &&
                        string.CompareOrdinal(src.LastCookieRefreshUtc, dst.LastCookieRefreshUtc) > 0)
                    {
                        dst.LastCookieRefreshUtc = src.LastCookieRefreshUtc.Trim();
                    }
                    merged++;
                }
            }

            if (snap.Events != null && snap.Events.Count > 0)
            {
                var seen = new HashSet<string>(
                    _doc.Events.Select(e => $"{e.TimestampUtc}|{e.EventType}|{e.ViaLabel}"),
                    StringComparer.OrdinalIgnoreCase);
                foreach (var ev in snap.Events)
                {
                    if (ev == null) continue;
                    var sig = $"{ev.TimestampUtc}|{ev.EventType}|{ev.ViaLabel}";
                    if (seen.Add(sig))
                    {
                        _doc.Events.Add(new StewardshipSafetyEventDto
                        {
                            TimestampUtc = ev.TimestampUtc,
                            EventType = ev.EventType,
                            ViaId = ev.ViaId,
                            ViaLabel = ev.ViaLabel,
                            ClientGroup = ev.ClientGroup,
                            Detail = ev.Detail,
                        });
                    }
                }
                _doc.Events = _doc.Events
                    .OrderByDescending(e => e.TimestampUtc, StringComparer.Ordinal)
                    .Take(250)
                    .ToList();
            }

            SaveToDiskLocked();
        }
        return merged;
    }
}

/// <summary>Deterministic cross-client Silo Isolation, universal duplicate Chrome Profile checker, and Environmental Trust Score calculator.</summary>
public static class ViaTrustEvaluator
{
    public static void DetectClientSiloConflicts(IList<ViaWorkspaceEntry> vias, int maxSharedPerProxy = 4)
    {
        if (vias == null || vias.Count == 0) return;

        var proxyCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in vias)
        {
            v.HasSiloConflict = false;
            v.SiloConflictDetail = "";
            var px = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
            if (!string.IsNullOrEmpty(px))
            {
                proxyCounts[px] = proxyCounts.GetValueOrDefault(px) + 1;
            }
        }
        foreach (var v in vias)
        {
            var px = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
            v.SharedProxyViaCount = !string.IsNullOrEmpty(px) && proxyCounts.TryGetValue(px, out var cnt) ? cnt : 1;
        }

        static (string Key, string Display) GetBrowserIdentity(ViaWorkspaceEntry v)
        {
            var eng = AntidetectBrowserConnector.NormalizeEngine(v.AntidetectEngine);
            var adId = (v.AntidetectProfileId ?? "").Trim();
            if (eng != "chrome_native" && !string.IsNullOrEmpty(adId))
            {
                return ($"{eng}:{adId}".ToLowerInvariant(), $"{AntidetectBrowserConnector.GetDisplayName(eng)} #{adId}");
            }
            var prof = (v.ProfileDir ?? "").Trim();
            return string.IsNullOrEmpty(prof)
                ? ("", "")
                : ($"chrome:{prof}".ToLowerInvariant(), $"Chrome {prof}");
        }

        for (int i = 0; i < vias.Count; i++)
        {
            var a = vias[i];
            var clientA = (a.ClientGroup ?? "").Trim();
            var pxA = AutomationQueueEngine.ExtractProxyHostPort(a.NetworkLabel);
            var (profKeyA, profDispA) = GetBrowserIdentity(a);

            for (int j = i + 1; j < vias.Count; j++)
            {
                var b = vias[j];
                var clientB = (b.ClientGroup ?? "").Trim();
                var reasonsA = new List<string>();
                var reasonsB = new List<string>();

                // 1) Unconditional check: two Vias sharing the same Chrome/Antidetect Profile ALWAYS risk overwriting cookies
                var (profKeyB, _) = GetBrowserIdentity(b);
                if (!string.IsNullOrEmpty(profKeyA) && string.Equals(profKeyA, profKeyB, StringComparison.OrdinalIgnoreCase))
                {
                    reasonsA.Add($"Trùng {profDispA} với {b.Label} (nguy cơ đè Cookie)");
                    reasonsB.Add($"Trùng {profDispA} với {a.Label} (nguy cơ đè Cookie)");
                }

                // 2) Cross-client Proxy check (same ClientGroup or both unassigned may safely share Residential Proxy up to maxSharedPerProxy)
                var differentClients = !string.Equals(clientA, clientB, StringComparison.OrdinalIgnoreCase) &&
                                       (!string.IsNullOrEmpty(clientA) || !string.IsNullOrEmpty(clientB));
                if (differentClients)
                {
                    var pxB = AutomationQueueEngine.ExtractProxyHostPort(b.NetworkLabel);
                    if (!string.IsNullOrEmpty(pxA) && string.Equals(pxA, pxB, StringComparison.OrdinalIgnoreCase))
                    {
                        var peerA = string.IsNullOrEmpty(clientB) ? b.Label : $"Khách {clientB} ({b.Label})";
                        var peerB = string.IsNullOrEmpty(clientA) ? a.Label : $"Khách {clientA} ({a.Label})";
                        reasonsA.Add($"Trùng Proxy {pxA} với {peerA}");
                        reasonsB.Add($"Trùng Proxy {pxA} với {peerB}");
                    }
                }

                if (reasonsA.Count > 0)
                {
                    a.HasSiloConflict = true;
                    a.SiloConflictDetail = string.IsNullOrEmpty(a.SiloConflictDetail)
                        ? string.Join("; ", reasonsA)
                        : $"{a.SiloConflictDetail}; {string.Join("; ", reasonsA)}";

                    b.HasSiloConflict = true;
                    b.SiloConflictDetail = string.IsNullOrEmpty(b.SiloConflictDetail)
                        ? string.Join("; ", reasonsB)
                        : $"{b.SiloConflictDetail}; {string.Join("; ", reasonsB)}";
                }
            }
        }
    }

    public static (int Score, string Summary) EvaluateTrustScore(ViaWorkspaceEntry v, bool hasTwoFa, bool hasVaultCookie, int maxSharedPerProxy = 4)
    {
        int score = 0;
        var notes = new List<string>();
        var safeLimit = Math.Max(1, maxSharedPerProxy);

        if (!string.IsNullOrWhiteSpace(v.NetworkLabel))
        {
            var clusterNote = v.SharedProxyViaCount > 1 ? $" ({v.SharedProxyViaCount}/{safeLimit} Via" : " (";
            if (string.Equals(v.ProxyLastStatus, "LIVE", StringComparison.OrdinalIgnoreCase))
            {
                score += 30;
                notes.Add($"Proxy LIVE{clusterNote}+30)");
            }
            else if (string.Equals(v.ProxyLastStatus, "DEAD", StringComparison.OrdinalIgnoreCase))
            {
                score -= 15;
                notes.Add("Proxy DEAD (-15)");
            }
            else
            {
                score += 18;
                notes.Add($"Đã gắn Proxy{clusterNote}+18)");
            }

            if (v.SharedProxyViaCount > safeLimit)
            {
                score -= 10;
                notes.Add($"Quá tải cụm Proxy ({v.SharedProxyViaCount}/{safeLimit} Via, -10)");
            }
        }
        else
        {
            notes.Add("Direct IP (+0)");
        }

        switch (v.WarmupPhase)
        {
            case "trusted":
                score += 25;
                notes.Add("Trust >7d (+25)");
                break;
            case "7d_warmup":
                score += 15;
                notes.Add("Ngâm 4–7d (+15)");
                break;
            default:
                score += 8;
                notes.Add("Ngâm 72h mới (+8)");
                break;
        }

        if (hasTwoFa)
        {
            score += 15;
            notes.Add("2FA DPAPI (+15)");
        }
        if (hasVaultCookie)
        {
            score += 10;
            notes.Add("Cookie DPAPI (+10)");
        }

        if (!v.NeedsKeepAlive)
        {
            score += 10;
            notes.Add("Cookie ấm (+10)");
        }
        else
        {
            score += 3;
            notes.Add("Cần Đảo Ấm (+3)");
        }

        if (!v.HasSiloConflict && string.Equals(v.QuotaStatus, "SAFE", StringComparison.OrdinalIgnoreCase))
        {
            score += 10;
            notes.Add("Quota/Silo sạch (+10)");
        }
        if (v.HasSiloConflict)
        {
            score -= 25;
            notes.Add("Trùng Silo khác khách (-25)");
        }
        if (v.IsInCooldown)
        {
            score -= 35;
            notes.Add("Đang Cooldown bảo vệ (-35)");
        }

        score = Math.Clamp(score, 0, 100);
        return (score, string.Join(" • ", notes));
    }
}

public static class ViaBulkDistributor
{
    public static List<(ViaWorkspaceEntry Via, string AssignedProxy)> DistributeProxies(
        IReadOnlyList<ViaWorkspaceEntry> vias,
        IEnumerable<string> rawProxyLines,
        int maxPerProxy = 4)
    {
        var result = new List<(ViaWorkspaceEntry Via, string AssignedProxy)>();
        if (vias == null || vias.Count == 0 || rawProxyLines == null) return result;

        var cleanProxies = rawProxyLines
            .Select(x => (x ?? "").Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x) && ExtensionProvisioner.ParseProxy(x) != null)
            .ToList();
        if (cleanProxies.Count == 0) return result;

        var cap = Math.Clamp(maxPerProxy, 1, 50);
        int proxyIdx = 0;
        int usedOnCurrent = 0;
        foreach (var v in vias)
        {
            if (proxyIdx >= cleanProxies.Count) break;
            result.Add((v, cleanProxies[proxyIdx]));
            usedOnCurrent++;
            if (usedOnCurrent >= cap)
            {
                proxyIdx++;
                usedOnCurrent = 0;
            }
        }
        return result;
    }

    public static List<(ViaWorkspaceEntry Via, string NewProfileDir)> AllocateDistinctChromeProfiles(
        IReadOnlyList<ViaWorkspaceEntry> targetVias,
        IReadOnlyList<ViaWorkspaceEntry> allVias)
    {
        var result = new List<(ViaWorkspaceEntry Via, string NewProfileDir)>();
        if (targetVias == null || targetVias.Count == 0) return result;

        var targetIds = new HashSet<string>(targetVias.Select(v => v.ViaId), StringComparer.OrdinalIgnoreCase);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (allVias != null)
        {
            foreach (var v in allVias)
            {
                if (!targetIds.Contains(v.ViaId) && !string.IsNullOrWhiteSpace(v.ProfileDir))
                {
                    used.Add(v.ProfileDir.Trim());
                }
            }
        }

        int nextNum = 1;
        string NextFreeProfile()
        {
            while (nextNum <= 9999)
            {
                var candidate = $"Profile {nextNum}";
                nextNum++;
                if (used.Add(candidate)) return candidate;
            }
            return $"Profile {Guid.NewGuid().ToString("N")[..4]}";
        }

        bool isDefaultShared = allVias != null &&
            allVias.Count(v => string.Equals((v.ProfileDir ?? "").Trim(), "Default", StringComparison.OrdinalIgnoreCase)) > 1;

        foreach (var v in targetVias)
        {
            var cur = (v.ProfileDir ?? "").Trim();
            if (!string.IsNullOrEmpty(cur) &&
                (!string.Equals(cur, "Default", StringComparison.OrdinalIgnoreCase) || !isDefaultShared) &&
                used.Add(cur))
            {
                continue;
            }
            result.Add((v, NextFreeProfile()));
        }
        return result;
    }
}

public sealed class QueueResumeStateDto
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("updated_at_utc")] public string UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow.ToString("O");
    [JsonPropertyName("completed_via_ids")] public List<string> CompletedViaIds { get; set; } = new();
}

public static class QueueResumeStateStore
{
    private static readonly object _gate = new();
    public static string DefaultFilePath => Path.Combine(DesktopConfig.AppDataRoot, "queue_resume.json");

    public static void RecordItemLaunched(QueueKind kind, string viaId, string? customPath = null)
    {
        var cleanId = (viaId ?? "").Trim();
        if (string.IsNullOrEmpty(cleanId)) return;
        var path = customPath ?? DefaultFilePath;
        var kindStr = kind.ToString();
        lock (_gate)
        {
            QueueResumeStateDto? state = null;
            try
            {
                if (File.Exists(path))
                {
                    state = JsonSerializer.Deserialize<QueueResumeStateDto>(File.ReadAllText(path, Encoding.UTF8));
                }
            }
            catch { state = null; }

            var validExisting = state != null &&
                                string.Equals(state.Kind, kindStr, StringComparison.OrdinalIgnoreCase) &&
                                DateTimeOffset.TryParse(state.UpdatedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var ts) &&
                                (DateTimeOffset.UtcNow - ts).TotalHours < 6.0;

            if (!validExisting)
            {
                state = new QueueResumeStateDto { Kind = kindStr };
            }
            state!.CompletedViaIds ??= new List<string>();
            if (!state.CompletedViaIds.Any(x => string.Equals(x, cleanId, StringComparison.OrdinalIgnoreCase)))
            {
                state.CompletedViaIds.Add(cleanId);
            }
            state.UpdatedAtUtc = DateTimeOffset.UtcNow.ToString("O");

            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(path, JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
            }
            catch { }
        }
    }

    public static void Clear(string? customPath = null)
    {
        var path = customPath ?? DefaultFilePath;
        lock (_gate)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch { }
        }
    }

    public static List<QueueTaskItem> FilterRemainingItems(
        QueueKind kind,
        IReadOnlyList<QueueTaskItem> items,
        out int skippedCompletedCount,
        string? customPath = null)
    {
        skippedCompletedCount = 0;
        if (items == null || items.Count == 0) return new List<QueueTaskItem>();

        var path = customPath ?? DefaultFilePath;
        var kindStr = kind.ToString();
        QueueResumeStateDto? state = null;
        lock (_gate)
        {
            try
            {
                if (!File.Exists(path)) return items.ToList();
                state = JsonSerializer.Deserialize<QueueResumeStateDto>(File.ReadAllText(path, Encoding.UTF8));
            }
            catch
            {
                return items.ToList();
            }
        }

        if (state == null ||
            !string.Equals(state.Kind, kindStr, StringComparison.OrdinalIgnoreCase) ||
            state.CompletedViaIds == null ||
            state.CompletedViaIds.Count == 0 ||
            !DateTimeOffset.TryParse(state.UpdatedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var ts) ||
            (DateTimeOffset.UtcNow - ts).TotalHours >= 4.0)
        {
            return items.ToList();
        }

        var done = new HashSet<string>(state.CompletedViaIds.Where(x => !string.IsNullOrWhiteSpace(x)), StringComparer.OrdinalIgnoreCase);
        var remaining = items.Where(it => string.IsNullOrWhiteSpace(it.ViaId) || !done.Contains(it.ViaId.Trim())).ToList();
        if (remaining.Count == 0)
        {
            Clear(customPath);
            return items.ToList();
        }
        skippedCompletedCount = items.Count - remaining.Count;
        return remaining;
    }
}
