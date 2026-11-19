using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace AdsOpsDesktop;

internal sealed partial class MainWindow
{
    private static string ViewToKey(AppView view) => view switch
    {
        AppView.Vias => "vias",
        AppView.Automation => "automation",
        AppView.PagesBm => "pages_bm",
        AppView.AdAccounts => "ad_accounts",
        AppView.HealthTokens => "health_tokens",
        AppView.WorkspaceOps => "workspace_ops",
        AppView.Settings => "settings",
        _ => "overview",
    };

    private static AppView KeyToView(string? key) => (key ?? "").Trim().ToLowerInvariant() switch
    {
        "vias" => AppView.Vias,
        "automation" => AppView.Automation,
        "pages_bm" => AppView.PagesBm,
        "ad_accounts" => AppView.AdAccounts,
        "health_tokens" => AppView.HealthTokens,
        "workspace_ops" => AppView.WorkspaceOps,
        "settings" => AppView.Settings,
        _ => AppView.Overview,
    };

    private static System.Drawing.Color GetWebViewBgColor()
        => ThemeTokens.CurrentPalette == "emerald"
            ? System.Drawing.Color.FromArgb(255, 7, 11, 10)
            : System.Drawing.Color.FromArgb(255, 9, 10, 15);

    internal UIElement EnsureOverviewWebViewHost()
    {
        if (_overviewWebViewHost == null)
        {
            _overviewWebView = new Microsoft.Web.WebView2.Wpf.WebView2
            {
                DefaultBackgroundColor = GetWebViewBgColor(),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
            };
            _overviewWebView.Loaded += (_, _) =>
            {
                if (!_overviewWebViewInitStarted && !_overviewWebViewReady && !_overviewWebViewInitializing && !_overviewWebViewFailed)
                {
                    _ = Dispatcher.BeginInvoke(
                        System.Windows.Threading.DispatcherPriority.ApplicationIdle,
                        new Action(() => _ = InitializeOverviewWebViewAsync()));
                }
            };
            _overviewWebViewHost = new System.Windows.Controls.Border
            {
                Background = ThemeTokens.BgCanvas,
                Child = _overviewWebView,
            };
        }
        else
        {
            _overviewWebViewHost.Background = ThemeTokens.BgCanvas;
            if (_overviewWebView != null)
            {
                _overviewWebView.DefaultBackgroundColor = GetWebViewBgColor();
            }
            if (_overviewWebViewHost.Parent is System.Windows.Controls.ContentControl oldCc
                && !ReferenceEquals(oldCc, this)
                && !ReferenceEquals(oldCc, _viewHost))
            {
                oldCc.Content = null;
            }
        }

        if (_overviewWebView != null && _overviewWebView.IsLoaded && !_overviewWebViewInitStarted && !_overviewWebViewReady && !_overviewWebViewInitializing && !_overviewWebViewFailed)
        {
            _ = Dispatcher.BeginInvoke(
                System.Windows.Threading.DispatcherPriority.ApplicationIdle,
                new Action(() => _ = InitializeOverviewWebViewAsync()));
        }
        return _overviewWebViewHost;
    }

    private async Task InitializeOverviewWebViewAsync()
    {
        if (_overviewWebView == null || _overviewWebViewInitStarted || _overviewWebViewReady || _overviewWebViewInitializing || _overviewWebViewFailed) return;
        _overviewWebViewInitStarted = true;
        _overviewWebViewInitializing = true;
        try
        {
            var cacheDir = Path.Combine(DesktopConfig.AppDataRoot, "WebView2Cache");
            Directory.CreateDirectory(cacheDir);
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, cacheDir);
            await _overviewWebView.EnsureCoreWebView2Async(env);

            var core = _overviewWebView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = false;

            var webAssetsDir = DesktopWebUiBridge.EnsureExtractedAssets();
            core.SetVirtualHostNameToFolderMapping(
                "adsops.local",
                webAssetsDir,
                Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

            core.WebMessageReceived += (_, ev) =>
            {
                try
                {
                    var raw = ev.WebMessageAsJson;
                    if (!string.IsNullOrWhiteSpace(raw))
                    {
                        OnOverviewWebMessageReceived(raw);
                    }
                }
                catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
            };

            core.NavigationCompleted += (_, navArgs) =>
            {
                if (!navArgs.IsSuccess) return;
                _overviewWebViewReady = true;
                AppendLog($"✨ Giao diện Unified shadcn/ui App Shell 8 Tab (v{DesktopAppInfo.Version}) đã sẵn sàng.");
                PushOverviewStateToWebView();
            };

            core.Navigate("https://adsops.local/index.html");
        }
        catch (Exception ex)
        {
            _overviewWebViewFailed = true;
            AppendLog($"⚠️ Không thể khởi tạo WebView2 shadcn/ui ({ex.Message}) -> Tự động chuyển về giao diện WPF.");
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (_legacyWpfShellRoot != null)
                {
                    Content = _legacyWpfShellRoot;
                }
                RenderCurrentView();
            });
        }
        finally
        {
            _overviewWebViewInitializing = false;
        }
    }

    private (OverviewKpiDto Kpi, OverviewQueueDto Queue, OverviewWorkstationDto Workstation, WebNavBadgesDto Badges, Dictionary<string, LiveTotpItemDto> TotpMap, Dictionary<string, WebViaRuntimeDto> ViaRuntimeMap, List<WebBrowserSessionDto> Sessions)
        BuildLiveTelemetryBundle()
    {
        RefreshLiveSessionTelemetryOnVias();
        var now = DateTimeOffset.UtcNow;
        var utcNow = DateTime.UtcNow;
        var pages = _pagesSummary?.Items ?? new();
        var dueCount = _vias.Count(v => v.NeedsKeepAlive);
        var cookieVaultCount = _vias.Count(v => v.HasVaultCookie);

        var totpMap = new Dictionary<string, LiveTotpItemDto>(StringComparer.OrdinalIgnoreCase);
        var runtimeMap = new Dictionary<string, WebViaRuntimeDto>(StringComparer.OrdinalIgnoreCase);
        int twoFaReadyCount = 0;

        foreach (var v in _vias)
        {
            var secret = !string.IsNullOrWhiteSpace(v.TwoFaSecret)
                ? v.TwoFaSecret
                : LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label).TwoFaSecret;
            var totp = TotpService.ComputeTotp(secret, now);
            if (totp.Valid) twoFaReadyCount++;
            var justCopied = !string.IsNullOrEmpty(_copiedTotpViaId)
                && string.Equals(_copiedTotpViaId, v.ViaId, StringComparison.OrdinalIgnoreCase)
                && utcNow < _copiedToastUntilUtc;

            totpMap[v.ViaId] = new LiveTotpItemDto
            {
                Valid = totp.Valid,
                Code6 = totp.Valid ? totp.Code6 : "",
                FormattedCode = justCopied ? "✓ Đã chép" : (totp.Valid ? totp.FormattedCode : "Chưa gắn 2FA"),
                SecondsRemaining = totp.SecondsRemaining,
                JustCopied = justCopied,
            };

            runtimeMap[v.ViaId] = new WebViaRuntimeDto
            {
                IsBrowserRunning = v.IsBrowserRunning,
                ActiveRamMb = Math.Round(v.ActiveRamMb, 0),
                ActiveCpuPercent = Math.Round(v.ActiveCpuPercent, 1),
            };
        }

        var adsReadyPages = pages.Count(p => p.AdsReady);
        var activeAdAccounts = _adAccounts.Count(a => a.Status.Contains("active", StringComparison.OrdinalIgnoreCase));
        var openAlertCount = (_alertSummary?.OpenCritical ?? 0) + (_alertSummary?.OpenWarning ?? 0);
        if (openAlertCount == 0 && _alerts.Count > 0)
        {
            openAlertCount = _alerts.Count(a => a.Status.Equals("open", StringComparison.OrdinalIgnoreCase));
        }

        _workstationMem ??= WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        var recConcurrent = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(_config.LowRamFarmMode, _workstationMem);
        var freePct = Math.Clamp(100 - (int)_workstationMem.MemoryLoadPercent, 0, 100);

        var (phaseVi, detailText, _) = FormatQueueSummary(_queueSnapshot);
        var s = _queueSnapshot;
        var liveRunner = BuildLiveRunnerStatusDto();
        var activeQueue = s.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.NightPaused or QueuePhase.Syncing || liveRunner.IsActive;
        var qPct = liveRunner.IsActive
            ? liveRunner.OverallProgressPercent
            : (s.TotalCount > 0
                ? Math.Clamp((int)Math.Round(((s.LaunchedCount + s.SkippedCount) * 100.0) / s.TotalCount), 5, 100)
                : 0);
        if (!liveRunner.IsActive && (s.Phase == QueuePhase.Completed || liveRunner.IsCompleted)) qPct = 100;

        var healthAlertTotal = (_healthSummary?.Critical ?? 0) + (_healthSummary?.Warning ?? 0) + (_healthSummary?.AttentionNeeded ?? 0);
        var retainerWarnCount = _retainersOverview?.Items.Count(c => c.PacingStatus is "OVER_BUDGET" or "NEAR_CAP") ?? 0;

        var kpi = new OverviewKpiDto
        {
            TotalVias = _vias.Count,
            CookieVaultCount = cookieVaultCount,
            DueKeepAliveCount = dueCount,
            TwoFaReadyCount = twoFaReadyCount,
            TotalPages = pages.Count,
            AdsReadyPages = adsReadyPages,
            TotalFollowersInvited = _config.TotalPageFollowerInvitesSent,
            TotalAdAccounts = _adAccounts.Count,
            ActiveAdAccounts = activeAdAccounts,
            OpenAlertCount = openAlertCount,
            CriticalHealthCount = _healthSummary?.Critical ?? 0,
            BridgePort = _bridge?.BoundPort ?? _config.BridgePort,
            BridgeOnline = _bridge != null,
            ExtVersion = DesktopAppInfo.ExtVersion,
            ActiveBrowsers = ChromeSessionTracker.Default.GetActiveAutomationBrowserCount(),
            LiveProxyVias = _vias.Count(v => string.Equals(v.ProxyLastStatus, "LIVE", StringComparison.OrdinalIgnoreCase)),
            DirectIpVias = _vias.Count(v => string.Equals(v.ProxyLastStatus, "DIRECT", StringComparison.OrdinalIgnoreCase)),
            NativeProfileReadyCount = _vias.Count(v => ExtensionProvisioner.LocalNativeChromeProfileExists(v.ProfileDir)),
            MaxDirectIpPerBatch = _config.MaxDirectIpViasInBatch,
        };

        var effectivePhase = liveRunner.IsActive
            ? (liveRunner.IsPaused ? "Paused" : "Syncing")
            : s.Phase.ToString();

        var queue = new OverviewQueueDto
        {
            IsActive = activeQueue || s.Phase == QueuePhase.Completed || liveRunner.IsCompleted,
            Phase = effectivePhase,
            Kind = s.Kind.ToString(),
            CheckingProxy = s.CheckingProxy,
            CurrentIndex = s.CurrentIndex,
            TotalCount = Math.Max(s.TotalCount, liveRunner.IsActive || liveRunner.IsCompleted ? 1 : 0),
            LaunchedCount = Math.Max(s.LaunchedCount, liveRunner.IsActive || liveRunner.IsCompleted ? 1 : 0),
            SkippedCount = s.SkippedCount,
            CountdownSeconds = liveRunner.IsActive ? liveRunner.StepRemainingSec : s.CountdownSeconds,
            SummaryText = liveRunner.IsActive
                ? $"{phaseVi} — {liveRunner.ViaLabel}"
                : (string.IsNullOrWhiteSpace(s.CurrentViaLabel) ? phaseVi : $"{phaseVi} — {s.CurrentViaLabel}"),
            DetailText = detailText,
            ProgressPercent = qPct,
        };

        var workstation = new OverviewWorkstationDto
        {
            AvailableRamMb = _workstationMem.AvailablePhysicalMb,
            TotalRamMb = _workstationMem.TotalPhysicalMb,
            FreePercent = freePct,
            RecommendedConcurrent = recConcurrent,
            IsLowRam = _workstationMem.AvailablePhysicalMb < 1200,
        };

        var badges = new WebNavBadgesDto
        {
            Overview = openAlertCount > 0 ? openAlertCount.ToString() : "",
            Vias = dueCount > 0 ? dueCount.ToString() : "",
            Automation = activeQueue ? "RUN" : "",
            HealthTokens = healthAlertTotal > 0 ? healthAlertTotal.ToString() : "",
            WorkspaceOps = retainerWarnCount > 0 ? retainerWarnCount.ToString() : "",
        };

        var sessions = ChromeSessionTracker.Default.GetSnapshot()
            .Take(10)
            .Select(sess => new WebBrowserSessionDto
            {
                SessionId = sess.SessionId,
                Pid = sess.Pid,
                ViaLabel = sess.ViaLabel,
                ProfileDir = sess.ProfileDir,
                Url = sess.Url,
                StartedAtLocal = sess.StartedAt.ToLocalTime().ToString("HH:mm:ss"),
                Alive = sess.Alive,
                DelegatedToSharedBroker = sess.DelegatedToSharedBroker,
                StatusText = sess.StatusText,
            })
            .ToList();

        return (kpi, queue, workstation, badges, totpMap, runtimeMap, sessions);
    }

    internal AppShellWebStateDto BuildAppShellWebState()
    {
        var (kpi, queue, workstation, badges, totpMap, _, activeSessions) = BuildLiveTelemetryBundle();
        var pages = _pagesSummary?.Items ?? new();

        var groupedAlerts = _alerts
            .GroupBy(a => $"{a.Severity.ToUpperInvariant()}|{a.GetLocalizedTitle()}")
            .Take(8)
            .Select(grp =>
            {
                var items = grp.ToList();
                var first = items[0];
                var accNames = items
                    .Select(x => !string.IsNullOrWhiteSpace(x.AccountDisplayName) ? x.AccountDisplayName!.Trim() : (x.SourceLabel ?? ""))
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(4)
                    .ToList();
                var bmNames = items
                    .Select(x => x.BusinessManagerName?.Trim() ?? "")
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(3)
                    .ToList();
                var sev = first.Severity.ToLowerInvariant() switch
                {
                    "critical" => "critical",
                    "warning" => "warning",
                    _ => "info",
                };
                return new OverviewAlertGroupDto
                {
                    Key = grp.Key,
                    Severity = sev,
                    Title = first.GetLocalizedTitle(),
                    Summary = first.GetLocalizedSummary(),
                    AccountNames = accNames,
                    BmNames = bmNames,
                    Count = items.Count,
                    AlertIds = items.Where(x => x.Status.Equals("open", StringComparison.OrdinalIgnoreCase)).Select(x => x.Id).ToList(),
                    FirstAccountSearch = accNames.FirstOrDefault() ?? "",
                };
            })
            .ToList();

        var viaItems = _vias.Select(v =>
        {
            var normEng = AntidetectBrowserConnector.NormalizeEngine(v.AntidetectEngine);
            var canLaunch = CanCurrentUserLaunchVia(v, out var denyReason);
            return new WebViaItemDto
            {
                ViaId = v.ViaId,
                Label = v.Label,
                DisplayName = v.DisplayName,
                ExternalReferenceId = v.ExternalReferenceId,
                ProfileDir = v.ProfileDir,
                BrowserProfileLabel = v.BrowserProfileLabel,
                RoleTier = v.RoleTier,
                ClientGroup = v.ClientGroup,
                DefaultWarmupMode = v.DefaultWarmupMode,
                AntidetectEngine = normEng,
                AntidetectEngineLabel = AntidetectBrowserConnector.GetDisplayName(normEng),
                AntidetectProfileId = v.AntidetectProfileId,
                NetworkLabel = v.NetworkLabel,
                ProxyHostPort = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel),
                ProxyStatus = v.ProxyLastStatus,
                ProxyLatencyMs = v.ProxyLatencyMs,
                TrustScore = v.TrustScore,
                TrustSummary = v.TrustSummary,
                WarmupLabel = v.WarmupLabel,
                WarmupPhase = v.WarmupPhase,
                IdleDays = v.IdleDays,
                HasVaultCookie = v.HasVaultCookie,
                HasTwoFa = v.HasLocalTwoFa || !string.IsNullOrWhiteSpace(v.TwoFaSecret) || (totpMap.TryGetValue(v.ViaId, out var t) && t.Valid),
                NeedsKeepAlive = v.NeedsKeepAlive,
                IsInCooldown = v.IsInCooldown,
                CooldownReason = v.CooldownReason,
                CooldownUntilLocal = v.CooldownUntilUtc.HasValue ? v.CooldownUntilUtc.Value.ToLocalTime().ToString("dd/MM HH:mm") : "",
                HasSiloConflict = v.HasSiloConflict,
                SiloConflictDetail = v.SiloConflictDetail,
                IsBrowserRunning = v.IsBrowserRunning,
                ActiveRamMb = Math.Round(v.ActiveRamMb, 0),
                ActiveCpuPercent = Math.Round(v.ActiveCpuPercent, 1),
                HoldingPagesCount = v.HoldingPagesCount,
                HoldingLimit = v.HoldingLimit,
                AdAccountsCount = v.BundledAccounts.Count,
                OwnerMemberId = v.OwnerMemberId,
                OwnerMemberName = v.OwnerMemberName,
                CanLaunch = canLaunch,
                DenyReason = denyReason,
                QuotaStatus = v.QuotaStatus,
                HasTimezoneMismatch = v.HasTimezoneMismatch,
                TimezoneWarning = v.TimezoneWarning,
            };
        }).ToList();

        var isCustomSeq = string.Equals(_config.WarmupFlowMode, "custom_sequence", StringComparison.OrdinalIgnoreCase);
        _config.CustomWarmupActionSequence ??= WarmupActionCatalog.GetDefaultSequence();
        if (_config.CustomWarmupActionSequence.Count == 0) _config.CustomWarmupActionSequence = WarmupActionCatalog.GetDefaultSequence();
        var activeDisplaySeq = isCustomSeq
            ? _config.CustomWarmupActionSequence.ToList()
            : WarmupActionCatalog.BuildDailyRandomSequence(_vias.FirstOrDefault()?.ViaId ?? "via-1", DateTime.Now, _config.EnableInternalPageCrossWarmup);

        var effectivePbs = _playbooks.Count > 0 ? _playbooks : AutomationPlaybookDto.GetDefaultBuiltinPlaybooks();
        var playbookDtos = effectivePbs.Select(p => new WebPlaybookDto
        {
            Id = p.Id,
            Title = p.Title,
            Platform = p.Platform,
            Description = p.Description,
            VersionTag = p.VersionTag,
            DefaultStaggerSec = p.DefaultStaggerSec,
            JitterPct = p.JitterPct,
            AuthorName = p.AuthorName,
            AvgRating = p.AvgRating,
            RatingCount = p.RatingCount,
            RunCount = p.RunCount,
            MyRating = p.MyRating,
            FirstStepTarget = p.Steps.FirstOrDefault()?.Target ?? "https://www.facebook.com/",
        }).ToList();

        // Tab 4: Fanpage holder options + fanpages
        var pageHolderOpts = new List<WebOptionDto>();
        var seenProfiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in _vias)
        {
            seenProfiles.Add(v.ProfileDir);
            pageHolderOpts.Add(new WebOptionDto { Value = $"via:{v.ViaId}", Label = $"👤 {v.Label} ({v.ProfileDir})" });
        }
        foreach (var cp in _chromeProfiles)
        {
            if (seenProfiles.Contains(cp.Folder)) continue;
            seenProfiles.Add(cp.Folder);
            var suffix = string.IsNullOrWhiteSpace(cp.Name) || cp.Name == cp.Folder ? "" : $" ({cp.Name})";
            pageHolderOpts.Add(new WebOptionDto { Value = $"profile:{cp.Folder}", Label = $"🌐 Chrome: {cp.Folder}{suffix}" });
        }

        var fanpageDtos = pages.Select(pg =>
        {
            var effVia = ResolveEffectiveViaForPage(pg);
            string selectedTag = "";
            if (effVia != null)
            {
                var exactVia = _vias.FirstOrDefault(v => string.Equals(v.ViaId, effVia.ViaId, StringComparison.OrdinalIgnoreCase));
                selectedTag = exactVia != null ? $"via:{exactVia.ViaId}" : $"profile:{effVia.ProfileDir}";
            }
            else
            {
                var fallbackProf = ExtensionProvisioner.ResolveProfileDirectory(pg.HolderBrowserProfile, pg.HolderLabel);
                selectedTag = $"profile:{fallbackProf}";
            }

            var isRunningInv = IsAutoInviteRunning &&
                ((!string.IsNullOrWhiteSpace(pg.Id) && string.Equals(ActiveAutoInvitePageId, pg.Id, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(pg.ExternalPageId) && string.Equals(ActiveAutoInvitePageId, pg.ExternalPageId, StringComparison.OrdinalIgnoreCase)));
            var pageKey = !string.IsNullOrWhiteSpace(pg.ExternalPageId) ? pg.ExternalPageId! : pg.Id;
            var shareCount = _config.PageLocalShareCounts != null && _config.PageLocalShareCounts.TryGetValue(pageKey, out var sc) ? sc : 0;
            var lifecycle = PageContentNurtureEngine.ComputeLifecycleProgress(pg.WarmupPostsCount, shareCount, pg.AdsReady);

            return new WebFanpageDto
            {
                Id = pg.Id,
                Name = pg.Name,
                ExternalPageId = pg.ExternalPageId ?? "",
                Category = pg.Category ?? "",
                HealthStatus = pg.HealthStatus,
                IsUnsyncedDraft = pg.IsUnsyncedDraft,
                AdsReady = pg.AdsReady,
                SoakRemainingHours = pg.SoakRemainingHours,
                FollowersCount = pg.FanCount ?? pg.FollowersCount,
                PendingInviteCount = GetPagePendingInviteCount(pg),
                WarmupPostsCount = pg.WarmupPostsCount,
                ShareCount = shareCount,
                LifecycleDay = lifecycle.DayIndex,
                LifecycleLabel = lifecycle.StageLabel,
                OwnerBmId = pg.OwnerBmId ?? "",
                OwnerBmName = pg.OwnerBmName ?? "",
                LinkedAdAccountCount = pg.LinkedAdAccountCount,
                SelectedHolderTag = selectedTag,
                EffectiveHolderLabel = effVia != null ? $"{effVia.Label} ({effVia.ProfileDir})" : (string.IsNullOrWhiteSpace(pg.HolderLabel) ? "Mặc định" : pg.HolderLabel!),
                Url = pg.Url ?? "",
                ContagionRisk = pg.ContagionRisk,
                IsRunningInvite = isRunningInv,
            };
        }).ToList();

        // Tab 5: Ad Accounts + Spend Summary
        var spendBuckets = (_spendSummary?.Currencies ?? new()).Select(b => new WebSpendBucketDto
        {
            Currency = b.Currency,
            AccountsIncluded = b.AccountsIncluded,
            TodayText = FormatMetricOrDash(b.TodayPartialText == "—" ? null : b.TodayPartialText, b.Currency),
            Last7dText = FormatMetricOrDash(b.Last7dText == "—" ? null : b.Last7dText, b.Currency),
            MtdText = FormatMetricOrDash(b.MtdText == "—" ? null : b.MtdText, b.Currency),
        }).ToList();

        var adAccDtos = _adAccounts.Select(a =>
        {
            var bal = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BalanceRaw) ?? AdAccountBillingMetaDto.AsOptionalString(a.SpendPeriods?.BalanceRaw);
            var thr = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BillingThresholdRaw);
            var lim = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.MetaDailyLimitRaw);
            var viaLbl = a.FacebookIdentities.Count > 0 ? string.Join(", ", a.FacebookIdentities.Select(x => x.Label)) : "Chưa gắn Via";
            return new WebAdAccountDto
            {
                Id = a.Id,
                DisplayName = string.IsNullOrWhiteSpace(a.DisplayName) ? a.ExternalAccountId : a.DisplayName,
                ExternalAccountId = a.ExternalAccountId,
                Currency = a.Currency,
                Status = string.IsNullOrWhiteSpace(a.Status) ? "CHƯA RÕ" : a.Status.ToUpperInvariant(),
                IsActive = a.Status.Contains("active", StringComparison.OrdinalIgnoreCase),
                BalanceText = FormatMetricOrDash(bal, a.Currency),
                ThresholdText = FormatMetricOrDash(thr, a.Currency),
                DailyLimitText = FormatMetricOrDash(lim, a.Currency),
                SpendTodayText = FormatMetricOrDash(a.SpendPeriods?.TodayText, a.Currency),
                Spend7dText = FormatMetricOrDash(a.SpendPeriods?.Last7dText, a.Currency),
                BmName = string.IsNullOrWhiteSpace(a.BusinessManagerName) ? "Tài khoản Cá nhân / Chưa rõ BM" : a.BusinessManagerName!,
                ViaLabels = viaLbl,
                PaymentCard = FormatPaymentCardCompact(a.BillingMeta?.PaymentCardDisplay),
            };
        }).ToList();

        // Tab 6: Health & Tokens
        var metaConnDtos = _metaConnections.Select(c =>
        {
            var rawStatus = (c.Status ?? "").Trim();
            var badgeLbl = !c.TokenConfigured
                ? "CHƯA CÓ TOKEN"
                : (string.IsNullOrEmpty(rawStatus) || rawStatus.Equals("unknown", StringComparison.OrdinalIgnoreCase)
                    ? "TOKEN: ĐÃ LƯU KÉT"
                    : $"TOKEN: {rawStatus.ToUpperInvariant()}");
            return new WebMetaConnectionDto
            {
                Id = c.Id,
                Label = c.Label,
                Environment = c.Environment ?? "",
                ReaderSource = c.ReaderSource ?? "",
                BmReference = string.IsNullOrWhiteSpace(c.BusinessManagerReference) ? "Chưa gắn" : c.BusinessManagerReference!,
                Status = c.Status ?? "",
                TokenConfigured = c.TokenConfigured,
                BadgeLabel = badgeLbl,
                LastCheckedLocal = string.IsNullOrWhiteSpace(c.LastCapabilityCheckAt)
                    ? "Chưa kiểm tra gần đây"
                    : AlertItemDto.FormatIsoTimestampLocal(c.LastCapabilityCheckAt, c.LastCapabilityCheckAt!),
            };
        }).ToList();

        // Tab 7: Retainers & Team
        var retSum = _retainersOverview?.Summary ?? new ClientRetainersSummaryDto();
        var retDtos = (_retainersOverview?.Items ?? new()).Select(c => new WebRetainerDto
        {
            Id = c.Id,
            ContractCode = c.ContractCode,
            ClientName = c.ClientName,
            ProjectName = c.ProjectName,
            BillingCycle = c.BillingCycle,
            AccountCount = c.AccountCount,
            AgencyFeePercent = c.AgencyFeePercent,
            MetaTaxPercent = c.MetaTaxPercent,
            PacingStatus = c.PacingStatus,
            PacingPercent = c.PacingPercent,
            SpendMtdVnd = c.SpendMtdVnd,
            CommittedBudgetVnd = c.CommittedBudgetVnd,
            TotalBillableMtdVnd = c.TotalBillableMtdVnd,
            RecommendedDailyVnd = c.RecommendedDailyVnd,
        }).ToList();

        var teamMemberDtos = _teamMembers.Select(m =>
        {
            var isSusp = string.Equals(m.Status, "suspended", StringComparison.OrdinalIgnoreCase);
            var canManage = !string.Equals(m.Role, "owner", StringComparison.OrdinalIgnoreCase);
            var isFullAccess = (string.Equals(m.Role, "owner", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(m.Role, "admin", StringComparison.OrdinalIgnoreCase)) &&
                               m.AssignedBusinessManagerCount == 0 &&
                               m.AssignedAdAccountCount == 0;
            var scopeDetail = isFullAccess
                ? $"Toàn quyền Workspace ({_bms.Count} BM • {_adAccounts.Count} TKQC) • {Math.Max(1, m.ActiveSessionCount)} phiên đang mở"
                : $"{m.AssignedBusinessManagerCount} BM • {m.AssignedAdAccountCount} TKQC • {m.ActiveSessionCount} phiên đang mở";
            var nextRole = m.Role.ToLowerInvariant() switch { "viewer" => "operator", "operator" => "admin", _ => "viewer" };
            return new WebTeamMemberDto
            {
                Id = m.Id,
                Email = m.Email,
                FullName = m.FullName,
                Role = m.Role,
                Status = m.Status,
                IsSuspended = isSusp,
                CanManage = canManage,
                NextRole = nextRole,
                ScopeDetail = scopeDetail,
            };
        }).ToList();

        // Tab 8: Settings & Vault
        var integrity = BinaryIntegrityInspector.InspectCurrentProcess();
        var shaShort = integrity.Sha256Hex.Length > 24
            ? $"{integrity.Sha256Hex[..16]}...{integrity.Sha256Hex[^8..]}"
            : integrity.Sha256Hex;
        var curBridgeTok = _config.GetOrCreateBridgeToken();
        var maskedTok = curBridgeTok.Length > 14 ? $"{curBridgeTok[..8]}••••••••{curBridgeTok[^6..]}" : "••••••••";
        var tgCfg = _telegramConfig ?? new TelegramBotConfigDto();
        var tgDesc = tgCfg.BotConfigured
            ? $"Bot hiện tại: {(string.IsNullOrWhiteSpace(tgCfg.BotUsername) ? tgCfg.BotMask : "@" + tgCfg.BotUsername)} ({tgCfg.BotMask}) • Chat ID: {(tgCfg.ChatConfigured ? tgCfg.ChatIdMasked : "Chưa gắn")}"
            : "Chưa cấu hình Bot Token Telegram cho Workspace này.";

        var devSessions = _deviceSessions
            .Where(s => !s.RevokedAt.HasValue)
            .Take(10)
            .Select(sess =>
            {
                var rawLabel = (sess.Label ?? "").Trim();
                var isGenericUnknown = string.IsNullOrEmpty(rawLabel) || rawLabel.Contains("Unknown browser", StringComparison.OrdinalIgnoreCase);
                var browserDisp = string.IsNullOrWhiteSpace(sess.BrowserFamily) || sess.BrowserFamily == "?" || sess.BrowserFamily.Contains("Unknown", StringComparison.OrdinalIgnoreCase)
                    ? "Trình duyệt / App"
                    : sess.BrowserFamily!;
                var osDisp = string.IsNullOrWhiteSpace(sess.OsFamily) || sess.OsFamily == "?" ? "Cloud API" : sess.OsFamily!;
                var stypeDisp = string.Equals(sess.SessionType, "web", StringComparison.OrdinalIgnoreCase) ? "Web" : (string.IsNullOrWhiteSpace(sess.SessionType) ? "Phiên" : sess.SessionType!);
                var title = isGenericUnknown
                    ? (sess.IsCurrent ? "Phiên làm việc hiện tại (AdsOps Cloud / Desktop)" : "Phiên đăng nhập AdsOps Cloud / Web")
                    : rawLabel;
                var seen = (sess.LastSeenAt ?? sess.CreatedAt).ToLocalTime().ToString("dd/MM HH:mm");
                return new WebDeviceSessionDto
                {
                    Id = sess.Id,
                    Title = title,
                    Subtitle = $"{stypeDisp} • {browserDisp} / {osDisp} • Hoạt động {seen}",
                    IsCurrent = sess.IsCurrent,
                };
            }).ToList();

        var localSecrets = LocalSecretVaultStore.Default.ExportPlainEntries();
        var stewSnap = ViaStewardshipStore.Default.ExportSnapshot();

        var cloudLogs = (_pagesSummary?.ViaActivityLogs ?? new())
            .Take(8)
            .Select(l => new OverviewActivityItemDto
            {
                Id = string.IsNullOrWhiteSpace(l.Id) ? $"{l.CreatedAt}_{l.ViaLabel}" : l.Id,
                Title = $"{l.ActionLabel} • {l.ViaLabel}" + (string.IsNullOrWhiteSpace(l.PageName) ? "" : $" ({l.PageName})"),
                Detail = string.IsNullOrWhiteSpace(l.Detail) ? l.CreatedAt : l.Detail,
                CreatedAt = l.CreatedAt,
            }).ToList();

        return new AppShellWebStateDto
        {
            Type = "full_state",
            AppVersion = DesktopAppInfo.Version,
            ExtVersion = DesktopAppInfo.ExtVersion,
            ActiveView = ViewToKey(_activeView),
            Palette = ThemeTokens.CurrentPalette,
            IsLoggedIn = !string.IsNullOrWhiteSpace(_config.GetJwt()),
            HasLoadedOnce = _hasLoadedOnce,
            IsBusy = _isBusy,
            IsAuthExpired = _isAuthExpired,
            IsOfflineSnapshot = _isOfflineSnapshotMode,
            OfflineSnapshotAt = _offlineSnapshotAt,
            ErrorBannerText = _lastErrorMessage ?? "",
            UserDisplay = _currentUser != null
                ? (string.IsNullOrWhiteSpace(_currentUser.FullName) ? _currentUser.Email : _currentUser.FullName)
                : _config.UserEmail,
            UserEmail = _config.UserEmail,
            UserRole = _currentUser?.Role ?? "",
            WorkspaceDisplay = _currentUser?.Workspace?.Name ?? "AdsOps Workspace",
            LastSyncedAt = _lastSyncedAtLocal?.ToString("HH:mm:ss") ?? "—",
            AutoDailyPipeline = _config.AutoDailyFullPipeline,
            ConfigRev = _webUiConfigRev,
            IsAutoInviteRunning = IsAutoInviteRunning,
            ActiveAutoInvitePageId = ActiveAutoInvitePageId,
            NavBadges = badges,
            Kpi = kpi,
            Queue = queue,
            Workstation = workstation,
            GroupedAlerts = groupedAlerts,
            CloudLogs = cloudLogs,
            RuntimeLogs = _logLines.TakeLast(60).Reverse().ToList(),
            Vias = viaItems,
            TotpMap = totpMap,
            ChromeProfiles = _chromeProfiles.Select(cp => new WebOptionDto
            {
                Value = cp.Folder,
                Label = string.IsNullOrWhiteSpace(cp.Name) || cp.Name == cp.Folder ? cp.Folder : $"{cp.Folder} ({cp.Name})",
            }).ToList(),
            SupportedEngines = AntidetectBrowserConnector.SupportedEngines.Select(e => new WebOptionDto
            {
                Value = e.Key,
                Label = e.Label,
            }).ToList(),
            TeamMemberOptions = _teamMembers.Select(tm => new WebOptionDto
            {
                Value = tm.Id,
                Label = $"{(string.IsNullOrWhiteSpace(tm.FullName) ? tm.Email : tm.FullName)} ({tm.Role})",
            }).ToList(),
            AutomationConfig = new WebAutomationConfigDto
            {
                WarmupFlowMode = isCustomSeq ? "custom_sequence" : "daily_random",
                ActiveDisplaySequence = activeDisplaySeq,
                CustomWarmupSequence = _config.CustomWarmupActionSequence.ToList(),
                EnableInternalPageCrossWarmup = _config.EnableInternalPageCrossWarmup,
                EnablePreAdsManagerWarmup = _config.EnablePreAdsManagerWarmup,
                PreAdsWarmupSeconds = _config.PreAdsWarmupSeconds,
                AutoLikeCommentsOnPageInvite = _config.AutoLikeCommentsOnPageInvite,
                AutoTileWindowsOnBatch = _config.AutoTileWindowsOnBatch,
                QueueRestMinSeconds = _config.QueueRestMinSeconds,
                QueueRestMaxSeconds = _config.QueueRestMaxSeconds,
                FlowSelectedViaId = _flowDesignerSelectedViaId,
                BatchNicheKey = _batchNicheKey,
                BatchOwnerBmId = _batchOwnerBmId,
                BatchCount = _batchCount,
                BatchStaggerSec = _batchStaggerSec,
                BatchPrefix = _batchPrefix,
                BatchCustomNames = _batchCustomNames,
                BatchAutoSubmit = _batchAutoSubmit,
                EnablePrePageCreationWarmup = _config.EnablePrePageCreationWarmup,
                PrePageCreationWarmupSeconds = Math.Clamp(_config.PrePageCreationWarmupSeconds < 10 ? 35 : _config.PrePageCreationWarmupSeconds, 10, 90),
                MaxSafeBatchNow = _pagesSummary?.QuotaAlertsSummary?.MaxSafeBatchNow ?? _vias.Count,
                DirectIpViaCount = _vias.Count(v => string.IsNullOrWhiteSpace(v.NetworkLabel)),
                AutoKeepAliveScheduler = _config.AutoKeepAliveScheduler,
                AutoDailyFullPipeline = _config.AutoDailyFullPipeline,
                AutoInvitePageFollowersOnWarmup = _config.AutoInvitePageFollowersOnWarmup,
                MaxPageFollowerInvitesPerRun = _config.MaxPageFollowerInvitesPerRun,
                TotalPageFollowerInvitesSent = _config.TotalPageFollowerInvitesSent,
                AutoDailyVaultBackup = _config.AutoDailyVaultBackup,
                AutoPilotScheduleTimesCsv = _config.AutoPilotScheduleTimesCsv ?? "08:30, 20:00",
                PreCheckProxyBeforeLaunch = _config.PreCheckProxyBeforeLaunch,
                AutoCloseKeepAliveTab = _config.AutoCloseKeepAliveTab,
                AutoCloseKeepAliveWindow = _config.AutoCloseKeepAliveWindow,
                AutoKeepAliveStartHour = _config.AutoKeepAliveStartHour,
                AutoKeepAliveEndHour = _config.AutoKeepAliveEndHour,
                MaxViasPerProxyInBatch = _config.MaxViasPerProxyInBatch,
                MaxDirectIpViasInBatch = _config.MaxDirectIpViasInBatch,
                EnforceSoakQuarantine = _config.EnforceSoakQuarantine,
                EnforceClientSilo = _config.EnforceClientSilo,
                IpLeakKillSwitchEnabled = _config.IpLeakKillSwitchEnabled,
                AutoRefreshCookieAfterKeepAlive = _config.AutoRefreshCookieAfterKeepAlive,
                DefaultWarmupMode = ViaMetadataParser.NormalizeWarmupMode(_config.DefaultWarmupMode),
                SoakQuarantineHours = _config.SoakQuarantineHours,
                AutoCooldownHours = _config.AutoCooldownHours,
                UseIsolatedProfiles = _config.UseIsolatedProfiles,
                EffectiveMaxConcurrent = GetEffectiveMaxConcurrentBrowsers(),
                BrowserHangTimeoutSeconds = _config.BrowserHangTimeoutSeconds,
                CronAutoMetaSync = _cronStatus?.AutoMetaSyncEnabled ?? false,
                CronSyncIntervalMinutes = _cronStatus?.SyncIntervalMinutes ?? 60,
                CronAutoPageWarmup = _cronStatus?.AutoPageWarmupEnabled ?? false,
                CronWarmupMinGapHours = _cronStatus?.WarmupMinGapHours ?? 8,
                CronLastRunLocal = AlertItemDto.FormatIsoTimestampLocal(_cronStatus?.LastRunAt, "Chưa chạy"),
            },
            WarmupCatalog = WarmupActionCatalog.All.Select(w => new WebWarmupActionDto
            {
                Key = w.Key,
                Icon = w.Icon,
                ShortTitle = w.ShortTitle,
                FullTitle = w.FullTitle,
                DurationHint = w.DurationHint,
                Category = w.Category,
                Description = w.Description,
            }).ToList(),
            NicheTemplates = PageNicheTemplates.All.Select(t => new WebOptionDto
            {
                Value = t.Key,
                Label = $"{t.Label} ({t.DefaultCategory})",
            }).ToList(),
            Playbooks = playbookDtos,
            SelectedPlaybookId = string.IsNullOrWhiteSpace(_selectedPlaybookId) ? (playbookDtos.FirstOrDefault()?.Id ?? "") : _selectedPlaybookId,
            PlaybookPlatformFilter = _playbookPlatformFilter,
            ActiveSessions = activeSessions,
            Bms = _bms.Select(b => new WebBmDto { Id = b.Id, Name = b.Name, ExternalId = b.ExternalId ?? "", Status = b.Status }).ToList(),
            Pixels = _pixels.Take(20).Select(px => new WebPixelDto { Id = px.Id, Name = px.Name, ExternalPixelId = px.ExternalPixelId ?? "", Status = px.Status }).ToList(),
            DomainSeo = new WebDomainSeoDto
            {
                CustomDomain = _domainSeoConfig?.CustomDomain ?? "",
                EffectivePublicUrl = _domainSeoConfig?.EffectivePublicUrl ?? "https://adsops-app.vibe.tinhgon.xyz",
                Checklist = (_domainSeoConfig?.SeoChecklist ?? new()).Select(i => new WebSeoChecklistDto { Key = i.Key, Label = i.Label, Ready = i.Ready }).ToList(),
            },
            PageNurture = BuildPageNurtureConfigDto(),
            Fanpages = fanpageDtos,
            PageHolderOptions = pageHolderOpts,
            SpendCurrencies = spendBuckets,
            AdAccounts = adAccDtos,
            AdSearch = _adSearch ?? "",
            AdFilter = string.IsNullOrWhiteSpace(_adFilter) ? "all" : _adFilter,
            HealthKpi = new WebHealthKpiDto
            {
                Critical = _healthSummary?.Critical ?? 0,
                Warning = _healthSummary?.Warning ?? 0,
                AttentionNeeded = _healthSummary?.AttentionNeeded ?? 0,
                ClearSignals = _healthSummary?.ClearSignals ?? 0,
                TotalActive = _healthSummary?.TotalActive ?? _accountHealthRows.Count,
                StaleData = _healthSummary?.StaleData ?? 0,
                TokenConfiguredCount = _metaConnections.Count(c => c.TokenConfigured),
                MetaConnectionCount = _metaConnections.Count,
                DraftCount = _campaignDrafts.Count,
                DraftBlockingCount = _campaignDrafts.Count(d => d.OpenBlockingCount > 0),
            },
            MetaConnections = metaConnDtos,
            AccountHealthRows = _accountHealthRows.Select(r => new WebAccountHealthRowDto
            {
                AdAccountId = r.AdAccountId,
                DisplayName = string.IsNullOrWhiteSpace(r.DisplayName) ? (r.ExternalAccountId ?? r.AdAccountId) : r.DisplayName,
                ExternalAccountId = r.ExternalAccountId ?? "",
                BusinessManagerName = r.BusinessManagerName ?? "—",
                ViaLabel = r.PersonalAccountReferenceLabel ?? "—",
                HealthStatus = string.IsNullOrWhiteSpace(r.HealthStatus) ? "UNKNOWN" : r.HealthStatus.ToUpperInvariant(),
                ReadinessStatus = string.IsNullOrWhiteSpace(r.ReadinessStatus) ? "—" : r.ReadinessStatus.ToUpperInvariant(),
                TopReasonText = r.GetTopReasonText(),
                OpenCriticalCount = r.OpenCriticalCount,
                OpenWarningCount = r.OpenWarningCount,
                OpenAttentionCount = r.OpenAttentionCount,
            }).ToList(),
            CampaignDrafts = _campaignDrafts.Select(d => new WebCampaignDraftDto
            {
                Id = d.Id,
                Title = string.IsNullOrWhiteSpace(d.Title) ? d.Id : d.Title,
                AccountName = d.AccountDisplayName ?? d.AdAccountId ?? "—",
                Objective = d.Objective ?? "—",
                DraftStatus = string.IsNullOrWhiteSpace(d.DraftStatus) ? "DRAFT" : d.DraftStatus.ToUpperInvariant(),
                OpenBlockingCount = d.OpenBlockingCount,
                OpenWarningCount = d.OpenWarningCount,
            }).ToList(),
            ReadinessSummary = new WebReadinessSummaryDto
            {
                OperationallyReady = _readinessSummary?.OperationallyReady ?? 0,
                ReadyWithWarnings = _readinessSummary?.ReadyWithWarnings ?? 0,
                NotReady = _readinessSummary?.NotReady ?? 0,
                Unknown = _readinessSummary?.Unknown ?? 0,
            },
            ReadinessGroups = (_readinessBoard?.Groups ?? new()).Take(8).Select(g => new WebReadinessGroupDto
            {
                Message = g.Message,
                Severity = g.Severity,
                AccountCount = g.Accounts.Count,
            }).ToList(),
            ReadinessRows = (_readinessBoard?.Rows ?? new()).Take(40).Select(r => new WebReadinessRowDto
            {
                AdAccountId = r.AdAccountId,
                DisplayName = string.IsNullOrWhiteSpace(r.DisplayName) ? r.ExternalAccountId : r.DisplayName,
                ExternalAccountId = r.ExternalAccountId,
                Status = r.Status,
                ReadinessStatus = string.IsNullOrWhiteSpace(r.ReadinessStatus) ? "UNKNOWN" : r.ReadinessStatus.ToUpperInvariant(),
                CompletedItemCount = r.CompletedItemCount,
                RequiredItemCount = r.RequiredItemCount,
                ReasonText = r.Reasons.Count > 0 ? string.Join(" | ", r.Reasons.Take(2).Select(x => x.Message)) : "Đạt chuẩn sẵn sàng chạy Camp",
            }).ToList(),
            AuditLogs = _auditLogs.Take(100).Select(a => new WebAuditLogDto
            {
                Id = string.IsNullOrWhiteSpace(a.Id) ? $"{a.CreatedAt}_{a.Action}" : a.Id,
                CreatedAtLocal = DateTimeOffset.TryParse(a.CreatedAt, out var dto) ? dto.ToLocalTime().ToString("dd/MM HH:mm:ss") : a.CreatedAt,
                Action = a.Action,
                EntityType = a.EntityType,
                EntityId = a.EntityId,
                ActorEmail = a.ActorEmail ?? "system",
            }).ToList(),
            RetainersSummary = new WebRetainersSummaryDto
            {
                TotalContracts = retSum.TotalContracts,
                DaysRemainingInMonth = retSum.DaysRemainingInMonth,
                TotalCommittedVnd = retSum.TotalCommittedVnd,
                TotalMtdSpendVnd = retSum.TotalMtdSpendVnd,
                TotalUnpaidBalanceVnd = retSum.TotalUnpaidBalanceVnd,
                TotalSettlementMtdVnd = retSum.TotalSettlementMtdVnd,
            },
            Retainers = retDtos,
            TeamLocked = _teamSummary == null,
            TeamSummary = _teamSummary == null ? null : new WebTeamSummaryDto
            {
                SeatLimit = _teamSummary.SeatLimit,
                ActiveMembers = _teamSummary.ActiveMembers,
                PendingInvitations = _teamSummary.PendingInvitations,
                PlanReference = _teamSummary.PlanReference ?? "",
            },
            TeamMembers = teamMemberDtos,
            TeamInvitations = _teamInvitations.Select(inv => new WebTeamInvitationDto
            {
                Id = inv.Id,
                EmailNormalized = inv.EmailNormalized,
                InvitedRole = inv.InvitedRole,
                Status = inv.Status,
                TokenLastFour = inv.TokenLastFour ?? "----",
                ExpiresAt = inv.ExpiresAt,
            }).ToList(),
            Settings = new WebSettingsDto
            {
                BackendBaseUrl = _config.BackendBaseUrl,
                UserEmail = _config.UserEmail,
                AuthErrorMessage = _authErrorMessage,
                AuthSuccessMessage = _authSuccessMessage,
                HasCommunityQuota = _communityQuota != null || _currentUser?.Workspace != null,
                CommunityTier = (_communityQuota?.PlanTier ?? _currentUser?.Workspace?.PlanTier ?? "agency").ToUpperInvariant(),
                ViasUsed = _communityQuota?.ViasUsed ?? _vias.Count,
                MaxVias = _communityQuota?.MaxVias ?? _currentUser?.Workspace?.MaxVias ?? 500,
                AdAccountsUsed = _communityQuota?.AdAccountsUsed ?? _adAccounts.Count,
                MaxAdAccounts = _communityQuota?.MaxAdAccounts ?? _currentUser?.Workspace?.MaxAdAccounts ?? 500,
                UseIsolatedProfiles = _config.UseIsolatedProfiles,
                UriProtocolRegistered = ProtocolRegistrar.IsUriProtocolRegistered(),
                AutoStartEnabled = ProtocolRegistrar.IsAutoStartEnabled(),
                ChromeProfileSummary = $"Đã quét thấy {_chromeProfiles.Count} Chrome Profile trên máy: {string.Join(", ", _chromeProfiles.Take(6).Select(x => x.Folder))}",
                MaskedBridgeToken = maskedTok,
                DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(_config.DefaultBrowserEngine),
                AntidetectApiBaseUrl = _config.AntidetectApiBaseUrl ?? "",
                MaxConcurrentBrowsers = _config.MaxConcurrentBrowsers,
                EnableChromeAntidetectShield = _config.EnableChromeAntidetectShield,
                LowRamFarmMode = _config.LowRamFarmMode,
                AutoScaleConcurrentByRam = _config.AutoScaleConcurrentByRam,
                AutoFailoverToChromeNative = _config.AutoFailoverToChromeNative,
                AntidetectStatusMessage = _antidetectStatusMessage,
                AntidetectProfilesCount = _antidetectProfiles.Count,
                MaxViasPerProxyInBatch = _config.MaxViasPerProxyInBatch,
                MaxPagesPerProxyInBatch = _config.MaxPagesPerProxyInBatch,
                SameProxyMinStaggerSeconds = _config.SameProxyMinStaggerSeconds,
                AutoKeepAliveScheduler = _config.AutoKeepAliveScheduler,
                PreCheckProxyBeforeLaunch = _config.PreCheckProxyBeforeLaunch,
                VaultSecretCount = localSecrets.Count,
                StewardshipRecordCount = stewSnap.Records.Count,
                TelegramActive = tgCfg.BotConfigured && tgCfg.ChatConfigured && tgCfg.Enabled,
                BotConfigured = tgCfg.BotConfigured,
                TelegramDesc = tgDesc,
                TelegramEnabled = tgCfg.Enabled,
                NotifyAdAccountDisabled = tgCfg.NotifyAdAccountDisabled,
                NotifyBillingFailed = tgCfg.NotifyBillingFailed,
                NotifyPageRestricted = tgCfg.NotifyPageRestricted,
                NotifyRetainerOverspend = tgCfg.NotifyRetainerOverspend,
                QuietHoursRespect = tgCfg.QuietHoursRespect,
                TelegramStatusMessage = _telegramStatusMessage,
                TelegramStatusOk = _telegramStatusOk,
                DetectedTelegramChats = _detectedTelegramChats.Select(c => new WebTelegramChatDto
                {
                    ChatId = c.ChatIdText,
                    Label = $"{(string.IsNullOrWhiteSpace(c.Title) ? c.Username : c.Title)} [{c.Type}] — {c.ChatIdText}",
                }).ToList(),
                DeviceSessions = devSessions,
                SignatureStatus = integrity.SignatureStatus,
                HasEmbeddedSignature = integrity.HasEmbeddedSignature,
                ShaShort = shaShort,
                UpdateStatusText = _updateStatusText,
                LatestAvailableVersion = _latestUpdateManifest?.Version ?? "",
                HasUpdateManifest = _latestUpdateManifest != null && !string.IsNullOrWhiteSpace(_latestUpdateManifest.DownloadUrl),
                IsNewerUpdate = _latestUpdateManifest != null && SelfUpdateService.IsNewerVersion(_latestUpdateManifest.Version, DesktopAppInfo.Version),
            },
            LiveRunner = BuildLiveRunnerStatusDto(),
        };
    }

    internal AppShellLiveTickDto BuildAppShellLiveTick()
    {
        var (kpi, queue, workstation, badges, totpMap, viaRuntimeMap, activeSessions) = BuildLiveTelemetryBundle();
        return new AppShellLiveTickDto
        {
            Type = "live_tick",
            IsBusy = _isBusy,
            IsAutoInviteRunning = IsAutoInviteRunning,
            ActiveAutoInvitePageId = ActiveAutoInvitePageId,
            ErrorBannerText = _lastErrorMessage ?? "",
            IsAuthExpired = _isAuthExpired,
            NavBadges = badges,
            Kpi = kpi,
            Queue = queue,
            Workstation = workstation,
            TotpMap = totpMap,
            ViaRuntimeMap = viaRuntimeMap,
            ActiveSessions = activeSessions,
            RuntimeLogs = _logLines.TakeLast(60).Reverse().ToList(),
            LiveRunner = BuildLiveRunnerStatusDto(),
        };
    }

    internal void PushOverviewStateToWebView()
    {
        if (!_overviewWebViewReady || _overviewWebView?.CoreWebView2 == null) return;
        try
        {
            var json = DesktopWebUiBridge.BuildShellStateJson(BuildAppShellWebState());
            _overviewWebView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
    }

    internal void PushLiveTickToWebView()
    {
        if (!_overviewWebViewReady || _overviewWebView?.CoreWebView2 == null) return;
        try
        {
            var json = DesktopWebUiBridge.BuildLiveTickJson(BuildAppShellLiveTick());
            _overviewWebView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
    }

    private void ExecuteExportFullVaultBackup()
    {
        var path = SystemTrayService.ShowSaveVaultDialog($"adsops-workstation-{DateTime.Now:yyyyMMdd-HHmm}.adsopsvault");
        if (string.IsNullOrWhiteSpace(path)) return;
        var pwd = PromptPasswordDialog("Đặt Mật khẩu cho File Di chuyển Máy", "File này chứa toàn bộ Cookie, 2FA, Via, Cài đặt, Ngâm 72h & Phiên Cloud được mã hóa AES-256-GCM. Tuyệt đối nhớ mật khẩu.", confirmMatch: true);
        if (string.IsNullOrWhiteSpace(pwd)) return;

        try
        {
            var payload = new VaultBackupPayload
            {
                AppVersion = DesktopAppInfo.Version,
                BackendBaseUrl = _config.BackendBaseUrl,
                UserEmail = _config.UserEmail,
                CloudJwtPlain = _config.GetJwt(),
                ConfigSnapshot = _config.CloneWithoutSecrets(),
                StewardshipSnapshot = ViaStewardshipStore.Default.ExportSnapshot(),
                Vias = _vias.ToList(),
                LocalSecrets = LocalSecretVaultStore.Default.ExportPlainEntries(),
            };
            var bytes = VaultBackupService.EncryptToBytes(payload, pwd);
            File.WriteAllBytes(path, bytes);
            AppendLog($"Đã xuất Full Backup di chuyển máy ({payload.LocalSecrets.Count} secret, {payload.Vias.Count} Via, {payload.StewardshipSnapshot.Records.Count} hồ sơ ngâm): {path}");
            MessageBox.Show(
                this,
                $"Xuất trọn gói thành công vào:\n{path}\n\n• Bí mật Cookie / 2FA: {payload.LocalSecrets.Count}\n• Danh sách Via & Proxy: {payload.Vias.Count}\n• Hồ sơ Ngâm 72h / Cooldown: {payload.StewardshipSnapshot.Records.Count}\n• Kèm toàn bộ Cài đặt Cụm Proxy & Phiên Cloud.",
                "Hoàn tất Full Backup",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Lỗi Xuất Két", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void ExecuteImportFullVaultBackup()
    {
        var path = SystemTrayService.ShowOpenVaultDialog();
        if (string.IsNullOrWhiteSpace(path)) return;
        var pwd = PromptPasswordDialog("Nhập Mật khẩu giải mã Full Backup", $"Giải mã & khôi phục trọn gói từ: {Path.GetFileName(path)}", confirmMatch: false);
        if (string.IsNullOrWhiteSpace(pwd)) return;

        try
        {
            var bytes = File.ReadAllBytes(path);
            var payload = VaultBackupService.DecryptFromBytes(bytes, pwd);

            var importedSecrets = LocalSecretVaultStore.Default.ImportPlainEntries(payload.LocalSecrets);
            var importedStew = ViaStewardshipStore.Default.ImportSnapshot(payload.StewardshipSnapshot);

            if (payload.ConfigSnapshot != null) _config.ApplyPreferencesFrom(payload.ConfigSnapshot);
            if (!string.IsNullOrWhiteSpace(payload.BackendBaseUrl)) _config.BackendBaseUrl = payload.BackendBaseUrl.Trim().TrimEnd('/');
            if (!string.IsNullOrWhiteSpace(payload.UserEmail)) _config.UserEmail = payload.UserEmail.Trim();

            var jwtRestored = false;
            if (!string.IsNullOrWhiteSpace(payload.CloudJwtPlain) &&
                (string.IsNullOrWhiteSpace(_config.GetJwt()) || string.Equals(_config.UserEmail, payload.UserEmail, StringComparison.OrdinalIgnoreCase)))
            {
                _config.SetJwt(payload.CloudJwtPlain);
                jwtRestored = true;
            }
            _config.Save();
            ConfigureApiClient();

            if (_vias.Count == 0 && payload.Vias != null && payload.Vias.Count > 0)
            {
                _vias = payload.Vias.ToList();
            }
            ApplyUpdatedProxyClusterLimits();

            try { ProtocolRegistrar.RegisterUriProtocol(); } catch { }
            var provisionedExt = ProvisionAllViaExtensions(silent: true);

            AppendLog($"Đã khôi phục Full Backup sang máy mới: {importedSecrets} Cookie/2FA DPAPI, {importedStew} hồ sơ Ngâm 72h, {_vias.Count} Via, cấp lại {provisionedExt} Extension.");
            if (!string.IsNullOrWhiteSpace(_config.GetJwt())) _ = SyncCloudAsync(silent: true);

            MessageBox.Show(
                this,
                $"Khôi phục trọn gói sang máy mới thành công!\n\n• Cookie & 2FA nạp vào Két DPAPI: {importedSecrets}\n• Hồ sơ Ngâm 72h / Cooldown: {importedStew}\n• Danh sách Via sẵn sàng: {_vias.Count}\n• Đã gắn Protocol & cấp lại {provisionedExt} Chrome Extension v{DesktopAppInfo.ExtVersion}\n• Phiên Cloud: {(jwtRestored ? "Đã khôi phục (tự đồng bộ nền)" : "Giữ nguyên cài đặt")}",
                "Khôi phục Hoàn tất",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            _webUiConfigRev++;
            RefreshHeaderAndSidebar();
            RenderCurrentView();
        }
        catch (Exception ex) { MessageBox.Show(this, $"Không giải mã được file Backup (sai mật khẩu hoặc hỏng file): {ex.Message}", "Lỗi Giải mã", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private List<ViaWorkspaceEntry> ResolveSelectedViasFromPayload(JsonElement root)
    {
        if (root.TryGetProperty("viaIds", out var el) && el.ValueKind == JsonValueKind.Array)
        {
            var ids = new HashSet<string>(
                el.EnumerateArray().Select(x => (x.GetString() ?? "").Trim()).Where(s => !string.IsNullOrEmpty(s)),
                StringComparer.OrdinalIgnoreCase);
            if (ids.Count > 0)
            {
                return _vias.Where(v => ids.Contains(v.ViaId)).ToList();
            }
        }
        return new List<ViaWorkspaceEntry>();
    }

    private static string GetStr(JsonElement root, string name, string fallback = "")
        => root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? (el.GetString() ?? fallback) : fallback;

    private static bool GetBool(JsonElement root, string name, bool fallback = false)
        => root.TryGetProperty(name, out var el) && (el.ValueKind == JsonValueKind.True || el.ValueKind == JsonValueKind.False)
            ? el.GetBoolean()
            : fallback;

    private static int GetInt(JsonElement root, string name, int fallback = 0)
    {
        if (!root.TryGetProperty(name, out var el)) return fallback;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var iv)) return iv;
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var pv)) return pv;
        return fallback;
    }

    private void OnOverviewWebMessageReceived(string rawJson)
    {
        Dispatcher.BeginInvoke(async () =>
        {
            try
            {
                using var doc = JsonDocument.Parse(rawJson);
                var root = doc.RootElement;
                var action = GetStr(root, "action").Trim();
                if (string.IsNullOrEmpty(action)) return;

                switch (action)
                {
                    // ===== SHELL & HOTKEYS =====
                    case "ready":
                        PushOverviewStateToWebView();
                        break;

                    case "hotkey":
                        {
                            var keyStr = GetStr(root, "key").Trim().ToUpperInvariant();
                            if (keyStr == "F5")
                            {
                                HandleShortcutKey(Key.F5, ModifierKeys.None);
                            }
                            else
                            {
                                Key? mapped = keyStr switch
                                {
                                    "K" => Key.K,
                                    "P" => Key.P,
                                    "B" => Key.B,
                                    "N" => Key.N,
                                    "1" => Key.D1,
                                    "2" => Key.D2,
                                    "3" => Key.D3,
                                    "4" => Key.D4,
                                    "5" => Key.D5,
                                    "6" => Key.D6,
                                    "7" => Key.D7,
                                    "8" => Key.D8,
                                    _ => null,
                                };
                                if (mapped.HasValue) HandleShortcutKey(mapped.Value, ModifierKeys.Control);
                            }
                            break;
                        }

                    case "switch_view":
                        SwitchView(KeyToView(GetStr(root, "view", "overview")));
                        break;

                    case "open_command_palette":
                        OpenCommandPaletteDialog();
                        break;

                    case "toggle_palette":
                        ToggleUiThemePalette();
                        break;

                    case "sync_cloud":
                        await SyncCloudAsync(silent: false);
                        break;

                    case "retry_error_banner":
                        if (_isAuthExpired) OpenQuickReloginDialog();
                        else await SyncCloudAsync(silent: false);
                        break;

                    case "dismiss_error_banner":
                        _lastErrorMessage = null;
                        _errorBanner.Visibility = Visibility.Collapsed;
                        PushOverviewStateToWebView();
                        break;

                    case "clear_logs":
                        _logLines.Clear();
                        if (_logBox != null) _logBox.Text = "";
                        if (_logPreviewText != null) _logPreviewText.Text = "Đã xóa nhật ký.";
                        PushLiveTickToWebView();
                        break;

                    case "run_autopilot":
                        await RunFullAutoPilotPipelineAsync(interactiveConfirm: true);
                        break;

                    case "clean_ram":
                        RunCacheAndRamCleanupNow(renderAfter: true);
                        break;

                    case "queue_toggle_pause":
                        ToggleQueueAndRunnerPause();
                        break;

                    case "queue_skip_wait":
                        SkipCurrentRunnerStepOrQueueWait();
                        break;

                    case "queue_stop":
                        StopQueueAndActiveRunners();
                        break;

                    case "dismiss_queue_banner":
                        DismissCompletedQueueBanner();
                        break;

                    case "cancel_auto_invite":
                        CancelAutoInvite();
                        break;

                    // ===== TAB 1: OVERVIEW =====
                    case "ack_all_alerts":
                        await AcknowledgeAllOpenAlertsAsync();
                        break;

                    case "ack_alert_group":
                        if (root.TryGetProperty("alertIds", out var idsEl) && idsEl.ValueKind == JsonValueKind.Array)
                        {
                            var ids = idsEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
                            if (ids.Count > 0)
                            {
                                SetBusy(true);
                                try
                                {
                                    foreach (var id in ids)
                                    {
                                        try { await _api.AcknowledgeAlertAsync(id, $"Ghi nhận nhóm từ AdsOps Desktop Pro v{DesktopAppInfo.Version}"); } catch { }
                                    }
                                    AppendLog($"✓ Đã ghi nhận {ids.Count} cảnh báo từ Trang chủ.");
                                    await SyncCloudAsync(silent: false);
                                }
                                finally { SetBusy(false); }
                            }
                        }
                        break;

                    case "open_ad_accounts":
                        _adSearch = GetStr(root, "search").Trim();
                        _adFilter = GetStr(root, "filter", "all").Trim();
                        SwitchView(AppView.AdAccounts);
                        break;

                    case "test_telegram":
                        try
                        {
                            var r = await _api.SendTelegramTestAsync();
                            AppendLog($"Telegram Test: {r.Message}");
                            MessageBox.Show(this, r.Message, "Telegram Test", MessageBoxButton.OK, MessageBoxImage.Information);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi gửi Telegram: {ex.Message}"); }
                        break;

                    case "invite_single_page":
                        {
                            var pid = GetStr(root, "pageId").Trim();
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, pid, StringComparison.OrdinalIgnoreCase));
                            if (pg != null) LaunchPageAutoInviteFollowers(pg, autoClose: false);
                            break;
                        }

                    case "batch_proxy_check":
                        await RunBatchProxyCheckAsync();
                        break;

                    case "keepalive_due":
                        StartKeepAliveDueQueue(requireConfirm: true);
                        break;

                    case "batch_invite_followers":
                        EnqueueBatchPageAutoInviteFollowers(requireConfirm: true);
                        break;

                    case "sync_meta_pages":
                        await RunMetaPageSyncAsync();
                        break;

                    case "provision_extensions":
                        {
                            var cnt = ProvisionAllViaExtensions(silent: false);
                            PushOverviewStateToWebView();
                            MessageBox.Show(this, $"Đã cấp mới Chrome Extension Companion v{DesktopAppInfo.ExtVersion} cho {cnt} Via.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
                            break;
                        }

                    case "benchmark_engines":
                        await RunBenchmarkAllEnginesUiAsync();
                        break;

                    case "open_launch_audit":
                        OpenProfileLaunchAuditDialog();
                        break;

                    case "apply_safe_preset":
                        _config.EnableChromeAntidetectShield = true;
                        _config.LowRamFarmMode = true;
                        _config.AutoScaleConcurrentByRam = true;
                        _config.PreCheckProxyBeforeLaunch = true;
                        _config.EnforceSoakQuarantine = true;
                        _config.EnforceClientSilo = true;
                        _config.MaxViasPerProxyInBatch = 4;
                        _config.DefaultStaggerSeconds = 60;
                        _config.Save();
                        _webUiConfigRev++;
                        var safeCnt = ProvisionAllViaExtensions(silent: true);
                        AppendLog($"⚡ Đã áp dụng Preset An Toàn Chuẩn và cấp lại {safeCnt} Extension.");
                        RenderCurrentView();
                        break;

                    case "quick_test_first":
                        {
                            var picked = _vias.FirstOrDefault(v => !v.IsInCooldown && CanCurrentUserLaunchVia(v, out _)) ?? _vias.FirstOrDefault();
                            if (picked == null) MessageBox.Show(this, "Chưa có Via nào trong Workspace để chạy test.", "Thiếu Via", MessageBoxButton.OK, MessageBoxImage.Information);
                            else StartNaturalFlowForVias(new[] { picked }, fastTest: true, requireConfirm: false);
                            break;
                        }

                    // ===== TAB 2: MULTI-VIA =====
                    case "open_via_chrome":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null) LaunchViaChromeSafe(via, "https://www.facebook.com/");
                            break;
                        }

                    case "quick_test_via":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null) StartNaturalFlowForVias(new[] { via }, fastTest: true, requireConfirm: false);
                            break;
                        }

                    case "keepalive_single_via":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null) EnqueueKeepAliveVias(new[] { via }, $"Đảo Ấm {via.Label}", requireConfirm: false);
                            break;
                        }

                    case "open_local_vault":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null) OpenLocalVaultDialog(via);
                            break;
                        }

                    case "edit_via":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null) OpenViaEditorDialog(via);
                            break;
                        }

                    case "add_via":
                        OpenViaEditorDialog(null);
                        break;

                    case "check_via_proxy":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null)
                            {
                                await CheckSelectedViaProxiesAsync(new List<ViaWorkspaceEntry> { via });
                                PushOverviewStateToWebView();
                            }
                            break;
                        }

                    case "archive_via":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via == null) break;
                            var confirm = UiComponents.ShowConfirmActionDialog(
                                this,
                                "Lưu trữ (Archive) Via",
                                $"Ẩn Via '{via.Label}' khỏi danh sách hoạt động trên Cloud?",
                                new (string, string)[] { ("Via:", via.Label), ("Profile:", via.ProfileDir), ("Page đang cầm:", $"{via.HoldingPagesCount} Page") },
                                "Cookie & 2FA local trong DPAPI vẫn được giữ an toàn trên máy Windows này.",
                                "Xác nhận Lưu trữ",
                                isDanger: true);
                            if (!confirm) break;
                            try
                            {
                                await _api.ArchivePersonalAccountAsync(via.ViaId);
                                AppendLog($"Đã lưu trữ Via '{via.Label}'.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi lưu trữ Via: {ex.Message}"); }
                            break;
                        }

                    case "copy_via_totp":
                        {
                            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, GetStr(root, "viaId").Trim(), StringComparison.OrdinalIgnoreCase));
                            if (via != null)
                            {
                                CopyViaTotpToClipboard(via);
                                _copiedTotpViaId = via.ViaId;
                                _copiedToastUntilUtc = DateTime.UtcNow.AddSeconds(2);
                                PushLiveTickToWebView();
                            }
                            break;
                        }

                    case "distribute_proxies":
                        {
                            var sel = ResolveSelectedViasFromPayload(root);
                            OpenBulkDistributeProxiesDialog(sel.Count > 0 ? sel : null);
                            break;
                        }

                    case "bulk_change_tier":
                        {
                            var sel = ResolveSelectedViasFromPayload(root);
                            OpenBulkChangeTierAndSiloDialog(sel.Count > 0 ? sel : null);
                            break;
                        }

                    case "bulk_keepalive":
                        {
                            var sel = ResolveSelectedViasFromPayload(root);
                            if (sel.Count > 0) EnqueueKeepAliveVias(sel, $"Đảo Ấm {sel.Count} Via đã chọn", requireConfirm: true);
                            break;
                        }

                    case "bulk_check_proxy":
                        {
                            var sel = ResolveSelectedViasFromPayload(root);
                            if (sel.Count > 0)
                            {
                                await CheckSelectedViaProxiesAsync(sel);
                                PushOverviewStateToWebView();
                            }
                            break;
                        }

                    case "bulk_provision_ext":
                        {
                            var sel = ResolveSelectedViasFromPayload(root);
                            foreach (var v in sel) v.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(v, config: _config);
                            AppendLog($"Đã cấp Extension Companion v{DesktopAppInfo.ExtVersion} cho {sel.Count} Via đã chọn.");
                            MessageBox.Show(this, $"Đã cấp Extension cho {sel.Count} Via.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
                            break;
                        }

                    case "bulk_import_vias":
                        OpenBulkImportViasDialog();
                        break;

                    case "export_vias_csv":
                        ExportViasCsv();
                        break;

                    case "tile_chrome_windows":
                        TileActiveChromeWindows(GetStr(root, "grid", "2x2"));
                        break;

                    case "open_auto_connect_token":
                        OpenAutoConnectTokenDialog(null);
                        break;

                    case "open_stewardship_log":
                        OpenStewardshipLogDialog();
                        break;

                    // ===== TAB 3: AUTOMATION =====
                    case "set_flow_mode":
                        {
                            var mode = GetStr(root, "mode", "daily_random").Trim().ToLowerInvariant();
                            _config.WarmupFlowMode = mode == "custom_sequence" ? "custom_sequence" : "daily_random";
                            if (_config.WarmupFlowMode == "custom_sequence" && (_config.CustomWarmupActionSequence == null || _config.CustomWarmupActionSequence.Count == 0))
                            {
                                _config.CustomWarmupActionSequence = WarmupActionCatalog.GetDefaultSequence();
                            }
                            _config.Save();
                            AppendLog(_config.WarmupFlowMode == "custom_sequence"
                                ? "🧩 Đã chuyển sang chế độ 'Tự Kéo-Thả & Nối Chuỗi Theo Trình Tự'."
                                : "🎲 Đã bật chế độ 'Bốc thăm Ngẫu nhiên Mỗi Ngày'.");
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "reroll_daily_flow":
                        _config.CustomWarmupActionSequence = WarmupActionCatalog.BuildDailyRandomSequence(Guid.NewGuid().ToString("N"), DateTime.Now, _config.EnableInternalPageCrossWarmup);
                        _config.Save();
                        AppendLog($"🔀 Đã bốc thăm chuỗi hành động mới: {WarmupActionCatalog.FormatSequenceArrowText(_config.CustomWarmupActionSequence)}");
                        PushOverviewStateToWebView();
                        break;

                    case "reset_default_flow":
                        _config.CustomWarmupActionSequence = WarmupActionCatalog.GetDefaultSequence();
                        _config.Save();
                        PushOverviewStateToWebView();
                        break;

                    case "update_flow_sequence":
                        if (root.TryGetProperty("sequence", out var seqEl) && seqEl.ValueKind == JsonValueKind.Array)
                        {
                            var nextSeq = seqEl.EnumerateArray()
                                .Select(x => (x.GetString() ?? "").Trim())
                                .Where(x => WarmupActionCatalog.FindByKey(x) != null)
                                .ToList();
                            if (nextSeq.Count >= 2)
                            {
                                _config.WarmupFlowMode = "custom_sequence";
                                _config.CustomWarmupActionSequence = nextSeq;
                                _config.Save();
                                AppendLog($"🔗 Đã cập nhật chuỗi trình tự ({nextSeq.Count} bước): {WarmupActionCatalog.FormatSequenceArrowText(nextSeq)}");
                                PushOverviewStateToWebView();
                            }
                        }
                        break;

                    case "save_flow_controls":
                        _config.EnableInternalPageCrossWarmup = GetBool(root, "enableInternalPageCrossWarmup", _config.EnableInternalPageCrossWarmup);
                        _config.EnablePreAdsManagerWarmup = GetBool(root, "enablePreAdsManagerWarmup", _config.EnablePreAdsManagerWarmup);
                        _config.AutoLikeCommentsOnPageInvite = GetBool(root, "autoLikeCommentsOnPageInvite", _config.AutoLikeCommentsOnPageInvite);
                        _config.AutoTileWindowsOnBatch = GetBool(root, "autoTileWindowsOnBatch", _config.AutoTileWindowsOnBatch);
                        _config.QueueRestMinSeconds = Math.Clamp(GetInt(root, "queueRestMinSeconds", _config.QueueRestMinSeconds), 5, 300);
                        _config.QueueRestMaxSeconds = Math.Clamp(Math.Max(_config.QueueRestMinSeconds, GetInt(root, "queueRestMaxSeconds", _config.QueueRestMaxSeconds)), _config.QueueRestMinSeconds, 600);
                        _config.PreAdsWarmupSeconds = Math.Clamp(GetInt(root, "preAdsWarmupSeconds", _config.PreAdsWarmupSeconds), 8, 90);
                        _config.DefaultStaggerSeconds = _config.QueueRestMinSeconds;
                        _config.Save();
                        _webUiConfigRev++;
                        AppendLog($"✅ Đã lưu Cấu hình Tương tác Tự nhiên {DesktopAppInfo.DisplayVersion}: Nhịp nghỉ {_config.QueueRestMinSeconds}s–{_config.QueueRestMaxSeconds}s.");
                        PushOverviewStateToWebView();
                        break;

                    case "run_natural_flow":
                        {
                            if (root.TryGetProperty("enableInternalPageCrossWarmup", out _))
                            {
                                _config.EnableInternalPageCrossWarmup = GetBool(root, "enableInternalPageCrossWarmup", _config.EnableInternalPageCrossWarmup);
                                _config.EnablePreAdsManagerWarmup = GetBool(root, "enablePreAdsManagerWarmup", _config.EnablePreAdsManagerWarmup);
                                _config.AutoLikeCommentsOnPageInvite = GetBool(root, "autoLikeCommentsOnPageInvite", _config.AutoLikeCommentsOnPageInvite);
                                _config.AutoTileWindowsOnBatch = GetBool(root, "autoTileWindowsOnBatch", _config.AutoTileWindowsOnBatch);
                                _config.QueueRestMinSeconds = Math.Clamp(GetInt(root, "queueRestMinSeconds", _config.QueueRestMinSeconds), 5, 300);
                                _config.QueueRestMaxSeconds = Math.Clamp(Math.Max(_config.QueueRestMinSeconds, GetInt(root, "queueRestMaxSeconds", _config.QueueRestMaxSeconds)), _config.QueueRestMinSeconds, 600);
                                _config.PreAdsWarmupSeconds = Math.Clamp(GetInt(root, "preAdsWarmupSeconds", _config.PreAdsWarmupSeconds), 8, 90);
                                _config.DefaultStaggerSeconds = _config.QueueRestMinSeconds;
                                _config.Save();
                            }

                            var tag = GetStr(root, "viaId", "__first__").Trim();
                            _flowDesignerSelectedViaId = tag;
                            var fastTest = GetBool(root, "fastTest", false);
                            var validFlowVias = _vias.Where(v => !v.IsInCooldown && CanCurrentUserLaunchVia(v, out _)).ToList();

                            List<ViaWorkspaceEntry> chosenList;
                            if (string.Equals(tag, "__all__", StringComparison.OrdinalIgnoreCase))
                            {
                                chosenList = validFlowVias;
                            }
                            else
                            {
                                var one = _vias.FirstOrDefault(v => string.Equals(v.ViaId, tag, StringComparison.OrdinalIgnoreCase))
                                          ?? validFlowVias.FirstOrDefault()
                                          ?? _vias.FirstOrDefault();
                                chosenList = one != null ? new List<ViaWorkspaceEntry> { one } : new List<ViaWorkspaceEntry>();
                            }

                            if (chosenList.Count == 0)
                            {
                                MessageBox.Show(this, "Không có Via hợp lệ (không Cooldown) để chạy kịch bản.", "Không thể chạy", MessageBoxButton.OK, MessageBoxImage.Information);
                                break;
                            }
                            if (chosenList.Count == 1 && !CanCurrentUserLaunchVia(chosenList[0], out var denyMsg))
                            {
                                MessageBox.Show(this, denyMsg, "Phân quyền Team", MessageBoxButton.OK, MessageBoxImage.Warning);
                                break;
                            }
                            StartNaturalFlowForVias(chosenList, fastTest: fastTest, requireConfirm: !fastTest && chosenList.Count > 1);
                            break;
                        }

                    case "open_create_playbook":
                        OpenCreatePlaybookDialog(() => PushOverviewStateToWebView());
                        break;

                    case "select_playbook":
                        _selectedPlaybookId = GetStr(root, "playbookId");
                        PushOverviewStateToWebView();
                        break;

                    case "set_playbook_platform":
                        _playbookPlatformFilter = GetStr(root, "platform", "all");
                        PushOverviewStateToWebView();
                        break;

                    case "rate_playbook":
                        {
                            var pbId = GetStr(root, "playbookId");
                            var stars = Math.Clamp(GetInt(root, "stars", 5), 1, 5);
                            try
                            {
                                var updated = await _api.RatePlaybookAsync(pbId, stars);
                                var idx = _playbooks.FindIndex(p => p.Id == updated.Id);
                                if (idx >= 0) _playbooks[idx] = updated;
                                PushOverviewStateToWebView();
                            }
                            catch (Exception ex) { AppendLog($"Lỗi đánh giá kịch bản: {ex.Message}"); }
                            break;
                        }

                    case "run_playbook_batch":
                        {
                            var pbId = GetStr(root, "playbookId");
                            var effectivePbs = _playbooks.Count > 0 ? _playbooks : AutomationPlaybookDto.GetDefaultBuiltinPlaybooks();
                            var activePb = effectivePbs.FirstOrDefault(p => string.Equals(p.Id, pbId, StringComparison.OrdinalIgnoreCase)) ?? effectivePbs.FirstOrDefault();
                            if (activePb == null) break;
                            _selectedPlaybookId = activePb.Id;

                            if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.Syncing or QueuePhase.NightPaused)
                            {
                                MessageBox.Show(this, "Hàng đợi đang chạy dở. Hãy tạm dừng hoặc dừng trước.", "Đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
                                break;
                            }
                            var sel = ResolveSelectedViasFromPayload(root);
                            var targets = sel.Count > 0
                                ? sel.Where(v => CanCurrentUserLaunchVia(v, out _)).ToList()
                                : (_selectedViaIds.Count > 0
                                    ? _vias.Where(v => _selectedViaIds.Contains(v.ViaId) && CanCurrentUserLaunchVia(v, out _)).ToList()
                                    : _vias.Where(v => !v.IsInCooldown && CanCurrentUserLaunchVia(v, out _)).Take(10).ToList());
                            if (targets.Count == 0)
                            {
                                MessageBox.Show(this, "Không có Via hợp lệ để chạy kịch bản.", "Không thể chạy", MessageBoxButton.OK, MessageBoxImage.Information);
                                break;
                            }

                            var targetUrl = activePb.Steps.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.Target) && s.Target.StartsWith("https://", StringComparison.OrdinalIgnoreCase))?.Target ?? "https://www.facebook.com/";
                            var useNaturalKeepAliveForPb =
                                (activePb.Platform.Equals("meta", StringComparison.OrdinalIgnoreCase) || activePb.Platform.Equals("multi", StringComparison.OrdinalIgnoreCase)) &&
                                targetUrl.TrimEnd('/').Equals("https://www.facebook.com", StringComparison.OrdinalIgnoreCase);

                            var directCountPb = targets.Count(v => string.IsNullOrWhiteSpace(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel)));
                            var confirmPb = UiComponents.ShowConfirmActionDialog(
                                this,
                                $"Chạy Kịch bản • {activePb.Title}",
                                $"Chuẩn bị mở lần lượt {targets.Count} Via theo kịch bản [{activePb.Platform.ToUpperInvariant()}] {activePb.Title}.",
                                new (string, string)[]
                                {
                                    ("Số lượng Via:", $"{targets.Count} Via (Direct IP: {directCountPb})"),
                                    ("Giãn cách Jitter:", $"{activePb.DefaultStaggerSec}s ± {activePb.JitterPct}%"),
                                    ("IP Cluster Guard:", $"Proxy: {_config.MaxViasPerProxyInBatch}/IP · Direct IP: tối đa {_config.MaxDirectIpViasInBatch} Via/ca"),
                                },
                                directCountPb > _config.MaxDirectIpViasInBatch
                                    ? $"CẢNH BÁO: Có {directCountPb} Via đang chạy Direct IP (Mạng gốc). Hệ thống sẽ chỉ chạy tối đa {_config.MaxDirectIpViasInBatch} Via Direct IP mỗi ca để chống liên đới."
                                    : "Có thể Tạm dừng hoặc Dừng hẳn hàng đợi bất cứ lúc nào.",
                                "Bắt đầu Chạy Lô");
                            if (!confirmPb) break;

                            var qTasks = targets.Select(v =>
                            {
                                var taskUrl = targetUrl;
                                var taskTitle = $"{activePb.Platform.ToUpperInvariant()}: {activePb.Title}";
                                if (useNaturalKeepAliveForPb)
                                {
                                    var built = BuildKeepAliveLaunchUrlForVia(v, crossPageUrl: null, fastTest: false);
                                    taskUrl = built.LaunchUrl;
                                    taskTitle = $"{activePb.Platform.ToUpperInvariant()}: {built.TaskSummary}";
                                }
                                return new QueueTaskItem(
                                    v.ViaId, v.Label, GetEffectiveBatchProfileKey(v, v.ProfileDir), v.NetworkLabel,
                                    taskUrl, taskTitle, v.BackendTier, v.ClientGroup, v.IsInSoakQuarantine,
                                    v.CooldownUntilUtc, v.HasSiloConflict, v.SiloConflictDetail);
                            }).ToList();

                            qTasks = QueueResumeStateStore.FilterRemainingItems(QueueKind.KeepAlive, qTasks, out var resumedPbSkip);
                            if (resumedPbSkip > 0) AppendLog($"♻️ Khôi phục Hàng đợi Kịch bản: Bỏ qua {resumedPbSkip} Via đã chạy trước đó, chạy tiếp {qTasks.Count} Via.");

                            _queue.StartQueue(
                                QueueKind.KeepAlive, qTasks, activePb.DefaultStaggerSec, _config.PreCheckProxyBeforeLaunch,
                                _config.MaxViasPerProxyInBatch, _config.AutoKeepAliveStartHour, _config.AutoKeepAliveEndHour,
                                enforceDaytimeWindow: true, enforceSoakQuarantine: _config.EnforceSoakQuarantine,
                                enforceClientSilo: _config.EnforceClientSilo, interleaveByProxy: true,
                                sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
                                maxConcurrentBrowsers: GetEffectiveMaxConcurrentBrowsers(),
                                maxDirectIpVias: _config.MaxDirectIpViasInBatch);
                            try
                            {
                                var updated = await _api.RecordPlaybookRunAsync(activePb.Id, targets.Select(t => t.ViaId), _config.DefaultBrowserEngine, activePb.DefaultStaggerSec, activePb.JitterPct, Environment.MachineName);
                                var idx = _playbooks.FindIndex(p => p.Id == updated.Id);
                                if (idx >= 0) _playbooks[idx] = updated;
                            }
                            catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
                            AppendLog($"📚 Đã khởi chạy kịch bản '{activePb.Title}' cho {qTasks.Count} Via.");
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "run_batch_create_pages":
                        {
                            if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
                            {
                                MessageBox.Show(this, "Hàng đợi khác đang chạy. Vui lòng tạm dừng hoặc dừng trước.", "Đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
                                break;
                            }
                            _batchNicheKey = GetStr(root, "nicheKey", _batchNicheKey);
                            _batchOwnerBmId = GetStr(root, "ownerBmId", _batchOwnerBmId);
                            _batchCount = Math.Clamp(GetInt(root, "count", _batchCount), 1, 20);
                            _batchStaggerSec = Math.Clamp(GetInt(root, "staggerSec", _batchStaggerSec), 30, 600);
                            _batchPrefix = GetStr(root, "prefix", _batchPrefix);
                            _batchCustomNames = GetStr(root, "customNames", _batchCustomNames);
                            _batchAutoSubmit = GetBool(root, "autoSubmit", _batchAutoSubmit);
                            _config.EnablePrePageCreationWarmup = GetBool(root, "enablePrePageCreationWarmup", _config.EnablePrePageCreationWarmup);
                            _config.PrePageCreationWarmupSeconds = Math.Clamp(GetInt(root, "prePageCreationWarmupSeconds", _config.PrePageCreationWarmupSeconds), 10, 90);
                            _config.Save();
                            PageContentNurtureEngine.EnsurePageAssetFolders(_config.PageAssetsDir, _batchNicheKey);

                            var safeVias = _pagesSummary?.QuotaAlertsSummary?.MaxSafeBatchNow ?? _vias.Count;
                            var directIpCount = _vias.Count(v => string.IsNullOrWhiteSpace(v.NetworkLabel));
                            var directIpNote = directIpCount > 0 && directIpCount == _vias.Count
                                ? $"⚠️ Cảnh báo: {directIpCount}/{_vias.Count} Via đang dùng chung Direct IP (Mạng gốc). Nên tạo 1–2 Page/ca hoặc gắn Proxy riêng để tránh bị Meta chặn tạo Trang."
                                : "Các Via hết hạn mức ngày/tuần hoặc đang ngâm 72h sẽ được tự động bỏ qua để bảo vệ Trust tài khoản.";
                            var confirm = UiComponents.ShowConfirmActionDialog(
                                this,
                                "Xác nhận Chạy Hàng đợi Tạo Page An Toàn",
                                $"Sắp gửi lệnh tạo {_batchCount} Fanpage lên Cloud và xếp lịch mở lần lượt qua Chrome Profile thật.",
                                new (string, string)[]
                                {
                                    ("Ngành hàng:", PageNicheTemplates.All.FirstOrDefault(x => x.Key == _batchNicheKey)?.Label ?? _batchNicheKey),
                                    ("Số lượng yêu cầu:", $"{_batchCount} Page (Max SAFE hiện tại: {safeVias})"),
                                    ("Đệm chống chặn tạo:", _config.EnablePrePageCreationWarmup ? $"BẬT — Lướt Newsfeed {_config.PrePageCreationWarmupSeconds}s trước khi vào pages/creation" : "TẮT (Mở thẳng pages/creation)"),
                                    ("Nghỉ giãn cách:", $"~{_batchStaggerSec}s ± 35% Jitter + IP Guard (Tạo Page: tối đa {Math.Clamp(_config.MaxPagesPerProxyInBatch, 1, 20)}/IP • Direct IP: tối đa {_config.MaxDirectIpViasInBatch}/ca)"),
                                    ("Chế độ Extension:", _batchAutoSubmit ? "Tự điền & Tạo Page + sẵn sàng Hồ sơ/Warmup" : "Chỉ điền sẵn biểu mẫu để kiểm tra"),
                                },
                                directIpNote);
                            if (!confirm) break;

                            try
                            {
                                var resp = await _api.ViaBatchCreatePagesAsync(new ViaBatchCreateRequestDto
                                {
                                    Count = _batchCount,
                                    NicheKey = _batchNicheKey,
                                    BrandPrefix = _batchPrefix.Trim(),
                                    CustomNames = _batchCustomNames.Trim(),
                                    OwnerBmId = _batchOwnerBmId,
                                    StaggerSeconds = _batchStaggerSec,
                                    AutoSubmit = _batchAutoSubmit,
                                });
                                AppendLog($"Backend đã cấp {resp.CreatedCount}/{resp.RequestedCount} nhiệm vụ Tạo Page (bỏ qua quota: {resp.SkippedDueToQuota}).");
                                var tasks = resp.BatchItems.Select(b =>
                                {
                                    var mv = _vias.FirstOrDefault(v => string.Equals(v.ViaId, b.ViaId, StringComparison.OrdinalIgnoreCase));
                                    var rawCreateUrl = string.IsNullOrWhiteSpace(b.LaunchUrl) ? "https://www.facebook.com/pages/creation" : b.LaunchUrl;
                                    var wrappedUrl = WrapWithPrePageCreationWarmupIfEnabled(rawCreateUrl);
                                    return (
                                        ReadinessScore: (mv != null && !mv.IsInSoakQuarantine ? 10 : 0)
                                                      + (mv != null && !string.IsNullOrWhiteSpace(mv.NetworkLabel) ? 5 : 0)
                                                      + (mv != null && !string.IsNullOrWhiteSpace(mv.TwoFaSecret) ? 2 : 0),
                                        Item: new QueueTaskItem(
                                            b.ViaId, b.ViaLabel, GetEffectiveBatchProfileKey(mv, b.BrowserProfile), b.NetworkLabel,
                                            wrappedUrl,
                                            $"Tạo Page: {b.PageName}", "standard_via", mv?.ClientGroup ?? "",
                                            mv?.IsInSoakQuarantine ?? false, mv?.CooldownUntilUtc, mv?.HasSiloConflict ?? false, mv?.SiloConflictDetail ?? "")
                                    );
                                })
                                .OrderByDescending(x => x.ReadinessScore)
                                .Select(x => x.Item)
                                .ToList();
                                if (tasks.Count == 0)
                                {
                                    MessageBox.Show(this, resp.QuotaWarningMessage ?? "Không có Via nào còn Quota hợp lệ lúc này.", "Hết Quota an toàn", MessageBoxButton.OK, MessageBoxImage.Warning);
                                    break;
                                }
                                _queue.StartQueue(
                                    QueueKind.PageCreation, tasks, _batchStaggerSec, _config.PreCheckProxyBeforeLaunch,
                                    Math.Clamp(_config.MaxPagesPerProxyInBatch, 1, 20), _config.AutoKeepAliveStartHour, _config.AutoKeepAliveEndHour,
                                    enforceDaytimeWindow: true, enforceSoakQuarantine: _config.EnforceSoakQuarantine,
                                    enforceClientSilo: _config.EnforceClientSilo, interleaveByProxy: true,
                                    sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
                                    maxConcurrentBrowsers: GetEffectiveMaxConcurrentBrowsers(),
                                    maxDirectIpVias: _config.MaxDirectIpViasInBatch);
                                PushOverviewStateToWebView();
                            }
                            catch (Exception ex)
                            {
                                AppendLog($"Lỗi khởi tạo Tạo Page hàng loạt: {ex.Message}");
                                MessageBox.Show(this, ex.Message, "Lỗi Tạo Page hàng loạt", MessageBoxButton.OK, MessageBoxImage.Error);
                            }
                            break;
                        }

                    case "save_local_guard_config":
                        _config.AutoKeepAliveScheduler = GetBool(root, "autoKeepAliveScheduler", _config.AutoKeepAliveScheduler);
                        _config.AutoDailyFullPipeline = GetBool(root, "autoDailyFullPipeline", _config.AutoDailyFullPipeline);
                        _config.AutoInvitePageFollowersOnWarmup = GetBool(root, "autoInvitePageFollowersOnWarmup", _config.AutoInvitePageFollowersOnWarmup);
                        _config.AutoDailyVaultBackup = GetBool(root, "autoDailyVaultBackup", _config.AutoDailyVaultBackup);
                        _config.AutoPilotScheduleTimesCsv = GetStr(root, "autoPilotScheduleTimesCsv", _config.AutoPilotScheduleTimesCsv).Trim();
                        _config.PreCheckProxyBeforeLaunch = GetBool(root, "preCheckProxyBeforeLaunch", _config.PreCheckProxyBeforeLaunch);
                        _config.AutoCloseKeepAliveTab = GetBool(root, "autoCloseKeepAliveTab", _config.AutoCloseKeepAliveTab);
                        _config.AutoCloseKeepAliveWindow = GetBool(root, "autoCloseKeepAliveWindow", _config.AutoCloseKeepAliveWindow);
                        _config.AutoKeepAliveStartHour = Math.Clamp(GetInt(root, "autoKeepAliveStartHour", _config.AutoKeepAliveStartHour), 0, 22);
                        _config.AutoKeepAliveEndHour = Math.Clamp(GetInt(root, "autoKeepAliveEndHour", _config.AutoKeepAliveEndHour), 1, 23);
                        _config.MaxViasPerProxyInBatch = Math.Clamp(GetInt(root, "maxViasPerProxyInBatch", _config.MaxViasPerProxyInBatch), 1, 50);
                        _config.MaxDirectIpViasInBatch = Math.Clamp(GetInt(root, "maxDirectIpViasInBatch", _config.MaxDirectIpViasInBatch), 1, 20);
                        _config.Save();
                        _webUiConfigRev++;
                        ApplyUpdatedProxyClusterLimits();
                        AppendLog($"Đã lưu Luật Bảo vệ & Lịch Hẹn Giờ Auto-Pilot ({_config.AutoPilotScheduleTimesCsv}).");
                        PushOverviewStateToWebView();
                        break;

                    case "open_auto_backup_folder":
                        _ = RunDailyAutoVaultBackupIfNeeded(force: true);
                        Directory.CreateDirectory(VaultBackupService.AutoBackupsFolder);
                        try { Process.Start(new ProcessStartInfo("explorer.exe", VaultBackupService.AutoBackupsFolder) { UseShellExecute = true }); } catch { }
                        break;

                    case "save_anti_checkpoint_shield":
                        _config.EnforceSoakQuarantine = GetBool(root, "enforceSoakQuarantine", _config.EnforceSoakQuarantine);
                        _config.EnforceClientSilo = GetBool(root, "enforceClientSilo", _config.EnforceClientSilo);
                        _config.IpLeakKillSwitchEnabled = GetBool(root, "ipLeakKillSwitchEnabled", _config.IpLeakKillSwitchEnabled);
                        _config.AutoRefreshCookieAfterKeepAlive = GetBool(root, "autoRefreshCookieAfterKeepAlive", _config.AutoRefreshCookieAfterKeepAlive);
                        _config.DefaultWarmupMode = ViaMetadataParser.NormalizeWarmupMode(GetStr(root, "defaultWarmupMode", _config.DefaultWarmupMode));
                        _config.SoakQuarantineHours = Math.Clamp(GetInt(root, "soakQuarantineHours", _config.SoakQuarantineHours), 12, 336);
                        _config.AutoCooldownHours = Math.Clamp(GetInt(root, "autoCooldownHours", _config.AutoCooldownHours), 1, 168);
                        _config.Save();
                        _webUiConfigRev++;
                        var provisionedShield = ProvisionAllViaExtensions(silent: true);
                        AppendLog($"Đã lưu Khiên Chống Checkpoint v{DesktopAppInfo.Version} và cập nhật {provisionedShield} Extension.");
                        PushOverviewStateToWebView();
                        break;

                    case "enable_isolated_profiles_now":
                        _config.UseIsolatedProfiles = true;
                        _config.Save();
                        _webUiConfigRev++;
                        AppendLog("🔒 Đã bật chế độ Chrome Cô lập (--user-data-dir) để chạy song song không bị gộp tab.");
                        PushOverviewStateToWebView();
                        break;

                    case "close_browser_session":
                        {
                            var sid = GetStr(root, "sessionId").Trim();
                            if (!string.IsNullOrEmpty(sid))
                            {
                                ChromeSessionTracker.Default.TryCloseSession(sid, out var msg);
                                AppendLog(msg);
                                PushLiveTickToWebView();
                            }
                            break;
                        }

                    case "save_cloud_cron":
                        try
                        {
                            var autoSync = GetBool(root, "autoMetaSync", false);
                            var syncMin = Math.Clamp(GetInt(root, "syncIntervalMinutes", 60), 10, 1440);
                            var autoWarm = GetBool(root, "autoPageWarmup", false);
                            var warmGap = Math.Clamp(GetInt(root, "warmupMinGapHours", 8), 1, 72);
                            _cronStatus = await _api.SaveAutomationCronConfigAsync(autoSync, syncMin, autoWarm, warmGap);
                            _webUiConfigRev++;
                            AppendLog("Đã lưu cấu hình Cloud Cron.");
                            PushOverviewStateToWebView();
                        }
                        catch (Exception ex) { AppendLog($"Lỗi lưu Cloud Cron: {ex.Message}"); }
                        break;

                    case "run_cloud_cron_now":
                        try
                        {
                            await _api.RunAutomationCronNowAsync();
                            AppendLog("Đã kích hoạt Cloud Cron chạy ngay (Sync + Warmup).");
                            await SyncCloudAsync(silent: false);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi chạy Cloud Cron: {ex.Message}"); }
                        break;

                    // ===== TAB 4: FANPAGE & BM =====
                    case "open_create_bm":
                        OpenCreateBusinessManagerDialog();
                        break;

                    case "open_bm_settings":
                        {
                            var bmId = GetStr(root, "bmId");
                            var bm = _bms.FirstOrDefault(b => string.Equals(b.Id, bmId, StringComparison.OrdinalIgnoreCase));
                            var holdVia = _vias.FirstOrDefault(v => v.RoleTier is "vault" or "hold") ?? _vias.FirstOrDefault();
                            if (holdVia != null)
                            {
                                var url = string.IsNullOrWhiteSpace(bm?.ExternalId)
                                    ? "https://business.facebook.com/settings"
                                    : $"https://business.facebook.com/settings/pages?business_id={Uri.EscapeDataString(bm!.ExternalId!)}";
                                LaunchViaChromeSafe(holdVia, url);
                            }
                            break;
                        }

                    case "open_create_pixel":
                        OpenCreatePixelDialog();
                        break;

                    case "copy_text":
                        {
                            var txt = GetStr(root, "text");
                            var lbl = GetStr(root, "label", "nội dung");
                            if (!string.IsNullOrWhiteSpace(txt))
                            {
                                Clipboard.SetText(txt);
                                AppendLog($"Đã chép {lbl}: {txt}");
                            }
                            break;
                        }

                    case "save_domain_seo":
                        try
                        {
                            SetBusy(true);
                            _domainSeoConfig = await _api.SaveDomainSeoConfigAsync(GetStr(root, "customDomain"));
                            _webUiConfigRev++;
                            AppendLog($"Đã lưu cấu hình Domain/SEO: {_domainSeoConfig.EffectivePublicUrl}");
                            PushOverviewStateToWebView();
                        }
                        catch (Exception ex) { AppendLog($"Lỗi lưu Domain SEO (chỉ Owner/Admin): {ex.Message}"); }
                        finally { SetBusy(false); }
                        break;

                    case "export_pages_csv":
                        ExportPagesCsv();
                        break;

                    case "batch_warmup_pages":
                        {
                            var ok = UiComponents.ShowConfirmActionDialog(
                                this, "Nuôi lô tối đa 10 Fanpage",
                                "Đăng bài nuôi tự nhiên qua Graph API / Assist cho tối đa 10 Page đến hạn.",
                                new (string, string)[] { ("Phạm vi:", "Tối đa 10 Page"), ("Hình thức:", "Bài viết an toàn theo ngách") },
                                "Hệ thống tự tuân thủ khoảng cách thời gian giữa các bài đăng.");
                            if (!ok) break;
                            try
                            {
                                var r = await _api.BatchWarmupPagesAsync(10);
                                AppendLog($"Nuôi lô Fanpage: {r.NurturedCount} Page (Graph: {r.GraphPublishedCount}).");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi nuôi lô Page: {ex.Message}"); }
                            break;
                        }

                    case "save_page_nurture_config":
                        {
                            var mode = GetStr(root, "mode", _config.PageNurtureMode).ToLowerInvariant();
                            _config.PageNurtureMode = mode is "post" or "share" or "alternate" ? mode : "alternate";
                            _config.PageAssetsDir = GetStr(root, "assetsDir", _config.PageAssetsDir).Trim();
                            _config.EnableImageHashJitter = GetBool(root, "enableImageHashJitter", _config.EnableImageHashJitter);
                            _config.PageShareSourceUrls = GetStr(root, "shareSourceUrls", _config.PageShareSourceUrls).Trim();
                            var spin = GetStr(root, "captionSpintax", _config.PageCaptionSpintax).Trim();
                            _config.PageCaptionSpintax = string.IsNullOrWhiteSpace(spin) ? PageContentNurtureEngine.DefaultCaptionSpintax : spin;
                            _config.Save();
                            PageContentNurtureEngine.EnsurePageAssetFolders(_config.PageAssetsDir, _batchNicheKey);
                            _webUiConfigRev++;
                            AppendLog($"✅ Đã lưu cấu hình Trung tâm Đăng bài & Chia sẻ Nuôi Page (Chế độ: {_config.PageNurtureMode}).");
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "open_page_assets_dir":
                        {
                            var niche = GetStr(root, "nicheKey", _batchNicheKey);
                            var dir = PageContentNurtureEngine.EnsurePageAssetFolders(_config.PageAssetsDir, niche);
                            try { Process.Start(new ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true }); }
                            catch (Exception ex) { AppendLog($"Không mở được thư mục ảnh: {ex.Message}"); }
                            break;
                        }

                    case "open_page_setup_assets":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            var niche = pg != null ? PageContentNurtureEngine.SanitizeFolderSegment(pg.Category) : _batchNicheKey;
                            var dir = PageContentNurtureEngine.EnsurePageAssetFolders(_config.PageAssetsDir, niche);
                            try { Process.Start(new ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true }); }
                            catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
                            if (pg != null)
                            {
                                var via = ResolveEffectiveViaForPage(pg);
                                var url = !string.IsNullOrWhiteSpace(pg.Url) ? pg.Url!
                                    : !string.IsNullOrWhiteSpace(pg.ExternalPageId) ? $"https://www.facebook.com/{pg.ExternalPageId}"
                                    : "https://www.facebook.com/pages";
                                if (via != null) LaunchViaChromeSafe(via, url);
                                AppendLog($"🎨 Đã mở thư mục Avatar/Cover/Posts ({niche}) & mở Page '{pg.Name}' để hoàn thiện hồ sơ.");
                            }
                            break;
                        }

                    case "page_nurture_single_post":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null)
                            {
                                await RunPageNurtureSingleAsync(pg, "post", GetBool(root, "viaBrowser", true));
                            }
                            break;
                        }

                    case "page_nurture_single_share":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null)
                            {
                                await RunPageNurtureSingleAsync(pg, "share", GetBool(root, "viaBrowser", true));
                            }
                            break;
                        }

                    case "page_nurture_batch_run":
                        {
                            var mode = GetStr(root, "mode", _config.PageNurtureMode).ToLowerInvariant();
                            var viaBrowser = GetBool(root, "viaBrowser", true);
                            StartPageNurtureBatchQueue(mode, viaBrowser);
                            break;
                        }

                    case "set_page_holder":
                        {
                            var pid = GetStr(root, "pageId");
                            var tag = GetStr(root, "holderTag");
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, pid, StringComparison.OrdinalIgnoreCase));
                            if (pg != null && !string.IsNullOrWhiteSpace(tag))
                            {
                                AssignViaOrProfileToPage(pg, tag);
                                PushOverviewStateToWebView();
                            }
                            break;
                        }

                    case "open_warmup_post_dialog":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null) OpenWarmupPostDialog(pg);
                            break;
                        }

                    case "open_page_browser":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null)
                            {
                                var via = ResolveEffectiveViaForPage(pg);
                                var url = !string.IsNullOrWhiteSpace(pg.Url) ? pg.Url!
                                    : !string.IsNullOrWhiteSpace(pg.ExternalPageId) ? $"https://www.facebook.com/{pg.ExternalPageId}"
                                    : "https://www.facebook.com/pages";
                                if (via != null) LaunchViaChromeSafe(via, url);
                            }
                            break;
                        }

                    case "scan_mbs_invite_now":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null)
                            {
                                AppendLog($"🤖 Đang quét cửa sổ Chrome Meta Business Suite cho Page '{pg.Name}' và tự động bấm 'Gửi lời mời'...");
                                await RunNativeUiAutoInviteForPageAsync(pg, _config.MaxPageFollowerInvitesPerRun);
                            }
                            break;
                        }

                    case "open_claim_bm_dialog":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg != null) OpenClaimBmDialog(pg);
                            break;
                        }

                    case "check_page_live":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg == null) break;
                            try
                            {
                                await _api.CheckPageLiveAsync(pg.Id);
                                AppendLog($"Đã kiểm tra Live cho Page '{pg.Name}'.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi Check Live Page: {ex.Message}"); }
                            break;
                        }

                    case "discard_page_draft":
                        {
                            var pg = (_pagesSummary?.Items ?? new()).FirstOrDefault(p => string.Equals(p.Id, GetStr(root, "pageId"), StringComparison.OrdinalIgnoreCase));
                            if (pg == null) break;
                            var ok = UiComponents.ShowConfirmActionDialog(
                                this, "Xóa Nháp Fanpage", $"Xóa bản nháp '{pg.Name}' chưa khớp ID Facebook?",
                                new (string, string)[] { ("Page:", pg.Name) }, "Thao tác xóa vĩnh viễn bản nháp trên Cloud.", "Xóa Nháp", isDanger: true);
                            if (!ok) break;
                            try
                            {
                                await _api.DiscardPageDraftAsync(pg.Id);
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi xóa nháp: {ex.Message}"); }
                            break;
                        }

                    // ===== TAB 5: AD ACCOUNTS =====
                    case "export_ad_accounts_csv":
                        ExportAdAccountsCsv();
                        break;

                    case "quick_sync_meta":
                        try
                        {
                            SetBusy(true);
                            var r = await _api.QuickSyncMetaAsync();
                            AppendLog($"Quick Sync Meta: {r.Message ?? "Hoàn tất"}");
                            await SyncCloudAsync(silent: false);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi Quick Sync Meta: {ex.Message}"); }
                        finally { SetBusy(false); }
                        break;

                    case "refresh_ad_spend":
                        {
                            var accId = GetStr(root, "accountId");
                            var acc = _adAccounts.FirstOrDefault(a => string.Equals(a.Id, accId, StringComparison.OrdinalIgnoreCase));
                            if (acc == null) break;
                            try
                            {
                                await _api.RefreshAdAccountSpendAsync(acc.Id);
                                AppendLog($"Đã làm mới Chi tiêu TKQC '{acc.DisplayName}' (act_{acc.ExternalAccountId}).");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi làm mới Chi tiêu TKQC: {ex.Message}"); }
                            break;
                        }

                    case "open_ads_manager":
                        {
                            var accId = GetStr(root, "accountId");
                            var extId = GetStr(root, "externalAccountId");
                            var viaHint = GetStr(root, "viaHint");
                            var acc = !string.IsNullOrWhiteSpace(accId)
                                ? _adAccounts.FirstOrDefault(a => string.Equals(a.Id, accId, StringComparison.OrdinalIgnoreCase))
                                : null;
                            if (acc != null)
                            {
                                var via = ResolveEffectiveViaForAdAccount(acc);
                                if (via == null)
                                {
                                    MessageBox.Show(this, "Chưa có Via nào trong hệ thống để mở Chrome.", "Thiếu Via", MessageBoxButton.OK, MessageBoxImage.Information);
                                }
                                else
                                {
                                    var cleanId = (acc.ExternalAccountId ?? "").Replace("act_", "", StringComparison.OrdinalIgnoreCase);
                                    LaunchViaChromeSafe(via, $"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act={Uri.EscapeDataString(cleanId)}");
                                }
                            }
                            else if (!string.IsNullOrWhiteSpace(extId))
                            {
                                LaunchAdsManagerByExternalId(extId, preferredViaLabel: string.IsNullOrWhiteSpace(viaHint) ? null : viaHint);
                            }
                            break;
                        }

                    // ===== TAB 6: HEALTH & TOKENS =====
                    case "check_meta_token":
                        {
                            var cid = GetStr(root, "connectionId");
                            var c = _metaConnections.FirstOrDefault(x => string.Equals(x.Id, cid, StringComparison.OrdinalIgnoreCase));
                            if (c == null) break;
                            try
                            {
                                var updated = await _api.CheckMetaConnectionCapabilityAsync(c.Id);
                                AppendLog($"Đã kiểm tra Token '{c.Label}': trạng thái = {updated.Status}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi kiểm tra Token '{c.Label}': {ex.Message}"); }
                            break;
                        }

                    case "export_health_csv":
                        ExportHealthCsv();
                        break;

                    case "open_health_signals":
                        {
                            var row = _accountHealthRows.FirstOrDefault(r => string.Equals(r.AdAccountId, GetStr(root, "adAccountId"), StringComparison.OrdinalIgnoreCase));
                            if (row != null) OpenHealthSignalsDialog(row);
                            break;
                        }

                    case "recalc_account_health":
                        {
                            var row = _accountHealthRows.FirstOrDefault(r => string.Equals(r.AdAccountId, GetStr(root, "adAccountId"), StringComparison.OrdinalIgnoreCase));
                            if (row == null) break;
                            try
                            {
                                SetBusy(true);
                                await _api.RecalculateAccountHealthAsync(row.AdAccountId);
                                AppendLog($"Đã tính lại điểm sức khỏe cho TKQC act_{row.ExternalAccountId}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi tính lại sức khỏe: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "evaluate_campaign_draft":
                        {
                            var d = _campaignDrafts.FirstOrDefault(x => string.Equals(x.Id, GetStr(root, "draftId"), StringComparison.OrdinalIgnoreCase));
                            if (d == null) break;
                            try
                            {
                                await _api.EvaluateCampaignDraftAsync(d.Id);
                                AppendLog($"Đã chấm điểm Pre-flight cho chiến dịch '{d.Title}'.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi chấm điểm Pre-flight: {ex.Message}"); }
                            break;
                        }

                    case "recalc_account_readiness":
                        {
                            var adAccId = GetStr(root, "adAccountId");
                            var extId = GetStr(root, "externalAccountId");
                            if (string.IsNullOrWhiteSpace(adAccId)) break;
                            try
                            {
                                SetBusy(true);
                                await _api.RecalculateAccountReadinessAsync(adAccId);
                                AppendLog($"Đã tính lại Readiness cho act_{extId}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi tính lại Readiness: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "export_audit_csv":
                        ExportAuditLogsCsv();
                        break;

                    // ===== TAB 7: WORKSPACE OPS (RETAINERS & TEAM) =====
                    case "export_retainers_csv":
                        ExportRetainersCsv();
                        break;

                    case "open_retainer_dialog":
                        {
                            var rid = GetStr(root, "retainerId");
                            var existing = string.IsNullOrWhiteSpace(rid)
                                ? null
                                : _retainersOverview?.Items.FirstOrDefault(x => string.Equals(x.Id, rid, StringComparison.OrdinalIgnoreCase));
                            OpenClientRetainerDialog(existing);
                            break;
                        }

                    case "delete_retainer":
                        {
                            var rid = GetStr(root, "retainerId");
                            var c = _retainersOverview?.Items.FirstOrDefault(x => string.Equals(x.Id, rid, StringComparison.OrdinalIgnoreCase));
                            if (c == null) break;
                            var ok = UiComponents.ShowConfirmActionDialog(
                                this, "Xóa Hợp đồng Retainer", $"Xác nhận xóa hợp đồng '{c.ContractCode} - {c.ClientName}'?",
                                new (string, string)[] { ("Mã HĐ:", c.ContractCode), ("Khách hàng:", c.ClientName) },
                                "Hành động này sẽ lưu dấu xóa vào Audit Log Workspace.", "Xóa Hợp đồng", isDanger: true);
                            if (!ok) break;
                            try
                            {
                                SetBusy(true);
                                _retainersOverview = await _api.DeleteClientRetainerAsync(c.Id);
                                AppendLog($"Đã xóa Hợp đồng Retainer {c.ContractCode}.");
                                RefreshHeaderAndSidebar();
                                PushOverviewStateToWebView();
                            }
                            catch (Exception ex) { AppendLog($"Lỗi xóa Hợp đồng: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "open_invite_member":
                        OpenInviteTeamMemberDialog();
                        break;

                    case "change_member_role":
                        {
                            var mid = GetStr(root, "memberId");
                            var nextRole = GetStr(root, "nextRole", "operator");
                            var m = _teamMembers.FirstOrDefault(x => string.Equals(x.Id, mid, StringComparison.OrdinalIgnoreCase));
                            if (m == null) break;
                            try
                            {
                                SetBusy(true);
                                await _api.ChangeTeamMemberRoleAsync(m.Id, nextRole);
                                AppendLog($"Đã đổi quyền {m.Email} thành {nextRole}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi đổi quyền: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "toggle_member_suspend":
                        {
                            var mid = GetStr(root, "memberId");
                            var m = _teamMembers.FirstOrDefault(x => string.Equals(x.Id, mid, StringComparison.OrdinalIgnoreCase));
                            if (m == null) break;
                            var isSusp = string.Equals(m.Status, "suspended", StringComparison.OrdinalIgnoreCase);
                            try
                            {
                                SetBusy(true);
                                if (isSusp) await _api.UnsuspendTeamMemberAsync(m.Id);
                                else await _api.SuspendTeamMemberAsync(m.Id, "Tạm khóa từ AdsOps Desktop Pro");
                                AppendLog($"Đã {(isSusp ? "mở khóa" : "tạm khóa")} thành viên {m.Email}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi cập nhật trạng thái thành viên: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "resend_invitation":
                        {
                            var iid = GetStr(root, "invitationId");
                            var inv = _teamInvitations.FirstOrDefault(x => string.Equals(x.Id, iid, StringComparison.OrdinalIgnoreCase));
                            if (inv == null) break;
                            try
                            {
                                SetBusy(true);
                                var res = await _api.ResendTeamInvitationAsync(inv.Id);
                                await SyncCloudAsync(silent: true);
                                ShowInviteTokenPopupDialog(inv.EmailNormalized, res.InviteLinkToken);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi gửi lại lời mời: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "revoke_invitation":
                        {
                            var iid = GetStr(root, "invitationId");
                            var inv = _teamInvitations.FirstOrDefault(x => string.Equals(x.Id, iid, StringComparison.OrdinalIgnoreCase));
                            if (inv == null) break;
                            try
                            {
                                SetBusy(true);
                                await _api.RevokeTeamInvitationAsync(inv.Id, "Thu hồi từ AdsOps Desktop Pro");
                                AppendLog($"Đã thu hồi lời mời {inv.EmailNormalized}.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi thu hồi lời mời: {ex.Message}"); }
                            finally { SetBusy(false); }
                            break;
                        }

                    // ===== TAB 8: SETTINGS & DPAPI VAULT =====
                    case "cloud_login":
                        {
                            var url = GetStr(root, "backendUrl", _config.BackendBaseUrl).Trim().TrimEnd('/');
                            var email = GetStr(root, "email").Trim();
                            var pass = GetStr(root, "password");
                            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(pass))
                            {
                                _authErrorMessage = "Vui lòng nhập đầy đủ Email và Mật khẩu.";
                                _authSuccessMessage = "";
                                PushOverviewStateToWebView();
                                break;
                            }
                            SetBusy(true);
                            _authErrorMessage = "";
                            _authSuccessMessage = "";
                            PushOverviewStateToWebView();
                            try
                            {
                                _config.BackendBaseUrl = string.IsNullOrWhiteSpace(url) ? DesktopConfig.DefaultBackendUrl : url;
                                _config.UserEmail = email;
                                _api.Configure(_config.BackendBaseUrl, "");
                                var loginRes = await _api.LoginAsync(_config.UserEmail, pass);
                                _config.SetJwt(loginRes.AccessToken);
                                _config.SetSavedPassword(pass);
                                _config.Save();
                                ConfigureApiClient();
                                _isAuthExpired = false;
                                _webUiConfigRev++;
                                _authSuccessMessage = $"Đăng nhập Cloud thành công với '{_config.UserEmail}' (DPAPI 24/7).";
                                AppendLog($"Đăng nhập Cloud thành công với '{_config.UserEmail}' (JWT & Tự gia hạn phiên được mã hóa Windows DPAPI).");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex)
                            {
                                _authErrorMessage = $"Đăng nhập thất bại: {ex.Message}";
                                PushOverviewStateToWebView();
                            }
                            finally { SetBusy(false); }
                            break;
                        }

                    case "cloud_logout":
                        {
                            var ok = UiComponents.ShowConfirmActionDialog(
                                this, "Xác nhận Đăng xuất Cloud", $"Đăng xuất tài khoản '{_config.UserEmail}' khỏi máy tính này?",
                                new (string, string)[] { ("Phiên Cloud:", "Xóa token JWT đã mã hóa"), ("Két DPAPI Local:", "GIỮ NGUYÊN an toàn 100%") },
                                "Cookie và Secret 2FA lưu cục bộ trong két DPAPI vẫn được giữ nguyên.", "Đăng xuất", isDanger: true);
                            if (!ok) break;
                            _config.SetJwt("");
                            _config.SetSavedPassword("");
                            _config.Save();
                            ConfigureApiClient();
                            _isAuthExpired = false;
                            _currentUser = null;
                            _vias.Clear();
                            _bms.Clear();
                            _adAccounts.Clear();
                            _pagesSummary = null;
                            _alerts.Clear();
                            _telegramConfig = null;
                            _spendSummary = null;
                            _deviceSessions.Clear();
                            _proxyHealthMap.Clear();
                            _readinessSummary = null;
                            _readinessBoard = null;
                            _auditLogs.Clear();
                            _pixels.Clear();
                            _domainSeoConfig = null;
                            _retainersOverview = null;
                            _teamSummary = null;
                            _teamMembers.Clear();
                            _teamInvitations.Clear();
                            _communityQuota = null;
                            _isOfflineSnapshotMode = false;
                            _hasLoadedOnce = false;
                            _authErrorMessage = "";
                            _authSuccessMessage = "";
                            _webUiConfigRev++;
                            RefreshHeaderAndSidebar();
                            RenderCurrentView();
                            break;
                        }

                    case "redeem_community_code":
                        {
                            var code = GetStr(root, "code").Trim();
                            if (string.IsNullOrEmpty(code)) break;
                            try
                            {
                                _communityQuota = await _api.RedeemCommunityCodeAsync(code);
                                AppendLog($"Đã kích hoạt Mã Cộng Đồng '{code.ToUpperInvariant()}' -> Gói {_communityQuota.PlanTier.ToUpperInvariant()} ({_communityQuota.MaxVias} Via).");
                                PushOverviewStateToWebView();
                            }
                            catch (Exception ex) { MessageBox.Show(this, ex.Message, "Không nạp được Mã Mời", MessageBoxButton.OK, MessageBoxImage.Warning); }
                            break;
                        }

                    case "set_isolated_profiles":
                        _config.UseIsolatedProfiles = GetBool(root, "enabled", true);
                        _config.Save();
                        _webUiConfigRev++;
                        PushOverviewStateToWebView();
                        break;

                    case "register_uri_protocol":
                        ProtocolRegistrar.RegisterUriProtocol();
                        AppendLog("Đã đăng ký giao thức adsops-chrome:// vào HKCU Registry.");
                        PushOverviewStateToWebView();
                        break;

                    case "toggle_autostart":
                        {
                            var cur = ProtocolRegistrar.IsAutoStartEnabled();
                            ProtocolRegistrar.SetAutoStart(!cur);
                            AppendLog(!cur ? "Đã bật Tự động chạy ẩn cùng Windows (--minimized)." : "Đã tắt Tự động chạy cùng Windows.");
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "open_appdata_folder":
                        Directory.CreateDirectory(DesktopConfig.AppDataRoot);
                        Process.Start(new ProcessStartInfo { FileName = DesktopConfig.AppDataRoot, UseShellExecute = true });
                        break;

                    case "copy_bridge_token":
                        Clipboard.SetText(_config.GetOrCreateBridgeToken());
                        AppendLog("Đã sao chép X-AdsOps-Bridge-Token (DPAPI) vào Clipboard.");
                        MessageBox.Show(this, "Đã sao chép Mã Bridge Token vào Clipboard. Nếu cài Extension thủ công trên Web, dán mã này vào ô Bridge Token trong Popup Extension.", "Đã sao chép", MessageBoxButton.OK, MessageBoxImage.Information);
                        break;

                    case "rotate_bridge_token":
                        {
                            var fresh = _config.RotateBridgeToken();
                            var count = ProvisionAllViaExtensions(silent: false);
                            AppendLog($"🔐 Đã xoay vòng X-AdsOps-Bridge-Token mới ({fresh[..8]}...) và cấp lại {count} Extension v{DesktopAppInfo.ExtVersion}.");
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "save_antidetect_config":
                        {
                            _config.DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(GetStr(root, "defaultBrowserEngine", _config.DefaultBrowserEngine));
                            _config.AntidetectApiBaseUrl = GetStr(root, "antidetectApiBaseUrl").Trim().TrimEnd('/');
                            var apiKey = GetStr(root, "antidetectApiKey").Trim();
                            if (!string.IsNullOrEmpty(apiKey)) _config.AntidetectApiKey = apiKey;
                            _config.MaxConcurrentBrowsers = Math.Clamp(GetInt(root, "maxConcurrentBrowsers", _config.MaxConcurrentBrowsers), 1, 30);
                            _config.EnableChromeAntidetectShield = GetBool(root, "enableChromeAntidetectShield", _config.EnableChromeAntidetectShield);
                            _config.LowRamFarmMode = GetBool(root, "lowRamFarmMode", _config.LowRamFarmMode);
                            _config.AutoScaleConcurrentByRam = GetBool(root, "autoScaleConcurrentByRam", _config.AutoScaleConcurrentByRam);
                            _config.AutoFailoverToChromeNative = GetBool(root, "autoFailoverToChromeNative", _config.AutoFailoverToChromeNative);
                            _config.Save();
                            _webUiConfigRev++;
                            _antidetectStatusMessage = $"Đã lưu Engine: {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)} · Giới hạn RAM: {_config.MaxConcurrentBrowsers} trình duyệt.";
                            AppendLog(_antidetectStatusMessage);
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "scan_antidetect_profiles":
                        {
                            _config.DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(GetStr(root, "defaultBrowserEngine", _config.DefaultBrowserEngine));
                            _config.AntidetectApiBaseUrl = GetStr(root, "antidetectApiBaseUrl").Trim().TrimEnd('/');
                            var apiKey = GetStr(root, "antidetectApiKey").Trim();
                            if (!string.IsNullOrEmpty(apiKey)) _config.AntidetectApiKey = apiKey;
                            _config.Save();
                            var probe = await AntidetectBrowserConnector.ProbeEngineAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
                            _antidetectProfiles = probe.Online
                                ? await AntidetectBrowserConnector.ListProfilesAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey)
                                : new List<AntidetectProfileSummary>();
                            _antidetectStatusMessage = probe.Online
                                ? $"✓ {probe.Message} Quét được {_antidetectProfiles.Count} Profile sẵn sàng ghép Via."
                                : $"⚠ {probe.Message}";
                            AppendLog(_antidetectStatusMessage);
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "auto_match_antidetect":
                        {
                            _config.DefaultBrowserEngine = AntidetectBrowserConnector.NormalizeEngine(GetStr(root, "defaultBrowserEngine", _config.DefaultBrowserEngine));
                            _config.AntidetectApiBaseUrl = GetStr(root, "antidetectApiBaseUrl").Trim().TrimEnd('/');
                            var apiKey = GetStr(root, "antidetectApiKey").Trim();
                            if (!string.IsNullOrEmpty(apiKey)) _config.AntidetectApiKey = apiKey;
                            _config.Save();

                            var scanned = _antidetectProfiles.Count > 0
                                ? _antidetectProfiles
                                : await AntidetectBrowserConnector.ListProfilesAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
                            if (scanned.Count == 0)
                            {
                                MessageBox.Show(this, $"Chưa quét được Profile nào từ {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)}.", "Chưa có Profile", MessageBoxButton.OK, MessageBoxImage.Information);
                                break;
                            }
                            int matchedCount = 0;
                            foreach (var v in _vias)
                            {
                                var found = scanned.FirstOrDefault(p => p.Name.Equals(v.Label, StringComparison.OrdinalIgnoreCase))
                                            ?? scanned.FirstOrDefault(p => p.Name.Contains(v.Label, StringComparison.OrdinalIgnoreCase) || v.Label.Contains(p.Name, StringComparison.OrdinalIgnoreCase));
                                if (found != null)
                                {
                                    v.AntidetectEngine = found.Engine;
                                    v.AntidetectProfileId = found.ProfileId;
                                    matchedCount++;
                                    if (!string.IsNullOrWhiteSpace(_config.GetJwt()) && !string.IsNullOrWhiteSpace(v.ViaId))
                                    {
                                        try
                                        {
                                            var notes = ViaMetadataParser.BuildNotes(v.CleanNotes, v.RoleTier, v.WarmupStartIso, v.ClientGroup, v.DefaultWarmupMode, v.AntidetectEngine, v.AntidetectProfileId);
                                            await _api.UpdatePersonalAccountAsync(v.ViaId, new PersonalAccountUpsertRequestDto
                                            {
                                                Label = v.Label, DisplayName = v.DisplayName,
                                                ExternalReferenceId = string.IsNullOrWhiteSpace(v.ExternalReferenceId) ? null : v.ExternalReferenceId,
                                                Status = v.Status, BrowserProfileLabel = v.BrowserProfileLabel, NetworkLabel = v.NetworkLabel,
                                                VaultReference = !string.IsNullOrWhiteSpace(v.TwoFaSecret) ? "Két DPAPI Local (Desktop)" : "",
                                                Notes = notes,
                                            });
                                        }
                                        catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }
                                    }
                                }
                            }
                            ApplyUpdatedProxyClusterLimits();
                            _antidetectStatusMessage = $"⚡ Đã tự động ghép {matchedCount}/{_vias.Count} Via vào {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)}.";
                            AppendLog(_antidetectStatusMessage);
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "save_proxy_cluster_config":
                        _config.MaxViasPerProxyInBatch = Math.Clamp(GetInt(root, "maxViasPerProxyInBatch", _config.MaxViasPerProxyInBatch), 1, 50);
                        _config.MaxPagesPerProxyInBatch = Math.Clamp(GetInt(root, "maxPagesPerProxyInBatch", _config.MaxPagesPerProxyInBatch), 1, 20);
                        _config.SameProxyMinStaggerSeconds = Math.Clamp(GetInt(root, "sameProxyMinStaggerSeconds", _config.SameProxyMinStaggerSeconds), 15, 300);
                        _config.AutoKeepAliveScheduler = GetBool(root, "autoKeepAliveScheduler", _config.AutoKeepAliveScheduler);
                        _config.PreCheckProxyBeforeLaunch = GetBool(root, "preCheckProxyBeforeLaunch", _config.PreCheckProxyBeforeLaunch);
                        _config.ConfigMigrationVersion = DesktopConfig.CurrentMigrationVersion;
                        _config.Save();
                        _webUiConfigRev++;
                        ApplyUpdatedProxyClusterLimits();
                        var provPx = ProvisionAllViaExtensions(silent: true);
                        AppendLog($"Đã lưu Hạn mức Cụm Proxy: {_config.MaxViasPerProxyInBatch} Via/Proxy · Tạo Page {_config.MaxPagesPerProxyInBatch}/IP · Nghỉ trùng IP {_config.SameProxyMinStaggerSeconds}s (cập nhật {provPx} Extension).");
                        PushOverviewStateToWebView();
                        break;

                    case "export_full_vault":
                        ExecuteExportFullVaultBackup();
                        break;

                    case "import_full_vault":
                        ExecuteImportFullVaultBackup();
                        break;

                    case "detect_telegram_chats":
                        {
                            var tok = GetStr(root, "botToken");
                            _telegramStatusOk = true;
                            _telegramStatusMessage = "Đang gọi Telegram getUpdates để tìm nhóm vừa chat với Bot...";
                            PushOverviewStateToWebView();
                            try
                            {
                                var res = await _api.DetectTelegramChatsAsync(tok);
                                _detectedTelegramChats = res.Chats ?? new();
                                if (_detectedTelegramChats.Count == 0)
                                {
                                    _telegramStatusOk = false;
                                    _telegramStatusMessage = string.IsNullOrWhiteSpace(res.Hint) ? "Chưa thấy tin nhắn mới — hãy gõ /start vào nhóm hoặc Bot." : res.Hint;
                                }
                                else
                                {
                                    _telegramStatusOk = true;
                                    _telegramStatusMessage = $"Tìm thấy {_detectedTelegramChats.Count} cuộc trò chuyện. Chọn nhóm từ danh sách và nhấn Lưu.";
                                }
                            }
                            catch (Exception ex)
                            {
                                _telegramStatusOk = false;
                                _telegramStatusMessage = $"Lỗi dò nhóm Telegram: {ex.Message}";
                            }
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "save_telegram_config":
                        {
                            var body = new Dictionary<string, object>
                            {
                                ["enabled"] = GetBool(root, "enabled", true),
                                ["notify_ad_account_disabled"] = GetBool(root, "notifyAdAccountDisabled", true),
                                ["notify_billing_failed"] = GetBool(root, "notifyBillingFailed", true),
                                ["notify_page_restricted"] = GetBool(root, "notifyPageRestricted", true),
                                ["notify_retainer_overspend"] = GetBool(root, "notifyRetainerOverspend", true),
                                ["quiet_hours_respect"] = GetBool(root, "quietHoursRespect", false),
                            };
                            var tok = GetStr(root, "botToken").Trim();
                            var chatId = GetStr(root, "chatId").Trim();
                            if (!string.IsNullOrEmpty(tok)) body["bot_token"] = tok;
                            if (!string.IsNullOrEmpty(chatId)) body["chat_id"] = chatId;
                            try
                            {
                                _telegramConfig = await _api.SaveTelegramBotConfigAsync(body);
                                _webUiConfigRev++;
                                _telegramStatusOk = true;
                                _telegramStatusMessage = "Đã lưu cấu hình Bot Cảnh báo Telegram lên Cloud!";
                                AppendLog("Đã lưu cấu hình Bot Cảnh báo Telegram trên Cloud.");
                            }
                            catch (Exception ex)
                            {
                                _telegramStatusOk = false;
                                _telegramStatusMessage = $"Lỗi lưu Telegram Bot: {ex.Message}";
                            }
                            PushOverviewStateToWebView();
                            break;
                        }

                    case "test_telegram_override":
                        try
                        {
                            await _api.SendTelegramTestWithOverridesAsync(GetStr(root, "botToken"), GetStr(root, "chatId"));
                            _telegramStatusOk = true;
                            _telegramStatusMessage = "Đã gửi tin nhắn kiểm tra tới Telegram thành công!";
                            AppendLog("Đã gửi tin nhắn Telegram test thành công.");
                        }
                        catch (Exception ex)
                        {
                            _telegramStatusOk = false;
                            _telegramStatusMessage = $"Gửi tin test thất bại: {ex.Message}";
                        }
                        PushOverviewStateToWebView();
                        break;

                    case "clear_telegram_token":
                        try
                        {
                            _telegramConfig = await _api.SaveTelegramBotConfigAsync(new { clear_bot_token = true, enabled = false });
                            _webUiConfigRev++;
                            _telegramStatusOk = true;
                            _telegramStatusMessage = "Đã xóa Bot Token Telegram khỏi Workspace.";
                            AppendLog(_telegramStatusMessage);
                        }
                        catch (Exception ex)
                        {
                            _telegramStatusOk = false;
                            _telegramStatusMessage = $"Lỗi xóa Bot Token: {ex.Message}";
                        }
                        PushOverviewStateToWebView();
                        break;

                    case "revoke_device_session":
                        {
                            var sid = GetStr(root, "sessionId");
                            if (string.IsNullOrWhiteSpace(sid)) break;
                            try
                            {
                                await _api.RevokeDeviceSessionAsync(sid, "Thu hồi từ AdsOps Desktop Pro");
                                AppendLog($"Đã thu hồi phiên thiết bị '{sid}'.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi thu hồi phiên: {ex.Message}"); }
                            break;
                        }

                    case "logout_other_devices":
                        {
                            var ok = UiComponents.ShowConfirmActionDialog(
                                this, "Thu hồi toàn bộ thiết bị khác",
                                "Đăng xuất tất cả phiên Cloud trên các trình duyệt / máy tính khác?",
                                new (string, string)[] { ("Phiên hiện tại:", "Giữ nguyên đăng nhập trên App này"), ("Thiết bị khác:", "Bắt buộc đăng nhập lại") },
                                "Các phiên khác sẽ bị thu hồi ngay lập tức trên máy chủ AdsOps.", "Đăng xuất thiết bị khác", isDanger: true);
                            if (!ok) break;
                            try
                            {
                                var res = await _api.LogoutOtherDevicesAsync();
                                AppendLog($"Đã thu hồi {res.RevokedCount} phiên thiết bị Cloud khác.");
                                await SyncCloudAsync(silent: false);
                            }
                            catch (Exception ex) { AppendLog($"Lỗi thu hồi phiên thiết bị khác: {ex.Message}"); }
                            break;
                        }

                    case "check_app_updates":
                        await CheckForAppUpdatesAsync();
                        break;

                    case "apply_self_update":
                        await ApplySelfUpdateAsync();
                        break;
                }
            }
            catch (Exception ex)
            {
                AppendLog($"[WebView IPC] Lỗi xử lý lệnh: {ex.Message}");
            }
        });
    }

    private WebPageNurtureConfigDto BuildPageNurtureConfigDto()
    {
        var effDir = PageContentNurtureEngine.ResolveEffectiveAssetsDir(_config.PageAssetsDir);
        var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);
        int imgCount = 0;
        try
        {
            if (Directory.Exists(effDir))
            {
                var exts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };
                imgCount = Directory.EnumerateFiles(effDir, "*.*", SearchOption.AllDirectories)
                    .Count(f => exts.Contains(Path.GetExtension(f)));
            }
        }
        catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi đẩy dữ liệu lên WebView2: {ex.Message}");
        }

        return new WebPageNurtureConfigDto
        {
            Mode = string.IsNullOrWhiteSpace(_config.PageNurtureMode) ? "alternate" : _config.PageNurtureMode,
            AssetsDir = effDir,
            EnableImageHashJitter = _config.EnableImageHashJitter,
            ShareSourceUrls = _config.PageShareSourceUrls ?? "",
            CaptionSpintax = string.IsNullOrWhiteSpace(_config.PageCaptionSpintax)
                ? PageContentNurtureEngine.DefaultCaptionSpintax
                : _config.PageCaptionSpintax,
            ShareSourceCount = shareUrls.Count,
            ImagesFoundCount = imgCount,
        };
    }

    private async Task RunPageNurtureSingleAsync(FanpageItemDto pg, string actionMode, bool viaBrowser)
    {
        var via = ResolveEffectiveViaForPage(pg);
        var pageKey = !string.IsNullOrWhiteSpace(pg.ExternalPageId) ? pg.ExternalPageId! : pg.Id;
        var caption = PageContentNurtureEngine.SpinText(_config.PageCaptionSpintax, pg.Name, pg.Category ?? _batchNicheKey);
        var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);

        if (string.Equals(actionMode, "share", StringComparison.OrdinalIgnoreCase))
        {
            var nextUrl = PageContentNurtureEngine.PickNextShareUrl(pageKey, shareUrls, _config.PageSharedUrlHistory);
            if (string.IsNullOrWhiteSpace(nextUrl))
            {
                MessageBox.Show(
                    this,
                    "Bạn chưa dán danh sách URL bài viết / Page nguồn chia sẻ ở khung 'Trung tâm Đăng bài & Chia sẻ Nuôi Page'. Hãy dán ít nhất 1 link rồi bấm Lưu cấu hình trước.",
                    "Thiếu nguồn chia sẻ bài",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                return;
            }

            _config.PageLocalShareCounts[pageKey] = (_config.PageLocalShareCounts.TryGetValue(pageKey, out var cur) ? cur : 0) + 1;
            _config.Save();

            if (!viaBrowser && !string.IsNullOrWhiteSpace(pg.ExternalPageId))
            {
                try
                {
                    var r = await _api.PublishWarmupPostAsync(
                        pg.Id, caption, via?.ViaId ?? "", via?.Label ?? "Via Giữ Page",
                        via?.ProfileDir ?? "Default", postMode: "graph_api_or_assist", contentType: "share", shareUrl: nextUrl);
                    AppendLog($"🔗 [Cloud Share] Đã chia sẻ bài nguồn lên Page '{pg.Name}' ({r.DeliveryMode}).");
                    await SyncCloudAsync(silent: true);
                    return;
                }
                catch (Exception ex)
                {
                    AppendLog($"⚠️ Cloud Share chưa khả dụng ({ex.Message}) — tự động chuyển sang Chrome thật...");
                }
            }

            try { Clipboard.SetText(caption); } catch { }
            if (via == null)
            {
                AppendLog($"⚠️ Không tìm thấy Via cầm Page '{pg.Name}' để mở Chrome.");
                return;
            }
            var target = $"https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_ka_route=scroll_feed,page_auto_share_curated&adsops_share_url={Uri.EscapeDataString(nextUrl)}";
            LaunchViaChromeSafe(via, target);
            AppendLog($"🔗 [Chrome Share] Đã mở bài nguồn ({nextUrl}) bằng Via '{via.Label}' cho Page '{pg.Name}'. Caption spin đã chép sẵn vào Clipboard.");
            PushOverviewStateToWebView();
            return;
        }

        // Default: actionMode == "post" (Text + Unique Hash Image)
        var pickedImg = PageContentNurtureEngine.PickRandomImageFromDir(_config.PageAssetsDir, pg.Category ?? _batchNicheKey, "posts");
        string? preparedImg = pickedImg;
        if (!string.IsNullOrWhiteSpace(pickedImg) && _config.EnableImageHashJitter)
        {
            try
            {
                preparedImg = PageContentNurtureEngine.CreateUniqueImageVariant(pickedImg);
                AppendLog($"🖼️ Đã tạo biến thể ảnh chống trùng hash: {Path.GetFileName(preparedImg)}");
            }
            catch (Exception ex)
            {
                AppendLog($"⚠️ Không tạo được biến thể ảnh ({ex.Message}), dùng ảnh gốc.");
            }
        }

        if (!viaBrowser && !string.IsNullOrWhiteSpace(pg.ExternalPageId))
        {
            try
            {
                var r = await _api.PublishWarmupPostAsync(
                    pg.Id, caption, via?.ViaId ?? "", via?.Label ?? "Via Giữ Page",
                    via?.ProfileDir ?? "Default", postMode: "graph_api_or_assist", contentType: "post");
                AppendLog($"📝 [Cloud Post] Đã đăng bài nuôi lên Page '{pg.Name}' ({r.DeliveryMode}).");
                await SyncCloudAsync(silent: true);
                return;
            }
            catch (Exception ex)
            {
                AppendLog($"⚠️ Cloud Post chưa khả dụng ({ex.Message}) — tự động chuyển sang Chrome thật...");
            }
        }

        try { Clipboard.SetText(caption); } catch { }
        if (via == null)
        {
            AppendLog($"⚠️ Không tìm thấy Via cầm Page '{pg.Name}' để mở Chrome.");
            return;
        }
        var composerUrl = !string.IsNullOrWhiteSpace(pg.ExternalPageId)
            ? $"https://business.facebook.com/latest/composer?asset_id={Uri.EscapeDataString(pg.ExternalPageId!)}"
            : (!string.IsNullOrWhiteSpace(pg.Url) ? pg.Url! : "https://business.facebook.com/latest/composer");
        var launchUrl = $"https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_ka_route=scroll_feed,page_auto_post_media&adsops_composer_url={Uri.EscapeDataString(composerUrl)}";
        LaunchViaChromeSafe(via, launchUrl);
        if (!string.IsNullOrWhiteSpace(preparedImg))
        {
            AppendLog($"📸 [Chrome Post] Đã mở Composer Page '{pg.Name}' (Via '{via.Label}'). Caption đã chép Clipboard • Ảnh sẵn sàng: {preparedImg}");
        }
        else
        {
            AppendLog($"📝 [Chrome Post] Đã mở Composer Page '{pg.Name}' (Via '{via.Label}'). Caption spin đã chép sẵn vào Clipboard.");
        }
        PushOverviewStateToWebView();
    }

    private void StartPageNurtureBatchQueue(string rawMode, bool viaBrowser)
    {
        if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
        {
            MessageBox.Show(this, "Hàng đợi khác đang chạy. Vui lòng dừng trước khi chạy lô nuôi Page.", "Đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var mode = rawMode is "post" or "share" or "alternate" ? rawMode : "alternate";
        var livePages = (_pagesSummary?.Items ?? new())
            .Where(p => string.Equals(p.HealthStatus, "LIVE", StringComparison.OrdinalIgnoreCase))
            .OrderBy(p => p.WarmupPostsCount)
            .Take(8)
            .ToList();
        if (livePages.Count == 0)
        {
            MessageBox.Show(this, "Chưa có Fanpage LIVE nào để chạy lô nuôi bài.", "Không có Page LIVE", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);
        if (mode == "share" && shareUrls.Count == 0)
        {
            MessageBox.Show(this, "Chế độ Chia sẻ bài cần ít nhất 1 URL bài viết nguồn. Hãy dán link nguồn rồi bấm Lưu cấu hình.", "Thiếu link nguồn", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var tasks = new List<QueueTaskItem>();
        for (int i = 0; i < livePages.Count; i++)
        {
            var pg = livePages[i];
            var via = ResolveEffectiveViaForPage(pg);
            if (via == null) continue;
            var pageKey = !string.IsNullOrWhiteSpace(pg.ExternalPageId) ? pg.ExternalPageId! : pg.Id;
            bool doShare = mode == "share" || (mode == "alternate" && shareUrls.Count > 0 && i % 2 == 1);
            string launchUrl;
            string title;
            if (doShare)
            {
                var nextUrl = PageContentNurtureEngine.PickNextShareUrl(pageKey, shareUrls, _config.PageSharedUrlHistory);
                if (string.IsNullOrWhiteSpace(nextUrl)) continue;
                _config.PageLocalShareCounts[pageKey] = (_config.PageLocalShareCounts.TryGetValue(pageKey, out var cur) ? cur : 0) + 1;
                launchUrl = $"https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_ka_route=scroll_feed,page_auto_share_curated&adsops_share_url={Uri.EscapeDataString(nextUrl)}";
                title = $"Chia sẻ bài nuôi Page: {pg.Name}";
            }
            else
            {
                var composerUrl = !string.IsNullOrWhiteSpace(pg.ExternalPageId)
                    ? $"https://business.facebook.com/latest/composer?asset_id={Uri.EscapeDataString(pg.ExternalPageId!)}"
                    : "https://business.facebook.com/latest/composer";
                launchUrl = $"https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_ka_route=scroll_feed,page_auto_post_media&adsops_composer_url={Uri.EscapeDataString(composerUrl)}";
                title = $"Đăng bài nuôi Page: {pg.Name}";
            }

            tasks.Add(new QueueTaskItem(
                via.ViaId,
                via.Label,
                GetEffectiveBatchProfileKey(via, via.ProfileDir),
                via.NetworkLabel ?? "",
                launchUrl,
                title,
                "standard_via",
                via.ClientGroup ?? "",
                false,
                via.CooldownUntilUtc,
                via.HasSiloConflict,
                via.SiloConflictDetail ?? ""));
        }

        if (tasks.Count == 0)
        {
            AppendLog("⚠️ Không có Page nào gắn Via hợp lệ để xếp hàng đợi nuôi bài.");
            return;
        }

        _config.Save();
        _queue.ConfigureRestRange(_config.QueueRestMinSeconds, _config.QueueRestMaxSeconds);
        _queue.StartQueue(
            QueueKind.KeepAlive,
            tasks,
            Math.Max(25, _config.QueueRestMinSeconds),
            _config.PreCheckProxyBeforeLaunch,
            _config.MaxViasPerProxyInBatch,
            _config.AutoKeepAliveStartHour,
            _config.AutoKeepAliveEndHour,
            enforceDaytimeWindow: false,
            enforceSoakQuarantine: false,
            enforceClientSilo: _config.EnforceClientSilo,
            interleaveByProxy: true,
            sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
            maxConcurrentBrowsers: Math.Min(3, GetEffectiveMaxConcurrentBrowsers()),
            maxDirectIpVias: _config.MaxDirectIpViasInBatch);
        AppendLog($"🚀 Đã khởi chạy lô Nuôi Page ({mode}, {tasks.Count} Page) theo nhịp Jitter + Giám sát RPA.");
        PushOverviewStateToWebView();
    }
}
