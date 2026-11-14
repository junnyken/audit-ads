using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace AdsOpsDesktop;

public sealed class ExtensionTemplateBundle
{
    [JsonPropertyName("version")] public string Version { get; set; } = "2.9.0";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("passkey_shield_js")] public string PasskeyShieldJs { get; set; } = "";
    [JsonPropertyName("background_js_after_default_state")] public string BackgroundJsAfterDefaultState { get; set; } = "";
    [JsonPropertyName("content_js")] public string ContentJs { get; set; } = "";
    [JsonPropertyName("popup_html")] public string PopupHtml { get; set; } = "";
    [JsonPropertyName("popup_js")] public string PopupJs { get; set; } = "";
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
    private static readonly Regex TwoFaParamRegex = new(@"(?:secret=|2fa[:=]\s*)([A-Z2-7]{16,64})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PureBase32Regex = new(@"^[A-Z2-7]{16,64}$", RegexOptions.Compiled);

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
            ?? throw new InvalidDataException("Không thể đọc dữ liệu template Extension v2.9.");
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

    public static string SanitizeFolderSlug(string? name, string? fallbackId = null)
    {
        var baseName = Regex.Replace((name ?? "").Trim(), @"[^a-zA-Z0-9_-]+", "-").Trim('-');
        if (string.IsNullOrEmpty(baseName)) baseName = "via";
        if (baseName.Length > 36) baseName = baseName[..36];
        var suffix = string.IsNullOrWhiteSpace(fallbackId)
            ? ""
            : "-" + Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "")[..Math.Min(6, Regex.Replace(fallbackId, @"[^a-zA-Z0-9]", "").Length)];
        return $"{baseName}{suffix}".ToLowerInvariant();
    }

    public static string ProvisionForVia(ViaWorkspaceEntry via, string? extensionsRootOverride = null)
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

        var defaultStateJson = JsonSerializer.Serialize(new
        {
            viaId = via.ViaId ?? "",
            viaName = displayViaName,
            profileCode = profileDir,
            viaTier = string.IsNullOrWhiteSpace(via.ViaTier) ? "camp" : via.ViaTier,
            twoFaSecret = (via.TwoFaSecret ?? "").Trim().ToUpperInvariant(),
            webrtcShield = true,
            blockPasskey = true,
            passkeyStatus = "clean",
            proxyRaw = parsedProxy?.CompactRaw ?? "",
            proxyEnabled = hasProxy,
            accounts = Array.Empty<object>(),
        });

        var utf8NoBom = new UTF8Encoding(false);
        File.WriteAllText(Path.Combine(targetDir, "manifest.json"), JsonSerializer.Serialize(manifestObj, new JsonSerializerOptions { WriteIndented = true }) + "\n", utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "passkey_shield.js"), tpl.PasskeyShieldJs, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "background.js"), $"const DEFAULT_STATE = {defaultStateJson};\n{tpl.BackgroundJsAfterDefaultState}", utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "content.js"), tpl.ContentJs, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "popup.html"), tpl.PopupHtml, utf8NoBom);
        File.WriteAllText(Path.Combine(targetDir, "popup.js"), tpl.PopupJs, utf8NoBom);
        File.WriteAllText(
            Path.Combine(targetDir, "HUONG-DAN-CAI-DAT.txt"),
            $"ADSOPS COMPANION v{tpl.Version} (AUTO-PROVISIONED BY ADSOPS DESKTOP PRO)\r\n" +
            $"Via: {displayViaName}\r\nChrome Profile: {profileDir}\r\nProxy: {(hasProxy ? parsedProxy!.CompactRaw : "Direct")}\r\n" +
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

    public static void LaunchChrome(string url, string profileDir, string? extFolder, bool isolatedMode, string? viaSlug = null)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Chỉ cho phép mở đường dẫn https:// hợp lệ.");
        }
        var safeProfile = SafeProfileDirRegex.IsMatch(profileDir ?? "") ? profileDir! : "Default";
        var chromeExe = FindChromeExecutable() ?? "chrome.exe";
        var psi = new ProcessStartInfo
        {
            FileName = chromeExe,
            UseShellExecute = true,
        };

        if (isolatedMode)
        {
            var isoSlug = SanitizeFolderSlug(string.IsNullOrWhiteSpace(viaSlug) ? safeProfile : viaSlug);
            var isoDir = Path.Combine(IsolatedProfilesRoot, isoSlug);
            Directory.CreateDirectory(isoDir);
            psi.ArgumentList.Add($"--user-data-dir={isoDir}");
            psi.ArgumentList.Add("--no-first-run");
            psi.ArgumentList.Add("--no-default-browser-check");
        }
        else
        {
            psi.ArgumentList.Add($"--profile-directory={safeProfile}");
        }

        if (!string.IsNullOrWhiteSpace(extFolder) && Directory.Exists(extFolder))
        {
            psi.ArgumentList.Add($"--load-extension={extFolder}");
        }
        psi.ArgumentList.Add(url);
        Process.Start(psi);
    }
}
