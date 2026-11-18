using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace AdsOpsDesktop;

/// <summary>
/// Controls isolated Chrome instances over Chrome DevTools Protocol (CDP):
/// loads unpacked extensions in Chrome 137-158+, injects/harvests session cookies, and closes browsers cleanly.
/// </summary>
public static class ChromeCdpController
{
    private static readonly HttpClient SharedHttp = new()
    {
        Timeout = TimeSpan.FromMilliseconds(1800),
    };

    private static readonly HashSet<string> CookieMetaAttrNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "path", "domain", "expires", "max-age", "secure", "httponly", "samesite", "priority", "partitioned"
    };

    public sealed class CdpCookieParam
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("value")] public string Value { get; set; } = "";
        [JsonPropertyName("domain")] public string Domain { get; set; } = ".facebook.com";
        [JsonPropertyName("path")] public string Path { get; set; } = "/";
        [JsonPropertyName("secure")] public bool Secure { get; set; } = true;
        [JsonPropertyName("httpOnly")] public bool HttpOnly { get; set; }
        [JsonPropertyName("sameSite")] public string SameSite { get; set; } = "None";
        [JsonPropertyName("expires")] public double Expires { get; set; }
    }

    /// <summary>Finds an available ephemeral TCP port on loopback 127.0.0.1 for CDP remote debugging.</summary>
    public static int FindFreeLoopbackPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    /// <summary>Sends a CDP JSON-RPC command over an open WebSocket and waits for the matching response id.</summary>
    public static async Task<JsonElement> SendCdpCommandAsync(
        ClientWebSocket ws,
        int id,
        string method,
        object? parameters = null,
        CancellationToken ct = default)
    {
        var payloadObj = parameters == null
            ? (object)new { id, method }
            : new { id, method, @params = parameters };
        var json = JsonSerializer.Serialize(payloadObj);
        var sendBytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(new ArraySegment<byte>(sendBytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);

        var recvBuf = new byte[16384];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult res;
            do
            {
                res = await ws.ReceiveAsync(new ArraySegment<byte>(recvBuf), ct).ConfigureAwait(false);
                if (res.MessageType == WebSocketMessageType.Close)
                {
                    return JsonDocument.Parse("{}").RootElement.Clone();
                }
                if (res.Count > 0)
                {
                    ms.Write(recvBuf, 0, res.Count);
                }
            } while (!res.EndOfMessage);

            var msgText = Encoding.UTF8.GetString(ms.ToArray());
            if (string.IsNullOrWhiteSpace(msgText)) continue;

            using var doc = JsonDocument.Parse(msgText);
            var root = doc.RootElement;
            if (root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt32(out var msgId) && msgId == id)
            {
                if (root.TryGetProperty("error", out var errEl))
                {
                    throw new InvalidOperationException($"CDP {method} error: {errEl}");
                }
                if (root.TryGetProperty("result", out var resultEl))
                {
                    return resultEl.Clone();
                }
                return JsonDocument.Parse("{}").RootElement.Clone();
            }
        }

        throw new OperationCanceledException($"CDP connection closed before response for {method} (id={id}).");
    }

    /// <summary>Parses either a JSON cookie array or semicolon-separated Cookie header into CDP cookie objects.</summary>
    public static List<CdpCookieParam> ParseRawCookiesForCdp(string? rawCookie, string defaultDomain = ".facebook.com")
    {
        var list = new List<CdpCookieParam>();
        var clean = (rawCookie ?? "").Trim();
        if (string.IsNullOrEmpty(clean)) return list;

        var defaultExpires = (double)DateTimeOffset.UtcNow.AddDays(90).ToUnixTimeSeconds();
        if (clean.StartsWith("[", StringComparison.Ordinal))
        {
            try
            {
                using var doc = JsonDocument.Parse(clean);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        var nm = el.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "").Trim() : "";
                        var val = el.TryGetProperty("value", out var vEl) ? (vEl.GetString() ?? "") : "";
                        if (string.IsNullOrEmpty(nm) || string.IsNullOrEmpty(val)) continue;
                        var dom = el.TryGetProperty("domain", out var dEl) && !string.IsNullOrWhiteSpace(dEl.GetString())
                            ? dEl.GetString()!.Trim()
                            : defaultDomain;
                        var path = el.TryGetProperty("path", out var pEl) && !string.IsNullOrWhiteSpace(pEl.GetString())
                            ? pEl.GetString()!.Trim()
                            : "/";
                        var httpOnly = el.TryGetProperty("httpOnly", out var hEl) && hEl.ValueKind == JsonValueKind.True;
                        var secure = !el.TryGetProperty("secure", out var sEl) || sEl.ValueKind != JsonValueKind.False;
                        var exp = el.TryGetProperty("expirationDate", out var eEl) && eEl.TryGetDouble(out var parsedExp) && parsedExp > 0
                            ? parsedExp
                            : defaultExpires;
                        list.Add(new CdpCookieParam
                        {
                            Name = nm,
                            Value = val,
                            Domain = dom,
                            Path = path,
                            Secure = secure,
                            HttpOnly = httpOnly,
                            SameSite = "None",
                            Expires = exp,
                        });
                    }
                    return list;
                }
            }
            catch { }
        }

        foreach (var part in clean.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = part.IndexOf('=');
            if (idx <= 0) continue;
            var nm = part[..idx].Trim();
            var val = part[(idx + 1)..].Trim();
            if (string.IsNullOrEmpty(nm) || string.IsNullOrEmpty(val) || CookieMetaAttrNames.Contains(nm)) continue;
            list.Add(new CdpCookieParam
            {
                Name = nm,
                Value = val,
                Domain = defaultDomain,
                Path = "/",
                Secure = true,
                HttpOnly = string.Equals(nm, "xs", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(nm, "datr", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(nm, "fr", StringComparison.OrdinalIgnoreCase),
                SameSite = "None",
                Expires = defaultExpires,
            });
        }
        return list;
    }

    private static async Task<string?> PollBrowserWsUrlAsync(int cdpPort, int timeoutMs, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(500, timeoutMs));
        var verUrl = $"http://127.0.0.1:{cdpPort}/json/version";
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            try
            {
                var body = await SharedHttp.GetStringAsync(verUrl, ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("webSocketDebuggerUrl", out var wsEl))
                {
                    var wsUrl = wsEl.GetString();
                    if (!string.IsNullOrWhiteSpace(wsUrl)) return wsUrl;
                }
            }
            catch { }
            await Task.Delay(80, ct).ConfigureAwait(false);
        }
        return null;
    }

    private static async Task<string?> FindOrCreatePageTargetWsUrlAsync(ClientWebSocket browserWs, int cdpPort, int startCmdId, CancellationToken ct)
    {
        try
        {
            var listBody = await SharedHttp.GetStringAsync($"http://127.0.0.1:{cdpPort}/json/list", ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(listBody);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var type = item.TryGetProperty("type", out var tEl) ? tEl.GetString() : "";
                    var wsUrl = item.TryGetProperty("webSocketDebuggerUrl", out var wEl) ? wEl.GetString() : "";
                    if (string.Equals(type, "page", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(wsUrl))
                    {
                        return wsUrl;
                    }
                }
            }
        }
        catch { }

        try
        {
            var created = await SendCdpCommandAsync(browserWs, startCmdId, "Target.createTarget", new { url = "about:blank" }, ct).ConfigureAwait(false);
            if (created.TryGetProperty("targetId", out var tidEl))
            {
                var tid = tidEl.GetString();
                if (!string.IsNullOrWhiteSpace(tid))
                {
                    return $"ws://127.0.0.1:{cdpPort}/devtools/page/{tid}";
                }
            }
        }
        catch { }
        return null;
    }

    /// <summary>
    /// Bootstraps an isolated Chrome instance started on about:blank: loads unpacked extension via CDP,
    /// injects Vault cookies via Storage.setCookies, then navigates the active tab to the target URL.
    /// </summary>
    public static async Task<(bool ExtensionLoaded, string ExtensionId, int InjectedCookies, string? PageTargetWsUrl)> BootstrapIsolatedChromeAsync(
        int cdpPort,
        string? extFolder,
        string? vaultCookieRaw,
        string? navigateUrl,
        int connectTimeoutMs = 6000,
        CancellationToken ct = default)
    {
        bool extLoaded = false;
        string extId = "";
        int injectedCookies = 0;
        string? pageWsUrl = null;

        var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, connectTimeoutMs, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(browserWsUrl))
        {
            return (false, "", 0, null);
        }

        using var browserWs = new ClientWebSocket();
        await browserWs.ConnectAsync(new Uri(browserWsUrl), ct).ConfigureAwait(false);
        int cmdId = 1;

        if (!string.IsNullOrWhiteSpace(extFolder) && Directory.Exists(extFolder))
        {
            try
            {
                var loadRes = await SendCdpCommandAsync(
                    browserWs,
                    cmdId++,
                    "Extensions.loadUnpacked",
                    new { path = Path.GetFullPath(extFolder) },
                    ct).ConfigureAwait(false);
                if (loadRes.TryGetProperty("id", out var idEl))
                {
                    extId = idEl.GetString() ?? "";
                    extLoaded = !string.IsNullOrWhiteSpace(extId);
                }
            }
            catch { }
        }

        if (!string.IsNullOrWhiteSpace(vaultCookieRaw))
        {
            var cookies = ParseRawCookiesForCdp(vaultCookieRaw);
            if (cookies.Count > 0)
            {
                try
                {
                    await SendCdpCommandAsync(
                        browserWs,
                        cmdId++,
                        "Storage.setCookies",
                        new { cookies },
                        ct).ConfigureAwait(false);
                    injectedCookies = cookies.Count;
                }
                catch { }
            }
        }

        // Let the extension service worker register content scripts before navigating away from about:blank.
        await Task.Delay(180, ct).ConfigureAwait(false);

        pageWsUrl = await FindOrCreatePageTargetWsUrlAsync(browserWs, cdpPort, cmdId++, ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(navigateUrl) && !string.IsNullOrWhiteSpace(pageWsUrl))
        {
            try
            {
                using var pageWs = new ClientWebSocket();
                await pageWs.ConnectAsync(new Uri(pageWsUrl), ct).ConfigureAwait(false);
                await SendCdpCommandAsync(pageWs, 1, "Page.navigate", new { url = navigateUrl }, ct).ConfigureAwait(false);
                try { await pageWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "ok", CancellationToken.None).ConfigureAwait(false); } catch { }
            }
            catch { }
        }

        try { await browserWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "ok", CancellationToken.None).ConfigureAwait(false); } catch { }
        return (extLoaded, extId, injectedCookies, pageWsUrl);
    }

    /// <summary>Navigates an existing CDP page target to a URL.</summary>
    public static async Task<bool> NavigatePageAsync(string pageWsUrl, string url, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(pageWsUrl) || string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            using var pageWs = new ClientWebSocket();
            await pageWs.ConnectAsync(new Uri(pageWsUrl), ct).ConfigureAwait(false);
            await SendCdpCommandAsync(pageWs, 1, "Page.navigate", new { url }, ct).ConfigureAwait(false);
            try { await pageWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "ok", CancellationToken.None).ConfigureAwait(false); } catch { }
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Harvests Facebook session cookies (requiring c_user &amp; xs) from a running CDP browser instance.</summary>
    public static async Task<string?> TryHarvestFacebookCookieHeaderAsync(int cdpPort, int timeoutMs = 2000)
    {
        if (cdpPort <= 0) return null;
        try
        {
            using var cts = new CancellationTokenSource(Math.Max(600, timeoutMs));
            var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, Math.Min(1000, timeoutMs), cts.Token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(browserWsUrl)) return null;

            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(browserWsUrl), cts.Token).ConfigureAwait(false);
            var res = await SendCdpCommandAsync(ws, 1, "Storage.getCookies", null, cts.Token).ConfigureAwait(false);
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "ok", CancellationToken.None).ConfigureAwait(false); } catch { }

            if (!res.TryGetProperty("cookies", out var arr) || arr.ValueKind != JsonValueKind.Array) return null;

            var pairs = new List<string>();
            bool hasCUser = false;
            bool hasXs = false;
            foreach (var c in arr.EnumerateArray())
            {
                var dom = c.TryGetProperty("domain", out var dEl) ? (dEl.GetString() ?? "") : "";
                if (!dom.Contains("facebook.com", StringComparison.OrdinalIgnoreCase)) continue;
                var name = c.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "") : "";
                var val = c.TryGetProperty("value", out var vEl) ? (vEl.GetString() ?? "") : "";
                if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(val)) continue;
                if (string.Equals(name, "c_user", StringComparison.Ordinal)) hasCUser = true;
                if (string.Equals(name, "xs", StringComparison.Ordinal)) hasXs = true;
                pairs.Add($"{name}={val}");
            }

            return hasCUser && hasXs ? string.Join("; ", pairs) : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Gracefully closes a CDP-controlled Chrome browser via Browser.close so cookies flush cleanly to disk.</summary>
    public static async Task<bool> CloseBrowserGracefullyAsync(int cdpPort, int timeoutMs = 1500)
    {
        if (cdpPort <= 0) return false;
        try
        {
            using var cts = new CancellationTokenSource(Math.Max(500, timeoutMs));
            var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, Math.Min(900, timeoutMs), cts.Token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(browserWsUrl)) return false;

            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(browserWsUrl), cts.Token).ConfigureAwait(false);
            await SendCdpCommandAsync(ws, 1, "Browser.close", null, cts.Token).ConfigureAwait(false);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Synchronous wrapper around <see cref="CloseBrowserGracefullyAsync"/> for non-async callers.</summary>
    public static bool TryCloseBrowserGracefully(int cdpPort, int timeoutMs = 1200)
    {
        if (cdpPort <= 0) return false;
        try
        {
            return Task.Run(() => CloseBrowserGracefullyAsync(cdpPort, timeoutMs)).GetAwaiter().GetResult();
        }
        catch
        {
            return false;
        }
    }
}
