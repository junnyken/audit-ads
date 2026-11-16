using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AdsOpsDesktop;

public sealed record AntidetectProfileSummary(
    string Engine,
    string ProfileId,
    string Name,
    string Notes = "",
    string GroupName = "");

public sealed record AntidetectProbeResult(
    bool Online,
    string Engine,
    string BaseUrl,
    string Message,
    int ProfileCount = 0);

public sealed record AntidetectLaunchResult(
    bool Ok,
    string Engine,
    string ProfileId,
    string DebugWsUrl,
    int? DebugPort,
    int? Pid,
    string Message);

/// <summary>
/// Cổng kết nối API nội bộ cho 5 trình duyệt Antidetect phổ biến (AdsPower, Dolphin{anty}, Hidemyacc, Genlogin, GoLogin)
/// kèm chế độ mặc định Chrome Gốc cô lập — 100% gọi HTTP API thật, không dữ liệu giả.
/// </summary>
public static class AntidetectBrowserConnector
{
    public static readonly (string Key, string Label, string DefaultUrl)[] SupportedEngines =
    {
        ("chrome_native", "Chrome Gốc Chuẩn (Khiên WebRTC + Chống Automation)", "http://127.0.0.1:17890"),
        ("adspower", "AdsPower Local API (:50325)", "http://127.0.0.1:50325"),
        ("dolphin_anty", "Dolphin{anty} Local API (:3001)", "http://127.0.0.1:3001"),
        ("hidemyacc", "Hidemyacc Local API (:12368)", "http://127.0.0.1:12368"),
        ("genlogin", "Genlogin Local API (:55550)", "http://127.0.0.1:55550"),
        ("gologin", "GoLogin Orbita API (:36912)", "http://127.0.0.1:36912"),
    };

    public static string NormalizeEngine(string? raw)
    {
        var s = (raw ?? "").Trim().ToLowerInvariant();
        return s switch
        {
            "adspower" => "adspower",
            "dolphin" or "dolphin_anty" or "dolphin-anty" => "dolphin_anty",
            "hidemyacc" => "hidemyacc",
            "genlogin" => "genlogin",
            "gologin" or "orbita" => "gologin",
            _ => "chrome_native",
        };
    }

    public static string GetDisplayName(string? engine)
    {
        var norm = NormalizeEngine(engine);
        return norm switch
        {
            "adspower" => "AdsPower",
            "dolphin_anty" => "Dolphin{anty}",
            "hidemyacc" => "Hidemyacc",
            "genlogin" => "Genlogin",
            "gologin" => "GoLogin",
            _ => "Chrome Gốc",
        };
    }

    public static string GetDefaultBaseUrl(string? engine)
    {
        var norm = NormalizeEngine(engine);
        var found = SupportedEngines.FirstOrDefault(e => e.Key == norm);
        return string.IsNullOrEmpty(found.DefaultUrl) ? "http://127.0.0.1:17890" : found.DefaultUrl;
    }

    public static string ResolveEffectiveBaseUrl(string? engine, string? customBaseUrl)
    {
        var raw = (customBaseUrl ?? "").Trim().TrimEnd('/');
        if (!string.IsNullOrEmpty(raw) &&
            Uri.TryCreate(raw, UriKind.Absolute, out var u) &&
            u.Scheme is "http" or "https" &&
            (u.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
             u.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
             u.Scheme == "https"))
        {
            return raw;
        }
        return GetDefaultBaseUrl(engine);
    }

    private static HttpClient CreateHttp(string? apiKey, int timeoutSeconds = 8)
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds, 2, 30)) };
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
        }
        return http;
    }

    private static string ExtractJsonString(JsonElement el, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (el.TryGetProperty(k, out var val))
            {
                if (val.ValueKind == JsonValueKind.String)
                {
                    var s = val.GetString() ?? "";
                    if (!string.IsNullOrWhiteSpace(s)) return s.Trim();
                }
                else if (val.ValueKind == JsonValueKind.Number)
                {
                    return val.GetRawText();
                }
            }
        }
        return "";
    }

    private static int? ExtractJsonInt(JsonElement el, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (el.TryGetProperty(k, out var val))
            {
                if (val.ValueKind == JsonValueKind.Number && val.TryGetInt32(out var n)) return n;
                if (val.ValueKind == JsonValueKind.String && int.TryParse(val.GetString(), out var ns)) return ns;
            }
        }
        return null;
    }

    private static IEnumerable<JsonElement> ExtractProfileArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray()) yield return item;
            yield break;
        }
        if (root.ValueKind != JsonValueKind.Object) yield break;

        if (root.TryGetProperty("data", out var dataEl))
        {
            if (dataEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in dataEl.EnumerateArray()) yield return item;
                yield break;
            }
            if (dataEl.ValueKind == JsonValueKind.Object)
            {
                foreach (var arrKey in new[] { "list", "items", "profiles", "rows" })
                {
                    if (dataEl.TryGetProperty(arrKey, out var sub) && sub.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in sub.EnumerateArray()) yield return item;
                        yield break;
                    }
                }
            }
        }

        foreach (var arrKey in new[] { "profiles", "items", "list", "rows" })
        {
            if (root.TryGetProperty(arrKey, out var sub) && sub.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in sub.EnumerateArray()) yield return item;
                yield break;
            }
        }
    }

    public static async Task<AntidetectProbeResult> ProbeEngineAsync(
        string engine,
        string? customBaseUrl = null,
        string? apiKey = null,
        CancellationToken ct = default,
        HttpClient? httpOverride = null)
    {
        var norm = NormalizeEngine(engine);
        var baseUrl = ResolveEffectiveBaseUrl(norm, customBaseUrl);
        if (norm == "chrome_native")
        {
            var localProfiles = ExtensionProvisioner.ReadLocalChromeProfiles();
            return new AntidetectProbeResult(
                true,
                norm,
                baseUrl,
                $"Chrome Gốc + Khiên WebRTC sẵn sàng ({localProfiles.Count} Chrome Profile trên máy).",
                localProfiles.Count);
        }

        var ownsHttp = httpOverride == null;
        var http = httpOverride ?? CreateHttp(apiKey, timeoutSeconds: 5);
        try
        {
            var probePath = norm switch
            {
                "adspower" => "/status",
                "dolphin_anty" => "/v1.0/browser_profiles?limit=20",
                "hidemyacc" => "/profiles",
                "genlogin" => "/backend/profiles?limit=20&offset=0",
                "gologin" => "/browser/active-profiles",
                _ => "/health",
            };

            using var resp = await http.GetAsync($"{baseUrl}{probePath}", ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode && norm == "hidemyacc")
            {
                using var respAlt = await http.GetAsync($"{baseUrl}/me", ct).ConfigureAwait(false);
                if (respAlt.IsSuccessStatusCode)
                {
                    return new AntidetectProbeResult(true, norm, baseUrl, $"{GetDisplayName(norm)} Local API đang bật tại {baseUrl}.");
                }
            }

            if (!resp.IsSuccessStatusCode)
            {
                return new AntidetectProbeResult(false, norm, baseUrl, $"{GetDisplayName(norm)} phản hồi HTTP {(int)resp.StatusCode} tại {baseUrl}.");
            }

            var profiles = new List<AntidetectProfileSummary>();
            if (norm == "adspower")
            {
                var listRes = await ListProfilesAsync(norm, baseUrl, apiKey, ct, http).ConfigureAwait(false);
                profiles = listRes;
            }
            else if (!string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    foreach (var el in ExtractProfileArray(doc.RootElement))
                    {
                        var pid = ExtractJsonString(el, "user_id", "id", "profile_id", "_id");
                        var nm = ExtractJsonString(el, "name", "profile_name", "label");
                        if (!string.IsNullOrEmpty(pid))
                        {
                            profiles.Add(new AntidetectProfileSummary(norm, pid, string.IsNullOrEmpty(nm) ? pid : nm));
                        }
                    }
                }
                catch { }
            }

            return new AntidetectProbeResult(
                true,
                norm,
                baseUrl,
                $"✓ Kết nối thành công {GetDisplayName(norm)} tại {baseUrl} ({profiles.Count} Profile đọc được).",
                profiles.Count);
        }
        catch (Exception ex)
        {
            return new AntidetectProbeResult(
                false,
                norm,
                baseUrl,
                $"Chưa kết nối được {GetDisplayName(norm)} tại {baseUrl} (hãy mở app {GetDisplayName(norm)} trước): {ex.Message}");
        }
        finally
        {
            if (ownsHttp) http.Dispose();
        }
    }

    public static async Task<List<AntidetectProfileSummary>> ListProfilesAsync(
        string engine,
        string? customBaseUrl = null,
        string? apiKey = null,
        CancellationToken ct = default,
        HttpClient? httpOverride = null)
    {
        var norm = NormalizeEngine(engine);
        var results = new List<AntidetectProfileSummary>();
        if (norm == "chrome_native")
        {
            return ExtensionProvisioner.ReadLocalChromeProfiles()
                .Select(p => new AntidetectProfileSummary("chrome_native", p.Folder, p.Label, p.Email, "Chrome Native"))
                .ToList();
        }

        var baseUrl = ResolveEffectiveBaseUrl(norm, customBaseUrl);
        var path = norm switch
        {
            "adspower" => "/api/v1/user/list?page=1&page_size=100",
            "dolphin_anty" => "/v1.0/browser_profiles?limit=100",
            "hidemyacc" => "/profiles",
            "genlogin" => "/backend/profiles?limit=100&offset=0",
            "gologin" => "/browser/active-profiles",
            _ => "",
        };
        if (string.IsNullOrEmpty(path)) return results;

        var ownsHttp = httpOverride == null;
        var http = httpOverride ?? CreateHttp(apiKey, timeoutSeconds: 8);
        try
        {
            using var resp = await http.GetAsync($"{baseUrl}{path}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return results;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(json)) return results;

            using var doc = JsonDocument.Parse(json);
            foreach (var el in ExtractProfileArray(doc.RootElement))
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                var pid = ExtractJsonString(el, "user_id", "id", "profile_id", "_id");
                if (string.IsNullOrWhiteSpace(pid)) continue;
                var name = ExtractJsonString(el, "name", "profile_name", "title", "label");
                var notes = ExtractJsonString(el, "remark", "notes", "note");
                var group = ExtractJsonString(el, "group_name", "group", "folder");
                results.Add(new AntidetectProfileSummary(norm, pid, string.IsNullOrWhiteSpace(name) ? pid : name, notes, group));
            }
        }
        catch
        {
            // Caller gets empty list when local Antidetect app is offline
        }
        finally
        {
            if (ownsHttp) http.Dispose();
        }
        return results;
    }

    public static async Task<AntidetectLaunchResult> StartProfileAsync(
        string engine,
        string? customBaseUrl,
        string? apiKey,
        string profileId,
        CancellationToken ct = default,
        HttpClient? httpOverride = null)
    {
        var norm = NormalizeEngine(engine);
        var cleanId = (profileId ?? "").Trim();
        if (norm == "chrome_native" || string.IsNullOrWhiteSpace(cleanId))
        {
            return new AntidetectLaunchResult(false, norm, cleanId, "", null, null, "Thiếu Antidetect Profile ID hợp lệ.");
        }

        var baseUrl = ResolveEffectiveBaseUrl(norm, customBaseUrl);
        var escId = Uri.EscapeDataString(cleanId);
        var ownsHttp = httpOverride == null;
        var http = httpOverride ?? CreateHttp(apiKey, timeoutSeconds: 20);
        try
        {
            HttpResponseMessage resp;
            switch (norm)
            {
                case "adspower":
                    resp = await http.GetAsync($"{baseUrl}/api/v1/browser/start?user_id={escId}&open_tabs=1", ct).ConfigureAwait(false);
                    break;
                case "dolphin_anty":
                    resp = await http.GetAsync($"{baseUrl}/v1.0/browser_profiles/{escId}/start?automation=1", ct).ConfigureAwait(false);
                    break;
                case "hidemyacc":
                    resp = await http.PostAsync($"{baseUrl}/profiles/start/{escId}", new StringContent("{}", Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
                    break;
                case "genlogin":
                    resp = await http.PutAsync($"{baseUrl}/backend/profiles/{escId}/start", new StringContent("{}", Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
                    if ((int)resp.StatusCode == 404 || (int)resp.StatusCode == 405)
                    {
                        resp.Dispose();
                        resp = await http.GetAsync($"{baseUrl}/backend/profiles/{escId}/start", ct).ConfigureAwait(false);
                    }
                    break;
                case "gologin":
                    var body = JsonSerializer.Serialize(new { profileId = cleanId, sync = true });
                    resp = await http.PostAsync($"{baseUrl}/browser/start-profile", new StringContent(body, Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
                    break;
                default:
                    return new AntidetectLaunchResult(false, norm, cleanId, "", null, null, "Engine không được hỗ trợ.");
            }

            using (resp)
            {
                var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode)
                {
                    return new AntidetectLaunchResult(false, norm, cleanId, "", null, null, $"{GetDisplayName(norm)} từ chối mở Profile #{cleanId}: HTTP {(int)resp.StatusCode} {json}");
                }

                string wsUrl = "";
                int? debugPort = null;
                int? pid = null;
                bool okFlag = true;
                string apiMsg = "";

                if (!string.IsNullOrWhiteSpace(json))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(json);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("code", out var codeEl) && codeEl.ValueKind == JsonValueKind.Number && codeEl.GetInt32() != 0)
                        {
                            okFlag = false;
                            apiMsg = ExtractJsonString(root, "msg", "message", "error");
                        }
                        if (root.TryGetProperty("success", out var sucEl) && sucEl.ValueKind is JsonValueKind.False)
                        {
                            okFlag = false;
                            apiMsg = ExtractJsonString(root, "msg", "message", "error");
                        }

                        var targetObj = root.TryGetProperty("data", out var dEl) && dEl.ValueKind == JsonValueKind.Object ? dEl : root;
                        if (targetObj.TryGetProperty("ws", out var wsEl) && wsEl.ValueKind == JsonValueKind.Object)
                        {
                            wsUrl = ExtractJsonString(wsEl, "puppeteer", "selenium");
                        }
                        if (string.IsNullOrEmpty(wsUrl))
                        {
                            wsUrl = ExtractJsonString(targetObj, "wsEndpoint", "wsUrl", "puppeteer");
                        }
                        if (targetObj.TryGetProperty("automation", out var autoEl) && autoEl.ValueKind == JsonValueKind.Object)
                        {
                            debugPort ??= ExtractJsonInt(autoEl, "port");
                            if (string.IsNullOrEmpty(wsUrl))
                            {
                                var wsPath = ExtractJsonString(autoEl, "wsEndpoint");
                                if (!string.IsNullOrEmpty(wsPath) && debugPort.HasValue)
                                {
                                    wsUrl = wsPath.StartsWith("ws://", StringComparison.OrdinalIgnoreCase) ? wsPath : $"ws://127.0.0.1:{debugPort}{wsPath}";
                                }
                            }
                        }
                        debugPort ??= ExtractJsonInt(targetObj, "debug_port", "port", "remoteDebuggingPort");
                        pid ??= ExtractJsonInt(targetObj, "pid");
                    }
                    catch { }
                }

                if (!okFlag)
                {
                    return new AntidetectLaunchResult(false, norm, cleanId, wsUrl, debugPort, pid, string.IsNullOrWhiteSpace(apiMsg) ? $"Lỗi mở Profile trên {GetDisplayName(norm)}" : apiMsg);
                }

                return new AntidetectLaunchResult(
                    true,
                    norm,
                    cleanId,
                    wsUrl,
                    debugPort,
                    pid,
                    $"Đã mở Profile '{cleanId}' qua {GetDisplayName(norm)}" + (debugPort.HasValue ? $" (CDP :{debugPort})" : ""));
            }
        }
        catch (Exception ex)
        {
            return new AntidetectLaunchResult(false, norm, cleanId, "", null, null, $"Không gọi được API {GetDisplayName(norm)}: {ex.Message}");
        }
        finally
        {
            if (ownsHttp) http.Dispose();
        }
    }

    public static async Task<bool> StopProfileAsync(
        string engine,
        string? customBaseUrl,
        string? apiKey,
        string profileId,
        CancellationToken ct = default,
        HttpClient? httpOverride = null)
    {
        var norm = NormalizeEngine(engine);
        var cleanId = (profileId ?? "").Trim();
        if (norm == "chrome_native" || string.IsNullOrWhiteSpace(cleanId)) return false;

        var baseUrl = ResolveEffectiveBaseUrl(norm, customBaseUrl);
        var escId = Uri.EscapeDataString(cleanId);
        var ownsHttp = httpOverride == null;
        var http = httpOverride ?? CreateHttp(apiKey, timeoutSeconds: 8);
        try
        {
            HttpResponseMessage resp = norm switch
            {
                "adspower" => await http.GetAsync($"{baseUrl}/api/v1/browser/stop?user_id={escId}", ct).ConfigureAwait(false),
                "dolphin_anty" => await http.GetAsync($"{baseUrl}/v1.0/browser_profiles/{escId}/stop", ct).ConfigureAwait(false),
                "hidemyacc" => await http.PostAsync($"{baseUrl}/profiles/stop/{escId}", new StringContent("{}", Encoding.UTF8, "application/json"), ct).ConfigureAwait(false),
                "genlogin" => await http.PutAsync($"{baseUrl}/backend/profiles/{escId}/stop", new StringContent("{}", Encoding.UTF8, "application/json"), ct).ConfigureAwait(false),
                "gologin" => await http.PostAsync($"{baseUrl}/browser/stop-profile", new StringContent(JsonSerializer.Serialize(new { profileId = cleanId }), Encoding.UTF8, "application/json"), ct).ConfigureAwait(false),
                _ => new HttpResponseMessage(System.Net.HttpStatusCode.BadRequest),
            };
            using (resp) return resp.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (ownsHttp) http.Dispose();
        }
    }
}
