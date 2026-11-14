using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
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
                AppView.Settings => BuildSettingsView(),
                _ => BuildOverviewView(),
            };
        }

        _viewHost.Content = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(20, 16, 20, 20),
            Content = body,
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
        quickPanel.Children.Add(quickWrap);

        var quickCard = UiComponents.CreateCard(quickPanel);
        quickCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(quickCard);

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
        var selectAllBtn = UiComponents.CreateButton("Chọn tất cả hiển thị", ButtonVariant.Secondary, onClick: (_, _) =>
        {
            var visibleIds = FilterVias().Select(x => x.ViaId).ToList();
            var allSelected = visibleIds.Count > 0 && visibleIds.All(id => _selectedViaIds.Contains(id));
            if (allSelected) _selectedViaIds.Clear();
            else foreach (var id in visibleIds) _selectedViaIds.Add(id);
            RefreshBulkAndList();
        });
        selectAllBtn.Margin = new Thickness(0, 0, 8, 0);
        var addViaBtn = UiComponents.CreateButton("Thêm Via mới", ButtonVariant.Primary, FluentIcons.Add, onClick: (_, _) => OpenViaEditorDialog(null));
        rightHeaderBtns.Children.Add(selectAllBtn);
        rightHeaderBtns.Children.Add(addViaBtn);
        Grid.SetColumn(rightHeaderBtns, 1);
        searchRow.Children.Add(rightHeaderBtns);
        filterCardStack.Children.Add(searchRow);

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
        filterCardStack.Children.Add(chipWrap);

        var filterCard = UiComponents.CreateCard(filterCardStack, new Thickness(12));
        filterCard.Margin = new Thickness(0, 0, 0, 12);
        root.Children.Add(filterCard);
        root.Children.Add(bulkBarHost);
        root.Children.Add(listHost);

        RefreshBulkAndList();
        return root;
    }

    private IEnumerable<ViaWorkspaceEntry> FilterVias()
    {
        var q = (_viaSearch ?? "").Trim();
        return _vias.Where(v =>
        {
            var matchFilter = _viaTierFilter switch
            {
                "vault" => v.RoleTier is "vault" or "hold",
                "camp" => v.RoleTier is not "vault" and not "hold" and not "standby",
                "standby" => v.RoleTier == "standby",
                "keepalive_due" => v.NeedsKeepAlive,
                "72h_lock" => v.WarmupPhase == "72h_lock",
                _ => true,
            };
            if (!matchFilter) return false;
            if (string.IsNullOrEmpty(q)) return true;

            return v.Label.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.ExternalReferenceId.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.ProfileDir.Contains(q, StringComparison.OrdinalIgnoreCase)
                || v.NetworkLabel.Contains(q, StringComparison.OrdinalIgnoreCase);
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

        var btns = new StackPanel { Orientation = Orientation.Horizontal };
        var warmupSel = UiComponents.CreateButton("Đảo Ấm lô chọn", ButtonVariant.Primary, FluentIcons.CoffeeWarmup, compact: true, onClick: (_, _) =>
        {
            EnqueueKeepAliveVias(selected, $"Đảo Ấm {selected.Count} Via đã chọn", requireConfirm: true);
        });
        warmupSel.Margin = new Thickness(0, 0, 6, 0);

        var checkPxSel = UiComponents.CreateButton("Check Proxy đã chọn", ButtonVariant.Secondary, FluentIcons.Globe, compact: true, onClick: async (_, _) =>
        {
            await CheckSelectedViaProxiesAsync(selected);
            refreshList();
        });
        checkPxSel.Margin = new Thickness(0, 0, 6, 0);

        var provSel = UiComponents.CreateButton("Cấp Extension", ButtonVariant.Secondary, FluentIcons.ShieldCheck, compact: true, onClick: (_, _) =>
        {
            foreach (var v in selected) v.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(v);
            AppendLog($"Đã cấp Extension Companion cho {selected.Count} Via đã chọn.");
            MessageBox.Show(this, $"Đã cấp Extension cho {selected.Count} Via.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
        });
        provSel.Margin = new Thickness(0, 0, 6, 0);

        var clearSel = UiComponents.CreateButton("Bỏ chọn", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
        {
            _selectedViaIds.Clear();
            refreshList();
        });

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
        var tierPill = v.RoleTier switch
        {
            "vault" or "hold" => UiComponents.CreateBadgePill("HOLD BM", ThemeTokens.PurpleText, ThemeTokens.PurpleBg, ThemeTokens.PurpleBorder),
            "standby" => UiComponents.CreateBadgePill("DỰ PHÒNG", ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
            _ => UiComponents.CreateBadgePill("LÊN CAMP", ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder),
        };
        tierPill.Margin = new Thickness(0, 0, 6, 0);
        titleRow.Children.Add(tierPill);

        var (wmFg, wmBg, wmBd) = v.WarmupPhase switch
        {
            "72h_lock" => (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder),
            "7d_warmup" => (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
            _ => (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder),
        };
        var wmPill = UiComponents.CreateBadgePill(v.WarmupLabel, wmFg, wmBg, wmBd);
        wmPill.Margin = new Thickness(0, 0, 8, 0);
        titleRow.Children.Add(wmPill);

        titleRow.Children.Add(new TextBlock
        {
            Text = v.Label,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
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

        var copyBtn = UiComponents.CreateButton("", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) => CopyViaTotpToClipboard(v, codeTb), tooltip: "Copy mã 2FA 6 số");
        Grid.SetColumn(copyBtn, 1);
        otpBox.Children.Add(copyBtn);

        _liveTotpBindings.Add(new LiveTotpBinding(v.ViaId, v.ProfileDir, v.Label, v.TwoFaSecret, codeTb, remainTb, remainPill));
        var otpBorder = UiComponents.CreateCard(otpBox, new Thickness(8, 6, 8, 6), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
        otpBorder.Margin = new Thickness(0, 0, 10, 0);
        otpBorder.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(otpBorder, 3);
        grid.Children.Add(otpBorder);

        // Col 4: Row Actions
        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var openBtn = UiComponents.CreateButton("Mở Chrome", ButtonVariant.Primary, FluentIcons.RocketLaunch, compact: true, onClick: (_, _) => LaunchViaChromeSafe(v, "https://www.facebook.com/"));
        openBtn.Margin = new Thickness(0, 0, 6, 0);

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

        actions.Children.Add(openBtn);
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
                    ("Nghỉ giãn cách:", $"~{_batchStaggerSec}s ± 35% Jitter + IP Cluster Guard ({_config.MaxViasPerProxyInBatch}/IP)"),
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

                var tasks = resp.BatchItems.Select(b => new QueueTaskItem(
                    b.ViaId,
                    b.ViaLabel,
                    b.BrowserProfile,
                    b.NetworkLabel,
                    string.IsNullOrWhiteSpace(b.LaunchUrl) ? "https://www.facebook.com/pages/creation" : b.LaunchUrl,
                    $"Tạo Page: {b.PageName}",
                    "standard_via")).ToList();

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
                    _config.MaxViasPerProxyInBatch,
                    _config.AutoKeepAliveStartHour,
                    _config.AutoKeepAliveEndHour,
                    enforceDaytimeWindow: true);
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi khởi tạo Tạo Page hàng loạt: {ex.Message}");
                MessageBox.Show(this, ex.Message, "Lỗi Tạo Page hàng loạt", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        });
        batchStack.Children.Add(runBatchBtn);

        var leftCard = UiComponents.CreateCard(batchStack);
        Grid.SetColumn(leftCard, 0);
        cols.Children.Add(leftCard);

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
        chkAutoKa.Margin = new Thickness(0, 0, 0, 6);
        chkPrePx.Margin = new Thickness(0, 0, 0, 6);
        chkAutoClose.Margin = new Thickness(0, 0, 0, 10);

        var guardNums = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        guardNums.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbStartH = UiComponents.CreateTextBox(_config.AutoKeepAliveStartHour.ToString());
        var tbEndH = UiComponents.CreateTextBox(_config.AutoKeepAliveEndHour.ToString());
        var tbMaxPerIp = UiComponents.CreateTextBox(_config.MaxViasPerProxyInBatch.ToString());
        var g1 = BuildLabeledBox("Giờ bắt đầu", tbStartH);
        var g2 = BuildLabeledBox("Giờ nghỉ đêm", tbEndH);
        var g3 = BuildLabeledBox("Max Via / 1 IP", tbMaxPerIp);
        Grid.SetColumn(g1, 0);
        Grid.SetColumn(g2, 2);
        Grid.SetColumn(g3, 4);
        guardNums.Children.Add(g1);
        guardNums.Children.Add(g2);
        guardNums.Children.Add(g3);

        var localBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var saveLocalBtn = UiComponents.CreateButton("Lưu Luật Bảo vệ", ButtonVariant.Secondary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            _config.AutoKeepAliveScheduler = chkAutoKa.IsChecked == true;
            _config.PreCheckProxyBeforeLaunch = chkPrePx.IsChecked == true;
            _config.AutoCloseKeepAliveTab = chkAutoClose.IsChecked == true;
            if (int.TryParse(tbStartH.Text, out var sh)) _config.AutoKeepAliveStartHour = Math.Clamp(sh, 0, 22);
            if (int.TryParse(tbEndH.Text, out var eh)) _config.AutoKeepAliveEndHour = Math.Clamp(eh, 1, 23);
            if (int.TryParse(tbMaxPerIp.Text, out var mp)) _config.MaxViasPerProxyInBatch = Math.Clamp(mp, 1, 10);
            _config.Save();
            AppendLog("Đã lưu cấu hình An toàn Hàng đợi & Đảo Ấm.");
        });
        saveLocalBtn.Margin = new Thickness(0, 0, 8, 0);
        var runKaNow = UiComponents.CreateButton("Đảo Ấm Via quá hạn ngay", ButtonVariant.Primary, FluentIcons.CoffeeWarmup, onClick: (_, _) => StartKeepAliveDueQueue(requireConfirm: true));
        localBtns.Children.Add(saveLocalBtn);
        localBtns.Children.Add(runKaNow);

        localGuardPanel.Children.Add(chkAutoKa);
        localGuardPanel.Children.Add(chkPrePx);
        localGuardPanel.Children.Add(chkAutoClose);
        localGuardPanel.Children.Add(guardNums);
        localGuardPanel.Children.Add(localBtns);

        var localCard = UiComponents.CreateCard(localGuardPanel);
        localCard.Margin = new Thickness(0, 0, 0, 14);
        rightStack.Children.Add(localCard);

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

        // Business Managers Strip
        if (_bms.Count > 0)
        {
            var bmHeader = new TextBlock
            {
                Text = $"Business Manager đang quản lý ({_bms.Count})",
                FontSize = 14,
                FontWeight = FontWeights.Bold,
                Foreground = ThemeTokens.TextPrimary,
                Margin = new Thickness(0, 0, 0, 8),
            };
            stack.Children.Add(bmHeader);

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
        qSyncBtn.Margin = new Thickness(10, 0, 0, 0);
        Grid.SetColumn(qSyncBtn, 1);
        topRow.Children.Add(qSyncBtn);
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
            };
            Grid.SetColumn(tb, col);
            g.Children.Add(tb);
        }

        AddHdr(0, "TÀI KHOẢN & ID");
        AddHdr(1, "TRẠNG THÁI");
        AddHdr(2, "SỐ DƯ", HorizontalAlignment.Right);
        AddHdr(3, "NGƯỠNG", HorizontalAlignment.Right);
        AddHdr(4, "GIỚI HẠN NGÀY", HorizontalAlignment.Right);
        AddHdr(5, "BM & VIA CẦM");
        AddHdr(6, "THAO TÁC", HorizontalAlignment.Right);

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

        // Col 5: BM & Linked Via
        var c5 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 8, 0) };
        var viaLbl = a.FacebookIdentities.Count > 0 ? string.Join(", ", a.FacebookIdentities.Select(x => x.Label)) : "Chưa gắn Via";
        c5.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(a.BusinessManagerName) ? "Tài khoản Cá nhân / Chưa rõ BM" : a.BusinessManagerName!, FontSize = 12, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
        c5.Children.Add(new TextBlock { Text = $"Via: {viaLbl} • {a.BillingMeta?.PaymentCardDisplay ?? "—"}", FontSize = 12, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(c5, 5);
        g.Children.Add(c5);

        // Col 6: Open Ads Manager in Via's Chrome Profile
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
        openAdsBtn.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(openAdsBtn, 6);
        g.Children.Add(openAdsBtn);

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
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(115) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(115) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(125) });
    }

    private static string FormatMetricOrDash(string? raw, string currency)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "—";
        if (decimal.TryParse(raw.Trim(), out var d))
        {
            return $"{d:N0} {currency}".Trim();
        }
        return raw.Trim();
    }

    // ------------------------------------------------------------------------
    // VIEW 6: KÉT KHÓA & CÀI ĐẶT (SETTINGS & DPAPI VAULT)
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
                _config.Save();
                _api.Configure(_config.BackendBaseUrl, loginRes.AccessToken);
                pbPass.Clear();
                AppendLog($"Đăng nhập Cloud thành công với '{_config.UserEmail}' (JWT được mã hóa Windows DPAPI).");
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
                _config.Save();
                _api.Configure(_config.BackendBaseUrl, "");
                _currentUser = null;
                _vias.Clear();
                _hasLoadedOnce = false;
                RefreshHeaderAndSidebar();
                RenderCurrentView();
            });
            authBtns.Children.Add(logoutBtn);
        }
        authPanel.Children.Add(authBtns);

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
        });

        leftStack.Children.Add(UiComponents.CreateCard(osPanel));
        Grid.SetColumn(leftStack, 0);
        cols.Children.Add(leftStack);

        // Right: Encrypted Vault Backup & DPAPI Inventory
        var rightStack = new StackPanel();
        var vaultPanel = new StackPanel();
        vaultPanel.Children.Add(new TextBlock
        {
            Text = "Két bảo mật DPAPI & Sao lưu AES-256-GCM (.adsopsvault)",
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        });
        vaultPanel.Children.Add(new TextBlock
        {
            Text = "Xuất hoặc khôi phục toàn bộ Cookie Facebook, Secret 2FA và danh sách Via sang máy tính khác bằng mã hóa PBKDF2-SHA256 (210,000 vòng) + AES-256-GCM.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var localEntries = LocalSecretVaultStore.Default.ExportPlainEntries();
        var invCard = UiComponents.CreateCard(new TextBlock
        {
            Text = $"Két DPAPI hiện tại trên máy này đang bảo vệ {localEntries.Count} bản ghi Cookie / 2FA thô (không rời khỏi máy trừ khi bạn chủ động Xuất file backup có mật khẩu).",
            FontSize = 12,
            Foreground = ThemeTokens.SuccessText,
            TextWrapping = TextWrapping.Wrap,
        }, new Thickness(12), ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
        invCard.Margin = new Thickness(0, 0, 0, 12);
        vaultPanel.Children.Add(invCard);

        var vaultBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var expBtn = UiComponents.CreateButton("Xuất Backup (.adsopsvault)", ButtonVariant.Primary, FluentIcons.Lock, onClick: (_, _) =>
        {
            var path = SystemTrayService.ShowSaveVaultDialog($"adsops-vault-{DateTime.Now:yyyyMMdd-HHmm}.adsopsvault");
            if (string.IsNullOrWhiteSpace(path)) return;
            var pwd = PromptPasswordDialog("Đặt Mật khẩu cho File Sao lưu", "Mật khẩu này sẽ được dùng để giải mã khi khôi phục sang máy mới. Tuyệt đối không quên mật khẩu.", confirmMatch: true);
            if (string.IsNullOrWhiteSpace(pwd)) return;

            try
            {
                var payload = new VaultBackupPayload
                {
                    BackendBaseUrl = _config.BackendBaseUrl,
                    UserEmail = _config.UserEmail,
                    Vias = _vias.ToList(),
                    LocalSecrets = LocalSecretVaultStore.Default.ExportPlainEntries(),
                };
                var bytes = VaultBackupService.EncryptToBytes(payload, pwd);
                File.WriteAllBytes(path, bytes);
                AppendLog($"Đã xuất Két mã hóa AES-256-GCM ({payload.LocalSecrets.Count} secret): {path}");
                MessageBox.Show(this, $"Xuất thành công {payload.LocalSecrets.Count} bí mật vào:\n{path}", "Hoàn tất Backup", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "Lỗi Xuất Két", MessageBoxButton.OK, MessageBoxImage.Error); }
        });
        expBtn.Margin = new Thickness(0, 0, 8, 0);

        var impBtn = UiComponents.CreateButton("Khôi phục từ Backup", ButtonVariant.Secondary, FluentIcons.FolderOpen, onClick: (_, _) =>
        {
            var path = SystemTrayService.ShowOpenVaultDialog();
            if (string.IsNullOrWhiteSpace(path)) return;
            var pwd = PromptPasswordDialog("Nhập Mật khẩu giải mã Két", $"Giải mã file: {Path.GetFileName(path)}", confirmMatch: false);
            if (string.IsNullOrWhiteSpace(pwd)) return;

            try
            {
                var bytes = File.ReadAllBytes(path);
                var payload = VaultBackupService.DecryptFromBytes(bytes, pwd);
                var imported = LocalSecretVaultStore.Default.ImportPlainEntries(payload.LocalSecrets);
                AppendLog($"Đã khôi phục {imported} bản ghi Cookie/2FA từ Két AES-256-GCM vào DPAPI máy này.");
                MessageBox.Show(this, $"Khôi phục thành công {imported} Via vào Két DPAPI máy này.", "Khôi phục thành công", MessageBoxButton.OK, MessageBoxImage.Information);
                RenderCurrentView();
            }
            catch (Exception ex) { MessageBox.Show(this, $"Không giải mã được file Két (sai mật khẩu hoặc hỏng file): {ex.Message}", "Lỗi Giải mã", MessageBoxButton.OK, MessageBoxImage.Error); }
        });

        vaultBtns.Children.Add(expBtn);
        vaultBtns.Children.Add(impBtn);
        vaultPanel.Children.Add(vaultBtns);

        rightStack.Children.Add(UiComponents.CreateCard(vaultPanel));

        Grid.SetColumn(rightStack, 2);
        cols.Children.Add(rightStack);
        return cols;
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
            foreach (var v in _vias)
            {
                if (string.IsNullOrWhiteSpace(v.NetworkLabel)) continue;
                var hp = AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel);
                var found = map.Values.FirstOrDefault(m =>
                    (!string.IsNullOrWhiteSpace(m.NormalizedKey) && m.NormalizedKey.Contains(hp, StringComparison.OrdinalIgnoreCase)) ||
                    map.Keys.Any(k => k.Contains(hp, StringComparison.OrdinalIgnoreCase)));
                if (found != null)
                {
                    v.ProxyLastStatus = string.Equals(found.Status, "LIVE", StringComparison.OrdinalIgnoreCase) ? "LIVE" : "DEAD";
                    v.ProxyLatencyMs = found.LatencyMs;
                    v.ProxyExitIp = found.ExitIp;
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
                    var r = await _api.CheckProxyLiveAsync(v.NetworkLabel, v.Label);
                    var isLive = string.Equals(r.Status, "LIVE", StringComparison.OrdinalIgnoreCase);
                    v.ProxyLastStatus = isLive ? "LIVE" : "DEAD";
                    v.ProxyLatencyMs = r.LatencyMs;
                    v.ProxyExitIp = r.ExitIp;
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
}
