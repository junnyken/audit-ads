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
        req.Headers.TryAddWithoutValidation("X-AdsOps-Client", DesktopAppInfo.Version);
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

    internal static string ExtractDetail(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "Không có phản hồi";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out var errObj) &&
                errObj.ValueKind == JsonValueKind.Object &&
                errObj.TryGetProperty("message", out var errMsg) &&
                errMsg.ValueKind == JsonValueKind.String)
            {
                var em = errMsg.GetString();
                if (!string.IsNullOrWhiteSpace(em)) return em;
            }
            if (root.TryGetProperty("detail", out var det))
            {
                if (det.ValueKind == JsonValueKind.String)
                {
                    var ds = det.GetString();
                    if (!string.IsNullOrWhiteSpace(ds)) return ds;
                }
                if (det.ValueKind == JsonValueKind.Array)
                {
                    var parts = new List<string>();
                    foreach (var item in det.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.Object &&
                            item.TryGetProperty("msg", out var m) &&
                            m.ValueKind == JsonValueKind.String)
                        {
                            var ms = m.GetString();
                            if (!string.IsNullOrWhiteSpace(ms)) parts.Add(ms);
                        }
                        else
                        {
                            parts.Add(item.ToString());
                        }
                    }
                    if (parts.Count > 0) return string.Join("; ", parts);
                }
                return det.ToString();
            }
            if (root.TryGetProperty("message", out var msg))
            {
                return msg.ValueKind == JsonValueKind.String ? (msg.GetString() ?? "") : msg.ToString();
            }
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

    public Task<ProxyCheckResultDto> CheckProxyLiveAsync(
        string proxyString,
        string viaLabel,
        string? expectedTimezone = null,
        CancellationToken ct = default) =>
        SendJsonAsync<ProxyCheckResultDto>(
            HttpMethod.Post,
            "/api/v1/proxies/check-live",
            new
            {
                proxy_string = proxyString,
                timeout_seconds = 4.5,
                via_label = viaLabel,
                expected_timezone = string.IsNullOrWhiteSpace(expectedTimezone) ? null : expectedTimezone.Trim(),
                notify_on_dead = true,
            },
            ct);

    public Task<ProxyBatchCheckResponseDto> CheckProxyBatchAsync(CancellationToken ct = default) =>
        SendJsonAsync<ProxyBatchCheckResponseDto>(HttpMethod.Post, "/api/v1/proxies/check-batch", null, ct);

    public async Task<Dictionary<string, ProxyCheckResultDto>> GetProxyHealthMapAsync(CancellationToken ct = default)
    {
        var res = await SendJsonAsync<ProxyHealthMapResponseDto>(HttpMethod.Get, "/api/v1/proxies/health-map", null, ct);
        return res.HealthMap;
    }

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

    public Task<AutoConnectTokenResponseDto> AutoConnectFacebookTokenAsync(
        string accessToken,
        string? browserProfileLabel = null,
        string? networkLabel = null,
        CancellationToken ct = default) =>
        SendJsonAsync<AutoConnectTokenResponseDto>(
            HttpMethod.Post,
            "/api/v1/facebook-identities/auto-connect-token",
            new
            {
                access_token = accessToken.Trim(),
                browser_profile_label = string.IsNullOrWhiteSpace(browserProfileLabel) ? null : browserProfileLabel.Trim(),
                network_label = string.IsNullOrWhiteSpace(networkLabel) ? null : networkLabel.Trim(),
            },
            ct);

    public Task<JsonElement> SuppressAlertAsync(
        string alertId,
        int hours = 24,
        string reason = "Tạm ẩn 24h từ AdsOps Desktop Pro",
        CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/alerts/{Uri.EscapeDataString(alertId)}/suppress",
            new
            {
                reason = string.IsNullOrWhiteSpace(reason) ? "Tạm ẩn từ AdsOps Desktop Pro" : reason.Trim(),
                expires_at = DateTimeOffset.UtcNow.AddHours(Math.Clamp(hours, 1, 720)).ToString("o"),
            },
            ct);

    public Task<TelegramBotConfigDto> GetTelegramBotConfigAsync(CancellationToken ct = default) =>
        SendJsonAsync<TelegramBotConfigDto>(HttpMethod.Get, "/api/v1/telegram-bot/config", null, ct);

    public Task<TelegramBotConfigDto> SaveTelegramBotConfigAsync(object payload, CancellationToken ct = default) =>
        SendJsonAsync<TelegramBotConfigDto>(HttpMethod.Post, "/api/v1/telegram-bot/config", payload, ct);

    public Task<TelegramDetectChatsResponseDto> DetectTelegramChatsAsync(string? botToken = null, CancellationToken ct = default) =>
        SendJsonAsync<TelegramDetectChatsResponseDto>(
            HttpMethod.Post,
            "/api/v1/telegram-bot/detect-chat",
            string.IsNullOrWhiteSpace(botToken) ? new { } : new { bot_token = botToken.Trim() },
            ct);

    public Task<JsonElement> SendTelegramTestWithOverridesAsync(
        string? botToken = null,
        string? chatId = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object>();
        if (!string.IsNullOrWhiteSpace(botToken)) body["bot_token"] = botToken.Trim();
        if (!string.IsNullOrWhiteSpace(chatId)) body["chat_id"] = chatId.Trim();
        return SendJsonAsync<JsonElement>(HttpMethod.Post, "/api/v1/telegram-bot/test-send", body, ct);
    }

    public Task<SpendSummaryDto> GetSpendSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<SpendSummaryDto>(HttpMethod.Get, "/api/v1/spend/summary", null, ct);

    public Task<JsonElement> RefreshAdAccountSpendAsync(string adAccountId, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/ad-accounts/{Uri.EscapeDataString(adAccountId)}/spend/refresh",
            null,
            ct);

    public Task<List<DeviceSessionDto>> ListMyDeviceSessionsAsync(CancellationToken ct = default) =>
        SendJsonAsync<List<DeviceSessionDto>>(HttpMethod.Get, "/api/v1/security/sessions/me", null, ct);

    public Task<DeviceSessionDto> RevokeDeviceSessionAsync(string sessionId, string? reason = null, CancellationToken ct = default) =>
        SendJsonAsync<DeviceSessionDto>(
            HttpMethod.Post,
            $"/api/v1/security/sessions/{Uri.EscapeDataString(sessionId)}/revoke",
            string.IsNullOrWhiteSpace(reason) ? null : new { reason = reason.Trim() },
            ct);

    public Task<RevokeSessionResultDto> LogoutOtherDevicesAsync(CancellationToken ct = default) =>
        SendJsonAsync<RevokeSessionResultDto>(HttpMethod.Post, "/api/v1/security/sessions/logout-other-devices", null, ct);

    // ---------- Group 1: Extension Billing Auto-Sync ----------
    public Task<BillingSyncResponseDto> SyncBillingFromExtensionAsync(BillingSyncRequestDto payload, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["external_account_id"] = payload.ExternalAccountId?.Trim() ?? string.Empty,
        };
        if (!string.IsNullOrWhiteSpace(payload.BillingThresholdRaw)) body["billing_threshold_raw"] = payload.BillingThresholdRaw.Trim();
        if (!string.IsNullOrWhiteSpace(payload.NextBillDate)) body["next_bill_date"] = payload.NextBillDate.Trim();
        if (!string.IsNullOrWhiteSpace(payload.MetaDailyLimitRaw)) body["meta_daily_limit_raw"] = payload.MetaDailyLimitRaw.Trim();
        if (!string.IsNullOrWhiteSpace(payload.PaymentCardDisplay)) body["payment_card_display"] = payload.PaymentCardDisplay.Trim();
        if (!string.IsNullOrWhiteSpace(payload.BalanceRaw)) body["balance_raw"] = payload.BalanceRaw.Trim();
        return SendJsonAsync<BillingSyncResponseDto>(HttpMethod.Post, "/api/v1/ad-accounts/sync-billing-from-extension", body, ct);
    }

    // ---------- Group 3: Readiness Board, Health Signals & Live Audit Logs ----------
    public Task<PagedResponse<HealthSignalDto>> ListAccountHealthSignalsAsync(string adAccountId, CancellationToken ct = default) =>
        SendJsonAsync<PagedResponse<HealthSignalDto>>(
            HttpMethod.Get,
            $"/api/v1/ad-accounts/{Uri.EscapeDataString(adAccountId)}/health/signals?include_historical=true&page_size=100",
            null,
            ct);

    public Task<JsonElement> RecalculateAccountHealthAsync(string adAccountId, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/ad-accounts/{Uri.EscapeDataString(adAccountId)}/health/recalculate",
            null,
            ct);

    public Task<JsonElement> AcknowledgeHealthSignalAsync(string signalId, string note, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/account-health/signals/{Uri.EscapeDataString(signalId)}/acknowledge",
            new { note = note.Trim() },
            ct);

    public Task<JsonElement> ResolveHealthSignalAsync(string signalId, string reason, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/account-health/signals/{Uri.EscapeDataString(signalId)}/resolve",
            new { reason = reason.Trim() },
            ct);

    public Task<ReadinessSummaryDto> GetReadinessSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<ReadinessSummaryDto>(HttpMethod.Get, "/api/v1/ad-accounts/readiness/summary", null, ct);

    public Task<ReadinessBoardDto> GetReadinessBoardAsync(int pageSize = 200, CancellationToken ct = default) =>
        SendJsonAsync<ReadinessBoardDto>(HttpMethod.Get, $"/api/v1/ad-accounts/readiness/board?page_size={pageSize}", null, ct);

    public Task<JsonElement> RecalculateAccountReadinessAsync(string adAccountId, CancellationToken ct = default) =>
        SendJsonAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/ad-accounts/{Uri.EscapeDataString(adAccountId)}/readiness/recalculate",
            null,
            ct);

    public Task<PagedResponse<AuditLogEntryDto>> ListAuditLogsAsync(int page = 1, int pageSize = 50, CancellationToken ct = default) =>
        SendJsonAsync<PagedResponse<AuditLogEntryDto>>(
            HttpMethod.Get,
            $"/api/v1/audit-logs?page={page}&page_size={pageSize}",
            null,
            ct);

    // ---------- Group 4: Business Managers, Pixels, Domain SEO, Client Retainers & Team ----------
    public Task<BusinessManagerItemDto> CreateBusinessManagerAsync(
        string name,
        string? externalId,
        string status,
        string? country,
        string? currency,
        string notes,
        CancellationToken ct = default) =>
        SendJsonAsync<BusinessManagerItemDto>(
            HttpMethod.Post,
            "/api/v1/business-managers",
            new
            {
                name = name.Trim(),
                external_id = string.IsNullOrWhiteSpace(externalId) ? null : externalId.Trim(),
                status = string.IsNullOrWhiteSpace(status) ? "unknown" : status.Trim().ToLowerInvariant(),
                country = string.IsNullOrWhiteSpace(country) ? null : country.Trim().ToUpperInvariant(),
                currency = string.IsNullOrWhiteSpace(currency) ? null : currency.Trim().ToUpperInvariant(),
                notes = notes.Trim(),
            },
            ct);

    public Task<PagedResponse<PixelDto>> ListPixelsAsync(int pageSize = 100, CancellationToken ct = default) =>
        SendJsonAsync<PagedResponse<PixelDto>>(HttpMethod.Get, $"/api/v1/pixels?page=1&page_size={pageSize}", null, ct);

    public Task<PixelDto> CreatePixelAsync(
        string name,
        string? externalPixelId,
        string status,
        string notes,
        CancellationToken ct = default) =>
        SendJsonAsync<PixelDto>(
            HttpMethod.Post,
            "/api/v1/pixels",
            new
            {
                name = name.Trim(),
                external_pixel_id = string.IsNullOrWhiteSpace(externalPixelId) ? null : externalPixelId.Trim(),
                status = string.IsNullOrWhiteSpace(status) ? "unknown" : status.Trim().ToLowerInvariant(),
                notes = notes.Trim(),
            },
            ct);

    public Task<DomainSeoConfigDto> GetDomainSeoConfigAsync(CancellationToken ct = default) =>
        SendJsonAsync<DomainSeoConfigDto>(HttpMethod.Get, "/api/v1/domain-seo/config", null, ct);

    public Task<DomainSeoConfigDto> SaveDomainSeoConfigAsync(string customDomain, CancellationToken ct = default) =>
        SendJsonAsync<DomainSeoConfigDto>(
            HttpMethod.Post,
            "/api/v1/domain-seo/config",
            new { custom_domain = customDomain.Trim() },
            ct);

    public Task<ClientRetainersOverviewDto> GetClientRetainersAsync(CancellationToken ct = default) =>
        SendJsonAsync<ClientRetainersOverviewDto>(HttpMethod.Get, "/api/v1/client-retainers", null, ct);

    public Task<ClientRetainersOverviewDto> UpsertClientRetainerAsync(object payload, CancellationToken ct = default) =>
        SendJsonAsync<ClientRetainersOverviewDto>(HttpMethod.Post, "/api/v1/client-retainers", payload, ct);

    public Task<ClientRetainersOverviewDto> DeleteClientRetainerAsync(string retainerId, CancellationToken ct = default) =>
        SendJsonAsync<ClientRetainersOverviewDto>(
            HttpMethod.Delete,
            $"/api/v1/client-retainers/{Uri.EscapeDataString(retainerId)}",
            null,
            ct);

    public Task<TeamSummaryDto> GetTeamSummaryAsync(CancellationToken ct = default) =>
        SendJsonAsync<TeamSummaryDto>(HttpMethod.Get, "/api/v1/team/summary", null, ct);

    public Task<List<TeamMemberDto>> ListTeamMembersAsync(CancellationToken ct = default) =>
        SendJsonAsync<List<TeamMemberDto>>(HttpMethod.Get, "/api/v1/team/members", null, ct);

    public Task<List<TeamInvitationDto>> ListTeamInvitationsAsync(CancellationToken ct = default) =>
        SendJsonAsync<List<TeamInvitationDto>>(HttpMethod.Get, "/api/v1/team/invitations", null, ct);

    public Task<TeamInvitationCreateResponseDto> CreateTeamInvitationAsync(string email, string role, CancellationToken ct = default) =>
        SendJsonAsync<TeamInvitationCreateResponseDto>(
            HttpMethod.Post,
            "/api/v1/team/invitations",
            new { email = email.Trim(), role = role.Trim().ToLowerInvariant() },
            ct);

    public Task<TeamMemberDto> ChangeTeamMemberRoleAsync(string memberId, string role, CancellationToken ct = default) =>
        SendJsonAsync<TeamMemberDto>(
            HttpMethod.Patch,
            $"/api/v1/team/members/{Uri.EscapeDataString(memberId)}/role",
            new { role = role.Trim().ToLowerInvariant() },
            ct);

    public Task<TeamMemberDto> SuspendTeamMemberAsync(string memberId, string reason, CancellationToken ct = default) =>
        SendJsonAsync<TeamMemberDto>(
            HttpMethod.Post,
            $"/api/v1/team/members/{Uri.EscapeDataString(memberId)}/suspend",
            new { reason = reason.Trim() },
            ct);

    public Task<TeamMemberDto> UnsuspendTeamMemberAsync(string memberId, CancellationToken ct = default) =>
        SendJsonAsync<TeamMemberDto>(
            HttpMethod.Post,
            $"/api/v1/team/members/{Uri.EscapeDataString(memberId)}/unsuspend",
            null,
            ct);

    public Task<TeamInvitationCreateResponseDto> ResendTeamInvitationAsync(string invitationId, CancellationToken ct = default) =>
        SendJsonAsync<TeamInvitationCreateResponseDto>(
            HttpMethod.Post,
            $"/api/v1/team/invitations/{Uri.EscapeDataString(invitationId)}/resend",
            null,
            ct);

    public Task<TeamInvitationDto> RevokeTeamInvitationAsync(string invitationId, string reason, CancellationToken ct = default) =>
        SendJsonAsync<TeamInvitationDto>(
            HttpMethod.Post,
            $"/api/v1/team/invitations/{Uri.EscapeDataString(invitationId)}/revoke",
            new { reason = reason.Trim() },
            ct);

    public Task<CommunityQuotaDto> GetMyCommunityQuotaAsync(CancellationToken ct = default) =>
        SendJsonAsync<CommunityQuotaDto>(HttpMethod.Get, "/api/v1/community/my-quota", null, ct);

    public Task<CommunityQuotaDto> RedeemCommunityCodeAsync(string code, CancellationToken ct = default) =>
        SendJsonAsync<CommunityQuotaDto>(
            HttpMethod.Post,
            "/api/v1/community/redeem-code",
            new { code = code.Trim().ToUpperInvariant() },
            ct);

    public Task<List<AutomationPlaybookDto>> ListPlaybooksAsync(string? platform = null, CancellationToken ct = default)
    {
        var qs = string.IsNullOrWhiteSpace(platform) || string.Equals(platform, "all", StringComparison.OrdinalIgnoreCase)
            ? ""
            : $"?platform={Uri.EscapeDataString(platform.Trim().ToLowerInvariant())}";
        return SendJsonAsync<List<AutomationPlaybookDto>>(HttpMethod.Get, $"/api/v1/playbooks{qs}", null, ct);
    }

    public Task<AutomationPlaybookDto> CreatePlaybookAsync(
        string title,
        string platform,
        string description,
        int defaultStaggerSec,
        int jitterPct,
        List<AutomationPlaybookStepDto> steps,
        CancellationToken ct = default) =>
        SendJsonAsync<AutomationPlaybookDto>(
            HttpMethod.Post,
            "/api/v1/playbooks",
            new
            {
                title = title.Trim(),
                platform = platform.Trim().ToLowerInvariant(),
                category = "custom",
                description = description.Trim(),
                version_tag = "1.0.0",
                changelog = "Tạo bởi thành viên từ AdsOps Desktop Pro",
                default_stagger_sec = Math.Clamp(defaultStaggerSec, 25, 600),
                jitter_pct = Math.Clamp(jitterPct, 10, 60),
                steps,
            },
            ct);

    public Task<AutomationPlaybookDto> RatePlaybookAsync(string playbookId, int stars, string comment = "", CancellationToken ct = default) =>
        SendJsonAsync<AutomationPlaybookDto>(
            HttpMethod.Post,
            $"/api/v1/playbooks/{Uri.EscapeDataString(playbookId)}/rate",
            new { stars = Math.Clamp(stars, 1, 5), comment = comment.Trim() },
            ct);

    public Task<AutomationPlaybookDto> RecordPlaybookRunAsync(
        string playbookId,
        IEnumerable<string> viaIds,
        string engine,
        int staggerSec,
        int jitterPct,
        string workstation,
        CancellationToken ct = default) =>
        SendJsonAsync<AutomationPlaybookDto>(
            HttpMethod.Post,
            $"/api/v1/playbooks/{Uri.EscapeDataString(playbookId)}/record-run",
            new
            {
                via_ids = new List<string>(viaIds),
                engine,
                stagger_sec = staggerSec,
                jitter_pct = jitterPct,
                workstation,
            },
            ct);

    public Task<List<ProfileLaunchAuditDto>> GetProfileLaunchAuditAsync(int limit = 60, CancellationToken ct = default) =>
        SendJsonAsync<List<ProfileLaunchAuditDto>>(HttpMethod.Get, $"/api/v1/playbooks/launch-audit?limit={Math.Clamp(limit, 1, 200)}", null, ct);

    public void Dispose() => _http.Dispose();
}
