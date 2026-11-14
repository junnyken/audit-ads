using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace AdsOpsDesktop;

public sealed class AdsOpsApiClient : IDisposable
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };
    private string _baseUrl = DesktopConfig.DefaultBackendUrl;
    private string _token = "";

    public AdsOpsApiClient()
    {
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public void Configure(string baseUrl, string accessToken)
    {
        _baseUrl = (baseUrl ?? DesktopConfig.DefaultBackendUrl).Trim().TrimEnd('/');
        _token = accessToken ?? "";
    }

    public bool HasToken => !string.IsNullOrWhiteSpace(_token);

    private HttpRequestMessage BuildRequest(HttpMethod method, string relativePath, object? body = null)
    {
        var req = new HttpRequestMessage(method, _baseUrl + relativePath);
        if (!string.IsNullOrWhiteSpace(_token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        }
        if (body != null)
        {
            var json = JsonSerializer.Serialize(body);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        return req;
    }

    private async Task<T> SendJsonAsync<T>(HttpMethod method, string relativePath, object? body = null, CancellationToken ct = default)
    {
        using var req = BuildRequest(method, relativePath, body);
        using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var raw = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"API {(int)resp.StatusCode} ({relativePath}): {ExtractDetail(raw)}");
        }
        return JsonSerializer.Deserialize<T>(raw, JsonOpts)
            ?? throw new InvalidOperationException($"Không đọc được JSON từ {relativePath}");
    }

    private static string ExtractDetail(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "Không có phản hồi";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("detail", out var det)) return det.ToString();
        }
        catch { }
        return raw.Length > 200 ? raw[..200] : raw;
    }

    public async Task<LoginResponseDto> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var res = await SendJsonAsync<LoginResponseDto>(
            HttpMethod.Post,
            "/api/v1/auth/login",
            new { email = email.Trim(), password },
            ct
        ).ConfigureAwait(false);
        _token = res.AccessToken;
        return res;
    }

    public Task<CurrentUserDto> GetCurrentUserAsync(CancellationToken ct = default) =>
        SendJsonAsync<CurrentUserDto>(HttpMethod.Get, "/api/v1/auth/me", null, ct);

    public Task<PagedPersonalAccountsDto> ListPersonalAccountsAsync(CancellationToken ct = default) =>
        SendJsonAsync<PagedPersonalAccountsDto>(HttpMethod.Get, "/api/v1/personal-account-references?page=1&page_size=200", null, ct);

    public Task<PagedAdAccountsDto> ListAdAccountsAsync(CancellationToken ct = default) =>
        SendJsonAsync<PagedAdAccountsDto>(HttpMethod.Get, "/api/v1/ad-accounts?page=1&page_size=200", null, ct);

    public Task<FacebookPagesSummaryDto> GetPagesSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<FacebookPagesSummaryDto>(HttpMethod.Get, "/api/v1/facebook-pages/summary", null, ct);

    public Task<ProxyCheckResultDto> CheckProxyLiveAsync(string proxyString, string viaLabel, CancellationToken ct = default) =>
        SendJsonAsync<ProxyCheckResultDto>(
            HttpMethod.Post,
            "/api/v1/proxies/check-live",
            new { proxy_string = proxyString, timeout_seconds = 4.5, via_label = viaLabel, notify_on_dead = true },
            ct
        );

    public Task<BrowserEventResponseDto> PostBrowserEventAsync(BrowserEventPayloadDto payload, CancellationToken ct = default) =>
        SendJsonAsync<BrowserEventResponseDto>(
            HttpMethod.Post,
            "/api/v1/facebook-pages/browser-event",
            payload,
            ct
        );

    public void Dispose() => _http.Dispose();
}
