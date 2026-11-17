using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AdsOpsDesktop;

internal sealed partial class MainWindow
{
    private void RenderCurrentView()
    {
        _liveTotpBindings.Clear();
        _copiedToastTarget = null;
        _queueSummaryText = null;
        _queueCountdownText = null;
        _queuePauseBtn = null;
        _queueSkipBtn = null;
        _queueStopBtn = null;
        _queueLiveBanner = null;

        var isLoggedIn = !string.IsNullOrWhiteSpace(_config.GetJwt());

        UIElement body;
        if (!isLoggedIn && _activeView != AppView.Settings)
        {
            body = BuildUnauthenticatedState();
        }
        else if (_isBusy && !_hasLoadedOnce && _activeView != AppView.Settings)
        {
            body = BuildLoadingState();
        }
        else
        {
            body = _activeView switch
            {
                AppView.Overview => BuildOverviewView(),
                AppView.Vias => BuildViasView(),
                AppView.Automation => BuildAutomationView(),
                AppView.PagesBm => BuildPagesBmView(),
                AppView.AdAccounts => BuildAdAccountsView(),
                AppView.HealthTokens => BuildHealthTokensView(),
                AppView.WorkspaceOps => BuildWorkspaceOpsView(),
                AppView.Settings => BuildSettingsView(),
                _ => BuildOverviewView(),
            };
        }

        _viewHost.Content = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0),
            Content = new Border
            {
                Padding = new Thickness(18, 14, 18, 18),
                Child = body,
            },
        };

        UpdateLiveQueueWidgets();
        OnUiSecondTick();
    }

    private UIElement BuildUnauthenticatedState()
    {
        return UiComponents.CreateEmptyState(
            FluentIcons.Lock,
            "Kết nối tài khoản AdsOps Cloud",
            "Đăng nhập tài khoản để đồng bộ danh sách Via, BM, Fanpage, Tài khoản QC và bật Hàng đợi Tự động hóa trên Chrome Profile thật. Mọi Cookie & 2FA vẫn được mã hóa DPAPI 100% tại máy Windows này.",
            "Đi tới Đăng nhập & Két khóa",
            (_, _) => SwitchView(AppView.Settings));
    }

    private UIElement BuildLoadingState()
    {
        return UiComponents.CreateEmptyState(
            FluentIcons.Sync,
            "Đang tải dữ liệu từ AdsOps Cloud...",
            "Đang đồng bộ Via, Business Manager, Fanpage, Tài khoản QC và cấu hình Extension Companion.");
    }

    private Border BuildQueueRunnerBanner(bool alwaysShow = false)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = UiComponents.CreateIcon(FluentIcons.Play, 16, ThemeTokens.AccentText);
        icon.Margin = new Thickness(0, 0, 10, 0);
        grid.Children.Add(icon);

        _queueSummaryText = new TextBlock
        {
            Text = "Sẵn sàng nhận lệnh",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(_queueSummaryText, 1);
        grid.Children.Add(_queueSummaryText);

        _queueCountdownText = new TextBlock
        {
            Text = "—",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 13,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.WarningText,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 14, 0),
        };
        Grid.SetColumn(_queueCountdownText, 2);
        grid.Children.Add(_queueCountdownText);

        var btns = new StackPanel { Orientation = Orientation.Horizontal };
        _queuePauseBtn = UiComponents.CreateButton("Tạm dừng", ButtonVariant.Secondary, FluentIcons.Pause, compact: true, onClick: (_, _) =>
        {
            if (_queue.Current.Phase == QueuePhase.Paused) _queue.Resume();
            else _queue.Pause();
        });
        _queuePauseBtn.Margin = new Thickness(0, 0, 6, 0);

        _queueSkipBtn = UiComponents.CreateButton("Bỏ qua chờ", ButtonVariant.Secondary, FluentIcons.FastForward, compact: true, onClick: (_, _) => _queue.SkipCurrentWait());
        _queueSkipBtn.Margin = new Thickness(0, 0, 6, 0);

        _queueStopBtn = UiComponents.CreateButton("Dừng hẳn", ButtonVariant.Danger, FluentIcons.Stop, compact: true, onClick: (_, _) => _queue.Stop());

        btns.Children.Add(_queuePauseBtn);
        btns.Children.Add(_queueSkipBtn);
        btns.Children.Add(_queueStopBtn);
        Grid.SetColumn(btns, 3);
        grid.Children.Add(btns);

        var card = UiComponents.CreateCard(grid, new Thickness(14, 10, 14, 10), ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
        card.Margin = new Thickness(0, 0, 0, 14);
        card.Visibility = alwaysShow ? Visibility.Visible : Visibility.Collapsed;
        _queueLiveBanner = card;
        return card;
    }

    // ------------------------------------------------------------------------
    // VIEW 1: TỔNG QUAN (OVERVIEW)
    // ------------------------------------------------------------------------
    private UIElement BuildOverviewView()
    {
        var stack = new StackPanel();
        stack.Children.Add(BuildQueueRunnerBanner(alwaysShow: false));

        // 4 KPI Cards
        var kpiGrid = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        for (int i = 0; i < 4; i++)
        {
            kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            if (i < 3) kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        }

        var dueCount = _vias.Count(v => v.NeedsKeepAlive);
        var viaCard = UiComponents.CreateMetricCard(
            "Quản lý Đa Via",
            _hasLoadedOnce ? _vias.Count.ToString() : "—",
            _hasLoadedOnce ? (dueCount > 0 ? $"{dueCount} Via quá hạn Đảo Ấm" : "Tất cả Via đều đang ấm") : "Chưa đồng bộ",
            FluentIcons.People,
            ThemeTokens.AccentText,
            out _, out _);
        Grid.SetColumn(viaCard, 0);
        kpiGrid.Children.Add(viaCard);

        var pages = _pagesSummary?.Items ?? new();
        var readyCount = pages.Count(p => p.AdsReady);
        var pageCard = UiComponents.CreateMetricCard(
            "Fanpage & BM",
            _pagesSummary != null ? pages.Count.ToString() : "—",
            _pagesSummary != null ? $"{readyCount} sẵn sàng Ads • {_bms.Count} BM" : "Chưa đồng bộ",
            FluentIcons.Page,
            ThemeTokens.SuccessText,
            out _, out _);
        Grid.SetColumn(pageCard, 2);
        kpiGrid.Children.Add(pageCard);

        var activeAds = _adAccounts.Count(a => a.Status.Contains("active", StringComparison.OrdinalIgnoreCase));
        var alertTot = (_alertSummary?.OpenCritical ?? 0) + (_alertSummary?.OpenWarning ?? 0);
        var adCard = UiComponents.CreateMetricCard(
            "Tài khoản QC & Cảnh báo",
            _hasLoadedOnce ? _adAccounts.Count.ToString() : "—",
            _hasLoadedOnce ? $"{activeAds} Active • {alertTot} cảnh báo mở" : "Chưa đồng bộ",
            FluentIcons.Chart,
            alertTot > 0 ? ThemeTokens.WarningText : ThemeTokens.SuccessText,
            out _, out _);
        Grid.SetColumn(adCard, 4);
        kpiGrid.Children.Add(adCard);

        var twoFaReady = _vias.Count(v =>
        {
            var s = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
            return TotpService.ComputeTotp(!string.IsNullOrEmpty(s.TwoFaSecret) ? s.TwoFaSecret : v.TwoFaSecret).Valid;
        });
        var bridgeCard = UiComponents.CreateMetricCard(
            "Cầu nối Local & Két 2FA",
            _bridge != null ? $":{_bridge.BoundPort}" : "OFF",
            $"{twoFaReady} Via có TOTP 2FA Live",
            FluentIcons.ShieldKey,
            ThemeTokens.PurpleText,
            out _, out _);
        Grid.SetColumn(bridgeCard, 6);
        kpiGrid.Children.Add(bridgeCard);

        stack.Children.Add(kpiGrid);

        // 2-Column split: Actionable Alerts + Quick Tools / Recent Logs
        var mainCols = new Grid();
        mainCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.25, GridUnitType.Star) });
        mainCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        mainCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // Left: Alerts panel
        var alertsPanel = new StackPanel();
        var alertHeader = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        alertHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        alertHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        alertHeader.Children.Add(new TextBlock
        {
            Text = "Cảnh báo Hệ thống & Tài khoản cần xử lý",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var testTeleBtn = UiComponents.CreateButton("Test Telegram", ButtonVariant.Secondary, FluentIcons.Send, compact: true, onClick: async (_, _) =>
        {
            try
            {
                var r = await _api.SendTelegramTestAsync();
                AppendLog($"Telegram Test: {r.Message}");
                MessageBox.Show(this, r.Message, "Telegram Test", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi gửi Telegram: {ex.Message}");
            }
        });
        Grid.SetColumn(testTeleBtn, 1);
        alertHeader.Children.Add(testTeleBtn);
        alertsPanel.Children.Add(alertHeader);

        if (_alerts.Count == 0)
        {
            alertsPanel.Children.Add(new TextBlock
            {
                Text = "Không có cảnh báo nào đang mở. Hệ thống hoạt động ổn định.",
                FontFamily = ThemeTokens.UiFont,
                FontSize = 13,
                Foreground = ThemeTokens.TextSecondary,
                Margin = new Thickness(0, 8, 0, 8),
            });
        }
        else
        {
            foreach (var al in _alerts.Take(8))
            {
                alertsPanel.Children.Add(BuildAlertRowCard(al));
            }
        }

        var leftCard = UiComponents.CreateCard(alertsPanel);
        Grid.SetColumn(leftCard, 0);
        mainCols.Children.Add(leftCard);

        // Right: Quick Actions + Live 2FA & Recent Activity
        var rightStack = new StackPanel();

        var quickPanel = new StackPanel();
        quickPanel.Children.Add(new TextBlock
        {
            Text = "Thao tác nhanh Toàn hệ thống",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var quickWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };
        void AddQuickBtn(Button b)
        {
            b.Margin = new Thickness(0, 0, 8, 8);
            quickWrap.Children.Add(b);
        }

        AddQuickBtn(UiComponents.CreateButton("Đảo Ấm Via quá hạn", ButtonVariant.Primary, FluentIcons.CoffeeWarmup, onClick: (_, _) => StartKeepAliveDueQueue(requireConfirm: true)));
        AddQuickBtn(UiComponents.CreateButton("Check Proxy hàng loạt", ButtonVariant.Secondary, FluentIcons.Globe, onClick: async (_, _) => await RunBatchProxyCheckAsync()));
        AddQuickBtn(UiComponents.CreateButton("Cấp lại Extension tất cả", ButtonVariant.Secondary, FluentIcons.ShieldCheck, onClick: (_, _) =>
        {
            var n = ProvisionAllViaExtensions(silent: false);
            MessageBox.Show(this, $"Đã cấp mới Chrome Extension Companion cho {n} Via.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
        }));
        AddQuickBtn(UiComponents.CreateButton("Đồng bộ Page từ Meta", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await RunMetaPageSyncAsync()));
        AddQuickBtn(UiComponents.CreateButton("Benchmark 5 Engine", ButtonVariant.Secondary, FluentIcons.Diagnostic, onClick: async (_, _) => await RunBenchmarkAllEnginesUiAsync()));
        AddQuickBtn(UiComponents.CreateButton("Nhật ký Mở Profile", ButtonVariant.Secondary, FluentIcons.ShieldCheck, onClick: (_, _) => OpenProfileLaunchAuditDialog()));
        quickPanel.Children.Add(quickWrap);

        // v2.6.0 Workstation RAM & Recommended Concurrency Strip + 5-Step Safety Onboarding Preset
        var wsMem = _workstationMem ?? WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        var recConcurrent = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(_config.LowRamFarmMode, wsMem);
        var onlineBenchNames = _engineProbes.Where(p => p.Online && p.Engine != "chrome_native")
            .Select(p => $"{AntidetectBrowserConnector.GetDisplayName(p.Engine)} ({p.LatencyMs}ms)")
            .ToList();
        var memSummary = $"💻 RAM trống: {wsMem.AvailablePhysicalMb:N0}/{wsMem.TotalPhysicalMb:N0} MB ({100 - (int)wsMem.MemoryLoadPercent}% trống) • Khuyên mở tối đa: {recConcurrent} luồng song song"
            + (onlineBenchNames.Count > 0
                ? $" • Đang bật: {string.Join(", ", onlineBenchNames)} (Nhanh nhất: {AntidetectBrowserConnector.GetDisplayName(_recommendedFastestEngine)})"
                : " • Chưa dò thấy App Antidetect đang mở (bấm Benchmark để quét lại)");
        quickPanel.Children.Add(new TextBlock
        {
            Text = memSummary,
            FontSize = 11.5,
            Foreground = ThemeTokens.AccentText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 4, 0, 0),
        });

        var quickCard = UiComponents.CreateCard(quickPanel);
        quickCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(quickCard);

        // 5-Step Safety Onboarding & 1-Click Safe Preset (v2.6.0)
        var onboardPanel = new StackPanel();
        onboardPanel.Children.Add(new TextBlock
        {
            Text = "🛡️ Lộ trình Thiết lập An toàn 5 Bước (Dành cho Người mới)",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        var step1Ok = _bridge != null && !string.IsNullOrWhiteSpace(_config.GetJwt());
        var step2Ok = _config.EnableChromeAntidetectShield && _config.EnforceSoakQuarantine && _config.PreCheckProxyBeforeLaunch;
        var step3Ok = _vias.Count > 0 && _vias.All(v => !v.HasSiloConflict);
        var step4Ok = _vias.Any(v => v.ProxyLastStatus == "LIVE") && !_vias.Any(v => v.HasTimezoneMismatch);
        var step5Ok = twoFaReady > 0;
        var steps = new[]
        {
            (step1Ok, "1. Kết nối AdsOps Cloud & Local Bridge Zero-Trust :17890"),
            (step2Ok, "2. Bật Khiên Chrome WebRTC + Ngâm 72h + Check Proxy trước khi mở"),
            (step3Ok, "3. Gắn mỗi Via 1 Chrome/Antidetect Profile riêng (0 trùng Silo)"),
            (step4Ok, "4. Quét Proxy LIVE & kiểm tra IP khớp Múi giờ với tài khoản"),
            (step5Ok, "5. Lưu ít nhất 1 mã 2FA/Cookie trong Két DPAPI Local để bật Auto-Failover"),
        };
        foreach (var (okStep, textStep) in steps)
        {
            onboardPanel.Children.Add(new TextBlock
            {
                Text = (okStep ? "✓ " : "○ ") + textStep,
                FontSize = 12,
                Foreground = okStep ? ThemeTokens.SuccessText : ThemeTokens.TextSecondary,
                Margin = new Thickness(0, 0, 0, 3),
                TextWrapping = TextWrapping.Wrap,
            });
        }
        var presetBtn = UiComponents.CreateButton("Áp dụng Preset An Toàn Chuẩn (1-Click)", ButtonVariant.Primary, FluentIcons.ShieldCheck, compact: true, onClick: (_, _) =>
        {
            _config.EnableChromeAntidetectShield = true;
            _config.LowRamFarmMode = true;
            _config.AutoScaleConcurrentByRam = true;
            _config.PreCheckProxyBeforeLaunch = true;
            _config.EnforceSoakQuarantine = true;
            _config.EnforceClientSilo = true;
            _config.MaxViasPerProxyInBatch = 4;
            _config.DefaultStaggerSeconds = 60;
            _config.Save();
            var cnt = ProvisionAllViaExtensions(silent: true);
            AppendLog($"⚡ Đã áp dụng Preset An Toàn Chuẩn (WebRTC Shield, RAM Auto-Cap, Ngâm 72h, 4 Via/Proxy, 60s Jitter) và cấp lại {cnt} Extension.");
            RenderCurrentView();
        });
        presetBtn.Margin = new Thickness(0, 8, 0, 0);
        onboardPanel.Children.Add(presetBtn);
        var onboardCard = UiComponents.CreateCard(onboardPanel);
        onboardCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(onboardCard);

        // Recent Via Activity
        var actPanel = new StackPanel();
        actPanel.Children.Add(new TextBlock
        {
            Text = "Nhật ký Via & Page gần đây (Cloud)",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 8),
        });

        var logs = _pagesSummary?.ViaActivityLogs ?? new();
        if (logs.Count == 0)
        {
            actPanel.Children.Add(new TextBlock
            {
                Text = "Chưa có hoạt động gần đây được ghi nhận.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
            });
        }
        else
        {
            foreach (var l in logs.Take(7))
            {
                var line = new Border
                {
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(0, 0, 0, 1),
                    Padding = new Thickness(0, 6, 0, 6),
                };
                var ls = new StackPanel();
                ls.Children.Add(new TextBlock
                {
                    Text = $"{l.ActionLabel} • {l.ViaLabel}" + (string.IsNullOrWhiteSpace(l.PageName) ? "" : $" ({l.PageName})"),
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = ThemeTokens.TextPrimary,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                ls.Children.Add(new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(l.Detail) ? l.CreatedAt : l.Detail,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextMuted,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                line.Child = ls;
                actPanel.Children.Add(line);
            }
        }
        rightStack.Children.Add(UiComponents.CreateCard(actPanel));

        Grid.SetColumn(rightStack, 2);
        mainCols.Children.Add(rightStack);
        stack.Children.Add(mainCols);

        return stack;
    }

    private Border BuildAlertRowCard(AlertItemDto al)
    {
        var isCrit = al.Severity.Equals("critical", StringComparison.OrdinalIgnoreCase);
        var isWarn = al.Severity.Equals("warning", StringComparison.OrdinalIgnoreCase);
        var fg = isCrit ? ThemeTokens.DangerText : isWarn ? ThemeTokens.WarningText : ThemeTokens.AccentText;
        var bg = isCrit ? ThemeTokens.DangerBg : isWarn ? ThemeTokens.WarningBg : ThemeTokens.InfoBg;
        var bd = isCrit ? ThemeTokens.DangerBorder : isWarn ? ThemeTokens.WarningBorder : ThemeTokens.InfoBorder;

        var g = new Grid();
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var info = new StackPanel();
        var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
        var pill = UiComponents.CreateBadgePill(al.Severity.ToUpperInvariant(), fg, bg, bd);
        pill.Margin = new Thickness(0, 0, 8, 0);
        top.Children.Add(pill);
        top.Children.Add(new TextBlock
        {
            Text = al.Title,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });
        info.Children.Add(top);

        var desc = string.IsNullOrWhiteSpace(al.Summary) ? $"{al.AccountDisplayName} • {al.BusinessManagerName}" : al.Summary;
        info.Children.Add(new TextBlock
        {
            Text = desc,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });
        g.Children.Add(info);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        if (al.Status.Equals("open", StringComparison.OrdinalIgnoreCase))
        {
            var ackBtn = UiComponents.CreateButton("Ghi nhận", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
            {
                try
                {
                    await _api.AcknowledgeAlertAsync(al.Id);
                    AppendLog($"Đã ghi nhận cảnh báo: {al.Title}");
                    await SyncCloudAsync(silent: false);
                }
                catch (Exception ex) { AppendLog($"Lỗi ghi nhận cảnh báo: {ex.Message}"); }
            });
            ackBtn.Margin = new Thickness(0, 0, 6, 0);
            actions.Children.Add(ackBtn);
        }

        var suppressBtn = UiComponents.CreateButton("Tạm ẩn 24h", ButtonVariant.Subtle, compact: true, tooltip: "Tạm ẩn cảnh báo này trong 24 giờ trên Cloud", onClick: async (_, _) =>
        {
            try
            {
                await _api.SuppressAlertAsync(al.Id, 24, "Tạm ẩn 24h từ AdsOps Desktop Pro");
                AppendLog($"Đã tạm ẩn 24h cảnh báo: {al.Title}");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi tạm ẩn cảnh báo: {ex.Message}"); }
        });
        suppressBtn.Margin = new Thickness(0, 0, 6, 0);
        actions.Children.Add(suppressBtn);

        var resBtn = UiComponents.CreateButton("Xử lý xong", ButtonVariant.Success, compact: true, onClick: async (_, _) =>
        {
            var confirm = UiComponents.ShowConfirmActionDialog(
                this,
                "Đóng cảnh báo hệ thống",
                $"Đánh dấu đã xử lý cảnh báo: {al.Title}",
                new (string, string)[] { ("Mức độ:", al.Severity.ToUpperInvariant()), ("Đối tượng:", al.AccountDisplayName ?? al.SourceLabel ?? "Hệ thống") },
                "Cảnh báo sẽ chuyển sang trạng thái Đã xử lý trên Cloud.",
                "Đánh dấu Đã xử lý");
            if (!confirm) return;
            try
            {
                await _api.ResolveAlertAsync(al.Id);
                AppendLog($"Đã xử lý cảnh báo: {al.Title}");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi đóng cảnh báo: {ex.Message}"); }
        });
        actions.Children.Add(resBtn);
        Grid.SetColumn(actions, 1);
        g.Children.Add(actions);

        var card = UiComponents.CreateCard(g, new Thickness(12, 9, 12, 9), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
        card.Margin = new Thickness(0, 0, 0, 8);
        return card;
    }

    // ------------------------------------------------------------------------
    // VIEW 2: QUẢN LÝ ĐA VIA (MULTI-VIA)
    // ------------------------------------------------------------------------
    private UIElement BuildViasView()
    {
        var root = new StackPanel();
        var listHost = new StackPanel();
        var bulkBarHost = new ContentControl { Margin = new Thickness(0, 0, 0, 10) };

        void RefreshBulkAndList()
        {
            RefreshLiveSessionTelemetryOnVias();
            _liveTotpBindings.Clear();
            listHost.Children.Clear();
            RebuildBulkToolbar(bulkBarHost, RefreshBulkAndList);

            var filtered = FilterVias().ToList();
            if (_vias.Count == 0)
            {
                listHost.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.People,
                    "Chưa có Via nào trong hệ thống",
                    "Thêm Via đầu tiên để gắn Chrome Profile, Proxy tĩnh và lưu trữ Cookie / 2FA mã hóa DPAPI tại máy.",
                    "Thêm Via đầu tiên",
                    (_, _) => OpenViaEditorDialog(null)));
                return;
            }

            if (filtered.Count == 0)
            {
                listHost.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.Search,
                    "Không có Via nào khớp bộ lọc",
                    "Thử xóa từ khóa tìm kiếm hoặc chuyển về bộ lọc 'Tất cả'."));
                return;
            }

            foreach (var v in filtered)
            {
                listHost.Children.Add(BuildViaRowCard(v, RefreshBulkAndList));
            }
            OnUiSecondTick();
        }

        // Static Search & Filter Header (preserves SearchBox focus!)
        var filterCardStack = new StackPanel();
        var searchRow = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var searchBox = UiComponents.CreateTextBox(_viaSearch, "Tìm theo tên Via, UID, Profile Chrome, Proxy...");
        searchBox.TextChanged += (_, _) =>
        {
            _viaSearch = searchBox.Text;
            RefreshBulkAndList();
        };
        searchRow.Children.Add(searchBox);

        var rightHeaderBtns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 0, 0) };
        var distProxyBtn = UiComponents.CreateButton($"Chia Proxy 1:{_config.MaxViasPerProxyInBatch}", ButtonVariant.Primary, FluentIcons.Globe, onClick: (_, _) => OpenBulkDistributeProxiesDialog(), tooltip: "Dán danh sách Proxy để tự động chia đều 1 Proxy cho N Via (chống Direct IP hàng loạt)");
        distProxyBtn.Margin = new Thickness(0, 0, 6, 0);
        rightHeaderBtns.Children.Add(distProxyBtn);

        var bulkTierBtn = UiComponents.CreateButton("Đổi Lớp / Profile", ButtonVariant.Secondary, FluentIcons.People, onClick: (_, _) => OpenBulkChangeTierAndSiloDialog(), tooltip: "Đổi hàng loạt Lớp Via (Hold BM / Lên Camp / Dự phòng), Nhóm Khách & tách Chrome Profile riêng");
        bulkTierBtn.Margin = new Thickness(0, 0, 6, 0);
        rightHeaderBtns.Children.Add(bulkTierBtn);

        var proxyBatchBtn = UiComponents.CreateButton("Quét Proxy", ButtonVariant.Secondary, FluentIcons.Globe, onClick: async (_, _) => await RunBatchProxyCheckAsync(), tooltip: "Quét kiểm tra Live/Dead toàn bộ Proxy của Workspace");
        proxyBatchBtn.Margin = new Thickness(0, 0, 6, 0);
        rightHeaderBtns.Children.Add(proxyBatchBtn);

        var selectAllBtn = UiComponents.CreateButton("Chọn hết", ButtonVariant.Secondary, onClick: (_, _) =>
        {
            var visibleIds = FilterVias().Select(x => x.ViaId).ToList();
            var allSelected = visibleIds.Count > 0 && visibleIds.All(id => _selectedViaIds.Contains(id));
            if (allSelected) _selectedViaIds.Clear();
            else foreach (var id in visibleIds) _selectedViaIds.Add(id);
            RefreshBulkAndList();
        });
        rightHeaderBtns.Children.Add(selectAllBtn);
        Grid.SetColumn(rightHeaderBtns, 1);
        searchRow.Children.Add(rightHeaderBtns);
        filterCardStack.Children.Add(searchRow);

        var toolsWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
        void AddSecondaryToolBtn(Button b)
        {
            b.Margin = new Thickness(0, 0, 6, 4);
            toolsWrap.Children.Add(b);
        }
        AddSecondaryToolBtn(UiComponents.CreateButton("Xếp 2×2", ButtonVariant.Secondary, FluentIcons.Play, compact: true, onClick: (_, _) => TileActiveChromeWindows("2x2"), tooltip: "Xếp các cửa sổ Chrome đang mở thành lưới 2×2 trên màn hình"));
        AddSecondaryToolBtn(UiComponents.CreateButton("Token EAAB", ButtonVariant.Secondary, FluentIcons.ShieldKey, compact: true, onClick: (_, _) => OpenAutoConnectTokenDialog(null), tooltip: "Dán Token EAAB... để tự động kết nối Via, BM & TKQC lên Cloud"));
        AddSecondaryToolBtn(UiComponents.CreateButton("Nhật ký Bảo vệ", ButtonVariant.Secondary, FluentIcons.ShieldCheck, compact: true, onClick: (_, _) => OpenStewardshipLogDialog(), tooltip: $"Xem lịch sử chặn rò rỉ IP, Cooldown 24h & Cách ly Khách hàng ({DesktopAppInfo.DisplayVersion})"));
        AddSecondaryToolBtn(UiComponents.CreateButton("Nhật ký Mở Profile", ButtonVariant.Secondary, FluentIcons.Diagnostic, compact: true, onClick: (_, _) => OpenProfileLaunchAuditDialog(), tooltip: "Xem ai đã mở Profile nào, qua Engine nào, trên máy nào"));
        AddSecondaryToolBtn(UiComponents.CreateButton("Benchmark 5 Engine", ButtonVariant.Secondary, FluentIcons.Lightning, compact: true, onClick: async (_, _) => await RunBenchmarkAllEnginesUiAsync(), tooltip: "Đo tốc độ phản hồi Chrome Gốc & 5 Engine Antidetect"));
        AddSecondaryToolBtn(UiComponents.CreateButton("Xuất CSV", ButtonVariant.Secondary, FluentIcons.Upload, compact: true, onClick: (_, _) => ExportViasCsv(), tooltip: "Xuất danh sách Via, Proxy, 2FA & Cookie DPAPI ra file CSV"));
        filterCardStack.Children.Add(toolsWrap);

        var chipWrap = new WrapPanel();
        void AddViaChip(string key, string label)
        {
            chipWrap.Children.Add(UiComponents.CreateFilterChip(label, _viaTierFilter == key, (_, _) =>
            {
                _viaTierFilter = key;
                RenderCurrentView();
            }));
        }
        AddViaChip("all", $"Tất cả ({_vias.Count})");
        AddViaChip("vault", $"Hold BM ({_vias.Count(v => v.RoleTier is "vault" or "hold")})");
        AddViaChip("camp", $"Lên Camp ({_vias.Count(v => v.RoleTier is not "vault" and not "hold" and not "standby")})");
        AddViaChip("standby", $"Dự phòng ({_vias.Count(v => v.RoleTier == "standby")})");
        AddViaChip("keepalive_due", $"Quá hạn Đảo Ấm ({_vias.Count(v => v.NeedsKeepAlive)})");
        AddViaChip("72h_lock", $"Đang ngâm 72h ({_vias.Count(v => v.WarmupPhase == "72h_lock")})");
        AddViaChip("cooldown", $"Đang Cooldown ({_vias.Count(v => v.IsInCooldown)})");
        AddViaChip("silo_conflict", $"Trùng Silo ({_vias.Count(v => v.HasSiloConflict)})");
        AddViaChip("proxy_dead", $"Proxy Chết ({_vias.Count(v => v.ProxyLastStatus == "DEAD")})");
        AddViaChip("running", $"Đang mở ({_vias.Count(v => v.IsBrowserRunning)})");
        AddViaChip("tz_mismatch", $"Lệch Múi giờ ({_vias.Count(v => v.HasTimezoneMismatch)})");
        AddViaChip("no_cookie", $"Thiếu Cookie Két ({_vias.Count(v => !v.HasVaultCookie)})");
        filterCardStack.Children.Add(chipWrap);

        // Unified 5-Engine Hub Filter Row (Engine + Proxy Cluster + Người phụ trách)
        var unifiedBar = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        unifiedBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        unifiedBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        unifiedBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        unifiedBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        unifiedBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var engineOpts = new List<ComboBoxItem> { new() { Content = "Engine: Tất cả (5+1)", Tag = "all" } };
        engineOpts.AddRange(AntidetectBrowserConnector.SupportedEngines.Select(e => new ComboBoxItem
        {
            Content = $"Engine: {AntidetectBrowserConnector.GetDisplayName(e.Key)} ({_vias.Count(v => AntidetectBrowserConnector.NormalizeEngine(v.AntidetectEngine) == e.Key)})",
            Tag = e.Key,
        }));
        var cbEngine = UiComponents.CreateComboBox(engineOpts);
        var eIdx = engineOpts.FindIndex(i => string.Equals(i.Tag?.ToString(), _viaEngineFilter, StringComparison.OrdinalIgnoreCase));
        cbEngine.SelectedIndex = eIdx >= 0 ? eIdx : 0;
        cbEngine.SelectionChanged += (_, _) => { _viaEngineFilter = (cbEngine.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all"; RefreshBulkAndList(); };

        var distinctProxies = _vias
            .Select(v => AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel))
            .Where(p => !string.IsNullOrEmpty(p))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(p => p)
            .ToList();
        var proxyOpts = new List<ComboBoxItem>
        {
            new() { Content = "Proxy: Tất cả cụm", Tag = "all" },
            new() { Content = "Proxy: Mạng gốc (Direct)", Tag = "direct" },
        };
        proxyOpts.AddRange(distinctProxies.Select(px => new ComboBoxItem { Content = $"Proxy: {px}", Tag = px }));
        var cbProxy = UiComponents.CreateComboBox(proxyOpts);
        var pxIdx = proxyOpts.FindIndex(i => string.Equals(i.Tag?.ToString(), _viaProxyFilter, StringComparison.OrdinalIgnoreCase));
        cbProxy.SelectedIndex = pxIdx >= 0 ? pxIdx : 0;
        cbProxy.SelectionChanged += (_, _) => { _viaProxyFilter = (cbProxy.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all"; RefreshBulkAndList(); };

        var ownerOpts = new List<ComboBoxItem>
        {
            new() { Content = "Phụ trách: Tất cả nhân sự", Tag = "all" },
            new() { Content = "Phụ trách: Chưa phân công", Tag = "unassigned" },
        };
        foreach (var tm in _teamMembers)
        {
            var disp = string.IsNullOrWhiteSpace(tm.FullName) ? tm.Email : tm.FullName;
            ownerOpts.Add(new ComboBoxItem { Content = $"👤 {disp} ({tm.Role})", Tag = tm.Id });
        }
        var cbOwner = UiComponents.CreateComboBox(ownerOpts);
        var oIdx = ownerOpts.FindIndex(i => string.Equals(i.Tag?.ToString(), _viaOwnerFilter, StringComparison.OrdinalIgnoreCase));
        cbOwner.SelectedIndex = oIdx >= 0 ? oIdx : 0;
        cbOwner.SelectionChanged += (_, _) => { _viaOwnerFilter = (cbOwner.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all"; RefreshBulkAndList(); };

        Grid.SetColumn(cbEngine, 0);
        Grid.SetColumn(cbProxy, 2);
        Grid.SetColumn(cbOwner, 4);
        unifiedBar.Children.Add(cbEngine);
        unifiedBar.Children.Add(cbProxy);
        unifiedBar.Children.Add(cbOwner);
        filterCardStack.Children.Add(unifiedBar);

        var filterCard = UiComponents.CreateCard(filterCardStack, new Thickness(12));
        filterCard.Margin = new Thickness(0, 0, 0, 12);
        root.Children.Add(filterCard);
        root.Children.Add(bulkBarHost);
        root.Children.Add(listHost);

        RefreshBulkAndList();
        return root;
    }

    private IEnumerable<ViaWorkspaceEntry> FilterVias() =>
        ApplyUnifiedViaFilters(_vias, _viaSearch, _viaTierFilter, _viaEngineFilter, _viaProxyFilter, _viaOwnerFilter);

    internal static IEnumerable<ViaWorkspaceEntry> ApplyUnifiedViaFilters(
        IEnumerable<ViaWorkspaceEntry> source,
        string? search,
        string? tierFilter,
        string? engineFilter = "all",
        string? proxyFilter = "all",
        string? ownerFilter = "all")
    {
        var q = (search ?? "").Trim();
        var tier = (tierFilter ?? "all").Trim().ToLowerInvariant();
        var eng = (engineFilter ?? "all").Trim().ToLowerInvariant();
        var px = (proxyFilter ?? "all").Trim().ToLowerInvariant();
        var own = (ownerFilter ?? "all").Trim().ToLowerInvariant();

        return source.Where(v =>
        {
            var matchFilter = tier switch
            {
                "vault" => v.RoleTier is "vault" or "hold",
                "camp" => v.RoleTier is not "vault" and not "hold" and not "standby",
                "standby" => v.RoleTier == "standby",
                "keepalive_due" => v.NeedsKeepAlive,
                "72h_lock" => v.WarmupPhase == "72h_lock",
                "cooldown" => v.IsInCooldown,
                "silo_conflict" => v.HasSiloConflict,
                "proxy_dead" => v.ProxyLastStatus == "DEAD",
                "running" => v.IsBrowserRunning,
                "tz_mismatch" => v.HasTimezoneMismatch,
                "no_cookie" => !v.HasVaultCookie,
                _ => true,
            };
            if (!matchFilter) return false;

            if (eng != "all" && !string.IsNullOrEmpty(eng))
            {
                if (!string.Equals(AntidetectBrowserConnector.NormalizeEngine(v.AntidetectEngine), eng, StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            if (px != "all" && !string.IsNullOrEmpty(px))
            {
                var hp = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
                if (px == "direct")
                {
                    if (!string.IsNullOrWhiteSpace(v.NetworkLabel)) return false;
                }
                else if (!string.Equals(hp, px, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            if (own != "all" && !string.IsNullOrEmpty(own))
            {
                if (own == "unassigned")
                {
                    if (!string.IsNullOrWhiteSpace(v.OwnerMemberId)) return false;
                }
                else if (!string.Equals(v.OwnerMemberId, own, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            if (string.IsNullOrEmpty(q)) return true;

            return v.Label.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.ExternalReferenceId.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.ProfileDir.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.AntidetectProfileId.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.NetworkLabel.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.OwnerMemberName.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.ClientGroup.Contains(q, StringComparison.OrdinalIgnoreCase);
        });
    }

    private void RebuildBulkToolbar(ContentControl host, Action refreshList)
    {
        var selected = _vias.Where(v => _selectedViaIds.Contains(v.ViaId)).ToList();
        if (selected.Count == 0)
        {
            host.Content = null;
            host.Visibility = Visibility.Collapsed;
            return;
        }

        host.Visibility = Visibility.Visible;
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        grid.Children.Add(new TextBlock
        {
            Text = $"Đã chọn {selected.Count} Via — Áp dụng thao tác hàng loạt an toàn:",
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.AccentText,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var btns = new WrapPanel { VerticalAlignment = VerticalAlignment.Center };
        var distPxSel = UiComponents.CreateButton($"Chia Proxy 1:{_config.MaxViasPerProxyInBatch}", ButtonVariant.Primary, FluentIcons.Globe, compact: true, onClick: (_, _) =>
        {
            OpenBulkDistributeProxiesDialog(selected);
        });
        distPxSel.Margin = new Thickness(0, 2, 6, 2);

        var tierSel = UiComponents.CreateButton("Đổi Lớp / Profile", ButtonVariant.Secondary, FluentIcons.People, compact: true, onClick: (_, _) =>
        {
            OpenBulkChangeTierAndSiloDialog(selected);
        });
        tierSel.Margin = new Thickness(0, 2, 6, 2);

        var warmupSel = UiComponents.CreateButton("Đảo Ấm lô chọn", ButtonVariant.Secondary, FluentIcons.CoffeeWarmup, compact: true, onClick: (_, _) =>
        {
            EnqueueKeepAliveVias(selected, $"Đảo Ấm {selected.Count} Via đã chọn", requireConfirm: true);
        });
        warmupSel.Margin = new Thickness(0, 2, 6, 2);

        var checkPxSel = UiComponents.CreateButton("Check Proxy đã chọn", ButtonVariant.Secondary, FluentIcons.Globe, compact: true, onClick: async (_, _) =>
        {
            await CheckSelectedViaProxiesAsync(selected);
            refreshList();
        });
        checkPxSel.Margin = new Thickness(0, 2, 6, 2);

        var provSel = UiComponents.CreateButton("Cấp Extension", ButtonVariant.Secondary, FluentIcons.ShieldCheck, compact: true, onClick: (_, _) =>
        {
            foreach (var v in selected) v.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(v, config: _config);
            AppendLog($"Đã cấp Extension Companion v{DesktopAppInfo.ExtVersion} cho {selected.Count} Via đã chọn.");
            MessageBox.Show(this, $"Đã cấp Extension cho {selected.Count} Via.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
        });
        provSel.Margin = new Thickness(0, 2, 6, 2);

        var clearSel = UiComponents.CreateButton("Bỏ chọn", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
        {
            _selectedViaIds.Clear();
            refreshList();
        });
        clearSel.Margin = new Thickness(0, 2, 0, 2);

        btns.Children.Add(distPxSel);
        btns.Children.Add(tierSel);
        btns.Children.Add(warmupSel);
        btns.Children.Add(checkPxSel);
        btns.Children.Add(provSel);
        btns.Children.Add(clearSel);
        Grid.SetColumn(btns, 1);
        grid.Children.Add(btns);

        host.Content = UiComponents.CreateCard(grid, new Thickness(12, 8, 12, 8), ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
    }

    private Border BuildViaRowCard(ViaWorkspaceEntry v, Action refreshList)
    {
        var grid = new Grid { MinHeight = 72 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.45, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var cb = new CheckBox
        {
            IsChecked = _selectedViaIds.Contains(v.ViaId),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        cb.Checked += (_, _) => { _selectedViaIds.Add(v.ViaId); refreshList(); };
        cb.Unchecked += (_, _) => { _selectedViaIds.Remove(v.ViaId); refreshList(); };
        Grid.SetColumn(cb, 0);
        grid.Children.Add(cb);

        // Col 1: Identity + Badges
        var idStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 10, 0) };
        var titleRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };
        titleRow.Children.Add(new TextBlock
        {
            Text = v.Label,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 2),
        });

        var tierPill = v.RoleTier switch
        {
            "vault" or "hold" => UiComponents.CreateBadgePill("HOLD BM", ThemeTokens.PurpleText, ThemeTokens.PurpleBg, ThemeTokens.PurpleBorder),
            "standby" => UiComponents.CreateBadgePill("DỰ PHÒNG", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
            _ => UiComponents.CreateBadgePill("LÊN CAMP", ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder),
        };
        tierPill.Margin = new Thickness(0, 0, 6, 2);
        titleRow.Children.Add(tierPill);

        var (wmFg, wmBg, wmBd) = v.WarmupPhase switch
        {
            "72h_lock" => (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder),
            "7d_warmup" => (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
            _ => (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder),
        };
        var wmPill = UiComponents.CreateBadgePill(v.WarmupLabel, wmFg, wmBg, wmBd);
        wmPill.Margin = new Thickness(0, 0, 6, 2);
        titleRow.Children.Add(wmPill);

        var (trFg, trBg, trBd) = v.TrustScore >= 75
            ? (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder)
            : v.TrustScore >= 50
                ? (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder)
                : (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
        var trustPill = UiComponents.CreateBadgePill($"Trust {v.TrustScore}/100", trFg, trBg, trBd);
        trustPill.ToolTip = string.IsNullOrWhiteSpace(v.TrustSummary) ? "Điểm Tin Cậy Môi Trường" : v.TrustSummary;
        trustPill.Margin = new Thickness(0, 0, 6, 2);
        titleRow.Children.Add(trustPill);

        if (!string.IsNullOrWhiteSpace(v.ClientGroup))
        {
            var siloPill = UiComponents.CreateBadgePill($"Silo: {v.ClientGroup}", ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
            siloPill.ToolTip = $"Khách hàng riêng: {v.ClientGroup} (cách ly chéo Proxy & Chrome Profile)";
            siloPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(siloPill);
        }

        if (v.IsInCooldown)
        {
            var cdPill = UiComponents.CreateBadgePill("❄️ COOLDOWN", ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
            cdPill.ToolTip = $"Đóng băng đến {v.CooldownUntilUtc!.Value.ToLocalTime():dd/MM HH:mm}: {v.CooldownReason}";
            cdPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(cdPill);
        }

        if (v.HasSiloConflict)
        {
            var confPill = UiComponents.CreateBadgePill("⚠️ TRÙNG SILO", ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
            confPill.ToolTip = v.SiloConflictDetail;
            confPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(confPill);
        }

        var normEngine = AntidetectBrowserConnector.NormalizeEngine(v.AntidetectEngine);
        var engineBadgeText = normEngine == "chrome_native"
            ? "Chrome Gốc"
            : $"🎭 {AntidetectBrowserConnector.GetDisplayName(normEngine)}" + (string.IsNullOrWhiteSpace(v.AntidetectProfileId) ? "" : $" #{v.AntidetectProfileId}");
        var engPill = UiComponents.CreateBadgePill(
            engineBadgeText,
            normEngine == "chrome_native" ? ThemeTokens.TextSecondary : ThemeTokens.AccentText,
            ThemeTokens.BgSurfaceElevated,
            ThemeTokens.BorderSubtle);
        engPill.Margin = new Thickness(0, 0, 6, 2);
        titleRow.Children.Add(engPill);

        if (!string.IsNullOrWhiteSpace(v.OwnerMemberName))
        {
            var ownPill = UiComponents.CreateBadgePill($"👤 {v.OwnerMemberName}", ThemeTokens.PurpleText, ThemeTokens.PurpleBg, ThemeTokens.PurpleBorder);
            ownPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(ownPill);
        }

        if (v.IsBrowserRunning)
        {
            var ramPill = UiComponents.CreateBadgePill($"⚡ {v.ActiveRamMb:0}MB • {v.ActiveCpuPercent:0.0}%", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
            ramPill.ToolTip = $"Đang chạy trực tiếp ({v.ActiveRamMb:0.0} MB RAM / {v.ActiveCpuPercent:0.0}% CPU)";
            ramPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(ramPill);
        }

        if (v.HasTimezoneMismatch)
        {
            var tzPill = UiComponents.CreateBadgePill("🕒 LỆCH MÚI GIỜ IP", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
            tzPill.ToolTip = v.TimezoneWarning;
            tzPill.Margin = new Thickness(0, 0, 6, 2);
            titleRow.Children.Add(tzPill);
        }

        var ckPill = v.HasVaultCookie
            ? UiComponents.CreateBadgePill("🍪 Cookie Két", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder)
            : UiComponents.CreateBadgePill("⚠️ Chưa lưu Cookie", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
        ckPill.ToolTip = v.HasVaultCookie
            ? "Đã lưu Cookie c_user/xs dự phòng trong Két DPAPI Local — sẵn sàng tự nạp khi mở Chrome cô lập & Auto-Failover"
            : "Chưa có Cookie dự phòng trong Két DPAPI Local. Bấm nút 🔑 (Két DPAPI) hoặc chạy Đảo Ấm để lưu.";
        ckPill.Margin = new Thickness(0, 0, 6, 2);
        titleRow.Children.Add(ckPill);
        idStack.Children.Add(titleRow);

        var uidDisplay = string.IsNullOrWhiteSpace(v.ExternalReferenceId) ? "UID: —" : $"UID: {v.ExternalReferenceId}";
        var dispName = string.IsNullOrWhiteSpace(v.DisplayName) ? "" : $" • {v.DisplayName}";
        idStack.Children.Add(new TextBlock
        {
            Text = $"{uidDisplay}{dispName} • Cầm {v.HoldingPagesCount}/{v.HoldingLimit} Page • Hôm nay {v.CreatedTodayCount}/{v.DailyLimit}",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(idStack, 1);
        grid.Children.Add(idStack);

        // Col 2: Profile + Proxy + Keep-Alive
        var netStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        var parsedProxy = ExtensionProvisioner.ParseProxy(v.NetworkLabel);
        var proxyDesc = string.IsNullOrWhiteSpace(v.NetworkLabel)
            ? "Mạng: IP Trực tiếp (Chưa gắn Proxy)"
            : parsedProxy != null
                ? $"Proxy: {parsedProxy.Host}:{parsedProxy.Port}"
                : $"Proxy: {v.NetworkLabel}";

        netStack.Children.Add(new TextBlock
        {
            Text = $"Chrome: {v.ProfileDir}  •  {v.BundledAccounts.Count} TKQC",
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 0, 0, 3),
        });

        // Honest proxy & keep-alive state (NEVER fake 0ms!)
        var proxyHealthText = v.ProxyLastStatus switch
        {
            "LIVE" => v.ProxyLatencyMs.HasValue ? $"LIVE ({v.ProxyLatencyMs.Value}ms)" : "LIVE (Chưa đo ms)",
            "DEAD" => "DEAD / Lỗi",
            "DIRECT" => "Direct IP",
            _ => "Chưa kiểm",
        };
        var keepText = v.NeedsKeepAlive ? $"Cần Đảo Ấm ({v.IdleDays:0.#}d)" : $"Ấm ({v.IdleDays:0.#}d)";
        netStack.Children.Add(new TextBlock
        {
            Text = $"{proxyDesc} • {proxyHealthText} • {keepText}",
            FontSize = 12,
            Foreground = v.ProxyLastStatus == "DEAD" || v.NeedsKeepAlive ? ThemeTokens.WarningText : ThemeTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(netStack, 2);
        grid.Children.Add(netStack);

        // Col 3: Live 6-digit 2FA OTP widget
        var otpBox = new Grid { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        otpBox.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        otpBox.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var codeTb = new TextBlock
        {
            Text = "—",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.AccentText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var remainTb = new TextBlock
        {
            Text = "—",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
        };
        var remainPill = new Border
        {
            Background = ThemeTokens.NeutralBg,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(6, 2, 6, 2),
            Margin = new Thickness(6, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Child = remainTb,
        };

        var leftOtp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        leftOtp.Children.Add(codeTb);
        leftOtp.Children.Add(remainPill);
        otpBox.Children.Add(leftOtp);

        var copyBtn = UiComponents.CreateButton(
            "",
            ButtonVariant.Secondary,
            FluentIcons.Copy,
            compact: true,
            onClick: (_, _) => CopyViaTotpToClipboard(v, codeTb),
            tooltip: v.HasLocalTwoFa ? "Copy mã 2FA 6 số" : "Bấm để gắn mã 2FA / Cookie vào Két DPAPI");
        Grid.SetColumn(copyBtn, 1);
        otpBox.Children.Add(copyBtn);

        _liveTotpBindings.Add(new LiveTotpBinding(v.ViaId, v.ProfileDir, v.Label, v.TwoFaSecret, codeTb, remainTb, remainPill));
        var otpBorder = UiComponents.CreateCard(otpBox, new Thickness(8, 6, 8, 6), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
        otpBorder.Margin = new Thickness(0, 0, 10, 0);
        otpBorder.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(otpBorder, 3);
        grid.Children.Add(otpBorder);

        // Col 4: Row Actions (RBAC-guarded Launch)
        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var canLaunch = CanCurrentUserLaunchVia(v, out var denyReason);
        var launchBtnLabel = normEngine == "chrome_native" ? "Mở Chrome" : $"Mở {AntidetectBrowserConnector.GetDisplayName(normEngine)}";
        var openBtn = UiComponents.CreateButton(
            canLaunch ? launchBtnLabel : "🔒 Đã khóa",
            ButtonVariant.Primary,
            FluentIcons.RocketLaunch,
            compact: true,
            onClick: (_, _) => LaunchViaChromeSafe(v, "https://www.facebook.com/"),
            tooltip: canLaunch ? $"Mở trình duyệt an toàn ({launchBtnLabel})" : denyReason);
        openBtn.IsEnabled = canLaunch;
        openBtn.Margin = new Thickness(0, 0, 6, 0);
        actions.Children.Add(openBtn);

        if (!string.IsNullOrWhiteSpace(v.NetworkLabel))
        {
            var testIpBtn = UiComponents.CreateButton("Test IP", ButtonVariant.Secondary, FluentIcons.Globe, compact: true, onClick: async (_, _) =>
            {
                await CheckSelectedViaProxiesAsync(new List<ViaWorkspaceEntry> { v });
                RenderCurrentView();
            }, tooltip: "Kiểm tra nhanh Proxy Live/Dead cho Via này");
            testIpBtn.Margin = new Thickness(0, 0, 6, 0);
            actions.Children.Add(testIpBtn);
        }

        var warmBtn = UiComponents.CreateButton("", ButtonVariant.Secondary, FluentIcons.CoffeeWarmup, compact: true, onClick: (_, _) => EnqueueKeepAliveVias(new[] { v }, $"Đảo Ấm {v.Label}", requireConfirm: false), tooltip: "Đảo Ấm thụ động cho Via này");
        warmBtn.Margin = new Thickness(0, 0, 6, 0);

        var vaultBtn = UiComponents.CreateButton("", ButtonVariant.Secondary, FluentIcons.Key, compact: true, onClick: (_, _) => OpenLocalVaultDialog(v), tooltip: "Quản lý Cookie & 2FA trong Két DPAPI Local");
        vaultBtn.Margin = new Thickness(0, 0, 6, 0);

        var editBtn = UiComponents.CreateButton("", ButtonVariant.Secondary, FluentIcons.Edit, compact: true, onClick: (_, _) => OpenViaEditorDialog(v), tooltip: "Chỉnh sửa thông tin Via");
        editBtn.Margin = new Thickness(0, 0, 6, 0);

        var archBtn = UiComponents.CreateButton("", ButtonVariant.Subtle, FluentIcons.Delete, compact: true, onClick: async (_, _) =>
        {
            var confirm = UiComponents.ShowConfirmActionDialog(
                this,
                "Lưu trữ (Archive) Via",
                $"Ẩn Via '{v.Label}' khỏi danh sách hoạt động trên Cloud?",
                new (string, string)[] { ("Via:", v.Label), ("Profile:", v.ProfileDir), ("Page đang cầm:", $"{v.HoldingPagesCount} Page") },
                "Cookie & 2FA local trong DPAPI vẫn được giữ an toàn trên máy Windows này.",
                "Xác nhận Lưu trữ",
                isDanger: true);
            if (!confirm) return;
            try
            {
                await _api.ArchivePersonalAccountAsync(v.ViaId);
                AppendLog($"Đã lưu trữ Via '{v.Label}'.");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi lưu trữ Via: {ex.Message}"); }
        }, tooltip: "Lưu trữ Via");

        actions.Children.Add(warmBtn);
        actions.Children.Add(vaultBtn);
        actions.Children.Add(editBtn);
        actions.Children.Add(archBtn);
        Grid.SetColumn(actions, 4);
        grid.Children.Add(actions);

        var card = UiComponents.CreateCard(grid, new Thickness(12, 10, 12, 10));
        card.Margin = new Thickness(0, 0, 0, 8);
        return card;
    }

    // ------------------------------------------------------------------------
    // VIEW 3: TRUNG TÂM TỰ ĐỘNG HÓA (AUTOMATION HUB)
    // ------------------------------------------------------------------------
    private UIElement BuildAutomationView()
    {
        var stack = new StackPanel();
        stack.Children.Add(BuildQueueRunnerBanner(alwaysShow: true));

        var cols = new Grid();
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.15, GridUnitType.Star) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // Left: Batch Create Fanpages via Safe Staggered Queue
        var batchStack = new StackPanel();
        batchStack.Children.Add(new TextBlock
        {
            Text = "Tạo Page Hàng Loạt Theo Nhịp An Toàn (Multi-Via Queue)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 4),
        });
        batchStack.Children.Add(new TextBlock
        {
            Text = "Hệ thống chọn các Via còn hạn mức (Quota SAFE), nghỉ giãn cách + Jitter ngẫu nhiên và tự kiểm tra Proxy trước khi mở Chrome Profile.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var cbNiche = UiComponents.CreateComboBox(PageNicheTemplates.All.Select(t => new ComboBoxItem { Content = $"{t.Label} ({t.DefaultCategory})", Tag = t.Key }));
        var nicheIdx = PageNicheTemplates.All.ToList().FindIndex(t => t.Key == _batchNicheKey);
        if (nicheIdx >= 0) cbNiche.SelectedIndex = nicheIdx;
        cbNiche.SelectionChanged += (_, _) => _batchNicheKey = (cbNiche.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? PageNicheTemplates.All[0].Key;

        var bmList = new List<ComboBoxItem> { new() { Content = "(Không gắn sẵn — Kéo BM sau khi ngâm)", Tag = "" } };
        bmList.AddRange(_bms.Select(b => new ComboBoxItem { Content = $"{b.Name} ({b.ExternalId ?? b.Id})", Tag = b.Id }));
        var cbBm = UiComponents.CreateComboBox(bmList);
        var bmIdx = bmList.FindIndex(i => string.Equals(i.Tag?.ToString(), _batchOwnerBmId, StringComparison.OrdinalIgnoreCase));
        if (bmIdx >= 0) cbBm.SelectedIndex = bmIdx;
        cbBm.SelectionChanged += (_, _) => _batchOwnerBmId = (cbBm.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "";

        var numRow = new Grid { Margin = new Thickness(0, 8, 0, 8) };
        numRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        numRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        numRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        numRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        numRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });

        var tbCount = UiComponents.CreateTextBox(_batchCount.ToString());
        tbCount.TextChanged += (_, _) => { if (int.TryParse(tbCount.Text, out var n)) _batchCount = Math.Clamp(n, 1, 20); };

        var tbStagger = UiComponents.CreateTextBox(_batchStaggerSec.ToString());
        tbStagger.TextChanged += (_, _) => { if (int.TryParse(tbStagger.Text, out var n)) _batchStaggerSec = Math.Clamp(n, 30, 600); };

        var tbPrefix = UiComponents.CreateTextBox(_batchPrefix, "VD: Lumi Spa");
        tbPrefix.TextChanged += (_, _) => _batchPrefix = tbPrefix.Text;

        var c1 = BuildLabeledBox("Số Page (1-20)", tbCount);
        var c2 = BuildLabeledBox("Nghỉ cơ sở (giây)", tbStagger);
        var c3 = BuildLabeledBox("Tiền tố Thương hiệu", tbPrefix);
        Grid.SetColumn(c1, 0);
        Grid.SetColumn(c2, 2);
        Grid.SetColumn(c3, 4);
        numRow.Children.Add(c1);
        numRow.Children.Add(c2);
        numRow.Children.Add(c3);

        var tbCustomNames = UiComponents.CreateTextBox(_batchCustomNames, "Mỗi dòng 1 tên Page riêng (để trống nếu muốn hệ thống tự phối tên theo ngành)", multiline: true, height: 76);
        tbCustomNames.TextChanged += (_, _) => _batchCustomNames = tbCustomNames.Text;

        var chkAutoSubmit = UiComponents.CreateCheckBox("Extension tự điền Tên / Ngành / Bio và nhấn Tạo Page khi Chrome mở", _batchAutoSubmit);
        chkAutoSubmit.Margin = new Thickness(0, 8, 0, 12);
        chkAutoSubmit.Checked += (_, _) => _batchAutoSubmit = true;
        chkAutoSubmit.Unchecked += (_, _) => _batchAutoSubmit = false;

        batchStack.Children.Add(BuildLabeledBox("Ngành hàng & Kịch bản bài đăng Warmup", cbNiche));
        var bmWrap = BuildLabeledBox("BM Đích (tùy chọn)", cbBm);
        bmWrap.Margin = new Thickness(0, 8, 0, 0);
        batchStack.Children.Add(bmWrap);
        batchStack.Children.Add(numRow);
        batchStack.Children.Add(BuildLabeledBox("Danh sách Tên Page tùy chọn (1 dòng / Page)", tbCustomNames));
        batchStack.Children.Add(chkAutoSubmit);

        var runBatchBtn = UiComponents.CreateButton("Khởi chạy Hàng đợi Tạo Page An Toàn", ButtonVariant.Primary, FluentIcons.Play, onClick: async (_, _) =>
        {
            if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
            {
                MessageBox.Show(this, "Hàng đợi khác đang chạy. Vui lòng tạm dừng hoặc dừng trước.", "Đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var safeVias = _pagesSummary?.QuotaAlertsSummary?.MaxSafeBatchNow ?? _vias.Count;
            var confirm = UiComponents.ShowConfirmActionDialog(
                this,
                "Xác nhận Chạy Hàng đợi Tạo Page",
                $"Sắp gửi lệnh tạo {_batchCount} Fanpage lên Cloud và xếp lịch mở lần lượt qua Chrome Profile thật.",
                new (string, string)[]
                {
                    ("Ngành hàng:", PageNicheTemplates.All.FirstOrDefault(x => x.Key == _batchNicheKey)?.Label ?? _batchNicheKey),
                    ("Số lượng yêu cầu:", $"{_batchCount} Page (Max SAFE hiện tại: {safeVias})"),
                    ("Nghỉ giãn cách:", $"~{_batchStaggerSec}s ± 35% Jitter + IP Guard (Tạo Page: tối đa {Math.Clamp(_config.MaxPagesPerProxyInBatch, 1, 20)}/IP • Nuôi: {_config.MaxViasPerProxyInBatch}/IP)"),
                    ("Chế độ Extension:", _batchAutoSubmit ? "Tự điền & Tạo Page + đăng Warmup" : "Chỉ điền sẵn biểu mẫu để kiểm tra"),
                },
                "Các Via hết hạn mức ngày/tuần sẽ được Backend tự động bỏ qua để bảo vệ Trust tài khoản.");
            if (!confirm) return;

            try
            {
                var req = new ViaBatchCreateRequestDto
                {
                    Count = _batchCount,
                    NicheKey = _batchNicheKey,
                    BrandPrefix = _batchPrefix.Trim(),
                    CustomNames = _batchCustomNames.Trim(),
                    OwnerBmId = _batchOwnerBmId,
                    StaggerSeconds = _batchStaggerSec,
                    AutoSubmit = _batchAutoSubmit,
                };
                var resp = await _api.ViaBatchCreatePagesAsync(req);
                AppendLog($"Backend đã cấp {resp.CreatedCount}/{resp.RequestedCount} nhiệm vụ Tạo Page (bỏ qua quota: {resp.SkippedDueToQuota}).");
                if (!string.IsNullOrWhiteSpace(resp.QuotaWarningMessage))
                {
                    AppendLog($"Lưu ý Quota: {resp.QuotaWarningMessage}");
                }

                var tasks = resp.BatchItems.Select(b =>
                {
                    var mv = _vias.FirstOrDefault(v => string.Equals(v.ViaId, b.ViaId, StringComparison.OrdinalIgnoreCase));
                    return new QueueTaskItem(
                        b.ViaId,
                        b.ViaLabel,
                        GetEffectiveBatchProfileKey(mv, b.BrowserProfile),
                        b.NetworkLabel,
                        string.IsNullOrWhiteSpace(b.LaunchUrl) ? "https://www.facebook.com/pages/creation" : b.LaunchUrl,
                        $"Tạo Page: {b.PageName}",
                        "standard_via",
                        mv?.ClientGroup ?? "",
                        mv?.IsInSoakQuarantine ?? false,
                        mv?.CooldownUntilUtc,
                        mv?.HasSiloConflict ?? false,
                        mv?.SiloConflictDetail ?? "");
                }).ToList();

                if (tasks.Count == 0)
                {
                    MessageBox.Show(this, resp.QuotaWarningMessage ?? "Không có Via nào còn Quota hợp lệ lúc này.", "Hết Quota an toàn", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                _queue.StartQueue(
                    QueueKind.PageCreation,
                    tasks,
                    _batchStaggerSec,
                    _config.PreCheckProxyBeforeLaunch,
                    Math.Clamp(_config.MaxPagesPerProxyInBatch, 1, 20),
                    _config.AutoKeepAliveStartHour,
                    _config.AutoKeepAliveEndHour,
                    enforceDaytimeWindow: true,
                    enforceSoakQuarantine: _config.EnforceSoakQuarantine,
                    enforceClientSilo: _config.EnforceClientSilo,
                    interleaveByProxy: true,
                    sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
                    maxConcurrentBrowsers: GetEffectiveMaxConcurrentBrowsers(),
                    maxDirectIpVias: _config.MaxDirectIpViasInBatch);
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi khởi tạo Tạo Page hàng loạt: {ex.Message}");
                MessageBox.Show(this, ex.Message, "Lỗi Tạo Page hàng loạt", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        });
        batchStack.Children.Add(runBatchBtn);

        var autoLeftStack = new StackPanel();

        // Team Playbooks Marketplace & Jittered Multi-Platform Batch Runner (v2.6.0)
        var pbPanel = new StackPanel();
        var pbHdr = new Grid { Margin = new Thickness(0, 0, 0, 6) };
        pbHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        pbHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        pbHdr.Children.Add(new TextBlock
        {
            Text = "📚 Chợ Kịch Bản Team (Meta / Google Ads / TikTok) & Chạy Lô Lệch Pha",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });
        var newPbBtn = UiComponents.CreateButton("➕ Tạo Kịch bản", ButtonVariant.Secondary, compact: true, onClick: (_, _) => OpenCreatePlaybookDialog(() => RenderCurrentView()));
        Grid.SetColumn(newPbBtn, 1);
        pbHdr.Children.Add(newPbBtn);
        pbPanel.Children.Add(pbHdr);

        var pbPlatWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
        foreach (var (pk, plbl) in new[] { ("all", "Tất cả"), ("meta", "Meta Ads"), ("google_ads", "Google Ads"), ("tiktok", "TikTok Ads"), ("multi", "Đa nền tảng") })
        {
            pbPlatWrap.Children.Add(UiComponents.CreateFilterChip(plbl, string.Equals(_playbookPlatformFilter, pk, StringComparison.OrdinalIgnoreCase), (_, _) =>
            {
                _playbookPlatformFilter = pk;
                RenderCurrentView();
            }));
        }
        pbPanel.Children.Add(pbPlatWrap);

        var effectivePlaybooks = _playbooks.Count > 0 ? _playbooks : AutomationPlaybookDto.GetDefaultBuiltinPlaybooks();
        var filteredPbs = effectivePlaybooks
            .Where(p => string.Equals(_playbookPlatformFilter, "all", StringComparison.OrdinalIgnoreCase) || string.Equals(p.Platform, _playbookPlatformFilter, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (filteredPbs.Count == 0)
        {
            pbPanel.Children.Add(new TextBlock
            {
                Text = "Không có kịch bản nào thuộc nền tảng này.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
            });
        }
        else
        {
            var pbCombo = UiComponents.CreateComboBox(filteredPbs.Select(p =>
            {
                var ratingTxt = p.RatingCount > 0 && p.AvgRating.HasValue ? $"★{p.AvgRating.Value:0.0} ({p.RatingCount})" : "Chưa đánh giá";
                return new ComboBoxItem
                {
                    Content = $"[{p.Platform.ToUpperInvariant()}] {p.Title} (v{p.VersionTag} • {ratingTxt} • {p.RunCount} lượt)",
                    Tag = p.Id,
                };
            }));
            var selPbIdx = filteredPbs.FindIndex(p => string.Equals(p.Id, _selectedPlaybookId, StringComparison.OrdinalIgnoreCase));
            if (selPbIdx < 0) selPbIdx = 0;
            pbCombo.SelectedIndex = selPbIdx;
            var activePb = filteredPbs[selPbIdx];
            _selectedPlaybookId = activePb.Id;
            pbCombo.SelectionChanged += (_, _) =>
            {
                _selectedPlaybookId = (pbCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "";
                RenderCurrentView();
            };
            pbPanel.Children.Add(pbCombo);

            pbPanel.Children.Add(new TextBlock
            {
                Text = $"{activePb.Description}\nBước 1: {activePb.Steps.FirstOrDefault()?.Target ?? "https://www.facebook.com/"} • Giãn cách: {activePb.DefaultStaggerSec}s ±{activePb.JitterPct}% Jitter • Tác giả: {activePb.AuthorName}",
                FontSize = 11.5,
                Foreground = ThemeTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 6, 0, 8),
            });

            var pbActions = new WrapPanel();
            var runPbBtn = UiComponents.CreateButton("Chạy Lô Kịch bản (Jitter)", ButtonVariant.Primary, FluentIcons.Play, compact: true, onClick: async (_, _) =>
            {
                if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
                {
                    MessageBox.Show(this, "Hàng đợi đang chạy dở. Hãy tạm dừng hoặc dừng trước.", "Đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                var targets = _selectedViaIds.Count > 0
                    ? _vias.Where(v => _selectedViaIds.Contains(v.ViaId) && CanCurrentUserLaunchVia(v, out _)).ToList()
                    : _vias.Where(v => !v.IsInCooldown && CanCurrentUserLaunchVia(v, out _)).Take(10).ToList();
                if (targets.Count == 0)
                {
                    MessageBox.Show(this, "Không có Via hợp lệ (hoặc bạn không đủ quyền trên các Via đã chọn).", "Không thể chạy", MessageBoxButton.OK, MessageBoxImage.Information);
                    return;
                }
                var targetUrl = activePb.Steps.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.Target) && s.Target.StartsWith("https://", StringComparison.OrdinalIgnoreCase))?.Target
                                ?? "https://www.facebook.com/";
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
                if (!confirmPb) return;

                var qTasks = targets.Select(v => new QueueTaskItem(
                    v.ViaId,
                    v.Label,
                    GetEffectiveBatchProfileKey(v, v.ProfileDir),
                    v.NetworkLabel,
                    targetUrl,
                    $"{activePb.Platform.ToUpperInvariant()}: {activePb.Title}",
                    v.BackendTier,
                    v.ClientGroup,
                    v.IsInSoakQuarantine,
                    v.CooldownUntilUtc,
                    v.HasSiloConflict,
                    v.SiloConflictDetail)).ToList();

                qTasks = QueueResumeStateStore.FilterRemainingItems(QueueKind.KeepAlive, qTasks, out var resumedPbSkip);
                if (resumedPbSkip > 0)
                {
                    AppendLog($"♻️ Khôi phục Hàng đợi Kịch bản: Bỏ qua {resumedPbSkip} Via đã chạy trước đó, chạy tiếp {qTasks.Count} Via.");
                }

                _queue.StartQueue(
                    QueueKind.KeepAlive,
                    qTasks,
                    activePb.DefaultStaggerSec,
                    _config.PreCheckProxyBeforeLaunch,
                    _config.MaxViasPerProxyInBatch,
                    _config.AutoKeepAliveStartHour,
                    _config.AutoKeepAliveEndHour,
                    enforceDaytimeWindow: true,
                    enforceSoakQuarantine: _config.EnforceSoakQuarantine,
                    enforceClientSilo: _config.EnforceClientSilo,
                    interleaveByProxy: true,
                    sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
                    maxConcurrentBrowsers: GetEffectiveMaxConcurrentBrowsers(),
                    maxDirectIpVias: _config.MaxDirectIpViasInBatch);
                try
                {
                    var updated = await _api.RecordPlaybookRunAsync(activePb.Id, targets.Select(t => t.ViaId), _config.DefaultBrowserEngine, activePb.DefaultStaggerSec, activePb.JitterPct, Environment.MachineName);
                    var idx = _playbooks.FindIndex(p => p.Id == updated.Id);
                    if (idx >= 0) _playbooks[idx] = updated;
                }
                catch { }
                AppendLog($"📚 Đã khởi chạy kịch bản '{activePb.Title}' cho {qTasks.Count} Via (Jitter ±{activePb.JitterPct}%, max {GetEffectiveMaxConcurrentBrowsers()} luồng RAM).");
                RenderCurrentView();
            });
            runPbBtn.Margin = new Thickness(0, 0, 8, 4);
            pbActions.Children.Add(runPbBtn);

            for (int star = 1; star <= 5; star++)
            {
                int capturedStar = star;
                var isMine = activePb.MyRating == capturedStar;
                var rateBtn = UiComponents.CreateButton(
                    isMine ? $"★{capturedStar}" : $"☆{capturedStar}",
                    isMine ? ButtonVariant.Success : ButtonVariant.Subtle,
                    compact: true,
                    onClick: async (_, _) =>
                    {
                        try
                        {
                            var updated = await _api.RatePlaybookAsync(activePb.Id, capturedStar);
                            var idx = _playbooks.FindIndex(p => p.Id == updated.Id);
                            if (idx >= 0) _playbooks[idx] = updated;
                            RenderCurrentView();
                        }
                        catch (Exception ex) { AppendLog($"Lỗi đánh giá kịch bản: {ex.Message}"); }
                    },
                    tooltip: $"Chấm {capturedStar} sao cho kịch bản này");
                rateBtn.Margin = new Thickness(0, 0, 3, 4);
                pbActions.Children.Add(rateBtn);
            }
            pbPanel.Children.Add(pbActions);
        }

        var pbCard = UiComponents.CreateCard(pbPanel);
        pbCard.Margin = new Thickness(0, 0, 0, 14);
        autoLeftStack.Children.Add(pbCard);

        var leftCard = UiComponents.CreateCard(batchStack);
        autoLeftStack.Children.Add(leftCard);
        Grid.SetColumn(autoLeftStack, 0);
        cols.Children.Add(autoLeftStack);

        // Right: Local Guard Settings + Cloud Cron & Warmup
        var rightStack = new StackPanel();

        var localGuardPanel = new StackPanel();
        localGuardPanel.Children.Add(new TextBlock
        {
            Text = "Cấu hình Bảo vệ Trust & Đảo Ấm (Local Runner)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var chkAutoKa = UiComponents.CreateCheckBox("Tự động chạy Đảo Ấm khi phát hiện Via >3 ngày không hoạt động", _config.AutoKeepAliveScheduler);
        var chkPrePx = UiComponents.CreateCheckBox("Kiểm tra Proxy Live trước khi mở Chrome (Proxy Die tự bỏ qua)", _config.PreCheckProxyBeforeLaunch);
        var chkAutoClose = UiComponents.CreateCheckBox("Tự đóng tab Đảo Ấm sau khi cuộn xong Newsfeed + Thông báo", _config.AutoCloseKeepAliveTab);
        var chkAutoCloseWin = UiComponents.CreateCheckBox("Tự đóng gọn cửa sổ Chrome của Via ngay khi nhận tín hiệu KEEPALIVE_OK", _config.AutoCloseKeepAliveWindow);
        chkAutoKa.Margin = new Thickness(0, 0, 0, 6);
        chkPrePx.Margin = new Thickness(0, 0, 0, 6);
        chkAutoClose.Margin = new Thickness(0, 0, 0, 6);
        chkAutoCloseWin.Margin = new Thickness(0, 0, 0, 10);

        var guardNums = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbStartH = UiComponents.CreateTextBox(_config.AutoKeepAliveStartHour.ToString());
        var tbEndH = UiComponents.CreateTextBox(_config.AutoKeepAliveEndHour.ToString());
        var tbMaxPerIp = UiComponents.CreateTextBox(_config.MaxViasPerProxyInBatch.ToString());
        var tbMaxDirect = UiComponents.CreateTextBox(_config.MaxDirectIpViasInBatch.ToString());
        var g1 = BuildLabeledBox("Giờ bắt đầu", tbStartH);
        var g2 = BuildLabeledBox("Giờ nghỉ đêm", tbEndH);
        var g3 = BuildLabeledBox("Max Via/Proxy", tbMaxPerIp);
        var g4 = BuildLabeledBox("Max Direct IP/ca", tbMaxDirect);
        Grid.SetColumn(g1, 0);
        Grid.SetColumn(g2, 2);
        Grid.SetColumn(g3, 4);
        Grid.SetColumn(g4, 6);
        guardNums.Children.Add(g1);
        guardNums.Children.Add(g2);
        guardNums.Children.Add(g3);
        guardNums.Children.Add(g4);

        var localBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var saveLocalBtn = UiComponents.CreateButton("Lưu Luật Bảo vệ", ButtonVariant.Secondary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            _config.AutoKeepAliveScheduler = chkAutoKa.IsChecked == true;
            _config.PreCheckProxyBeforeLaunch = chkPrePx.IsChecked == true;
            _config.AutoCloseKeepAliveTab = chkAutoClose.IsChecked == true;
            _config.AutoCloseKeepAliveWindow = chkAutoCloseWin.IsChecked == true;
            if (int.TryParse(tbStartH.Text, out var sh)) _config.AutoKeepAliveStartHour = Math.Clamp(sh, 0, 22);
            if (int.TryParse(tbEndH.Text, out var eh)) _config.AutoKeepAliveEndHour = Math.Clamp(eh, 1, 23);
            if (int.TryParse(tbMaxPerIp.Text, out var mp)) _config.MaxViasPerProxyInBatch = Math.Clamp(mp, 1, 50);
            if (int.TryParse(tbMaxDirect.Text, out var mdp)) _config.MaxDirectIpViasInBatch = Math.Clamp(mdp, 1, 20);
            _config.Save();
            ApplyUpdatedProxyClusterLimits();
            AppendLog($"Đã lưu cấu hình An toàn Hàng đợi & Cụm Proxy (tối đa {_config.MaxViasPerProxyInBatch} Via/Proxy, {_config.MaxDirectIpViasInBatch} Direct IP/ca).");
            RenderCurrentView();
        });
        saveLocalBtn.Margin = new Thickness(0, 0, 8, 0);
        var runKaNow = UiComponents.CreateButton("Đảo Ấm Via quá hạn ngay", ButtonVariant.Primary, FluentIcons.CoffeeWarmup, onClick: (_, _) => StartKeepAliveDueQueue(requireConfirm: true));
        localBtns.Children.Add(saveLocalBtn);
        localBtns.Children.Add(runKaNow);

        localGuardPanel.Children.Add(chkAutoKa);
        localGuardPanel.Children.Add(chkPrePx);
        localGuardPanel.Children.Add(chkAutoClose);
        localGuardPanel.Children.Add(chkAutoCloseWin);
        localGuardPanel.Children.Add(guardNums);
        localGuardPanel.Children.Add(localBtns);

        var localCard = UiComponents.CreateCard(localGuardPanel);
        localCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(localCard);

        // Anti-Checkpoint Shield, 72h Soak & Client Silo Card
        var shieldPanel = new StackPanel();
        shieldPanel.Children.Add(new TextBlock
        {
            Text = $"🛡️ Khiên Chống Checkpoint, Ngâm 72h & Cách Ly Đa Khách Hàng ({DesktopAppInfo.DisplayVersion})",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.SuccessText,
            Margin = new Thickness(0, 0, 0, 8),
        });

        var chkSoak72 = UiComponents.CreateCheckBox("Khóa Tạo Page 72h khi mới thêm Via hoặc đổi Proxy (chỉ cho Đảo Ấm thụ động)", _config.EnforceSoakQuarantine);
        var chkSiloIso = UiComponents.CreateCheckBox("Cách ly Silo Khách hàng (Chặn trùng Proxy / Profile chéo giữa các khách)", _config.EnforceClientSilo);
        var chkIpKill = UiComponents.CreateCheckBox($"Bật IP Leak Kill-Switch thời gian thực trong Chrome Extension v{DesktopAppInfo.ExtVersion}", _config.IpLeakKillSwitchEnabled);
        var chkAutoCookie = UiComponents.CreateCheckBox("Tự đồng bộ làm mới Cookie về Két DPAPI sau mỗi phiên Đảo Ấm OK", _config.AutoRefreshCookieAfterKeepAlive);
        chkSoak72.Margin = new Thickness(0, 0, 0, 5);
        chkSiloIso.Margin = new Thickness(0, 0, 0, 5);
        chkIpKill.Margin = new Thickness(0, 0, 0, 5);
        chkAutoCookie.Margin = new Thickness(0, 0, 0, 10);

        var shieldGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        shieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        shieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        shieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.8, GridUnitType.Star) });
        shieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        shieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.8, GridUnitType.Star) });

        var cbDefWMode = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Nuôi Tương Tác Thật (Feed + Watch + Notif)", Tag = "human_organic" },
            new ComboBoxItem { Content = "Ngâm 72h Thụ Động (Chỉ Feed + Notif)", Tag = "soak_72h" },
            new ComboBoxItem { Content = "Nuôi Cầm BM (Anti-Deep-Link)", Tag = "bm_warmup" },
            new ComboBoxItem { Content = "Trước Lên Camp (Feed + Pages)", Tag = "pre_camp" },
        });
        cbDefWMode.SelectedIndex = ViaMetadataParser.NormalizeWarmupMode(_config.DefaultWarmupMode) switch
        {
            "soak_72h" => 1,
            "bm_warmup" => 2,
            "pre_camp" => 3,
            _ => 0,
        };
        var tbSoakHrs = UiComponents.CreateTextBox(_config.SoakQuarantineHours.ToString());
        var tbCooldownHrs = UiComponents.CreateTextBox(_config.AutoCooldownHours.ToString());

        var sb1 = BuildLabeledBox("Kịch bản Nuôi mặc định", cbDefWMode);
        var sb2 = BuildLabeledBox("Ngâm (giờ)", tbSoakHrs);
        var sb3 = BuildLabeledBox("Cooldown (giờ)", tbCooldownHrs);
        Grid.SetColumn(sb1, 0);
        Grid.SetColumn(sb2, 2);
        Grid.SetColumn(sb3, 4);
        shieldGrid.Children.Add(sb1);
        shieldGrid.Children.Add(sb2);
        shieldGrid.Children.Add(sb3);

        var shieldBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var saveShieldBtn = UiComponents.CreateButton("Lưu Khiên Bảo vệ & Cập nhật Extension", ButtonVariant.Primary, FluentIcons.ShieldCheck, onClick: (_, _) =>
        {
            _config.EnforceSoakQuarantine = chkSoak72.IsChecked == true;
            _config.EnforceClientSilo = chkSiloIso.IsChecked == true;
            _config.IpLeakKillSwitchEnabled = chkIpKill.IsChecked == true;
            _config.AutoRefreshCookieAfterKeepAlive = chkAutoCookie.IsChecked == true;
            _config.DefaultWarmupMode = (cbDefWMode.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "human_organic";
            if (int.TryParse(tbSoakHrs.Text, out var sh)) _config.SoakQuarantineHours = Math.Clamp(sh, 12, 336);
            if (int.TryParse(tbCooldownHrs.Text, out var ch)) _config.AutoCooldownHours = Math.Clamp(ch, 1, 168);
            _config.Save();
            var provisioned = ProvisionAllViaExtensions(silent: true);
            AppendLog($"Đã lưu Khiên Chống Checkpoint v{DesktopAppInfo.Version} (Soak {_config.SoakQuarantineHours}h, Cooldown {_config.AutoCooldownHours}h, Mode={_config.DefaultWarmupMode}) và cập nhật {provisioned} Extension v{DesktopAppInfo.ExtVersion}.");
            RenderCurrentView();
        });
        saveShieldBtn.Margin = new Thickness(0, 0, 8, 0);
        var openStewLogBtn = UiComponents.CreateButton("Nhật ký Bảo vệ", ButtonVariant.Secondary, FluentIcons.Diagnostic, onClick: (_, _) => OpenStewardshipLogDialog());
        shieldBtns.Children.Add(saveShieldBtn);
        shieldBtns.Children.Add(openStewLogBtn);

        shieldPanel.Children.Add(chkSoak72);
        shieldPanel.Children.Add(chkSiloIso);
        shieldPanel.Children.Add(chkIpKill);
        shieldPanel.Children.Add(chkAutoCookie);
        shieldPanel.Children.Add(shieldGrid);
        shieldPanel.Children.Add(shieldBtns);

        var shieldCard = UiComponents.CreateCard(shieldPanel);
        shieldCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(shieldCard);

        // Active Chrome Session Tracker Card (PID & RAM)
        var chromeSessPanel = new StackPanel();
        var sessHdr = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        sessHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        sessHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        sessHdr.Children.Add(new TextBlock
        {
            Text = "Phiên Chrome Đang Mở (PID & RAM)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var sessActions = new StackPanel { Orientation = Orientation.Horizontal };
        void AddTileBtn(string g)
        {
            var b = UiComponents.CreateButton($"Xếp {g.Replace("x", "×")}", ButtonVariant.Secondary, compact: true, onClick: (_, _) => TileActiveChromeWindows(g));
            b.Margin = new Thickness(0, 0, 4, 0);
            sessActions.Children.Add(b);
        }
        AddTileBtn("2x2");
        AddTileBtn("3x2");
        AddTileBtn("2x1");
        var refreshSessBtn = UiComponents.CreateButton("Làm mới", ButtonVariant.Subtle, FluentIcons.Sync, compact: true, onClick: (_, _) => RenderCurrentView());
        sessActions.Children.Add(refreshSessBtn);
        Grid.SetColumn(sessActions, 1);
        sessHdr.Children.Add(sessActions);
        chromeSessPanel.Children.Add(sessHdr);

        var curWsMem = _workstationMem ?? WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        var recWsCap = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(_config.LowRamFarmMode, curWsMem);
        chromeSessPanel.Children.Add(new TextBlock
        {
            Text = $"RAM máy trống: {curWsMem.AvailablePhysicalMb:N0}/{curWsMem.TotalPhysicalMb:N0} MB ({100 - (int)curWsMem.MemoryLoadPercent}%) • Max luồng hiệu lực: {GetEffectiveMaxConcurrentBrowsers()} (Gợi ý phần cứng: {recWsCap}) • Watchdog: {_config.BrowserHangTimeoutSeconds}s",
            FontSize = 11.5,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 0, 0, 4),
            TextWrapping = TextWrapping.Wrap,
        });

        var isoRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 8) };
        if (_config.UseIsolatedProfiles)
        {
            isoRow.Children.Add(UiComponents.CreateBadgePill("🔒 Chế độ: Chrome Cô lập thông minh (Tự mở Profile gốc nếu chưa lưu Cookie)", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder));
        }
        else
        {
            var enableIsoBtn = UiComponents.CreateButton("🔒 Bật Cô lập Chrome ngay (Khắc phục tự chuyển tab/thoát)", ButtonVariant.Primary, compact: true, onClick: (_, _) =>
            {
                _config.UseIsolatedProfiles = true;
                _config.Save();
                AppendLog("🔒 Đã bật chế độ Chrome Cô lập (--user-data-dir) để chạy song song không bị gộp tab.");
                RenderCurrentView();
            });
            isoRow.Children.Add(enableIsoBtn);
        }
        chromeSessPanel.Children.Add(isoRow);

        var trackedSessions = ChromeSessionTracker.Default.GetSnapshot();
        if (trackedSessions.Count == 0)
        {
            chromeSessPanel.Children.Add(new TextBlock
            {
                Text = "Chưa mở phiên Chrome nào từ AdsOps Desktop Pro trong phiên làm việc này.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }
        else
        {
            foreach (var s in trackedSessions.Take(8))
            {
                var rowGrid = new Grid();
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var metaCol = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
                metaCol.Children.Add(new TextBlock
                {
                    Text = $"{s.ViaLabel} • {s.ProfileDir}",
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = ThemeTokens.TextPrimary,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                metaCol.Children.Add(new TextBlock
                {
                    Text = $"Mở lúc {s.StartedAt.ToLocalTime():HH:mm:ss} • {s.Url}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 11,
                    Foreground = ThemeTokens.TextMuted,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                rowGrid.Children.Add(metaCol);

                var badgeFg = s.KeepAliveClosed ? ThemeTokens.AccentText : s.Alive ? ThemeTokens.SuccessText : ThemeTokens.TextMuted;
                var badgeBg = s.KeepAliveClosed ? ThemeTokens.InfoBg : s.Alive ? ThemeTokens.SuccessBg : ThemeTokens.BgSurfaceElevated;
                var badgeBr = s.KeepAliveClosed ? ThemeTokens.InfoBorder : s.Alive ? ThemeTokens.SuccessBorder : ThemeTokens.BorderSubtle;
                var stBadge = UiComponents.CreateBadgePill(s.StatusText, badgeFg, badgeBg, badgeBr);
                stBadge.Margin = new Thickness(0, 0, 6, 0);
                Grid.SetColumn(stBadge, 1);
                rowGrid.Children.Add(stBadge);

                if (s.Alive && s.Pid.HasValue)
                {
                    var closeWinBtn = UiComponents.CreateButton(
                        s.DelegatedToSharedBroker ? "Gỡ theo dõi" : "Đóng cửa sổ",
                        s.DelegatedToSharedBroker ? ButtonVariant.Secondary : ButtonVariant.Danger,
                        compact: true,
                        onClick: (_, _) =>
                        {
                            ChromeSessionTracker.Default.TryCloseSession(s.SessionId, out var msg);
                            AppendLog(msg);
                            RefreshLiveSessionTelemetryOnVias();
                            RenderCurrentView();
                        });
                    Grid.SetColumn(closeWinBtn, 2);
                    rowGrid.Children.Add(closeWinBtn);
                }

                var rowCard = UiComponents.CreateCard(rowGrid, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
                rowCard.Margin = new Thickness(0, 0, 0, 6);
                chromeSessPanel.Children.Add(rowCard);
            }
        }

        var chromeSessCard = UiComponents.CreateCard(chromeSessPanel);
        chromeSessCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(chromeSessCard);

        // Cloud Cron Config Card
        var cronPanel = new StackPanel();
        cronPanel.Children.Add(new TextBlock
        {
            Text = "Tự động hóa Cloud Server (Cron & Nuôi Page)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 8),
        });

        var chkCloudSync = UiComponents.CreateCheckBox("Tự động đồng bộ Meta BM/TKQC trên Cloud", _cronStatus?.AutoMetaSyncEnabled ?? false);
        var chkCloudWarm = UiComponents.CreateCheckBox("Tự động lên lịch Nuôi bài Fanpage định kỳ", _cronStatus?.AutoPageWarmupEnabled ?? false);
        chkCloudSync.Margin = new Thickness(0, 0, 0, 6);
        chkCloudWarm.Margin = new Thickness(0, 0, 0, 10);

        var cronNums = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        cronNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cronNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        cronNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbSyncInt = UiComponents.CreateTextBox((_cronStatus?.SyncIntervalMinutes ?? 60).ToString());
        var tbWarmGap = UiComponents.CreateTextBox((_cronStatus?.WarmupMinGapHours ?? 8).ToString());
        var cn1 = BuildLabeledBox("Chu kỳ đồng bộ (phút)", tbSyncInt);
        var cn2 = BuildLabeledBox("Giãn cách bài Warmup (giờ)", tbWarmGap);
        Grid.SetColumn(cn1, 0);
        Grid.SetColumn(cn2, 2);
        cronNums.Children.Add(cn1);
        cronNums.Children.Add(cn2);

        var cronBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var saveCronBtn = UiComponents.CreateButton("Lưu Cloud Cron", ButtonVariant.Secondary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            try
            {
                var si = int.TryParse(tbSyncInt.Text, out var x) ? Math.Clamp(x, 10, 1440) : 60;
                var wg = int.TryParse(tbWarmGap.Text, out var y) ? Math.Clamp(y, 1, 72) : 8;
                _cronStatus = await _api.SaveAutomationCronConfigAsync(chkCloudSync.IsChecked == true, si, chkCloudWarm.IsChecked == true, wg);
                AppendLog("Đã lưu cấu hình Cloud Cron.");
            }
            catch (Exception ex) { AppendLog($"Lỗi lưu Cloud Cron: {ex.Message}"); }
        });
        saveCronBtn.Margin = new Thickness(0, 0, 8, 0);
        var runCronNow = UiComponents.CreateButton("Chạy Cloud Cron ngay", ButtonVariant.Success, FluentIcons.Play, onClick: async (_, _) =>
        {
            try
            {
                await _api.RunAutomationCronNowAsync();
                AppendLog("Đã kích hoạt Cloud Cron chạy ngay (Sync + Warmup).");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi chạy Cloud Cron: {ex.Message}"); }
        });
        cronBtns.Children.Add(saveCronBtn);
        cronBtns.Children.Add(runCronNow);

        cronPanel.Children.Add(chkCloudSync);
        cronPanel.Children.Add(chkCloudWarm);
        cronPanel.Children.Add(cronNums);
        cronPanel.Children.Add(new TextBlock
        {
            Text = $"Lần chạy cuối: {(string.IsNullOrWhiteSpace(_cronStatus?.LastRunAt) ? "Chưa chạy" : _cronStatus!.LastRunAt)}",
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            Margin = new Thickness(0, 0, 0, 8),
        });
        cronPanel.Children.Add(cronBtns);

        rightStack.Children.Add(UiComponents.CreateCard(cronPanel));

        Grid.SetColumn(rightStack, 2);
        cols.Children.Add(rightStack);
        stack.Children.Add(cols);
        return stack;
    }

    // ------------------------------------------------------------------------
    // VIEW 4: FANPAGE & BM
    // ------------------------------------------------------------------------
    private UIElement BuildPagesBmView()
    {
        var stack = new StackPanel();
        var listHost = new StackPanel();

        // Business Managers Strip (Always visible + Create BM)
        var bmHeaderRow = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        bmHeaderRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bmHeaderRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bmHeaderRow.Children.Add(new TextBlock
        {
            Text = $"Business Manager đang quản lý ({_bms.Count})",
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var addBmBtn = UiComponents.CreateButton("Thêm BM", ButtonVariant.Primary, FluentIcons.Add, compact: true, onClick: (_, _) => OpenCreateBusinessManagerDialog());
        Grid.SetColumn(addBmBtn, 1);
        bmHeaderRow.Children.Add(addBmBtn);
        stack.Children.Add(bmHeaderRow);

        if (_bms.Count == 0)
        {
            var emptyBm = UiComponents.CreateCard(new TextBlock
            {
                Text = "Chưa có Business Manager nào trên Workspace. Nhấn '+ Thêm BM' hoặc gắn Token EAAB để tự đồng bộ.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
            }, new Thickness(12, 10, 12, 10));
            emptyBm.Margin = new Thickness(0, 0, 0, 12);
            stack.Children.Add(emptyBm);
        }
        else
        {
            var bmWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 12) };
            foreach (var bm in _bms)
            {
                var bp = new StackPanel();
                bp.Children.Add(new TextBlock { Text = bm.Name, FontSize = 13, FontWeight = FontWeights.Bold, Foreground = ThemeTokens.TextPrimary });
                bp.Children.Add(new TextBlock { Text = $"ID: {bm.ExternalId ?? "—"} • {bm.Status}", FontFamily = ThemeTokens.MonoFont, FontSize = 12, Foreground = ThemeTokens.TextMuted, Margin = new Thickness(0, 2, 0, 6) });
                var openBmBtn = UiComponents.CreateButton("Mở Cài đặt BM", ButtonVariant.Secondary, FluentIcons.Globe, compact: true, onClick: (_, _) =>
                {
                    var holdVia = _vias.FirstOrDefault(v => v.RoleTier is "vault" or "hold") ?? _vias.FirstOrDefault();
                    if (holdVia == null) return;
                    var url = string.IsNullOrWhiteSpace(bm.ExternalId)
                        ? "https://business.facebook.com/settings"
                        : $"https://business.facebook.com/settings/pages?business_id={Uri.EscapeDataString(bm.ExternalId)}";
                    LaunchViaChromeSafe(holdVia, url);
                });
                bp.Children.Add(openBmBtn);
                var c = UiComponents.CreateCard(bp, new Thickness(12, 9, 12, 9));
                c.MinWidth = 230;
                c.Margin = new Thickness(0, 0, 10, 8);
                bmWrap.Children.Add(c);
            }
            stack.Children.Add(bmWrap);
        }

        stack.Children.Add(BuildPixelsAndDomainSeoRow());

        void RefreshPagesList()
        {
            listHost.Children.Clear();
            var allPages = _pagesSummary?.Items ?? new();
            var q = (_pageSearch ?? "").Trim();
            var filtered = allPages.Where(p =>
            {
                var okTab = _pageFilter switch
                {
                    "unsynced" => p.IsUnsyncedDraft,
                    "need_claim" => string.IsNullOrWhiteSpace(p.OwnerBmId),
                    "need_warmup" => !p.AdsReady || p.WarmupPostsCount < 2,
                    "restricted" => !p.HealthStatus.Equals("LIVE", StringComparison.OrdinalIgnoreCase) || !p.ContagionRisk.Equals("SAFE", StringComparison.OrdinalIgnoreCase),
                    _ => true,
                };
                if (!okTab) return false;
                if (string.IsNullOrEmpty(q)) return true;
                return p.Name.Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (p.ExternalPageId ?? "").Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (p.HolderLabel ?? "").Contains(q, StringComparison.OrdinalIgnoreCase);
            }).ToList();

            if (allPages.Count == 0)
            {
                listHost.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.Page,
                    "Chưa có Fanpage nào được đồng bộ",
                    "Nhấn Đồng bộ Page từ Meta để quét toàn bộ Fanpage từ Token / BM hiện có.",
                    "Đồng bộ Page từ Meta",
                    async (_, _) => await RunMetaPageSyncAsync()));
                return;
            }

            if (filtered.Count == 0)
            {
                listHost.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.Search,
                    "Không có Fanpage nào khớp bộ lọc",
                    "Thử thay đổi bộ lọc trạng thái hoặc từ khóa tìm kiếm."));
                return;
            }

            foreach (var p in filtered)
            {
                listHost.Children.Add(BuildPageRowCard(p));
            }
        }

        // Static Search & Action Bar
        var barStack = new StackPanel();
        var topSearch = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        topSearch.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topSearch.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var sb = UiComponents.CreateTextBox(_pageSearch, "Tìm theo tên Page, ID Page, Via cầm...");
        sb.TextChanged += (_, _) => { _pageSearch = sb.Text; RefreshPagesList(); };
        topSearch.Children.Add(sb);

        var rBtns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 0, 0) };
        var exportPagesBtn = UiComponents.CreateButton("Xuất CSV", ButtonVariant.Secondary, FluentIcons.Upload, onClick: (_, _) => ExportPagesCsv(), tooltip: "Xuất danh sách Fanpage ra CSV chuẩn Excel UTF-8");
        exportPagesBtn.Margin = new Thickness(0, 0, 8, 0);
        var syncPagesBtn = UiComponents.CreateButton("Đồng bộ Page Meta", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await RunMetaPageSyncAsync());
        syncPagesBtn.Margin = new Thickness(0, 0, 8, 0);
        var batchWarmBtn = UiComponents.CreateButton("Nuôi lô (Max 10)", ButtonVariant.Success, FluentIcons.Send, onClick: async (_, _) =>
        {
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                "Nuôi lô tối đa 10 Fanpage",
                "Đăng bài nuôi tự nhiên qua Graph API / Assist cho tối đa 10 Page đến hạn.",
                new (string, string)[] { ("Phạm vi:", "Tối đa 10 Page"), ("Hình thức:", "Bài viết an toàn theo ngách") },
                "Hệ thống tự tuân thủ khoảng cách thời gian giữa các bài đăng.");
            if (!ok) return;
            try
            {
                var r = await _api.BatchWarmupPagesAsync(10);
                AppendLog($"Nuôi lô Fanpage: {r.NurturedCount} Page (Graph: {r.GraphPublishedCount}).");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi nuôi lô Page: {ex.Message}"); }
        });
        rBtns.Children.Add(exportPagesBtn);
        rBtns.Children.Add(syncPagesBtn);
        rBtns.Children.Add(batchWarmBtn);
        Grid.SetColumn(rBtns, 1);
        topSearch.Children.Add(rBtns);
        barStack.Children.Add(topSearch);

        var chips = new WrapPanel();
        var pagesAll = _pagesSummary?.Items ?? new();
        void AddPChip(string key, string lbl)
        {
            chips.Children.Add(UiComponents.CreateFilterChip(lbl, _pageFilter == key, (_, _) => { _pageFilter = key; RenderCurrentView(); }));
        }
        AddPChip("all", $"Tất cả ({pagesAll.Count})");
        AddPChip("unsynced", $"Nháp chưa khớp ({pagesAll.Count(x => x.IsUnsyncedDraft)})");
        AddPChip("need_claim", $"Chưa kéo BM ({pagesAll.Count(x => string.IsNullOrWhiteSpace(x.OwnerBmId))})");
        AddPChip("need_warmup", $"Cần Ngâm/Nuôi ({pagesAll.Count(x => !x.AdsReady)})");
        AddPChip("restricted", $"Rủi ro/Hạn chế ({pagesAll.Count(x => !x.HealthStatus.Equals("LIVE", StringComparison.OrdinalIgnoreCase))})");
        barStack.Children.Add(chips);

        var filterCard = UiComponents.CreateCard(barStack, new Thickness(12));
        filterCard.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(filterCard);
        stack.Children.Add(listHost);

        RefreshPagesList();
        return stack;
    }

    private Border BuildPageRowCard(FanpageItemDto p)
    {
        var grid = new Grid { MinHeight = 68 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        var top = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };

        var live = p.HealthStatus.Equals("LIVE", StringComparison.OrdinalIgnoreCase);
        var healthPill = UiComponents.CreateBadgePill(
            p.IsUnsyncedDraft ? "NHÁP" : p.HealthStatus,
            live ? ThemeTokens.SuccessText : ThemeTokens.DangerText,
            live ? ThemeTokens.SuccessBg : ThemeTokens.DangerBg,
            live ? ThemeTokens.SuccessBorder : ThemeTokens.DangerBorder);
        healthPill.Margin = new Thickness(0, 0, 6, 0);
        top.Children.Add(healthPill);

        if (p.AdsReady)
        {
            var readyPill = UiComponents.CreateBadgePill("Sẵn sàng Ads", ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
            readyPill.Margin = new Thickness(0, 0, 8, 0);
            top.Children.Add(readyPill);
        }
        else if (p.SoakRemainingHours > 0)
        {
            var soakPill = UiComponents.CreateBadgePill($"Ngâm còn {p.SoakRemainingHours:0.#}h", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
            soakPill.Margin = new Thickness(0, 0, 8, 0);
            top.Children.Add(soakPill);
        }

        top.Children.Add(new TextBlock { Text = p.Name, FontSize = 14, FontWeight = FontWeights.Bold, Foreground = ThemeTokens.TextPrimary, VerticalAlignment = VerticalAlignment.Center });
        left.Children.Add(top);

        var fans = p.FanCount ?? p.FollowersCount;
        var fanStr = fans.HasValue ? $"{fans.Value:N0} theo dõi" : "— theo dõi";
        left.Children.Add(new TextBlock
        {
            Text = $"ID: {p.ExternalPageId ?? "Chờ đồng bộ"} • {p.Category ?? "Chưa rõ ngành"} • {fanStr} • {p.WarmupPostsCount} bài Warmup",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        grid.Children.Add(left);

        var mid = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        mid.Children.Add(new TextBlock
        {
            Text = $"Via cầm: {(string.IsNullOrWhiteSpace(p.HolderLabel) ? "Chưa gắn" : p.HolderLabel)} ({ExtensionProvisioner.ResolveProfileDirectory(p.HolderBrowserProfile, p.HolderLabel)})",
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 0, 0, 2),
        });
        mid.Children.Add(new TextBlock
        {
            Text = $"BM: {(string.IsNullOrWhiteSpace(p.OwnerBmName) ? "Chưa kéo BM" : p.OwnerBmName)} • TKQC: {p.LinkedAdAccountCount} (Hạn chế: {p.RestrictedAdAccountCount})",
            FontSize = 12,
            Foreground = string.IsNullOrWhiteSpace(p.OwnerBmName) ? ThemeTokens.WarningText : ThemeTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(mid, 1);
        grid.Children.Add(mid);

        var btns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var openBtn = UiComponents.CreateButton("Mở Page", ButtonVariant.Secondary, FluentIcons.Globe, compact: true, onClick: (_, _) =>
        {
            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, p.HolderIdentityId, StringComparison.OrdinalIgnoreCase)) ?? _vias.FirstOrDefault();
            var url = !string.IsNullOrWhiteSpace(p.Url) ? p.Url!
                : !string.IsNullOrWhiteSpace(p.ExternalPageId) ? $"https://www.facebook.com/{p.ExternalPageId}"
                : "https://www.facebook.com/pages";
            if (via != null) LaunchViaChromeSafe(via, url);
        });
        openBtn.Margin = new Thickness(0, 0, 6, 0);

        var chkBtn = UiComponents.CreateButton("Check Live", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
        {
            try
            {
                await _api.CheckPageLiveAsync(p.Id);
                AppendLog($"Đã kiểm tra Live cho Page '{p.Name}'.");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi Check Live Page: {ex.Message}"); }
        });
        chkBtn.Margin = new Thickness(0, 0, 6, 0);

        var claimBtn = UiComponents.CreateButton("Kéo BM", ButtonVariant.Primary, compact: true, onClick: (_, _) => OpenClaimBmDialog(p));
        claimBtn.Margin = new Thickness(0, 0, 6, 0);

        var warmBtn = UiComponents.CreateButton("Nuôi bài", ButtonVariant.Success, compact: true, onClick: (_, _) => OpenWarmupPostDialog(p));
        warmBtn.Margin = new Thickness(0, 0, 6, 0);

        btns.Children.Add(openBtn);
        btns.Children.Add(chkBtn);
        btns.Children.Add(claimBtn);
        btns.Children.Add(warmBtn);

        if (p.IsUnsyncedDraft)
        {
            var delBtn = UiComponents.CreateButton("", ButtonVariant.Subtle, FluentIcons.Delete, compact: true, onClick: async (_, _) =>
            {
                var ok = UiComponents.ShowConfirmActionDialog(
                    this,
                    "Xóa Nháp Fanpage",
                    $"Xóa bản nháp '{p.Name}' chưa khớp ID Facebook?",
                    new (string, string)[] { ("Page:", p.Name) },
                    "Thao tác xóa vĩnh viễn bản nháp trên Cloud.",
                    "Xóa Nháp",
                    isDanger: true);
                if (!ok) return;
                try
                {
                    await _api.DiscardPageDraftAsync(p.Id);
                    await SyncCloudAsync(silent: false);
                }
                catch (Exception ex) { AppendLog($"Lỗi xóa nháp: {ex.Message}"); }
            }, tooltip: "Xóa nháp chưa tạo xong");
            btns.Children.Add(delBtn);
        }

        Grid.SetColumn(btns, 2);
        grid.Children.Add(btns);

        var card = UiComponents.CreateCard(grid, new Thickness(12, 10, 12, 10));
        card.Margin = new Thickness(0, 0, 0, 8);
        return card;
    }

    // ------------------------------------------------------------------------
    // VIEW 5: TÀI KHOẢN QUẢNG CÁO (AD ACCOUNTS — RIGHT-ALIGNED TABULAR NUMBERS)
    // ------------------------------------------------------------------------
    private UIElement BuildAdAccountsView()
    {
        var stack = new StackPanel();
        var listHost = new StackPanel();

        void RefreshAdsList()
        {
            listHost.Children.Clear();
            var q = (_adSearch ?? "").Trim();
            var filtered = _adAccounts.Where(a =>
            {
                var active = a.Status.Contains("active", StringComparison.OrdinalIgnoreCase);
                var matchTab = _adFilter switch
                {
                    "active" => active,
                    "disabled" => !active,
                    _ => true,
                };
                if (!matchTab) return false;
                if (string.IsNullOrEmpty(q)) return true;
                return a.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase)
                    || a.ExternalAccountId.Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (a.BusinessManagerName ?? "").Contains(q, StringComparison.OrdinalIgnoreCase);
            }).ToList();

            if (_adAccounts.Count == 0)
            {
                listHost.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.Chart,
                    "Chưa có Tài khoản Quảng cáo nào",
                    "Kết nối Meta Token trên Web hoặc nhấn Quick Sync Meta để nạp danh sách TKQC.",
                    "Quick Sync Meta",
                    async (_, _) =>
                    {
                        try
                        {
                            await _api.QuickSyncMetaAsync();
                            await SyncCloudAsync(silent: false);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi Quick Sync: {ex.Message}"); }
                    }));
                return;
            }

            // Table Header Row (Tabular Right-Aligned Numbers!)
            listHost.Children.Add(BuildAdTableHeader());
            foreach (var acc in filtered)
            {
                listHost.Children.Add(BuildAdTableRow(acc));
            }
        }

        var bar = new StackPanel();
        var topRow = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var sb = UiComponents.CreateTextBox(_adSearch, "Tìm tên TKQC, act_ID, tên BM...");
        sb.TextChanged += (_, _) => { _adSearch = sb.Text; RefreshAdsList(); };
        topRow.Children.Add(sb);

        var adTopBtns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 0, 0) };
        var exportAdsBtn = UiComponents.CreateButton("Xuất CSV", ButtonVariant.Secondary, FluentIcons.Upload, onClick: (_, _) => ExportAdAccountsCsv(), tooltip: "Xuất bảng Tài khoản QC (Số dư / Ngưỡng / Giới hạn) ra CSV");
        exportAdsBtn.Margin = new Thickness(0, 0, 8, 0);
        var qSyncBtn = UiComponents.CreateButton("Quick Sync Meta", ButtonVariant.Primary, FluentIcons.Sync, onClick: async (_, _) =>
        {
            try
            {
                var r = await _api.QuickSyncMetaAsync();
                AppendLog($"Quick Sync Meta: {r.Message ?? "OK"}");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi Quick Sync: {ex.Message}"); }
        });
        adTopBtns.Children.Add(exportAdsBtn);
        adTopBtns.Children.Add(qSyncBtn);
        Grid.SetColumn(adTopBtns, 1);
        topRow.Children.Add(adTopBtns);
        bar.Children.Add(topRow);

        var chips = new WrapPanel();
        void AddAdChip(string key, string lbl)
        {
            chips.Children.Add(UiComponents.CreateFilterChip(lbl, _adFilter == key, (_, _) => { _adFilter = key; RenderCurrentView(); }));
        }
        AddAdChip("all", $"Tất cả ({_adAccounts.Count})");
        AddAdChip("active", $"Active ({_adAccounts.Count(x => x.Status.Contains("active", StringComparison.OrdinalIgnoreCase))})");
        AddAdChip("disabled", $"Hạn chế / Khác ({_adAccounts.Count(x => !x.Status.Contains("active", StringComparison.OrdinalIgnoreCase))})");
        bar.Children.Add(chips);

        if (_spendSummary != null && _spendSummary.Currencies.Count > 0)
        {
            var spendStrip = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
            foreach (var bucket in _spendSummary.Currencies)
            {
                var td = FormatMetricOrDash(bucket.TodayPartialText == "—" ? null : bucket.TodayPartialText, bucket.Currency);
                var d7 = FormatMetricOrDash(bucket.Last7dText == "—" ? null : bucket.Last7dText, bucket.Currency);
                var mtd = FormatMetricOrDash(bucket.MtdText == "—" ? null : bucket.MtdText, bucket.Currency);
                var bPanel = new StackPanel();
                bPanel.Children.Add(new TextBlock
                {
                    Text = $"Tổng chi tiêu {bucket.Currency} ({bucket.AccountsIncluded} TKQC)",
                    FontSize = 11,
                    FontWeight = FontWeights.Bold,
                    Foreground = ThemeTokens.AccentText,
                });
                bPanel.Children.Add(new TextBlock
                {
                    Text = $"Hôm nay: {td}  •  7 ngày: {d7}  •  Tháng này: {mtd}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextPrimary,
                    Margin = new Thickness(0, 3, 0, 0),
                });
                var bCard = UiComponents.CreateCard(bPanel, new Thickness(12, 8, 12, 8), ThemeTokens.BgSurfaceElevated, ThemeTokens.InfoBorder);
                bCard.Margin = new Thickness(0, 0, 10, 6);
                spendStrip.Children.Add(bCard);
            }
            stack.Children.Add(spendStrip);
        }

        var card = UiComponents.CreateCard(bar, new Thickness(12));
        card.Margin = new Thickness(0, 0, 0, 12);
        stack.Children.Add(card);
        stack.Children.Add(listHost);

        RefreshAdsList();
        return stack;
    }

    private static Border BuildAdTableHeader()
    {
        var g = new Grid();
        ConfigureAdColumns(g);
        void AddHdr(int col, string text, HorizontalAlignment align = HorizontalAlignment.Left)
        {
            var tb = new TextBlock
            {
                Text = text,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = ThemeTokens.TextMuted,
                HorizontalAlignment = align,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(col == 6 ? 12 : 0, 0, 0, 0),
            };
            Grid.SetColumn(tb, col);
            g.Children.Add(tb);
        }

        AddHdr(0, "TÀI KHOẢN & ID");
        AddHdr(1, "TRẠNG THÁI");
        AddHdr(2, "SỐ DƯ", HorizontalAlignment.Right);
        AddHdr(3, "NGƯỠNG", HorizontalAlignment.Right);
        AddHdr(4, "GIỚI HẠN NGÀY", HorizontalAlignment.Right);
        AddHdr(5, "CHI TIÊU (HN / 7D)", HorizontalAlignment.Right);
        AddHdr(6, "BM & VIA CẦM");
        AddHdr(7, "THAO TÁC", HorizontalAlignment.Right);

        var b = new Border
        {
            Background = ThemeTokens.BgSurfaceElevated,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8, 8, 0, 0),
            Padding = new Thickness(14, 10, 14, 10),
            Child = g,
        };
        return b;
    }

    private Border BuildAdTableRow(AdAccountItemDto a)
    {
        var g = new Grid { MinHeight = 46 };
        ConfigureAdColumns(g);

        // Col 0: Name + act ID
        var c0 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
        c0.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(a.DisplayName) ? a.ExternalAccountId : a.DisplayName, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
        c0.Children.Add(new TextBlock { Text = $"act_{a.ExternalAccountId} • {a.Currency}", FontFamily = ThemeTokens.MonoFont, FontSize = 12, Foreground = ThemeTokens.TextMuted });
        Grid.SetColumn(c0, 0);
        g.Children.Add(c0);

        // Col 1: Status pill
        var active = a.Status.Contains("active", StringComparison.OrdinalIgnoreCase);
        var stPill = UiComponents.CreateBadgePill(
            string.IsNullOrWhiteSpace(a.Status) ? "CHƯA RÕ" : a.Status.ToUpperInvariant(),
            active ? ThemeTokens.SuccessText : ThemeTokens.DangerText,
            active ? ThemeTokens.SuccessBg : ThemeTokens.DangerBg,
            active ? ThemeTokens.SuccessBorder : ThemeTokens.DangerBorder);
        Grid.SetColumn(stPill, 1);
        g.Children.Add(stPill);

        // Col 2, 3, 4: Right-aligned Tabular Monospace numbers (NEVER fake 0 when null!)
        var bal = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BalanceRaw) ?? AdAccountBillingMetaDto.AsOptionalString(a.SpendPeriods?.BalanceRaw);
        var thr = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BillingThresholdRaw);
        var lim = AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.MetaDailyLimitRaw);

        void AddNum(int col, string? val)
        {
            var tb = new TextBlock
            {
                Text = FormatMetricOrDash(val, a.Currency),
                FontFamily = ThemeTokens.MonoFont,
                FontSize = 13,
                Foreground = string.IsNullOrWhiteSpace(val) ? ThemeTokens.TextMuted : ThemeTokens.TextPrimary,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(tb, col);
            g.Children.Add(tb);
        }
        AddNum(2, bal);
        AddNum(3, thr);
        AddNum(4, lim);

        // Col 5: Spend Today / 7D
        var todayRaw = a.SpendPeriods?.TodayText;
        var last7dRaw = a.SpendPeriods?.Last7dText;
        var cSpend = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) };
        cSpend.Children.Add(new TextBlock
        {
            Text = $"HN: {FormatMetricOrDash(todayRaw, a.Currency)}",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = string.IsNullOrWhiteSpace(todayRaw) ? ThemeTokens.TextMuted : ThemeTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
        });
        cSpend.Children.Add(new TextBlock
        {
            Text = $"7D: {FormatMetricOrDash(last7dRaw, a.Currency)}",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 11,
            Foreground = ThemeTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
        });
        Grid.SetColumn(cSpend, 5);
        g.Children.Add(cSpend);

        // Col 6: BM & Linked Via
        var c5 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 8, 0) };
        var viaLbl = a.FacebookIdentities.Count > 0 ? string.Join(", ", a.FacebookIdentities.Select(x => x.Label)) : "Chưa gắn Via";
        var cardDisp = FormatPaymentCardCompact(a.BillingMeta?.PaymentCardDisplay);
        c5.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(a.BusinessManagerName) ? "Tài khoản Cá nhân / Chưa rõ BM" : a.BusinessManagerName!, FontSize = 12, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
        c5.Children.Add(new TextBlock { Text = string.IsNullOrEmpty(cardDisp) ? $"Via: {viaLbl}" : $"Via: {viaLbl} • {cardDisp}", FontSize = 12, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(c5, 6);
        g.Children.Add(c5);

        // Col 7: Refresh Spend + Open Ads Manager
        var actionCol = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        var refreshSpendBtn = UiComponents.CreateButton("↻", ButtonVariant.Subtle, compact: true, tooltip: "Làm mới số liệu Chi tiêu của TKQC này từ Meta", onClick: async (_, _) =>
        {
            try
            {
                await _api.RefreshAdAccountSpendAsync(a.Id);
                AppendLog($"Đã làm mới Chi tiêu TKQC '{a.DisplayName}' (act_{a.ExternalAccountId}).");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi làm mới Chi tiêu TKQC: {ex.Message}"); }
        });
        refreshSpendBtn.Margin = new Thickness(0, 0, 6, 0);

        var openAdsBtn = UiComponents.CreateButton("Ads Manager", ButtonVariant.Secondary, FluentIcons.RocketLaunch, compact: true, onClick: (_, _) =>
        {
            var linked = a.FacebookIdentities.FirstOrDefault();
            var via = (linked != null ? _vias.FirstOrDefault(v => string.Equals(v.ViaId, linked.Id, StringComparison.OrdinalIgnoreCase)) : null)
                      ?? _vias.FirstOrDefault();
            if (via == null)
            {
                MessageBox.Show(this, "Chưa có Via nào trong hệ thống để mở Chrome.", "Thiếu Via", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var cleanId = (a.ExternalAccountId ?? "").Replace("act_", "", StringComparison.OrdinalIgnoreCase);
            LaunchViaChromeSafe(via, $"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act={Uri.EscapeDataString(cleanId)}");
        });
        actionCol.Children.Add(refreshSpendBtn);
        actionCol.Children.Add(openAdsBtn);
        Grid.SetColumn(actionCol, 7);
        g.Children.Add(actionCol);

        return new Border
        {
            Background = ThemeTokens.BgSurface,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(1, 0, 1, 1),
            Padding = new Thickness(14, 9, 14, 9),
            Child = g,
        };
    }

    private static void ConfigureAdColumns(Grid g)
    {
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.35, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(105) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.15, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(162) });
    }

    internal static string FormatPaymentCardCompact(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (string.IsNullOrEmpty(s)) return "";
        var parenIdx = s.LastIndexOf(" (", StringComparison.Ordinal);
        if (parenIdx > 0 && s.EndsWith(")", StringComparison.Ordinal))
        {
            var head = s[..parenIdx].Trim();
            var inner = s[(parenIdx + 2)..^1].Trim();
            if (string.Equals(head, inner, StringComparison.OrdinalIgnoreCase))
            {
                return head;
            }
        }
        return s;
    }

    internal static string FormatMetricOrDash(string? raw, string currency)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "—";
        if (decimal.TryParse(raw.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
        {
            var numText = (d % 1m == 0m)
                ? d.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))
                : d.ToString("N2", CultureInfo.InvariantCulture);
            return $"{numText} {currency}".Trim();
        }
        return raw.Trim();
    }

    private void LaunchAdsManagerByExternalId(string? externalAccountId, string? preferredViaId = null, string? preferredViaLabel = null)
    {
        var via = (!string.IsNullOrWhiteSpace(preferredViaId) ? _vias.FirstOrDefault(v => string.Equals(v.ViaId, preferredViaId, StringComparison.OrdinalIgnoreCase)) : null)
                  ?? (!string.IsNullOrWhiteSpace(preferredViaLabel) ? _vias.FirstOrDefault(v => string.Equals(v.Label, preferredViaLabel, StringComparison.OrdinalIgnoreCase)) : null)
                  ?? _vias.FirstOrDefault();
        if (via == null)
        {
            MessageBox.Show(this, "Chưa có Via nào trong hệ thống để mở Chrome.", "Thiếu Via", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var cleanId = (externalAccountId ?? "").Replace("act_", "", StringComparison.OrdinalIgnoreCase);
        LaunchViaChromeSafe(via, $"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act={Uri.EscapeDataString(cleanId)}");
    }

    private void ExportViasCsv()
    {
        var headers = new[] { "Ten_Via", "UID_Facebook", "Chrome_Profile", "Nhom", "Silo_Khach_Hang", "Trust_Score", "Ngam_Thiet_Bi", "Proxy_IP", "Trang_Thai_Proxy", "Trang_Thai_Cooldown", "So_Page", "Can_Dao_Am", "Trang_Thai_2FA", "Cookie_DPAPI", "Ghi_Chu" };
        var rows = _vias.Select(v =>
        {
            var sec = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
            var has2Fa = !string.IsNullOrWhiteSpace(v.TwoFaSecret) || !string.IsNullOrWhiteSpace(sec.TwoFaSecret);
            var hasCookie = !string.IsNullOrWhiteSpace(sec.CookieRaw);
            return new string?[]
            {
                v.Label,
                v.ExternalReferenceId,
                v.ProfileDir,
                v.RoleTier,
                v.ClientGroup,
                v.TrustScore.ToString(),
                v.WarmupLabel,
                AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel),
                v.ProxyLastStatus,
                v.IsInCooldown ? $"COOLDOWN ({v.CooldownReason})" : "Binh thuong",
                v.HoldingPagesCount.ToString(),
                v.NeedsKeepAlive ? "Cần Đảo Ấm" : "Ổn định",
                has2Fa ? "Đã gắn 2FA" : "Chưa có",
                hasCookie ? "Đã lưu DPAPI" : "Chưa có",
                v.CleanNotes,
            };
        });
        ExportCsvWithDialog($"adsops-vias-{DateTime.Now:yyyyMMdd-HHmm}.csv", headers, rows, "Danh sách Via");
    }

    private void ExportPagesCsv()
    {
        var items = _pagesSummary?.Items ?? new();
        var headers = new[] { "Ten_Fanpage", "Page_ID", "Trang_Thai", "Hang_Muc", "Followers", "BM_So_Huu", "Via_Cam", "Chrome_Profile", "Bai_Nuoi", "Ads_Ready", "URL" };
        var rows = items.Select(p => new string?[]
        {
            p.Name,
            p.ExternalPageId,
            p.HealthStatus,
            p.Category,
            (p.FollowersCount ?? p.FanCount)?.ToString() ?? "",
            p.OwnerBmName,
            p.HolderLabel,
            p.HolderBrowserProfile,
            p.WarmupPostsCount.ToString(),
            p.AdsReady ? "Sẵn sàng" : (p.SoakRemainingHours > 0 ? $"Ngâm {p.SoakRemainingHours:0}h" : "Chưa đạt"),
            p.Url,
        });
        ExportCsvWithDialog($"adsops-fanpages-{DateTime.Now:yyyyMMdd-HHmm}.csv", headers, rows, "Fanpage");
    }

    private void ExportAdAccountsCsv()
    {
        var headers = new[] { "Ten_TKQC", "Account_ID", "Trang_Thai", "Tien_Te", "So_Du", "Nguong_Billing", "Gioi_Han_Ngay", "Chi_Tieu_Hom_Nay", "Chi_Tieu_7_Ngay", "Chi_Tieu_Thang_Nay", "Business_Manager", "Via_Cam", "The_Thanh_Toan" };
        var rows = _adAccounts.Select(a => new string?[]
        {
            a.DisplayName,
            string.IsNullOrWhiteSpace(a.ExternalAccountId) ? "" : $"act_{a.ExternalAccountId.Replace("act_", "", StringComparison.OrdinalIgnoreCase)}",
            a.Status,
            a.Currency,
            AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BalanceRaw) ?? AdAccountBillingMetaDto.AsOptionalString(a.SpendPeriods?.BalanceRaw) ?? "",
            AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.BillingThresholdRaw) ?? "",
            AdAccountBillingMetaDto.AsOptionalString(a.BillingMeta?.MetaDailyLimitRaw) ?? "",
            a.SpendPeriods?.TodayText ?? "",
            a.SpendPeriods?.Last7dText ?? "",
            a.SpendPeriods?.MtdText ?? "",
            a.BusinessManagerName,
            a.FacebookIdentities.Count > 0 ? string.Join("; ", a.FacebookIdentities.Select(x => x.Label)) : "",
            a.BillingMeta?.PaymentCardDisplay ?? "",
        });
        ExportCsvWithDialog($"adsops-ad-accounts-{DateTime.Now:yyyyMMdd-HHmm}.csv", headers, rows, "Tài khoản Quảng cáo");
    }

    private void ExportHealthCsv()
    {
        var headers = new[] { "Ten_TKQC", "Account_ID", "BM", "Via_Cam", "Suc_Khoe", "Readiness", "Critical", "Warning", "Attention", "Nguyen_Nhan_Chinh", "Cap_Nhat" };
        var rows = _accountHealthRows.Select(r => new string?[]
        {
            r.DisplayName,
            string.IsNullOrWhiteSpace(r.ExternalAccountId) ? "" : $"act_{r.ExternalAccountId.Replace("act_", "", StringComparison.OrdinalIgnoreCase)}",
            r.BusinessManagerName,
            r.PersonalAccountReferenceLabel,
            r.HealthStatus,
            r.ReadinessStatus,
            r.OpenCriticalCount.ToString(),
            r.OpenWarningCount.ToString(),
            r.OpenAttentionCount.ToString(),
            r.GetTopReasonText(),
            r.LastEvaluatedAt,
        });
        ExportCsvWithDialog($"adsops-account-health-{DateTime.Now:yyyyMMdd-HHmm}.csv", headers, rows, "Sức khỏe TKQC");
    }

    // ------------------------------------------------------------------------
    // VIEW 6: SỨC KHỎE TKQC, META TOKEN & PRE-FLIGHT HUB
    // ------------------------------------------------------------------------
    private UIElement BuildHealthTokensView()
    {
        var stack = new StackPanel();

        // Row 1: KPI summary strip
        var kpiGrid = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        for (int i = 0; i < 4; i++)
        {
            if (i > 0) kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
            kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var crit = _healthSummary?.Critical ?? 0;
        var warn = _healthSummary?.Warning ?? 0;
        var clear = _healthSummary?.ClearSignals ?? 0;
        var activeTkqc = _healthSummary?.TotalActive ?? _accountHealthRows.Count;
        var tokenOk = _metaConnections.Count(c => c.TokenConfigured);

        var c1 = UiComponents.CreateMetricCard("Nguy kịch (Critical)", crit.ToString(), $"{warn} Warning • {_healthSummary?.AttentionNeeded ?? 0} cần chú ý", FluentIcons.Warning, crit > 0 ? ThemeTokens.DangerText : ThemeTokens.SuccessText, out _, out _);
        var c2 = UiComponents.CreateMetricCard("TKQC Sạch Tín hiệu", clear.ToString(), $"Tổng {activeTkqc} TKQC đang theo dõi", FluentIcons.ShieldCheck, ThemeTokens.SuccessText, out _, out _);
        var c3 = UiComponents.CreateMetricCard("Meta Token Kết Nối", tokenOk.ToString(), $"{_metaConnections.Count} kết nối ({_healthSummary?.StaleData ?? 0} dữ liệu cũ)", FluentIcons.ShieldKey, tokenOk > 0 ? ThemeTokens.AccentText : ThemeTokens.WarningText, out _, out _);
        var c4 = UiComponents.CreateMetricCard("Pre-flight Drafts", _campaignDrafts.Count.ToString(), $"{_campaignDrafts.Count(d => d.OpenBlockingCount > 0)} nháp bị chặn", FluentIcons.Diagnostic, _campaignDrafts.Any(d => d.OpenBlockingCount > 0) ? ThemeTokens.WarningText : ThemeTokens.AccentText, out _, out _);

        Grid.SetColumn(c1, 0);
        Grid.SetColumn(c2, 2);
        Grid.SetColumn(c3, 4);
        Grid.SetColumn(c4, 6);
        kpiGrid.Children.Add(c1);
        kpiGrid.Children.Add(c2);
        kpiGrid.Children.Add(c3);
        kpiGrid.Children.Add(c4);
        stack.Children.Add(kpiGrid);

        // Section 2: Meta Connections & Quick Sync
        stack.Children.Add(BuildMetaConnectionsCard());

        // Section 3: Account Health filterable rows + CSV export
        stack.Children.Add(BuildAccountHealthCard());

        // Section 4: Pre-flight Campaign Drafts
        stack.Children.Add(BuildCampaignDraftsCard());

        // Section 5: Readiness Board & Blocking Reasons
        stack.Children.Add(BuildReadinessBoardCard());

        // Section 6: Live Audit Logs
        stack.Children.Add(BuildAuditLogsCard());

        return stack;
    }

    private Border BuildMetaConnectionsCard()
    {
        var box = new StackPanel();
        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleCol = new StackPanel();
        titleCol.Children.Add(new TextBlock { Text = "Kết nối Meta Graph API & Token Hệ thống", FontSize = 15, FontWeight = FontWeights.Bold, Foreground = ThemeTokens.TextPrimary });
        titleCol.Children.Add(new TextBlock { Text = "Kiểm tra nhanh khả năng đọc của Meta Token và kích hoạt Quick Sync lấy số liệu TKQC/BM mới nhất.", FontSize = 12, Foreground = ThemeTokens.TextMuted, Margin = new Thickness(0, 2, 0, 0) });
        hdr.Children.Add(titleCol);

        var hdrBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var addTokBtn = UiComponents.CreateButton("Gắn Token EAAB", ButtonVariant.Secondary, FluentIcons.ShieldKey, compact: true, onClick: (_, _) => OpenAutoConnectTokenDialog(null));
        addTokBtn.Margin = new Thickness(0, 0, 8, 0);
        var qSyncBtn = UiComponents.CreateButton("Quick Sync Meta", ButtonVariant.Primary, FluentIcons.Sync, compact: true, onClick: async (_, _) =>
        {
            try
            {
                var r = await _api.QuickSyncMetaAsync();
                AppendLog($"Quick Sync Meta: {r.Message ?? "Hoàn tất"}");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex) { AppendLog($"Lỗi Quick Sync Meta: {ex.Message}"); }
        });
        hdrBtns.Children.Add(addTokBtn);
        hdrBtns.Children.Add(qSyncBtn);
        Grid.SetColumn(hdrBtns, 1);
        hdr.Children.Add(hdrBtns);
        box.Children.Add(hdr);

        if (_metaConnections.Count == 0)
        {
            box.Children.Add(new TextBlock
            {
                Text = "Chưa có Meta Connection hoặc tài khoản hiện tại chưa có quyền xem cấu hình Token (Owner).",
                FontSize = 13,
                Foreground = ThemeTokens.TextMuted,
                Margin = new Thickness(0, 4, 0, 2),
            });
        }
        else
        {
            foreach (var conn in _metaConnections)
            {
                var row = new Grid { Margin = new Thickness(0, 4, 0, 4) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                left.Children.Add(new TextBlock { Text = conn.Label, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary });
                left.Children.Add(new TextBlock { Text = $"Môi trường: {conn.Environment} • Nguồn: {conn.ReaderSource} • BM: {(string.IsNullOrWhiteSpace(conn.BusinessManagerReference) ? "Chưa gắn" : conn.BusinessManagerReference)}", FontSize = 11, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
                row.Children.Add(left);

                var tokPill = UiComponents.CreateBadgePill(
                    conn.TokenConfigured ? $"TOKEN: {conn.Status.ToUpperInvariant()}" : "CHƯA CÓ TOKEN",
                    conn.TokenConfigured ? ThemeTokens.SuccessText : ThemeTokens.WarningText,
                    conn.TokenConfigured ? ThemeTokens.SuccessBg : ThemeTokens.WarningBg,
                    conn.TokenConfigured ? ThemeTokens.SuccessBorder : ThemeTokens.WarningBorder);
                Grid.SetColumn(tokPill, 1);
                row.Children.Add(tokPill);

                var lastChk = new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(conn.LastCapabilityCheckAt) ? "Chưa kiểm tra gần đây" : $"Kiểm tra: {conn.LastCapabilityCheckAt}",
                    FontSize = 12,
                    Foreground = ThemeTokens.TextSecondary,
                    VerticalAlignment = VerticalAlignment.Center,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                };
                Grid.SetColumn(lastChk, 2);
                row.Children.Add(lastChk);

                var cid = conn.Id;
                var clbl = conn.Label;
                var chkBtn = UiComponents.CreateButton("Kiểm tra Token", ButtonVariant.Secondary, FluentIcons.Diagnostic, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        var updated = await _api.CheckMetaConnectionCapabilityAsync(cid);
                        AppendLog($"Đã kiểm tra Token '{clbl}': trạng thái = {updated.Status}.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex)
                    {
                        AppendLog($"Lỗi kiểm tra Token '{clbl}': {ex.Message}");
                    }
                });
                Grid.SetColumn(chkBtn, 3);
                row.Children.Add(chkBtn);

                box.Children.Add(new Border
                {
                    Background = ThemeTokens.BgSurfaceElevated,
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(12, 8, 12, 8),
                    Margin = new Thickness(0, 0, 0, 6),
                    Child = row,
                });
            }
        }

        var card = UiComponents.CreateCard(box, new Thickness(14));
        card.Margin = new Thickness(0, 0, 0, 14);
        return card;
    }

    private UIElement BuildAccountHealthCard()
    {
        var box = new StackPanel();
        var listHost = new StackPanel();

        static (Brush Fg, Brush Bg, Brush Bd) ResolveHealthColors(string? status)
        {
            var s = (status ?? "").Trim().ToLowerInvariant();
            if (s is "critical" or "blocked" or "fail" or "failed")
                return (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
            if (s is "warning" or "attention" or "attention_needed" or "needs_attention")
                return (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
            if (s is "healthy" or "clear" or "ready" or "pass" or "passed" or "ok")
                return (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
            return (ThemeTokens.TextSecondary, ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
        }

        void RefreshHealthList()
        {
            listHost.Children.Clear();
            var q = (_healthSearch ?? "").Trim();
            var filtered = _accountHealthRows.Where(r =>
            {
                var hs = (r.HealthStatus ?? "").Trim().ToLowerInvariant();
                var matchTab = _healthFilter switch
                {
                    "critical" => hs == "critical" || r.OpenCriticalCount > 0,
                    "warning" => hs is "warning" or "attention_needed" || r.OpenWarningCount > 0 || r.OpenAttentionCount > 0,
                    "healthy" => hs is "healthy" or "clear",
                    _ => true,
                };
                if (!matchTab) return false;
                if (string.IsNullOrEmpty(q)) return true;
                return r.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (r.ExternalAccountId ?? "").Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (r.BusinessManagerName ?? "").Contains(q, StringComparison.OrdinalIgnoreCase)
                    || (r.PersonalAccountReferenceLabel ?? "").Contains(q, StringComparison.OrdinalIgnoreCase)
                    || r.GetTopReasonText().Contains(q, StringComparison.OrdinalIgnoreCase);
            }).ToList();

            if (filtered.Count == 0)
            {
                listHost.Children.Add(new TextBlock
                {
                    Text = _accountHealthRows.Count == 0
                        ? "Chưa có báo cáo sức khỏe TKQC nào từ Backend."
                        : "Không có TKQC nào khớp bộ lọc hiện tại.",
                    FontSize = 13,
                    Foreground = ThemeTokens.TextMuted,
                    Margin = new Thickness(0, 8, 0, 8),
                });
                return;
            }

            foreach (var r in filtered)
            {
                var g = new Grid { MinHeight = 46 };
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.5, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var c0 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
                c0.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(r.DisplayName) ? (r.ExternalAccountId ?? r.AdAccountId) : r.DisplayName, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
                c0.Children.Add(new TextBlock { Text = $"act_{r.ExternalAccountId} • BM: {r.BusinessManagerName ?? "—"} • Via: {r.PersonalAccountReferenceLabel ?? "—"}", FontSize = 11, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
                g.Children.Add(c0);

                var (hFg, hBg, hBd) = ResolveHealthColors(r.HealthStatus);
                var hPill = UiComponents.CreateBadgePill(string.IsNullOrWhiteSpace(r.HealthStatus) ? "UNKNOWN" : r.HealthStatus.ToUpperInvariant(), hFg, hBg, hBd);
                Grid.SetColumn(hPill, 1);
                g.Children.Add(hPill);

                var (rdFg, rdBg, rdBd) = ResolveHealthColors(r.ReadinessStatus);
                var rdPill = UiComponents.CreateBadgePill(string.IsNullOrWhiteSpace(r.ReadinessStatus) ? "—" : r.ReadinessStatus.ToUpperInvariant(), rdFg, rdBg, rdBd);
                Grid.SetColumn(rdPill, 2);
                g.Children.Add(rdPill);

                var c3 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 10, 0) };
                c3.Children.Add(new TextBlock { Text = r.GetTopReasonText(), FontSize = 12, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
                c3.Children.Add(new TextBlock { Text = $"Crit: {r.OpenCriticalCount} • Warn: {r.OpenWarningCount} • Attn: {r.OpenAttentionCount}", FontFamily = ThemeTokens.MonoFont, FontSize = 11, Foreground = ThemeTokens.TextMuted });
                Grid.SetColumn(c3, 3);
                g.Children.Add(c3);

                var extId = r.ExternalAccountId;
                var viaHint = r.PersonalAccountReferenceLabel;
                var rowBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                var sigBtn = UiComponents.CreateButton("Tín hiệu", ButtonVariant.Secondary, FluentIcons.Alert, compact: true, onClick: (_, _) => OpenHealthSignalsDialog(r), tooltip: "Xem, Ghi nhận hoặc Đánh dấu Đã xử lý từng tín hiệu sức khỏe");
                sigBtn.Margin = new Thickness(0, 0, 6, 0);
                var recalcBtn = UiComponents.CreateButton("Tính lại", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        SetBusy(true);
                        await _api.RecalculateAccountHealthAsync(r.AdAccountId);
                        AppendLog($"Đã tính lại điểm sức khỏe cho TKQC act_{extId}.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex) { AppendLog($"Lỗi tính lại sức khỏe act_{extId}: {ex.Message}"); }
                    finally { SetBusy(false); }
                }, tooltip: "Tính lại sức khỏe TKQC từ bằng chứng Cloud");
                recalcBtn.Margin = new Thickness(0, 0, 6, 0);
                var adsBtn = UiComponents.CreateButton("Ads Manager", ButtonVariant.Secondary, FluentIcons.RocketLaunch, compact: true, onClick: (_, _) => LaunchAdsManagerByExternalId(extId, preferredViaLabel: viaHint));
                rowBtns.Children.Add(sigBtn);
                rowBtns.Children.Add(recalcBtn);
                rowBtns.Children.Add(adsBtn);
                Grid.SetColumn(rowBtns, 4);
                g.Children.Add(rowBtns);

                listHost.Children.Add(new Border
                {
                    Background = ThemeTokens.BgSurfaceElevated,
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(12, 8, 12, 8),
                    Margin = new Thickness(0, 0, 0, 6),
                    Child = g,
                });
            }
        }

        var topRow = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var sb = UiComponents.CreateTextBox(_healthSearch, "Tìm tên TKQC, act_ID, BM, Via hoặc lý do cảnh báo...");
        sb.TextChanged += (_, _) => { _healthSearch = sb.Text; RefreshHealthList(); };
        topRow.Children.Add(sb);

        var exportHealthBtn = UiComponents.CreateButton("Xuất CSV Sức khỏe", ButtonVariant.Secondary, FluentIcons.Upload, compact: true, onClick: (_, _) => ExportHealthCsv());
        exportHealthBtn.Margin = new Thickness(10, 0, 0, 0);
        Grid.SetColumn(exportHealthBtn, 1);
        topRow.Children.Add(exportHealthBtn);
        box.Children.Add(topRow);

        var chips = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        void AddHChip(string key, string lbl) => chips.Children.Add(UiComponents.CreateFilterChip(lbl, _healthFilter == key, (_, _) => { _healthFilter = key; RenderCurrentView(); }));
        AddHChip("all", $"Tất cả ({_accountHealthRows.Count})");
        AddHChip("critical", $"Critical ({_accountHealthRows.Count(x => string.Equals(x.HealthStatus, "critical", StringComparison.OrdinalIgnoreCase) || x.OpenCriticalCount > 0)})");
        AddHChip("warning", $"Warning/Attn ({_accountHealthRows.Count(x => string.Equals(x.HealthStatus, "warning", StringComparison.OrdinalIgnoreCase) || string.Equals(x.HealthStatus, "attention_needed", StringComparison.OrdinalIgnoreCase) || x.OpenWarningCount > 0 || x.OpenAttentionCount > 0)})");
        AddHChip("healthy", $"Sạch tín hiệu ({_accountHealthRows.Count(x => string.Equals(x.HealthStatus, "healthy", StringComparison.OrdinalIgnoreCase) || string.Equals(x.HealthStatus, "clear", StringComparison.OrdinalIgnoreCase))})");
        box.Children.Add(chips);
        box.Children.Add(listHost);

        RefreshHealthList();
        var card = UiComponents.CreateCard(box, new Thickness(14));
        card.Margin = new Thickness(0, 0, 0, 14);
        return card;
    }

    private Border BuildCampaignDraftsCard()
    {
        var box = new StackPanel();
        box.Children.Add(new TextBlock { Text = "Kiểm tra Pre-flight Chiến dịch Nháp", FontSize = 15, FontWeight = FontWeights.Bold, Foreground = ThemeTokens.TextPrimary });
        box.Children.Add(new TextBlock { Text = "Đánh giá nhanh rủi ro chặn/cảnh báo trước khi lên Camp trên Ads Manager.", FontSize = 12, Foreground = ThemeTokens.TextMuted, Margin = new Thickness(0, 2, 0, 10) });

        if (_campaignDrafts.Count == 0)
        {
            box.Children.Add(new TextBlock
            {
                Text = "Chưa có chiến dịch nháp (Campaign Draft) nào được tạo trong Workspace.",
                FontSize = 13,
                Foreground = ThemeTokens.TextMuted,
            });
        }
        else
        {
            foreach (var d in _campaignDrafts)
            {
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var c0 = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                c0.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(d.Title) ? d.Id : d.Title, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
                c0.Children.Add(new TextBlock { Text = $"TKQC: {d.AccountDisplayName ?? d.AdAccountId ?? "—"} • Mục tiêu: {d.Objective ?? "—"}", FontSize = 11, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
                row.Children.Add(c0);

                var hasBlock = d.OpenBlockingCount > 0;
                var stPill = UiComponents.CreateBadgePill(
                    string.IsNullOrWhiteSpace(d.DraftStatus) ? "DRAFT" : d.DraftStatus.ToUpperInvariant(),
                    hasBlock ? ThemeTokens.DangerText : (d.OpenWarningCount > 0 ? ThemeTokens.WarningText : ThemeTokens.SuccessText),
                    hasBlock ? ThemeTokens.DangerBg : (d.OpenWarningCount > 0 ? ThemeTokens.WarningBg : ThemeTokens.SuccessBg),
                    hasBlock ? ThemeTokens.DangerBorder : (d.OpenWarningCount > 0 ? ThemeTokens.WarningBorder : ThemeTokens.SuccessBorder));
                Grid.SetColumn(stPill, 1);
                row.Children.Add(stPill);

                var cntTb = new TextBlock
                {
                    Text = $"Chặn: {d.OpenBlockingCount} • Cảnh báo: {d.OpenWarningCount}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 12,
                    Foreground = hasBlock ? ThemeTokens.DangerText : ThemeTokens.TextSecondary,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(cntTb, 2);
                row.Children.Add(cntTb);

                var draftId = d.Id;
                var draftTitle = d.Title;
                var evalBtn = UiComponents.CreateButton("Chấm điểm lại", ButtonVariant.Secondary, FluentIcons.Play, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        await _api.EvaluateCampaignDraftAsync(draftId);
                        AppendLog($"Đã chấm điểm Pre-flight cho chiến dịch '{draftTitle}'.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex)
                    {
                        AppendLog($"Lỗi chấm điểm Pre-flight '{draftTitle}': {ex.Message}");
                    }
                });
                Grid.SetColumn(evalBtn, 3);
                row.Children.Add(evalBtn);

                box.Children.Add(new Border
                {
                    Background = ThemeTokens.BgSurfaceElevated,
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(12, 8, 12, 8),
                    Margin = new Thickness(0, 0, 0, 6),
                    Child = row,
                });
            }
        }

        return UiComponents.CreateCard(box, new Thickness(14));
    }

    // ------------------------------------------------------------------------
    // VIEW 7: KÉT KHÓA & CÀI ĐẶT (SETTINGS & DPAPI VAULT)
    // ------------------------------------------------------------------------
    private UIElement BuildSettingsView()
    {
        var cols = new Grid();
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // Left: Cloud Auth + Windows Integration
        var leftStack = new StackPanel();
        var authPanel = new StackPanel();
        authPanel.Children.Add(new TextBlock
        {
            Text = "Kết nối Tài khoản AdsOps Cloud",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var tbBackend = UiComponents.CreateTextBox(_config.BackendBaseUrl);
        var tbEmail = UiComponents.CreateTextBox(_config.UserEmail, "email@domain.com");
        var pbPass = UiComponents.CreatePasswordBox();
        var authMsg = new TextBlock { Text = "", FontSize = 12, Foreground = ThemeTokens.DangerText, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };

        var emailWrap = BuildLabeledBox("Email đăng nhập", tbEmail);
        emailWrap.Margin = new Thickness(0, 8, 0, 8);
        var passWrap = BuildLabeledBox("Mật khẩu Cloud", pbPass);

        authPanel.Children.Add(BuildLabeledBox("Backend API URL", tbBackend));
        authPanel.Children.Add(emailWrap);
        authPanel.Children.Add(passWrap);
        authPanel.Children.Add(authMsg);

        var authBtns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 12, 0, 0) };
        Button loginBtn = null!;
        loginBtn = UiComponents.CreateButton("Đăng nhập & Đồng bộ", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbEmail.Text) || string.IsNullOrWhiteSpace(pbPass.Password))
            {
                authMsg.Text = "Vui lòng nhập đầy đủ Email và Mật khẩu.";
                return;
            }
            loginBtn.IsEnabled = false;
            authMsg.Text = "";
            try
            {
                _config.BackendBaseUrl = tbBackend.Text.Trim().TrimEnd('/');
                _config.UserEmail = tbEmail.Text.Trim();
                _api.Configure(_config.BackendBaseUrl, "");
                var loginRes = await _api.LoginAsync(_config.UserEmail, pbPass.Password);
                _config.SetJwt(loginRes.AccessToken);
                _config.SetSavedPassword(pbPass.Password);
                _config.Save();
                ConfigureApiClient();
                _isAuthExpired = false;
                pbPass.Clear();
                AppendLog($"Đăng nhập Cloud thành công với '{_config.UserEmail}' (JWT & Tự gia hạn phiên được mã hóa Windows DPAPI).");
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                authMsg.Text = $"Đăng nhập thất bại: {ex.Message}";
                loginBtn.IsEnabled = true;
            }
        });
        loginBtn.Margin = new Thickness(0, 0, 8, 0);
        authBtns.Children.Add(loginBtn);

        if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            var logoutBtn = UiComponents.CreateButton("Đăng xuất Cloud", ButtonVariant.Danger, onClick: (_, _) =>
            {
                var ok = UiComponents.ShowConfirmActionDialog(
                    this,
                    "Xác nhận Đăng xuất Cloud",
                    $"Đăng xuất tài khoản '{_config.UserEmail}' khỏi máy tính này?",
                    new (string, string)[] { ("Phiên Cloud:", "Xóa token JWT đã mã hóa"), ("Két DPAPI Local:", "GIỮ NGUYÊN an toàn 100%") },
                    "Cookie và Secret 2FA lưu cục bộ trong két DPAPI vẫn được giữ nguyên.",
                    "Đăng xuất",
                    isDanger: true);
                if (!ok) return;
                _config.SetJwt("");
                _config.SetSavedPassword("");
                _config.Save();
                ConfigureApiClient();
                _isAuthExpired = false;
                _currentUser = null;
                _vias.Clear();
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
                RefreshHeaderAndSidebar();
                RenderCurrentView();
            });
            authBtns.Children.Add(logoutBtn);
        }
        authPanel.Children.Add(authBtns);

        if (_communityQuota != null || _currentUser?.Workspace != null)
        {
            var tierName = (_communityQuota?.PlanTier ?? _currentUser?.Workspace?.PlanTier ?? "agency").ToUpperInvariant();
            var usedV = _communityQuota?.ViasUsed ?? _vias.Count;
            var maxV = _communityQuota?.MaxVias ?? _currentUser?.Workspace?.MaxVias ?? 500;
            var usedA = _communityQuota?.AdAccountsUsed ?? _adAccounts.Count;
            var maxA = _communityQuota?.MaxAdAccounts ?? _currentUser?.Workspace?.MaxAdAccounts ?? 500;
            var quotaSummary = new TextBlock
            {
                Text = $"🎟️ Gói Cộng đồng: {tierName} • Via: {usedV}/{maxV} • TKQC: {usedA}/{maxA}" + (_isOfflineSnapshotMode ? $" (Đệm Offline DPAPI {_offlineSnapshotAt})" : ""),
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = ThemeTokens.AccentText,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 10, 0, 6),
            };
            authPanel.Children.Add(quotaSummary);

            var redeemRow = new Grid();
            redeemRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            redeemRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            redeemRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var tbInviteRedeem = UiComponents.CreateTextBox("", "Nhập Mã Mời / Nâng cấp Pro (VD: ADSOPS-PRO-...)");
            var btnRedeem = UiComponents.CreateButton("Kích hoạt Mã", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
            {
                var code = tbInviteRedeem.Text.Trim();
                if (string.IsNullOrEmpty(code)) return;
                try
                {
                    _communityQuota = await _api.RedeemCommunityCodeAsync(code);
                    AppendLog($"Đã kích hoạt Mã Cộng Đồng '{code.ToUpperInvariant()}' -> Gói {_communityQuota.PlanTier.ToUpperInvariant()} ({_communityQuota.MaxVias} Via).");
                    RenderCurrentView();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "Không nạp được Mã Mời", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            });
            Grid.SetColumn(btnRedeem, 2);
            redeemRow.Children.Add(tbInviteRedeem);
            redeemRow.Children.Add(btnRedeem);
            authPanel.Children.Add(redeemRow);
        }

        var authCard = UiComponents.CreateCard(authPanel);
        authCard.Margin = new Thickness(0, 0, 0, 14);
        leftStack.Children.Add(authCard);

        // Windows & Chrome Integration Card
        var osPanel = new StackPanel();
        osPanel.Children.Add(new TextBlock
        {
            Text = "Tích hợp Windows & Chrome Profiles",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var chkIso = UiComponents.CreateCheckBox("Dùng Profile Cô lập (IsolatedProfiles riêng biệt theo từng Via)", _config.UseIsolatedProfiles);
        chkIso.Checked += (_, _) => { _config.UseIsolatedProfiles = true; _config.Save(); };
        chkIso.Unchecked += (_, _) => { _config.UseIsolatedProfiles = false; _config.Save(); };
        chkIso.Margin = new Thickness(0, 0, 0, 10);
        osPanel.Children.Add(chkIso);

        var osWrap = new WrapPanel();
        void AddOsBtn(Button b) { b.Margin = new Thickness(0, 0, 8, 8); osWrap.Children.Add(b); }

        AddOsBtn(UiComponents.CreateButton(
            ProtocolRegistrar.IsUriProtocolRegistered() ? "Đã gắn Protocol adsops-chrome://" : "Đăng ký Protocol adsops-chrome://",
            ButtonVariant.Secondary,
            FluentIcons.Globe,
            onClick: (_, _) =>
            {
                ProtocolRegistrar.RegisterUriProtocol();
                AppendLog("Đã đăng ký giao thức adsops-chrome:// vào HKCU Registry.");
                RenderCurrentView();
            }));

        var autoStartOn = ProtocolRegistrar.IsAutoStartEnabled();
        AddOsBtn(UiComponents.CreateButton(
            autoStartOn ? "Đang BẬT Khởi động cùng Windows" : "Bật Khởi động cùng Windows",
            autoStartOn ? ButtonVariant.Success : ButtonVariant.Secondary,
            onClick: (_, _) =>
            {
                ProtocolRegistrar.SetAutoStart(!autoStartOn);
                AppendLog(!autoStartOn ? "Đã bật Tự động chạy ẩn cùng Windows (--minimized)." : "Đã tắt Tự động chạy cùng Windows.");
                RenderCurrentView();
            }));

        AddOsBtn(UiComponents.CreateButton("Mở thư mục AppData", ButtonVariant.Secondary, FluentIcons.FolderOpen, onClick: (_, _) =>
        {
            Directory.CreateDirectory(DesktopConfig.AppDataRoot);
            Process.Start(new ProcessStartInfo { FileName = DesktopConfig.AppDataRoot, UseShellExecute = true });
        }));

        osPanel.Children.Add(osWrap);
        osPanel.Children.Add(new TextBlock
        {
            Text = $"Đã quét thấy {_chromeProfiles.Count} Chrome Profile trên máy: {string.Join(", ", _chromeProfiles.Take(6).Select(x => x.Folder))}",
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        // Zero-Trust Local Bridge Security Box (127.0.0.1:17890)
        var curBridgeTok = _config.GetOrCreateBridgeToken();
        var maskedTok = curBridgeTok.Length > 14 ? $"{curBridgeTok[..8]}••••••••{curBridgeTok[^6..]}" : "••••••••";
        var ztPanel = new StackPanel();
        ztPanel.Children.Add(new TextBlock
        {
            Text = $"🛡️ Khóa Cầu nối Zero-Trust (X-AdsOps-Bridge-Token): {maskedTok}",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.SuccessText,
            Margin = new Thickness(0, 0, 0, 4),
        });
        ztPanel.Children.Add(new TextBlock
        {
            Text = "Chặn 100% trang web lạ & Extension không chính chủ đọc lén Cookie DPAPI / 2FA trên 127.0.0.1:17890. App tự gắn vào toàn bộ Extension của Via.",
            FontSize = 11,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        });
        var ztBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var copyBridgeBtn = UiComponents.CreateButton("Chép Mã Bridge Token", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            Clipboard.SetText(_config.GetOrCreateBridgeToken());
            AppendLog("Đã sao chép X-AdsOps-Bridge-Token (DPAPI) vào Clipboard.");
            MessageBox.Show(this, "Đã sao chép Mã Bridge Token vào Clipboard. Nếu cài Extension thủ công trên Web, dán mã này vào ô Bridge Token trong Popup Extension.", "Đã sao chép", MessageBoxButton.OK, MessageBoxImage.Information);
        });
        copyBridgeBtn.Margin = new Thickness(0, 0, 8, 0);
        var rotateBridgeBtn = UiComponents.CreateButton("Xoay vòng Khóa & Cấp lại Ext", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: (_, _) =>
        {
            var fresh = _config.RotateBridgeToken();
            var count = ProvisionAllViaExtensions(silent: false);
            AppendLog($"🔐 Đã xoay vòng X-AdsOps-Bridge-Token mới ({fresh[..8]}...) và cấp lại {count} Extension v{DesktopAppInfo.ExtVersion}.");
            RenderCurrentView();
        });
        ztBtns.Children.Add(copyBridgeBtn);
        ztBtns.Children.Add(rotateBridgeBtn);
        ztPanel.Children.Add(ztBtns);
        osPanel.Children.Add(UiComponents.CreateCard(ztPanel, new Thickness(10), ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder));

        var osCard = UiComponents.CreateCard(osPanel);
        osCard.Margin = new Thickness(0, 0, 0, 14);
        leftStack.Children.Add(osCard);

        // 5-Engine Antidetect Browser Integration & Performance Optimizer Card (v2.5.0)
        var adPanel = new StackPanel();
        adPanel.Children.Add(new TextBlock
        {
            Text = "🎭 Kết nối 5 Trình duyệt Antidetect & Tối ưu Hiệu năng Dàn Nuôi",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        adPanel.Children.Add(new TextBlock
        {
            Text = "Mặc định dùng Chrome Gốc siêu sạch (tích hợp Khiên WebRTC + Chống AutomationControlled). Với dàn 50–300 Via trên 1 máy, có thể kết nối trực tiếp API của AdsPower, Dolphin{anty}, Hidemyacc, Genlogin hoặc GoLogin.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var adGrid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        adGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        adGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        adGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var cbDefEng = UiComponents.CreateComboBox(
            AntidetectBrowserConnector.SupportedEngines.Select(e => new ComboBoxItem { Content = e.Label, Tag = e.Key }));
        var defEngNorm = AntidetectBrowserConnector.NormalizeEngine(_config.DefaultBrowserEngine);
        var defEngIdx = Array.FindIndex(AntidetectBrowserConnector.SupportedEngines, e => e.Key == defEngNorm);
        cbDefEng.SelectedIndex = defEngIdx >= 0 ? defEngIdx : 0;
        var tbAdUrl = UiComponents.CreateTextBox(
            string.IsNullOrWhiteSpace(_config.AntidetectApiBaseUrl) ? "" : _config.AntidetectApiBaseUrl,
            "Mặc định theo Engine (VD: http://127.0.0.1:50325)");
        var adCol1 = BuildLabeledBox("Trình duyệt mặc định", cbDefEng);
        var adCol2 = BuildLabeledBox("Local API URL (tùy chọn)", tbAdUrl);
        Grid.SetColumn(adCol1, 0);
        Grid.SetColumn(adCol2, 2);
        adGrid.Children.Add(adCol1);
        adGrid.Children.Add(adCol2);
        adPanel.Children.Add(adGrid);

        var perfGrid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        perfGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        perfGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        perfGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.8, GridUnitType.Star) });
        var pbAdApiKey = UiComponents.CreatePasswordBox();
        var tbMaxConcurrent = UiComponents.CreateTextBox(_config.MaxConcurrentBrowsers.ToString(), "6");
        var perfCol1 = BuildLabeledBox("API Key Antidetect (Dolphin/GoLogin - để trống nếu giữ nguyên)", pbAdApiKey);
        var perfCol2 = BuildLabeledBox("Max Chrome mở cùng lúc (1–30)", tbMaxConcurrent);
        Grid.SetColumn(perfCol1, 0);
        Grid.SetColumn(perfCol2, 2);
        perfGrid.Children.Add(perfCol1);
        perfGrid.Children.Add(perfCol2);
        adPanel.Children.Add(perfGrid);

        var chkAdShield = UiComponents.CreateCheckBox("Bật Khiên Chrome Gốc: Khóa WebRTC UDP + Ẩn Automation + Viewport riêng từng Via", _config.EnableChromeAntidetectShield);
        var chkLowRam = UiComponents.CreateCheckBox("Chế độ Tiết kiệm RAM (Giới hạn tiến trình Renderer + Disk Cache 64MB/Via)", _config.LowRamFarmMode);
        var chkAutoScaleRam = UiComponents.CreateCheckBox("Tự giới hạn số luồng mở song song theo RAM trống thực tế trên máy", _config.AutoScaleConcurrentByRam);
        var chkAutoFailover = UiComponents.CreateCheckBox("Tự động chuyển sang Chrome Gốc (Failover) khi Antidetect API đang tắt trong lúc chạy lô", _config.AutoFailoverToChromeNative);
        chkAdShield.Margin = new Thickness(0, 0, 0, 4);
        chkLowRam.Margin = new Thickness(0, 0, 0, 4);
        chkAutoScaleRam.Margin = new Thickness(0, 0, 0, 4);
        chkAutoFailover.Margin = new Thickness(0, 0, 0, 8);
        adPanel.Children.Add(chkAdShield);
        adPanel.Children.Add(chkLowRam);
        adPanel.Children.Add(chkAutoScaleRam);
        adPanel.Children.Add(chkAutoFailover);

        if (!string.IsNullOrWhiteSpace(_antidetectStatusMessage))
        {
            adPanel.Children.Add(new TextBlock
            {
                Text = _antidetectStatusMessage,
                FontSize = 12,
                Foreground = _antidetectProfiles.Count > 0 ? ThemeTokens.SuccessText : ThemeTokens.AccentText,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8),
            });
        }

        var adBtns = new WrapPanel();
        void AddAdBtn(Button b) { b.Margin = new Thickness(0, 0, 8, 6); adBtns.Children.Add(b); }
        void ApplyAdConfigInputs()
        {
            _config.DefaultBrowserEngine = (cbDefEng.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "chrome_native";
            _config.AntidetectApiBaseUrl = tbAdUrl.Text.Trim().TrimEnd('/');
            if (!string.IsNullOrWhiteSpace(pbAdApiKey.Password))
            {
                _config.AntidetectApiKey = pbAdApiKey.Password.Trim();
            }
            _config.EnableChromeAntidetectShield = chkAdShield.IsChecked == true;
            _config.LowRamFarmMode = chkLowRam.IsChecked == true;
            _config.AutoScaleConcurrentByRam = chkAutoScaleRam.IsChecked == true;
            _config.AutoFailoverToChromeNative = chkAutoFailover.IsChecked == true;
            if (int.TryParse(tbMaxConcurrent.Text, out var mc)) _config.MaxConcurrentBrowsers = Math.Clamp(mc, 1, 30);
            _config.Save();
        }

        AddAdBtn(UiComponents.CreateButton("Lưu Cấu hình Antidetect & RAM", ButtonVariant.Primary, FluentIcons.CheckCircle, compact: true, onClick: (_, _) =>
        {
            ApplyAdConfigInputs();
            _antidetectStatusMessage = $"Đã lưu Engine: {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)} · Giới hạn RAM: {_config.MaxConcurrentBrowsers} trình duyệt.";
            AppendLog(_antidetectStatusMessage);
            RenderCurrentView();
        }));
        AddAdBtn(UiComponents.CreateButton("Kiểm tra & Quét Profile", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: async (_, _) =>
        {
            ApplyAdConfigInputs();
            var probe = await AntidetectBrowserConnector.ProbeEngineAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
            _antidetectProfiles = probe.Online
                ? await AntidetectBrowserConnector.ListProfilesAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey)
                : new List<AntidetectProfileSummary>();
            _antidetectStatusMessage = probe.Online
                ? $"✓ {probe.Message} Quét được {_antidetectProfiles.Count} Profile sẵn sàng ghép Via."
                : $"⚠ {probe.Message}";
            AppendLog(_antidetectStatusMessage);
            RenderCurrentView();
        }));
        AddAdBtn(UiComponents.CreateButton("Tự ghép Via ↔ Antidetect", ButtonVariant.Secondary, FluentIcons.Lightning, compact: true, onClick: async (_, _) =>
        {
            ApplyAdConfigInputs();
            var scanned = _antidetectProfiles.Count > 0
                ? _antidetectProfiles
                : await AntidetectBrowserConnector.ListProfilesAsync(_config.DefaultBrowserEngine, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
            if (scanned.Count == 0)
            {
                MessageBox.Show(this, $"Chưa quét được Profile nào từ {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)}.", "Chưa có Profile", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
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
                                Label = v.Label,
                                DisplayName = v.DisplayName,
                                ExternalReferenceId = string.IsNullOrWhiteSpace(v.ExternalReferenceId) ? null : v.ExternalReferenceId,
                                Status = v.Status,
                                BrowserProfileLabel = v.BrowserProfileLabel,
                                NetworkLabel = v.NetworkLabel,
                                VaultReference = !string.IsNullOrWhiteSpace(v.TwoFaSecret) ? "Két DPAPI Local (Desktop)" : "",
                                Notes = notes,
                            });
                        }
                        catch { }
                    }
                }
            }
            ApplyUpdatedProxyClusterLimits();
            _antidetectStatusMessage = $"⚡ Đã tự động ghép {matchedCount}/{_vias.Count} Via vào {AntidetectBrowserConnector.GetDisplayName(_config.DefaultBrowserEngine)}.";
            AppendLog(_antidetectStatusMessage);
            RenderCurrentView();
        }));
        AddAdBtn(UiComponents.CreateButton("Dọn Cache & Ép RAM", ButtonVariant.Secondary, FluentIcons.Delete, compact: true, onClick: (_, _) =>
        {
            var activeSlugs = new HashSet<string>(
                ChromeSessionTracker.Default.GetSnapshot()
                    .Where(s => s.Alive)
                    .Select(s => ExtensionProvisioner.SanitizeFolderSlug(s.ViaLabel)),
                StringComparer.OrdinalIgnoreCase);
            var (folders, bytesFreed) = WorkstationPerformanceOptimizer.CleanProfileCachesAndTrimMemory(activeSlugs: activeSlugs);
            var mb = Math.Round(bytesFreed / (1024.0 * 1024.0), 1);
            _antidetectStatusMessage = $"🧹 Đã dọn {folders} thư mục cache tạm ({mb:0.0} MB) và thu hồi RAM thành công.";
            AppendLog(_antidetectStatusMessage);
            RenderCurrentView();
        }));
        AddAdBtn(UiComponents.CreateButton("Benchmark 5 Engine", ButtonVariant.Secondary, FluentIcons.Diagnostic, compact: true, onClick: async (_, _) =>
        {
            ApplyAdConfigInputs();
            await RunBenchmarkAllEnginesUiAsync();
        }));
        adPanel.Children.Add(adBtns);

        var adCard = UiComponents.CreateCard(adPanel);
        adCard.Margin = new Thickness(0, 0, 0, 14);
        leftStack.Children.Add(adCard);

        // Proxy Cluster Limits & Auto-Sync Settings Card (v2.4.2)
        var proxyPanel = new StackPanel();
        proxyPanel.Children.Add(new TextBlock
        {
            Text = "🌐 Cấu hình Hạn mức Cụm Proxy & Mở Máy Đồng bộ Tự động",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        proxyPanel.Children.Add(new TextBlock
        {
            Text = "Tùy chỉnh số Via dùng chung 1 Proxy (mặc định 4 cho Proxy Dân cư, có thể tăng từ 1 đến 50) và bật tự động Đảo Ấm / Kiểm tra Proxy khi mở máy.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var proxyNumGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        proxyNumGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        proxyNumGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        proxyNumGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        proxyNumGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        proxyNumGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbSetMaxVia = UiComponents.CreateTextBox(_config.MaxViasPerProxyInBatch.ToString());
        var tbSetMaxPages = UiComponents.CreateTextBox(_config.MaxPagesPerProxyInBatch.ToString());
        var tbSetSameIpSec = UiComponents.CreateTextBox(_config.SameProxyMinStaggerSeconds.ToString());
        var pBox1 = BuildLabeledBox("Max Via / 1 Proxy (1–50)", tbSetMaxVia);
        var pBox2 = BuildLabeledBox("Max Tạo Page / IP (1–20)", tbSetMaxPages);
        var pBox3 = BuildLabeledBox("Nghỉ trùng IP (15–300s)", tbSetSameIpSec);
        Grid.SetColumn(pBox1, 0);
        Grid.SetColumn(pBox2, 2);
        Grid.SetColumn(pBox3, 4);
        proxyNumGrid.Children.Add(pBox1);
        proxyNumGrid.Children.Add(pBox2);
        proxyNumGrid.Children.Add(pBox3);
        proxyPanel.Children.Add(proxyNumGrid);

        var chkSetAutoKa = UiComponents.CreateCheckBox("Tự chạy Đảo Ấm nền khi mở máy (trong giờ hoạt động)", _config.AutoKeepAliveScheduler);
        var chkSetPreProxy = UiComponents.CreateCheckBox("Kiểm tra Proxy Live trước khi mở Chrome", _config.PreCheckProxyBeforeLaunch);
        chkSetAutoKa.Margin = new Thickness(0, 0, 0, 5);
        chkSetPreProxy.Margin = new Thickness(0, 0, 0, 10);
        proxyPanel.Children.Add(chkSetAutoKa);
        proxyPanel.Children.Add(chkSetPreProxy);

        var saveProxyClusterBtn = UiComponents.CreateButton("Lưu Cấu hình Cụm Proxy & Đồng bộ", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            if (int.TryParse(tbSetMaxVia.Text, out var mv)) _config.MaxViasPerProxyInBatch = Math.Clamp(mv, 1, 50);
            if (int.TryParse(tbSetMaxPages.Text, out var mp)) _config.MaxPagesPerProxyInBatch = Math.Clamp(mp, 1, 20);
            if (int.TryParse(tbSetSameIpSec.Text, out var ms)) _config.SameProxyMinStaggerSeconds = Math.Clamp(ms, 15, 300);
            _config.AutoKeepAliveScheduler = chkSetAutoKa.IsChecked == true;
            _config.PreCheckProxyBeforeLaunch = chkSetPreProxy.IsChecked == true;
            _config.ConfigMigrationVersion = DesktopConfig.CurrentMigrationVersion;
            _config.Save();
            ApplyUpdatedProxyClusterLimits();
            var provisioned = ProvisionAllViaExtensions(silent: true);
            AppendLog($"Đã lưu Hạn mức Cụm Proxy: {_config.MaxViasPerProxyInBatch} Via/Proxy · Tạo Page {_config.MaxPagesPerProxyInBatch}/IP · Nghỉ trùng IP {_config.SameProxyMinStaggerSeconds}s (cập nhật {provisioned} Extension).");
            RenderCurrentView();
        });
        proxyPanel.Children.Add(saveProxyClusterBtn);

        var proxyClusterCard = UiComponents.CreateCard(proxyPanel);
        proxyClusterCard.Margin = new Thickness(0, 0, 0, 14);
        leftStack.Children.Add(proxyClusterCard);

        leftStack.Children.Add(BuildTelegramSettingsCard());
        Grid.SetColumn(leftStack, 0);
        cols.Children.Add(leftStack);

        // Right: Encrypted Vault Backup & DPAPI Inventory
        var rightStack = new StackPanel();
        var vaultPanel = new StackPanel();
        vaultPanel.Children.Add(new TextBlock
        {
            Text = "Két bảo mật DPAPI & Full Backup Di chuyển Máy (.adsopsvault)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        vaultPanel.Children.Add(new TextBlock
        {
            Text = "Xuất hoặc khôi phục TRỌN GÓI 5 lớp sang máy tính mới không cần nhập lại từng cái: (1) Cookie + 2FA DPAPI, (2) Danh sách Via + Proxy + Chrome Profile + Silo, (3) Cài đặt Cụm Proxy, (4) Lịch sử Ngâm 72h & Cooldown, (5) Phiên Cloud (PBKDF2-SHA256 210,000 vòng + AES-256-GCM).",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var localEntries = LocalSecretVaultStore.Default.ExportPlainEntries();
        var stewSnapshot = ViaStewardshipStore.Default.ExportSnapshot();
        var invCard = UiComponents.CreateCard(new TextBlock
        {
            Text = $"Máy này đang giữ: {localEntries.Count} Secret Cookie/2FA DPAPI • {_vias.Count} Via đã đồng bộ • {stewSnapshot.Records.Count} hồ sơ Ngâm 72h/Cooldown. Backup vào 1 file duy nhất để mang sang máy khác.",
            FontSize = 12,
            Foreground = ThemeTokens.SuccessText,
            TextWrapping = TextWrapping.Wrap,
        }, new Thickness(12), ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
        invCard.Margin = new Thickness(0, 0, 0, 12);
        vaultPanel.Children.Add(invCard);

        var vaultBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var expBtn = UiComponents.CreateButton("Xuất Full Backup (.adsopsvault)", ButtonVariant.Primary, FluentIcons.Lock, onClick: (_, _) =>
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
        });
        expBtn.Margin = new Thickness(0, 0, 8, 0);

        var impBtn = UiComponents.CreateButton("Khôi phục Trọn gói sang Máy mới", ButtonVariant.Secondary, FluentIcons.FolderOpen, onClick: (_, _) =>
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

                if (payload.ConfigSnapshot != null)
                {
                    _config.ApplyPreferencesFrom(payload.ConfigSnapshot);
                }
                if (!string.IsNullOrWhiteSpace(payload.BackendBaseUrl))
                {
                    _config.BackendBaseUrl = payload.BackendBaseUrl.Trim().TrimEnd('/');
                }
                if (!string.IsNullOrWhiteSpace(payload.UserEmail))
                {
                    _config.UserEmail = payload.UserEmail.Trim();
                }
                var jwtRestored = false;
                if (!string.IsNullOrWhiteSpace(payload.CloudJwtPlain) &&
                    (string.IsNullOrWhiteSpace(_config.GetJwt()) ||
                     string.Equals(_config.UserEmail, payload.UserEmail, StringComparison.OrdinalIgnoreCase)))
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
                if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
                {
                    _ = SyncCloudAsync(silent: true);
                }

                MessageBox.Show(
                    this,
                    $"Khôi phục trọn gói sang máy mới thành công!\n\n• Cookie & 2FA nạp vào Két DPAPI: {importedSecrets}\n• Hồ sơ Ngâm 72h / Cooldown: {importedStew}\n• Danh sách Via sẵn sàng: {_vias.Count}\n• Đã gắn Protocol & cấp lại {provisionedExt} Chrome Extension v{DesktopAppInfo.ExtVersion}\n• Phiên Cloud: {(jwtRestored ? "Đã khôi phục (tự đồng bộ nền)" : "Giữ nguyên cài đặt")}",
                    "Khôi phục Hoàn tất",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                RefreshHeaderAndSidebar();
                RenderCurrentView();
            }
            catch (Exception ex) { MessageBox.Show(this, $"Không giải mã được file Backup (sai mật khẩu hoặc hỏng file): {ex.Message}", "Lỗi Giải mã", MessageBoxButton.OK, MessageBoxImage.Error); }
        });

        vaultBtns.Children.Add(expBtn);
        vaultBtns.Children.Add(impBtn);
        vaultPanel.Children.Add(vaultBtns);

        var vaultCard = UiComponents.CreateCard(vaultPanel);
        vaultCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(vaultCard);
        var devSessCard = BuildDeviceSessionsCard();
        devSessCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(devSessCard);
        rightStack.Children.Add(BuildSelfUpdaterCard());

        Grid.SetColumn(rightStack, 2);
        cols.Children.Add(rightStack);
        return cols;
    }

    private Border BuildTelegramSettingsCard()
    {
        var panel = new StackPanel();
        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = "Cấu hình Bot Cảnh báo Telegram Tức thời",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var tgActive = _telegramConfig?.BotConfigured == true && _telegramConfig.ChatConfigured && _telegramConfig.Enabled;
        var stBadge = UiComponents.CreateBadgePill(
            tgActive ? "ĐANG BẬT" : "CHƯA KÍCH HOẠT",
            tgActive ? ThemeTokens.SuccessText : ThemeTokens.TextMuted,
            tgActive ? ThemeTokens.SuccessBg : ThemeTokens.BgSurfaceElevated,
            tgActive ? ThemeTokens.SuccessBorder : ThemeTokens.BorderSubtle);
        Grid.SetColumn(stBadge, 1);
        hdr.Children.Add(stBadge);
        panel.Children.Add(hdr);

        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            panel.Children.Add(new TextBlock
            {
                Text = "Đăng nhập AdsOps Cloud ở thẻ phía trên để cấu hình Bot Telegram cảnh báo tức thời.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
            return UiComponents.CreateCard(panel);
        }

        var cfg = _telegramConfig ?? new TelegramBotConfigDto();
        var currentBotDesc = cfg.BotConfigured
            ? $"Bot hiện tại: {(string.IsNullOrWhiteSpace(cfg.BotUsername) ? cfg.BotMask : "@" + cfg.BotUsername)} ({cfg.BotMask}) • Chat ID: {(cfg.ChatConfigured ? cfg.ChatIdMasked : "Chưa gắn")}"
            : "Chưa cấu hình Bot Token Telegram cho Workspace này.";
        panel.Children.Add(new TextBlock
        {
            Text = currentBotDesc,
            FontSize = 12,
            Foreground = cfg.BotConfigured ? ThemeTokens.AccentText : ThemeTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var pbBotToken = UiComponents.CreatePasswordBox("");
        panel.Children.Add(BuildLabeledBox("Bot Token Telegram mới (để trống nếu giữ token cũ)", pbBotToken));

        var tbChatId = UiComponents.CreateTextBox("", "VD: -1001234567890 (để trống nếu giữ Chat ID đã lưu)");
        panel.Children.Add(BuildLabeledBox("Telegram Chat ID / Nhóm nhận cảnh báo", tbChatId));

        var cbDetectedChats = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "(Nhấn 'Tự dò Nhóm Chat' sau khi nhắn /start cho Bot)", Tag = "" },
        });
        cbDetectedChats.SelectionChanged += (_, _) =>
        {
            if (cbDetectedChats.SelectedItem is ComboBoxItem item && item.Tag is string cid && !string.IsNullOrWhiteSpace(cid))
            {
                tbChatId.Text = cid;
            }
        };
        panel.Children.Add(BuildLabeledBox("Nhóm Telegram dò được gần đây", cbDetectedChats));

        var chkTgEnabled = UiComponents.CreateCheckBox("Bật gửi cảnh báo tức thời qua Telegram", cfg.Enabled);
        var chkDis = UiComponents.CreateCheckBox("Cảnh báo khi TKQC bị Vô hiệu hóa (Disabled)", cfg.NotifyAdAccountDisabled);
        var chkBill = UiComponents.CreateCheckBox("Cảnh báo khi Lỗi thanh toán / Thẻ (Billing Failed)", cfg.NotifyBillingFailed);
        var chkPage = UiComponents.CreateCheckBox("Cảnh báo khi Fanpage bị Hạn chế (Restricted)", cfg.NotifyPageRestricted);
        var chkRet = UiComponents.CreateCheckBox("Cảnh báo Vượt ngân sách / Retainer Overspend", cfg.NotifyRetainerOverspend);
        var chkQuiet = UiComponents.CreateCheckBox("Tôn trọng giờ yên tĩnh (Quiet Hours)", cfg.QuietHoursRespect);
        foreach (var ch in new[] { chkTgEnabled, chkDis, chkBill, chkPage, chkRet, chkQuiet })
        {
            ch.Margin = new Thickness(0, 0, 0, 4);
            panel.Children.Add(ch);
        }

        var statusTb = new TextBlock { Text = "", FontSize = 12, Foreground = ThemeTokens.AccentText, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 8) };
        panel.Children.Add(statusTb);

        var btnWrap = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
        var detectBtn = UiComponents.CreateButton("Tự dò Nhóm Chat", ButtonVariant.Secondary, FluentIcons.Search, compact: true, onClick: async (_, _) =>
        {
            statusTb.Foreground = ThemeTokens.AccentText;
            statusTb.Text = "Đang gọi Telegram getUpdates để tìm nhóm vừa chat với Bot...";
            try
            {
                var res = await _api.DetectTelegramChatsAsync(pbBotToken.Password);
                cbDetectedChats.Items.Clear();
                if (res.Chats.Count == 0)
                {
                    cbDetectedChats.Items.Add(new ComboBoxItem { Content = "(Chưa thấy tin nhắn mới — hãy gõ /start vào nhóm)", Tag = "" });
                    cbDetectedChats.SelectedIndex = 0;
                    statusTb.Foreground = ThemeTokens.WarningText;
                    statusTb.Text = string.IsNullOrWhiteSpace(res.Hint) ? "Chưa tìm thấy nhóm chat gần đây." : res.Hint;
                    return;
                }
                foreach (var c in res.Chats)
                {
                    var label = $"{(string.IsNullOrWhiteSpace(c.Title) ? c.Username : c.Title)} [{c.Type}] — {c.ChatIdText}";
                    cbDetectedChats.Items.Add(new ComboBoxItem { Content = label, Tag = c.ChatIdText });
                }
                cbDetectedChats.SelectedIndex = 0;
                if (string.IsNullOrWhiteSpace(tbChatId.Text)) tbChatId.Text = res.Chats[0].ChatIdText;
                statusTb.Foreground = ThemeTokens.SuccessText;
                statusTb.Text = $"Tìm thấy {res.Chats.Count} cuộc trò chuyện. Đã chọn sẵn {res.Chats[0].ChatIdText}.";
            }
            catch (Exception ex)
            {
                statusTb.Foreground = ThemeTokens.DangerText;
                statusTb.Text = $"Lỗi dò nhóm Telegram: {ex.Message}";
            }
        });
        detectBtn.Margin = new Thickness(0, 0, 8, 6);

        var saveTgBtn = UiComponents.CreateButton("Lưu Cấu hình Bot", ButtonVariant.Primary, FluentIcons.CheckCircle, compact: true, onClick: async (_, _) =>
        {
            statusTb.Foreground = ThemeTokens.AccentText;
            statusTb.Text = "Đang xác thực & lưu cấu hình Bot Telegram lên Cloud...";
            try
            {
                var body = new Dictionary<string, object>
                {
                    ["enabled"] = chkTgEnabled.IsChecked == true,
                    ["notify_ad_account_disabled"] = chkDis.IsChecked == true,
                    ["notify_billing_failed"] = chkBill.IsChecked == true,
                    ["notify_page_restricted"] = chkPage.IsChecked == true,
                    ["notify_retainer_overspend"] = chkRet.IsChecked == true,
                    ["quiet_hours_respect"] = chkQuiet.IsChecked == true,
                };
                if (!string.IsNullOrWhiteSpace(pbBotToken.Password)) body["bot_token"] = pbBotToken.Password.Trim();
                if (!string.IsNullOrWhiteSpace(tbChatId.Text)) body["chat_id"] = tbChatId.Text.Trim();
                _telegramConfig = await _api.SaveTelegramBotConfigAsync(body);
                AppendLog("Đã lưu cấu hình Bot Cảnh báo Telegram trên Cloud.");
                RenderCurrentView();
            }
            catch (Exception ex)
            {
                statusTb.Foreground = ThemeTokens.DangerText;
                statusTb.Text = $"Lỗi lưu Telegram Bot: {ex.Message}";
            }
        });
        saveTgBtn.Margin = new Thickness(0, 0, 8, 6);

        var testTgBtn = UiComponents.CreateButton("Gửi Tin Test", ButtonVariant.Secondary, FluentIcons.Send, compact: true, onClick: async (_, _) =>
        {
            statusTb.Foreground = ThemeTokens.AccentText;
            statusTb.Text = "Đang gửi tin nhắn thử tới Telegram...";
            try
            {
                await _api.SendTelegramTestWithOverridesAsync(pbBotToken.Password, tbChatId.Text);
                statusTb.Foreground = ThemeTokens.SuccessText;
                statusTb.Text = "Đã gửi tin nhắn kiểm tra tới Telegram thành công!";
                AppendLog("Đã gửi tin nhắn Telegram test thành công.");
            }
            catch (Exception ex)
            {
                statusTb.Foreground = ThemeTokens.DangerText;
                statusTb.Text = $"Gửi tin test thất bại: {ex.Message}";
            }
        });
        testTgBtn.Margin = new Thickness(0, 0, 8, 6);

        btnWrap.Children.Add(saveTgBtn);
        btnWrap.Children.Add(detectBtn);
        btnWrap.Children.Add(testTgBtn);

        if (cfg.BotConfigured)
        {
            var clearTgBtn = UiComponents.CreateButton("Xóa Bot Token", ButtonVariant.Danger, FluentIcons.Delete, compact: true, onClick: async (_, _) =>
            {
                try
                {
                    _telegramConfig = await _api.SaveTelegramBotConfigAsync(new { clear_bot_token = true, enabled = false });
                    AppendLog("Đã xóa Bot Token Telegram khỏi Workspace.");
                    RenderCurrentView();
                }
                catch (Exception ex)
                {
                    statusTb.Foreground = ThemeTokens.DangerText;
                    statusTb.Text = $"Lỗi xóa Bot Token: {ex.Message}";
                }
            });
            clearTgBtn.Margin = new Thickness(0, 0, 0, 6);
            btnWrap.Children.Add(clearTgBtn);
        }

        panel.Children.Add(btnWrap);
        return UiComponents.CreateCard(panel);
    }

    private Border BuildDeviceSessionsCard()
    {
        var panel = new StackPanel();
        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = "Phiên Đăng Nhập & Bảo Mật Thiết Bị Cloud",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var active = _deviceSessions.Where(s => !s.RevokedAt.HasValue).ToList();
        if (!string.IsNullOrWhiteSpace(_config.GetJwt()) && active.Count > 1)
        {
            var logoutOthersBtn = UiComponents.CreateButton("Đăng xuất thiết bị khác", ButtonVariant.Danger, FluentIcons.Lock, compact: true, onClick: async (_, _) =>
            {
                var ok = UiComponents.ShowConfirmActionDialog(
                    this,
                    "Thu hồi toàn bộ thiết bị khác",
                    "Đăng xuất tất cả phiên Cloud trên các trình duyệt / máy tính khác?",
                    new (string, string)[] { ("Phiên hiện tại:", "Giữ nguyên đăng nhập trên App này"), ("Thiết bị khác:", "Bắt buộc đăng nhập lại") },
                    "Các phiên khác sẽ bị thu hồi ngay lập tức trên máy chủ AdsOps.",
                    "Đăng xuất thiết bị khác",
                    isDanger: true);
                if (!ok) return;
                try
                {
                    var res = await _api.LogoutOtherDevicesAsync();
                    AppendLog($"Đã thu hồi {res.RevokedCount} phiên thiết bị Cloud khác.");
                    await SyncCloudAsync(silent: false);
                }
                catch (Exception ex) { AppendLog($"Lỗi thu hồi phiên thiết bị khác: {ex.Message}"); }
            });
            Grid.SetColumn(logoutOthersBtn, 1);
            hdr.Children.Add(logoutOthersBtn);
        }
        panel.Children.Add(hdr);

        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            panel.Children.Add(new TextBlock
            {
                Text = "Đăng nhập AdsOps Cloud ở thẻ phía trái để xem và thu hồi các thiết bị đang giữ phiên đăng nhập.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
            return UiComponents.CreateCard(panel);
        }

        if (active.Count == 0)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "Chưa có dữ liệu phiên thiết bị Cloud (nhấn Đồng bộ Cloud F5 để tải lại).",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
            return UiComponents.CreateCard(panel);
        }

        foreach (var sess in active.Take(10))
        {
            var r = new Grid();
            r.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            r.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var colLeft = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            var title = string.IsNullOrWhiteSpace(sess.Label) ? $"{sess.BrowserFamily ?? "Device"} • {sess.OsFamily ?? "OS"}" : sess.Label;
            colLeft.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = ThemeTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            var seen = (sess.LastSeenAt ?? sess.CreatedAt).ToLocalTime().ToString("dd/MM HH:mm");
            colLeft.Children.Add(new TextBlock
            {
                Text = $"{sess.SessionType ?? "session"} • {sess.BrowserFamily ?? "?"} / {sess.OsFamily ?? "?"} • Hoạt động {seen}",
                FontSize = 11,
                Foreground = ThemeTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            r.Children.Add(colLeft);

            if (sess.IsCurrent)
            {
                var curBadge = UiComponents.CreateBadgePill("Phiên hiện tại", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
                Grid.SetColumn(curBadge, 1);
                r.Children.Add(curBadge);
            }
            else
            {
                var revBtn = UiComponents.CreateButton("Thu hồi", ButtonVariant.Danger, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        await _api.RevokeDeviceSessionAsync(sess.Id, "Thu hồi từ AdsOps Desktop Pro");
                        AppendLog($"Đã thu hồi phiên thiết bị '{title}'.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex) { AppendLog($"Lỗi thu hồi phiên '{title}': {ex.Message}"); }
                });
                Grid.SetColumn(revBtn, 1);
                r.Children.Add(revBtn);
            }

            var itemCard = UiComponents.CreateCard(r, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
            itemCard.Margin = new Thickness(0, 0, 0, 6);
            panel.Children.Add(itemCard);
        }

        return UiComponents.CreateCard(panel);
    }

    // ------------------------------------------------------------------------
    // SHARED BATCH HELPERS
    // ------------------------------------------------------------------------
    private async System.Threading.Tasks.Task RunBatchProxyCheckAsync()
    {
        try
        {
            SetBusy(true);
            var res = await _api.CheckProxyBatchAsync();
            var map = res.HealthMap ?? new Dictionary<string, ProxyCheckResultDto>();
            _proxyHealthMap = new Dictionary<string, ProxyCheckResultDto>(map, StringComparer.OrdinalIgnoreCase);
            foreach (var v in _vias)
            {
                if (string.IsNullOrWhiteSpace(v.NetworkLabel)) continue;
                var normKey = DesktopAppInfo.NormalizeProxyKey(v.NetworkLabel);
                ProxyCheckResultDto? found = null;
                if (!string.IsNullOrWhiteSpace(normKey))
                {
                    _proxyHealthMap.TryGetValue(normKey, out found);
                }
                if (found == null)
                {
                    var hp = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
                    if (!string.IsNullOrWhiteSpace(hp))
                    {
                        found = _proxyHealthMap
                            .FirstOrDefault(kv =>
                                kv.Key.Contains(hp, StringComparison.OrdinalIgnoreCase) ||
                                (!string.IsNullOrWhiteSpace(kv.Value.NormalizedKey) && kv.Value.NormalizedKey.Contains(hp, StringComparison.OrdinalIgnoreCase)))
                            .Value;
                    }
                }
                if (found != null)
                {
                    v.ProxyLastStatus = string.Equals(found.Status, "LIVE", StringComparison.OrdinalIgnoreCase) ? "LIVE" : "DEAD";
                    v.ProxyLatencyMs = found.LatencyMs;
                    v.ProxyExitIp = found.ExitIp;
                    v.ProxyTimezone = found.Timezone ?? "";
                    var (tzMatch, tzWarn) = found.TimezoneMatch.HasValue
                        ? (found.TimezoneMatch, found.TimezoneWarning)
                        : ProxyTimezoneHelper.EvaluateMatch(found.Timezone, found.CountryCode, string.IsNullOrWhiteSpace(v.Timezone) ? null : v.Timezone);
                    v.HasTimezoneMismatch = tzMatch == false;
                    v.TimezoneWarning = tzWarn ?? "";
                }
            }
            AppendLog($"Kiểm tra Proxy hàng loạt hoàn tất: {res.LiveCount} Live / {res.DeadCount} Dead (Tổng {res.CheckedCount}).");
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi kiểm tra Proxy hàng loạt: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
            RenderCurrentView();
        }
    }

    private async System.Threading.Tasks.Task RunBenchmarkAllEnginesUiAsync()
    {
        try
        {
            SetBusy(true);
            var probes = await AntidetectBrowserConnector.BenchmarkAllEnginesAsync(_config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
            _engineProbes = probes;
            _recommendedFastestEngine = AntidetectBrowserConnector.RecommendFastestOnlineEngine(probes);
            _workstationMem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();
            var lines = probes.Select(p => $"{AntidetectBrowserConnector.GetDisplayName(p.Engine)}: {(p.Online ? $"ONLINE ({p.LatencyMs}ms, {p.ProfileCount} profile)" : "Offline")}");
            _antidetectStatusMessage = $"⏱️ Khuyên dùng nhanh nhất: {AntidetectBrowserConnector.GetDisplayName(_recommendedFastestEngine)} • " + string.Join(" | ", lines);
            AppendLog(_antidetectStatusMessage);
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi Benchmark 5 Engine: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
            RenderCurrentView();
        }
    }

    private async System.Threading.Tasks.Task CheckSelectedViaProxiesAsync(List<ViaWorkspaceEntry> selected)
    {
        SetBusy(true);
        try
        {
            int live = 0, dead = 0;
            foreach (var v in selected)
            {
                if (string.IsNullOrWhiteSpace(v.NetworkLabel))
                {
                    v.ProxyLastStatus = "DIRECT";
                    continue;
                }
                try
                {
                    var r = await _api.CheckProxyLiveAsync(v.NetworkLabel, v.Label, string.IsNullOrWhiteSpace(v.Timezone) ? null : v.Timezone);
                    var isLive = string.Equals(r.Status, "LIVE", StringComparison.OrdinalIgnoreCase);
                    v.ProxyLastStatus = isLive ? "LIVE" : "DEAD";
                    v.ProxyLatencyMs = r.LatencyMs;
                    v.ProxyExitIp = r.ExitIp;
                    v.ProxyTimezone = r.Timezone ?? "";
                    var (tzMatch, tzWarn) = r.TimezoneMatch.HasValue
                        ? (r.TimezoneMatch, r.TimezoneWarning)
                        : ProxyTimezoneHelper.EvaluateMatch(r.Timezone, r.CountryCode, string.IsNullOrWhiteSpace(v.Timezone) ? null : v.Timezone);
                    v.HasTimezoneMismatch = tzMatch == false;
                    v.TimezoneWarning = tzWarn ?? "";
                    var key = !string.IsNullOrWhiteSpace(r.NormalizedKey) ? r.NormalizedKey : DesktopAppInfo.NormalizeProxyKey(v.NetworkLabel);
                    if (!string.IsNullOrWhiteSpace(key)) _proxyHealthMap[key] = r;
                    if (isLive) live++; else dead++;
                }
                catch
                {
                    v.ProxyLastStatus = "DEAD";
                    dead++;
                }
            }
            AppendLog($"Check Proxy cho {selected.Count} Via: {live} LIVE, {dead} DEAD.");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async System.Threading.Tasks.Task RunMetaPageSyncAsync()
    {
        try
        {
            SetBusy(true);
            var r = await _api.SyncPagesFromMetaAsync();
            AppendLog($"Đồng bộ Fanpage từ Meta xong: {r.SyncedCount} Page (Mới: {r.NewCount}, Link TKQC: {r.LinkedAccountCount}, Kéo BM: {r.BmClaimedCount}).");
            await SyncCloudAsync(silent: false);
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi đồng bộ Fanpage từ Meta: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    // ------------------------------------------------------------------------
    // v2.3 EXTENSION SECTIONS: PIXELS, DOMAIN SEO, READINESS, AUDIT, RETAINERS, TEAM & SELF-UPDATER
    // ------------------------------------------------------------------------
    private static string FormatVndCompact(long amount) =>
        $"{amount.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} ₫";

    private Grid BuildPixelsAndDomainSeoRow()
    {
        var cols = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // Left: Meta Pixels
        var pxBox = new StackPanel();
        var pxHdr = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        pxHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        pxHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        pxHdr.Children.Add(new TextBlock
        {
            Text = $"Meta Pixels ({_pixels.Count})",
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var addPxBtn = UiComponents.CreateButton("Tạo Pixel", ButtonVariant.Primary, FluentIcons.Add, compact: true, onClick: (_, _) => OpenCreatePixelDialog());
        Grid.SetColumn(addPxBtn, 1);
        pxHdr.Children.Add(addPxBtn);
        pxBox.Children.Add(pxHdr);

        if (_pixels.Count == 0)
        {
            pxBox.Children.Add(new TextBlock
            {
                Text = "Chưa có Meta Pixel nào trong Workspace. Nhấn '+ Tạo Pixel' để lưu Pixel ID.",
                FontSize = 12,
                Foreground = ThemeTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }
        else
        {
            foreach (var px in _pixels.Take(10))
            {
                var row = new Grid { Margin = new Thickness(0, 0, 0, 6) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var info = new StackPanel();
                info.Children.Add(new TextBlock { Text = px.Name, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary });
                info.Children.Add(new TextBlock
                {
                    Text = $"Pixel ID: {px.ExternalPixelId ?? "—"} • {px.Status}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 11,
                    Foreground = ThemeTokens.TextMuted,
                });
                row.Children.Add(info);
                if (!string.IsNullOrWhiteSpace(px.ExternalPixelId))
                {
                    var cp = UiComponents.CreateButton("Copy ID", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
                    {
                        Clipboard.SetText(px.ExternalPixelId);
                        AppendLog($"Đã chép Pixel ID: {px.ExternalPixelId}");
                    });
                    Grid.SetColumn(cp, 1);
                    row.Children.Add(cp);
                }
                pxBox.Children.Add(UiComponents.CreateCard(row, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated));
            }
        }
        var pxCard = UiComponents.CreateCard(pxBox, new Thickness(12));
        cols.Children.Add(pxCard);

        // Right: Domain & SEO Config
        var seoBox = new StackPanel();
        seoBox.Children.Add(new TextBlock
        {
            Text = "Tên miền riêng & SEO Readiness",
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        seoBox.Children.Add(new TextBlock
        {
            Text = $"URL hiệu lực: {_domainSeoConfig?.EffectivePublicUrl ?? "https://adsops-app.vibe.tinhgon.xyz"}",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 11,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 0, 0, 8),
        });

        var domRow = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        domRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        domRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var tbDomain = UiComponents.CreateTextBox(_domainSeoConfig?.CustomDomain ?? "", "https://app.thuonghieu.vn (để trống = mặc định)");
        domRow.Children.Add(tbDomain);
        var saveDomBtn = UiComponents.CreateButton("Lưu Tên miền", ButtonVariant.Secondary, FluentIcons.CheckCircle, compact: true, onClick: async (_, _) =>
        {
            try
            {
                SetBusy(true);
                _domainSeoConfig = await _api.SaveDomainSeoConfigAsync(tbDomain.Text);
                AppendLog($"Đã lưu cấu hình Domain/SEO: {_domainSeoConfig.EffectivePublicUrl}");
                RenderCurrentView();
            }
            catch (Exception ex) { AppendLog($"Lỗi lưu Domain SEO (chỉ Owner/Admin): {ex.Message}"); }
            finally { SetBusy(false); }
        });
        saveDomBtn.Margin = new Thickness(8, 0, 0, 0);
        Grid.SetColumn(saveDomBtn, 1);
        domRow.Children.Add(saveDomBtn);
        seoBox.Children.Add(domRow);

        var checks = _domainSeoConfig?.SeoChecklist ?? new();
        var checkWrap = new WrapPanel();
        foreach (var item in checks)
        {
            var pill = UiComponents.CreateBadgePill(
                (item.Ready ? "✓ " : "○ ") + item.Label,
                item.Ready ? ThemeTokens.SuccessText : ThemeTokens.TextMuted,
                item.Ready ? ThemeTokens.SuccessBg : ThemeTokens.NeutralBg,
                item.Ready ? ThemeTokens.SuccessBorder : ThemeTokens.NeutralBorder);
            pill.Margin = new Thickness(0, 0, 6, 6);
            checkWrap.Children.Add(pill);
        }
        seoBox.Children.Add(checkWrap);

        var seoCard = UiComponents.CreateCard(seoBox, new Thickness(12));
        Grid.SetColumn(seoCard, 2);
        cols.Children.Add(seoCard);

        return cols;
    }

    private Border BuildReadinessBoardCard()
    {
        var box = new StackPanel();
        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = "Readiness Board (Mức độ sẵn sàng lên Camp)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        });
        var rs = _readinessSummary;
        var summaryPills = new WrapPanel();
        void AddPill(string text, Brush fg, Brush bg, Brush bd)
        {
            var p = UiComponents.CreateBadgePill(text, fg, bg, bd);
            p.Margin = new Thickness(6, 0, 0, 0);
            summaryPills.Children.Add(p);
        }
        AddPill($"Sẵn sàng: {rs?.OperationallyReady ?? 0}", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
        AddPill($"Cảnh báo: {rs?.ReadyWithWarnings ?? 0}", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
        AddPill($"Chưa đạt: {rs?.NotReady ?? 0}", ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
        AddPill($"Chưa rõ: {rs?.Unknown ?? 0}", ThemeTokens.TextMuted, ThemeTokens.NeutralBg, ThemeTokens.NeutralBorder);
        Grid.SetColumn(summaryPills, 1);
        hdr.Children.Add(summaryPills);
        box.Children.Add(hdr);

        var groups = _readinessBoard?.Groups ?? new();
        if (groups.Count > 0)
        {
            var gWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            foreach (var grp in groups.Take(5))
            {
                var p = UiComponents.CreateBadgePill(
                    $"{grp.Message} ({grp.Accounts.Count} TKQC)",
                    grp.Severity == "critical" ? ThemeTokens.DangerText : ThemeTokens.WarningText,
                    grp.Severity == "critical" ? ThemeTokens.DangerBg : ThemeTokens.WarningBg,
                    grp.Severity == "critical" ? ThemeTokens.DangerBorder : ThemeTokens.WarningBorder);
                p.Margin = new Thickness(0, 0, 6, 6);
                gWrap.Children.Add(p);
            }
            box.Children.Add(gWrap);
        }

        var rows = _readinessBoard?.Rows ?? new();
        if (rows.Count == 0)
        {
            box.Children.Add(new TextBlock { Text = "Chưa có dữ liệu Readiness Board.", FontSize = 12, Foreground = ThemeTokens.TextMuted });
        }
        else
        {
            foreach (var r in rows.Take(20))
            {
                var rowG = new Grid();
                rowG.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
                rowG.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });
                rowG.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(95) });
                rowG.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
                rowG.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var c0 = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                c0.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(r.DisplayName) ? r.ExternalAccountId : r.DisplayName, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
                c0.Children.Add(new TextBlock { Text = $"act_{r.ExternalAccountId} • {r.Status}", FontFamily = ThemeTokens.MonoFont, FontSize = 11, Foreground = ThemeTokens.TextMuted });
                rowG.Children.Add(c0);

                var stLower = (r.ReadinessStatus ?? "").ToLowerInvariant();
                var (fg, bg, bd) = stLower == "operationally_ready"
                    ? (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder)
                    : stLower == "ready_with_warnings"
                        ? (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder)
                        : (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
                var stPill = UiComponents.CreateBadgePill((r.ReadinessStatus ?? "UNKNOWN").ToUpperInvariant(), fg, bg, bd);
                Grid.SetColumn(stPill, 1);
                rowG.Children.Add(stPill);

                var checklistTb = new TextBlock
                {
                    Text = $"{r.CompletedItemCount}/{r.RequiredItemCount} mục",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextSecondary,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(checklistTb, 2);
                rowG.Children.Add(checklistTb);

                var reasonText = r.Reasons.Count > 0 ? string.Join(" | ", r.Reasons.Take(2).Select(x => x.Message)) : "Đạt chuẩn sẵn sàng chạy Camp";
                var rTb = new TextBlock
                {
                    Text = reasonText,
                    FontSize = 12,
                    Foreground = r.Reasons.Count > 0 ? ThemeTokens.TextSecondary : ThemeTokens.SuccessText,
                    VerticalAlignment = VerticalAlignment.Center,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Margin = new Thickness(0, 0, 8, 0),
                };
                Grid.SetColumn(rTb, 3);
                rowG.Children.Add(rTb);

                var recBtn = UiComponents.CreateButton("Tính lại Readiness", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        SetBusy(true);
                        await _api.RecalculateAccountReadinessAsync(r.AdAccountId);
                        AppendLog($"Đã tính lại Readiness cho act_{r.ExternalAccountId}.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex) { AppendLog($"Lỗi tính lại Readiness: {ex.Message}"); }
                    finally { SetBusy(false); }
                });
                Grid.SetColumn(recBtn, 4);
                rowG.Children.Add(recBtn);

                var card = UiComponents.CreateCard(rowG, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated);
                card.Margin = new Thickness(0, 0, 0, 6);
                box.Children.Add(card);
            }
        }

        var outer = UiComponents.CreateCard(box, new Thickness(14));
        outer.Margin = new Thickness(0, 0, 0, 14);
        return outer;
    }

    private Border BuildAuditLogsCard()
    {
        var box = new StackPanel();
        var listHost = new StackPanel();

        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = $"Nhật ký kiểm toán (Live Audit Log • {_auditLogs.Count})",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        });
        var csvBtn = UiComponents.CreateButton("Xuất CSV Audit", ButtonVariant.Secondary, FluentIcons.Upload, compact: true, onClick: (_, _) => ExportAuditLogsCsv());
        Grid.SetColumn(csvBtn, 1);
        hdr.Children.Add(csvBtn);
        box.Children.Add(hdr);

        void RefreshAuditList()
        {
            listHost.Children.Clear();
            var q = (_auditSearch ?? "").Trim();
            var rows = _auditLogs.Where(a =>
                string.IsNullOrEmpty(q) ||
                a.Action.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                a.EntityType.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                a.EntityId.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                (a.ActorEmail ?? "").Contains(q, StringComparison.OrdinalIgnoreCase)).Take(30).ToList();

            if (rows.Count == 0)
            {
                listHost.Children.Add(new TextBlock
                {
                    Text = _auditLogs.Count == 0
                        ? "Không có nhật ký Audit (hoặc tài khoản hiện tại chưa được cấp quyền Owner/Admin)."
                        : "Không có dòng nhật ký nào khớp từ khóa.",
                    FontSize = 12,
                    Foreground = ThemeTokens.TextMuted,
                });
                return;
            }

            foreach (var a in rows)
            {
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });

                var dtText = DateTimeOffset.TryParse(a.CreatedAt, out var dto) ? dto.ToLocalTime().ToString("dd/MM HH:mm:ss") : a.CreatedAt;
                g.Children.Add(new TextBlock { Text = dtText, FontFamily = ThemeTokens.MonoFont, FontSize = 11, Foreground = ThemeTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });

                var actTb = new TextBlock { Text = a.Action, FontFamily = ThemeTokens.MonoFont, FontSize = 12, Foreground = ThemeTokens.AccentText, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
                Grid.SetColumn(actTb, 1);
                g.Children.Add(actTb);

                var entTb = new TextBlock { Text = $"{a.EntityType}: {a.EntityId}", FontSize = 11, Foreground = ThemeTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
                Grid.SetColumn(entTb, 2);
                g.Children.Add(entTb);

                var usrTb = new TextBlock { Text = a.ActorEmail ?? "system", FontSize = 11, Foreground = ThemeTokens.TextMuted, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
                Grid.SetColumn(usrTb, 3);
                g.Children.Add(usrTb);

                var itemCard = UiComponents.CreateCard(g, new Thickness(10, 6, 10, 6), ThemeTokens.BgSurfaceElevated);
                itemCard.Margin = new Thickness(0, 0, 0, 4);
                listHost.Children.Add(itemCard);
            }
        }

        var searchTb = UiComponents.CreateTextBox(_auditSearch, "Lọc theo action, entity hoặc email người thực hiện...");
        searchTb.Margin = new Thickness(0, 0, 0, 10);
        searchTb.TextChanged += (_, _) => { _auditSearch = searchTb.Text; RefreshAuditList(); };
        box.Children.Add(searchTb);
        box.Children.Add(listHost);
        RefreshAuditList();

        var outer = UiComponents.CreateCard(box, new Thickness(14));
        outer.Margin = new Thickness(0, 0, 0, 14);
        return outer;
    }

    private void ExportAuditLogsCsv()
    {
        var headers = new[] { "CreatedAt", "Action", "EntityType", "EntityId", "ActorEmail", "RequestId" };
        var rows = _auditLogs.Select(a => (IReadOnlyList<string?>)new[] { a.CreatedAt, a.Action, a.EntityType, a.EntityId, a.ActorEmail, a.RequestId });
        ExportCsvWithDialog($"adsops-audit-logs-{DateTime.Now:yyyyMMdd}.csv", headers, rows, "Live Audit Logs");
    }

    private UIElement BuildWorkspaceOpsView()
    {
        var stack = new StackPanel();
        stack.Children.Add(BuildClientRetainersCard());
        stack.Children.Add(BuildTeamAndSeatsCard());
        return stack;
    }

    private Border BuildClientRetainersCard()
    {
        var box = new StackPanel();
        var sum = _retainersOverview?.Summary ?? new ClientRetainersSummaryDto();
        var items = _retainersOverview?.Items ?? new List<ClientRetainerItemDto>();

        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = $"Hợp đồng Ngân sách Khách hàng (Client Retainers • Còn {sum.DaysRemainingInMonth} ngày trong tháng)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var btns = new StackPanel { Orientation = Orientation.Horizontal };
        var csvBtn = UiComponents.CreateButton("Xuất CSV Retainer", ButtonVariant.Secondary, FluentIcons.Upload, compact: true, onClick: (_, _) => ExportRetainersCsv());
        csvBtn.Margin = new Thickness(0, 0, 8, 0);
        var newBtn = UiComponents.CreateButton("Hợp đồng mới", ButtonVariant.Primary, FluentIcons.Add, compact: true, onClick: (_, _) => OpenClientRetainerDialog(null));
        btns.Children.Add(csvBtn);
        btns.Children.Add(newBtn);
        Grid.SetColumn(btns, 1);
        hdr.Children.Add(btns);
        box.Children.Add(hdr);

        var kpi = new Grid { Margin = new Thickness(0, 0, 0, 12) };
        for (int i = 0; i < 4; i++)
        {
            if (i > 0) kpi.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            kpi.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }
        var k1 = UiComponents.CreateMetricCard("Tổng Hợp đồng", sum.TotalContracts.ToString(), "Đang kích hoạt trong kỳ", FluentIcons.Page, ThemeTokens.AccentText, out _, out _);
        var k2 = UiComponents.CreateMetricCard("Cam kết Tháng", FormatVndCompact(sum.TotalCommittedVnd), "Ngân sách cam kết cộng gộp", FluentIcons.Chart, ThemeTokens.TextPrimary, out _, out _);
        var k3 = UiComponents.CreateMetricCard("Chi tiêu MTD", FormatVndCompact(sum.TotalMtdSpendVnd), $"Dư nợ chưa thu: {FormatVndCompact(sum.TotalUnpaidBalanceVnd)}", FluentIcons.Diagnostic, ThemeTokens.WarningText, out _, out _);
        var k4 = UiComponents.CreateMetricCard("Quyết toán MTD", FormatVndCompact(sum.TotalSettlementMtdVnd), "Gồm phí Agency + Thuế Meta", FluentIcons.CheckCircle, ThemeTokens.SuccessText, out _, out _);
        Grid.SetColumn(k2, 2); Grid.SetColumn(k3, 4); Grid.SetColumn(k4, 6);
        kpi.Children.Add(k1); kpi.Children.Add(k2); kpi.Children.Add(k3); kpi.Children.Add(k4);
        box.Children.Add(kpi);

        if (items.Count == 0)
        {
            box.Children.Add(UiComponents.CreateEmptyState(
                FluentIcons.Page,
                "Chưa có Hợp đồng Client Retainer nào",
                "Tạo hợp đồng phí quản lý (%) & thuế để tự động tính quyết toán theo chi tiêu TKQC thực tế.",
                "Hợp đồng mới",
                (_, _) => OpenClientRetainerDialog(null)));
        }
        else
        {
            foreach (var c in items)
            {
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(125) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.5, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var c0 = new StackPanel();
                c0.Children.Add(new TextBlock { Text = $"[{c.ContractCode}] {c.ClientName}" + (string.IsNullOrWhiteSpace(c.ProjectName) ? "" : $" • {c.ProjectName}"), FontSize = 13, FontWeight = FontWeights.Bold, Foreground = ThemeTokens.TextPrimary });
                c0.Children.Add(new TextBlock { Text = $"{c.BillingCycle} • {c.AccountCount} TKQC • Phí {c.AgencyFeePercent}% + Thuế {c.MetaTaxPercent}%", FontSize = 11, Foreground = ThemeTokens.TextMuted });
                row.Children.Add(c0);

                var (fg, bg, bd) = c.PacingStatus switch
                {
                    "OVER_BUDGET" => (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder),
                    "NEAR_CAP" => (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
                    "ON_TRACK" => (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder),
                    _ => (ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder),
                };
                var pacePill = UiComponents.CreateBadgePill($"{c.PacingStatus} ({c.PacingPercent:0.#}%)", fg, bg, bd);
                Grid.SetColumn(pacePill, 1);
                row.Children.Add(pacePill);

                var c2 = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                c2.Children.Add(new TextBlock
                {
                    Text = $"MTD: {FormatVndCompact(c.SpendMtdVnd)} / {FormatVndCompact(c.CommittedBudgetVnd)}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextPrimary,
                });
                c2.Children.Add(new TextBlock
                {
                    Text = $"Quyết toán MTD: {FormatVndCompact(c.TotalBillableMtdVnd)} • Khuyến nghị/ngày: {FormatVndCompact(c.RecommendedDailyVnd)}",
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 11,
                    Foreground = ThemeTokens.TextMuted,
                });
                Grid.SetColumn(c2, 2);
                row.Children.Add(c2);

                var act = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                var editBtn = UiComponents.CreateButton("Sửa", ButtonVariant.Secondary, FluentIcons.Edit, compact: true, onClick: (_, _) => OpenClientRetainerDialog(c));
                editBtn.Margin = new Thickness(0, 0, 6, 0);
                var delBtn = UiComponents.CreateButton("Xóa", ButtonVariant.Danger, FluentIcons.Delete, compact: true, onClick: async (_, _) =>
                {
                    var ok = UiComponents.ShowConfirmActionDialog(
                        this,
                        "Xóa Hợp đồng Retainer",
                        $"Xác nhận xóa hợp đồng '{c.ContractCode} - {c.ClientName}'?",
                        new (string, string)[] { ("Mã HĐ:", c.ContractCode), ("Khách hàng:", c.ClientName) },
                        "Hành động này sẽ lưu dấu xóa vào Audit Log Workspace.",
                        "Xóa Hợp đồng",
                        isDanger: true);
                    if (!ok) return;
                    try
                    {
                        SetBusy(true);
                        _retainersOverview = await _api.DeleteClientRetainerAsync(c.Id);
                        AppendLog($"Đã xóa Hợp đồng Retainer {c.ContractCode}.");
                        RefreshHeaderAndSidebar();
                        RenderCurrentView();
                    }
                    catch (Exception ex) { AppendLog($"Lỗi xóa Hợp đồng: {ex.Message}"); }
                    finally { SetBusy(false); }
                });
                act.Children.Add(editBtn);
                act.Children.Add(delBtn);
                Grid.SetColumn(act, 3);
                row.Children.Add(act);

                var card = UiComponents.CreateCard(row, new Thickness(12, 9, 12, 9), ThemeTokens.BgSurfaceElevated);
                card.Margin = new Thickness(0, 0, 0, 8);
                box.Children.Add(card);
            }
        }

        var outer = UiComponents.CreateCard(box, new Thickness(14));
        outer.Margin = new Thickness(0, 0, 0, 14);
        return outer;
    }

    private void ExportRetainersCsv()
    {
        var items = _retainersOverview?.Items ?? new List<ClientRetainerItemDto>();
        var headers = new[] { "ContractCode", "ClientName", "ProjectName", "BillingCycle", "CommittedVND", "SpendMTD", "TotalBillableMTD", "PacingStatus", "PacingPct", "AccountCount" };
        var rows = items.Select(c => (IReadOnlyList<string?>)new[]
        {
            c.ContractCode,
            c.ClientName,
            c.ProjectName,
            c.BillingCycle,
            c.CommittedBudgetVnd.ToString(CultureInfo.InvariantCulture),
            c.SpendMtdVnd.ToString(CultureInfo.InvariantCulture),
            c.TotalBillableMtdVnd.ToString(CultureInfo.InvariantCulture),
            c.PacingStatus,
            c.PacingPercent.ToString(CultureInfo.InvariantCulture),
            c.AccountCount.ToString(CultureInfo.InvariantCulture),
        });
        ExportCsvWithDialog($"adsops-client-retainers-{DateTime.Now:yyyyMMdd}.csv", headers, rows, "Client Retainers");
    }

    private Border BuildTeamAndSeatsCard()
    {
        var box = new StackPanel();
        var hdr = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdr.Children.Add(new TextBlock
        {
            Text = "Nhân sự Team & Chỗ ngồi (Seats)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (_teamSummary == null)
        {
            box.Children.Add(hdr);
            box.Children.Add(new TextBlock
            {
                Text = "Chỉ Chủ sở hữu Workspace (Owner) mới xem & quản lý thành viên Team / Seats.",
                FontSize = 13,
                Foreground = ThemeTokens.TextMuted,
            });
            var lockedCard = UiComponents.CreateCard(box, new Thickness(14));
            return lockedCard;
        }

        var inviteBtn = UiComponents.CreateButton("Mời thành viên", ButtonVariant.Primary, FluentIcons.Add, compact: true, onClick: (_, _) => OpenInviteTeamMemberDialog());
        Grid.SetColumn(inviteBtn, 1);
        hdr.Children.Add(inviteBtn);
        box.Children.Add(hdr);

        var seatStr = _teamSummary.SeatLimit.HasValue ? $"{_teamSummary.ActiveMembers} / {_teamSummary.SeatLimit.Value} ghế" : $"{_teamSummary.ActiveMembers} thành viên (Không giới hạn)";
        var pills = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        void AddTeamPill(string t, Brush fg, Brush bg, Brush bd)
        {
            var p = UiComponents.CreateBadgePill(t, fg, bg, bd);
            p.Margin = new Thickness(0, 0, 8, 6);
            pills.Children.Add(p);
        }
        AddTeamPill($"Ghế đang dùng: {seatStr}", ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
        AddTeamPill($"Lời mời chờ: {_teamSummary.PendingInvitations}", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
        if (!string.IsNullOrWhiteSpace(_teamSummary.PlanReference))
        {
            AddTeamPill($"Gói: {_teamSummary.PlanReference}", ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
        }
        box.Children.Add(pills);

        foreach (var m in _teamMembers)
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var c0 = new StackPanel();
            c0.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(m.FullName) ? m.Email : $"{m.FullName} ({m.Email})", FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary });
            c0.Children.Add(new TextBlock { Text = $"{m.AssignedBusinessManagerCount} BM • {m.AssignedAdAccountCount} TKQC • {m.ActiveSessionCount} phiên đang mở", FontSize = 11, Foreground = ThemeTokens.TextMuted });
            g.Children.Add(c0);

            var rolePill = UiComponents.CreateBadgePill(m.Role.ToUpperInvariant(), ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder);
            Grid.SetColumn(rolePill, 1);
            g.Children.Add(rolePill);

            var isSusp = string.Equals(m.Status, "suspended", StringComparison.OrdinalIgnoreCase);
            var stPill = UiComponents.CreateBadgePill(
                m.Status.ToUpperInvariant(),
                isSusp ? ThemeTokens.DangerText : ThemeTokens.SuccessText,
                isSusp ? ThemeTokens.DangerBg : ThemeTokens.SuccessBg,
                isSusp ? ThemeTokens.DangerBorder : ThemeTokens.SuccessBorder);
            Grid.SetColumn(stPill, 2);
            g.Children.Add(stPill);

            var act = new StackPanel { Orientation = Orientation.Horizontal };
            if (!string.Equals(m.Role, "owner", StringComparison.OrdinalIgnoreCase))
            {
                var nextRole = m.Role.ToLowerInvariant() switch { "viewer" => "operator", "operator" => "admin", _ => "viewer" };
                var roleBtn = UiComponents.CreateButton($"Đổi -> {nextRole}", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
                {
                    try
                    {
                        SetBusy(true);
                        await _api.ChangeTeamMemberRoleAsync(m.Id, nextRole);
                        AppendLog($"Đã đổi quyền {m.Email} thành {nextRole}.");
                        await SyncCloudAsync(silent: false);
                    }
                    catch (Exception ex) { AppendLog($"Lỗi đổi quyền: {ex.Message}"); }
                    finally { SetBusy(false); }
                });
                roleBtn.Margin = new Thickness(0, 0, 6, 0);
                act.Children.Add(roleBtn);

                var lockBtn = UiComponents.CreateButton(isSusp ? "Mở khóa" : "Tạm khóa", isSusp ? ButtonVariant.Success : ButtonVariant.Danger, compact: true, onClick: async (_, _) =>
                {
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
                });
                act.Children.Add(lockBtn);
            }
            Grid.SetColumn(act, 3);
            g.Children.Add(act);

            var card = UiComponents.CreateCard(g, new Thickness(11, 8, 11, 8), ThemeTokens.BgSurfaceElevated);
            card.Margin = new Thickness(0, 0, 0, 6);
            box.Children.Add(card);
        }

        if (_teamInvitations.Count > 0)
        {
            box.Children.Add(new TextBlock
            {
                Text = $"Lời mời đã phát hành ({_teamInvitations.Count})",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = ThemeTokens.TextPrimary,
                Margin = new Thickness(0, 10, 0, 6),
            });
            foreach (var inv in _teamInvitations)
            {
                var ig = new Grid();
                ig.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
                ig.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
                ig.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var ic0 = new StackPanel();
                ic0.Children.Add(new TextBlock { Text = $"{inv.EmailNormalized} ({inv.InvitedRole})", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary });
                ic0.Children.Add(new TextBlock { Text = $"Token: ***{inv.TokenLastFour ?? "----"} • Hết hạn: {inv.ExpiresAt}", FontFamily = ThemeTokens.MonoFont, FontSize = 11, Foreground = ThemeTokens.TextMuted });
                ig.Children.Add(ic0);

                var stPill = UiComponents.CreateBadgePill(inv.Status.ToUpperInvariant(), ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder);
                Grid.SetColumn(stPill, 1);
                ig.Children.Add(stPill);

                var iAct = new StackPanel { Orientation = Orientation.Horizontal };
                if (string.Equals(inv.Status, "pending", StringComparison.OrdinalIgnoreCase))
                {
                    var rsBtn = UiComponents.CreateButton("Gửi lại", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
                    {
                        try
                        {
                            SetBusy(true);
                            var res = await _api.ResendTeamInvitationAsync(inv.Id);
                            await SyncCloudAsync(silent: true);
                            ShowInviteTokenPopupDialog(inv.EmailNormalized, res.InviteLinkToken);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi gửi lại lời mời: {ex.Message}"); }
                        finally { SetBusy(false); }
                    });
                    rsBtn.Margin = new Thickness(0, 0, 6, 0);
                    var rvBtn = UiComponents.CreateButton("Thu hồi", ButtonVariant.Danger, compact: true, onClick: async (_, _) =>
                    {
                        try
                        {
                            SetBusy(true);
                            await _api.RevokeTeamInvitationAsync(inv.Id, "Thu hồi từ AdsOps Desktop Pro");
                            AppendLog($"Đã thu hồi lời mời {inv.EmailNormalized}.");
                            await SyncCloudAsync(silent: false);
                        }
                        catch (Exception ex) { AppendLog($"Lỗi thu hồi lời mời: {ex.Message}"); }
                        finally { SetBusy(false); }
                    });
                    iAct.Children.Add(rsBtn);
                    iAct.Children.Add(rvBtn);
                }
                Grid.SetColumn(iAct, 2);
                ig.Children.Add(iAct);

                var ic = UiComponents.CreateCard(ig, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated);
                ic.Margin = new Thickness(0, 0, 0, 6);
                box.Children.Add(ic);
            }
        }

        return UiComponents.CreateCard(box, new Thickness(14));
    }

    private Border BuildSelfUpdaterCard()
    {
        var p = new StackPanel();
        p.Children.Add(new TextBlock
        {
            Text = "Cập nhật Phần mềm (One-Click Self-Updater)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 4),
        });
        var integrity = BinaryIntegrityInspector.InspectCurrentProcess();
        var shaShort = integrity.Sha256Hex.Length > 24
            ? $"{integrity.Sha256Hex[..16]}...{integrity.Sha256Hex[^8..]}"
            : integrity.Sha256Hex;
        p.Children.Add(new TextBlock
        {
            Text = $"Phiên bản hiện tại: AdsOps Desktop Pro v{DesktopAppInfo.Version} (Extension v{DesktopAppInfo.ExtVersion})",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 0, 0, 4),
        });
        p.Children.Add(new TextBlock
        {
            Text = $"🔐 Chữ ký & Toàn vẹn: {integrity.SignatureStatus} • SHA-256: {shaShort}",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 11,
            Foreground = integrity.HasEmbeddedSignature ? ThemeTokens.SuccessText : ThemeTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 4),
        });
        p.Children.Add(new TextBlock
        {
            Text = _updateStatusText,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var row = new WrapPanel();
        var checkBtn = UiComponents.CreateButton("Kiểm tra bản mới", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await CheckForAppUpdatesAsync());
        checkBtn.Margin = new Thickness(0, 0, 8, 6);
        row.Children.Add(checkBtn);

        if (_latestUpdateManifest != null && !string.IsNullOrWhiteSpace(_latestUpdateManifest.DownloadUrl))
        {
            var isNewer = SelfUpdateService.IsNewerVersion(_latestUpdateManifest.Version, DesktopAppInfo.Version);
            var applyLabel = isNewer ? $"Cập nhật lên v{_latestUpdateManifest.Version} & Khởi động lại" : $"Cài đặt lại v{_latestUpdateManifest.Version}";
            var applyBtn = UiComponents.CreateButton(applyLabel, isNewer ? ButtonVariant.Primary : ButtonVariant.Secondary, FluentIcons.Download, onClick: async (_, _) => await ApplySelfUpdateAsync());
            applyBtn.Margin = new Thickness(0, 0, 8, 6);
            row.Children.Add(applyBtn);
        }

        p.Children.Add(row);
        return UiComponents.CreateCard(p);
    }

    internal async Task CheckForAppUpdatesAsync()
    {
        try
        {
            SetBusy(true);
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var res = await SelfUpdateService.FetchManifestAsync(http, DesktopAppInfo.DefaultManifestUrl);
            if (!res.Ok || res.Manifest == null)
            {
                _updateStatusText = $"Không kiểm tra được manifest: {res.Error}";
                AppendLog(_updateStatusText);
            }
            else
            {
                _latestUpdateManifest = res.Manifest;
                _updateStatusText = res.UpdateAvailable
                    ? $"Có bản mới v{res.LatestVersion} (Ext v{res.Manifest.ExtVersion})! {res.Manifest.ReleaseNotes}"
                    : $"Bạn đang dùng bản mới nhất (v{DesktopAppInfo.Version}). {res.Manifest.ReleaseNotes}";
                AppendLog(_updateStatusText);
            }
        }
        catch (Exception ex)
        {
            _updateStatusText = $"Lỗi kiểm tra cập nhật: {ex.Message}";
            AppendLog(_updateStatusText);
        }
        finally
        {
            SetBusy(false);
            RenderCurrentView();
        }
    }

    internal async Task ApplySelfUpdateAsync()
    {
        if (_latestUpdateManifest == null) return;
        var ok = UiComponents.ShowConfirmActionDialog(
            this,
            "Cập nhật & Khởi động lại",
            $"Tải bản v{_latestUpdateManifest.Version} và ghi đè AdsOpsDesktop.exe?",
            new (string, string)[] { ("Phiên bản mới:", _latestUpdateManifest.Version), ("Nguồn:", _latestUpdateManifest.DownloadUrl) },
            "Ứng dụng sẽ tự đóng trong vài giây, thay thế tệp và tự khởi động lại.",
            "Cập nhật ngay");
        if (!ok) return;

        try
        {
            SetBusy(true);
            var appDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            await SelfUpdateService.DownloadValidateExtractAndSpawnUpdaterAsync(
                http,
                _latestUpdateManifest,
                Environment.ProcessId,
                appDir,
                Path.GetFileName(Environment.ProcessPath ?? "AdsOpsDesktop.exe"),
                AppendLog);
            ExitApplicationCleanly();
        }
        catch (Exception ex)
        {
            _updateStatusText = $"Lỗi cập nhật tự động: {ex.Message}";
            AppendLog(_updateStatusText);
            MessageBox.Show(this, _updateStatusText, "Lỗi Cập nhật", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }
}
