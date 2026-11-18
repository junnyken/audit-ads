using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AdsOpsDesktop;

public sealed class ExtensionTemplateBundle
{
    [JsonPropertyName("version")] public string Version { get; set; } = "2.9.6";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("passkey_shield_js")] public string PasskeyShieldJs { get; set; } = "";
    [JsonPropertyName("background_js_after_default_state")] public string BackgroundJsAfterDefaultState { get; set; } = "";
    [JsonPropertyName("content_js")] public string ContentJs { get; set; } = "";
    [JsonPropertyName("popup_html")] public string PopupHtml { get; set; } = "";
    [JsonPropertyName("popup_js")] public string PopupJs { get; set; } = "";
    [JsonPropertyName("popup_js_after_defaults")] public string PopupJsAfterDefaults { get; set; } = "";
}

public sealed class ChromeProfileInfo
{
    [JsonPropertyName("folder")] public string Folder { get; set; } = "Default";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("email")] public string Email { get; set; } = "";
    [JsonPropertyName("gaia_name")] public string GaiaName { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
}

public sealed class ParsedProxySpec
{
    public string Scheme { get; init; } = "http";
    public string Host { get; init; } = "";
    public int Port { get; init; }
    public string User { get; init; } = "";
    public string Pass { get; init; } = "";

    public string CompactRaw =>
        string.IsNullOrEmpty(Host) ? ""
        : string.IsNullOrEmpty(User) ? $"{Host}:{Port}"
        : $"{Host}:{Port}:{User}:{Pass}";
}

public static class ExtensionProvisioner
{
    private static readonly Regex ProfileDirRegex = new(@"\b(Default|Profile\s+\d+)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SafeProfileDirRegex = new(@"^[a-zA-Z0-9 _.-]+$", RegexOptions.Compiled);
    private static readonly Regex ProxyAtRegex = new(@"^(?:(http|https|socks5):\/\/)?([^:\s]+):([^@\s]+)@(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Proxy4Regex = new(@"(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5}):([^:\s]+):([^\s]+)", RegexOptions.Compiled);
    private static readonly Regex Proxy2Regex = new(@"(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})", RegexOptions.Compiled);
    private static readonly Regex TwoFaParamRegex = new(@"(?:secret=|2fa[:=]\s*)([A-Z2-7]{8,128})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PureBase32Regex = new(@"^[A-Z2-7]{8,128}$", RegexOptions.Compiled);

    private static ExtensionTemplateBundle? _cachedBundle;

    public static string ExtensionsRoot => Path.Combine(DesktopConfig.AppDataRoot, "Extensions");
    public static string IsolatedProfilesRoot => Path.Combine(DesktopConfig.AppDataRoot, "IsolatedProfiles");

    public static ExtensionTemplateBundle LoadTemplates()
    {
        if (_cachedBundle != null) return _cachedBundle;

        var asm = Assembly.GetExecutingAssembly();
        var resName = asm.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("extension_templates_v29.json", StringComparison.OrdinalIgnoreCase));

        string jsonText;
        if (!string.IsNullOrEmpty(resName))
        {
            using var stream = asm.GetManifestResourceStream(resName)!;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            jsonText = reader.ReadToEnd();
        }
        else
        {
            var localPath = Path.Combine(AppContext.BaseDirectory, "extension_templates_v29.json");
            if (!File.Exists(localPath))
            {
                throw new FileNotFoundException("Không tìm thấy extension_templates_v29.json.", localPath);
            }
            jsonText = File.ReadAllText(localPath, Encoding.UTF8);
        }

        _cachedBundle = JsonSerializer.Deserialize<ExtensionTemplateBundle>(jsonText)
            ?? throw new InvalidDataException($"Không thể đọc dữ liệu template Extension v{DesktopAppInfo.ExtVersion}.");
        return _cachedBundle;
    }

    public static ParsedProxySpec? ParseProxy(string? rawProxy)
    {
        if (string.IsNullOrWhiteSpace(rawProxy)) return null;
        var s = rawProxy.Trim();
        var mAt = ProxyAtRegex.Match(s);
        if (mAt.Success && int.TryParse(mAt.Groups[5].Value, out var pAt))
        {
            return new ParsedProxySpec
            {
                Scheme = string.IsNullOrEmpty(mAt.Groups[1].Value) ? "http" : mAt.Groups[1].Value.ToLowerInvariant(),
                User = mAt.Groups[2].Value,
                Pass = mAt.Groups[3].Value,
                Host = mAt.Groups[4].Value,
                Port = pAt,
            };
        }
        var m4 = Proxy4Regex.Match(s);
        if (m4.Success && int.TryParse(m4.Groups[2].Value, out var p4))
        {
            return new ParsedProxySpec
            {
                Scheme = "http",
                Host = m4.Groups[1].Value,
                Port = p4,
                User = m4.Groups[3].Value,
                Pass = m4.Groups[4].Value,
            };
        }
        var m2 = Proxy2Regex.Match(s);
        if (m2.Success && int.TryParse(m2.Groups[2].Value, out var p2))
        {
            return new ParsedProxySpec
            {
                Scheme = "http",
                Host = m2.Groups[1].Value,
                Port = p2,
            };
        }
        return null;
    }

    public static string ExtractTwoFaSecret(string? vaultRef, string? extraHint = null)
    {
        foreach (var src in new[] { vaultRef, extraHint })
        {
            if (string.IsNullOrWhiteSpace(src)) continue;
            var m = TwoFaParamRegex.Match(src);
            if (m.Success) return m.Groups[1].Value.ToUpperInvariant();
            if (!src.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                var compact = Regex.Replace(src, @"\s+", "").ToUpperInvariant();
                if (PureBase32Regex.IsMatch(compact)) return compact;
            }
        }
        return "";
    }

    public static string ResolveProfileDirectory(string? browserProfileLabel, string? viaLabel = null)
    {
        var raw = (browserProfileLabel ?? "").Trim();
        if (!string.IsNullOrEmpty(raw))
        {
            var m = ProfileDirRegex.Match(raw);
            if (m.Success)
            {
                var norm = Regex.Replace(m.Groups[1].Value.Trim(), @"\s+", " ");
                return norm.Equals("default", StringComparison.OrdinalIgnoreCase) ? "Default" : "Profile " + norm.Split(' ')[^1];
            }
            if (SafeProfileDirRegex.IsMatch(raw) && raw.Length <= 40)
            {
                return raw;
            }
        }
        var viaLow = (viaLabel ?? "").ToLowerInvariant();
        if (viaLow.Contains("default")) return "Default";
        return "Default";
    }

    public static string RemoveVietnameseDiacritics(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var replaced = text.Replace('đ', 'd').Replace('Đ', 'D');
        var normalized = replaced.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
            {
                sb.Append(ch);
            }
        }
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    internal static string SanitizeLegacyFolderSlug(string? name, string? fallbackId = null)
    {
        var baseName = Regex.Replace((name ?? "").Trim(), @"[^a-zA-Z0-9_-]+", "-").Trim('-');
        if (string.IsNullOrEmpty(baseName)) baseName = "via";
        if (baseName.Length > 36) baseName = baseName[..36];
        var suffix = string.IsNullOrWhiteSpace(fallbackId)
            ? ""
            : "-" + Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "")[..Math.Min(6, Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "").Length)];
        return $"{baseName}{suffix}".ToLowerInvariant();
    }

    public static string SanitizeFolderSlug(string? name, string? fallbackId = null)
    {
        var asciiName = RemoveVietnameseDiacritics(name);
        var baseName = Regex.Replace(asciiName.Trim(), @"[^a-zA-Z0-9_-]+", "-").Trim('-');
        if (string.IsNullOrEmpty(baseName)) baseName = "via";
        if (baseName.Length > 36) baseName = baseName[..36];
        var suffix = string.IsNullOrWhiteSpace(fallbackId)
            ? ""
            : "-" + Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "")[..Math.Min(6, Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "").Length)];
        return $"{baseName}{suffix}".ToLowerInvariant();
    }

    public static string ResolveIsolatedProfileDirectory(string? viaSlug, string safeProfile)
    {
        var seed = string.IsNullOrWhiteSpace(viaSlug) ? safeProfile : viaSlug;
        var cleanDir = Path.Combine(IsolatedProfilesRoot, SanitizeFolderSlug(seed));
        if (Directory.Exists(cleanDir)) return cleanDir;
        var legacyDir = Path.Combine(IsolatedProfilesRoot, SanitizeLegacyFolderSlug(seed));
        if (!string.Equals(cleanDir, legacyDir, StringComparison.OrdinalIgnoreCase) && Directory.Exists(legacyDir))
        {
            return legacyDir;
        }
        return cleanDir;
    }

    public static bool LocalNativeChromeProfileExists(string? profileDir)
    {
        try
        {
            var safeProfile = ResolveProfileDirectory(profileDir);
            var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(localApp)) return false;
            var path = Path.Combine(localApp, "Google", "Chrome", "User Data", safeProfile);
            return Directory.Exists(path);
        }
        catch
        {
            return false;
        }
    }

    public static bool CookiesFileContainsFacebookSession(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return false;
        try
        {
            using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (fs.Length <= 0) return false;
            var maxRead = (int)Math.Min(fs.Length, 4 * 1024 * 1024);
            var buf = new byte[maxRead];
            int totalRead = 0;
            while (totalRead < maxRead)
            {
                int n = fs.Read(buf, totalRead, maxRead - totalRead);
                if (n <= 0) break;
                totalRead += n;
            }
            if (totalRead <= 0) return false;
            var ascii = Encoding.ASCII.GetString(buf, 0, totalRead);
            return ascii.Contains("c_user", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    public static bool ShouldUseIsolatedProfile(
        bool configUseIsolated,
        string? profileDir,
        string? networkLabel,
        bool hasVaultCookie,
        string? viaSlug = null)
    {
        if (!configUseIsolated) return false;
        if (!string.IsNullOrWhiteSpace(networkLabel) || hasVaultCookie) return true;

        var safeProfile = ResolveProfileDirectory(profileDir, viaSlug);
        var isoDir = ResolveIsolatedProfileDirectory(viaSlug, safeProfile);
        SanitizeIsolatedProfileHealth(isoDir);
        var networkCookies = Path.Combine(isoDir, "Default", "Network", "Cookies");
        var legacyCookies = Path.Combine(isoDir, "Default", "Cookies");
        try
        {
            if (CookiesFileContainsFacebookSession(networkCookies) ||
                CookiesFileContainsFacebookSession(legacyCookies))
            {
                return true;
            }
        }
        catch { }

        if (LocalNativeChromeProfileExists(safeProfile))
        {
            return false;
        }
        return true;
    }

    /// <summary>
    /// Removes 0-byte corrupted Cookie files and mismatched Native Chrome Local State keys
    /// inside an isolated profile folder so CDP cookie persistence works reliably on Chrome 127-158+.
    /// </summary>
    public static void SanitizeIsolatedProfileHealth(string isoDir)
    {
        if (string.IsNullOrWhiteSpace(isoDir) || !Directory.Exists(isoDir)) return;
        try
        {
            var netCookies = Path.Combine(isoDir, "Default", "Network", "Cookies");
            var legacyCookies = Path.Combine(isoDir, "Default", "Cookies");
            foreach (var ck in new[] { netCookies, legacyCookies })
            {
                try
                {
                    if (File.Exists(ck) && new FileInfo(ck).Length == 0)
                    {
                        File.Delete(ck);
                    }
                }
                catch { }
            }

            var marker = Path.Combine(isoDir, ".adsops_clean_iso_v305");
            var localState = Path.Combine(isoDir, "Local State");
            if (!File.Exists(marker) &&
                File.Exists(localState) &&
                !CookiesFileContainsFacebookSession(netCookies) &&
                !CookiesFileContainsFacebookSession(legacyCookies))
            {
                try { File.Delete(localState); } catch { }
            }
            if (!File.Exists(marker))
            {
                try { File.WriteAllText(marker, "v3.0.5"); } catch { }
            }
        }
        catch { }
    }

    public static string ProvisionForVia(
        ViaWorkspaceEntry via,
        string? extensionsRootOverride = null,
        LocalSecretVaultStore? secretStore = null,
        DesktopConfig? config = null)
    {
        var tpl = LoadTemplates();
        var root = extensionsRootOverride ?? ExtensionsRoot;
        var profileDir = ResolveProfileDirectory(via.BrowserProfileLabel, via.Label);
        var slug = SanitizeFolderSlug($"{profileDir}-{via.Label}", via.ViaId);
        var targetDir = Path.Combine(root, slug);
        Directory.CreateDirectory(targetDir);

        var parsedProxy = ParseProxy(via.NetworkLabel);
        var hasProxy = parsedProxy != null && !string.IsNullOrEmpty(parsedProxy.Host);
        var displayViaName = string.IsNullOrWhiteSpace(via.Label) ? "Via Quản trị" : via.Label.Trim();
        var effectiveTier = string.IsNullOrWhiteSpace(via.ViaTier) ? "camp" : via.ViaTier;

        var store = secretStore ?? (extensionsRootOverride == null ? LocalSecretVaultStore.Default : null);
        var effectiveTwoFa = (via.TwoFaSecret ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(effectiveTwoFa) && store != null)
        {
            var stored = store.Find(via.ViaId, profileDir, displayViaName);
            if (stored.Found && !string.IsNullOrEmpty(stored.TwoFaSecret))
            {
                effectiveTwoFa = stored.TwoFaSecret;
            }
        }

        var accountsList = via.BundledAccounts ?? new List<BundledExtensionAccountDto>();

        var manifestObj = new
        {
            manifest_version = 3,
            name = hasProxy
                ? $"AdsOps Companion Pro · {profileDir} · Proxy {parsedProxy!.Host}:{parsedProxy.Port}"
                : $"AdsOps Companion Pro · {profileDir} ({displayViaName})",
            short_name = "AdsOps Companion Pro",
            version = tpl.Version,
            description = tpl.Description,
            permissions = new[]
            {
                "proxy",
                "privacy",
                "cookies",
                "storage",
                "tabs",
                "activeTab",
                "scripting",
                "alarms",
                "webRequest",
                "webRequestAuthProvider",
            },
            host_permissions = new[] { "<all_urls>" },
            background = new { service_worker = "background.js" },
            action = new
            {
                default_title = $"AdsOps Companion Pro ({displayViaName})",
                default_popup = "popup.html",
            },
            content_scripts = new object[]
            {
                new
                {
                    matches = new[]
                    {
                        "https://*.facebook.com/*",
                        "https://accountscenter.facebook.com/*",
                        "https://business.facebook.com/*",
                        "https://adsmanager.facebook.com/*",
                    },
                    js = new[] { "passkey_shield.js" },
                    run_at = "document_start",
                    world = "MAIN",
                },
                new
                {
                    matches = new[]
                    {
                        "https://*.facebook.com/*",
                        "https://accountscenter.facebook.com/*",
                        "https://business.facebook.com/*",
                        "https://adsmanager.facebook.com/*",
                    },
                    js = new[] { "content.js" },
                    run_at = "document_idle",
                },
            },
        };

        var cfg = config ?? DesktopConfig.Load();
        var bridgeToken = cfg.GetOrCreateBridgeToken();
        var cooldownUntilMs = via.CooldownUntilUtc.HasValue && via.CooldownUntilUtc.Value > DateTimeOffset.UtcNow
            ? via.CooldownUntilUtc.Value.ToUnixTimeMilliseconds()
            : 0L;
        var effectiveWarmupMode = ViaMetadataParser.NormalizeWarmupMode(
            via.IsInSoakQuarantine
                ? "soak_72h"
                : !string.IsNullOrWhiteSpace(via.DefaultWarmupMode)
                    ? via.DefaultWarmupMode
                    : cfg.DefaultWarmupMode);
        var effectiveWarmupPhase = string.IsNullOrWhiteSpace(via.WarmupPhase) ? "trusted" : via.WarmupPhase;
        var soakQuarantineEnabled = cfg.EnforceSoakQuarantine;
        var ipKillSwitch = cfg.IpLeakKillSwitchEnabled;
        var autoVaultCookieRefresh = cfg.AutoRefreshCookieAfterKeepAlive;

        var defaultStateJson = JsonSerializer.Serialize(new
        {
            viaId = via.ViaId ?? "",
            viaName = displayViaName,
            profileCode = profileDir,
            viaTier = effectiveTier,
            twoFaSecret = effectiveTwoFa,
            webrtcShield = true,
            blockPasskey = true,
            passkeyStatus = "clean",
            proxyRaw = parsedProxy?.CompactRaw ?? "",
            proxyEnabled = hasProxy,
            accounts = accountsList,
            clientGroup = via.ClientGroup ?? "",
            warmupPhase = effectiveWarmupPhase,
            warmupStartIso = via.WarmupStartIso ?? "",
            soakHoursRemaining = via.SoakHoursRemaining,
            defaultWarmupMode = effectiveWarmupMode,
            soakQuarantineEnabled,
            ipKillSwitch,
            autoVaultCookieRefresh,
            cooldownUntilMs,
            cooldownReason = via.CooldownReason ?? "",
            trustScore = via.TrustScore,
            bridgeToken,
        });

        var defaultAccountsJson = JsonSerializer.Serialize(accountsList);
        var defaultViaMetaJson = JsonSerializer.Serialize(new
        {
            viaId = via.ViaId ?? "",
            viaName = displayViaName,
            profileCode = profileDir,
            viaTier = effectiveTier,
            twoFaSecret = effectiveTwoFa,
            clientGroup = via.ClientGroup ?? "",
            warmupPhase = effectiveWarmupPhase,
            warmupStartIso = via.WarmupStartIso ?? "",
            soakHoursRemaining = via.SoakHoursRemaining,
            defaultWarmupMode = effectiveWarmupMode,
            soakQuarantineEnabled,
            ipKillSwitch,
            autoVaultCookieRefresh,
            cooldownUntilMs,
            cooldownReason = via.CooldownReason ?? "",
            trustScore = via.TrustScore,
            bridgeToken,
        });
        var activePort = LocalBridgeServer.ActiveBoundPort > 0
            ? LocalBridgeServer.ActiveBoundPort
            : (cfg.BridgePort > 0 ? cfg.BridgePort : 17890);
        var bgBody = $"const DEFAULT_STATE = {defaultStateJson};\n{tpl.BackgroundJsAfterDefaultState}";
        var popupJsBody = !string.IsNullOrEmpty(tpl.PopupJsAfterDefaults)
            ? $"const DEFAULT_ACCOUNTS = {defaultAccountsJson};\nconst DEFAULT_VIA_META = {defaultViaMetaJson};\n{tpl.PopupJsAfterDefaults}"
            : tpl.PopupJs;
        if (activePort != 17890)
        {
            bgBody = bgBody.Replace("127.0.0.1:17890", $"127.0.0.1:{activePort}", StringComparison.Ordinal);
            popupJsBody = popupJsBody.Replace("127.0.0.1:17890", $"127.0.0.1:{activePort}", StringComparison.Ordinal);
        }

        var utf8NoBom = new UTF8Encoding(false);
        File.WriteAllText(Path.Combine(targetDir, "manifest.json"), JsonSerializer.Serialize(manifestObj, new JsonSerializerOptions { WriteIndented = true }) + "\n", utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "passkey_shield.js"), tpl.PasskeyShieldJs, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "background.js"), bgBody, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "content.js"), tpl.ContentJs, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "popup.html"), tpl.PopupHtml, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "popup.js"), popupJsBody, utf8NoBom);
        File.WriteAllText(
            Path.Combine(targetDir, "HUONG-DAN-CAI-DAT.txt"),
            $"ADSOPS COMPANION v{tpl.Version} (AUTO-PROVISIONED BY ADSOPS DESKTOP PRO v{DesktopAppInfo.Version})\r\n" +
            $"Via: {displayViaName}\r\nChrome Profile: {profileDir}\r\nProxy: {(hasProxy ? parsedProxy!.CompactRaw : "Direct")}\r\n" +
            $"TKQC kem theo: {accountsList.Count}\r\n" +
            "Co the nap thu cong qua chrome://extensions -> Load unpacked tai thu muc nay, hoac de AdsOps Desktop Pro nap tu dong.\r\n",
            utf8NoBom);

        via.ExtensionFolder = targetDir;
        return targetDir;
    }

    public static string? FindChromeExecutable()
    {
        var candidates = new List<string>();
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrEmpty(pf)) candidates.Add(Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"));
        if (!string.IsNullOrEmpty(pf86)) candidates.Add(Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"));
        if (!string.IsNullOrEmpty(localApp)) candidates.Add(Path.Combine(localApp, "Google", "Chrome", "Application", "chrome.exe"));

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe");
            var regPath = key?.GetValue(null) as string;
            if (!string.IsNullOrWhiteSpace(regPath)) candidates.Insert(0, regPath.Trim('"'));
        }
        catch { }

        return candidates.FirstOrDefault(p => !string.IsNullOrEmpty(p) && File.Exists(p));
    }

    public static List<ChromeProfileInfo> ReadLocalChromeProfiles()
    {
        var list = new List<ChromeProfileInfo>();
        try
        {
            var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var lsPath = Path.Combine(localApp, "Google", "Chrome", "User Data", "Local State");
            if (!File.Exists(lsPath)) return list;

            using var doc = JsonDocument.Parse(File.ReadAllText(lsPath, Encoding.UTF8));
            if (!doc.RootElement.TryGetProperty("profile", out var profObj)) return list;
            if (!profObj.TryGetProperty("info_cache", out var cacheObj)) return list;

            foreach (var prop in cacheObj.EnumerateObject())
            {
                var folder = prop.Name;
                var info = prop.Value;
                var pName = info.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
                var pEmail = info.TryGetProperty("user_name", out var eEl) ? eEl.GetString() ?? "" : "";
                var pGaia = info.TryGetProperty("gaia_name", out var gEl) ? gEl.GetString() ?? "" : "";
                var lbl = $"Chrome - {folder}";
                if (!string.IsNullOrEmpty(pName)) lbl += $" - {pName}";
                if (!string.IsNullOrEmpty(pEmail)) lbl += $" ({pEmail})";
                list.Add(new ChromeProfileInfo
                {
                    Folder = folder,
                    Name = pName,
                    Email = pEmail,
                    GaiaName = pGaia,
                    Label = lbl,
                });
            }
        }
        catch { }
        return list;
    }

    private static readonly (int Width, int Height)[] ViewportPresets =
    {
        (1366, 768),
        (1440, 900),
        (1536, 864),
        (1600, 900),
        (1920, 1080),
    };

    public static List<string> BuildChromeArguments(
        string url,
        string profileDir,
        string? extFolder,
        bool isolatedMode,
        string? viaSlug = null,
        bool antidetectShield = true,
        bool lowRamMode = true,
        int? cdpPort = null,
        bool startBlankForCdpBootstrap = false)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Chỉ cho phép mở đường dẫn https:// hợp lệ.");
        }
        var safeProfile = SafeProfileDirRegex.IsMatch(profileDir ?? "") ? profileDir! : "Default";
        var args = new List<string>();

        if (isolatedMode)
        {
            var isoDir = ResolveIsolatedProfileDirectory(viaSlug, safeProfile);
            Directory.CreateDirectory(isoDir);
            SanitizeIsolatedProfileHealth(isoDir);
            args.Add($"--user-data-dir={isoDir}");
            args.Add("--no-first-run");
            args.Add("--no-default-browser-check");
            args.Add("--disable-session-crashed-bubble");
            args.Add("--hide-crash-restore-bubble");
            if (cdpPort is > 0)
            {
                args.Add($"--remote-debugging-port={cdpPort.Value}");
                args.Add("--enable-unsafe-extension-debugging");
            }
        }
        else
        {
            args.Add($"--profile-directory={safeProfile}");
            args.Add("--new-window");
        }

        if (antidetectShield)
        {
            args.Add("--disable-blink-features=AutomationControlled");
            args.Add("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
            args.Add("--enforce-webrtc-ip-permission-check");
            args.Add("--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider");

            var seed = $"{(viaSlug ?? "").Trim().ToLowerInvariant()}|{safeProfile.ToLowerInvariant()}";
            unchecked
            {
                uint hash = 2166136261;
                foreach (var ch in seed)
                {
                    hash ^= ch;
                    hash *= 16777619;
                }
                var vp = ViewportPresets[hash % (uint)ViewportPresets.Length];
                args.Add($"--window-size={vp.Width},{vp.Height}");
            }
        }

        if (lowRamMode)
        {
            args.Add("--process-per-site");
            args.Add("--renderer-process-limit=4");
            args.Add("--disable-background-networking");
            args.Add("--disk-cache-size=67108864");
            args.Add("--media-cache-size=16777216");
        }

        args.Add("--force-renderer-accessibility");
        if (!string.IsNullOrWhiteSpace(extFolder) && Directory.Exists(extFolder))
        {
            args.Add($"--load-extension={extFolder}");
        }
        args.Add(startBlankForCdpBootstrap ? "about:blank" : url);
        return args;
    }

    public static int? FindActiveChromeBrokerPid()
    {
        try
        {
            var procs = Process.GetProcessesByName("chrome");
            int? bestWindowPid = null;
            long bestWindowWs = -1;
            int? earliestPid = null;
            var earliestTime = DateTime.MaxValue;
            foreach (var p in procs)
            {
                using (p)
                {
                    try
                    {
                        if (p.HasExited) continue;
                        if (p.MainWindowHandle != IntPtr.Zero && p.WorkingSet64 > bestWindowWs)
                        {
                            bestWindowWs = p.WorkingSet64;
                            bestWindowPid = p.Id;
                        }
                        if (p.StartTime < earliestTime)
                        {
                            earliestTime = p.StartTime;
                            earliestPid = p.Id;
                        }
                    }
                    catch { }
                }
            }
            return bestWindowPid ?? earliestPid;
        }
        catch
        {
            return null;
        }
    }

    public static (int? Pid, bool DelegatedToSharedBroker, bool IsolatedMode) LaunchChromeDetailed(
        string url,
        string profileDir,
        string? extFolder,
        bool isolatedMode,
        string? viaSlug = null,
        bool antidetectShield = true,
        bool lowRamMode = true)
    {
        var args = BuildChromeArguments(url, profileDir, extFolder, isolatedMode, viaSlug, antidetectShield, lowRamMode);
        var chromeExe = FindChromeExecutable() ?? "chrome.exe";
        var useDirectExec = File.Exists(chromeExe);
        var psi = new ProcessStartInfo
        {
            FileName = chromeExe,
            UseShellExecute = !useDirectExec,
        };
        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        Process? proc;
        try
        {
            proc = Process.Start(psi);
        }
        catch when (useDirectExec)
        {
            psi.UseShellExecute = true;
            proc = Process.Start(psi);
        }
        if (!isolatedMode && proc != null)
        {
            try
            {
                proc.WaitForExit(350);
            }
            catch { }
            if (proc.HasExited)
            {
                var brokerPid = FindActiveChromeBrokerPid();
                return (brokerPid ?? proc.Id, brokerPid.HasValue, false);
            }
            return (proc.Id, false, false);
        }
        return (proc?.Id, false, isolatedMode);
    }

    /// <summary>
    /// Launches Chrome with automatic CDP extension loading + cookie injection in isolated mode,
    /// or captures the newly opened Chrome HWND in Native Chrome mode.
    /// </summary>
    public static async Task<(int? Pid, bool DelegatedToSharedBroker, bool IsolatedMode, int? CdpPort, IntPtr WindowHandle, bool ExtensionLoadedViaCdp)> LaunchChromeSmartAsync(
        string url,
        string profileDir,
        string? extFolder,
        bool isolatedMode,
        string? viaSlug = null,
        bool antidetectShield = true,
        bool lowRamMode = true,
        string? vaultCookieRaw = null)
    {
        if (isolatedMode)
        {
            int cdpPort = ChromeCdpController.FindFreeLoopbackPort();
            var args = BuildChromeArguments(
                url,
                profileDir,
                extFolder,
                isolatedMode: true,
                viaSlug: viaSlug,
                antidetectShield: antidetectShield,
                lowRamMode: lowRamMode,
                cdpPort: cdpPort,
                startBlankForCdpBootstrap: true);
            var chromeExe = FindChromeExecutable() ?? "chrome.exe";
            var useDirectExec = File.Exists(chromeExe);
            var psi = new ProcessStartInfo
            {
                FileName = chromeExe,
                UseShellExecute = !useDirectExec,
            };
            foreach (var a in args)
            {
                psi.ArgumentList.Add(a);
            }

            Process? proc;
            try
            {
                proc = Process.Start(psi);
            }
            catch when (useDirectExec)
            {
                psi.UseShellExecute = true;
                proc = Process.Start(psi);
            }

            var boot = await ChromeCdpController.BootstrapIsolatedChromeAsync(
                cdpPort,
                extFolder,
                vaultCookieRaw,
                url,
                connectTimeoutMs: 6500).ConfigureAwait(false);
            return (proc?.Id, false, true, cdpPort, IntPtr.Zero, boot.ExtensionLoaded);
        }

        var beforeWins = NativeChromeActionRunner.SnapshotVisibleChromeWindows();
        var nativeRes = await Task.Run(() => LaunchChromeDetailed(
            url,
            profileDir,
            extFolder,
            isolatedMode: false,
            viaSlug: viaSlug,
            antidetectShield: antidetectShield,
            lowRamMode: lowRamMode)).ConfigureAwait(false);
        var newHwnd = await NativeChromeActionRunner.WaitForNewChromeWindowAsync(beforeWins, timeoutMs: 5500).ConfigureAwait(false);
        return (nativeRes.Pid, nativeRes.DelegatedToSharedBroker || newHwnd != IntPtr.Zero, false, null, newHwnd, false);
    }

    public static int? LaunchChrome(
        string url,
        string profileDir,
        string? extFolder,
        bool isolatedMode,
        string? viaSlug = null,
        bool antidetectShield = true,
        bool lowRamMode = true)
        => LaunchChromeDetailed(url, profileDir, extFolder, isolatedMode, viaSlug, antidetectShield, lowRamMode).Pid;
}

public sealed record WorkstationMemorySnapshot(
    ulong TotalPhysicalMb,
    ulong AvailablePhysicalMb,
    uint MemoryLoadPercent);

/// <summary>Dọn cache tạm của Chrome Profile không hoạt động, đọc RAM khả dụng Win32 và tính ngưỡng luồng tối đa.</summary>
public static class WorkstationPerformanceOptimizer
{
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto, SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx lpBuffer);

    public static WorkstationMemorySnapshot ReadWorkstationMemory()
    {
        try
        {
            var mem = new MemoryStatusEx { dwLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf<MemoryStatusEx>() };
            if (GlobalMemoryStatusEx(ref mem) && mem.ullTotalPhys > 0)
            {
                return new WorkstationMemorySnapshot(
                    mem.ullTotalPhys / (1024UL * 1024UL),
                    mem.ullAvailPhys / (1024UL * 1024UL),
                    mem.dwMemoryLoad);
            }
        }
        catch { }

        var info = GC.GetGCMemoryInfo();
        var totalMb = (ulong)Math.Max(1024, info.TotalAvailableMemoryBytes / (1024 * 1024));
        return new WorkstationMemorySnapshot(totalMb, totalMb / 2, 50);
    }

    public static int ComputeRecommendedMaxConcurrent(bool lowRamMode, WorkstationMemorySnapshot? overrideSnap = null)
    {
        var snap = overrideSnap ?? ReadWorkstationMemory();
        var perProfileMb = lowRamMode ? 550.0 : 850.0;
        var usableMb = Math.Max(550.0, snap.AvailablePhysicalMb - 1800.0);
        return Math.Clamp((int)Math.Floor(usableMb / perProfileMb), 1, 30);
    }
    public static (int CleanedFolders, long BytesFreed) CleanProfileCachesAndTrimMemory(
        string? isolatedRootOverride = null,
        ISet<string>? activeSlugs = null)
    {
        var root = isolatedRootOverride ?? ExtensionProvisioner.IsolatedProfilesRoot;
        int cleaned = 0;
        long bytes = 0;

        try
        {
            if (Directory.Exists(root))
            {
                var cacheRelPaths = new[]
                {
                    Path.Combine("Default", "Code Cache"),
                    Path.Combine("Default", "GPUCache"),
                    Path.Combine("Default", "Cache", "Cache_Data"),
                    "GrShaderCache",
                    "ShaderCache",
                };

                foreach (var profDir in Directory.EnumerateDirectories(root))
                {
                    var folderName = Path.GetFileName(profDir);
                    if (activeSlugs != null && activeSlugs.Contains(folderName))
                    {
                        continue;
                    }
                    foreach (var rel in cacheRelPaths)
                    {
                        var target = Path.Combine(profDir, rel);
                        if (!Directory.Exists(target)) continue;
                        try
                        {
                            long dirBytes = Directory.EnumerateFiles(target, "*", SearchOption.AllDirectories)
                                .Sum(f => { try { return new FileInfo(f).Length; } catch { return 0L; } });
                            Directory.Delete(target, recursive: true);
                            cleaned++;
                            bytes += dirBytes;
                        }
                        catch { }
                    }
                }
            }
        }
        catch { }

        try
        {
            GC.Collect(2, GCCollectionMode.Optimized, blocking: false);
            GC.WaitForPendingFinalizers();
        }
        catch { }

        return (cleaned, bytes);
    }
}
