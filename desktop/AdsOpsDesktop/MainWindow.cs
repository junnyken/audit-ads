using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace AdsOpsDesktop;

internal enum AppView
{
    Overview,
    Vias,
    Automation,
    PagesBm,
    AdAccounts,
    Settings,
}

internal sealed record LiveTotpBinding(
    string ViaId,
    string ProfileDir,
    string ViaLabel,
    string InlineSecret,
    TextBlock CodeBlock,
    TextBlock CountdownBlock,
    Border CountdownPill);

internal sealed partial class MainWindow : Window
{
    private readonly bool _startMinimized;
    private bool _allowExit;
    private bool _started;

    private DesktopConfig _config;
    private readonly AdsOpsApiClient _api = new();
    private LocalBridgeServer? _bridge;
    private readonly AutomationQueueEngine _queue;
    private SystemTrayService? _tray;

    private readonly DispatcherTimer _uiTimer;
    private readonly DispatcherTimer _keepAliveTimer;
    private readonly DispatcherTimer _cloudSyncTimer;

    // Navigation & Shell visual elements
    private AppView _activeView = AppView.Overview;
    private readonly Dictionary<AppView, Button> _navButtons = new();
    private readonly Dictionary<AppView, TextBlock> _navBadges = new();
    private TextBlock _headerTitle = null!;
    private TextBlock _headerSubtitle = null!;
    private StackPanel _headerActionsPanel = null!;
    private ProgressBar _headerBusyBar = null!;
    private Border _errorBanner = null!;
    private TextBlock _errorBannerText = null!;
    private Button _sidebarBridgePill = null!;
    private TextBlock _sidebarCloudUser = null!;
    private TextBlock _sidebarCloudSub = null!;
    private ContentControl _viewHost = null!;

    // Collapsible log bar
    private RowDefinition _logRowDef = null!;
    private TextBlock _logPreviewText = null!;
    private TextBox _logBox = null!;
    private Button _logToggleBtn = null!;
    private bool _logExpanded;
    private readonly List<string> _logLines = new();

    // Live data & UI view state
    private List<ChromeProfileInfo> _chromeProfiles = new();
    private CurrentUserDto? _currentUser;
    private List<ViaWorkspaceEntry> _vias = new();
    private List<BusinessManagerItemDto> _bms = new();
    private List<AdAccountItemDto> _adAccounts = new();
    private FacebookPagesSummaryDto? _pagesSummary;
    private AlertSummaryDto? _alertSummary;
    private List<AlertItemDto> _alerts = new();
    private AutomationCronStatusDto? _cronStatus;

    private bool _isBusy;
    private bool _hasLoadedOnce;
    private string? _lastErrorMessage;
    private DateTime? _lastSyncedAtLocal;
    private DateTime _lastKeepAliveCheckUtc = DateTime.MinValue;

    // Filter & selection states
    private string _viaSearch = "";
    private string _viaTierFilter = "all";
    private readonly HashSet<string> _selectedViaIds = new(StringComparer.OrdinalIgnoreCase);

    private string _pageSearch = "";
    private string _pageFilter = "all";

    private string _adSearch = "";
    private string _adFilter = "all";

    // Batch Page creation state preserved across tab switches
    private string _batchNicheKey = PageNicheTemplates.All[0].Key;
    private int _batchCount = 3;
    private int _batchStaggerSec = 65;
    private string _batchPrefix = "";
    private string _batchCustomNames = "";
    private string _batchOwnerBmId = "";
    private bool _batchAutoSubmit = true;

    // Live UI bindings that update smoothly without losing focus/scroll
    private readonly List<LiveTotpBinding> _liveTotpBindings = new();
    private TextBlock? _copiedToastTarget;
    private DateTime _copiedToastUntilUtc = DateTime.MinValue;
    private QueueSnapshot _queueSnapshot = new(QueuePhase.Idle, QueueKind.KeepAlive, 0, 0, 0, 0, 0, 0, "", "", false, "");
    private TextBlock? _queueSummaryText;
    private TextBlock? _queueCountdownText;
    private Button? _queuePauseBtn;
    private Button? _queueSkipBtn;
    private Button? _queueStopBtn;
    private Border? _queueLiveBanner;

    public MainWindow(bool startMinimized = false)
    {
        _startMinimized = startMinimized;
        _config = DesktopConfig.Load();
        _api.Configure(_config.BackendBaseUrl, _config.GetJwt());

        _queue = new AutomationQueueEngine(
            PreCheckProxyAsync,
            LaunchViaQueueItemAsync,
            OnQueueCompletedAsync,
            AppendLog);
        _queue.SnapshotChanged += OnQueueSnapshotChanged;

        Title = "AdsOps Desktop Pro v2.0";
        Width = 1320;
        Height = 840;
        MinWidth = 1040;
        MinHeight = 680;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = ThemeTokens.BgCanvas;
        Foreground = ThemeTokens.TextPrimary;
        FontFamily = ThemeTokens.UiFont;
        ThemeTokens.ApplyDarkTitleBar(this);

        BuildShellLayout();
        InitTray();

        _uiTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _uiTimer.Tick += (_, _) => OnUiSecondTick();

        _keepAliveTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        _keepAliveTimer.Tick += async (_, _) => await RunAutoKeepAliveTickAsync();

        _cloudSyncTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(300) };
        _cloudSyncTimer.Tick += async (_, _) => await SyncCloudAsync(silent: true);

        Loaded += async (_, _) => await EnsureStartedAsync();
        Closing += OnWindowClosing;

        if (_startMinimized)
        {
            ShowInTaskbar = false;
            WindowState = WindowState.Minimized;
            Visibility = Visibility.Hidden;
            Dispatcher.BeginInvoke(async () => await EnsureStartedAsync());
        }
    }

    private void BuildShellLayout()
    {
        var root = new Grid { Background = ThemeTokens.BgCanvas };
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(220) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var sidebar = BuildSidebar();
        Grid.SetColumn(sidebar, 0);
        root.Children.Add(sidebar);

        var mainArea = new Grid { Background = ThemeTokens.BgCanvas };
        mainArea.RowDefinitions.Add(new RowDefinition { Height = new GridLength(58) });
        mainArea.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        mainArea.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _logRowDef = new RowDefinition { Height = new GridLength(34) };
        mainArea.RowDefinitions.Add(_logRowDef);

        var header = BuildHeader();
        Grid.SetRow(header, 0);
        mainArea.Children.Add(header);

        _errorBanner = BuildErrorBanner();
        _errorBanner.Visibility = Visibility.Collapsed;
        Grid.SetRow(_errorBanner, 1);
        mainArea.Children.Add(_errorBanner);

        _viewHost = new ContentControl { Margin = new Thickness(0) };
        Grid.SetRow(_viewHost, 2);
        mainArea.Children.Add(_viewHost);

        var logBar = BuildCollapsibleLogBar();
        Grid.SetRow(logBar, 3);
        mainArea.Children.Add(logBar);

        Grid.SetColumn(mainArea, 1);
        root.Children.Add(mainArea);

        Content = root;
    }

    private Border BuildSidebar()
    {
        var outer = new Border
        {
            Background = ThemeTokens.BgSidebar,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(0, 0, 1, 0),
            Padding = new Thickness(12, 16, 12, 14),
        };

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // Brand Header
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(4, 0, 4, 18) };
        brand.Children.Add(new Border
        {
            Width = 34,
            Height = 34,
            CornerRadius = new CornerRadius(9),
            Background = ThemeTokens.AccentPrimary,
            Child = UiComponents.CreateIcon(FluentIcons.ShieldKey, 17, ThemeTokens.TextWhite),
        });
        var brandText = new StackPanel { Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        brandText.Children.Add(new TextBlock
        {
            Text = "AdsOps Pro",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        });
        brandText.Children.Add(new TextBlock
        {
            Text = "Desktop Suite v2.0",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
        });
        brand.Children.Add(brandText);
        grid.Children.Add(brand);

        // Nav Stack
        var navStack = new StackPanel();
        AddNavButton(navStack, AppView.Overview, "Tổng quan", FluentIcons.Home);
        AddNavButton(navStack, AppView.Vias, "Quản lý Đa Via", FluentIcons.People);
        AddNavButton(navStack, AppView.Automation, "Tự động hóa", FluentIcons.Play);
        AddNavButton(navStack, AppView.PagesBm, "Fanpage & BM", FluentIcons.Page);
        AddNavButton(navStack, AppView.AdAccounts, "Tài khoản QC", FluentIcons.Chart);
        AddNavButton(navStack, AppView.Settings, "Két khóa & Cài đặt", FluentIcons.Settings);
        Grid.SetRow(navStack, 1);
        grid.Children.Add(navStack);

        // Bottom Status Stack
        var footerStack = new StackPanel();

        var cloudStack = new StackPanel();
        _sidebarCloudUser = new TextBlock
        {
            Text = "Chưa đăng nhập",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        _sidebarCloudSub = new TextBlock
        {
            Text = "Mở Két khóa để kết nối Cloud",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 2, 0, 0),
        };
        cloudStack.Children.Add(_sidebarCloudUser);
        cloudStack.Children.Add(_sidebarCloudSub);
        var cloudCard = UiComponents.CreateCard(cloudStack, new Thickness(10, 8, 10, 8), ThemeTokens.BgSurface, ThemeTokens.BorderSubtle);
        cloudCard.Margin = new Thickness(0, 0, 0, 8);
        footerStack.Children.Add(cloudCard);

        _sidebarBridgePill = UiComponents.CreateButton(
            "Bridge: Đang khởi tạo...",
            ButtonVariant.Subtle,
            FluentIcons.Globe,
            compact: true,
            onClick: (_, _) => SwitchView(AppView.Settings),
            tooltip: "Local Bridge 127.0.0.1 kết nối trực tiếp với Web & Chrome Extension");
        _sidebarBridgePill.HorizontalAlignment = HorizontalAlignment.Stretch;
        _sidebarBridgePill.HorizontalContentAlignment = HorizontalAlignment.Left;
        footerStack.Children.Add(_sidebarBridgePill);

        Grid.SetRow(footerStack, 2);
        grid.Children.Add(footerStack);

        outer.Child = grid;
        return outer;
    }

    private void AddNavButton(StackPanel parent, AppView view, string label, string iconGlyph)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(24) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var ic = UiComponents.CreateIcon(iconGlyph, 15, ThemeTokens.TextSecondary);
        ic.HorizontalAlignment = HorizontalAlignment.Left;
        row.Children.Add(ic);

        var lbl = new TextBlock
        {
            Text = label,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(lbl, 1);
        row.Children.Add(lbl);

        var badge = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.WarningText,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        Grid.SetColumn(badge, 2);
        row.Children.Add(badge);

        var btn = new Button
        {
            Content = row,
            Margin = new Thickness(0, 0, 0, 4),
            Padding = new Thickness(10, 9, 10, 9),
            MinHeight = 38,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Cursor = System.Windows.Input.Cursors.Hand,
            FocusVisualStyle = null,
        };
        btn.Click += (_, _) => SwitchView(view);

        _navButtons[view] = btn;
        _navBadges[view] = badge;
        parent.Children.Add(btn);
    }

    private void UpdateNavStyles()
    {
        foreach (var (view, btn) in _navButtons)
        {
            var active = view == _activeView;
            var bg = active ? ThemeTokens.BgNavActive : Brushes.Transparent;
            var border = active ? ThemeTokens.InfoBorder : Brushes.Transparent;
            btn.Background = bg;
            btn.BorderBrush = border;

            if (btn.Content is Grid g)
            {
                if (g.Children[0] is TextBlock ic)
                {
                    ic.Foreground = active ? ThemeTokens.AccentText : ThemeTokens.TextSecondary;
                }
                if (g.Children[1] is TextBlock lbl)
                {
                    lbl.Foreground = active ? ThemeTokens.TextPrimary : ThemeTokens.TextSecondary;
                }
            }

            var tpl = new ControlTemplate(typeof(Button));
            var bd = new FrameworkElementFactory(typeof(Border));
            bd.Name = "Bd";
            bd.SetValue(Border.BackgroundProperty, bg);
            bd.SetValue(Border.BorderBrushProperty, border);
            bd.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
            bd.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));
            var cp = new FrameworkElementFactory(typeof(ContentPresenter));
            bd.AppendChild(cp);
            tpl.VisualTree = bd;

            if (!active)
            {
                var hover = new Trigger { Property = IsMouseOverProperty, Value = true };
                hover.Setters.Add(new Setter(Border.BackgroundProperty, ThemeTokens.BgNavHover, "Bd"));
                tpl.Triggers.Add(hover);
            }
            btn.Template = tpl;
        }
    }

    private Border BuildHeader()
    {
        var border = new Border
        {
            Background = ThemeTokens.BgHeader,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(20, 0, 20, 0),
        };

        var outerGrid = new Grid();
        outerGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        outerGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var contentGrid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        contentGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        contentGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        _headerTitle = new TextBlock
        {
            Text = "Tổng quan vận hành",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 17,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        };
        _headerSubtitle = new TextBlock
        {
            Text = "Chưa đồng bộ — Đăng nhập để tải dữ liệu Cloud & kiểm tra Chrome Profile.",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        titleStack.Children.Add(_headerTitle);
        titleStack.Children.Add(_headerSubtitle);
        contentGrid.Children.Add(titleStack);

        _headerActionsPanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(_headerActionsPanel, 1);
        contentGrid.Children.Add(_headerActionsPanel);

        outerGrid.Children.Add(contentGrid);

        _headerBusyBar = new ProgressBar
        {
            Height = 2,
            IsIndeterminate = true,
            Foreground = ThemeTokens.AccentText,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Visibility = Visibility.Collapsed,
        };
        Grid.SetRow(_headerBusyBar, 1);
        outerGrid.Children.Add(_headerBusyBar);

        border.Child = outerGrid;
        return border;
    }

    private Border BuildErrorBanner()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = UiComponents.CreateIcon(FluentIcons.Warning, 16, ThemeTokens.DangerText);
        icon.Margin = new Thickness(0, 0, 10, 0);
        grid.Children.Add(icon);

        _errorBannerText = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(_errorBannerText, 1);
        grid.Children.Add(_errorBannerText);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(12, 0, 0, 0) };
        var retryBtn = UiComponents.CreateButton("Thử lại", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: async (_, _) => await SyncCloudAsync(silent: false));
        retryBtn.Margin = new Thickness(0, 0, 6, 0);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
        {
            _lastErrorMessage = null;
            _errorBanner.Visibility = Visibility.Collapsed;
        });
        actions.Children.Add(retryBtn);
        actions.Children.Add(closeBtn);
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        return new Border
        {
            Background = ThemeTokens.DangerBg,
            BorderBrush = ThemeTokens.DangerBorder,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(20, 8, 20, 8),
            Child = grid,
        };
    }

    private Border BuildCollapsibleLogBar()
    {
        var border = new Border
        {
            Background = ThemeTokens.BgLogDrawer,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(0, 1, 0, 0),
        };

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(34) });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var topBar = new Grid { Margin = new Thickness(14, 0, 14, 0) };
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = "Nhật ký hệ thống:",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
        };
        topBar.Children.Add(label);

        _logPreviewText = new TextBlock
        {
            Text = "Sẵn sàng.",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(_logPreviewText, 1);
        topBar.Children.Add(_logPreviewText);

        var btns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var clearBtn = UiComponents.CreateButton("Xóa log", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
        {
            _logLines.Clear();
            _logBox.Text = "";
            _logPreviewText.Text = "Đã xóa nhật ký.";
        });
        clearBtn.Margin = new Thickness(0, 0, 4, 0);
        _logToggleBtn = UiComponents.CreateButton("Mở rộng", ButtonVariant.Subtle, FluentIcons.ChevronUp, compact: true, onClick: (_, _) => ToggleLogDrawer());
        btns.Children.Add(clearBtn);
        btns.Children.Add(_logToggleBtn);
        Grid.SetColumn(btns, 2);
        topBar.Children.Add(btns);
        grid.Children.Add(topBar);

        _logBox = new TextBox
        {
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = ThemeTokens.BgLogDrawer,
            Foreground = ThemeTokens.TextSecondary,
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = ThemeTokens.BorderSubtle,
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Padding = new Thickness(14, 8, 14, 8),
        };
        Grid.SetRow(_logBox, 1);
        grid.Children.Add(_logBox);

        border.Child = grid;
        return border;
    }

    private void ToggleLogDrawer()
    {
        _logExpanded = !_logExpanded;
        _logRowDef.Height = new GridLength(_logExpanded ? 180 : 34);
        if (_logToggleBtn.Content is StackPanel sp && sp.Children.Count >= 2)
        {
            if (sp.Children[0] is TextBlock ic) ic.Text = _logExpanded ? FluentIcons.ChevronDown : FluentIcons.ChevronUp;
            if (sp.Children[1] is TextBlock tb) tb.Text = _logExpanded ? "Thu gọn" : "Mở rộng";
        }
    }

    private void InitTray()
    {
        _tray = new SystemTrayService(
            onShowWindow: () => Dispatcher.BeginInvoke(RestoreFromTray),
            onSyncNow: () => Dispatcher.BeginInvoke(async () => await SyncCloudAsync(silent: false)),
            onWarmupDueVias: () => Dispatcher.BeginInvoke(() => StartKeepAliveDueQueue(requireConfirm: true)),
            onToggleQueuePause: () => Dispatcher.BeginInvoke(() =>
            {
                if (_queue.Current.Phase == QueuePhase.Paused) _queue.Resume();
                else _queue.Pause();
            }),
            onExitApp: () => Dispatcher.BeginInvoke(ExitApplicationCleanly),
            onLaunchViaChrome: v => Dispatcher.BeginInvoke(() => LaunchViaChromeSafe(v, "https://www.facebook.com/")),
            onCopyViaTotp: v => Dispatcher.BeginInvoke(() => CopyViaTotpToClipboard(v, showBalloon: true)));
    }

    private async Task EnsureStartedAsync()
    {
        if (_started) return;
        _started = true;
        await OnWindowLoadedAsync();
    }

    private async Task OnWindowLoadedAsync()
    {
        AppendLog("Khởi động AdsOps Desktop Pro v2.0 (WPF Dark UI + DPAPI Vault + Local TOTP).");
        _chromeProfiles = ExtensionProvisioner.ReadLocalChromeProfiles();
        AppendLog($"Phát hiện {_chromeProfiles.Count} Chrome Profile trên máy Windows.");

        StartBridgeServer();
        UpdateNavStyles();
        RefreshHeaderAndSidebar();
        RenderCurrentView();

        _uiTimer.Start();
        _keepAliveTimer.Start();
        _cloudSyncTimer.Start();

        if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            await SyncCloudAsync(silent: false);
        }
        else
        {
            AppendLog("Chưa đăng nhập Cloud. Mở mục Két khóa & Cài đặt để kết nối tài khoản.");
        }
    }

    private void StartBridgeServer()
    {
        try
        {
            _bridge?.Dispose();
            LocalBridgeServer.RetireLegacyBridgeHoldingPort(_config.BridgePort, AppendLog);
            _bridge = new LocalBridgeServer(
                _config.BridgePort,
                OnBridgeOpenChromeAsync,
                OnBridgeBrowserEventAsync,
                OnBridgeProvisionAllAsync,
                AppendLog,
                OnBridgeVaultSaveAsync,
                OnBridgeVaultGetAsync);
            _bridge.Start();
            var tpl = ExtensionProvisioner.LoadTemplates();
            AppendLog($"Local Bridge v2.0 đang lắng nghe tại http://127.0.0.1:{_bridge.BoundPort} (Ext v{tpl.Version}).");
        }
        catch (Exception ex)
        {
            AppendLog($"CẢNH BÁO: Không thể mở Local Bridge cổng {_config.BridgePort}: {ex.Message}");
        }
    }

    private Task<(bool Ok, string Message)> OnBridgeOpenChromeAsync(OpenChromeBridgeRequest req)
    {
        var tcs = new TaskCompletionSource<(bool Ok, string Message)>();
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                var url = !string.IsNullOrWhiteSpace(req.Url) && Uri.TryCreate(req.Url, UriKind.Absolute, out var u) && u.Scheme == "https"
                    ? req.Url
                    : "https://www.facebook.com/";

                var match = _vias.FirstOrDefault(v =>
                    (!string.IsNullOrWhiteSpace(req.Profile) && string.Equals(v.ProfileDir, req.Profile.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrWhiteSpace(req.Name) && string.Equals(v.Label, req.Name.Trim(), StringComparison.OrdinalIgnoreCase)));

                if (match != null)
                {
                    LaunchViaChromeSafe(match, url);
                    tcs.TrySetResult((true, $"Đã mở Chrome Profile '{match.ProfileDir}' cho Via '{match.Label}'."));
                    return;
                }

                var fallbackProfile = ExtensionProvisioner.ResolveProfileDirectory(req.Profile, req.Name);
                var tempVia = new ViaWorkspaceEntry
                {
                    Label = string.IsNullOrWhiteSpace(req.Name) ? fallbackProfile : req.Name!.Trim(),
                    BrowserProfileLabel = fallbackProfile,
                    ProfileDir = fallbackProfile,
                    NetworkLabel = req.Proxy ?? "",
                };
                var extFolder = ExtensionProvisioner.ProvisionForVia(tempVia);
                ExtensionProvisioner.LaunchChrome(url, fallbackProfile, extFolder, _config.UseIsolatedProfiles, tempVia.Label);
                AppendLog($"Mở nhanh Chrome từ Web/Bridge: Profile '{fallbackProfile}' -> {url}");
                tcs.TrySetResult((true, $"Đã mở Chrome '{fallbackProfile}'."));
            }
            catch (Exception ex)
            {
                tcs.TrySetResult((false, ex.Message));
            }
        });
        return tcs.Task;
    }

    private async Task<BrowserEventResponseDto> OnBridgeBrowserEventAsync(BrowserEventPayloadDto payload)
    {
        AppendLog($"Extension Event: {payload.EventType} | Via '{payload.ViaLabel}' | {payload.Detail}");
        if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            try
            {
                return await _api.PostBrowserEventAsync(payload);
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi gửi browser-event lên Cloud: {ex.Message}");
            }
        }
        return new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
    }

    private Task<int> OnBridgeProvisionAllAsync()
    {
        var tcs = new TaskCompletionSource<int>();
        Dispatcher.BeginInvoke(() => tcs.TrySetResult(ProvisionAllViaExtensions(silent: false)));
        return tcs.Task;
    }

    private Task<LocalVaultGetResult> OnBridgeVaultSaveAsync(LocalVaultSaveRequest req)
    {
        var res = LocalSecretVaultStore.Default.Upsert(req.ViaId, req.ViaLabel, req.ProfileDir, req.CookieRaw, req.TwoFaSecret);
        AppendLog($"Đã lưu DPAPI Vault local từ Extension/Bridge cho '{res.ViaLabel}'.");
        return Task.FromResult(ToVaultDto(res));
    }

    private Task<LocalVaultGetResult> OnBridgeVaultGetAsync(string viaId, string profile, string name)
    {
        var res = LocalSecretVaultStore.Default.Find(viaId, profile, name);
        return Task.FromResult(ToVaultDto(res));
    }

    private static LocalVaultGetResult ToVaultDto(LocalVaultLookupResult res) => new()
    {
        Ok = true,
        Found = res.Found,
        ViaId = res.ViaId,
        ViaLabel = res.ViaLabel,
        ProfileDir = res.ProfileDir,
        CookieRaw = res.CookieRaw,
        TwoFaSecret = res.TwoFaSecret,
        UpdatedAt = res.UpdatedAtUtc,
    };

    public async Task SyncCloudAsync(bool silent = false)
    {
        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            RefreshHeaderAndSidebar();
            RenderCurrentView();
            return;
        }

        if (_isBusy && silent) return;

        SetBusy(true);
        try
        {
            var userTask = _api.GetCurrentUserAsync();
            var accountsTask = _api.ListPersonalAccountsAsync();
            var bmsTask = _api.ListBusinessManagersAsync();
            var adAccsTask = _api.ListAdAccountsAsync();
            var pagesTask = _api.GetPagesSummaryAsync();
            var alertSumTask = _api.GetAlertsSummaryAsync();
            var alertsTask = _api.ListAlertsAsync(25);
            var cronTask = _api.GetAutomationCronStatusAsync();

            await Task.WhenAll(userTask, accountsTask, bmsTask, adAccsTask, pagesTask, alertSumTask, alertsTask, cronTask);

            _currentUser = userTask.Result;
            _bms = bmsTask.Result.Items ?? new();
            _adAccounts = adAccsTask.Result.Items ?? new();
            _pagesSummary = pagesTask.Result;
            _alertSummary = alertSumTask.Result;
            _alerts = alertsTask.Result.Items ?? new();
            _cronStatus = cronTask.Result;

            RebuildViaWorkspaceList(accountsTask.Result.Items ?? new());
            ProvisionAllViaExtensions(silent: true);

            _lastErrorMessage = null;
            _errorBanner.Visibility = Visibility.Collapsed;
            _hasLoadedOnce = true;
            _lastSyncedAtLocal = DateTime.Now;
            AppendLog($"Đồng bộ Cloud xong: {_vias.Count} Via, {_pagesSummary?.Items.Count ?? 0} Fanpage, {_adAccounts.Count} TKQC, {_alerts.Count} cảnh báo.");
        }
        catch (Exception ex)
        {
            _lastErrorMessage = $"Không thể đồng bộ Cloud: {ex.Message}";
            _errorBannerText.Text = _lastErrorMessage;
            _errorBanner.Visibility = Visibility.Visible;
            AppendLog($"LỖI đồng bộ Cloud: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
            RefreshHeaderAndSidebar();
            _tray?.UpdateMenu(_vias, _queueSnapshot, _currentUser != null);
            RenderCurrentView();
        }
    }

    private void RebuildViaWorkspaceList(List<PersonalAccountRefDto> refs)
    {
        var prevSelected = new HashSet<string>(_selectedViaIds, StringComparer.OrdinalIgnoreCase);
        var quotaById = (_pagesSummary?.ViaQuotas ?? new()).ToDictionary(q => q.ViaId ?? "", q => q, StringComparer.OrdinalIgnoreCase);
        var bmCount = _bms.Count;
        var list = new List<ViaWorkspaceEntry>(refs.Count);

        foreach (var r in refs)
        {
            var matchedAdAccs = _adAccounts
                .Where(a => a.FacebookIdentities.Any(id => string.Equals(id.Id, r.Id, StringComparison.OrdinalIgnoreCase)))
                .ToList();

            var parsed = ViaMetadataParser.ParseNotes(r.Notes, r.Label, bmCount, matchedAdAccs.Count);
            var warmup = ViaMetadataParser.ComputeWarmupStatus(parsed.WarmupStartIso);
            quotaById.TryGetValue(r.Id, out var q);

            var profileDir = ExtensionProvisioner.ResolveProfileDirectory(r.BrowserProfileLabel, r.Label);
            var twoFa = ExtensionProvisioner.ExtractTwoFaSecret(r.VaultReference, r.Notes);
            if (string.IsNullOrEmpty(twoFa))
            {
                var localSecret = LocalSecretVaultStore.Default.Find(r.Id, profileDir, r.Label);
                if (localSecret.Found) twoFa = localSecret.TwoFaSecret;
            }

            // Preserve any previously measured proxy state during silent resyncs
            var old = _vias.FirstOrDefault(v => string.Equals(v.ViaId, r.Id, StringComparison.OrdinalIgnoreCase));

            var entry = new ViaWorkspaceEntry
            {
                ViaId = r.Id,
                Label = r.Label,
                DisplayName = r.DisplayName,
                ExternalReferenceId = r.ExternalReferenceId ?? "",
                BrowserProfileLabel = string.IsNullOrWhiteSpace(r.BrowserProfileLabel) ? profileDir : r.BrowserProfileLabel,
                ProfileDir = profileDir,
                NetworkLabel = r.NetworkLabel ?? "",
                Notes = r.Notes ?? "",
                CleanNotes = parsed.CleanNotes,
                RoleTier = parsed.Tier,
                WarmupStartIso = parsed.WarmupStartIso,
                WarmupLabel = warmup.Label,
                WarmupPhase = warmup.Phase,
                TwoFaSecret = twoFa,
                ViaTier = parsed.Tier,
                BackendTier = q?.ViaTier ?? (parsed.Tier == "vault" ? "hold_via" : "standard_via"),
                HoldingPagesCount = q?.HoldingPagesCount ?? 0,
                HoldingLimit = q?.HoldingLimit ?? (parsed.Tier == "vault" ? 25 : 10),
                CreatedTodayCount = q?.CreatedTodayCount ?? 0,
                Created7dCount = q?.Created7dCount ?? 0,
                DailyLimit = q?.DailyLimit ?? (parsed.Tier == "vault" ? 2 : 1),
                CooldownRemainingMinutes = q?.CooldownRemainingMinutes ?? 0,
                QuotaStatus = q?.QuotaStatus ?? "SAFE",
                IdleDays = q?.IdleDays ?? 0,
                KeepAliveIntervalDays = q?.KeepAliveIntervalDays ?? 3.0,
                NeedsKeepAlive = q?.NeedsKeepAlive ?? false,
                ProxyLastStatus = string.IsNullOrWhiteSpace(r.NetworkLabel) ? "DIRECT" : (old?.ProxyLastStatus ?? "UNCHECKED"),
                ProxyLatencyMs = old?.ProxyLatencyMs,
                ProxyExitIp = old?.ProxyExitIp,
                IsSelected = prevSelected.Contains(r.Id),
                BundledAccounts = matchedAdAccs.Select(BundledExtensionAccountDto.FromApi).ToList(),
            };
            list.Add(entry);
        }

        _vias = list;
    }

    private int ProvisionAllViaExtensions(bool silent)
    {
        int okCount = 0;
        foreach (var v in _vias)
        {
            try
            {
                v.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(v);
                okCount++;
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi cấp Extension cho Via '{v.Label}': {ex.Message}");
            }
        }
        if (!silent)
        {
            AppendLog($"Đã cấp / cập nhật Chrome Extension Companion cho {okCount}/{_vias.Count} Via.");
        }
        return okCount;
    }

    private void LaunchViaChromeSafe(ViaWorkspaceEntry via, string targetUrl)
    {
        try
        {
            via.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(via);
            ExtensionProvisioner.LaunchChrome(targetUrl, via.ProfileDir, via.ExtensionFolder, _config.UseIsolatedProfiles, via.Label);
            AppendLog($"Đã mở Chrome Profile '{via.ProfileDir}' ({via.Label}) -> {targetUrl}");
        }
        catch (Exception ex)
        {
            AppendLog($"LỖI mở Chrome Via '{via.Label}': {ex.Message}");
            MessageBox.Show(this, ex.Message, "Không mở được Chrome", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async Task<(bool Live, string Reason)> PreCheckProxyAsync(QueueTaskItem item)
    {
        if (string.IsNullOrWhiteSpace(item.NetworkLabel))
        {
            return (true, "Direct IP");
        }

        try
        {
            var res = await _api.CheckProxyLiveAsync(item.NetworkLabel, item.ViaLabel);
            _ = Dispatcher.BeginInvoke(() =>
            {
                var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase));
                if (via != null)
                {
                    via.ProxyLastStatus = string.Equals(res.Status, "LIVE", StringComparison.OrdinalIgnoreCase) ? "LIVE" : "DEAD";
                    via.ProxyLatencyMs = res.LatencyMs;
                    via.ProxyExitIp = res.ExitIp;
                }
            });

            if (string.Equals(res.Status, "LIVE", StringComparison.OrdinalIgnoreCase))
            {
                return (true, $"Proxy LIVE {(res.LatencyMs.HasValue ? $"{res.LatencyMs.Value}ms" : "")} ({res.ExitIp ?? "?"})");
            }
            return (false, string.IsNullOrWhiteSpace(res.Message) ? "Proxy DEAD / timeout" : res.Message!);
        }
        catch (Exception ex)
        {
            return (false, $"Lỗi check proxy: {ex.Message}");
        }
    }

    private Task LaunchViaQueueItemAsync(QueueTaskItem item)
    {
        var tcs = new TaskCompletionSource();
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase))
                          ?? new ViaWorkspaceEntry
                          {
                              ViaId = item.ViaId,
                              Label = item.ViaLabel,
                              BrowserProfileLabel = item.BrowserProfile,
                              ProfileDir = ExtensionProvisioner.ResolveProfileDirectory(item.BrowserProfile, item.ViaLabel),
                              NetworkLabel = item.NetworkLabel,
                              ViaTier = item.ViaTier,
                          };
                LaunchViaChromeSafe(via, item.TargetUrl);
                tcs.TrySetResult();
            }
            catch (Exception ex)
            {
                tcs.TrySetException(ex);
            }
        });
        return tcs.Task;
    }

    private async Task OnQueueCompletedAsync(QueueKind kind)
    {
        if (kind == QueueKind.KeepAlive && !string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            try
            {
                var payload = _vias.Where(v => v.NeedsKeepAlive).Select(v => new
                {
                    via_id = v.ViaId,
                    via_label = v.Label,
                    browser_profile = v.ProfileDir,
                    route_summary = "newsfeed -> notifications",
                    duration_sec = 30,
                });
                await _api.LogViaKeepAliveBatchAsync(payload);
            }
            catch (Exception ex)
            {
                AppendLog($"Cảnh báo ghi nhật ký Keep-Alive lên Cloud: {ex.Message}");
            }
        }
        await SyncCloudAsync(silent: true);
    }

    private void OnQueueSnapshotChanged(QueueSnapshot snap)
    {
        Dispatcher.BeginInvoke(() =>
        {
            _queueSnapshot = snap;
            UpdateLiveQueueWidgets();
            _tray?.UpdateMenu(_vias, snap, _currentUser != null);

            if (snap.Phase is QueuePhase.Completed or QueuePhase.Idle && _activeView is AppView.Overview or AppView.Automation)
            {
                RenderCurrentView();
            }
        });
    }

    private void UpdateLiveQueueWidgets()
    {
        var s = _queueSnapshot;
        if (_queueSummaryText != null)
        {
            var phaseVi = s.Phase switch
            {
                QueuePhase.Running => s.CheckingProxy ? "Đang test Proxy trước khi mở..." : $"Đang chạy ({s.CurrentIndex}/{s.TotalCount})",
                QueuePhase.Paused => "Đang tạm dừng",
                QueuePhase.NightPaused => "Tạm nghỉ khung giờ ban đêm (22:30 - 08:00)",
                QueuePhase.Syncing => "Đang đồng bộ kết quả về Cloud...",
                QueuePhase.Completed => $"Hoàn tất ({s.LaunchedCount}/{s.TotalCount} đã mở, bỏ qua {s.SkippedCount})",
                _ => "Sẵn sàng nhận lệnh",
            };
            var detail = string.IsNullOrWhiteSpace(s.CurrentViaLabel) ? s.LastNotice : $"Via: {s.CurrentViaLabel} • {s.CurrentTaskTitle}";
            _queueSummaryText.Text = string.IsNullOrWhiteSpace(detail) ? phaseVi : $"{phaseVi} — {detail}";
        }

        if (_queueCountdownText != null)
        {
            _queueCountdownText.Text = s.Phase == QueuePhase.Running && s.CountdownSeconds > 0
                ? $"Nghỉ ngẫu nhiên: {s.CountdownSeconds}s"
                : s.Phase == QueuePhase.Idle ? "—" : $"{s.LaunchedCount}/{s.TotalCount}";
        }

        if (_queuePauseBtn != null && _queuePauseBtn.Content is StackPanel sp && sp.Children.Count >= 2)
        {
            var isPaused = s.Phase == QueuePhase.Paused;
            if (sp.Children[0] is TextBlock ic) ic.Text = isPaused ? FluentIcons.Play : FluentIcons.Pause;
            if (sp.Children[1] is TextBlock tb) tb.Text = isPaused ? "Tiếp tục" : "Tạm dừng";
        }

        var active = s.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.NightPaused or QueuePhase.Syncing;
        if (_queuePauseBtn != null) _queuePauseBtn.IsEnabled = active;
        if (_queueSkipBtn != null) _queueSkipBtn.IsEnabled = s.Phase == QueuePhase.Running;
        if (_queueStopBtn != null) _queueStopBtn.IsEnabled = active;
        if (_queueLiveBanner != null)
        {
            _queueLiveBanner.Visibility = active || s.Phase == QueuePhase.Completed ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void StartKeepAliveDueQueue(bool requireConfirm)
    {
        var dueVias = _vias.Where(v => v.NeedsKeepAlive).ToList();
        if (dueVias.Count == 0)
        {
            MessageBox.Show(this, "Hiện chưa có Via nào quá hạn Đảo Ấm.", "Thông báo", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        EnqueueKeepAliveVias(dueVias, "Đảo Ấm toàn bộ Via quá hạn (>3 ngày)", requireConfirm);
    }

    private void EnqueueKeepAliveVias(IReadOnlyList<ViaWorkspaceEntry> targetVias, string title, bool requireConfirm)
    {
        if (targetVias.Count == 0) return;
        if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
        {
            MessageBox.Show(this, "Hàng đợi đang chạy dở. Hãy Tạm dừng hoặc Dừng hẳn trước khi xếp lô mới.", "Hàng đợi đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (requireConfirm)
        {
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                title,
                $"Chuẩn bị mở Chrome Profile thật & Proxy riêng để Đảo Ấm thụ động (chỉ cuộn Newsfeed & /notifications, tuyệt đối không Like/Comment) cho {targetVias.Count} Via.",
                new (string, string)[]
                {
                    ("Số lượng Via:", $"{targetVias.Count} Via"),
                    ("Nghỉ giãn cách:", $"~{_config.DefaultStaggerSeconds}s + Jitter ngẫu nhiên ±35%"),
                    ("Pre-check Proxy:", _config.PreCheckProxyBeforeLaunch ? "Bật (Proxy die tự bỏ qua)" : "Tắt"),
                    ("IP Cluster Guard:", $"Tối đa {_config.MaxViasPerProxyInBatch} Via / IP cùng lô"),
                },
                "Khung giờ an toàn mặc định: 08:00 - 22:30. Có thể Tạm dừng hoặc Dừng hẳn bất cứ lúc nào.");
            if (!ok) return;
        }

        var tasks = targetVias.Select(v => new QueueTaskItem(
            v.ViaId,
            v.Label,
            v.ProfileDir,
            v.NetworkLabel,
            "https://www.facebook.com/?adsops_keepalive=1&autoclose=" + (_config.AutoCloseKeepAliveTab ? "1" : "0"),
            "Đảo Ấm Cookie thụ động",
            v.BackendTier)).ToList();

        _queue.StartQueue(
            QueueKind.KeepAlive,
            tasks,
            _config.DefaultStaggerSeconds,
            _config.PreCheckProxyBeforeLaunch,
            _config.MaxViasPerProxyInBatch,
            _config.AutoKeepAliveStartHour,
            _config.AutoKeepAliveEndHour,
            enforceDaytimeWindow: true);

        AppendLog($"Đã xếp hàng {tasks.Count} Via vào Hàng đợi Đảo Ấm an toàn.");
        RenderCurrentView();
    }

    private async Task RunAutoKeepAliveTickAsync()
    {
        if (!_config.AutoKeepAliveScheduler || string.IsNullOrWhiteSpace(_config.GetJwt())) return;
        if (_queue.Current.Phase != QueuePhase.Idle && _queue.Current.Phase != QueuePhase.Completed) return;

        var now = DateTime.Now;
        if (now.Hour < _config.AutoKeepAliveStartHour || now.Hour >= _config.AutoKeepAliveEndHour) return;
        if ((DateTime.UtcNow - _lastKeepAliveCheckUtc).TotalMinutes < Math.Max(5, _config.AutoKeepAliveMinGapMinutes)) return;

        _lastKeepAliveCheckUtc = DateTime.UtcNow;
        var due = _vias.Where(v => v.NeedsKeepAlive).Take(2).ToList();
        if (due.Count == 0) return;

        AppendLog($"Auto Keep-Alive phát hiện {due.Count} Via đến hạn -> tự động xếp lịch Đảo Ấm an toàn.");
        EnqueueKeepAliveVias(due, "Auto Keep-Alive", requireConfirm: false);
        await Task.CompletedTask;
    }

    private void OnUiSecondTick()
    {
        var now = DateTimeOffset.UtcNow;
        var utcNow = DateTime.UtcNow;

        foreach (var b in _liveTotpBindings)
        {
            if (_copiedToastTarget == b.CodeBlock && utcNow < _copiedToastUntilUtc)
            {
                b.CodeBlock.Text = "✓ Đã chép";
                b.CodeBlock.Foreground = ThemeTokens.SuccessText;
                continue;
            }

            var secret = !string.IsNullOrWhiteSpace(b.InlineSecret)
                ? b.InlineSecret
                : LocalSecretVaultStore.Default.Find(b.ViaId, b.ProfileDir, b.ViaLabel).TwoFaSecret;

            var totp = TotpService.ComputeTotp(secret, now);
            if (totp.Valid)
            {
                b.CodeBlock.Text = totp.FormattedCode;
                b.CodeBlock.Foreground = ThemeTokens.AccentText;
                b.CountdownBlock.Text = $"{totp.SecondsRemaining}s";
                var low = totp.SecondsRemaining <= 5;
                b.CountdownBlock.Foreground = low ? ThemeTokens.WarningText : ThemeTokens.TextSecondary;
                b.CountdownPill.Background = low ? ThemeTokens.WarningBg : ThemeTokens.NeutralBg;
                b.CountdownPill.BorderBrush = low ? ThemeTokens.WarningBorder : ThemeTokens.BorderSubtle;
            }
            else
            {
                b.CodeBlock.Text = "Chưa gắn 2FA";
                b.CodeBlock.Foreground = ThemeTokens.TextMuted;
                b.CountdownBlock.Text = "—";
            }
        }
    }

    private void CopyViaTotpToClipboard(ViaWorkspaceEntry via, TextBlock? toastTarget = null, bool showBalloon = false)
    {
        var secret = !string.IsNullOrWhiteSpace(via.TwoFaSecret)
            ? via.TwoFaSecret
            : LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label).TwoFaSecret;

        var totp = TotpService.ComputeTotp(secret);
        if (!totp.Valid)
        {
            MessageBox.Show(this, $"Via '{via.Label}' chưa có mã 2FA hợp lệ trong Két Local.", "Thiếu 2FA", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        Clipboard.SetText(totp.Code6);
        AppendLog($"Đã chép mã 2FA 6 số cho Via '{via.Label}' (còn {totp.SecondsRemaining}s).");
        if (toastTarget != null)
        {
            _copiedToastTarget = toastTarget;
            _copiedToastUntilUtc = DateTime.UtcNow.AddSeconds(2);
            toastTarget.Text = "✓ Đã chép";
            toastTarget.Foreground = ThemeTokens.SuccessText;
        }
        if (showBalloon)
        {
            _tray?.ShowBalloon($"2FA • {via.Label}", $"Đã copy mã {totp.FormattedCode} (còn {totp.SecondsRemaining}s) vào Clipboard.");
        }
    }

    private void SwitchView(AppView view)
    {
        _activeView = view;
        UpdateNavStyles();
        RefreshHeaderAndSidebar();
        RenderCurrentView();
    }

    private void RefreshHeaderAndSidebar()
    {
        var isLoggedIn = !string.IsNullOrWhiteSpace(_config.GetJwt());
        if (_currentUser != null)
        {
            _sidebarCloudUser.Text = string.IsNullOrWhiteSpace(_currentUser.FullName) ? _currentUser.Email : _currentUser.FullName;
            _sidebarCloudSub.Text = _currentUser.Workspace != null ? $"WS: {_currentUser.Workspace.Name}" : _currentUser.Email;
        }
        else if (isLoggedIn)
        {
            _sidebarCloudUser.Text = string.IsNullOrWhiteSpace(_config.UserEmail) ? "Đã lưu phiên JWT" : _config.UserEmail;
            _sidebarCloudSub.Text = "Nhấn Đồng bộ để làm mới";
        }
        else
        {
            _sidebarCloudUser.Text = "Chưa đăng nhập";
            _sidebarCloudSub.Text = "Mở Két khóa để kết nối Cloud";
        }

        var portText = _bridge != null ? $"Bridge ON :{_bridge.BoundPort}" : "Bridge OFF";
        if (_sidebarBridgePill.Content is StackPanel bsp && bsp.Children.Count >= 2 && bsp.Children[1] is TextBlock btb)
        {
            btb.Text = portText;
        }

        // Nav badges
        var dueCount = _vias.Count(v => v.NeedsKeepAlive);
        SetNavBadge(AppView.Vias, dueCount > 0 ? dueCount.ToString() : "");
        var alertTotal = (_alertSummary?.OpenCritical ?? 0) + (_alertSummary?.OpenWarning ?? 0);
        SetNavBadge(AppView.Overview, alertTotal > 0 ? alertTotal.ToString() : "");
        SetNavBadge(AppView.Automation, _queueSnapshot.Phase == QueuePhase.Running ? "RUN" : "");

        (_headerTitle.Text, _headerSubtitle.Text) = _activeView switch
        {
            AppView.Overview => ("Tổng quan vận hành", BuildSyncSubtitle("Bức tranh đa Via, cảnh báo hệ thống & hàng đợi")),
            AppView.Vias => ("Quản lý Đa Via", BuildSyncSubtitle($"{_vias.Count} Via • 2FA local theo thời gian thực • Chế độ mở Chrome cô lập")),
            AppView.Automation => ("Trung tâm Tự động hóa", BuildSyncSubtitle("Tạo Page theo nhịp an toàn, Đảo Ấm đa Via & Cloud Cron")),
            AppView.PagesBm => ("Fanpage & Business Manager", BuildSyncSubtitle($"{_pagesSummary?.Items.Count ?? 0} Fanpage • {_bms.Count} BM")),
            AppView.AdAccounts => ("Tài khoản Quảng cáo", BuildSyncSubtitle($"{_adAccounts.Count} TKQC liên kết • Số liệu căn lề Tabular chính xác")),
            AppView.Settings => ("Két khóa DPAPI & Cài đặt", BuildSyncSubtitle("Kết nối Cloud, Két sao lưu AES-256-GCM (.adsopsvault) & Hệ thống")),
            _ => ("AdsOps Desktop Pro", ""),
        };

        _headerActionsPanel.Children.Clear();
        if (isLoggedIn)
        {
            var addViaBtn = UiComponents.CreateButton("Thêm Via", ButtonVariant.Primary, FluentIcons.Add, onClick: (_, _) => OpenViaEditorDialog(null));
            addViaBtn.Margin = new Thickness(0, 0, 8, 0);
            _headerActionsPanel.Children.Add(addViaBtn);

            if (dueCount > 0)
            {
                var warmupBtn = UiComponents.CreateButton($"Đảo Ấm ({dueCount})", ButtonVariant.Secondary, FluentIcons.CoffeeWarmup, onClick: (_, _) => StartKeepAliveDueQueue(requireConfirm: true));
                warmupBtn.Margin = new Thickness(0, 0, 8, 0);
                _headerActionsPanel.Children.Add(warmupBtn);
            }
        }

        var syncBtn = UiComponents.CreateButton("Đồng bộ", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await SyncCloudAsync(silent: false));
        syncBtn.IsEnabled = !_isBusy;
        _headerActionsPanel.Children.Add(syncBtn);
    }

    private void SetNavBadge(AppView view, string text)
    {
        if (!_navBadges.TryGetValue(view, out var tb)) return;
        tb.Text = text;
        tb.Visibility = string.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
    }

    private string BuildSyncSubtitle(string fallback)
    {
        if (_lastSyncedAtLocal.HasValue)
        {
            return $"{fallback} • Cập nhật lúc {_lastSyncedAtLocal.Value:HH:mm:ss}";
        }
        return fallback;
    }

    private void SetBusy(bool busy)
    {
        _isBusy = busy;
        _headerBusyBar.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
    }

    private void AppendLog(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        void UpdateUi()
        {
            _logLines.Add(line);
            if (_logLines.Count > 300) _logLines.RemoveAt(0);
            if (_logPreviewText != null) _logPreviewText.Text = line;
            if (_logBox != null)
            {
                _logBox.Text = string.Join(Environment.NewLine, _logLines);
                _logBox.ScrollToEnd();
            }
        }

        if (Dispatcher.CheckAccess()) UpdateUi();
        else Dispatcher.BeginInvoke(UpdateUi);
    }

    private void RestoreFromTray()
    {
        ShowInTaskbar = true;
        Visibility = Visibility.Visible;
        WindowState = WindowState.Normal;
        Activate();
    }

    private void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_allowExit) return;
        e.Cancel = true;
        Hide();
        ShowInTaskbar = false;
        _tray?.ShowBalloon("AdsOps Desktop Pro v2.0", "Ứng dụng đang chạy ngầm tại Khay hệ thống (Local Bridge vẫn bật).");
    }

    public void ExitApplicationCleanly()
    {
        _allowExit = true;
        _uiTimer.Stop();
        _keepAliveTimer.Stop();
        _cloudSyncTimer.Stop();
        _queue.Dispose();
        _bridge?.Dispose();
        _tray?.Dispose();
        Application.Current.Shutdown();
    }
}
