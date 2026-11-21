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

    /// <summary>Extracts the string value from a CDP Runtime.evaluate result element (already unwrapped by SendCdpCommandAsync).</summary>
    internal static string? TryExtractEvalStringValue(JsonElement evalResp)
    {
        if (evalResp.ValueKind != JsonValueKind.Object) return null;
        if (evalResp.TryGetProperty("result", out var inner) &&
            inner.ValueKind == JsonValueKind.Object &&
            inner.TryGetProperty("value", out var valEl) &&
            valEl.ValueKind == JsonValueKind.String)
        {
            return valEl.GetString();
        }
        if (evalResp.TryGetProperty("value", out var directVal) && directVal.ValueKind == JsonValueKind.String)
        {
            return directVal.GetString();
        }
        return null;
    }

    internal static bool TryExtractEvalBoolValue(JsonElement evalResp)
    {
        if (evalResp.ValueKind != JsonValueKind.Object) return false;
        if (evalResp.TryGetProperty("result", out var inner) &&
            inner.ValueKind == JsonValueKind.Object &&
            inner.TryGetProperty("value", out var valEl) &&
            valEl.ValueKind == JsonValueKind.True)
        {
            return true;
        }
        return evalResp.TryGetProperty("value", out var directVal) && directVal.ValueKind == JsonValueKind.True;
    }

    public sealed record SilentMbsInviteResult(
        bool Ok,
        bool NeedsLogin,
        int DetectedPending,
        int InvitedSent,
        string Detail);

    /// <summary>
    /// Executes Meta Business Suite auto-invite completely off-screen via CDP Runtime.evaluate:
    /// detects login wall, opens the reactor/comment invite modal, processes BOTH "Cảm xúc" &amp; "Bình luận" tabs,
    /// clicks Select All + "Gửi lời mời (N)", and returns structured counts.
    /// </summary>
    public static async Task<SilentMbsInviteResult> RunSilentMbsAutoInviteAsync(
        int cdpPort,
        int maxInvites,
        CancellationToken ct = default)
    {
        if (cdpPort <= 0)
        {
            return new SilentMbsInviteResult(false, false, 0, 0, "Cổng CDP không hợp lệ.");
        }

        try
        {
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linkedCts.CancelAfter(TimeSpan.FromSeconds(42));
            var token = linkedCts.Token;

            var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, 6000, token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(browserWsUrl))
            {
                return new SilentMbsInviteResult(false, false, 0, 0, "Không kết nối được phiên CDP Chrome chạy ẩn.");
            }
            string? pageWsUrl;
            using (var browserWs = new ClientWebSocket())
            {
                await browserWs.ConnectAsync(new Uri(browserWsUrl), token).ConfigureAwait(false);
                pageWsUrl = await FindOrCreatePageTargetWsUrlAsync(browserWs, cdpPort, 5000, token).ConfigureAwait(false);
            }
            if (string.IsNullOrWhiteSpace(pageWsUrl))
            {
                return new SilentMbsInviteResult(false, false, 0, 0, "Không tìm thấy tab CDP Meta Business Suite.");
            }

            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(pageWsUrl), token).ConfigureAwait(false);

            var clampedMax = Math.Clamp(maxInvites, 1, 50);
            var js = $$"""
            (async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const maxInv = {{clampedMax}};
              const parseParen = (txt) => {
                const m = String(txt || '').match(/\((\d+)\)/);
                return m ? parseInt(m[1], 10) : 0;
              };
              const isVisible = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                return r.width > 2 && r.height > 2;
              };
              const findByText = (root, predicate) => {
                const nodes = Array.from((root || document).querySelectorAll('button,[role="button"],[role="tab"],a,span,div'));
                return nodes.filter((el) => {
                  const t = (el.innerText || el.textContent || '').trim();
                  return t.length > 0 && t.length <= 160 && isVisible(el) && predicate(t, el);
                });
              };

              // 1. Wait for MBS page load (up to 16s)
              for (let i = 0; i < 32; i++) {
                const href = String(location.href || '').toLowerCase();
                if (href.includes('/login') || document.querySelector('input[name="email"], input[name="pass"]')) {
                  return JSON.stringify({ ok: false, needsLogin: true, detectedPending: 0, invitedSent: 0, detail: 'Chưa đăng nhập Facebook trong Chrome Cô lập (hãy lưu Cookie vào Két DPAPI hoặc đăng nhập 1 lần).' });
                }
                const txt = (document.body?.innerText || '').toLowerCase();
                if (txt.includes('bày tỏ cảm xúc') || txt.includes('reacted to your content') || txt.includes('gửi lời mời') || txt.includes('send invitations')) {
                  break;
                }
                if (i === 10 || i === 18) window.scrollBy(0, 500);
                await sleep(500);
              }

              // 2. Locate the "Tiếp cận những người đã bày tỏ cảm xúc" card & click its "Gửi lời mời" button
              let dialog = document.querySelector('[role="dialog"]');
              let cardDetected = 0;
              if (!dialog) {
                const anchors = findByText(document, (t) => {
                  const l = t.toLowerCase();
                  return l.includes('tiếp cận những người đã bày tỏ cảm xúc') || l.includes('reach people who reacted');
                });
                if (anchors.length === 0) {
                  return JSON.stringify({ ok: true, needsLogin: false, detectedPending: 0, invitedSent: 0, detail: 'Hiện không có mục người bày tỏ cảm xúc/bình luận cần mời.' });
                }
                const anchorRect = anchors[0].getBoundingClientRect();
                // Try reading small integer near anchor
                const nums = findByText(document, (t) => /^\d{1,4}$/.test(t));
                for (const n of nums) {
                  const r = n.getBoundingClientRect();
                  if (r.top >= anchorRect.top - 10 && r.top <= anchorRect.bottom + 170 && Math.abs(r.left - anchorRect.left) <= 280) {
                    cardDetected = Math.max(cardDetected, parseInt(n.innerText.trim(), 10) || 0);
                  }
                }
                const sendBtns = findByText(document, (t) => {
                  const l = t.toLowerCase();
                  return (l === 'gửi lời mời' || l === 'send invitations' || l === 'send invite') && !l.includes('bạn bè') && !l.includes('friends');
                }).filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.top >= anchorRect.top - 40 && r.top <= anchorRect.bottom + 180;
                });
                if (sendBtns.length === 0) {
                  return JSON.stringify({ ok: true, needsLogin: false, detectedPending: cardDetected, invitedSent: 0, detail: 'Hiện có 0 người cần mời theo dõi.' });
                }
                sendBtns[0].click();
                for (let w = 0; w < 14; w++) {
                  await sleep(350);
                  dialog = document.querySelector('[role="dialog"]');
                  if (dialog) break;
                }
              }

              if (!dialog) {
                return JSON.stringify({ ok: true, needsLogin: false, detectedPending: cardDetected, invitedSent: 0, detail: 'Không mở được hộp thoại mời theo dõi (có thể đã hết người cần mời).' });
              }

              // 3. Process BOTH tabs inside modal: Reactions ("Cảm xúc") and Comments ("Bình luận")
              const processActiveTab = async () => {
                await sleep(500);
                const dlg = document.querySelector('[role="dialog"]');
                if (!dlg) return { detected: 0, sent: 0 };

                const selectAll = findByText(dlg, (t) => {
                  const l = t.toLowerCase();
                  return l.startsWith('chọn tất cả') || l.startsWith('select all');
                });
                const checkboxes = Array.from(dlg.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).filter(isVisible);
                let checkedNow = checkboxes.filter((cb) => cb.checked || cb.getAttribute('aria-checked') === 'true').length;

                if (checkedNow === 0 && selectAll.length > 0) {
                  selectAll[0].click();
                  await sleep(450);
                  const refreshed = Array.from(dlg.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).filter(isVisible);
                  checkedNow = refreshed.filter((cb) => cb.checked || cb.getAttribute('aria-checked') === 'true').length;
                }
                if (checkedNow === 0 && checkboxes.length > 0) {
                  const lim = Math.min(maxInv, checkboxes.length);
                  for (let i = 0; i < lim; i++) {
                    checkboxes[i].click();
                    await sleep(90);
                  }
                  checkedNow = lim;
                }

                await sleep(500);
                const finalBtns = findByText(dlg, (t) => {
                  const l = t.toLowerCase();
                  return (l.startsWith('gửi lời mời') || l.startsWith('send invitation') || l.startsWith('send invite'))
                    && !l.includes('bạn bè') && !l.includes('friends');
                }).sort((a, b) => parseParen(b.innerText) - parseParen(a.innerText));

                if (finalBtns.length > 0) {
                  const btn = finalBtns[0];
                  const btnCount = parseParen(btn.innerText);
                  const eff = Math.max(btnCount, checkedNow);
                  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                  if (eff > 0 && !disabled) {
                    btn.click();
                    await sleep(1100);
                    return { detected: eff, sent: eff };
                  }
                }
                return { detected: checkedNow, sent: 0 };
              };

              let totalDetected = cardDetected;
              let totalSent = 0;

              // Read tab headers before clicking
              const reactTabs = findByText(dialog, (t) => {
                const l = t.toLowerCase();
                return l.startsWith('cảm xúc') || l.startsWith('reactions');
              });
              const commentTabs = findByText(dialog, (t) => {
                const l = t.toLowerCase();
                return l.startsWith('bình luận') || l.startsWith('comments');
              });
              const rCnt = reactTabs.length > 0 ? parseParen(reactTabs[0].innerText) : 0;
              const cCnt = commentTabs.length > 0 ? parseParen(commentTabs[0].innerText) : 0;
              totalDetected = Math.max(totalDetected, rCnt + cCnt);

              // First process currently active tab
              const res1 = await processActiveTab();
              totalDetected = Math.max(totalDetected, res1.detected);
              totalSent += res1.sent;

              // If Comments tab still has pending people & modal still open, switch to Comments tab and invite too
              const dlgAfter = document.querySelector('[role="dialog"]');
              if (dlgAfter && cCnt > 0) {
                const cTabs2 = findByText(dlgAfter, (t) => {
                  const l = t.toLowerCase();
                  return l.startsWith('bình luận') || l.startsWith('comments');
                });
                if (cTabs2.length > 0) {
                  const alreadySelected = cTabs2[0].getAttribute('aria-selected') === 'true';
                  if (!alreadySelected || res1.sent === 0) {
                    cTabs2[0].click();
                    const res2 = await processActiveTab();
                    totalDetected = Math.max(totalDetected, res1.detected + res2.detected);
                    totalSent += res2.sent;
                  }
                }
              }

              return JSON.stringify({
                ok: true,
                needsLogin: false,
                detectedPending: Math.max(totalDetected, totalSent),
                invitedSent: totalSent,
                detail: totalSent > 0
                  ? `Đã mời ẩn thành công ${totalSent} người (Cảm xúc: ${rCnt} • Bình luận: ${cCnt}).`
                  : `Hiện có ${Math.max(totalDetected, 0)} người cần mời.`
              });
            })();
            """;

            var evalResp = await SendCdpCommandAsync(
                ws,
                2,
                "Runtime.evaluate",
                new { expression = js, awaitPromise = true, returnByValue = true },
                token).ConfigureAwait(false);

            var rawJson = TryExtractEvalStringValue(evalResp);
            if (!string.IsNullOrWhiteSpace(rawJson))
            {
                using var doc = JsonDocument.Parse(rawJson);
                var r = doc.RootElement;
                bool ok = r.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
                bool needsLogin = r.TryGetProperty("needsLogin", out var nlEl) && nlEl.GetBoolean();
                int detected = r.TryGetProperty("detectedPending", out var dpEl) ? dpEl.GetInt32() : 0;
                int sent = r.TryGetProperty("invitedSent", out var isEl) ? isEl.GetInt32() : 0;
                string detail = r.TryGetProperty("detail", out var dtEl) ? (dtEl.GetString() ?? "") : "";
                return new SilentMbsInviteResult(ok, needsLogin, detected, sent, detail);
            }

            return new SilentMbsInviteResult(false, false, 0, 0, "Không đọc được phản hồi từ phiên chạy ẩn MBS.");
        }
        catch (Exception ex)
        {
            return new SilentMbsInviteResult(false, false, 0, 0, $"Lỗi chạy ẩn MBS: {ex.Message}");
        }
    }

    public sealed record SilentPageContentResult(
        bool Ok,
        bool NeedsLogin,
        string ActionKind,
        bool MediaAttached,
        string Detail);

    /// <summary>
    /// 100% Automated Off-Screen Page Post Publisher via CDP:
    /// waits for Meta Business Suite Composer, attaches unique hash-jittered image via DOM.setFileInputFiles
    /// (zero Windows file picker!), injects spun caption, and clicks Publish.
    /// </summary>
    public static async Task<SilentPageContentResult> RunSilentPagePublishPostAsync(
        int cdpPort,
        string caption,
        string? uniqueImagePath,
        CancellationToken ct = default)
    {
        if (cdpPort <= 0)
        {
            return new SilentPageContentResult(false, false, "post", false, "Cổng CDP không hợp lệ.");
        }

        try
        {
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linkedCts.CancelAfter(TimeSpan.FromSeconds(55));
            var token = linkedCts.Token;

            var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, 6000, token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(browserWsUrl))
            {
                return new SilentPageContentResult(false, false, "post", false, "Không kết nối được phiên Chrome chạy ẩn.");
            }
            string? pageWsUrl;
            using (var browserWs = new ClientWebSocket())
            {
                await browserWs.ConnectAsync(new Uri(browserWsUrl), token).ConfigureAwait(false);
                pageWsUrl = await FindOrCreatePageTargetWsUrlAsync(browserWs, cdpPort, 5000, token).ConfigureAwait(false);
            }
            if (string.IsNullOrWhiteSpace(pageWsUrl))
            {
                return new SilentPageContentResult(false, false, "post", false, "Không tìm thấy tab Composer chạy ẩn.");
            }

            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(pageWsUrl), token).ConfigureAwait(false);
            int cmdId = 1;

            // 1. Wait for Composer textbox or detect login wall
            var waitJs = """
            (async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              for (let i = 0; i < 34; i++) {
                const href = String(location.href || '').toLowerCase();
                if (href.includes('/login') || document.querySelector('input[name="email"], input[name="pass"]')) {
                  return JSON.stringify({ ready: false, needsLogin: true });
                }
                const box = document.querySelector('[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
                if (box && box.getBoundingClientRect().height > 10) {
                  return JSON.stringify({ ready: true, needsLogin: false });
                }
                await sleep(500);
              }
              return JSON.stringify({ ready: false, needsLogin: false });
            })();
            """;

            var waitResp = await SendCdpCommandAsync(
                ws, cmdId++, "Runtime.evaluate",
                new { expression = waitJs, awaitPromise = true, returnByValue = true }, token).ConfigureAwait(false);
            var waitJson = TryExtractEvalStringValue(waitResp);
            if (!string.IsNullOrWhiteSpace(waitJson))
            {
                using var wDoc = JsonDocument.Parse(waitJson);
                if (wDoc.RootElement.TryGetProperty("needsLogin", out var nl) && nl.GetBoolean())
                {
                    return new SilentPageContentResult(false, true, "post", false, "Chưa đăng nhập Facebook trong Chrome Cô lập (hãy lưu Cookie vào Két DPAPI hoặc bấm Thu Cookie).");
                }
                if (!(wDoc.RootElement.TryGetProperty("ready", out var rd) && rd.GetBoolean()))
                {
                    return new SilentPageContentResult(false, false, "post", false, "Meta Business Suite Composer tải quá lâu hoặc chưa mở được khung soạn bài.");
                }
            }

            // 2. Attach unique image directly via CDP DOM.setFileInputFiles (no OS dialog!)
            bool mediaAttached = false;
            if (!string.IsNullOrWhiteSpace(uniqueImagePath) && File.Exists(uniqueImagePath))
            {
                try
                {
                    await SendCdpCommandAsync(ws, cmdId++, "DOM.enable", null, token).ConfigureAwait(false);
                    var docResp = await SendCdpCommandAsync(ws, cmdId++, "DOM.getDocument", new { depth = -1, pierce = true }, token).ConfigureAwait(false);
                    if (docResp.TryGetProperty("root", out var rootEl) &&
                        rootEl.TryGetProperty("nodeId", out var rootNodeIdEl))
                    {
                        int rootNodeId = rootNodeIdEl.GetInt32();
                        var qResp = await SendCdpCommandAsync(
                            ws, cmdId++, "DOM.querySelectorAll",
                            new { nodeId = rootNodeId, selector = "input[type='file']" }, token).ConfigureAwait(false);
                        if (qResp.TryGetProperty("nodeIds", out var nodeIdsEl) &&
                            nodeIdsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var nidEl in nodeIdsEl.EnumerateArray())
                            {
                                int nid = nidEl.GetInt32();
                                if (nid <= 0) continue;
                                try
                                {
                                    await SendCdpCommandAsync(
                                        ws, cmdId++, "DOM.setFileInputFiles",
                                        new { nodeId = nid, files = new[] { uniqueImagePath } }, token).ConfigureAwait(false);
                                    mediaAttached = true;
                                    break;
                                }
                                catch { }
                            }
                        }
                    }
                    if (mediaAttached)
                    {
                        await Task.Delay(3200, token).ConfigureAwait(false);
                    }
                }
                catch { }
            }

            // 3. Focus textbox, insert caption via Input.insertText, then click Publish/Đăng
            var focusJs = """
            (() => {
              const boxes = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'))
                .filter((el) => el.getBoundingClientRect().height > 12);
              if (boxes.length === 0) return false;
              boxes[0].focus();
              boxes[0].click();
              return true;
            })();
            """;
            await SendCdpCommandAsync(ws, cmdId++, "Runtime.evaluate", new { expression = focusJs, returnByValue = true }, token).ConfigureAwait(false);
            await Task.Delay(300, token).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(caption))
            {
                await SendCdpCommandAsync(ws, cmdId++, "Input.insertText", new { text = caption }, token).ConfigureAwait(false);
                await Task.Delay(900, token).ConfigureAwait(false);
            }

            var publishJs = """
            (async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              for (let attempt = 0; attempt < 16; attempt++) {
                const btns = Array.from(document.querySelectorAll('button,[role="button"]')).filter((el) => {
                  const r = el.getBoundingClientRect();
                  if (r.width < 20 || r.height < 18) return false;
                  const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                  return t === 'đăng' || t === 'publish' || t === 'đăng ngay' || t === 'publish now' || t === 'post';
                });
                if (btns.length > 0) {
                  const btn = btns[btns.length - 1];
                  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                  if (!disabled) {
                    btn.click();
                    await sleep(2200);
                    return JSON.stringify({ published: true, label: (btn.innerText || '').trim() });
                  }
                }
                await sleep(600);
              }
              return JSON.stringify({ published: false, label: '' });
            })();
            """;
            var pubResp = await SendCdpCommandAsync(
                ws, cmdId++, "Runtime.evaluate",
                new { expression = publishJs, awaitPromise = true, returnByValue = true }, token).ConfigureAwait(false);
            var pubJson = TryExtractEvalStringValue(pubResp);
            if (!string.IsNullOrWhiteSpace(pubJson))
            {
                using var pDoc = JsonDocument.Parse(pubJson);
                bool published = pDoc.RootElement.TryGetProperty("published", out var pb) && pb.GetBoolean();
                if (published)
                {
                    return new SilentPageContentResult(
                        true, false, "post", mediaAttached,
                        mediaAttached ? "Đã tự động đăng bài kèm ảnh đổi hash chạy ẩn thành công!" : "Đã tự động đăng bài nuôi Page (text spin) chạy ẩn thành công!");
                }
            }

            return new SilentPageContentResult(false, false, "post", mediaAttached, "Không tìm thấy nút Đăng đang sẵn sàng trong Meta Business Suite Composer.");
        }
        catch (Exception ex)
        {
            return new SilentPageContentResult(false, false, "post", false, $"Lỗi đăng bài chạy ẩn: {ex.Message}");
        }
    }

    /// <summary>
    /// 100% Automated Off-Screen Curated Post Share via CDP:
    /// opens the source URL, scrolls naturally to read, clicks Share, inserts spun caption, and clicks Share now.
    /// </summary>
    public static async Task<SilentPageContentResult> RunSilentPageSharePostAsync(
        int cdpPort,
        string caption,
        CancellationToken ct = default)
    {
        if (cdpPort <= 0)
        {
            return new SilentPageContentResult(false, false, "share", false, "Cổng CDP không hợp lệ.");
        }

        try
        {
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linkedCts.CancelAfter(TimeSpan.FromSeconds(48));
            var token = linkedCts.Token;

            var browserWsUrl = await PollBrowserWsUrlAsync(cdpPort, 6000, token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(browserWsUrl))
            {
                return new SilentPageContentResult(false, false, "share", false, "Không kết nối được phiên Chrome chạy ẩn.");
            }
            string? pageWsUrl;
            using (var browserWs = new ClientWebSocket())
            {
                await browserWs.ConnectAsync(new Uri(browserWsUrl), token).ConfigureAwait(false);
                pageWsUrl = await FindOrCreatePageTargetWsUrlAsync(browserWs, cdpPort, 5000, token).ConfigureAwait(false);
            }
            if (string.IsNullOrWhiteSpace(pageWsUrl))
            {
                return new SilentPageContentResult(false, false, "share", false, "Không tìm thấy tab bài viết nguồn chạy ẩn.");
            }

            using var ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(pageWsUrl), token).ConfigureAwait(false);
            int cmdId = 1;

            var shareOpenJs = """
            (async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              for (let i = 0; i < 22; i++) {
                const href = String(location.href || '').toLowerCase();
                if (href.includes('/login') || document.querySelector('input[name="email"], input[name="pass"]')) {
                  return JSON.stringify({ opened: false, needsLogin: true });
                }
                if (i === 4 || i === 8) window.scrollBy(0, 320);
                const shareBtns = Array.from(document.querySelectorAll('[role="button"], button')).filter((el) => {
                  const r = el.getBoundingClientRect();
                  if (r.width < 16 || r.height < 14) return false;
                  const t = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
                  return t === 'chia sẻ' || t === 'share' || t.startsWith('gửi nội dung này');
                });
                if (shareBtns.length > 0 && i >= 6) {
                  shareBtns[0].click();
                  await sleep(1400);
                  return JSON.stringify({ opened: true, needsLogin: false });
                }
                await sleep(500);
              }
              return JSON.stringify({ opened: false, needsLogin: false });
            })();
            """;

            var openResp = await SendCdpCommandAsync(
                ws, cmdId++, "Runtime.evaluate",
                new { expression = shareOpenJs, awaitPromise = true, returnByValue = true }, token).ConfigureAwait(false);
            var openJson = TryExtractEvalStringValue(openResp);
            if (!string.IsNullOrWhiteSpace(openJson))
            {
                using var oDoc = JsonDocument.Parse(openJson);
                if (oDoc.RootElement.TryGetProperty("needsLogin", out var nl) && nl.GetBoolean())
                {
                    return new SilentPageContentResult(false, true, "share", false, "Chưa đăng nhập Facebook trong Chrome Cô lập (hãy lưu Cookie vào Két DPAPI).");
                }
                if (!(oDoc.RootElement.TryGetProperty("opened", out var op) && op.GetBoolean()))
                {
                    return new SilentPageContentResult(false, false, "share", false, "Không tìm thấy nút Chia sẻ trên bài viết nguồn.");
                }
            }

            // Insert caption if share dialog textbox is visible
            var focusShareBoxJs = """
            (() => {
              const dlg = document.querySelector('[role="dialog"]') || document;
              const box = dlg.querySelector('[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
              if (!box) return false;
              box.focus();
              box.click();
              return true;
            })();
            """;
            var fbResp = await SendCdpCommandAsync(ws, cmdId++, "Runtime.evaluate", new { expression = focusShareBoxJs, returnByValue = true }, token).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(caption) && TryExtractEvalBoolValue(fbResp))
            {
                await Task.Delay(250, token).ConfigureAwait(false);
                await SendCdpCommandAsync(ws, cmdId++, "Input.insertText", new { text = caption }, token).ConfigureAwait(false);
                await Task.Delay(600, token).ConfigureAwait(false);
            }

            var confirmShareJs = """
            (async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              for (let i = 0; i < 10; i++) {
                const dlg = document.querySelector('[role="dialog"]') || document;
                const btns = Array.from(dlg.querySelectorAll('[role="button"], button, [role="menuitem"]')).filter((el) => {
                  const r = el.getBoundingClientRect();
                  if (r.width < 18 || r.height < 16) return false;
                  const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                  return t === 'chia sẻ ngay' || t === 'share now' || t === 'chia sẻ' || t === 'share';
                });
                if (btns.length > 0) {
                  const btn = btns[btns.length - 1];
                  if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                    btn.click();
                    await sleep(1800);
                    return JSON.stringify({ shared: true });
                  }
                }
                await sleep(500);
              }
              return JSON.stringify({ shared: false });
            })();
            """;
            var confResp = await SendCdpCommandAsync(
                ws, cmdId++, "Runtime.evaluate",
                new { expression = confirmShareJs, awaitPromise = true, returnByValue = true }, token).ConfigureAwait(false);
            var confJson = TryExtractEvalStringValue(confResp);
            if (!string.IsNullOrWhiteSpace(confJson))
            {
                using var cDoc = JsonDocument.Parse(confJson);
                if (cDoc.RootElement.TryGetProperty("shared", out var sh) && sh.GetBoolean())
                {
                    return new SilentPageContentResult(true, false, "share", false, "Đã tự động chia sẻ bài nguồn + Caption Spin chạy ẩn thành công!");
                }
            }

            return new SilentPageContentResult(false, false, "share", false, "Chưa xác nhận được nút Chia sẻ ngay trong hộp thoại.");
        }
        catch (Exception ex)
        {
            return new SilentPageContentResult(false, false, "share", false, $"Lỗi chia sẻ bài chạy ẩn: {ex.Message}");
        }
    }
}
