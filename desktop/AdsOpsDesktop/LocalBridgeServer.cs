using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
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
    [JsonPropertyName("profile")] public string? Profile { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("proxy")] public string? Proxy { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
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

/// <summary>Zero-Admin TCP HTTP server on 127.0.0.1 with full CORS + Chrome Private Network Access headers.</summary>
public sealed class LocalBridgeServer : IDisposable
{
    private readonly int _requestedPort;
    private readonly Func<OpenChromeBridgeRequest, Task<(bool Ok, string Message)>> _onOpenChrome;
    private readonly Func<BrowserEventPayloadDto, Task<BrowserEventResponseDto>> _onBrowserEvent;
    private readonly Func<Task<int>> _onProvisionAll;
    private readonly Func<LocalVaultSaveRequest, Task<LocalVaultGetResult>> _onVaultSave;
    private readonly Func<string, string, string, Task<LocalVaultGetResult>> _onVaultGet;
    private readonly Action<string> _log;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _acceptLoop;

    public int BoundPort { get; private set; }

    public LocalBridgeServer(
        int port,
        Func<OpenChromeBridgeRequest, Task<(bool Ok, string Message)>> onOpenChrome,
        Func<BrowserEventPayloadDto, Task<BrowserEventResponseDto>> onBrowserEvent,
        Func<Task<int>> onProvisionAll,
        Action<string> log,
        Func<LocalVaultSaveRequest, Task<LocalVaultGetResult>>? onVaultSave = null,
        Func<string, string, string, Task<LocalVaultGetResult>>? onVaultGet = null)
    {
        _requestedPort = port;
        _onOpenChrome = onOpenChrome;
        _onBrowserEvent = onBrowserEvent;
        _onProvisionAll = onProvisionAll;
        _log = log;
        _onVaultSave = onVaultSave ?? (_ => Task.FromResult(new LocalVaultGetResult { Ok = false }));
        _onVaultGet = onVaultGet ?? ((_, _, _) => Task.FromResult(new LocalVaultGetResult { Ok = true, Found = false }));
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

            var lineRx = new Regex($@"^\s*TCP\s+127\.0\.0\.1:{port}\s+\S+\s+LISTENING\s+(\d+)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);
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
                        holder.Kill(entireProcessTree: true);
                        holder.WaitForExit(1500);
                        log($"♻️ Đã tự động thay thế Cầu nối .bat cũ ({pname} PID {pid}) trên cổng {port} bằng AdsOps Desktop Pro v1.1.");
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
        _listener = new TcpListener(IPAddress.Loopback, _requestedPort);
        _listener.Start();
        BoundPort = ((IPEndPoint)_listener.LocalEndpoint).Port;
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

    private async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            try
            {
                await using var stream = client.GetStream();
                var (method, rawPath, bodyText) = await ReadHttpRequestAsync(stream, ct).ConfigureAwait(false);
                if (string.IsNullOrEmpty(method)) return;

                if (method == "OPTIONS")
                {
                    await WriteHttpResponseAsync(stream, 204, "No Content", "", ct).ConfigureAwait(false);
                    return;
                }

                var qIdx = rawPath.IndexOf('?');
                var path = (qIdx >= 0 ? rawPath[..qIdx] : rawPath).TrimEnd('/');
                var rawQuery = qIdx >= 0 ? rawPath[(qIdx + 1)..] : "";
                if (string.IsNullOrEmpty(path)) path = "/";

                if (method == "GET" && path == "/health")
                {
                    var tpl = ExtensionProvisioner.LoadTemplates();
                    var json = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        app = "AdsOpsDesktop",
                        version = "1.1.0",
                        extVersion = tpl.Version,
                        port = BoundPort,
                    });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "GET" && path == "/chrome-profiles")
                {
                    var profiles = ExtensionProvisioner.ReadLocalChromeProfiles();
                    var json = JsonSerializer.Serialize(new { ok = true, profiles });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/open")
                {
                    var req = JsonSerializer.Deserialize<OpenChromeBridgeRequest>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new OpenChromeBridgeRequest();
                    if (string.IsNullOrWhiteSpace(req.Url) || !req.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        await WriteHttpResponseAsync(stream, 400, "Bad Request", "{\"ok\":false,\"error\":\"Invalid target URL\"}", ct).ConfigureAwait(false);
                        return;
                    }
                    var (ok, msg) = await _onOpenChrome(req).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(new { ok, message = msg });
                    await WriteHttpResponseAsync(stream, ok ? 200 : 500, ok ? "OK" : "Error", json, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/provision-extensions")
                {
                    var count = await _onProvisionAll().ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(new { ok = true, provisioned = count });
                    await WriteHttpResponseAsync(stream, 200, "OK", json, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/browser-event")
                {
                    var ev = JsonSerializer.Deserialize<BrowserEventPayloadDto>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new BrowserEventPayloadDto();
                    var result = await _onBrowserEvent(ev).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, 200, "OK", json, ct).ConfigureAwait(false);
                    return;
                }

                if (method == "POST" && path == "/local-vault/save")
                {
                    var req = JsonSerializer.Deserialize<LocalVaultSaveRequest>(
                        string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new LocalVaultSaveRequest();
                    var result = await _onVaultSave(req).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(result);
                    await WriteHttpResponseAsync(stream, result.Ok ? 200 : 400, result.Ok ? "OK" : "Bad Request", json, ct).ConfigureAwait(false);
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
                    await WriteHttpResponseAsync(stream, 200, "OK", json, ct).ConfigureAwait(false);
                    return;
                }

                await WriteHttpResponseAsync(stream, 404, "Not Found", "{\"ok\":false,\"error\":\"Not Found\"}", ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log($"[Bridge] Request error: {ex.Message}");
            }
        }
    }

    private static async Task<(string Method, string Path, string Body)> ReadHttpRequestAsync(NetworkStream stream, CancellationToken ct)
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
        if (headerEnd < 0) return ("", "", "");

        var rawBytes = ms.GetBuffer();
        var headerText = Encoding.ASCII.GetString(rawBytes, 0, headerEnd);
        var lines = headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return ("", "", "");
        var firstParts = lines[0].Split(' ');
        if (firstParts.Length < 2) return ("", "", "");

        var method = firstParts[0].Trim().ToUpperInvariant();
        var path = firstParts[1].Trim();
        int contentLength = 0;
        foreach (var line in lines[1..])
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var k = line[..colon].Trim();
            if (string.Equals(k, "Content-Length", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(line[(colon + 1)..].Trim(), out var len))
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
        return (method, path, body);
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

    private static async Task WriteHttpResponseAsync(NetworkStream stream, int code, string reason, string jsonBody, CancellationToken ct)
    {
        var bodyBytes = string.IsNullOrEmpty(jsonBody) ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(jsonBody);
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {code} {reason}\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\n");
        sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        sb.Append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n");
        sb.Append("Access-Control-Allow-Private-Network: true\r\n");
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
        try { _cts?.Cancel(); } catch { }
        try { _listener?.Stop(); } catch { }
        _listener = null;
        _cts?.Dispose();
        _cts = null;
    }
}
