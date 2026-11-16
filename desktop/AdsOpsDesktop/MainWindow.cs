using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
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
    HealthTokens,
    WorkspaceOps,
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
    private List<MetaConnectionDto> _metaConnections = new();
    private HealthSummaryDto? _healthSummary;
    private List<AccountHealthRowDto> _accountHealthRows = new();
    private List<CampaignDraftDto> _campaignDrafts = new();
    private TelegramBotConfigDto? _telegramConfig;
    private SpendSummaryDto? _spendSummary;
    private List<DeviceSessionDto> _deviceSessions = new();
    private Dictionary<string, ProxyCheckResultDto> _proxyHealthMap = new(StringComparer.OrdinalIgnoreCase);
    private ReadinessSummaryDto? _readinessSummary;
    private ReadinessBoardDto? _readinessBoard;
    private List<AuditLogEntryDto> _auditLogs = new();
    private string _auditSearch = "";
    private List<PixelDto> _pixels = new();
    private DomainSeoConfigDto? _domainSeoConfig;
    private ClientRetainersOverviewDto? _retainersOverview;
    private TeamSummaryDto? _teamSummary;
    private List<TeamMemberDto> _teamMembers = new();
    private List<TeamInvitationDto> _teamInvitations = new();
    private CommunityQuotaDto? _communityQuota;
    private List<AntidetectProfileSummary> _antidetectProfiles = new();
    private string _antidetectStatusMessage = "";
    private List<AutomationPlaybookDto> _playbooks = new();
    private List<ProfileLaunchAuditDto> _launchAudits = new();
    private List<AntidetectProbeResult> _engineProbes = new();
    private string _recommendedFastestEngine = "chrome_native";
    private WorkstationMemorySnapshot? _workstationMem;
    private bool _isOfflineSnapshotMode;
    private string _offlineSnapshotAt = "";
    private UpdateManifestDto? _latestUpdateManifest;
    private string _updateStatusText = "Chưa kiểm tra cập nhật trong phiên này.";

    private bool _isBusy;
    private bool _hasLoadedOnce;
    private string? _lastErrorMessage;
    private DateTime? _lastSyncedAtLocal;
    private DateTime _lastKeepAliveCheckUtc = DateTime.MinValue;
    private int _watchdogTickCount;

    // Filter & selection states
    private string _viaSearch = "";
    private string _viaTierFilter = "all";
    private string _viaEngineFilter = "all";
    private string _viaProxyFilter = "all";
    private string _viaOwnerFilter = "all";
    private string _playbookPlatformFilter = "all";
    private string _selectedPlaybookId = "";
    private readonly HashSet<string> _selectedViaIds = new(StringComparer.OrdinalIgnoreCase);

    private string _pageSearch = "";
    private string _pageFilter = "all";

    private string _adSearch = "";
    private string _adFilter = "all";

    private string _healthSearch = "";
    private string _healthFilter = "all";

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
        ProtocolRegistrar.CleanupLegacyPythonBridgeAutostart();
        _config = DesktopConfig.Load();
        _api.Configure(_config.BackendBaseUrl, _config.GetJwt());

        _queue = new AutomationQueueEngine(
            PreCheckProxyAsync,
            LaunchViaQueueItemAsync,
            OnQueueCompletedAsync,
            AppendLog,
            getActiveBrowserCount: () => ChromeSessionTracker.Default.GetSnapshot().Count(s => s.Alive));
        _queue.SnapshotChanged += OnQueueSnapshotChanged;

        Title = $"AdsOps Desktop Pro v{DesktopAppInfo.Version}";
        var wa = SystemParameters.WorkArea;
        Width = Math.Min(1340, Math.Max(1020, wa.Width - 24));
        Height = Math.Min(790, Math.Max(620, wa.Height - 28));
        MinWidth = Math.Min(1000, Math.Max(880, wa.Width - 40));
        MinHeight = Math.Min(620, Math.Max(540, wa.Height - 40));
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = ThemeTokens.BgCanvas;
        Foreground = ThemeTokens.TextPrimary;
        FontFamily = ThemeTokens.UiFont;
        ThemeTokens.ApplyDarkTitleBar(this);

        BuildShellLayout();
        InitTray();
        PreviewKeyDown += OnMainWindowPreviewKeyDown;

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
            Padding = new Thickness(12, 12, 12, 10),
        };

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // Brand Header
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(4, 0, 4, 12) };
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
            Text = $"Desktop Suite v{DesktopAppInfo.Version}",
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
        AddNavButton(navStack, AppView.HealthTokens, "Sức khỏe & Token", FluentIcons.Diagnostic);
        AddNavButton(navStack, AppView.WorkspaceOps, "Ngân sách & Team", FluentIcons.ShieldCheck);
        AddNavButton(navStack, AppView.Settings, "Két khóa & Cài đặt", FluentIcons.Settings);
        var navScroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = navStack,
        };
        Grid.SetRow(navScroll, 1);
        grid.Children.Add(navScroll);

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
        AppendLog($"Khởi động AdsOps Desktop Pro v{DesktopAppInfo.Version} (WPF Dark UI + DPAPI Vault + Local TOTP + Retainers/Team).");
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
            var cached = CloudSnapshotCacheStore.Load(_config.UserEmail);
            if (cached != null)
            {
                HydrateFromOfflineSnapshot(cached);
                RenderCurrentView();
            }
            await SyncCloudAsync(silent: false);
        }
        else
        {
            AppendLog("Chưa đăng nhập Cloud. Mở mục Két khóa & Cài đặt để kết nối tài khoản.");
        }
    }

    private void HydrateFromOfflineSnapshot(CloudSnapshotPayload snap)
    {
        _currentUser = snap.CurrentUser;
        _bms = snap.BusinessManagers ?? new();
        _adAccounts = snap.AdAccounts ?? new();
        _pagesSummary = snap.PagesSummary;
        _healthSummary = snap.HealthSummary;
        _communityQuota = snap.CommunityQuota;
        if (snap.PersonalAccounts != null && snap.PersonalAccounts.Count > 0)
        {
            RebuildViaWorkspaceList(snap.PersonalAccounts);
        }
        _hasLoadedOnce = true;
        _isOfflineSnapshotMode = true;
        _offlineSnapshotAt = DateTimeOffset.TryParse(snap.SavedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt)
            ? dt.ToLocalTime().ToString("dd/MM HH:mm")
            : "";
    }

    private void StartBridgeServer()
    {
        try
        {
            _config.GetOrCreateBridgeToken();
            _bridge?.Dispose();
            LocalBridgeServer.RetireLegacyBridgeHoldingPort(_config.BridgePort, AppendLog);
            _bridge = new LocalBridgeServer(
                _config.BridgePort,
                OnBridgeOpenChromeAsync,
                OnBridgeBrowserEventAsync,
                OnBridgeProvisionAllAsync,
                AppendLog,
                OnBridgeVaultSaveAsync,
                OnBridgeVaultGetAsync,
                OnBridgeAutoConnectTokenAsync,
                OnBridgeSyncBillingAsync,
                OnBridgeTileWindows,
                () => _config.GetOrCreateBridgeToken(),
                () => _config.WebAppUrl,
                OnBridgeBenchmarkEnginesAsync);
            _bridge.Start();
            var tpl = ExtensionProvisioner.LoadTemplates();
            AppendLog($"Local Bridge v{DesktopAppInfo.Version} Zero-Trust đang lắng nghe tại http://127.0.0.1:{_bridge.BoundPort} (Ext v{tpl.Version}).");
        }
        catch (Exception ex)
        {
            AppendLog($"CẢNH BÁO: Không thể mở Local Bridge cổng {_config.BridgePort}: {ex.Message}");
        }
    }

    private async Task<object> OnBridgeBenchmarkEnginesAsync()
    {
        var probes = await AntidetectBrowserConnector.BenchmarkAllEnginesAsync(
            _config.AntidetectApiBaseUrl,
            _config.AntidetectApiKey).ConfigureAwait(false);
        var rec = AntidetectBrowserConnector.RecommendFastestOnlineEngine(probes);
        var mem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        var recMax = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(_config.LowRamFarmMode, mem);
        _ = Dispatcher.BeginInvoke(() =>
        {
            _engineProbes = probes;
            _recommendedFastestEngine = rec;
            _workstationMem = mem;
        });
        return new
        {
            ok = true,
            recommended_engine = rec,
            probes,
            history = AntidetectEngineBenchmarkStore.Default.GetAll(),
            workstation_memory = new
            {
                total_physical_mb = mem.TotalPhysicalMb,
                available_physical_mb = mem.AvailablePhysicalMb,
                memory_load_percent = mem.MemoryLoadPercent,
                recommended_max_concurrent = recMax,
            },
        };
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
                    (!string.IsNullOrWhiteSpace(req.ViaId) && string.Equals(v.ViaId, req.ViaId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrWhiteSpace(req.Profile) && string.Equals(v.ProfileDir, req.Profile.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrWhiteSpace(req.Name) && string.Equals(v.Label, req.Name.Trim(), StringComparison.OrdinalIgnoreCase)));

                if (match != null)
                {
                    if (!CanCurrentUserLaunchVia(match, out var denyReason))
                    {
                        tcs.TrySetResult((false, denyReason));
                        return;
                    }
                    LaunchViaChromeSafe(match, url);
                    tcs.TrySetResult((true, $"Đã mở {AntidetectBrowserConnector.GetDisplayName(match.AntidetectEngine)} cho Via '{match.Label}'."));
                    return;
                }

                var fallbackProfile = ExtensionProvisioner.ResolveProfileDirectory(req.Profile, req.Name);
                var eng = AntidetectBrowserConnector.NormalizeEngine(req.AntidetectEngine);
                var adId = (req.AntidetectProfileId ?? "").Trim();
                var tempVia = new ViaWorkspaceEntry
                {
                    ViaId = req.ViaId ?? "",
                    Label = string.IsNullOrWhiteSpace(req.Name) ? fallbackProfile : req.Name!.Trim(),
                    BrowserProfileLabel = fallbackProfile,
                    ProfileDir = fallbackProfile,
                    NetworkLabel = req.Proxy ?? "",
                    AntidetectEngine = eng,
                    AntidetectProfileId = adId,
                };
                if (eng != "chrome_native" && !string.IsNullOrWhiteSpace(adId))
                {
                    _ = LaunchViaBrowserAsync(tempVia, url, interactiveAlerts: false);
                    tcs.TrySetResult((true, $"Đã gửi lệnh mở {AntidetectBrowserConnector.GetDisplayName(eng)} #{adId}."));
                    return;
                }

                var extFolder = ExtensionProvisioner.ProvisionForVia(tempVia, config: _config);
                var effectiveIso = ExtensionProvisioner.ShouldUseIsolatedProfile(_config.UseIsolatedProfiles, fallbackProfile, tempVia.NetworkLabel, hasVaultCookie: false, tempVia.Label);
                var sw = Stopwatch.StartNew();
                var launchInfo = ExtensionProvisioner.LaunchChromeDetailed(
                    url,
                    fallbackProfile,
                    extFolder,
                    effectiveIso,
                    tempVia.Label,
                    _config.EnableChromeAntidetectShield,
                    _config.LowRamFarmMode);
                sw.Stop();
                AntidetectEngineBenchmarkStore.Default.RecordStartup("chrome_native", (int)sw.ElapsedMilliseconds);
                ChromeSessionTracker.Default.RecordLaunch(launchInfo.Pid, null, tempVia.Label, fallbackProfile, url, "chrome_native", launchInfo.DelegatedToSharedBroker, launchInfo.IsolatedMode);
                AppendLog($"Mở nhanh Chrome từ Web/Bridge ({(launchInfo.IsolatedMode ? "Cô lập" : "Profile gốc")}): Profile '{fallbackProfile}' -> {url}");
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
        var evType = (payload.EventType ?? "").Trim().ToUpperInvariant();
        var isKeepAliveOk = string.Equals(evType, "KEEPALIVE_OK", StringComparison.OrdinalIgnoreCase);
        var isSafetyFreeze = evType is "IP_LEAK_BLOCKED" or "SAFETY_CHALLENGE";

        ViaWorkspaceEntry? matched = null;
        matched = _vias.FirstOrDefault(v =>
            (!string.IsNullOrWhiteSpace(payload.ViaId) && string.Equals(v.ViaId, payload.ViaId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(payload.BrowserProfile) && string.Equals(v.ProfileDir, payload.BrowserProfile.Trim(), StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(payload.ViaLabel) && string.Equals(v.Label, payload.ViaLabel.Trim(), StringComparison.OrdinalIgnoreCase)));

        var resolvedViaId = !string.IsNullOrWhiteSpace(payload.ViaId) ? payload.ViaId : matched?.ViaId;
        var resolvedViaLabel = !string.IsNullOrWhiteSpace(payload.ViaLabel) ? payload.ViaLabel : matched?.Label;

        if (isSafetyFreeze)
        {
            var reasonText = $"{evType}: {(string.IsNullOrWhiteSpace(payload.Detail) ? "Tự động đóng băng bảo vệ tài khoản" : payload.Detail)}";
            ViaStewardshipStore.Default.TriggerCooldown(
                resolvedViaId,
                resolvedViaLabel,
                matched?.ClientGroup,
                _config.AutoCooldownHours,
                reasonText,
                evType);

            var cooldownUntil = DateTimeOffset.UtcNow.AddHours(Math.Clamp(_config.AutoCooldownHours, 1, 168));
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (matched != null)
                {
                    matched.CooldownUntilUtc = cooldownUntil;
                    matched.CooldownReason = reasonText;
                    try { matched.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(matched, config: _config); } catch { }
                }
                _tray?.ShowBalloon(
                    evType == "IP_LEAK_BLOCKED" ? "🚨 CHẶN RÒ RỈ IP PROXY" : "🛑 CẢNH BÁO CHECKPOINT",
                    $"Via '{resolvedViaLabel ?? "Via"}' đã được đóng băng Cooldown {_config.AutoCooldownHours}h: {payload.Detail}");
                if (_activeView is AppView.Vias or AppView.Overview or AppView.Automation)
                {
                    RenderCurrentView();
                }
            });
        }
        else if (isKeepAliveOk)
        {
            ViaStewardshipStore.Default.RecordKeepAliveSuccess(
                resolvedViaId,
                resolvedViaLabel,
                matched?.ClientGroup,
                payload.Detail);
            if (matched != null)
            {
                _ = Dispatcher.BeginInvoke(() => { matched.KeepAliveSuccessCount++; });
            }
        }

        var shouldCloseWindow = isKeepAliveOk && _config.AutoCloseKeepAliveWindow;
        if (shouldCloseWindow)
        {
            ChromeSessionTracker.Default.MarkKeepAliveClosed(payload.ViaId, payload.ViaLabel, payload.BrowserProfile);
        }

        BrowserEventResponseDto resp;
        if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            try
            {
                resp = await _api.PostBrowserEventAsync(payload);
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi gửi browser-event lên Cloud: {ex.Message}");
                resp = new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
            }
        }
        else
        {
            resp = new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
        }

        if (shouldCloseWindow)
        {
            resp.CloseSenderWindow = true;
            AppendLog($"Keep-Alive OK: Gửi tín hiệu tự đóng cửa sổ/tab Chrome cho Via '{payload.ViaLabel}'.");
        }
        return resp;
    }

    private async Task<AutoConnectTokenBridgeResponse> OnBridgeAutoConnectTokenAsync(AutoConnectTokenBridgeRequest req)
    {
        var token = (req.AccessToken ?? "").Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            return new AutoConnectTokenBridgeResponse { Ok = false, Error = "Thiếu access_token (EAAB...)." };
        }
        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            return new AutoConnectTokenBridgeResponse
            {
                Ok = false,
                Error = "Bạn chưa đăng nhập AdsOps Cloud trên App Windows (vào Cài đặt để đăng nhập).",
            };
        }

        var profileLabel = !string.IsNullOrWhiteSpace(req.BrowserProfileLabel)
            ? req.BrowserProfileLabel.Trim()
            : req.ViaLabel?.Trim();
        var matchVia = _vias.FirstOrDefault(v =>
            (!string.IsNullOrWhiteSpace(req.ViaId) && string.Equals(v.ViaId, req.ViaId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(profileLabel) && string.Equals(v.ProfileDir, profileLabel, StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(req.ViaLabel) && string.Equals(v.Label, req.ViaLabel.Trim(), StringComparison.OrdinalIgnoreCase)));
        var networkLabel = !string.IsNullOrWhiteSpace(req.NetworkLabel)
            ? req.NetworkLabel.Trim()
            : matchVia?.NetworkLabel;

        try
        {
            var res = await _api.AutoConnectFacebookTokenAsync(token, profileLabel ?? matchVia?.ProfileDir, networkLabel);
            AppendLog($"Auto-Connect Token EAAB lên Cloud thành công: {res.Label ?? profileLabel} (BM: {res.LinkedBusinessManagers ?? 0})");
            _ = Dispatcher.BeginInvoke(async () => await SyncCloudAsync(silent: true));
            return new AutoConnectTokenBridgeResponse
            {
                Ok = true,
                Id = res.Id,
                Label = res.Label,
                ExternalReferenceId = res.ExternalReferenceId,
                EmailHint = res.EmailHint,
                LinkedBusinessManagers = res.LinkedBusinessManagers,
            };
        }
        catch (Exception ex)
        {
            AppendLog($"LỖI đẩy Token EAAB lên Cloud: {ex.Message}");
            return new AutoConnectTokenBridgeResponse { Ok = false, Error = ex.Message };
        }
    }

    private async Task<BillingSyncResponseDto> OnBridgeSyncBillingAsync(BillingSyncRequestDto req)
    {
        if (string.IsNullOrWhiteSpace(req.ExternalAccountId))
        {
            return new BillingSyncResponseDto { Status = "ignored", Reason = "missing_external_account_id" };
        }
        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            return new BillingSyncResponseDto { Status = "ignored", Reason = "not_logged_in" };
        }
        try
        {
            var res = await _api.SyncBillingFromExtensionAsync(req);
            if (string.Equals(res.Status, "synced", StringComparison.OrdinalIgnoreCase))
            {
                var updatedFields = res.UpdatedFields != null && res.UpdatedFields.Count > 0
                    ? string.Join(", ", res.UpdatedFields)
                    : "no_changes";
                _ = Dispatcher.BeginInvoke(() =>
                {
                    AppendLog($"Auto-Sync Billing DOM act_{req.ExternalAccountId} ({updatedFields}).");
                    _ = SyncCloudAsync(silent: true);
                });
            }
            return res;
        }
        catch (Exception ex)
        {
            _ = Dispatcher.BeginInvoke(() => AppendLog($"Lỗi Auto-Sync Billing từ Extension: {ex.Message}"));
            return new BillingSyncResponseDto { Status = "error", Reason = ex.Message };
        }
    }

    private TileWindowsResultDto OnBridgeTileWindows(TileWindowsRequestDto? req)
    {
        var trackedPids = ChromeSessionTracker.Default
            .GetSnapshot()
            .Where(s => s.Alive && s.Pid.HasValue)
            .Select(s => s.Pid!.Value)
            .Concat(req?.Pids ?? Enumerable.Empty<int>())
            .Distinct()
            .ToList();
        var res = WindowTilerService.TileChromeWindows(req?.Grid, trackedPids);
        _ = Dispatcher.BeginInvoke(() => AppendLog(res.Message));
        return res;
    }

    internal void TileActiveChromeWindows(string gridSpec)
    {
        var res = OnBridgeTileWindows(new TileWindowsRequestDto { Grid = gridSpec });
        if (!res.Ok)
        {
            MessageBox.Show(this, res.Message, "Xếp lưới Chrome", MessageBoxButton.OK, MessageBoxImage.Information);
        }
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
        var matched = _vias.FirstOrDefault(v =>
            (!string.IsNullOrWhiteSpace(res.ViaId) && string.Equals(v.ViaId, res.ViaId, StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(res.ViaLabel) && string.Equals(v.Label, res.ViaLabel, StringComparison.OrdinalIgnoreCase)));
        if (!string.IsNullOrWhiteSpace(req.CookieRaw))
        {
            ViaStewardshipStore.Default.RecordCookieRefresh(res.ViaId, res.ViaLabel, matched?.ClientGroup);
            AppendLog($"🔄 Đã làm mới Cookie DPAPI Vault tự động cho '{res.ViaLabel}' (giữ nguyên 2FA).");
        }
        else
        {
            AppendLog($"Đã lưu DPAPI Vault local từ Extension/Bridge cho '{res.ViaLabel}'.");
        }
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (matched != null)
            {
                if (!string.IsNullOrWhiteSpace(req.CookieRaw)) matched.LastCookieRefreshUtc = DateTimeOffset.UtcNow;
                if (!string.IsNullOrWhiteSpace(res.TwoFaSecret)) matched.TwoFaSecret = res.TwoFaSecret;
            }
            ApplyUpdatedProxyClusterLimits();
            if (matched != null)
            {
                try { matched.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(matched, config: _config); } catch { }
            }
            if (_activeView is AppView.Vias or AppView.Overview or AppView.Automation or AppView.Settings)
            {
                RenderCurrentView();
            }
        });
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
            async Task<T> TryFetchAsync<T>(Func<Task<T>> call, T fallback, string label)
            {
                try { return await call(); }
                catch (Exception ex)
                {
                    AppendLog($"Bỏ qua {label} (tùy chọn): {ex.Message}");
                    return fallback;
                }
            }

            var userTask = _api.GetCurrentUserAsync();
            var accountsTask = _api.ListPersonalAccountsAsync();
            var bmsTask = _api.ListBusinessManagersAsync();
            var adAccsTask = _api.ListAdAccountsAsync();
            var pagesTask = _api.GetPagesSummaryAsync();
            var alertSumTask = _api.GetAlertsSummaryAsync();
            var alertsTask = _api.ListAlertsAsync(25);
            var cronTask = _api.GetAutomationCronStatusAsync();
            var metaConnTask = TryFetchAsync(() => _api.ListMetaConnectionsAsync(), new List<MetaConnectionDto>(), "Meta Connections");
            var healthSumTask = TryFetchAsync(() => _api.GetAccountHealthSummaryAsync(), new HealthSummaryDto(), "Tóm tắt sức khỏe TKQC");
            var healthRowsTask = TryFetchAsync(() => _api.ListAccountHealthAsync(100), new PagedAccountHealthDto(), "Sức khỏe TKQC");
            var draftsTask = TryFetchAsync(() => _api.ListCampaignDraftsAsync(25), new PagedCampaignDraftsDto(), "Pre-flight Campaign Drafts");
            var telegramTask = TryFetchAsync(() => _api.GetTelegramBotConfigAsync(), new TelegramBotConfigDto(), "Telegram Bot Config");
            var spendSumTask = TryFetchAsync(() => _api.GetSpendSummaryAsync(), new SpendSummaryDto(), "Tổng hợp Chi tiêu");
            var sessionsTask = TryFetchAsync(() => _api.ListMyDeviceSessionsAsync(), new List<DeviceSessionDto>(), "Phiên Thiết bị Cloud");
            var proxyMapTask = TryFetchAsync(() => _api.GetProxyHealthMapAsync(), new Dictionary<string, ProxyCheckResultDto>(), "Bản đồ Live Proxy");
            var readinessSumTask = TryFetchAsync(() => _api.GetReadinessSummaryAsync(), new ReadinessSummaryDto(), "Tóm tắt Readiness");
            var readinessBoardTask = TryFetchAsync(() => _api.GetReadinessBoardAsync(200), new ReadinessBoardDto(), "Readiness Board");
            var auditTask = TryFetchAsync(() => _api.ListAuditLogsAsync(1, 50), new PagedResponse<AuditLogEntryDto>(), "Live Audit Logs");
            var pixelsTask = TryFetchAsync(() => _api.ListPixelsAsync(100), new PagedResponse<PixelDto>(), "Meta Pixels");
            var domainSeoTask = TryFetchAsync(() => _api.GetDomainSeoConfigAsync(), new DomainSeoConfigDto(), "Domain & SEO Config");
            var retainersTask = TryFetchAsync(() => _api.GetClientRetainersAsync(), new ClientRetainersOverviewDto(), "Client Retainers");
            var teamSumTask = TryFetchAsync<TeamSummaryDto?>(async () => await _api.GetTeamSummaryAsync(), null, "Team Summary");
            var teamMemTask = TryFetchAsync(() => _api.ListTeamMembersAsync(), new List<TeamMemberDto>(), "Team Members");
            var teamInvTask = TryFetchAsync(() => _api.ListTeamInvitationsAsync(), new List<TeamInvitationDto>(), "Team Invitations");
            var quotaTask = TryFetchAsync<CommunityQuotaDto?>(async () => await _api.GetMyCommunityQuotaAsync(), null, "Hạn mức Cộng đồng");
            var playbooksTask = TryFetchAsync(() => _api.ListPlaybooksAsync(), new List<AutomationPlaybookDto>(), "Kịch bản Team");
            var launchAuditTask = TryFetchAsync(() => _api.GetProfileLaunchAuditAsync(50), new List<ProfileLaunchAuditDto>(), "Nhật ký Mở Profile");

            await Task.WhenAll(
                userTask, accountsTask, bmsTask, adAccsTask, pagesTask, alertSumTask, alertsTask, cronTask,
                metaConnTask, healthSumTask, healthRowsTask, draftsTask,
                telegramTask, spendSumTask, sessionsTask,
                proxyMapTask, readinessSumTask, readinessBoardTask, auditTask,
                pixelsTask, domainSeoTask, retainersTask, teamSumTask, teamMemTask, teamInvTask, quotaTask,
                playbooksTask, launchAuditTask);

            _currentUser = userTask.Result;
            _bms = bmsTask.Result.Items ?? new();
            _adAccounts = adAccsTask.Result.Items ?? new();
            _pagesSummary = pagesTask.Result;
            _alertSummary = alertSumTask.Result;
            _alerts = alertsTask.Result.Items ?? new();
            _cronStatus = cronTask.Result;
            _metaConnections = metaConnTask.Result;
            _healthSummary = healthSumTask.Result;
            _accountHealthRows = healthRowsTask.Result.Items ?? new();
            _campaignDrafts = draftsTask.Result.Items ?? new();
            _telegramConfig = telegramTask.Result;
            _spendSummary = spendSumTask.Result;
            _deviceSessions = sessionsTask.Result;
            _proxyHealthMap = new Dictionary<string, ProxyCheckResultDto>(proxyMapTask.Result, StringComparer.OrdinalIgnoreCase);
            _readinessSummary = readinessSumTask.Result;
            _readinessBoard = readinessBoardTask.Result;
            _auditLogs = auditTask.Result.Items ?? new();
            _pixels = pixelsTask.Result.Items ?? new();
            _domainSeoConfig = domainSeoTask.Result;
            _retainersOverview = retainersTask.Result;
            _teamSummary = teamSumTask.Result;
            _teamMembers = teamMemTask.Result;
            _teamInvitations = teamInvTask.Result;
            if (quotaTask.Result != null) _communityQuota = quotaTask.Result;
            _playbooks = playbooksTask.Result;
            _launchAudits = launchAuditTask.Result;
            _workstationMem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();

            RebuildViaWorkspaceList(accountsTask.Result.Items ?? new());
            ProvisionAllViaExtensions(silent: true);

            try
            {
                CloudSnapshotCacheStore.Save(new CloudSnapshotPayload
                {
                    UserEmail = _currentUser?.Email ?? _config.UserEmail,
                    SavedAtUtc = DateTime.UtcNow.ToString("O"),
                    CurrentUser = _currentUser,
                    PersonalAccounts = accountsTask.Result.Items ?? new(),
                    BusinessManagers = _bms,
                    AdAccounts = _adAccounts,
                    PagesSummary = _pagesSummary,
                    HealthSummary = _healthSummary,
                    CommunityQuota = _communityQuota,
                });
            }
            catch { }

            _isOfflineSnapshotMode = false;
            _lastErrorMessage = null;
            _errorBanner.Visibility = Visibility.Collapsed;
            _hasLoadedOnce = true;
            _lastSyncedAtLocal = DateTime.Now;
            AppendLog($"Đồng bộ Cloud xong: {_vias.Count} Via, {_pagesSummary?.Items.Count ?? 0} Fanpage, {_adAccounts.Count} TKQC, {_accountHealthRows.Count} đánh giá sức khỏe, {_alerts.Count} cảnh báo.");
        }
        catch (Exception ex)
        {
            if (!_hasLoadedOnce || _vias.Count == 0)
            {
                var fallback = CloudSnapshotCacheStore.Load(_config.UserEmail);
                if (fallback != null)
                {
                    HydrateFromOfflineSnapshot(fallback);
                    AppendLog($"⚡ Cloud đang bảo trì/chậm ({ex.Message}) -> Đã kích hoạt Bản lưu Offline DPAPI ({_vias.Count} Via, lúc {_offlineSnapshotAt}).");
                }
            }
            _lastErrorMessage = _isOfflineSnapshotMode
                ? $"⚡ Chế độ Dự phòng Offline DPAPI ({_offlineSnapshotAt}): Cloud đang chậm ({ex.Message}). Mọi tính năng Nuôi Via, OTP 2FA, Két Cookie & Proxy vẫn chạy 100%!"
                : $"Không thể đồng bộ Cloud: {ex.Message}";
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
            var stew = ViaStewardshipStore.Default.GetOrTrackProxy(r.Id, r.Label, r.NetworkLabel);

            var effectiveWarmupIso = parsed.WarmupStartIso;
            if (_config.EnforceSoakQuarantine &&
                !string.IsNullOrWhiteSpace(stew.ProxyChangedUtc) &&
                DateTimeOffset.TryParse(stew.ProxyChangedUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var pxChangedAt))
            {
                if (string.IsNullOrWhiteSpace(effectiveWarmupIso) ||
                    (DateTimeOffset.TryParse(effectiveWarmupIso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var curWm) &&
                     pxChangedAt > curWm))
                {
                    effectiveWarmupIso = stew.ProxyChangedUtc;
                }
            }

            var warmup = ViaMetadataParser.ComputeWarmupStatus(effectiveWarmupIso, null, _config.SoakQuarantineHours);
            quotaById.TryGetValue(r.Id, out var q);

            var profileDir = ExtensionProvisioner.ResolveProfileDirectory(r.BrowserProfileLabel, r.Label);
            var localSecret = LocalSecretVaultStore.Default.Find(r.Id, profileDir, r.Label);
            var twoFa = ExtensionProvisioner.ExtractTwoFaSecret(r.VaultReference, r.Notes);
            if (string.IsNullOrEmpty(twoFa) && localSecret.Found)
            {
                twoFa = localSecret.TwoFaSecret;
            }

            // Preserve any previously measured proxy state during silent resyncs
            var old = _vias.FirstOrDefault(v => string.Equals(v.ViaId, r.Id, StringComparison.OrdinalIgnoreCase));

            ProxyCheckResultDto? mappedProxy = null;
            if (!string.IsNullOrWhiteSpace(r.NetworkLabel))
            {
                var normKey = DesktopAppInfo.NormalizeProxyKey(r.NetworkLabel);
                if (!string.IsNullOrWhiteSpace(normKey))
                {
                    _proxyHealthMap.TryGetValue(normKey, out mappedProxy);
                }
                if (mappedProxy == null)
                {
                    var hp = AutomationQueueEngine.ExtractProxyHostPort(r.NetworkLabel);
                    if (!string.IsNullOrWhiteSpace(hp))
                    {
                        mappedProxy = _proxyHealthMap
                            .FirstOrDefault(kv =>
                                kv.Key.Contains(hp, StringComparison.OrdinalIgnoreCase) ||
                                (!string.IsNullOrWhiteSpace(kv.Value.NormalizedKey) && kv.Value.NormalizedKey.Contains(hp, StringComparison.OrdinalIgnoreCase)))
                            .Value;
                    }
                }
            }

            var resolvedProxyStatus = string.IsNullOrWhiteSpace(r.NetworkLabel)
                ? "DIRECT"
                : mappedProxy != null
                    ? (string.Equals(mappedProxy.Status, "LIVE", StringComparison.OrdinalIgnoreCase) ? "LIVE" : "DEAD")
                    : (old?.ProxyLastStatus ?? "UNCHECKED");

            DateTimeOffset? cooldownUntilUtc = null;
            if (!string.IsNullOrWhiteSpace(stew.CooldownUntilUtc) &&
                DateTimeOffset.TryParse(stew.CooldownUntilUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var cdParsed))
            {
                cooldownUntilUtc = cdParsed;
            }

            DateTimeOffset? lastCookieRefreshUtc = null;
            if (!string.IsNullOrWhiteSpace(stew.LastCookieRefreshUtc) &&
                DateTimeOffset.TryParse(stew.LastCookieRefreshUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var ckRefParsed))
            {
                lastCookieRefreshUtc = ckRefParsed;
            }

            var entry = new ViaWorkspaceEntry
            {
                ViaId = r.Id,
                Label = r.Label,
                DisplayName = r.DisplayName,
                ExternalReferenceId = r.ExternalReferenceId ?? "",
                Status = string.IsNullOrWhiteSpace(r.Status) ? "active" : r.Status,
                BrowserProfileLabel = string.IsNullOrWhiteSpace(r.BrowserProfileLabel) ? profileDir : r.BrowserProfileLabel,
                ProfileDir = profileDir,
                NetworkLabel = r.NetworkLabel ?? "",
                Notes = r.Notes ?? "",
                CleanNotes = parsed.CleanNotes,
                RoleTier = parsed.Tier,
                WarmupStartIso = effectiveWarmupIso,
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
                ProxyLastStatus = resolvedProxyStatus,
                ProxyLatencyMs = mappedProxy?.LatencyMs ?? old?.ProxyLatencyMs,
                ProxyExitIp = mappedProxy?.ExitIp ?? old?.ProxyExitIp,
                IsSelected = prevSelected.Contains(r.Id),
                BundledAccounts = matchedAdAccs.Select(BundledExtensionAccountDto.FromApi).ToList(),
                ClientGroup = parsed.ClientGroup,
                DefaultWarmupMode = parsed.WarmupMode,
                SoakHoursRemaining = warmup.Phase == "72h_lock" ? Math.Max(1, _config.SoakQuarantineHours - warmup.HoursElapsed) : 0,
                IsInSoakQuarantine = warmup.Phase == "72h_lock",
                CooldownUntilUtc = cooldownUntilUtc,
                CooldownReason = stew.CooldownReason ?? "",
                LastCookieRefreshUtc = lastCookieRefreshUtc,
                KeepAliveSuccessCount = stew.KeepAliveSuccessCount,
                AntidetectEngine = parsed.AntidetectEngine,
                AntidetectProfileId = parsed.AntidetectProfileId,
                OwnerMemberId = r.OwnerMemberId ?? "",
                OwnerMemberName = ResolveTeamMemberDisplayName(r.OwnerMemberId),
                Timezone = r.Timezone ?? "",
                ProxyTimezone = mappedProxy?.Timezone ?? old?.ProxyTimezone ?? "",
            };
            var (tzMatch, tzWarn) = ProxyTimezoneHelper.EvaluateMatch(
                entry.ProxyTimezone,
                mappedProxy?.CountryCode,
                string.IsNullOrWhiteSpace(entry.Timezone) ? null : entry.Timezone);
            entry.HasTimezoneMismatch = tzMatch == false;
            entry.TimezoneWarning = tzWarn ?? "";
            list.Add(entry);
        }

        _vias = list;
        ApplyUpdatedProxyClusterLimits();
        RefreshLiveSessionTelemetryOnVias();
    }

    private string ResolveTeamMemberDisplayName(string? memberId)
    {
        if (string.IsNullOrWhiteSpace(memberId)) return "";
        var m = _teamMembers.FirstOrDefault(t => string.Equals(t.Id, memberId.Trim(), StringComparison.OrdinalIgnoreCase));
        if (m == null) return "";
        return string.IsNullOrWhiteSpace(m.FullName) ? m.Email : m.FullName;
    }

    internal void RefreshLiveSessionTelemetryOnVias()
    {
        var active = ChromeSessionTracker.Default.GetSnapshot().Where(s => s.Alive).ToList();
        foreach (var v in _vias)
        {
            var matchedSess = active.Where(s =>
                (!string.IsNullOrWhiteSpace(v.ViaId) && string.Equals(s.ViaId, v.ViaId, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(v.Label) && string.Equals(s.ViaLabel, v.Label, StringComparison.OrdinalIgnoreCase)))
                .ToList();
            v.IsBrowserRunning = matchedSess.Count > 0;
            v.ActiveRamMb = matchedSess.Sum(s => s.RamMb);
            v.ActiveCpuPercent = Math.Round(matchedSess.Sum(s => s.CpuPercent), 1);
        }
    }

    internal int GetEffectiveMaxConcurrentBrowsers()
    {
        if (!_config.AutoScaleConcurrentByRam) return Math.Clamp(_config.MaxConcurrentBrowsers, 1, 30);
        _workstationMem ??= WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        var ramCap = WorkstationPerformanceOptimizer.ComputeRecommendedMaxConcurrent(_config.LowRamFarmMode, _workstationMem);
        return Math.Clamp(Math.Min(_config.MaxConcurrentBrowsers, ramCap), 1, 30);
    }

    internal static bool CanUserLaunchVia(
        string? userRole,
        string? currentMemberId,
        string? viaOwnerMemberId,
        out string denyReason)
    {
        var role = (userRole ?? "").Trim().ToLowerInvariant();
        if (role is "viewer" or "auditor")
        {
            denyReason = $"Vai trò '{role}' chỉ có quyền xem/kiểm toán, không được phép mở trình duyệt Via.";
            return false;
        }
        var ownerId = (viaOwnerMemberId ?? "").Trim();
        if (!string.IsNullOrEmpty(ownerId) && role is not "owner" and not "admin")
        {
            if (string.IsNullOrWhiteSpace(currentMemberId) ||
                !string.Equals(ownerId, currentMemberId.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                denyReason = "Via này đã được phân quyền riêng cho thành viên khác phụ trách. Chỉ Owner/Admin hoặc người được giao mới được mở.";
                return false;
            }
        }
        denyReason = "";
        return true;
    }

    private bool CanCurrentUserLaunchVia(ViaWorkspaceEntry via, out string denyReason)
    {
        var curMemberId = _currentUser == null
            ? ""
            : (_teamMembers.FirstOrDefault(m =>
                string.Equals(m.UserId, _currentUser.Id, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(m.Email, _currentUser.Email, StringComparison.OrdinalIgnoreCase))?.Id ?? "");
        return CanUserLaunchVia(_currentUser?.Role, curMemberId, via.OwnerMemberId, out denyReason);
    }

    private async Task SendProfileLifecycleEventNonBlockingAsync(
        string eventType,
        ViaWorkspaceEntry via,
        string targetUrl,
        int? startupMs,
        string engineUsed,
        string failoverFrom = "",
        string detail = "")
    {
        if (string.IsNullOrWhiteSpace(_config.GetJwt())) return;
        try
        {
            await _api.PostBrowserEventAsync(new BrowserEventPayloadDto
            {
                EventType = eventType,
                ViaId = via.ViaId,
                ViaLabel = via.Label,
                BrowserProfile = string.IsNullOrWhiteSpace(via.AntidetectProfileId) ? via.ProfileDir : $"{AntidetectBrowserConnector.GetDisplayName(engineUsed)} #{via.AntidetectProfileId}",
                AntidetectEngine = engineUsed,
                AntidetectProfileId = via.AntidetectProfileId,
                Workstation = Environment.MachineName,
                StartupMs = startupMs,
                FailoverFrom = failoverFrom,
                TargetUrl = targetUrl,
                PageUrl = targetUrl,
                Detail = detail,
            }).ConfigureAwait(false);
        }
        catch { }
    }

    internal void ApplyUpdatedProxyClusterLimits()
    {
        var maxPerIp = Math.Clamp(_config.MaxViasPerProxyInBatch < 1 ? 4 : _config.MaxViasPerProxyInBatch, 1, 50);
        ViaTrustEvaluator.DetectClientSiloConflicts(_vias, maxPerIp);
        foreach (var v in _vias)
        {
            var localSec = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
            var hasTwoFa = !string.IsNullOrWhiteSpace(v.TwoFaSecret) || (localSec.Found && !string.IsNullOrWhiteSpace(localSec.TwoFaSecret));
            var hasCookie = localSec.Found && !string.IsNullOrWhiteSpace(localSec.CookieRaw);
            v.HasLocalTwoFa = hasTwoFa;
            v.HasVaultCookie = hasCookie;
            (v.TrustScore, v.TrustSummary) = ViaTrustEvaluator.EvaluateTrustScore(v, hasTwoFa, hasCookie, maxPerIp);
        }
    }

    private int ProvisionAllViaExtensions(bool silent)
    {
        int okCount = 0;
        foreach (var v in _vias)
        {
            try
            {
                v.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(v, config: _config);
                okCount++;
            }
            catch (Exception ex)
            {
                AppendLog($"Lỗi cấp Extension cho Via '{v.Label}': {ex.Message}");
            }
        }
        if (!silent)
        {
            AppendLog($"Đã cấp / cập nhật Chrome Extension Companion v{DesktopAppInfo.ExtVersion} cho {okCount}/{_vias.Count} Via.");
        }
        return okCount;
    }

    private async Task LaunchViaBrowserAsync(ViaWorkspaceEntry via, string targetUrl, bool interactiveAlerts = true)
    {
        try
        {
            if (!CanCurrentUserLaunchVia(via, out var denyReason))
            {
                AppendLog($"⛔ Chặn mở Via '{via.Label}' theo Phân quyền Team: {denyReason}");
                if (interactiveAlerts)
                {
                    _ = Dispatcher.BeginInvoke(() =>
                        MessageBox.Show(this, denyReason, "Phân quyền Team", MessageBoxButton.OK, MessageBoxImage.Warning));
                }
                return;
            }
            if (via.IsInCooldown)
            {
                AppendLog($"⚠️ Lưu ý: Via '{via.Label}' đang trong thời gian Cooldown ({via.CooldownReason}). Mở trình duyệt để kiểm tra thủ công.");
            }
            via.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(via, config: _config);

            var normEng = AntidetectBrowserConnector.NormalizeEngine(via.AntidetectEngine);
            if (normEng != "chrome_native" && !string.IsNullOrWhiteSpace(via.AntidetectProfileId))
            {
                var adRes = await AntidetectBrowserConnector.StartProfileAsync(
                    normEng,
                    _config.AntidetectApiBaseUrl,
                    _config.AntidetectApiKey,
                    via.AntidetectProfileId);
                if (adRes.Ok)
                {
                    var labelDisp = $"{AntidetectBrowserConnector.GetDisplayName(normEng)} #{via.AntidetectProfileId}";
                    ChromeSessionTracker.Default.RecordLaunch(adRes.Pid, via.ViaId, via.Label, labelDisp, targetUrl, normEng);
                    RefreshLiveSessionTelemetryOnVias();
                    AppendLog($"🎭 {adRes.Message} cho Via '{via.Label}'.");
                    _ = SendProfileLifecycleEventNonBlockingAsync("PROFILE_LAUNCHED", via, targetUrl, adRes.StartupMs, normEng, detail: adRes.Message);
                    return;
                }

                AppendLog($"⚠️ LỖI mở {AntidetectBrowserConnector.GetDisplayName(normEng)} #{via.AntidetectProfileId}: {adRes.Message}");
                var probes = await AntidetectBrowserConnector.BenchmarkAllEnginesAsync(_config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
                _engineProbes = probes;
                _recommendedFastestEngine = AntidetectBrowserConnector.RecommendFastestOnlineEngine(probes);

                var onlineOthers = probes
                    .Where(p => p.Online && p.Engine != "chrome_native" && !string.Equals(p.Engine, normEng, StringComparison.OrdinalIgnoreCase))
                    .Select(p => $"{AntidetectBrowserConnector.GetDisplayName(p.Engine)} ({p.LatencyMs}ms)")
                    .ToList();
                var vaultCheck = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
                var hasDpapiSession = vaultCheck.Found && (!string.IsNullOrWhiteSpace(vaultCheck.CookieRaw) || !string.IsNullOrWhiteSpace(vaultCheck.TwoFaSecret));

                bool shouldFailover = _config.AutoFailoverToChromeNative;
                if (!shouldFailover && interactiveAlerts)
                {
                    var othersText = onlineOthers.Count > 0
                        ? $"Engine Antidetect khác đang online: {string.Join(", ", onlineOthers)}.\n"
                        : "";
                    var vaultText = hasDpapiSession
                        ? "✓ Két DPAPI máy này đang giữ sẵn Cookie/2FA của Via này."
                        : "Lưu ý: Chưa có Cookie DPAPI backup — mở Chrome Gốc sẽ vào Profile cô lập để đăng nhập hoặc nạp Cookie.";
                    var answer = await Dispatcher.InvokeAsync(() => MessageBox.Show(
                        this,
                        $"{adRes.Message}\n\n{othersText}{vaultText}\n\nBạn có muốn AUTO-FAILOVER mở ngay bằng Chrome Gốc Cô lập (Khiên WebRTC + Proxy) không?",
                        $"Auto-Failover • {AntidetectBrowserConnector.GetDisplayName(normEng)} Offline",
                        MessageBoxButton.YesNo,
                        MessageBoxImage.Question));
                    shouldFailover = answer == MessageBoxResult.Yes;
                }

                if (!shouldFailover) return;

                var effectiveIsoFail = ExtensionProvisioner.ShouldUseIsolatedProfile(
                    _config.UseIsolatedProfiles,
                    via.ProfileDir,
                    via.NetworkLabel,
                    via.HasVaultCookie,
                    via.Label);
                var swFail = Stopwatch.StartNew();
                var failInfo = await Task.Run(() => ExtensionProvisioner.LaunchChromeDetailed(
                    targetUrl,
                    via.ProfileDir,
                    via.ExtensionFolder,
                    effectiveIsoFail,
                    via.Label,
                    _config.EnableChromeAntidetectShield,
                    _config.LowRamFarmMode));
                swFail.Stop();
                AntidetectEngineBenchmarkStore.Default.RecordStartup("chrome_native", (int)swFail.ElapsedMilliseconds);
                ChromeSessionTracker.Default.RecordLaunch(failInfo.Pid, via.ViaId, via.Label, via.ProfileDir, targetUrl, "chrome_native", failInfo.DelegatedToSharedBroker, failInfo.IsolatedMode);
                RefreshLiveSessionTelemetryOnVias();
                var failoverMode = failInfo.IsolatedMode ? "Chrome Gốc Cô lập" : "Chrome Profile gốc";
                var failoverDetail = $"Auto-Failover từ {AntidetectBrowserConnector.GetDisplayName(normEng)} (offline/lỗi) sang {failoverMode}";
                AppendLog($"🛡️ {failoverDetail} cho Via '{via.Label}' ({swFail.ElapsedMilliseconds}ms).");
                _ = SendProfileLifecycleEventNonBlockingAsync("ENGINE_FAILOVER", via, targetUrl, (int)swFail.ElapsedMilliseconds, "chrome_native", failoverFrom: normEng, detail: failoverDetail);
                return;
            }

            var effectiveIso = ExtensionProvisioner.ShouldUseIsolatedProfile(
                _config.UseIsolatedProfiles,
                via.ProfileDir,
                via.NetworkLabel,
                via.HasVaultCookie,
                via.Label);
            var sw = Stopwatch.StartNew();
            var launchInfo = await Task.Run(() => ExtensionProvisioner.LaunchChromeDetailed(
                targetUrl,
                via.ProfileDir,
                via.ExtensionFolder,
                effectiveIso,
                via.Label,
                _config.EnableChromeAntidetectShield,
                _config.LowRamFarmMode));
            sw.Stop();
            AntidetectEngineBenchmarkStore.Default.RecordStartup("chrome_native", (int)sw.ElapsedMilliseconds);
            ChromeSessionTracker.Default.RecordLaunch(launchInfo.Pid, via.ViaId, via.Label, via.ProfileDir, targetUrl, "chrome_native", launchInfo.DelegatedToSharedBroker, launchInfo.IsolatedMode);
            RefreshLiveSessionTelemetryOnVias();
            var launchModeTag = launchInfo.IsolatedMode ? "Cô lập --user-data-dir" : "Profile gốc Chrome";
            AppendLog($"Đã mở Chrome ({launchModeTag}) '{via.ProfileDir}' ({via.Label}, {(int)sw.ElapsedMilliseconds}ms) -> {targetUrl}");
            _ = SendProfileLifecycleEventNonBlockingAsync("PROFILE_LAUNCHED", via, targetUrl, (int)sw.ElapsedMilliseconds, "chrome_native");
        }
        catch (Exception ex)
        {
            AppendLog($"LỖI mở Trình duyệt Via '{via.Label}': {ex.Message}");
            if (interactiveAlerts)
            {
                _ = Dispatcher.BeginInvoke(() =>
                    MessageBox.Show(this, ex.Message, "Không mở được Trình duyệt", MessageBoxButton.OK, MessageBoxImage.Warning));
            }
        }
    }

    private void LaunchViaChromeSafe(ViaWorkspaceEntry via, string targetUrl)
    {
        _ = LaunchViaBrowserAsync(via, targetUrl, interactiveAlerts: true);
    }

    private async Task<(bool Live, string Reason)> PreCheckProxyAsync(QueueTaskItem item)
    {
        if (string.IsNullOrWhiteSpace(item.NetworkLabel))
        {
            return (true, "Direct IP");
        }

        try
        {
            var matchedVia = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase));
            var expectedTz = matchedVia?.Timezone;
            var res = await _api.CheckProxyLiveAsync(item.NetworkLabel, item.ViaLabel, expectedTz);
            var (tzMatch, tzWarn) = res.TimezoneMatch.HasValue
                ? (res.TimezoneMatch, res.TimezoneWarning)
                : ProxyTimezoneHelper.EvaluateMatch(res.Timezone, res.CountryCode, expectedTz);

            _ = Dispatcher.BeginInvoke(() =>
            {
                var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase));
                if (via != null)
                {
                    via.ProxyLastStatus = string.Equals(res.Status, "LIVE", StringComparison.OrdinalIgnoreCase) ? "LIVE" : "DEAD";
                    via.ProxyLatencyMs = res.LatencyMs;
                    via.ProxyExitIp = res.ExitIp;
                    via.ProxyTimezone = res.Timezone ?? "";
                    via.HasTimezoneMismatch = tzMatch == false;
                    via.TimezoneWarning = tzWarn ?? "";
                }
            });

            if (string.Equals(res.Status, "LIVE", StringComparison.OrdinalIgnoreCase))
            {
                var tzNote = tzMatch == false ? $" • ⚠ {tzWarn}" : "";
                return (true, $"Proxy LIVE {(res.LatencyMs.HasValue ? $"{res.LatencyMs.Value}ms" : "")} ({res.ExitIp ?? "?"}{tzNote})");
            }
            return (false, string.IsNullOrWhiteSpace(res.Message) ? "Proxy DEAD / timeout" : res.Message!);
        }
        catch (Exception ex)
        {
            return (false, $"Lỗi check proxy: {ex.Message}");
        }
    }

    internal static string GetEffectiveBatchProfileKey(ViaWorkspaceEntry? via, string fallbackProfile = "")
    {
        if (via != null)
        {
            var eng = AntidetectBrowserConnector.NormalizeEngine(via.AntidetectEngine);
            if (eng != "chrome_native" && !string.IsNullOrWhiteSpace(via.AntidetectProfileId))
            {
                return $"{eng}:{via.AntidetectProfileId.Trim()}";
            }
            if (!string.IsNullOrWhiteSpace(via.ProfileDir))
            {
                return via.ProfileDir.Trim();
            }
        }
        return (fallbackProfile ?? "").Trim();
    }

    private async Task LaunchViaQueueItemAsync(QueueTaskItem item)
    {
        ViaWorkspaceEntry? via = null;
        await Dispatcher.InvokeAsync(() =>
        {
            via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase))
                  ?? new ViaWorkspaceEntry
                  {
                      ViaId = item.ViaId,
                      Label = item.ViaLabel,
                      BrowserProfileLabel = item.BrowserProfile,
                      ProfileDir = ExtensionProvisioner.ResolveProfileDirectory(item.BrowserProfile, item.ViaLabel),
                      NetworkLabel = item.NetworkLabel,
                      ViaTier = item.ViaTier,
                  };
        });
        await LaunchViaBrowserAsync(via!, item.TargetUrl, interactiveAlerts: false);
    }

    private async Task OnQueueCompletedAsync(QueueKind kind)
    {
        if (kind == QueueKind.KeepAlive && !string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            try
            {
                var launchedById = _queue.LastLaunchedItems
                    .Where(item => !string.IsNullOrWhiteSpace(item.ViaId))
                    .GroupBy(item => item.ViaId, StringComparer.OrdinalIgnoreCase)
                    .Select(g => g.First())
                    .ToList();
                if (launchedById.Count > 0)
                {
                    var payload = launchedById.Select(item =>
                    {
                        var matched = _vias.FirstOrDefault(v => string.Equals(v.ViaId, item.ViaId, StringComparison.OrdinalIgnoreCase));
                        var routeSummary = matched?.IsInSoakQuarantine == true
                            ? "soak_72h (feed -> notif)"
                            : ViaMetadataParser.NormalizeWarmupMode(matched?.DefaultWarmupMode ?? _config.DefaultWarmupMode);
                        return new
                        {
                            via_id = item.ViaId,
                            via_label = matched?.Label ?? item.ViaLabel,
                            browser_profile = matched?.ProfileDir ?? item.BrowserProfile,
                            route_summary = routeSummary,
                            duration_sec = 30,
                        };
                    });
                    await _api.LogViaKeepAliveBatchAsync(payload);
                }
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
            var directCount = targetVias.Count(v => string.IsNullOrWhiteSpace(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel)));
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                title,
                $"Chuẩn bị mở Chrome Profile thật & Proxy riêng để Đảo Ấm thụ động (chỉ cuộn Newsfeed & /notifications, tuyệt đối không Like/Comment) cho {targetVias.Count} Via.",
                new (string, string)[]
                {
                    ("Số lượng Via:", $"{targetVias.Count} Via (Direct IP: {directCount})"),
                    ("Nghỉ giãn cách:", $"~{_config.DefaultStaggerSeconds}s + Jitter ngẫu nhiên ±35%"),
                    ("Pre-check Proxy:", _config.PreCheckProxyBeforeLaunch ? "Bật (Proxy die tự bỏ qua)" : "Tắt"),
                    ("IP Cluster Guard:", $"Proxy: {_config.MaxViasPerProxyInBatch}/IP · Direct IP: tối đa {_config.MaxDirectIpViasInBatch} Via / ca"),
                },
                directCount > _config.MaxDirectIpViasInBatch
                    ? $"CẢNH BÁO: Có {directCount} Via đang chạy Direct IP (Mạng gốc). Hệ thống sẽ chỉ chạy tối đa {_config.MaxDirectIpViasInBatch} Via Direct IP mỗi ca để chống liên đới. Hãy dùng nút 'Chia Proxy 1:4' để gắn Proxy Dân cư."
                    : "Khung giờ an toàn mặc định: 08:00 - 22:30. Có thể Tạm dừng hoặc Dừng hẳn bất cứ lúc nào.");
            if (!ok) return;
        }

        var tasks = targetVias.Select(v =>
        {
            var effectiveMode = v.IsInSoakQuarantine && _config.EnforceSoakQuarantine
                ? "soak_72h"
                : ViaMetadataParser.NormalizeWarmupMode(!string.IsNullOrWhiteSpace(v.DefaultWarmupMode) ? v.DefaultWarmupMode : _config.DefaultWarmupMode);
            var launchUrl = "https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=" + (_config.AutoCloseKeepAliveTab ? "1" : "0") +
                            "&adsops_via_tier=" + Uri.EscapeDataString(v.RoleTier) +
                            "&adsops_via_label=" + Uri.EscapeDataString(v.Label) +
                            "&adsops_ka_mode=" + Uri.EscapeDataString(effectiveMode);
            return new QueueTaskItem(
                v.ViaId,
                v.Label,
                GetEffectiveBatchProfileKey(v, v.ProfileDir),
                v.NetworkLabel,
                launchUrl,
                effectiveMode == "soak_72h" ? "Ngâm 72h thụ động" : "Đảo Ấm Cookie thụ động",
                v.BackendTier,
                v.ClientGroup,
                v.IsInSoakQuarantine,
                v.CooldownUntilUtc,
                v.HasSiloConflict,
                v.SiloConflictDetail);
        }).ToList();

        tasks = QueueResumeStateStore.FilterRemainingItems(QueueKind.KeepAlive, tasks, out var resumedSkippedCount);
        if (resumedSkippedCount > 0)
        {
            AppendLog($"♻️ Khôi phục tiến độ Hàng đợi: Tự động bỏ qua {resumedSkippedCount} Via đã Đảo Ấm xong trước đó, chạy tiếp {tasks.Count} Via còn lại.");
        }

        _queue.StartQueue(
            QueueKind.KeepAlive,
            tasks,
            _config.DefaultStaggerSeconds,
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
        var due = _vias.Where(v => v.NeedsKeepAlive && !v.IsInCooldown).Take(2).ToList();
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
                b.CountdownPill.Visibility = Visibility.Visible;
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
                b.CountdownPill.Visibility = Visibility.Collapsed;
            }
        }

        if (++_watchdogTickCount % 5 == 0)
        {
            RefreshLiveSessionTelemetryOnVias();
            if (_queueSnapshot.Phase == QueuePhase.Running)
            {
                var reaped = ChromeSessionTracker.Default.ReapHungSessions(_config.BrowserHangTimeoutSeconds);
                foreach (var r in reaped)
                {
                    ViaStewardshipStore.Default.AppendEvent(
                        "BROWSER_HANG_REAPED",
                        r.ViaId,
                        r.ViaLabel,
                        "",
                        $"Tự đóng trình duyệt treo quá {_config.BrowserHangTimeoutSeconds}s ({r.ProfileDir}) để giải phóng hàng đợi");
                    AppendLog($"⏱️ Watchdog chống treo: Đã tự thu hồi trình duyệt '{r.ViaLabel}' ({r.ProfileDir}) treo quá {_config.BrowserHangTimeoutSeconds}s.");
                }
                RefreshLiveSessionTelemetryOnVias();
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
            if (!showBalloon)
            {
                OpenLocalVaultDialog(via);
                return;
            }
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
        var healthAlertTotal = (_healthSummary?.Critical ?? 0) + (_healthSummary?.Warning ?? 0) + (_healthSummary?.AttentionNeeded ?? 0);
        SetNavBadge(AppView.HealthTokens, healthAlertTotal > 0 ? healthAlertTotal.ToString() : "");
        var retainerWarnCount = _retainersOverview?.Items.Count(c => c.PacingStatus is "OVER_BUDGET" or "NEAR_CAP") ?? 0;
        SetNavBadge(AppView.WorkspaceOps, retainerWarnCount > 0 ? retainerWarnCount.ToString() : "");

        (_headerTitle.Text, _headerSubtitle.Text) = _activeView switch
        {
            AppView.Overview => ("Tổng quan vận hành", BuildSyncSubtitle("Bức tranh đa Via, cảnh báo hệ thống & hàng đợi")),
            AppView.Vias => ("Quản lý Đa Via", BuildSyncSubtitle($"{_vias.Count} Via • 2FA local thời gian thực • {(_config.UseIsolatedProfiles ? "Chế độ Chrome cô lập (--user-data-dir)" : "Chế độ Chrome chung Profile")}")),
            AppView.Automation => ("Trung tâm Tự động hóa", BuildSyncSubtitle("Tạo Page theo nhịp an toàn, Đảo Ấm đa Via & Cloud Cron")),
            AppView.PagesBm => ("Fanpage, BM, Pixel & Domain SEO", BuildSyncSubtitle($"{_pagesSummary?.Items.Count ?? 0} Fanpage • {_bms.Count} BM • {_pixels.Count} Pixel")),
            AppView.AdAccounts => ("Tài khoản Quảng cáo", BuildSyncSubtitle($"{_adAccounts.Count} TKQC liên kết • Số liệu căn lề Tabular chính xác")),
            AppView.HealthTokens => ("Sức khỏe TKQC, Readiness & Audit Log", BuildSyncSubtitle($"{_metaConnections.Count} Meta Token • {_accountHealthRows.Count} đánh giá • {_readinessBoard?.Rows.Count ?? 0} Readiness")),
            AppView.WorkspaceOps => ("Ngân sách Hợp đồng (Retainers) & Team", BuildSyncSubtitle($"{_retainersOverview?.Items.Count ?? 0} hợp đồng • {_teamMembers.Count} thành viên")),
            AppView.Settings => ("Két khóa DPAPI & Cài đặt", BuildSyncSubtitle("Kết nối Cloud, Két sao lưu AES-256-GCM (.adsopsvault) & Hệ thống")),
            _ => ("AdsOps Desktop Pro", ""),
        };

        _headerActionsPanel.Children.Clear();
        var cmdBtn = UiComponents.CreateButton("Lệnh nhanh (Ctrl+K)", ButtonVariant.Secondary, FluentIcons.Lightning, onClick: (_, _) => OpenCommandPaletteDialog(), tooltip: "Bảng tìm nhanh Via / Copy 2FA / Điều hướng (Ctrl+K hoặc Ctrl+P)");
        cmdBtn.Margin = new Thickness(0, 0, 8, 0);
        _headerActionsPanel.Children.Add(cmdBtn);

        if (isLoggedIn)
        {
            var bulkBtn = UiComponents.CreateButton("Nhập Lô", ButtonVariant.Secondary, FluentIcons.Download, onClick: (_, _) => OpenBulkImportViasDialog(), tooltip: "Nhập danh sách nhiều Via từ Clipboard (Ctrl+B)");
            bulkBtn.Margin = new Thickness(0, 0, 8, 0);
            _headerActionsPanel.Children.Add(bulkBtn);

            var addViaBtn = UiComponents.CreateButton("Thêm Via", ButtonVariant.Primary, FluentIcons.Add, onClick: (_, _) => OpenViaEditorDialog(null), tooltip: "Thêm 1 Via mới (Ctrl+N)");
            addViaBtn.Margin = new Thickness(0, 0, 8, 0);
            _headerActionsPanel.Children.Add(addViaBtn);

            if (dueCount > 0)
            {
                var warmupBtn = UiComponents.CreateButton($"Đảo Ấm ({dueCount})", ButtonVariant.Secondary, FluentIcons.CoffeeWarmup, onClick: (_, _) => StartKeepAliveDueQueue(requireConfirm: true));
                warmupBtn.Margin = new Thickness(0, 0, 8, 0);
                _headerActionsPanel.Children.Add(warmupBtn);
            }
        }

        var syncBtn = UiComponents.CreateButton("Đồng bộ", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await SyncCloudAsync(silent: false), tooltip: "Đồng bộ dữ liệu từ AdsOps Cloud (F5)");
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

    private void OnMainWindowPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5 && Keyboard.Modifiers == ModifierKeys.None)
        {
            e.Handled = true;
            _ = SyncCloudAsync(silent: false);
            return;
        }

        if (Keyboard.Modifiers != ModifierKeys.Control) return;

        switch (e.Key)
        {
            case Key.K:
            case Key.P:
                e.Handled = true;
                OpenCommandPaletteDialog();
                break;
            case Key.B:
                e.Handled = true;
                if (!string.IsNullOrWhiteSpace(_config.GetJwt())) OpenBulkImportViasDialog();
                else SwitchView(AppView.Settings);
                break;
            case Key.N:
                e.Handled = true;
                if (!string.IsNullOrWhiteSpace(_config.GetJwt())) OpenViaEditorDialog(null);
                else SwitchView(AppView.Settings);
                break;
            case Key.D1:
                e.Handled = true;
                SwitchView(AppView.Overview);
                break;
            case Key.D2:
                e.Handled = true;
                SwitchView(AppView.Vias);
                break;
            case Key.D3:
                e.Handled = true;
                SwitchView(AppView.Automation);
                break;
            case Key.D4:
                e.Handled = true;
                SwitchView(AppView.PagesBm);
                break;
            case Key.D5:
                e.Handled = true;
                SwitchView(AppView.AdAccounts);
                break;
            case Key.D6:
                e.Handled = true;
                SwitchView(AppView.HealthTokens);
                break;
            case Key.D7:
                e.Handled = true;
                SwitchView(AppView.WorkspaceOps);
                break;
            case Key.D8:
                e.Handled = true;
                SwitchView(AppView.Settings);
                break;
        }
    }

    private void ExportCsvWithDialog(
        string defaultFileName,
        IReadOnlyList<string> headers,
        IEnumerable<IReadOnlyList<string?>> rows,
        string reportLabel)
    {
        var path = SystemTrayService.ShowSaveCsvDialog(defaultFileName);
        if (string.IsNullOrWhiteSpace(path)) return;

        try
        {
            var bytes = CsvExporter.BuildCsvBytes(headers, rows);
            File.WriteAllBytes(path, bytes);
            AppendLog($"Đã xuất báo cáo {reportLabel} (UTF-8 Excel): {path}");
            _tray?.ShowBalloon("Xuất CSV thành công", $"Đã lưu {Path.GetFileName(path)}");
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi xuất CSV {reportLabel}: {ex.Message}");
            MessageBox.Show(this, $"Không thể lưu file CSV: {ex.Message}", "Lỗi xuất CSV", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_allowExit) return;
        e.Cancel = true;
        Hide();
        ShowInTaskbar = false;
        _tray?.ShowBalloon($"AdsOps Desktop Pro v{DesktopAppInfo.Version}", "Ứng dụng đang chạy ngầm tại Khay hệ thống (Local Bridge vẫn bật).");
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
