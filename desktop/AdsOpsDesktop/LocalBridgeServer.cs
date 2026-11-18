using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web;
namespace AdsOpsDesktop;
public sealed class OpenChromeBridgeRequest
{
    [JsonPropertyName("via_id")] public string? ViaId { get; set; }
    [JsonPropertyName("profile")] public string? Profile { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("proxy")] public string? Proxy { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
    [JsonPropertyName("antidetect_engine")] public string? AntidetectEngine { get; set; }
    [JsonPropertyName("antidetect_profile_id")] public string? AntidetectProfileId { get; set; }
}
public sealed class LocalVaultSaveRequest
{
    [JsonPropertyName("via_id")] public string? ViaId { get; set; }
    [JsonPropertyName("via_label")] public string? ViaLabel { get; set; }
    [JsonPropertyName("profile_dir")] public string? ProfileDir { get; set; }
    [JsonPropertyName("cookie_raw")] public string? CookieRaw { get; set; }
    [JsonPropertyName("two_fa_secret")] public string? TwoFaSecret { get; set; }
}
public sealed class LocalVaultGetResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; } = true;
    [JsonPropertyName("found")] public bool Found { get; set; }
    [JsonPropertyName("via_id")] public string ViaId { get; set; } = "";
    [JsonPropertyName("via_label")] public string ViaLabel { get; set; } = "";
    [JsonPropertyName("profile_dir")] public string ProfileDir { get; set; } = "";
    [JsonPropertyName("cookie_raw")] public string CookieRaw { get; set; } = "";
    [JsonPropertyName("two_fa_secret")] public string TwoFaSecret { get; set; } = "";
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; } = "";
}
/// <summary>
/// Zero-Trust TCP HTTP server trên 127.0.0.1:
/// 1) Anti-DNS-Rebinding kiểm tra header Host chặt chẽ;
/// 2) Chặt bỏ wildcard `Access-Control-Allow-Origin: *`, chỉ phản hồi Origin Web AdsOps chính chủ & chrome-extension://;
/// 3) Xác thực constant-time `X-AdsOps-Bridge-Token` trên mọi API Vault/2FA/Mutation và toàn bộ request từ Extension.
/// </summary>
public sealed class LocalBridgeServer : IDisposable
{
    private static readonly Regex LoopbackHostRegex = new(@"^(127\.0\.0\.1|localhost)(:\d{1,5})?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex LocalOriginRegex = new(@"^https?://(127\.0\.0\.1|localhost)(:\d{1,5})?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly int _requestedPort;
    private readonly Func<OpenChromeBridgeRequest, Task<(bool Ok, string Message)>> _onOpenChrome;
    private readonly Func<BrowserEventPayloadDto, Task<BrowserEventResponseDto>> _onBrowserEvent;
    private readonly Func<Task<int>> _onProvisionAll;
    private readonly Func<LocalVaultSaveRequest, Task<LocalVaultGetResult>> _onVaultSave;
    private readonly Func<string, string, string, Task<LocalVaultGetResult>> _onVaultGet;
    private readonly Func<AutoConnectTokenBridgeRequest, Task<AutoConnectTokenBridgeResponse>> _onAutoConnectToken;
    private readonly Func<BillingSyncRequestDto, Task<BillingSyncResponseDto>> _onSyncBilling;
    private readonly Func<TileWindowsRequestDto?, TileWindowsResultDto> _onTileWindows;
    private readonly Func<string> _getBridgeToken;
    private readonly Func<string> _getAllowedWebAppUrl;
    private readonly Func<Task<object>> _onBenchmarkEngines;
    private readonly Action? _onRestoreWindow;
    private readonly Action<string> _log;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _acceptLoop;
    public static int ActiveBoundPort { get; private set; } = 0;
    public int BoundPort { get; private set; }
    public LocalBridgeServer(
        int port,
        Func<OpenChromeBridgeRequest, Task<(bool Ok, string Message)>> onOpenChrome,
        Func<BrowserEventPayloadDto, Task<BrowserEventResponseDto>> onBrowserEvent,
        Func<Task<int>> onProvisionAll,
        Action<string> log,
        Func<LocalVaultSaveRequest, Task<LocalVaultGetResult>>? onVaultSave = null,
        Func<string, string, string, Task<LocalVaultGetResult>>? onVaultGet = null,
        Func<AutoConnectTokenBridgeRequest, Task<AutoConnectTokenBridgeResponse>>? onAutoConnectToken = null,
        Func<BillingSyncRequestDto, Task<BillingSyncResponseDto>>? onSyncBilling = null,
        Func<TileWindowsRequestDto?, TileWindowsResultDto>? onTileWindows = null,
        Func<string>? getBridgeToken = null,
        Func<string>? getAllowedWebAppUrl = null,
        Func<Task<object>>? onBenchmarkEngines = null,
        Action? onRestoreWindow = null)
    {
        _requestedPort = port;
        _onOpenChrome = onOpenChrome;
        _onBrowserEvent = onBrowserEvent;
        _onProvisionAll = onProvisionAll;
        _log = log;
        _onRestoreWindow = onRestoreWindow;
        _onVaultSave = onVaultSave ?? (_ => Task.FromResult(new LocalVaultGetResult { Ok = false }));
        _onVaultGet = onVaultGet ?? ((_, _, _) => Task.FromResult(new LocalVaultGetResult { Ok = true, Found = false }));
        _onAutoConnectToken = onAutoConnectToken ?? (_ => Task.FromResult(new AutoConnectTokenBridgeResponse
        {
            Ok = false,
            Error = "Auto-connect handler chưa được cấu hình.",
        }));
        _onSyncBilling = onSyncBilling ?? (_ => Task.FromResult(new BillingSyncResponseDto
        {
            Status = "ignored",
            Reason = "handler_not_configured",
        }));
        _onTileWindows = onTileWindows ?? (req => WindowTilerService.TileChromeWindows(req?.Grid, req?.Pids));
        _getBridgeToken = getBridgeToken ?? (() => DesktopConfig.Load().GetOrCreateBridgeToken());
        _getAllowedWebAppUrl = getAllowedWebAppUrl ?? (() => DesktopConfig.DefaultWebAppUrl);
        _onBenchmarkEngines = onBenchmarkEngines ?? (async () =>
        {
            var cfg = DesktopConfig.Load();
            var probes = await AntidetectBrowserConnector.BenchmarkAllEnginesAsync(cfg.AntidetectApiBaseUrl, cfg.AntidetectApiKey).ConfigureAwait(false);
            var rec = AntidetectBrowserConnector.RecommendFastestOnlineEngine(probes);
            var history = AntidetectEngineBenchmarkStore.Default.GetAll();
            return new { ok = true, recommended_engine = rec, probes, history };
        });
    }
    public static bool IsLegacyAdsOpsBridgeCommandLine(string? cmdLine)
    {
        if (string.IsNullOrWhiteSpace(cmdLine)) return false;
        return cmdLine.Contains("adsops", StringComparison.OrdinalIgnoreCase) ||
               cmdLine.Contains("audit-ads", StringComparison.OrdinalIgnoreCase) ||
               cmdLine.Contains("adsops-chrome", StringComparison.OrdinalIgnoreCase) ||
               cmdLine.Contains("chrome_bridge", StringComparison.OrdinalIgnoreCase) ||
               cmdLine.Contains("local_bridge", StringComparison.OrdinalIgnoreCase);
    }
    private static string GetProcessCommandLineSafe(int pid)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc == null) return "";
            var stdout = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(1500);
            return (stdout ?? "").Trim();
        }
        catch
        {
            return "";
        }
    }
    public static bool RetireLegacyBridgeHoldingPort(int port, Action<string> log)
    {
        try
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) })
            {
                try
                {
                    var probe = http.GetStringAsync($"http://127.0.0.1:{port}/health").GetAwaiter().GetResult();
                    if (probe.Contains("\"AdsOpsDesktop\"", StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }
                }
                catch
                {
                    // Either port is free or legacy bridge returns 404/non-health
                }
            }
            var psi = new ProcessStartInfo
            {
                FileName = "netstat.exe",
                Arguments = "-ano -p tcp",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var netstatProc = Process.Start(psi);
            if (netstatProc == null) return false;
            var output = netstatProc.StandardOutput.ReadToEnd();
            netstatProc.WaitForExit(3000);
            var lineRx = new Regex($@"^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):{port}\s+\S+\s+\S+\s+(\d+)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);
            var retiredAny = false;
            foreach (Match m in lineRx.Matches(output))
            {
                if (!int.TryParse(m.Groups[1].Value, out var pid) || pid <= 4 || pid == Environment.ProcessId) continue;
                try
                {
                    using var holder = Process.GetProcessById(pid);
                    var pname = (holder.ProcessName ?? "").ToLowerInvariant();
                    if (pname is "python" or "pythonw" or "powershell" or "pwsh")
                    {
                        var cmdLine = GetProcessCommandLineSafe(pid);
                        if (!IsLegacyAdsOpsBridgeCommandLine(cmdLine))
                        {
                            continue;
                        }
                        holder.Kill(entireProcessTree: true);
                        holder.WaitForExit(1500);
                        log($"♻️ Đã tự động thay thế Cầu nối .bat cũ ({pname} PID {pid}) trên cổng {port} bằng AdsOps Desktop Pro v{DesktopAppInfo.Version}.");
                        retiredAny = true;
                    }
                }
                catch { }
            }
            if (retiredAny) Thread.Sleep(250);
            return retiredAny;
        }
        catch
        {
            return false;
        }
    }
    public void Start()
    {
        if (_listener != null) return;
        _cts = new CancellationTokenSource();
        if (_requestedPort == 0)
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            BoundPort = ((IPEndPoint)_listener.LocalEndpoint).Port;
            ActiveBoundPort = BoundPort;
        }
        else
        {
            var candidates = new[] { _requestedPort, 17891, 17892, 17893, 17894 }.Distinct().ToArray();
            Exception? lastEx = null;
            foreach (var candidate in candidates)
            {
                TcpListener? tryListener = null;
                try
                {
                    tryListener = new TcpListener(IPAddress.Loopback, candidate);
                    tryListener.Start();
                    _listener = tryListener;
                    BoundPort = ((IPEndPoint)_listener.LocalEndpoint).Port;
                    ActiveBoundPort = BoundPort;
                    if (BoundPort != _requestedPort)
                    {
                        _log($"ℹ️ Cổng {_requestedPort} đang được ứng dụng khác sử dụng -> Tự động chuyển Local Bridge sang cổng {BoundPort}.");
                    }
                    break;
                }
                catch (SocketException sx)
                {
                    lastEx = sx;
                    try { tryListener?.Stop(); } catch { }
                }
            }
            if (_listener == null)
            {
                throw lastEx ?? new InvalidOperationException("Không tìm được cổng Local Bridge khả dụng trong dải 17890..17894.");
            }
        }
        _acceptLoop = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }
    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener != null)
        {
            try
            {
                var client = await _listener.AcceptTcpClientAsync(ct).ConfigureAwait(false);
                _ = Task.Run(() => HandleClientAsync(client, ct), ct);
            }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (Exception ex)
            {
                _log($"[Bridge] Accept error: {ex.Message}");
            }
        }
    }
    private static string NormalizeOrigin(string? rawOrigin)
    {
        if (string.IsNullOrWhiteSpace(rawOrigin)) return "";
        return rawOrigin.Trim().TrimEnd('/');
    }
    private static bool IsExtensionOrigin(string origin) =>
        !string.IsNullOrEmpty(origin) && origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase);
    private bool IsAllowedWebOrigin(string origin)
    {
        if (string.IsNullOrEmpty(origin)) return false;
        if (string.Equals(origin, "https://adsops-app.vibe.tinhgon.xyz", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (LocalOriginRegex.IsMatch(origin))
        {
            return true;
        }
        var configuredWeb = (_getAllowedWebAppUrl() ?? "").Trim();
        if (Uri.TryCreate(configuredWeb, UriKind.Absolute, out var webUri) &&
            (webUri.Scheme == "https" || webUri.IsLoopback))
        {
            var expectedOrigin = $"{webUri.Scheme}://{webUri.Authority}".TrimEnd('/');
            if (string.Equals(origin, expectedOrigin, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }
    private bool HasValidBridgeToken(Dictionary<string, string> headers)
    {
        var expected = (_getBridgeToken() ?? "").Trim();
        if (string.IsNullOrEmpty(expected)) return false;
        if (!headers.TryGetValue("X-AdsOps-Bridge-Token", out var supplied) || string.IsNullOrWhiteSpace(supplied))
        {
            return false;
        }
        var a = Encoding.UTF8.GetBytes(expected);
        var b = Encoding.UTF8.GetBytes(supplied.Trim());
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
    private static bool IsTokenRequiredEndpoint(string method, string path)
    {
        if (path is "/local-vault/get" or "/local-vault/save" or "/totp" or "/auto-connect-token" or "/browser-event" or "/sync-billing" or "/provision-extensions")
        {
            return true;
        }
        return false;
    }
    private async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            try
            {
                await using var stream = client.GetStream();
                var (method, rawPath, headers, bodyText) = await ReadHttpRequestAsync(stream, ct).ConfigureAwait(false);
                if (string.IsNullOrEmpty(method)) return;
                // Gate 1: Anti-DNS-Rebinding Host header validation
                if (headers.TryGetValue("Host", out var hostHeader) &&
                    !string.IsNullOrWhiteSpace(hostHeader) &&
                    !LoopbackHostRegex.IsMatch(hostHeader.Trim()))
                {
                    _log($"[Bridge Zero-Trust] Chặn Host lạ '{hostHeader}'.");
                    await WriteHttpResponseAsync(stream, 403, "Forbidden", "{\"ok\":false,\"error\":\"Forbidden Host\"}", null, ct).ConfigureAwait(false);
                    return;
                }
                // Gate 2: Strict Origin Allowlist (never emit Access-Control-Allow-Origin: *)
                var origin = headers.TryGetValue("Origin", out var rawOrig) ? NormalizeOrigin(rawOrig) : "";
                var isExtOrig = IsExtensionOrigin(origin);
                var isWebOrig = IsAllowedWebOrigin(origin);
                if (!string.IsNullOrEmpty(origin) && !isExtOrig && !isWebOrig)
                {
                    _log($"[Bridge Zero-Trust] Chặn Origin lạ '{origin}' (CORS & PNA bị từ chối).");
                    await WriteHttpResponseAsync(stream, 403, "Forbidden", "{\"ok\":false,\"error\":\"Origin blocked by AdsOps Zero-Trust Bridge\"}", null, ct).ConfigureAwait(false);
                    return;
                }
                string? validatedOrigin = string.IsNullOrEmpty(origin) ? null : origin;
                if (method == "OPTIONS")
                {
                    await WriteHttpResponseAsync(stream, 204, "No Content", "", validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }
                var qIdx = rawPath.IndexOf('?');
                var path = (qIdx >= 0 ? rawPath[..qIdx] : rawPath).TrimEnd('/');
                var rawQuery = qIdx >= 0 ? rawPath[(qIdx + 1)..] : "";
                if (string.IsNullOrEmpty(path)) path = "/";
                // Gate 3: Constant-time X-AdsOps-Bridge-Token enforcement
                // Required on ALL Vault/2FA/Mutation endpoints and ALL chrome-extension:// calls (prevents rogue extensions snooping)
                if (isExtOrig || IsTokenRequiredEndpoint(method, path))
                {
                    if (!HasValidBridgeToken(headers))
                    {
                        var reason = isExtOrig ? "Extension missing/invalid X-AdsOps-Bridge-Token" : "Missing or invalid X-AdsOps-Bridge-Token";
                        await WriteHttpResponseAsync(
                            stream,
                            401,
                            "Unauthorized",
                            JsonSerializer.Serialize(new { ok = false, error = reason, zero_trust = true }),
                            validatedOrigin,
                            ct).ConfigureAwait(false);
                        return;
                    }
                }
                if (method == "GET" && path == "/health")
                {
                    var tpl = ExtensionProvisioner.LoadTemplates();
                    var json = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        app = "AdsOpsDesktop",
                        version = DesktopAppInfo.Version,
                        extVersion = tpl.Version,
                        port = BoundPort,
                        zeroTrust = true,
                    });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if ((method == "POST" || method == "GET") && (path == "/restore-window" || path == "/show-window"))
                {
                    _onRestoreWindow?.Invoke();
                    var json = JsonSerializer.Serialize(new { ok = true, message = "Window restored to foreground" });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "GET" && path == "/chrome-profiles")
                {
                    var profiles = ExtensionProvisioner.ReadLocalChromeProfiles();
                    var json = JsonSerializer.Serialize(new { ok = true, profiles });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/open")
                {
                    var req = JsonSerializer.Deserialize<OpenChromeBridgeRequest>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new OpenChromeBridgeRequest();
                    if (string.IsNullOrWhiteSpace(req.Url) || !req.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        await WriteHttpResponseAsync(stream, 400, "Bad Request", "{\"ok\":false,\"error\":\"Invalid target URL\"}", validatedOrigin, ct).ConfigureAwait(false);
                        return;
                    }
                    var (ok, msg) = await _onOpenChrome(req).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(new { ok, message = msg });
                    await WriteHttpResponseAsync(stream, ok ? 200 : 500, ok ? "OK" : "Error", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }
                if (method == "POST" && path == "/provision-extensions")
                {
                    var count = await _onProvisionAll().ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(new { ok = true, provisioned = count });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/browser-event")
                {
                    var ev = JsonSerializer.Deserialize<BrowserEventPayloadDto>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new BrowserEventPayloadDto();
                    var result = await _onBrowserEvent(ev).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/local-vault/save")
                {
                    var req = JsonSerializer.Deserialize<LocalVaultSaveRequest>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new LocalVaultSaveRequest();
                    var result = await _onVaultSave(req).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, result.Ok ? 200 : 400, result.Ok ? "OK" : "Bad Request", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }
                if (method == "GET" && path == "/local-vault/get")
                {
                    var qs = HttpUtility.ParseQueryString(rawQuery);
                    var viaId = (qs["via_id"] ?? "").Trim();
                    var profile = (qs["profile"] ?? "").Trim();
                    var name = (qs["name"] ?? "").Trim();
                    var result = await _onVaultGet(viaId, profile, name).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "GET" && path == "/totp")
                {
                    var qs = HttpUtility.ParseQueryString(rawQuery);
                    var viaId = (qs["via_id"] ?? "").Trim();
                    var profile = (qs["profile"] ?? "").Trim();
                    var name = (qs["name"] ?? "").Trim();
                    var vault = await _onVaultGet(viaId, profile, name).ConfigureAwait(false);
                    var totp = TotpService.ComputeTotp(vault.TwoFaSecret);
                    var json = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        found = vault.Found && totp.Valid,
                        code = totp.Code6,
                        formatted = totp.FormattedCode,
                        seconds_remaining = totp.SecondsRemaining,
                        via_label = !string.IsNullOrWhiteSpace(vault.ViaLabel) ? vault.ViaLabel : name,
                    });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/auto-connect-token")
                {
                    var req = JsonSerializer.Deserialize<AutoConnectTokenBridgeRequest>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new AutoConnectTokenBridgeRequest();
                    if (string.IsNullOrWhiteSpace(req.AccessToken))
                    {
                        var errJson = JsonSerializer.Serialize(new AutoConnectTokenBridgeResponse
                        {
                            Ok = false,
                            Error = "Thiếu access_token (EAAB...) để đẩy lên Cloud.",
                        });
                        await WriteHttpResponseAsync(stream, 400, "Bad Request", errJson, validatedOrigin, ct).ConfigureAwait(false);
                        return;
                    }
                    var result = await _onAutoConnectToken(req).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, result.Ok ? 200 : 400, result.Ok ? "OK" : "Bad Request", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }
                if (method == "GET" && path == "/chrome-sessions")
                {
                    var sessions = ChromeSessionTracker.Default.GetSnapshot();
                    var mem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();
                    var recMax = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(true, mem);
                    var json = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        active_count = sessions.Count(s => s.Alive),
                        sessions,
                        workstation_memory = new
                        {
                            total_physical_mb = mem.TotalPhysicalMb,
                            available_physical_mb = mem.AvailablePhysicalMb,
                            memory_load_percent = mem.MemoryLoadPercent,
                            recommended_max_concurrent = recMax,
                        },
                    });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "GET" && path == "/antidetect/benchmark")
                {
                    var benchPayload = await _onBenchmarkEngines().ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(benchPayload);
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/sync-billing")
                {
                    var reqDto = string.IsNullOrWhiteSpace(bodyText)
                        ? null
                        : JsonSerializer.Deserialize<BillingSyncRequestDto>(bodyText, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (reqDto == null || string.IsNullOrWhiteSpace(reqDto.ExternalAccountId))
                    {
                        await WriteHttpResponseAsync(
                            stream,
                            400,
                            "Bad Request",
                            "{\"ok\":false,\"error\":\"Thiếu external_account_id để đồng bộ Billing.\"}",
                            validatedOrigin,
                            ct).ConfigureAwait(false);
                        return;
                    }
                    var syncRes = await _onSyncBilling(reqDto).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(new
                    {
                        ok = string.Equals(syncRes.Status, "synced", StringComparison.OrdinalIgnoreCase),
                        status = syncRes.Status,
                        ad_account_id = syncRes.AdAccountId,
                        updated_fields = syncRes.UpdatedFields,
                        reason = syncRes.Reason,
                    });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/tile-windows")
                {
                    TileWindowsRequestDto? reqDto = null;
                    if (!string.IsNullOrWhiteSpace(bodyText))
                    {
                        try
                        {
                            reqDto = JsonSerializer.Deserialize<TileWindowsRequestDto>(bodyText, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        }
                        catch { }
                    }
                    var tileRes = _onTileWindows(reqDto);
                    var json = JsonSerializer.Serialize(tileRes);
                    await WriteHttpResponseAsync(stream, 200, "OK", json, validatedOrigin, ct).ConfigureAwait(false);
                    return;
                }

                await WriteHttpResponseAsync(stream, 404, "Not Found", "{\"ok\":false,\"error\":\"Not Found\"}", validatedOrigin, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log($"[Bridge] Request error: {ex.Message}");
            }
        }
    }
    private static async Task<(string Method, string Path, Dictionary<string, string> Headers, string Body)> ReadHttpRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[8192];
        var ms = new MemoryStream();
        int headerEnd = -1;
        while (headerEnd < 0 && ms.Length < 65536)
        {
            var n = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (n <= 0) break;
            ms.Write(buffer, 0, n);
            headerEnd = FindHeaderTerminator(ms.GetBuffer(), (int)ms.Length);
        }
        var emptyHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (headerEnd < 0) return ("", "", emptyHeaders, "");
        var rawBytes = ms.GetBuffer();
        var headerText = Encoding.ASCII.GetString(rawBytes, 0, headerEnd);
        var lines = headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return ("", "", emptyHeaders, "");
        var firstParts = lines[0].Split(' ');
        if (firstParts.Length < 2) return ("", "", emptyHeaders, "");
        var method = firstParts[0].Trim().ToUpperInvariant();
        var path = firstParts[1].Trim();
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        int contentLength = 0;
        foreach (var line in lines[1..])
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var k = line[..colon].Trim();
            var v = line[(colon + 1)..].Trim();
            headers[k] = v;
            if (string.Equals(k, "Content-Length", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(v, out var len))
            {
                contentLength = Math.Clamp(len, 0, 1_048_576);
            }
        }
        var bodyStart = headerEnd + 4;
        var totalLen = (int)ms.Length;
        while ((totalLen - bodyStart) < contentLength)
        {
            var n = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (n <= 0) break;
            ms.Write(buffer, 0, n);
            totalLen = (int)ms.Length;
        }
        var body = contentLength > 0 && (totalLen - bodyStart) >= contentLength
            ? Encoding.UTF8.GetString(ms.GetBuffer(), bodyStart, contentLength)
            : "";
        return (method, path, headers, body);
    }
    private static int FindHeaderTerminator(byte[] buf, int length)
    {
        for (int i = 0; i <= length - 4; i++)
        {
            if (buf[i] == '\r' && buf[i + 1] == '\n' && buf[i + 2] == '\r' && buf[i + 3] == '\n')
            {
                return i;
            }
        }
        return -1;
    }
    private static async Task WriteHttpResponseAsync(NetworkStream stream, int code, string reason, string jsonBody, string? validatedOrigin, CancellationToken ct)
    {
        var bodyBytes = string.IsNullOrEmpty(jsonBody) ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(jsonBody);
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {code} {reason}\r\n");
        if (!string.IsNullOrEmpty(validatedOrigin))
        {
            sb.Append($"Access-Control-Allow-Origin: {validatedOrigin}\r\n");
            sb.Append("Vary: Origin\r\n");
            sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            sb.Append("Access-Control-Allow-Headers: Content-Type, Authorization, X-AdsOps-Bridge-Token\r\n");
            sb.Append("Access-Control-Allow-Private-Network: true\r\n");
        }
        sb.Append("Cache-Control: no-store\r\n");
        sb.Append("Connection: close\r\n");
        if (bodyBytes.Length > 0)
        {
            sb.Append("Content-Type: application/json; charset=utf-8\r\n");
        }
        sb.Append($"Content-Length: {bodyBytes.Length}\r\n\r\n");
        var headBytes = Encoding.ASCII.GetBytes(sb.ToString());
        await stream.WriteAsync(headBytes, ct).ConfigureAwait(false);
        if (bodyBytes.Length > 0)
        {
            await stream.WriteAsync(bodyBytes, ct).ConfigureAwait(false);
        }
        await stream.FlushAsync(ct).ConfigureAwait(false);
    }
    public void Dispose()
    {
        if (BoundPort > 0 && ActiveBoundPort == BoundPort)
        {
            ActiveBoundPort = 0;
        }
        try { _cts?.Cancel(); } catch { }
        try { _listener?.Stop(); } catch { }
        _listener = null;
        _cts?.Dispose();
        _cts = null;
    }
}
