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
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
    }

    public void Configure(string baseUrl, string accessToken)
    {
        _baseUrl = (baseUrl ?? DesktopConfig.DefaultBackendUrl).Trim().TrimEnd('/');
        _token = accessToken ?? "";
    }

    public bool HasToken => !string.IsNullOrWhiteSpace(_token);
    public string BaseUrl => _baseUrl;

    private HttpRequestMessage BuildRequest(HttpMethod method, string relativePath, object? body = null)
    {
        var req = new HttpRequestMessage(method, _baseUrl + relativePath);
        req.Headers.TryAddWithoutValidation("X-AdsOps-Client", "2.1.0");
        req.Headers.TryAddWithoutValidation("X-AdsOps-Source", "desktop");
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
            if (doc.RootElement.TryGetProperty("message", out var msg)) return msg.ToString();
        }
        catch { }
        return raw.Length > 220 ? raw[..220] : raw;
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

    public Task<PersonalAccountRefDto> CreatePersonalAccountAsync(PersonalAccountUpsertRequestDto payload, CancellationToken ct = default) =>
        SendJsonAsync<PersonalAccountRefDto>(HttpMethod.Post, "/api/v1/personal-account-references", payload, ct);

    public Task<PersonalAccountRefDto> UpdatePersonalAccountAsync(string id, object payload, CancellationToken ct = default) =>
        SendJsonAsync<PersonalAccountRefDto>(HttpMethod.Patch, $"/api/v1/personal-account-references/{Uri.EscapeDataString(id)}", payload, ct);

    public Task<PersonalAccountRefDto> ArchivePersonalAccountAsync(string id, CancellationToken ct = default) =>
        SendJsonAsync<PersonalAccountRefDto>(HttpMethod.Post, $"/api/v1/personal-account-references/{Uri.EscapeDataString(id)}/archive", new { }, ct);

    public Task<PagedBusinessManagersDto> ListBusinessManagersAsync(CancellationToken ct = default) =>
        SendJsonAsync<PagedBusinessManagersDto>(HttpMethod.Get, "/api/v1/business-managers?page=1&page_size=200", null, ct);

    public Task<PagedAdAccountsDto> ListAdAccountsAsync(CancellationToken ct = default) =>
        SendJsonAsync<PagedAdAccountsDto>(HttpMethod.Get, "/api/v1/ad-accounts?page=1&page_size=200", null, ct);

    public Task<FacebookPagesSummaryDto> GetPagesSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<FacebookPagesSummaryDto>(HttpMethod.Get, "/api/v1/facebook-pages/summary", null, ct);

    public Task<QuickSyncResponseDto> QuickSyncMetaAsync(CancellationToken ct = default) =>
        SendJsonAsync<QuickSyncResponseDto>(HttpMethod.Post, "/api/v1/meta/quick-sync", new { }, ct);

    public Task<SyncPagesResponseDto> SyncPagesFromMetaAsync(CancellationToken ct = default) =>
        SendJsonAsync<SyncPagesResponseDto>(HttpMethod.Post, "/api/v1/facebook-pages/sync-meta", new { }, ct);

    public Task<CheckPageLiveResponseDto> CheckPageLiveAsync(string pageId, CancellationToken ct = default) =>
        SendJsonAsync<CheckPageLiveResponseDto>(HttpMethod.Post, $"/api/v1/facebook-pages/{Uri.EscapeDataString(pageId)}/check-live", new { }, ct);

    public Task<ClaimPageResponseDto> ClaimPageToBmAsync(string pageId, string? businessManagerId = null, CancellationToken ct = default)
    {
        object body = string.IsNullOrWhiteSpace(businessManagerId)
            ? new { }
            : new { business_manager_id = businessManagerId };
        return SendJsonAsync<ClaimPageResponseDto>(HttpMethod.Post, $"/api/v1/facebook-pages/{Uri.EscapeDataString(pageId)}/claim-to-bm", body, ct);
    }

    public Task<WarmupPostResponseDto> PublishWarmupPostAsync(
        string pageId,
        string message,
        string viaId,
        string viaLabel,
        string browserProfile,
        string postMode = "graph_api_or_assist",
        CancellationToken ct = default) =>
        SendJsonAsync<WarmupPostResponseDto>(
            HttpMethod.Post,
            $"/api/v1/facebook-pages/{Uri.EscapeDataString(pageId)}/warmup-post",
            new
            {
                message,
                via_id = viaId,
                via_label = viaLabel,
                browser_profile = browserProfile,
                post_mode = postMode,
            },
            ct);

    public Task<BatchWarmupResponseDto> BatchWarmupPagesAsync(int maxPages = 10, CancellationToken ct = default) =>
        SendJsonAsync<BatchWarmupResponseDto>(HttpMethod.Post, "/api/v1/facebook-pages/batch-warmup", new { max_pages = maxPages }, ct);

    public Task<ViaBatchCreateResponseDto> ViaBatchCreatePagesAsync(ViaBatchCreateRequestDto payload, CancellationToken ct = default) =>
        SendJsonAsync<ViaBatchCreateResponseDto>(HttpMethod.Post, "/api/v1/facebook-pages/via-batch-create", payload, ct);

    public Task<JsonElement> LogViaKeepAliveBatchAsync(IEnumerable<object> vias, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(HttpMethod.Post, "/api/v1/facebook-pages/via-keepalive-log", new { vias }, ct);

    public Task<JsonElement> DiscardPageDraftAsync(string pageId, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(HttpMethod.Delete, $"/api/v1/facebook-pages/{Uri.EscapeDataString(pageId)}/draft", null, ct);

    public Task<ProxyCheckResultDto> CheckProxyLiveAsync(string proxyString, string viaLabel, CancellationToken ct = default) =>
        SendJsonAsync<ProxyCheckResultDto>(
            HttpMethod.Post,
            "/api/v1/proxies/check-live",
            new { proxy_string = proxyString, timeout_seconds = 4.5, via_label = viaLabel, notify_on_dead = true },
            ct);

    public Task<ProxyBatchCheckResponseDto> CheckProxyBatchAsync(CancellationToken ct = default) =>
        SendJsonAsync<ProxyBatchCheckResponseDto>(HttpMethod.Post, "/api/v1/proxies/check-batch", new { }, ct);

    public Task<AlertSummaryDto> GetAlertsSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<AlertSummaryDto>(HttpMethod.Get, "/api/v1/alerts/summary", null, ct);

    public Task<PagedAlertsDto> ListAlertsAsync(int pageSize = 30, CancellationToken ct = default) =>
        SendJsonAsync<PagedAlertsDto>(HttpMethod.Get, $"/api/v1/alerts?page=1&page_size={pageSize}", null, ct);

    public Task<JsonElement> AcknowledgeAlertAsync(string alertId, string note = "Đã kiểm tra trên AdsOps Desktop Pro", CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(HttpMethod.Post, $"/api/v1/alerts/{Uri.EscapeDataString(alertId)}/acknowledge", new { note }, ct);

    public Task<JsonElement> ResolveAlertAsync(string alertId, string reason = "Đã xử lý từ AdsOps Desktop Pro", CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(HttpMethod.Post, $"/api/v1/alerts/{Uri.EscapeDataString(alertId)}/resolve", new { reason }, ct);

    public Task<AutomationCronStatusDto> GetAutomationCronStatusAsync(CancellationToken ct = default) =>
        SendJsonAsync<AutomationCronStatusDto>(HttpMethod.Get, "/api/v1/automation-cron/status", null, ct);

    public Task<AutomationCronStatusDto> SaveAutomationCronConfigAsync(
        bool autoMetaSyncEnabled,
        int syncIntervalMinutes,
        bool autoPageWarmupEnabled,
        int warmupMinGapHours,
        CancellationToken ct = default) =>
        SendJsonAsync<AutomationCronStatusDto>(
            HttpMethod.Post,
            "/api/v1/automation-cron/config",
            new
            {
                auto_meta_sync_enabled = autoMetaSyncEnabled,
                sync_interval_minutes = syncIntervalMinutes,
                auto_page_warmup_enabled = autoPageWarmupEnabled,
                warmup_min_gap_hours = warmupMinGapHours,
            },
            ct);

    public Task<AutomationCronRunResponseDto> RunAutomationCronNowAsync(bool sync = true, bool warmup = true, CancellationToken ct = default) =>
        SendJsonAsync<AutomationCronRunResponseDto>(HttpMethod.Post, "/api/v1/automation-cron/run-now", new { sync, warmup }, ct);

    public Task<TelegramTestSendResponseDto> SendTelegramTestAsync(CancellationToken ct = default) =>
        SendJsonAsync<TelegramTestSendResponseDto>(HttpMethod.Post, "/api/v1/telegram-bot/test-send", new { }, ct);

    public Task<BrowserEventResponseDto> PostBrowserEventAsync(BrowserEventPayloadDto payload, CancellationToken ct = default) =>
        SendJsonAsync<BrowserEventResponseDto>(
            HttpMethod.Post,
            "/api/v1/facebook-pages/browser-event",
            payload,
            ct);

    public Task<List<MetaConnectionDto>> ListMetaConnectionsAsync(CancellationToken ct = default) =>
        SendJsonAsync<List<MetaConnectionDto>>(HttpMethod.Get, "/api/v1/meta-connections", null, ct);

    public Task<MetaConnectionDto> CheckMetaConnectionCapabilityAsync(string id, CancellationToken ct = default) =>
        SendJsonAsync<MetaConnectionDto>(HttpMethod.Post, $"/api/v1/meta-connections/{Uri.EscapeDataString(id)}/check-capability", new { }, ct);

    public Task<HealthSummaryDto> GetAccountHealthSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<HealthSummaryDto>(HttpMethod.Get, "/api/v1/account-health/summary", null, ct);

    public Task<PagedAccountHealthDto> ListAccountHealthAsync(int pageSize = 100, CancellationToken ct = default) =>
        SendJsonAsync<PagedAccountHealthDto>(
            HttpMethod.Get,
            $"/api/v1/account-health?page=1&page_size={pageSize}&sort=health_severity&sort_direction=desc",
            null,
            ct);

    public Task<PagedCampaignDraftsDto> ListCampaignDraftsAsync(int pageSize = 25, CancellationToken ct = default) =>
        SendJsonAsync<PagedCampaignDraftsDto>(HttpMethod.Get, $"/api/v1/campaign-drafts?page=1&page_size={pageSize}", null, ct);

    public Task<JsonElement> EvaluateCampaignDraftAsync(string draftId, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(HttpMethod.Post, $"/api/v1/campaign-drafts/{Uri.EscapeDataString(draftId)}/evaluate", new { }, ct);

    public void Dispose() => _http.Dispose();
}
