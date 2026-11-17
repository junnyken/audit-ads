using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
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
    private Button? _errorRetryBtn;
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
    private bool _isAuthExpired;
    private string _offlineSnapshotAt = "";
    private UpdateManifestDto? _latestUpdateManifest;
    private string _updateStatusText = "Chưa kiểm tra cập nhật trong phiên này.";

    private bool _isBusy;
    private bool _autoPipelineRunning;
    private bool _hasLoadedOnce;
    private string? _lastErrorMessage;
    private DateTime? _lastSyncedAtLocal;
    private DateTime _lastKeepAliveCheckUtc = DateTime.UtcNow;
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
        ThemeTokens.ApplyPalette(_config.UiThemePalette);
        ConfigureApiClient();

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
        _errorRetryBtn = UiComponents.CreateButton("Thử lại", ButtonVariant.Secondary, FluentIcons.Sync, compact: true, onClick: async (_, _) =>
        {
            if (_isAuthExpired) OpenQuickReloginDialog();
            else await SyncCloudAsync(silent: false);
        });
        _errorRetryBtn.Margin = new Thickness(0, 0, 6, 0);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
        {
            _lastErrorMessage = null;
            _errorBanner.Visibility = Visibility.Collapsed;
        });
        actions.Children.Add(_errorRetryBtn);
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
                try { ProvisionAllViaExtensions(silent: true); } catch { }
                RenderCurrentView();
            }
            await SyncCloudAsync(silent: false);
            try { ProvisionAllViaExtensions(silent: true); } catch { }
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
        _playbooks = snap.Playbooks != null && snap.Playbooks.Count > 0
            ? snap.Playbooks
            : AutomationPlaybookDto.GetDefaultBuiltinPlaybooks();
        if (snap.PersonalAccounts != null && snap.PersonalAccounts.Count > 0)
        {
            RebuildViaWorkspaceList(snap.PersonalAccounts);
        }
        ApplySavedPageHolderOverrides();
        _hasLoadedOnce = true;
        _isOfflineSnapshotMode = true;
        _offlineSnapshotAt = DateTimeOffset.TryParse(snap.SavedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt)
            ? dt.ToLocalTime().ToString("dd/MM HH:mm")
            : "";
    }

    internal void ConfigureApiClient()
    {
        _api.Configure(_config.BackendBaseUrl, _config.GetJwt(), TryAutoReloginAsync);
    }

    private async Task<string?> TryAutoReloginAsync()
    {
        var email = (_config.UserEmail ?? "").Trim();
        var pwd = _config.GetSavedPassword();
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(pwd))
        {
            return null;
        }
        try
        {
            var res = await _api.LoginAsync(email, pwd).ConfigureAwait(false);
            _config.SetJwt(res.AccessToken);
            _config.Save();
            _isAuthExpired = false;
            _ = Dispatcher.BeginInvoke(() => AppendLog($"🔑 Đã tự động gia hạn phiên đăng nhập Cloud cho '{email}'."));
            return res.AccessToken;
        }
        catch
        {
            return null;
        }
    }

    private void SetErrorRetryButtonLabel(string label)
    {
        if (_errorRetryBtn?.Content is StackPanel sp && sp.Children.Count >= 2 && sp.Children[1] is TextBlock tb)
        {
            tb.Text = label;
        }
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
        var isPageInviteOk = string.Equals(evType, "PAGE_INVITE_FOLLOWERS_OK", StringComparison.OrdinalIgnoreCase);
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
        else if (isPageInviteOk)
        {
            int invitedAdded = 1;
            if (!string.IsNullOrWhiteSpace(payload.Detail))
            {
                var m = System.Text.RegularExpressions.Regex.Match(payload.Detail, @"(\d+)\s*lời mời", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (m.Success && int.TryParse(m.Groups[1].Value, out var parsedCount) && parsedCount >= 0)
                {
                    invitedAdded = parsedCount;
                }
            }
            if (invitedAdded > 0)
            {
                _config.TotalPageFollowerInvitesSent += invitedAdded;
                try { _config.Save(); } catch { }
            }
            AppendLog($"🤝 [Auto-Invite Page] Via '{resolvedViaLabel ?? "Via"}' hoàn tất mời theo dõi Fanpage ({payload.Detail ?? "OK"}). Tổng tích lũy: {_config.TotalPageFollowerInvitesSent} lời mời.");
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (_activeView is AppView.PagesBm or AppView.Automation or AppView.Overview)
                {
                    RenderCurrentView();
                }
            });
        }

        var shouldCloseWindow = (isKeepAliveOk || isPageInviteOk) && _config.AutoCloseKeepAliveWindow;
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

            _currentUser = await _api.GetCurrentUserAsync();
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
                accountsTask, bmsTask, adAccsTask, pagesTask, alertSumTask, alertsTask, cronTask,
                metaConnTask, healthSumTask, healthRowsTask, draftsTask,
                telegramTask, spendSumTask, sessionsTask,
                proxyMapTask, readinessSumTask, readinessBoardTask, auditTask,
                pixelsTask, domainSeoTask, retainersTask, teamSumTask, teamMemTask, teamInvTask, quotaTask,
                playbooksTask, launchAuditTask);

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
            _playbooks = playbooksTask.Result.Count > 0 ? playbooksTask.Result : AutomationPlaybookDto.GetDefaultBuiltinPlaybooks();
            _launchAudits = launchAuditTask.Result;
            _workstationMem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();

            RebuildViaWorkspaceList(accountsTask.Result.Items ?? new());
            ApplySavedPageHolderOverrides();
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
                    Playbooks = _playbooks,
                });
            }
            catch { }

            _isOfflineSnapshotMode = false;
            _isAuthExpired = false;
            SetErrorRetryButtonLabel("Thử lại");
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
            bool is401 = ex.Message.Contains("API 401", StringComparison.OrdinalIgnoreCase)
                      || ex.Message.Contains("expired", StringComparison.OrdinalIgnoreCase)
                      || ex.Message.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase);
            _isAuthExpired = is401;
            SetErrorRetryButtonLabel(is401 ? "Đăng nhập lại (Nhớ 24/7)" : "Thử lại");
            _lastErrorMessage = is401
                ? $"🔑 Phiên đăng nhập Cloud ({_config.UserEmail}) đã hết hạn qua đêm — Đang giữ nguyên {_vias.Count} Via, {_pagesSummary?.Items.Count ?? 0} Page, {_adAccounts.Count} TKQC từ Bản lưu Offline DPAPI ({_offlineSnapshotAt}). Bấm «Đăng nhập lại (Nhớ 24/7)» để tự động duy trì phiên."
                : _isOfflineSnapshotMode
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

    internal static HashSet<string> BuildActiveChromeSlugSet()
    {
        var activeSlugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in ChromeSessionTracker.Default.GetSnapshot().Where(x => x.Alive))
        {
            var viaSlug = ExtensionProvisioner.SanitizeFolderSlug(s.ViaLabel);
            if (!string.IsNullOrEmpty(viaSlug)) activeSlugs.Add(viaSlug);
            var legacySlug = ExtensionProvisioner.SanitizeLegacyFolderSlug(s.ViaLabel);
            if (!string.IsNullOrEmpty(legacySlug)) activeSlugs.Add(legacySlug);
            var profSlug = ExtensionProvisioner.SanitizeFolderSlug(s.ProfileDir);
            if (!string.IsNullOrEmpty(profSlug)) activeSlugs.Add(profSlug);
        }
        return activeSlugs;
    }

    internal (int CleanedFolders, long BytesFreed, WorkstationMemorySnapshot MemAfter) RunCacheAndRamCleanupNow(bool renderAfter = true)
    {
        var activeSlugs = BuildActiveChromeSlugSet();
        var (cleaned, bytes) = WorkstationPerformanceOptimizer.CleanProfileCachesAndTrimMemory(activeSlugs: activeSlugs);
        var mem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        _workstationMem = mem;
        if (renderAfter)
        {
            AppendLog($"🧹 Đã dọn {cleaned} thư mục Cache Chrome ({bytes / (1024.0 * 1024.0):0.0} MB) • RAM trống hiện tại: {mem.AvailablePhysicalMb:N0}/{mem.TotalPhysicalMb:N0} MB.");
            RenderCurrentView();
        }
        return (cleaned, bytes, mem);
    }

    internal void ApplyProxyHealthMapToVias(Dictionary<string, ProxyCheckResultDto>? map)
    {
        _proxyHealthMap = new Dictionary<string, ProxyCheckResultDto>(
            map ?? new Dictionary<string, ProxyCheckResultDto>(),
            StringComparer.OrdinalIgnoreCase);

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
    }

    private async Task LaunchViaQueueItemAsync(QueueTaskItem item)
    {
        try
        {
            var memBefore = await Task.Run(() => WorkstationPerformanceOptimizer.ReadWorkstationMemory());
            if (memBefore.AvailablePhysicalMb < 1200)
            {
                var activeSlugs = BuildActiveChromeSlugSet();
                var (cleaned, bytes) = await Task.Run(() =>
                    WorkstationPerformanceOptimizer.CleanProfileCachesAndTrimMemory(activeSlugs: activeSlugs));
                _workstationMem = await Task.Run(() => WorkstationPerformanceOptimizer.ReadWorkstationMemory());
                AppendLog($"🧹 RAM trống thấp ({memBefore.AvailablePhysicalMb:N0} MB) -> Đã tự dọn {cleaned} cache Chrome ({bytes / (1024.0 * 1024.0):0.0} MB) trước khi mở '{item.ViaLabel}'.");
            }
        }
        catch { }

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
        if (item.TargetUrl.Contains("adsops_auto_invite_followers=1", StringComparison.OrdinalIgnoreCase))
        {
            var matchedPg = (_pagesSummary?.Items ?? new List<FanpageItemDto>())
                .FirstOrDefault(p => !string.IsNullOrWhiteSpace(p.ExternalPageId) && item.TargetUrl.Contains(p.ExternalPageId.Trim(), StringComparison.OrdinalIgnoreCase));
            if (matchedPg != null)
            {
                _ = RunNativeUiAutoInviteForPageAsync(matchedPg, _config.MaxPageFollowerInvitesPerRun);
            }
        }
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
                QueuePhase.Running => s.CheckingProxy ? "Đang test Proxy trước khi mở..." : $"Đang chạy ({Math.Min(s.TotalCount, s.CurrentIndex + 1)}/{s.TotalCount})",
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

    public async Task RunFullAutoPilotPipelineAsync(bool interactiveConfirm = true)
    {
        if (_autoPipelineRunning || _queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
        {
            if (interactiveConfirm)
            {
                MessageBox.Show(this, "Hàng đợi hoặc Chu trình Auto-Pilot đang chạy. Hãy Tạm dừng hoặc đợi hoàn tất.", "Hệ thống đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            return;
        }
        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            if (interactiveConfirm)
            {
                MessageBox.Show(this, "Hãy đăng nhập AdsOps Cloud ở tab Két khóa & Cài đặt trước khi chạy Auto-Pilot.", "Chưa đăng nhập Cloud", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            return;
        }

        if (interactiveConfirm)
        {
            var dueCountPreview = _vias.Count(v => v.NeedsKeepAlive && !v.IsInCooldown && !string.Equals(v.ProxyLastStatus, "DEAD", StringComparison.OrdinalIgnoreCase));
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                "Chu trình Auto-Pilot Khép Kín 5 Bước",
                "Thực thi tuần tự toàn bộ quy trình tự động hóa hằng ngày cho Dàn Via & Fanpage chỉ với 1 chạm.",
                new (string, string)[]
                {
                    ("Bước 1:", "Dọn Cache Chrome không chạy & Giải phóng RAM (< 1.2 GB)"),
                    ("Bước 2:", "Quét Proxy Live/Dead & kiểm tra khớp Múi giờ"),
                    ("Bước 3:", "Chạy Cloud Cron + Đồng bộ Fanpage & TKQC từ Meta"),
                    ("Bước 4:", "Tự động Nuôi bài Fanpage đến hạn (tối đa 10 Page)"),
                    ("Bước 5:", $"Xếp hàng Đảo Ấm tự động các Via quá hạn ({dueCountPreview} Via)"),
                },
                "Có thể Tạm dừng hoặc Dừng hẳn Hàng đợi bất cứ lúc nào sau khi Bước 5 khởi chạy.",
                "Chạy Auto-Pilot 5 Bước");
            if (!ok) return;
        }

        _autoPipelineRunning = true;
        SetBusy(true);
        try
        {
            // Bước 1: Dọn Cache & Thu hồi RAM
            var activeSlugs = BuildActiveChromeSlugSet();
            var (cleaned, bytes) = await Task.Run(() =>
                WorkstationPerformanceOptimizer.CleanProfileCachesAndTrimMemory(activeSlugs: activeSlugs));
            _workstationMem = await Task.Run(() => WorkstationPerformanceOptimizer.ReadWorkstationMemory());
            AppendLog($"🤖 [Auto-Pilot 1/5] Đã dọn {cleaned} thư mục Cache ({bytes / (1024.0 * 1024.0):0.0} MB) • RAM trống: {_workstationMem.AvailablePhysicalMb:N0}/{_workstationMem.TotalPhysicalMb:N0} MB.");

            // Bước 2: Quét Proxy Live/Dead & Múi giờ
            try
            {
                var pxRes = await _api.CheckProxyBatchAsync();
                ApplyProxyHealthMapToVias(pxRes.HealthMap);
                AppendLog($"🤖 [Auto-Pilot 2/5] Quét Proxy xong: {pxRes.LiveCount} Live / {pxRes.DeadCount} Dead (Tổng {pxRes.CheckedCount}).");
            }
            catch (Exception exPx)
            {
                AppendLog($"⚠️ [Auto-Pilot 2/5] Bỏ qua quét Proxy do lỗi mạng: {exPx.Message}");
            }

            // Bước 3: Kích hoạt Cloud Cron + Đồng bộ Fanpage từ Meta
            try
            {
                await _api.RunAutomationCronNowAsync(sync: true, warmup: false);
                var syncPg = await _api.SyncPagesFromMetaAsync();
                AppendLog($"🤖 [Auto-Pilot 3/5] Đã chạy Cloud Cron & Đồng bộ {syncPg.SyncedCount} Fanpage từ Meta (Mới: {syncPg.NewCount}).");
            }
            catch (Exception exCron)
            {
                AppendLog($"⚠️ [Auto-Pilot 3/5] Bỏ qua đồng bộ Meta/Cron: {exCron.Message}");
            }

            // Bước 4: Tự động Nuôi bài Fanpage đến hạn & Mời người tương tác theo dõi Page
            try
            {
                var warmRes = await _api.BatchWarmupPagesAsync(10);
                var inviteHint = _config.AutoInvitePageFollowersOnWarmup
                    ? $" • Auto-Invite Follow: BẬT (Max {_config.MaxPageFollowerInvitesPerRun}/phiên)"
                    : "";
                AppendLog($"🤖 [Auto-Pilot 4/5] Đã nuôi lô tự động {warmRes.NurturedCount} Fanpage (Graph API: {warmRes.GraphPublishedCount}){inviteHint}.");
            }
            catch (Exception exWarm)
            {
                AppendLog($"⚠️ [Auto-Pilot 4/5] Bỏ qua Nuôi lô Fanpage: {exWarm.Message}");
            }

            SetBusy(false);
            await SyncCloudAsync(silent: true);

            // Bước 5: Xếp hàng Đảo Ấm các Via quá hạn có Proxy sống (hoặc Direct)
            _config.LastAutoPipelineDateLocal = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            _config.Save();

            var dueVias = _vias
                .Where(v => v.NeedsKeepAlive && !v.IsInCooldown && !string.Equals(v.ProxyLastStatus, "DEAD", StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (dueVias.Count > 0)
            {
                AppendLog($"🤖 [Auto-Pilot 5/5] Khởi chạy hàng đợi Đảo Ấm an toàn cho {dueVias.Count} Via quá hạn.");
                EnqueueKeepAliveVias(dueVias, "Auto-Pilot 5 Bước • Đảo Ấm Via quá hạn", requireConfirm: false);
            }
            else if (_config.AutoInvitePageFollowersOnWarmup && (_pagesSummary?.Items?.Count ?? 0) > 0)
            {
                AppendLog("🤖 [Auto-Pilot 5/5] Toàn bộ Via đã Đảo Ấm đủ -> Chuyển sang Hàng đợi Tự động Mời người tương tác theo dõi Fanpage.");
                EnqueueBatchPageAutoInviteFollowers(requireConfirm: false);
            }
            else
            {
                AppendLog("🤖 [Auto-Pilot 5/5] Hoàn tất Chu trình 5 Bước! Toàn bộ Via hợp lệ đã Đảo Ấm đủ.");
            }
        }
        finally
        {
            _autoPipelineRunning = false;
            SetBusy(false);
            RefreshHeaderAndSidebar();
            RenderCurrentView();
        }
    }

    internal static string BuildPageAutoInviteUrl(FanpageItemDto page, int maxInvites = 25, bool autoClose = true)
    {
        var clamped = Math.Clamp(maxInvites < 5 ? 25 : maxInvites, 5, 50);
        var closeFlag = autoClose ? "1" : "0";
        var pName = Uri.EscapeDataString(page.Name ?? "Fanpage");
        if (!string.IsNullOrWhiteSpace(page.ExternalPageId))
        {
            var extId = Uri.EscapeDataString(page.ExternalPageId.Trim());
            return $"https://business.facebook.com/latest/home?asset_id={extId}&adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}";
        }
        if (!string.IsNullOrWhiteSpace(page.Url) && page.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            var sep = page.Url.Contains('?') ? "&" : "?";
            return $"{page.Url}{sep}adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}";
        }
        return $"https://business.facebook.com/latest/home?adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}";
    }

    internal void ApplySavedPageHolderOverrides()
    {
        var pages = _pagesSummary?.Items;
        if (pages == null || pages.Count == 0) return;
        _config.PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (_config.PagePendingInviteCounts.Count == 0)
        {
            // Seed initial known reactor count for Matbao-invoice if not yet scanned
            _config.PagePendingInviteCounts["109674987393491"] = 3;
        }
        foreach (var p in pages)
        {
            _ = ResolveEffectiveViaForPage(p);
        }
    }

    internal ViaWorkspaceEntry? ResolveEffectiveViaForPage(FanpageItemDto page)
    {
        if (page == null) return _vias.FirstOrDefault();

        _config.PageHolderViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string? ovRaw = null;
        if (!string.IsNullOrWhiteSpace(page.Id) && _config.PageHolderViaOverrides.TryGetValue(page.Id.Trim(), out var v1))
        {
            ovRaw = v1;
        }
        else if (!string.IsNullOrWhiteSpace(page.ExternalPageId) && _config.PageHolderViaOverrides.TryGetValue(page.ExternalPageId.Trim(), out var v2))
        {
            ovRaw = v2;
        }

        if (!string.IsNullOrWhiteSpace(ovRaw))
        {
            var parts = ovRaw.Split('|');
            var viaId = parts.Length > 0 ? parts[0].Trim() : "";
            var profDir = parts.Length > 1 ? parts[1].Trim() : "";
            var viaLbl = parts.Length > 2 ? parts[2].Trim() : "";

            var matchedVia = _vias.FirstOrDefault(v =>
                (!string.IsNullOrEmpty(viaId) && string.Equals(v.ViaId, viaId, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(profDir) && string.Equals(v.ProfileDir, profDir, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(viaLbl) && string.Equals(v.Label, viaLbl, StringComparison.OrdinalIgnoreCase)));

            if (matchedVia != null)
            {
                page.HolderIdentityId = matchedVia.ViaId;
                page.HolderBrowserProfile = matchedVia.ProfileDir;
                page.HolderLabel = matchedVia.Label;
                return matchedVia;
            }

            if (!string.IsNullOrEmpty(profDir))
            {
                var dispLbl = !string.IsNullOrEmpty(viaLbl) ? viaLbl : $"Chrome ({profDir})";
                page.HolderIdentityId = viaId;
                page.HolderBrowserProfile = profDir;
                page.HolderLabel = dispLbl;
                return new ViaWorkspaceEntry
                {
                    ViaId = string.IsNullOrEmpty(viaId) ? $"profile-{profDir}" : viaId,
                    Label = dispLbl,
                    BrowserProfileLabel = profDir,
                    ProfileDir = profDir,
                    AntidetectEngine = "chrome_native",
                };
            }
        }

        var byHolder = _vias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderIdentityId) && string.Equals(v.ViaId, page.HolderIdentityId.Trim(), StringComparison.OrdinalIgnoreCase))
                       ?? _vias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderBrowserProfile) && string.Equals(v.ProfileDir, ExtensionProvisioner.ResolveProfileDirectory(page.HolderBrowserProfile, page.HolderLabel), StringComparison.OrdinalIgnoreCase))
                       ?? _vias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderLabel) && string.Equals(v.Label, page.HolderLabel.Trim(), StringComparison.OrdinalIgnoreCase))
                       ?? _vias.FirstOrDefault();

        if (byHolder != null)
        {
            page.HolderIdentityId = byHolder.ViaId;
            page.HolderBrowserProfile = byHolder.ProfileDir;
            page.HolderLabel = byHolder.Label;
        }
        return byHolder;
    }

    internal void AssignViaOrProfileToPage(FanpageItemDto page, string selectionTag)
    {
        if (page == null || string.IsNullOrWhiteSpace(selectionTag)) return;
        _config.PageHolderViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        ViaWorkspaceEntry? targetVia = null;
        string savedVal;
        if (selectionTag.StartsWith("via:", StringComparison.OrdinalIgnoreCase))
        {
            var vid = selectionTag[4..].Trim();
            targetVia = _vias.FirstOrDefault(v => string.Equals(v.ViaId, vid, StringComparison.OrdinalIgnoreCase));
            if (targetVia == null) return;
            savedVal = $"{targetVia.ViaId}|{targetVia.ProfileDir}|{targetVia.Label}";
            page.HolderIdentityId = targetVia.ViaId;
            page.HolderBrowserProfile = targetVia.ProfileDir;
            page.HolderLabel = targetVia.Label;
        }
        else if (selectionTag.StartsWith("profile:", StringComparison.OrdinalIgnoreCase))
        {
            var pdir = selectionTag[8..].Trim();
            targetVia = _vias.FirstOrDefault(v => string.Equals(v.ProfileDir, pdir, StringComparison.OrdinalIgnoreCase));
            if (targetVia != null)
            {
                savedVal = $"{targetVia.ViaId}|{targetVia.ProfileDir}|{targetVia.Label}";
                page.HolderIdentityId = targetVia.ViaId;
                page.HolderBrowserProfile = targetVia.ProfileDir;
                page.HolderLabel = targetVia.Label;
            }
            else
            {
                var customLabel = $"Chrome {pdir}";
                savedVal = $"profile-{pdir}|{pdir}|{customLabel}";
                page.HolderIdentityId = $"profile-{pdir}";
                page.HolderBrowserProfile = pdir;
                page.HolderLabel = customLabel;
            }
        }
        else
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(page.Id))
        {
            _config.PageHolderViaOverrides[page.Id.Trim()] = savedVal;
        }
        if (!string.IsNullOrWhiteSpace(page.ExternalPageId))
        {
            _config.PageHolderViaOverrides[page.ExternalPageId.Trim()] = savedVal;
        }
        _config.Save();
        AppendLog($"🎯 Đã gắn cố định Fanpage '{page.Name}' vào trình duyệt '{page.HolderLabel} ({page.HolderBrowserProfile})'.");
    }

    internal ViaWorkspaceEntry? ResolveEffectiveViaForAdAccount(AdAccountItemDto a)
    {
        if (a == null) return _vias.FirstOrDefault();
        _config.AdAccountViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(a.Id) && _config.AdAccountViaOverrides.TryGetValue(a.Id.Trim(), out var ov) && !string.IsNullOrWhiteSpace(ov))
        {
            var parts = ov.Split('|');
            var vid = parts.Length > 0 ? parts[0].Trim() : "";
            var pdir = parts.Length > 1 ? parts[1].Trim() : "";
            var matchedOv = _vias.FirstOrDefault(v =>
                (!string.IsNullOrEmpty(vid) && string.Equals(v.ViaId, vid, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(pdir) && string.Equals(v.ProfileDir, pdir, StringComparison.OrdinalIgnoreCase)));
            if (matchedOv != null) return matchedOv;
        }

        foreach (var ident in a.FacebookIdentities)
        {
            var m = _vias.FirstOrDefault(v =>
                (!string.IsNullOrWhiteSpace(ident.Id) && string.Equals(v.ViaId, ident.Id.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(ident.Label) && string.Equals(v.Label, ident.Label.Trim(), StringComparison.OrdinalIgnoreCase)));
            if (m != null) return m;
        }
        return _vias.FirstOrDefault();
    }

    internal int? GetPagePendingInviteCount(FanpageItemDto? page)
    {
        if (page == null) return null;
        _config.PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(page.Id) && _config.PagePendingInviteCounts.TryGetValue(page.Id.Trim(), out var c1))
        {
            return c1;
        }
        if (!string.IsNullOrWhiteSpace(page.ExternalPageId) && _config.PagePendingInviteCounts.TryGetValue(page.ExternalPageId.Trim(), out var c2))
        {
            return c2;
        }
        return null;
    }

    internal void SetPagePendingInviteCount(FanpageItemDto? page, int count, bool renderNow = false)
    {
        if (page == null) return;
        var clamped = Math.Max(0, count);
        _config.PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(page.Id))
        {
            _config.PagePendingInviteCounts[page.Id.Trim()] = clamped;
        }
        if (!string.IsNullOrWhiteSpace(page.ExternalPageId))
        {
            _config.PagePendingInviteCounts[page.ExternalPageId.Trim()] = clamped;
        }
        try { _config.Save(); } catch { }
        if (renderNow)
        {
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (_activeView is AppView.PagesBm or AppView.Overview or AppView.Automation)
                {
                    RenderCurrentView();
                }
            });
        }
    }

    // Win32 & UIAutomation helpers for Native Browser Auto-Invite (works on any Chrome 158+ window even without Extension!)
    private delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

    private const uint WM_GETOBJECT = 0x003D;
    private const int OBJID_CLIENT = unchecked((int)0xFFFFFFFC);
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    private static void ClickScreenPoint(int x, int y)
    {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(60);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(45);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    private static IntPtr FindActiveMetaBusinessSuiteChromeWindow()
    {
        IntPtr bestMetaHwnd = IntPtr.Zero;
        IntPtr anyChromeHwnd = IntPtr.Zero;

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            var cls = new System.Text.StringBuilder(128);
            GetClassName(hWnd, cls, 128);
            if (!string.Equals(cls.ToString(), "Chrome_WidgetWin_1", StringComparison.Ordinal)) return true;

            var tb = new System.Text.StringBuilder(512);
            GetWindowText(hWnd, tb, 512);
            var title = tb.ToString();
            if (string.IsNullOrWhiteSpace(title) || title.Contains("AdsOps Desktop Pro", StringComparison.OrdinalIgnoreCase)) return true;

            if (anyChromeHwnd == IntPtr.Zero) anyChromeHwnd = hWnd;
            if (title.Contains("Meta Business Suite", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Business Suite", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Facebook", StringComparison.OrdinalIgnoreCase))
            {
                bestMetaHwnd = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        var target = bestMetaHwnd != IntPtr.Zero ? bestMetaHwnd : anyChromeHwnd;
        if (target != IntPtr.Zero)
        {
            // Wake up Chrome renderer accessibility tree immediately via WM_GETOBJECT (OBJID_CLIENT)
            EnumChildWindows(target, (child, _) =>
            {
                var ccls = new System.Text.StringBuilder(128);
                GetClassName(child, ccls, 128);
                if (ccls.ToString().Contains("Chrome_RenderWidgetHostHWND", StringComparison.OrdinalIgnoreCase))
                {
                    SendMessageTimeout(child, WM_GETOBJECT, IntPtr.Zero, new IntPtr(OBJID_CLIENT), 2, 250, out IntPtr _);
                }
                return true;
            }, IntPtr.Zero);
        }
        return target;
    }

    private async Task RunNativeUiAutoInviteForPageAsync(FanpageItemDto page, int maxInvites)
    {
        await Task.Delay(3800).ConfigureAwait(false);
        int detectedCount = -1;
        bool modalOpened = false;
        int invitedClicks = 0;

        for (int attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                var completed = await Task.Run(() =>
                {
                    var hwnd = FindActiveMetaBusinessSuiteChromeWindow();
                    if (hwnd == IntPtr.Zero) return false;

                    var root = AutomationElement.FromHandle(hwnd);
                    if (root == null) return false;

                    var all = root.FindAll(TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition);
                    if (all == null || all.Count == 0) return false;

                    var elements = new List<(AutomationElement El, string Name, ControlType Type, Rect Bounds)>(all.Count);
                    foreach (AutomationElement el in all)
                    {
                        try
                        {
                            var nm = (el.Current.Name ?? "").Trim();
                            if (string.IsNullOrEmpty(nm) && el.Current.ControlType != ControlType.CheckBox) continue;
                            var b = el.Current.BoundingRectangle;
                            if (double.IsInfinity(b.Width) || double.IsInfinity(b.Height) || b.Width <= 2 || b.Height <= 2) continue;
                            elements.Add((el, nm, el.Current.ControlType, b));
                        }
                        catch { }
                    }

                    // If modal is already open, look for CheckBoxes or "Mời" / "Gửi lời mời" inside modal
                    if (modalOpened)
                    {
                        var checkBoxes = elements
                            .Where(x => x.Type == ControlType.CheckBox && x.Bounds.Width >= 8 && x.Bounds.Height >= 8)
                            .ToList();

                        if (checkBoxes.Count > 0 && invitedClicks == 0)
                        {
                            SetForegroundWindow(hwnd);
                            int toCheck = Math.Min(maxInvites, checkBoxes.Count);
                            for (int i = 0; i < toCheck; i++)
                            {
                                var cb = checkBoxes[i];
                                bool toggled = false;
                                try
                                {
                                    if (cb.El.TryGetCurrentPattern(TogglePattern.Pattern, out var tpObj) && tpObj is TogglePattern tp)
                                    {
                                        if (tp.Current.ToggleState == ToggleState.Off)
                                        {
                                            tp.Toggle();
                                            toggled = true;
                                        }
                                    }
                                }
                                catch { }
                                if (!toggled)
                                {
                                    ClickScreenPoint((int)(cb.Bounds.Left + cb.Bounds.Width / 2), (int)(cb.Bounds.Top + cb.Bounds.Height / 2));
                                }
                                System.Threading.Thread.Sleep(350);
                            }
                            invitedClicks = toCheck;
                            System.Threading.Thread.Sleep(700);
                        }

                        // Find individual "Mời" / "Invite" buttons or final "Gửi lời mời" button inside dialog
                        var singleInviteBtns = elements.Where(x =>
                            (x.Type == ControlType.Button || x.Type == ControlType.Custom || x.Type == ControlType.Text) &&
                            (string.Equals(x.Name, "Mời", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(x.Name, "Invite", StringComparison.OrdinalIgnoreCase))).ToList();

                        if (singleInviteBtns.Count > 0)
                        {
                            SetForegroundWindow(hwnd);
                            int toClick = Math.Min(maxInvites, singleInviteBtns.Count);
                            for (int i = 0; i < toClick; i++)
                            {
                                var b = singleInviteBtns[i];
                                try
                                {
                                    if (b.El.TryGetCurrentPattern(InvokePattern.Pattern, out var ipObj) && ipObj is InvokePattern ip)
                                    {
                                        ip.Invoke();
                                    }
                                    else
                                    {
                                        ClickScreenPoint((int)(b.Bounds.Left + b.Bounds.Width / 2), (int)(b.Bounds.Top + b.Bounds.Height / 2));
                                    }
                                }
                                catch
                                {
                                    ClickScreenPoint((int)(b.Bounds.Left + b.Bounds.Width / 2), (int)(b.Bounds.Top + b.Bounds.Height / 2));
                                }
                                invitedClicks++;
                                System.Threading.Thread.Sleep(2400);
                            }
                            return true;
                        }

                        var confirmSendBtns = elements.Where(x =>
                            (x.Type == ControlType.Button || x.Type == ControlType.Custom) &&
                            (x.Name.StartsWith("Gửi lời mời", StringComparison.OrdinalIgnoreCase) ||
                             x.Name.StartsWith("Send invitation", StringComparison.OrdinalIgnoreCase) ||
                             x.Name.StartsWith("Send invite", StringComparison.OrdinalIgnoreCase)))
                            .OrderByDescending(x => x.Bounds.Top)
                            .ToList();

                        if (confirmSendBtns.Count > 0 && invitedClicks > 0)
                        {
                            var finalBtn = confirmSendBtns[0];
                            SetForegroundWindow(hwnd);
                            try
                            {
                                if (finalBtn.El.TryGetCurrentPattern(InvokePattern.Pattern, out var ipObj) && ipObj is InvokePattern ip)
                                {
                                    ip.Invoke();
                                }
                                else
                                {
                                    ClickScreenPoint((int)(finalBtn.Bounds.Left + finalBtn.Bounds.Width / 2), (int)(finalBtn.Bounds.Top + finalBtn.Bounds.Height / 2));
                                }
                            }
                            catch
                            {
                                ClickScreenPoint((int)(finalBtn.Bounds.Left + finalBtn.Bounds.Width / 2), (int)(finalBtn.Bounds.Top + finalBtn.Bounds.Height / 2));
                            }
                            return true;
                        }
                    }

                    // Step 1: Locate "Tiếp cận những người đã bày tỏ cảm xúc với nội dung của bạn"
                    var anchor = elements.FirstOrDefault(x =>
                        x.Name.Contains("Tiếp cận những người đã bày tỏ cảm xúc", StringComparison.OrdinalIgnoreCase) ||
                        x.Name.Contains("Reach people who reacted to your content", StringComparison.OrdinalIgnoreCase) ||
                        x.Name.Contains("bày tỏ cảm xúc và bình luận về nội dung", StringComparison.OrdinalIgnoreCase));

                    if (anchor.El == null)
                    {
                        if (attempt >= 2)
                        {
                            // Scroll down slightly in case "Phát triển đối tượng" is below the fold
                            var winRect = root.Current.BoundingRectangle;
                            if (!double.IsInfinity(winRect.Width) && winRect.Width > 300)
                            {
                                SetForegroundWindow(hwnd);
                                SetCursorPos((int)(winRect.Left + winRect.Width * 0.55), (int)(winRect.Top + winRect.Height * 0.55));
                                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)-420), UIntPtr.Zero);
                            }
                        }
                        return false;
                    }

                    // Step 2: Read pending reactor count number (e.g. "3") near anchor
                    var numCandidate = elements.FirstOrDefault(x =>
                        int.TryParse(x.Name, out var n) && n >= 0 && n <= 9999 &&
                        x.Bounds.Top >= anchor.Bounds.Top - 10 &&
                        x.Bounds.Top <= anchor.Bounds.Bottom + 150 &&
                        Math.Abs(x.Bounds.Left - anchor.Bounds.Left) <= 260);

                    if (numCandidate.El != null && int.TryParse(numCandidate.Name, out var parsedNum))
                    {
                        if (detectedCount != parsedNum)
                        {
                            detectedCount = parsedNum;
                            SetPagePendingInviteCount(page, parsedNum, renderNow: true);
                            _ = Dispatcher.BeginInvoke(() =>
                                AppendLog($"🔍 [Auto-Invite] Fanpage '{page.Name}' hiện có {parsedNum} người bày tỏ cảm xúc cần mời theo dõi!"));
                        }
                        if (parsedNum == 0)
                        {
                            return true;
                        }
                    }

                    // Step 3: Find "Gửi lời mời" button aligned with the reactor section
                    if (!modalOpened)
                    {
                        var sendBtn = elements
                            .Where(x =>
                                (string.Equals(x.Name, "Gửi lời mời", StringComparison.OrdinalIgnoreCase) ||
                                 string.Equals(x.Name, "Send invitations", StringComparison.OrdinalIgnoreCase) ||
                                 string.Equals(x.Name, "Send invite", StringComparison.OrdinalIgnoreCase)) &&
                                x.Bounds.Top >= anchor.Bounds.Top - 35 &&
                                x.Bounds.Top <= anchor.Bounds.Bottom + 140)
                            .OrderBy(x => Math.Abs(x.Bounds.Top - anchor.Bounds.Top))
                            .FirstOrDefault();

                        if (sendBtn.El != null)
                        {
                            SetForegroundWindow(hwnd);
                            try
                            {
                                if (sendBtn.El.TryGetCurrentPattern(InvokePattern.Pattern, out var ipObj) && ipObj is InvokePattern ip)
                                {
                                    ip.Invoke();
                                }
                            }
                            catch { }
                            ClickScreenPoint((int)(sendBtn.Bounds.Left + sendBtn.Bounds.Width / 2), (int)(sendBtn.Bounds.Top + sendBtn.Bounds.Height / 2));
                            modalOpened = true;
                            _ = Dispatcher.BeginInvoke(() =>
                                AppendLog($"🤖 [Auto-Invite] Đã tự động nhấn nút 'Gửi lời mời' trên Meta Business Suite cho Page '{page.Name}'..."));
                        }
                    }

                    return false;
                }).ConfigureAwait(false);

                if (completed)
                {
                    var sentNow = invitedClicks > 0 ? invitedClicks : Math.Max(0, detectedCount);
                    if (sentNow > 0)
                    {
                        _config.TotalPageFollowerInvitesSent += sentNow;
                        SetPagePendingInviteCount(page, 0, renderNow: true);
                        _ = Dispatcher.BeginInvoke(() =>
                            AppendLog($"✅ [Auto-Invite Hoàn tất] Đã tự động mời {sentNow} người tương tác theo dõi Fanpage '{page.Name}'! (Còn cần mời: 0)"));
                    }
                    else
                    {
                        SetPagePendingInviteCount(page, 0, renderNow: true);
                        _ = Dispatcher.BeginInvoke(() =>
                            AppendLog($"✓ [Auto-Invite] Fanpage '{page.Name}' hiện có 0 người mới cần mời theo dõi."));
                    }
                    return;
                }
            }
            catch { }

            await Task.Delay(2500).ConfigureAwait(false);
        }
    }

    public void LaunchPageAutoInviteFollowers(FanpageItemDto page, bool autoClose = false)
    {
        var via = ResolveEffectiveViaForPage(page);
        if (via == null)
        {
            MessageBox.Show(this, "Chưa có Via nào trong danh sách để mở Meta Business Suite cho Fanpage này.", "Thiếu Via cầm Page", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var targetUrl = BuildPageAutoInviteUrl(page, _config.MaxPageFollowerInvitesPerRun, autoClose);
        AppendLog($"🤝 Khởi chạy Auto-Invite Followers cho Page '{page.Name}' qua '{via.Label}' (Chrome: {via.ProfileDir}) — Đang tự động quét số người cần mời & bấm 'Gửi lời mời'...");
        LaunchViaChromeSafe(via, targetUrl);
        _ = RunNativeUiAutoInviteForPageAsync(page, _config.MaxPageFollowerInvitesPerRun);
    }

    public void EnqueueBatchPageAutoInviteFollowers(bool requireConfirm = true)
    {
        if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused)
        {
            if (requireConfirm)
            {
                MessageBox.Show(this, "Hàng đợi đang chạy dở. Hãy Tạm dừng hoặc Dừng hẳn trước khi xếp lô Mời theo dõi Fanpage.", "Hàng đợi đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            return;
        }

        var pages = (_pagesSummary?.Items ?? new List<FanpageItemDto>())
            .Where(p => !p.IsUnsyncedDraft && p.HealthStatus.Equals("LIVE", StringComparison.OrdinalIgnoreCase) && p.SoakRemainingHours <= 0)
            .Take(10)
            .ToList();

        if (pages.Count == 0)
        {
            if (requireConfirm)
            {
                MessageBox.Show(this, "Chưa có Fanpage LIVE (đã qua thời gian ngâm) để chạy lô Mời người tương tác theo dõi.", "Thông báo", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            return;
        }

        if (requireConfirm)
        {
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                "Tự động Mời người tương tác theo dõi Fanpage (Lô)",
                "Mở Meta Business Suite từng Fanpage theo đúng Chrome Profile / Via đã gắn cho Page đó và tự động bấm 'Gửi lời mời'.",
                new (string, string)[]
                {
                    ("Số Fanpage hợp lệ:", $"{pages.Count} Page LIVE"),
                    ("Giới hạn an toàn:", $"Tối đa {_config.MaxPageFollowerInvitesPerRun} lời mời / Page / phiên (Jitter 3.2s - 6.2s)"),
                    ("Cơ chế bảo vệ:", "Mở đúng Chrome Profile của từng Page • Tự đóng tab khi gửi xong"),
                },
                "Extension v2.10.0 tự động nhận diện nút 'Gửi lời mời' trong mục 'Tiếp cận những người đã bày tỏ cảm xúc với nội dung của bạn'.",
                "Khởi chạy Auto-Invite");
            if (!ok) return;
        }

        var tasks = new List<QueueTaskItem>();
        foreach (var p in pages)
        {
            var via = ResolveEffectiveViaForPage(p);
            if (via == null || via.IsInCooldown) continue;
            var url = BuildPageAutoInviteUrl(p, _config.MaxPageFollowerInvitesPerRun, autoClose: _config.AutoCloseKeepAliveTab);
            tasks.Add(new QueueTaskItem(
                via.ViaId,
                via.Label,
                GetEffectiveBatchProfileKey(via, via.ProfileDir),
                via.NetworkLabel,
                url,
                $"Auto-Invite Follow: {p.Name}",
                via.BackendTier,
                via.ClientGroup,
                via.IsInSoakQuarantine,
                via.CooldownUntilUtc,
                via.HasSiloConflict,
                via.SiloConflictDetail));
        }

        if (tasks.Count == 0)
        {
            AppendLog("⚠️ Không có Via hợp lệ (không bị Cooldown) để chạy lô Auto-Invite Fanpage.");
            return;
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

        AppendLog($"🤝 Đã xếp hàng {tasks.Count} Fanpage vào Hàng đợi Tự động Mời người tương tác theo dõi.");
        RenderCurrentView();
    }

    internal async Task AcknowledgeAllOpenAlertsAsync()
    {
        var openAlerts = _alerts.Where(a => a.Status.Equals("open", StringComparison.OrdinalIgnoreCase)).ToList();
        if (openAlerts.Count == 0) return;

        var ok = UiComponents.ShowConfirmActionDialog(
            this,
            "Ghi nhận tất cả Cảnh báo đang mở",
            $"Đánh dấu 'Đã ghi nhận' cho toàn bộ {openAlerts.Count} cảnh báo hệ thống hiện tại?",
            new (string, string)[]
            {
                ("Số cảnh báo mở:", $"{openAlerts.Count} cảnh báo"),
                ("Trạng thái mới:", "Đã ghi nhận (Acknowledged) trên Cloud"),
            },
            "Bạn vẫn có thể xem lại hoặc xử lý từng tài khoản sau khi ghi nhận.");
        if (!ok) return;

        SetBusy(true);
        int done = 0;
        try
        {
            foreach (var al in openAlerts)
            {
                try
                {
                    await _api.AcknowledgeAlertAsync(al.Id, "Ghi nhận hàng loạt từ AdsOps Desktop Pro");
                    done++;
                }
                catch { }
            }
            AppendLog($"✓ Đã ghi nhận hàng loạt {done}/{openAlerts.Count} cảnh báo.");
            await SyncCloudAsync(silent: false);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task RunAutoKeepAliveTickAsync()
    {
        if (string.IsNullOrWhiteSpace(_config.GetJwt())) return;
        if (_isOfflineSnapshotMode || _isAuthExpired || _autoPipelineRunning) return;
        if (_queue.Current.Phase != QueuePhase.Idle && _queue.Current.Phase != QueuePhase.Completed) return;

        var now = DateTime.Now;
        if (now.Hour < _config.AutoKeepAliveStartHour || now.Hour >= _config.AutoKeepAliveEndHour) return;

        if (_config.AutoDailyFullPipeline)
        {
            var todayKey = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (!string.Equals(_config.LastAutoPipelineDateLocal, todayKey, StringComparison.Ordinal))
            {
                AppendLog($"🤖 Auto-Pilot Hằng Ngày ({todayKey}) đến lịch -> Khởi chạy Chu trình Khép Kín 5 Bước...");
                await RunFullAutoPilotPipelineAsync(interactiveConfirm: false);
                return;
            }
        }

        if (!_config.AutoKeepAliveScheduler) return;
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
        var nextPalette = ThemeTokens.CurrentPalette == "emerald" ? "obsidian" : "emerald";
        var paletteLabel = ThemeTokens.CurrentPalette == "emerald" ? "🎨 Emerald Vault" : "🎨 Linear Obsidian";
        var themeBtn = UiComponents.CreateButton(paletteLabel, ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            _config.UiThemePalette = nextPalette;
            _config.Save();
            ThemeTokens.ApplyPalette(nextPalette);
            Background = ThemeTokens.BgCanvas;
            Foreground = ThemeTokens.TextPrimary;
            _navButtons.Clear();
            _navBadges.Clear();
            BuildShellLayout();
            UpdateNavStyles();
            RefreshHeaderAndSidebar();
            RenderCurrentView();
            AppendLog($"🎨 Đã chuyển giao diện UI/UX Pro Max sang chủ đề '{(nextPalette == "emerald" ? "Emerald Cyber-Vault" : "Linear Obsidian")}'.");
        }, tooltip: "Chuyển đổi chủ đề màu UI/UX Pro Max (Linear Obsidian <-> Emerald Cyber-Vault)");
        themeBtn.Margin = new Thickness(0, 0, 8, 0);
        _headerActionsPanel.Children.Add(themeBtn);

        var cmdBtn = UiComponents.CreateButton("⌘K Lệnh nhanh", ButtonVariant.Secondary, FluentIcons.Lightning, onClick: (_, _) => OpenCommandPaletteDialog(), tooltip: "Bảng tìm nhanh Via / Copy 2FA / Điều hướng (Ctrl+K hoặc Ctrl+P)");
        cmdBtn.Margin = new Thickness(0, 0, 8, 0);
        _headerActionsPanel.Children.Add(cmdBtn);

        var syncBtn = UiComponents.CreateButton("Đồng bộ", ButtonVariant.Secondary, FluentIcons.Sync, onClick: async (_, _) => await SyncCloudAsync(silent: false), tooltip: "Đồng bộ dữ liệu từ AdsOps Cloud (F5)");
        syncBtn.IsEnabled = !_isBusy;
        syncBtn.Margin = new Thickness(0, 0, isLoggedIn ? 8 : 0, 0);
        _headerActionsPanel.Children.Add(syncBtn);

        if (isLoggedIn)
        {
            var autoPilotHdrBtn = UiComponents.CreateButton("⚡ Auto-Pilot 5 Bước", ButtonVariant.Primary, FluentIcons.Lightning, onClick: async (_, _) => await RunFullAutoPilotPipelineAsync(interactiveConfirm: true), tooltip: "Chạy tuần tự 5 bước: Dọn Cache/RAM -> Quét Proxy -> Đồng bộ Meta -> Nuôi Page/Mời Follow -> Đảo Ấm Via");
            _headerActionsPanel.Children.Add(autoPilotHdrBtn);
        }
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
