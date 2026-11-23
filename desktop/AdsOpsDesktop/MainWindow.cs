using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
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
    private bool _updateRequired;
    private string _minSupportedVersion = "";
    private DateTime _lastAutoUpdateCheckUtc = DateTime.MinValue;
    private string _portableBackupStatusMessage = "";
    private string _portableBackupPreviewJson = "";

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
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTimeOffset> _extHeartbeatByVia = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _keepAliveFailedVias = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _activeRunnersCts;
    private string _liveActionProgressDetail = "";
    private DateTimeOffset _liveActionProgressAt = DateTimeOffset.MinValue;
    private string _flowDesignerSelectedViaId = "__first__";

    // Hybrid shadcn/ui WebView2 Full App Shell host (with WPF fallback)
    private Border? _overviewWebViewHost;
    private Microsoft.Web.WebView2.Wpf.WebView2? _overviewWebView;
    private Grid? _legacyWpfShellRoot;
    private bool _overviewWebViewReady;
    private bool _overviewWebViewInitializing;
    private bool _overviewWebViewInitStarted;
    private bool _overviewWebViewFailed;
    private int _webUiConfigRev = 1;
    private string _copiedTotpViaId = "";
    private string _authErrorMessage = "";
    private string _authSuccessMessage = "";
    private string _telegramStatusMessage = "";
    private bool _telegramStatusOk = true;
    private List<TelegramDetectedChatDto> _detectedTelegramChats = new();

    // Live Step-by-Step Runner Monitor state (updated every 1s)
    private bool _liveRunnerActive;
    private bool _liveRunnerPaused;
    private bool _liveRunnerCompleted;
    private bool _skipCurrentRunnerStepRequested;
    private string _liveRunnerViaId = "";
    private string _liveRunnerViaLabel = "";
    private string _liveRunnerProfileDir = "";
    private string _liveRunnerEngineMode = "0% chiếm chuột • Chạy ngầm";
    private int _liveRunnerCurrentStepIdx;
    private int _liveRunnerTotalSteps;
    private string _liveRunnerCurrentStepTitle = "";
    private int _liveRunnerStepDurationSec = 12;
    private DateTime _liveRunnerStartedAtUtc = DateTime.MinValue;
    private DateTime _liveRunnerStepStartedAtUtc = DateTime.MinValue;
    private int _liveRunnerFinishedTotalSec;
    private readonly List<WebLiveRunnerStepDto> _liveRunnerSteps = new();

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
            getActiveBrowserCount: () => ChromeSessionTracker.Default.GetActiveAutomationBrowserCount() + (_liveRunnerActive ? 1 : 0));
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

        _legacyWpfShellRoot = root;
        Content = !_overviewWebViewFailed ? EnsureOverviewWebViewHost() : root;
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
        try
        {
            await OnWindowLoadedAsync();
        }
        catch (Exception ex)
        {
            AppendLog($"LỖI KHỞI ĐỘNG: {ex}");
            var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AdsOpsDesktop", "runtime.log");
            try { File.AppendAllText(logPath, $"[{DateTime.UtcNow:O}] EnsureStartedAsync EXCEPTION: {ex}\n"); } catch { }
        }
    }

    private async Task OnWindowLoadedAsync()
    {
        AppendLog($"Khởi động AdsOps Desktop Pro v{DesktopAppInfo.Version} (Unified shadcn/ui App Shell + DPAPI Vault + Local TOTP + Retainers/Team).");
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
            await SyncCloudAsync(silent: cached != null);
            try { ProvisionAllViaExtensions(silent: true); } catch { }
        }
        else
        {
            AppendLog("Chưa đăng nhập Cloud. Mở mục Két khóa & Cài đặt để kết nối tài khoản.");
        }

        // Silent startup update check (after 8s delay so UI loads instantaneously)
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(8)).ConfigureAwait(false);
                await Dispatcher.InvokeAsync(async () => await CheckForAppUpdatesAsync(silent: true));
            }
            catch { }
        });
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
        var instId = _config.GetOrCreateInstallationId();
        _api.Configure(_config.BackendBaseUrl, _config.GetJwt(), TryAutoReloginAsync, instId);
    }

    internal bool IsLicenseReadOnly(out string message)
    {
        var lic = _communityQuota?.License ?? _currentUser?.Workspace?.License;
        if (lic != null && lic.IsReadOnly)
        {
            message = "Workspace đang ở chế độ Chỉ-đọc do quá hạn ân hạn 3 ngày. Bạn vẫn xem được dữ liệu, mở Chrome Profile, lấy 2FA và Sao lưu/Khôi phục Két; hãy nhập Mã gia hạn tại Két khóa & Cài đặt để mở khóa Auto-Pilot & Đồng bộ.";
            return true;
        }
        message = "";
        return false;
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
                OnBridgeBenchmarkEnginesAsync,
                onRestoreWindow: () => Dispatcher.BeginInvoke(RestoreFromTray));
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

    public static (bool Allowed, string DenyReason) EvaluateDesktopViaRoleGuardrail(
        string? roleTier,
        bool isInSoakQuarantine,
        bool enforceSoakQuarantine,
        string? targetUrl,
        string? overrideGrant)
    {
        if (!string.IsNullOrWhiteSpace(overrideGrant) &&
            overrideGrant.Trim().StartsWith("vgo1.", StringComparison.Ordinal))
        {
            return (true, string.Empty);
        }

        var url = (targetUrl ?? string.Empty).Trim().ToLowerInvariant();
        var isKeepalive = url.Contains("adsops_keepalive_session=1", StringComparison.Ordinal);

        if (isInSoakQuarantine && enforceSoakQuarantine)
        {
            if (url.Contains("adsmanager.facebook.com", StringComparison.Ordinal) ||
                (url.Contains("business.facebook.com", StringComparison.Ordinal) && !isKeepalive) ||
                url.Contains("accountscenter.facebook.com/password_and_security", StringComparison.Ordinal))
            {
                return (false, "Via đang trong giai đoạn Ngâm 72h Vàng (cách ly trình duyệt mới) — bị khóa mở Ads Manager / BM / Bảo mật để tránh Checkpoint.");
            }
        }

        if (string.Equals((roleTier ?? string.Empty).Trim(), "vault", StringComparison.OrdinalIgnoreCase) &&
            url.Contains("adsmanager.facebook.com", StringComparison.Ordinal))
        {
            return (false, "Via Lớp 1 (Hold BM / Kho tài sản) bị khóa truy cập Trình quản lý Quảng cáo để chống chết liên đới BM & Fanpage gốc.");
        }

        return (true, string.Empty);
    }

    private static string AppendGuardrailOverrideQuery(string targetUrl)
    {
        if (string.IsNullOrWhiteSpace(targetUrl) ||
            targetUrl.Contains("adsops_guard_override=1", StringComparison.OrdinalIgnoreCase))
        {
            return targetUrl;
        }
        return targetUrl.Contains('?')
            ? $"{targetUrl}&adsops_guard_override=1"
            : $"{targetUrl}?adsops_guard_override=1";
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
                    var effectiveTier = !string.IsNullOrWhiteSpace(match.ViaTier) ? match.ViaTier : req.ViaTier;
                    var effectiveSoak = match.IsInSoakQuarantine || (req.Soak72h == true);
                    var (guardOk, guardDeny) = EvaluateDesktopViaRoleGuardrail(
                        effectiveTier,
                        effectiveSoak,
                        _config.EnforceSoakQuarantine,
                        url,
                        req.OverrideGrant);
                    if (!guardOk)
                    {
                        AppendLog($"[Khiên Vai Trò] Đã chặn mở URL rủi ro cho Via '{match.Label}': {guardDeny}");
                        tcs.TrySetResult((false, guardDeny));
                        return;
                    }
                    if (!string.IsNullOrWhiteSpace(req.OverrideGrant) && req.OverrideGrant.Trim().StartsWith("vgo1.", StringComparison.Ordinal))
                    {
                        url = AppendGuardrailOverrideQuery(url);
                        AppendLog($"[Khiên Vai Trò] Owner ngoại lệ 15p từ Web cho Via '{match.Label}'.");
                    }
                    LaunchViaChromeSafe(match, url, req.OverrideGrant, interactivePrompt: false);
                    tcs.TrySetResult((true, $"Đã mở {AntidetectBrowserConnector.GetDisplayName(match.AntidetectEngine)} cho Via '{match.Label}'."));
                    return;
                }

                var (tempGuardOk, tempGuardDeny) = EvaluateDesktopViaRoleGuardrail(
                    req.ViaTier,
                    req.Soak72h == true,
                    _config.EnforceSoakQuarantine,
                    url,
                    req.OverrideGrant);
                if (!tempGuardOk)
                {
                    AppendLog($"[Khiên Vai Trò] Đã chặn cầu nối mở URL rủi ro ({req.Name ?? req.Profile}): {tempGuardDeny}");
                    tcs.TrySetResult((false, tempGuardDeny));
                    return;
                }
                if (!string.IsNullOrWhiteSpace(req.OverrideGrant) && req.OverrideGrant.Trim().StartsWith("vgo1.", StringComparison.Ordinal))
                {
                    url = AppendGuardrailOverrideQuery(url);
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
                    ViaTier = string.IsNullOrWhiteSpace(req.ViaTier) ? "camp" : req.ViaTier!.Trim(),
                    IsInSoakQuarantine = req.Soak72h == true,
                };
                _ = LaunchViaBrowserAsync(tempVia, url, interactiveAlerts: false);
                var dispTarget = eng != "chrome_native" && !string.IsNullOrWhiteSpace(adId)
                    ? $"{AntidetectBrowserConnector.GetDisplayName(eng)} #{adId}"
                    : $"Chrome '{fallbackProfile}'";
                tcs.TrySetResult((true, $"Đã gửi lệnh mở {dispTarget}."));
                return;
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
        var isPendingInvitesCount = string.Equals(evType, "PAGE_PENDING_INVITES_COUNT", StringComparison.OrdinalIgnoreCase);
        var isSafetyFreeze = evType is "IP_LEAK_BLOCKED" or "SAFETY_CHALLENGE";

        ViaWorkspaceEntry? matched = null;
        matched = _vias.FirstOrDefault(v =>
            (!string.IsNullOrWhiteSpace(payload.ViaId) && string.Equals(v.ViaId, payload.ViaId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(payload.BrowserProfile) && string.Equals(v.ProfileDir, payload.BrowserProfile.Trim(), StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(payload.ViaLabel) && string.Equals(v.Label, payload.ViaLabel.Trim(), StringComparison.OrdinalIgnoreCase)));

        var resolvedViaId = !string.IsNullOrWhiteSpace(payload.ViaId) ? payload.ViaId : matched?.ViaId;
        var resolvedViaLabel = !string.IsNullOrWhiteSpace(payload.ViaLabel) ? payload.ViaLabel : matched?.Label;

        if (!string.Equals(payload.Source, "native_runner", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrWhiteSpace(resolvedViaId)) _extHeartbeatByVia[resolvedViaId.Trim()] = DateTimeOffset.UtcNow;
            if (!string.IsNullOrWhiteSpace(resolvedViaLabel)) _extHeartbeatByVia[resolvedViaLabel.Trim()] = DateTimeOffset.UtcNow;
        }

        if (isSafetyFreeze)
        {
            if (!string.IsNullOrWhiteSpace(resolvedViaId))
            {
                lock (_keepAliveFailedVias) _keepAliveFailedVias.Add(resolvedViaId.Trim());
            }
            _liveRunnerActive = false;
            _liveRunnerPaused = false;
            _queue.MarkItemCompleted(resolvedViaId, resolvedViaLabel);

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
                if (!_overviewWebViewFailed || _activeView is AppView.Vias or AppView.Overview or AppView.Automation)
                {
                    RenderCurrentView();
                }
            });
        }
        else if (string.Equals(evType, "COOKIE_LOGGED_OUT", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrWhiteSpace(resolvedViaId))
            {
                lock (_keepAliveFailedVias) _keepAliveFailedVias.Add(resolvedViaId.Trim());
            }
            _liveRunnerActive = false;
            _liveRunnerPaused = false;
            _queue.MarkItemCompleted(resolvedViaId, resolvedViaLabel);
            _liveActionProgressDetail = $"Via: {resolvedViaLabel ?? "Via"} • ⚠️ Chưa đăng nhập FB (đã giữ cửa sổ để đăng nhập)";
            _liveActionProgressAt = DateTimeOffset.UtcNow;
            AppendLog($"⚠️ [Chưa có phiên FB] Via '{resolvedViaLabel ?? "Via"}' đang ở màn hình đăng nhập ({payload.Detail}) — đã giữ nguyên cửa sổ để bạn đăng nhập 1 lần!");
            _ = Dispatcher.BeginInvoke(UpdateLiveQueueWidgets);
            return new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
        }
        else if (isKeepAliveOk)
        {
            _liveActionProgressDetail = "";
            lock (_liveRunnerSteps)
            {
                foreach (var st in _liveRunnerSteps) st.Status = "done";
            }
            _liveRunnerFinishedTotalSec = _liveRunnerStartedAtUtc != DateTime.MinValue
                ? Math.Max(1, (int)Math.Round((DateTime.UtcNow - _liveRunnerStartedAtUtc).TotalSeconds))
                : Math.Max(1, payload.DurationSec);
            _liveRunnerActive = false;
            _liveRunnerPaused = false;
            _liveRunnerCompleted = true;
            _queue.MarkItemCompleted(resolvedViaId, resolvedViaLabel);
            ViaStewardshipStore.Default.RecordKeepAliveSuccess(
                resolvedViaId,
                resolvedViaLabel,
                matched?.ClientGroup,
                payload.Detail);
            if (matched != null)
            {
                _ = Dispatcher.BeginInvoke(() => { matched.KeepAliveSuccessCount++; });
            }
            if (!string.IsNullOrWhiteSpace(resolvedViaId))
            {
                _config.ViaPreBakeSessionCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                _config.ViaLastPreBakeAtUtc ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var nextBakeCnt = (_config.ViaPreBakeSessionCounts.TryGetValue(resolvedViaId, out var pbc) ? pbc : 0) + 1;
                _config.ViaPreBakeSessionCounts[resolvedViaId] = nextBakeCnt;
                _config.ViaLastPreBakeAtUtc[resolvedViaId] = DateTimeOffset.UtcNow.ToString("O");
                try { _config.Save(); } catch { }
                MaybeNotifyReadyEmbryo(matched, nextBakeCnt, 0);
            }
            if (_config.AutoRefreshCookieAfterKeepAlive && matched?.IsGoogleAdsAccount != true)
            {
                var cdpMatch = ChromeSessionTracker.Default.GetSnapshot().FirstOrDefault(s =>
                    s.CdpPort is > 0 &&
                    ((!string.IsNullOrWhiteSpace(resolvedViaId) && string.Equals(s.ViaId, resolvedViaId, StringComparison.OrdinalIgnoreCase)) ||
                     (!string.IsNullOrWhiteSpace(resolvedViaLabel) && string.Equals(s.ViaLabel, resolvedViaLabel, StringComparison.OrdinalIgnoreCase))));
                if (cdpMatch?.CdpPort is int cdpPortVal && cdpPortVal > 0)
                {
                    var targetViaId = resolvedViaId ?? cdpMatch.ViaId;
                    var targetViaLabel = resolvedViaLabel ?? cdpMatch.ViaLabel;
                    var targetProfileDir = matched?.ProfileDir ?? payload.BrowserProfile ?? cdpMatch.ProfileDir;
                    var curSecret = LocalSecretVaultStore.Default.Find(targetViaId, targetProfileDir, targetViaLabel);
                    var harvested = await ChromeCdpController.TryHarvestFacebookCookieHeaderAsync(cdpPortVal, 1800).ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(harvested))
                    {
                        bool hasAuthPair = ExtensionProvisioner.HasValidFacebookAuthCookieString(harvested);
                        bool shouldPersist = string.IsNullOrWhiteSpace(curSecret.CookieRaw) || hasAuthPair;
                        if (shouldPersist)
                        {
                            bool changed = !string.Equals(harvested.Trim(), (curSecret.CookieRaw ?? "").Trim(), StringComparison.Ordinal);
                            if (changed)
                            {
                                LocalSecretVaultStore.Default.Upsert(
                                    targetViaId,
                                    targetViaLabel,
                                    targetProfileDir,
                                    harvested,
                                    curSecret.TwoFaSecret ?? "");
                                AppendLog($"🔑 [Auto-Vault CDP] Đã {(string.IsNullOrWhiteSpace(curSecret.CookieRaw) ? "trích xuất & lưu" : "làm mới")} Cookie FB cho '{targetViaLabel ?? "Via"}' vào Két DPAPI.");
                            }
                            if (matched != null)
                            {
                                _ = Dispatcher.BeginInvoke(() =>
                                {
                                    matched.HasVaultCookie = true;
                                    matched.LastCookieRefreshUtc = DateTimeOffset.UtcNow;
                                });
                            }
                            ViaStewardshipStore.Default.RecordCookieRefresh(targetViaId, targetViaLabel, matched?.ClientGroup);
                        }
                    }
                }
            }
            AppendLog($"🎉 [Kịch bản Hoàn tất] Via '{resolvedViaLabel ?? "Via"}' đã hoàn thành chu trình tương tác ({_liveRunnerFinishedTotalSec}s): {payload.Detail ?? "Thành công"}");
            _ = Dispatcher.BeginInvoke(() =>
            {
                UpdateLiveQueueWidgets();
                if (_queueSummaryText != null)
                {
                    _queueSummaryText.Text = $"Hoàn tất kịch bản ({_liveRunnerFinishedTotalSec}s) — Via: {resolvedViaLabel ?? "Via"} • ✓ Đã hoàn thành ({payload.Detail ?? "OK"})";
                }
            });
        }
        else if (string.Equals(evType, "KEEPALIVE_STEP", StringComparison.OrdinalIgnoreCase))
        {
            var stepDesc = !string.IsNullOrWhiteSpace(payload.Detail)
                ? payload.Detail
                : $"Bước {payload.StepIndex}/{payload.TotalSteps}: {payload.StepTitle}";
            int stepIdx = Math.Max(1, payload.StepIndex);
            int totalSt = Math.Max(stepIdx, payload.TotalSteps > 0 ? payload.TotalSteps : Math.Max(1, _liveRunnerTotalSteps));
            int waitSec = Math.Max(1, payload.WaitSeconds > 0 ? payload.WaitSeconds : 10);
            var cleanTitle = !string.IsNullOrWhiteSpace(payload.StepTitle) ? payload.StepTitle! : stepDesc;

            if (!_liveRunnerActive && _liveRunnerStartedAtUtc == DateTime.MinValue)
            {
                _liveRunnerStartedAtUtc = DateTime.UtcNow;
            }
            _liveRunnerActive = true;
            _liveRunnerCompleted = false;
            if (!string.IsNullOrWhiteSpace(resolvedViaId)) _liveRunnerViaId = resolvedViaId!;
            if (!string.IsNullOrWhiteSpace(resolvedViaLabel)) _liveRunnerViaLabel = resolvedViaLabel!;
            if (!string.IsNullOrWhiteSpace(matched?.ProfileDir ?? payload.BrowserProfile))
            {
                _liveRunnerProfileDir = (matched?.ProfileDir ?? payload.BrowserProfile)!;
            }
            _liveRunnerCurrentStepIdx = stepIdx;
            _liveRunnerTotalSteps = totalSt;
            _liveRunnerCurrentStepTitle = cleanTitle;
            _liveRunnerStepDurationSec = waitSec;
            _liveRunnerStepStartedAtUtc = DateTime.UtcNow;

            lock (_liveRunnerSteps)
            {
                while (_liveRunnerSteps.Count < totalSt)
                {
                    int nextI = _liveRunnerSteps.Count + 1;
                    _liveRunnerSteps.Add(new WebLiveRunnerStepDto
                    {
                        Index = nextI,
                        Key = $"step_{nextI}",
                        Icon = "⚡",
                        Title = $"Bước {nextI}",
                        DurationSec = waitSec,
                        Status = "pending",
                    });
                }
                for (int i = 0; i < _liveRunnerSteps.Count; i++)
                {
                    var st = _liveRunnerSteps[i];
                    if (st.Index < stepIdx)
                    {
                        st.Status = "done";
                    }
                    else if (st.Index == stepIdx)
                    {
                        st.Status = "running";
                        st.Title = cleanTitle;
                        st.DurationSec = waitSec;
                    }
                    else
                    {
                        st.Status = "pending";
                    }
                }
            }

            AppendLog($"☕ [Kịch bản] Via '{resolvedViaLabel ?? "Via"}' -> {stepDesc} ({waitSec}s)");
            _liveActionProgressDetail = $"Via: {resolvedViaLabel ?? "Via"} • ☕ {stepDesc} ({waitSec}s)";
            _liveActionProgressAt = DateTimeOffset.UtcNow;
            _ = Dispatcher.BeginInvoke(UpdateLiveQueueWidgets);
            TryDispatchHybridCdpPageActionFromStep(cleanTitle, stepIdx, matched, resolvedViaId, resolvedViaLabel, payload.BrowserProfile);
            return new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
        }
        else if (isPendingInvitesCount)
        {
            if (int.TryParse((payload.Detail ?? "").Trim(), out var pendingCnt) && pendingCnt >= 0)
            {
                var pages = _pagesSummary?.Items ?? new List<FanpageItemDto>();
                var matchedPage = pages.FirstOrDefault(p =>
                    (!string.IsNullOrWhiteSpace(payload.ExternalPageId) && string.Equals(p.ExternalPageId, payload.ExternalPageId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrWhiteSpace(payload.PageId) && string.Equals(p.Id, payload.PageId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrWhiteSpace(payload.PageName) && string.Equals(p.Name, payload.PageName.Trim(), StringComparison.OrdinalIgnoreCase)));
                if (matchedPage != null)
                {
                    SetPagePendingInviteCount(matchedPage, pendingCnt, renderNow: true);
                    AppendLog($"🔔 [Quét cảm xúc thật] Fanpage '{matchedPage.Name}' hiện có {pendingCnt} người bày tỏ cảm xúc cần mời theo dõi.");
                }
            }
            return new BrowserEventResponseDto { Ok = true, EventType = payload.EventType };
        }
        else if (isPageInviteOk)
        {
            _queue.MarkItemCompleted(resolvedViaId, resolvedViaLabel);
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
            var pages = _pagesSummary?.Items ?? new List<FanpageItemDto>();
            var matchedPage = pages.FirstOrDefault(p =>
                (!string.IsNullOrWhiteSpace(payload.ExternalPageId) && string.Equals(p.ExternalPageId, payload.ExternalPageId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(payload.PageId) && string.Equals(p.Id, payload.PageId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(payload.PageName) && string.Equals(p.Name, payload.PageName.Trim(), StringComparison.OrdinalIgnoreCase)));
            if (matchedPage != null)
            {
                SetPagePendingInviteCount(matchedPage, 0, renderNow: false);
            }
            AppendLog($"🤝 [Auto-Invite Page] Via '{resolvedViaLabel ?? "Via"}' hoàn tất mời theo dõi Fanpage ({payload.Detail ?? "OK"}). Tổng tích lũy: {_config.TotalPageFollowerInvitesSent} lời mời.");
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (!_overviewWebViewFailed || _activeView is AppView.PagesBm or AppView.Automation or AppView.Overview)
                {
                    RenderCurrentView();
                }
            });
        }

        var shouldCloseWindow = (isKeepAliveOk || isPageInviteOk) && _config.AutoCloseKeepAliveWindow;
        if (shouldCloseWindow)
        {
            var closeVid = resolvedViaId ?? payload.ViaId;
            var closeVlbl = resolvedViaLabel ?? payload.ViaLabel;
            var closeProf = payload.BrowserProfile;
            ChromeSessionTracker.Default.MarkKeepAliveClosed(closeVid, closeVlbl, closeProf);
            if (!string.Equals(payload.Source, "native_runner", StringComparison.OrdinalIgnoreCase))
            {
                _ = Task.Run(async () =>
                {
                    await Task.Delay(1600).ConfigureAwait(false);
                    ChromeSessionTracker.Default.CloseTrackedKeepAliveWindow(closeVid, closeVlbl, closeProf);
                });
            }
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
            using var syncGate = new SemaphoreSlim(6, 6);

            async Task<T> RunGatedAsync<T>(Func<Task<T>> call)
            {
                await syncGate.WaitAsync().ConfigureAwait(false);
                try
                {
                    return await call().ConfigureAwait(false);
                }
                finally
                {
                    syncGate.Release();
                }
            }

            async Task<T> TryFetchGatedAsync<T>(Func<Task<T>> call, T fallback, string label)
            {
                await syncGate.WaitAsync().ConfigureAwait(false);
                try
                {
                    return await call().ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (_allowExit)
                {
                    return fallback;
                }
                catch (Exception ex)
                {
                    if (!silent)
                    {
                        AppendLog($"Bỏ qua {label} (tùy chọn): {ex.Message}");
                    }
                    return fallback;
                }
                finally
                {
                    syncGate.Release();
                }
            }

            _currentUser = await RunGatedAsync(() => _api.GetCurrentUserAsync());
            var accountsTask = RunGatedAsync(() => _api.ListPersonalAccountsAsync());
            var bmsTask = RunGatedAsync(() => _api.ListBusinessManagersAsync());
            var adAccsTask = RunGatedAsync(() => _api.ListAdAccountsAsync());
            var pagesTask = RunGatedAsync(() => _api.GetPagesSummaryAsync());
            var alertSumTask = TryFetchGatedAsync(() => _api.GetAlertsSummaryAsync(), _alertSummary ?? new AlertSummaryDto(), "Tóm tắt Cảnh báo");
            var alertsTask = TryFetchGatedAsync(() => _api.ListAlertsAsync(25), new PagedAlertsDto { Items = _alerts }, "Danh sách Cảnh báo");
            var cronTask = TryFetchGatedAsync(() => _api.GetAutomationCronStatusAsync(), _cronStatus ?? new AutomationCronStatusDto(), "Trạng thái Cloud Cron");

            await Task.WhenAll(accountsTask, bmsTask, adAccsTask, pagesTask, alertSumTask, alertsTask, cronTask);

            var metaConnTask = TryFetchGatedAsync(() => _api.ListMetaConnectionsAsync(), new List<MetaConnectionDto>(), "Meta Connections");
            var healthSumTask = TryFetchGatedAsync(() => _api.GetAccountHealthSummaryAsync(), new HealthSummaryDto(), "Tóm tắt sức khỏe TKQC");
            var healthRowsTask = TryFetchGatedAsync(() => _api.ListAccountHealthAsync(100), new PagedAccountHealthDto(), "Sức khỏe TKQC");
            var draftsTask = TryFetchGatedAsync(() => _api.ListCampaignDraftsAsync(25), new PagedCampaignDraftsDto(), "Pre-flight Campaign Drafts");
            var telegramTask = TryFetchGatedAsync(() => _api.GetTelegramBotConfigAsync(), new TelegramBotConfigDto(), "Telegram Bot Config");
            var spendSumTask = TryFetchGatedAsync(() => _api.GetSpendSummaryAsync(), new SpendSummaryDto(), "Tổng hợp Chi tiêu");
            var sessionsTask = TryFetchGatedAsync(() => _api.ListMyDeviceSessionsAsync(), new List<DeviceSessionDto>(), "Phiên Thiết bị Cloud");
            var proxyMapTask = TryFetchGatedAsync(() => _api.GetProxyHealthMapAsync(), new Dictionary<string, ProxyCheckResultDto>(), "Bản đồ Live Proxy");
            var readinessSumTask = TryFetchGatedAsync(() => _api.GetReadinessSummaryAsync(), new ReadinessSummaryDto(), "Tóm tắt Readiness");
            var readinessBoardTask = TryFetchGatedAsync(() => _api.GetReadinessBoardAsync(200), new ReadinessBoardDto(), "Readiness Board");
            var auditTask = TryFetchGatedAsync(() => _api.ListAuditLogsAsync(1, 50), new PagedResponse<AuditLogEntryDto>(), "Live Audit Logs");
            var pixelsTask = TryFetchGatedAsync(() => _api.ListPixelsAsync(100), new PagedResponse<PixelDto>(), "Meta Pixels");
            var domainSeoTask = TryFetchGatedAsync(() => _api.GetDomainSeoConfigAsync(), new DomainSeoConfigDto(), "Domain & SEO Config");
            var retainersTask = TryFetchGatedAsync(() => _api.GetClientRetainersAsync(), new ClientRetainersOverviewDto(), "Client Retainers");
            var teamSumTask = TryFetchGatedAsync<TeamSummaryDto?>(async () => await _api.GetTeamSummaryAsync(), null, "Team Summary");
            var teamMemTask = TryFetchGatedAsync(() => _api.ListTeamMembersAsync(), new List<TeamMemberDto>(), "Team Members");
            var teamInvTask = TryFetchGatedAsync(() => _api.ListTeamInvitationsAsync(), new List<TeamInvitationDto>(), "Team Invitations");
            var quotaTask = TryFetchGatedAsync<CommunityQuotaDto?>(async () => await _api.GetMyCommunityQuotaAsync(), null, "Hạn mức Cộng đồng");
            var playbooksTask = TryFetchGatedAsync(() => _api.ListPlaybooksAsync(), new List<AutomationPlaybookDto>(), "Kịch bản Team");
            var launchAuditTask = TryFetchGatedAsync(() => _api.GetProfileLaunchAuditAsync(50), new List<ProfileLaunchAuditDto>(), "Nhật ký Mở Profile");

            await Task.WhenAll(
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
            if (!is401 && silent && _hasLoadedOnce && _vias.Count > 0)
            {
                AppendLog($"ℹ️ Đồng bộ ngầm tạm hoãn ({ex.Message}) — Đang giữ nguyên dữ liệu phiên hiện tại.");
                return;
            }
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
                AccountPlatform = parsed.AccountPlatform,
                GoogleAdsCustomerId = parsed.GoogleAdsCustomerId,
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

        var prevLocalEmbryos = _vias
            .Where(v => v.ViaId.StartsWith("local-embryo-", StringComparison.OrdinalIgnoreCase))
            .ToList();
        foreach (var le in prevLocalEmbryos)
        {
            if (!list.Any(x => string.Equals(x.ViaId, le.ViaId, StringComparison.OrdinalIgnoreCase) ||
                               string.Equals(x.Label, le.Label, StringComparison.OrdinalIgnoreCase)))
            {
                list.Add(le);
            }
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
            if (_config.EnforceClientSilo && via.IsGoogleAdsAccount && via.HasSiloConflict)
            {
                var siloMsg = $"⛔ CHẶN RỦI RO CHẾT CHÙM GOOGLE ADS cho '{via.Label}':\n{via.SiloConflictDetail}\n\nHãy gắn Proxy Tĩnh 1:1 riêng cho từng MCC và từng Gmail khách hàng trước khi mở Chrome!";
                AppendLog($"⛔ Chặn mở '{via.Label}': {via.SiloConflictDetail}");
                if (interactiveAlerts)
                {
                    _ = Dispatcher.BeginInvoke(() =>
                        MessageBox.Show(this, siloMsg, "Khiên Bảo Vệ Silo Google Ads 1:1", MessageBoxButton.OK, MessageBoxImage.Stop));
                }
                return;
            }
            if (via.IsInCooldown)
            {
                AppendLog($"⚠️ Lưu ý: Via '{via.Label}' đang trong thời gian Cooldown ({via.CooldownReason}). Mở trình duyệt để kiểm tra thủ công.");
            }
            var vaultSecret = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
            via.HasVaultCookie = vaultSecret.Found && !string.IsNullOrWhiteSpace(vaultSecret.CookieRaw);
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
                var hasDpapiSession = vaultSecret.Found && (!string.IsNullOrWhiteSpace(vaultSecret.CookieRaw) || !string.IsNullOrWhiteSpace(vaultSecret.TwoFaSecret));

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

                bool routePrefersCdpFail = !via.IsGoogleAdsAccount &&
                    (targetUrl.Contains("page_auto_post_media", StringComparison.OrdinalIgnoreCase) ||
                     targetUrl.Contains("page_auto_share_curated", StringComparison.OrdinalIgnoreCase) ||
                     targetUrl.Contains("adsops_pre_robot=", StringComparison.OrdinalIgnoreCase)) &&
                    ExtensionProvisioner.HasUsableIsolatedFacebookSession(via.Label, via.ProfileDir, vaultSecret.CookieRaw);
                var effectiveIsoFail = ExtensionProvisioner.ShouldUseIsolatedProfile(
                    _config.UseIsolatedProfiles || routePrefersCdpFail,
                    via.ProfileDir,
                    via.NetworkLabel,
                    via.HasVaultCookie,
                    via.Label);
                var envProfFail = ResolveViaEnvironmentProfileFor(via);
                var swFail = Stopwatch.StartNew();
                var failInfo = await ExtensionProvisioner.LaunchChromeSmartAsync(
                    targetUrl,
                    via.ProfileDir,
                    via.ExtensionFolder,
                    effectiveIsoFail,
                    via.Label,
                    _config.EnableChromeAntidetectShield,
                    _config.LowRamFarmMode,
                    vaultSecret.CookieRaw,
                    envProfFail);
                swFail.Stop();
                AntidetectEngineBenchmarkStore.Default.RecordStartup("chrome_native", (int)swFail.ElapsedMilliseconds);
                ChromeSessionTracker.Default.RecordLaunch(
                    failInfo.Pid,
                    via.ViaId,
                    via.Label,
                    via.ProfileDir,
                    targetUrl,
                    "chrome_native",
                    failInfo.DelegatedToSharedBroker,
                    failInfo.IsolatedMode,
                    failInfo.CdpPort,
                    failInfo.WindowHandle);
                RefreshLiveSessionTelemetryOnVias();
                var failoverMode = failInfo.IsolatedMode
                    ? $"Chrome Gốc Cô lập CDP:{failInfo.CdpPort} (Ext {(failInfo.ExtensionLoadedViaCdp ? "OK" : "Warn")})"
                    : $"Chrome Profile gốc (HWND 0x{failInfo.WindowHandle.ToInt64():X})";
                var failoverDetail = $"Auto-Failover từ {AntidetectBrowserConnector.GetDisplayName(normEng)} (offline/lỗi) sang {failoverMode}";
                AppendLog($"🛡️ {failoverDetail} cho Via '{via.Label}' ({swFail.ElapsedMilliseconds}ms).");
                StartNativeRunnerIfNeeded(via, targetUrl, failInfo.IsolatedMode, failInfo.WindowHandle);
                _ = SendProfileLifecycleEventNonBlockingAsync("ENGINE_FAILOVER", via, targetUrl, (int)swFail.ElapsedMilliseconds, "chrome_native", failoverFrom: normEng, detail: failoverDetail);
                return;
            }

            bool routePrefersCdp = !via.IsGoogleAdsAccount &&
                (targetUrl.Contains("page_auto_post_media", StringComparison.OrdinalIgnoreCase) ||
                 targetUrl.Contains("page_auto_share_curated", StringComparison.OrdinalIgnoreCase) ||
                 targetUrl.Contains("adsops_pre_robot=", StringComparison.OrdinalIgnoreCase)) &&
                ExtensionProvisioner.HasUsableIsolatedFacebookSession(via.Label, via.ProfileDir, vaultSecret.CookieRaw);
            var effectiveIso = ExtensionProvisioner.ShouldUseIsolatedProfile(
                _config.UseIsolatedProfiles || routePrefersCdp,
                via.ProfileDir,
                via.NetworkLabel,
                via.HasVaultCookie,
                via.Label);
            var envProf = ResolveViaEnvironmentProfileFor(via);
            var sw = Stopwatch.StartNew();
            var launchInfo = await ExtensionProvisioner.LaunchChromeSmartAsync(
                targetUrl,
                via.ProfileDir,
                via.ExtensionFolder,
                effectiveIso,
                via.Label,
                _config.EnableChromeAntidetectShield,
                _config.LowRamFarmMode,
                vaultSecret.CookieRaw,
                envProf);
            sw.Stop();
            AntidetectEngineBenchmarkStore.Default.RecordStartup("chrome_native", (int)sw.ElapsedMilliseconds);
            ChromeSessionTracker.Default.RecordLaunch(
                launchInfo.Pid,
                via.ViaId,
                via.Label,
                via.ProfileDir,
                targetUrl,
                "chrome_native",
                launchInfo.DelegatedToSharedBroker,
                launchInfo.IsolatedMode,
                launchInfo.CdpPort,
                launchInfo.WindowHandle);
            RefreshLiveSessionTelemetryOnVias();
            var launchModeTag = launchInfo.IsolatedMode
                ? $"Cô lập CDP:{launchInfo.CdpPort} · Ext {(launchInfo.ExtensionLoadedViaCdp ? $"v{DesktopAppInfo.ExtVersion} OK" : "Fallback")}"
                : $"Profile gốc Chrome · HWND 0x{launchInfo.WindowHandle.ToInt64():X}";
            AppendLog($"Đã mở Chrome ({launchModeTag}) '{via.ProfileDir}' ({via.Label}, {(int)sw.ElapsedMilliseconds}ms) -> {targetUrl}");
            StartNativeRunnerIfNeeded(via, targetUrl, launchInfo.IsolatedMode, launchInfo.WindowHandle);
            TryStartExternalCookieRobotBridgeIfNeeded(via, targetUrl, launchInfo.IsolatedMode, launchInfo.CdpPort);
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

    internal ViaEnvironmentProfile ResolveViaEnvironmentProfileFor(ViaWorkspaceEntry via)
    {
        ViaEnvOverrideItem? ov = null;
        if (_config.ViaEnvOverrides != null && !string.IsNullOrWhiteSpace(via.ViaId))
        {
            _config.ViaEnvOverrides.TryGetValue(via.ViaId, out ov);
        }
        return ExtensionProvisioner.ResolveViaEnvironmentProfile(
            via.Label,
            via.ProfileDir,
            via.NetworkLabel,
            ov,
            _config.EnableProxyGeoLocaleSync,
            _config.EnableWebRtcLeakShield);
    }

    private void TryStartExternalCookieRobotBridgeIfNeeded(ViaWorkspaceEntry via, string targetUrl, bool isolatedMode, int? cdpPort)
    {
        if (!isolatedMode || !cdpPort.HasValue || cdpPort.Value <= 0) return;
        bool isGadsKa = targetUrl.Contains("adsops_gads_keepalive=1", StringComparison.OrdinalIgnoreCase);
        bool hasPreRobot = targetUrl.Contains("adsops_pre_robot=", StringComparison.OrdinalIgnoreCase);
        if (!isGadsKa && !hasPreRobot) return;

        var externalSteps = new List<string>();
        string? finalFbUrl = null;
        bool fastTest = targetUrl.Contains("adsops_fast_test=1", StringComparison.OrdinalIgnoreCase);
        bool autoClose = targetUrl.Contains("adsops_auto_close=1", StringComparison.OrdinalIgnoreCase);

        if (isGadsKa)
        {
            externalSteps.AddRange(new[] { "cookie_robot_google", "cookie_robot_news", "cookie_robot_youtube" });
        }
        else if (Uri.TryCreate(targetUrl, UriKind.Absolute, out var u))
        {
            var qs = System.Web.HttpUtility.ParseQueryString(u.Query);
            var rawRobot = qs["adsops_pre_robot"] ?? "";
            foreach (var p in rawRobot.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (WarmupActionCatalog.IsExternalCookieRobotKey(p))
                {
                    externalSteps.Add(p);
                }
            }
            var rawNext = qs["adsops_fb_next"] ?? "";
            if (!string.IsNullOrWhiteSpace(rawNext) && rawNext.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                finalFbUrl = rawNext;
            }
        }

        if (externalSteps.Count == 0) return;

        var customUrls = WarmupCarePresets.ParseCookieRobotUrls(_config.CookieRobotUrls);
        var ct = GetOrCreateActiveRunnersToken();

        _ = Task.Run(async () =>
        {
            var res = await ChromeCdpController.RunVisibleExternalWarmupThenNavigateAsync(
                cdpPort.Value,
                externalSteps,
                customUrls,
                finalFbUrl,
                fastTest,
                autoCloseWhenFinishedOnly: autoClose && string.IsNullOrWhiteSpace(finalFbUrl),
                onStepProgress: (stepIdx, total, title, waitSec) =>
                {
                    _ = Dispatcher.BeginInvoke(() =>
                    {
                        _liveRunnerCurrentStepIdx = stepIdx;
                        _liveRunnerTotalSteps = Math.Max(total, _liveRunnerTotalSteps);
                        _liveRunnerCurrentStepTitle = title;
                        _liveRunnerStepDurationSec = waitSec;
                        _liveRunnerStepStartedAtUtc = DateTime.UtcNow;
                        _liveActionProgressDetail = $"🌐 [{via.Label}] Bước {stepIdx}/{total}: {title}";
                        _liveActionProgressAt = DateTimeOffset.UtcNow;
                        UpdateLiveQueueWidgets();
                    });
                },
                ct).ConfigureAwait(false);

            _ = Dispatcher.BeginInvoke(() =>
            {
                AppendLog($"🌐 [{via.Label}] Cookie Robot / Hệ sinh thái ngoài FB: {res.Detail}");
                if (string.IsNullOrWhiteSpace(finalFbUrl))
                {
                    _liveRunnerActive = false;
                    _liveRunnerCompleted = res.Ok;
                    _liveRunnerFinishedTotalSec = _liveRunnerStartedAtUtc != DateTime.MinValue
                        ? Math.Max(1, (int)(DateTime.UtcNow - _liveRunnerStartedAtUtc).TotalSeconds)
                        : 15;
                    _liveActionProgressDetail = (res.Ok ? "✓ " : "⚠️ ") + res.Detail;
                    _liveActionProgressAt = DateTimeOffset.UtcNow;
                    if (res.Ok)
                    {
                        _queue.MarkItemCompleted(via.ViaId, via.Label);
                        ViaStewardshipStore.Default.RecordKeepAliveSuccess(
                            via.ViaId,
                            via.Label,
                            via.ClientGroup,
                            res.Detail);
                        via.KeepAliveSuccessCount++;
                        if (!string.IsNullOrWhiteSpace(via.ViaId))
                        {
                            _config.ViaPreBakeSessionCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                            _config.ViaLastPreBakeAtUtc ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                            var nextBakeCnt = (_config.ViaPreBakeSessionCounts.TryGetValue(via.ViaId, out var pbc) ? pbc : 0) + 1;
                            _config.ViaPreBakeSessionCounts[via.ViaId] = nextBakeCnt;
                            _config.ViaLastPreBakeAtUtc[via.ViaId] = DateTimeOffset.UtcNow.ToString("O");
                            try { _config.Save(); } catch { }
                            MaybeNotifyReadyEmbryo(via, nextBakeCnt, res.PersistedCookiesCount);
                        }
                    }
                    else
                    {
                        lock (_keepAliveFailedVias)
                        {
                            if (!string.IsNullOrWhiteSpace(via.ViaId)) _keepAliveFailedVias.Add(via.ViaId.Trim());
                        }
                    }
                    if (autoClose)
                    {
                        ChromeSessionTracker.Default.MarkKeepAliveClosed(via.ViaId, via.Label, via.ProfileDir);
                    }
                    UpdateLiveQueueWidgets();
                }
            });
        }, ct);
    }

    private void StartNativeRunnerIfNeeded(ViaWorkspaceEntry via, string targetUrl, bool isolatedMode, IntPtr windowHandle)
    {
        bool isAutomationUrl = targetUrl.Contains("adsops_keepalive_session=1", StringComparison.OrdinalIgnoreCase)
                            || targetUrl.Contains("adsops_keepalive=1", StringComparison.OrdinalIgnoreCase)
                            || targetUrl.Contains("adsops_preads_warmup=1", StringComparison.OrdinalIgnoreCase)
                            || targetUrl.Contains("adsops_prepage_warmup=1", StringComparison.OrdinalIgnoreCase)
                            || targetUrl.Contains("adsops_gads_keepalive=1", StringComparison.OrdinalIgnoreCase)
                            || targetUrl.Contains("adsops_pre_robot=", StringComparison.OrdinalIgnoreCase);
        if (!isAutomationUrl) return;

        InitLiveRunnerForVia(via, targetUrl, isolatedMode, windowHandle);
        if (isolatedMode || windowHandle == IntPtr.Zero) return;

        var ct = GetOrCreateActiveRunnersToken();
        _ = NativeChromeActionRunner.RunIfNeededAsync(
            windowHandle,
            via,
            targetUrl,
            key => _extHeartbeatByVia.TryGetValue(key, out var ts) && (DateTimeOffset.UtcNow - ts).TotalSeconds < 15,
            ev => OnBridgeBrowserEventAsync(ev),
            AppendLog,
            _config.AutoCloseKeepAliveWindow,
            ct,
            isPaused: () => _liveRunnerPaused || _queue.Current.Phase == QueuePhase.Paused,
            consumeSkipStep: () =>
            {
                if (!_skipCurrentRunnerStepRequested) return false;
                _skipCurrentRunnerStepRequested = false;
                return true;
            });
    }

    private void InitLiveRunnerForVia(ViaWorkspaceEntry via, string targetUrl, bool isolatedMode, IntPtr windowHandle)
    {
        bool fastTest = targetUrl.Contains("adsops_fast_test=1", StringComparison.OrdinalIgnoreCase);
        bool isPreAds = targetUrl.Contains("adsops_preads_warmup=1", StringComparison.OrdinalIgnoreCase);
        bool isPrePage = targetUrl.Contains("adsops_prepage_warmup=1", StringComparison.OrdinalIgnoreCase);
        var stepList = new List<WebLiveRunnerStepDto>();

        if (isPreAds || isPrePage)
        {
            int sec = isPrePage
                ? Math.Clamp(_config.PrePageCreationWarmupSeconds < 10 ? 35 : _config.PrePageCreationWarmupSeconds, 10, 90)
                : Math.Clamp(_config.PreAdsWarmupSeconds < 8 ? 20 : _config.PreAdsWarmupSeconds, 8, 90);
            stepList.Add(new WebLiveRunnerStepDto
            {
                Index = 1,
                Key = isPrePage ? "prepage_warmup" : "preads_warmup",
                Icon = "🛡️",
                Title = isPrePage ? "Đệm Newsfeed trước Tạo Page" : "Đệm Newsfeed trước Ads Manager",
                DurationSec = sec,
                Status = "running",
            });
        }
        else
        {
            var seqKeys = new List<string>();
            try
            {
                if (Uri.TryCreate(targetUrl, UriKind.Absolute, out var u))
                {
                    var qs = System.Web.HttpUtility.ParseQueryString(u.Query);
                    var rawRoute = qs["adsops_ka_route"] ?? "";
                    foreach (var p in rawRoute.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        seqKeys.Add(p);
                    }
                }
            }
            catch { }

            if (seqKeys.Count == 0)
            {
                seqKeys = WarmupActionCatalog.GetEffectiveSequence(_config, via.ViaId, DateTime.Now)
                    .Where(k => !string.Equals(k, "refresh_cookie_and_close", StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }
            if (seqKeys.Count == 0) seqKeys.Add("scroll_feed");

            for (int i = 0; i < seqKeys.Count; i++)
            {
                var key = seqKeys[i];
                var meta = WarmupActionCatalog.FindByKey(key);
                int estSec = fastTest ? 5 : EstimateStepSeconds(key);
                stepList.Add(new WebLiveRunnerStepDto
                {
                    Index = i + 1,
                    Key = key,
                    Icon = meta?.Icon ?? "☕",
                    Title = meta?.ShortTitle ?? key,
                    DurationSec = estSec,
                    Status = i == 0 ? "running" : "pending",
                });
            }
        }

        lock (_liveRunnerSteps)
        {
            _liveRunnerSteps.Clear();
            _liveRunnerSteps.AddRange(stepList);
        }

        _liveRunnerViaId = via.ViaId;
        _liveRunnerViaLabel = via.Label;
        _liveRunnerProfileDir = via.ProfileDir;
        _liveRunnerEngineMode = isolatedMode
            ? "Chrome Cô lập CDP • 0% Chiếm chuột"
            : $"Chrome Profile gốc (HWND 0x{windowHandle.ToInt64():X}) • 0% Chiếm chuột";
        _liveRunnerCurrentStepIdx = 1;
        _liveRunnerTotalSteps = stepList.Count;
        _liveRunnerCurrentStepTitle = stepList[0].Title;
        _liveRunnerStepDurationSec = stepList[0].DurationSec;
        _liveRunnerStartedAtUtc = DateTime.UtcNow;
        _liveRunnerStepStartedAtUtc = DateTime.UtcNow;
        _liveRunnerFinishedTotalSec = 0;
        _liveRunnerPaused = false;
        _liveRunnerCompleted = false;
        _skipCurrentRunnerStepRequested = false;
        _liveRunnerActive = true;
        _ = Dispatcher.BeginInvoke(UpdateLiveQueueWidgets);
    }

    private static int EstimateStepSeconds(string key) => (key ?? "").Trim().ToLowerInvariant() switch
    {
        "scroll_feed" or "feed" => 12,
        "watch_reels" or "watch" => 12,
        "react_feed_post" => 10,
        "visit_internal_fanpage" => 13,
        "view_photo_post" or "view_photo_comments" => 11,
        "read_notifications" or "notif" => 9,
        "search_keyword" => 11,
        "visit_own_profile" or "profile" => 9,
        "browse_marketplace" => 11,
        "browse_groups" => 11,
        "mbs_like_comments_and_invite" => 13,
        "page_auto_post_media" => 17,
        "page_auto_share_curated" => 15,
        "cookie_robot_google" => 14,
        "cookie_robot_news" => 16,
        "cookie_robot_youtube" => 18,
        "cookie_robot_custom" => 15,
        "refresh_cookie_and_close" or "save_cookie_close" => 4,
        _ => 11,
    };

    internal WebLiveRunnerStatusDto BuildLiveRunnerStatusDto()
    {
        List<WebLiveRunnerStepDto> stepsCopy;
        lock (_liveRunnerSteps)
        {
            stepsCopy = _liveRunnerSteps.Select(s => new WebLiveRunnerStepDto
            {
                Index = s.Index,
                Key = s.Key,
                Icon = s.Icon,
                Title = s.Title,
                DurationSec = s.DurationSec,
                Status = s.Status,
            }).ToList();
        }

        int estTotal = Math.Max(5, stepsCopy.Sum(s => Math.Max(1, s.DurationSec)));
        if (!_liveRunnerActive && !_liveRunnerCompleted)
        {
            return new WebLiveRunnerStatusDto
            {
                IsActive = false,
                IsPaused = false,
                IsCompleted = false,
                Steps = stepsCopy,
            };
        }

        int stepDur = Math.Max(1, _liveRunnerStepDurationSec);
        int stepElapsed = _liveRunnerActive && _liveRunnerStepStartedAtUtc != DateTime.MinValue
            ? Math.Clamp((int)(DateTime.UtcNow - _liveRunnerStepStartedAtUtc).TotalSeconds, 0, stepDur)
            : (_liveRunnerCompleted ? stepDur : 0);
        int stepRem = _liveRunnerActive ? Math.Max(0, stepDur - stepElapsed) : 0;
        int stepPct = _liveRunnerCompleted ? 100 : Math.Clamp((int)Math.Round(stepElapsed * 100.0 / stepDur), 5, 100);

        int totElapsed = _liveRunnerCompleted
            ? Math.Max(1, _liveRunnerFinishedTotalSec)
            : (_liveRunnerStartedAtUtc != DateTime.MinValue
                ? Math.Max(0, (int)(DateTime.UtcNow - _liveRunnerStartedAtUtc).TotalSeconds)
                : stepElapsed);

        int doneStepsSec = stepsCopy.Where(s => s.Index < _liveRunnerCurrentStepIdx).Sum(s => s.DurationSec);
        int pendingStepsSec = stepsCopy.Where(s => s.Index > _liveRunnerCurrentStepIdx).Sum(s => s.DurationSec);
        int estRem = _liveRunnerActive ? Math.Max(0, stepRem + pendingStepsSec) : 0;
        int effectiveEstTotal = Math.Max(estTotal, doneStepsSec + stepDur + pendingStepsSec);
        int overallPct = _liveRunnerCompleted
            ? 100
            : Math.Clamp((int)Math.Round(((doneStepsSec + stepElapsed) * 100.0) / Math.Max(1, effectiveEstTotal)), 3, 99);

        return new WebLiveRunnerStatusDto
        {
            IsActive = _liveRunnerActive,
            IsPaused = _liveRunnerPaused || _queueSnapshot.Phase == QueuePhase.Paused,
            IsCompleted = _liveRunnerCompleted,
            ViaId = _liveRunnerViaId,
            ViaLabel = _liveRunnerViaLabel,
            ProfileDir = _liveRunnerProfileDir,
            EngineModeLabel = _liveRunnerEngineMode,
            CurrentStepIndex = _liveRunnerCurrentStepIdx,
            TotalSteps = Math.Max(_liveRunnerTotalSteps, stepsCopy.Count),
            CurrentStepTitle = _liveRunnerCurrentStepTitle,
            StepDurationSec = stepDur,
            StepElapsedSec = stepElapsed,
            StepRemainingSec = stepRem,
            StepProgressPercent = stepPct,
            TotalElapsedSec = totElapsed,
            EstimatedTotalSec = effectiveEstTotal,
            EstimatedRemainingSec = estRem,
            OverallProgressPercent = overallPct,
            Steps = stepsCopy,
        };
    }

    internal void ToggleQueueAndRunnerPause()
    {
        if (_queue.Current.Phase == QueuePhase.Paused || _liveRunnerPaused)
        {
            _liveRunnerPaused = false;
            _queue.Resume();
            AppendLog("▶️ Đã tiếp tục chạy kịch bản Tự động hóa.");
        }
        else if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Syncing || _liveRunnerActive)
        {
            _liveRunnerPaused = true;
            _queue.Pause();
            AppendLog("⏸️ Đã tạm dừng kịch bản Tự động hóa (bấm Tiếp tục để chạy tiếp).");
        }
        UpdateLiveQueueWidgets();
    }

    internal void SkipCurrentRunnerStepOrQueueWait()
    {
        if (_liveRunnerActive)
        {
            _skipCurrentRunnerStepRequested = true;
            AppendLog($"⏭️ Đã yêu cầu bỏ qua bước hiện tại ({_liveRunnerCurrentStepTitle}) của Via '{_liveRunnerViaLabel}'.");
        }
        _queue.SkipCurrentWait();
        UpdateLiveQueueWidgets();
    }

    internal void DismissCompletedQueueBanner()
    {
        _liveRunnerCompleted = false;
        _liveRunnerActive = false;
        _liveRunnerPaused = false;
        _liveActionProgressDetail = "";
        _queue.Stop();
        UpdateLiveQueueWidgets();
        RenderCurrentView();
    }

    internal void StopQueueAndActiveRunners()
    {
        bool wasOnlyCompletedBanner = !_liveRunnerActive &&
                                      _queueSnapshot.Phase is QueuePhase.Completed or QueuePhase.Idle;
        try { _activeRunnersCts?.Cancel(); } catch { }
        _activeRunnersCts?.Dispose();
        _activeRunnersCts = null;
        _liveRunnerActive = false;
        _liveRunnerPaused = false;
        _liveRunnerCompleted = false;
        _skipCurrentRunnerStepRequested = false;
        _liveActionProgressDetail = "";
        _queue.Stop();

        if (!wasOnlyCompletedBanner)
        {
            var closedWins = ChromeSessionTracker.Default.CloseAllActiveAutomationSessions();
            RefreshLiveSessionTelemetryOnVias();
            AppendLog($"⏹️ Đã dừng hẳn kịch bản Tự động hóa{(closedWins > 0 ? $" và đóng {closedWins} cửa sổ Chrome Auto" : "")}.");
        }
        UpdateLiveQueueWidgets();
        RenderCurrentView();
    }

    private CancellationToken GetOrCreateActiveRunnersToken()
    {
        if (_activeRunnersCts == null || _activeRunnersCts.IsCancellationRequested)
        {
            _activeRunnersCts?.Dispose();
            _activeRunnersCts = new CancellationTokenSource();
        }
        return _activeRunnersCts.Token;
    }

    private void LaunchViaChromeSafe(ViaWorkspaceEntry via, string targetUrl, string? overrideGrant = null, bool interactivePrompt = true)
    {
        var launchTarget = targetUrl;
        if (!via.IsGoogleAdsAccount)
        {
            var (guardOk, guardDeny) = EvaluateDesktopViaRoleGuardrail(
                via.ViaTier,
                via.IsInSoakQuarantine,
                _config.EnforceSoakQuarantine,
                launchTarget,
                overrideGrant);
            if (!guardOk)
            {
                AppendLog($"[Khiên Vai Trò] Chặn mở '{launchTarget}' trên Via '{via.Label}': {guardDeny}");
                if (!interactivePrompt) return;

                var isOwnerRole = string.Equals(_currentUser?.Role, "owner", StringComparison.OrdinalIgnoreCase);
                if (isOwnerRole)
                {
                    var ans = System.Windows.MessageBox.Show(
                        this,
                        $"{guardDeny}\n\nBạn đang đăng nhập quyền OWNER. Bạn có muốn mở ngoại lệ 15 phút (và ghi nhận vào nhật ký vận hành) không?",
                        "Khiên Bảo Vệ Vai Trò Via — AdsOps Desktop Pro",
                        System.Windows.MessageBoxButton.YesNo,
                        System.Windows.MessageBoxImage.Warning);
                    if (ans != System.Windows.MessageBoxResult.Yes) return;

                    launchTarget = AppendGuardrailOverrideQuery(launchTarget);
                    AppendLog($"[Khiên Vai Trò] Owner xác nhận mở ngoại lệ 15p cho Via '{via.Label}' -> '{launchTarget}'.");
                }
                else
                {
                    System.Windows.MessageBox.Show(
                        this,
                        $"{guardDeny}\n\nChỉ tài khoản Owner mới có quyền mở ngoại lệ vượt rào Via Lớp 1 / Ngâm 72h.",
                        "Khiên Bảo Vệ Vai Trò Via Đã Chặn",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Stop);
                    return;
                }
            }
            else if (!string.IsNullOrWhiteSpace(overrideGrant) && overrideGrant.Trim().StartsWith("vgo1.", StringComparison.Ordinal))
            {
                launchTarget = AppendGuardrailOverrideQuery(launchTarget);
            }
        }

        var effectiveUrl = via.IsGoogleAdsAccount
            ? launchTarget
            : WrapWithPreAdsWarmupIfEnabled(launchTarget);
        if (!string.Equals(effectiveUrl, launchTarget, StringComparison.Ordinal))
        {
            AppendLog($"🛡️ [Bước đệm Chống Checkpoint] Via '{via.Label}' sẽ lướt Newsfeed tự nhiên {_config.PreAdsWarmupSeconds}s trước khi vào Ads Manager / BM.");
        }
        _ = LaunchViaBrowserAsync(via, effectiveUrl, interactiveAlerts: interactivePrompt);
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
        if (_config.AutoTileWindowsOnBatch)
        {
            var aliveCount = ChromeSessionTracker.Default.GetSnapshot().Count(s => s.Alive);
            if (aliveCount >= 2)
            {
                _ = Task.Run(async () =>
                {
                    await Task.Delay(1200).ConfigureAwait(false);
                    try { OnBridgeTileWindows(new TileWindowsRequestDto { Grid = aliveCount > 4 ? "3x2" : "2x2" }); } catch { }
                });
            }
        }
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
                List<QueueTaskItem> launchedById;
                lock (_keepAliveFailedVias)
                {
                    launchedById = _queue.LastLaunchedItems
                        .Where(item => !string.IsNullOrWhiteSpace(item.ViaId) && !_keepAliveFailedVias.Contains(item.ViaId.Trim()))
                        .GroupBy(item => item.ViaId, StringComparer.OrdinalIgnoreCase)
                        .Select(g => g.First())
                        .ToList();
                }
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

            if (snap.Phase is QueuePhase.Completed or QueuePhase.Idle && (!_overviewWebViewFailed || _activeView is AppView.Overview or AppView.Automation))
            {
                RenderCurrentView();
            }
        });
    }

    private (string PhaseVi, string Detail, string SummaryLine) FormatQueueSummary(QueueSnapshot s)
    {
        if (_liveRunnerActive)
        {
            var lr = BuildLiveRunnerStatusDto();
            var pVi = lr.IsPaused
                ? $"⏸ Tạm dừng (Bước {lr.CurrentStepIndex}/{lr.TotalSteps})"
                : $"▶ Bước {lr.CurrentStepIndex}/{lr.TotalSteps}: {lr.CurrentStepTitle}";
            var det = $"Via: {lr.ViaLabel} ({lr.ProfileDir}) • ⏱️ Bước này: còn {lr.StepRemainingSec}s/{lr.StepDurationSec}s • Đã chạy: {lr.TotalElapsedSec}s (Còn ~{lr.EstimatedRemainingSec}s)";
            return (pVi, det, $"{pVi} — {det}");
        }

        var phaseVi = s.Phase switch
        {
            QueuePhase.Running => s.CheckingProxy ? "Đang test Proxy trước khi mở..." : $"Đang chạy ({Math.Min(s.TotalCount, s.CurrentIndex + 1)}/{s.TotalCount})",
            QueuePhase.Paused => "Đang tạm dừng",
            QueuePhase.NightPaused => "Tạm nghỉ khung giờ ban đêm (22:30 - 08:00)",
            QueuePhase.Syncing => s.Kind == QueueKind.KeepAlive ? "Đang chạy kịch bản..." : "Đang đồng bộ kết quả về Cloud...",
            QueuePhase.Completed => s.Kind == QueueKind.KeepAlive
                ? $"Hoàn tất kịch bản ({s.LaunchedCount}/{s.TotalCount} Via{(_liveRunnerFinishedTotalSec > 0 ? $" • {_liveRunnerFinishedTotalSec}s" : "")})"
                : $"Hoàn tất ({s.LaunchedCount}/{s.TotalCount} đã mở, bỏ qua {s.SkippedCount})",
            _ => "Sẵn sàng nhận lệnh",
        };
        var detail = s.Phase == QueuePhase.Completed
            ? (string.IsNullOrWhiteSpace(s.CurrentViaLabel)
                ? "Đã hoàn tất toàn bộ kịch bản tương tác."
                : $"Via: {s.CurrentViaLabel} • ✓ Đã hoàn tất chuỗi hành vi ({(_liveRunnerFinishedTotalSec > 0 ? $"{_liveRunnerFinishedTotalSec}s" : "OK")}).")
            : (s.Phase is QueuePhase.Running or QueuePhase.Syncing &&
               !string.IsNullOrEmpty(_liveActionProgressDetail) &&
               (DateTimeOffset.UtcNow - _liveActionProgressAt).TotalSeconds < 25)
                ? _liveActionProgressDetail
                : (string.IsNullOrWhiteSpace(s.CurrentViaLabel) ? s.LastNotice : $"Via: {s.CurrentViaLabel} • {s.CurrentTaskTitle}");
        var summaryLine = string.IsNullOrWhiteSpace(detail) ? phaseVi : $"{phaseVi} — {detail}";
        return (phaseVi, detail, summaryLine);
    }

    private void UpdateLiveQueueWidgets()
    {
        var s = _queueSnapshot;
        var (_, _, summaryLine) = FormatQueueSummary(s);
        if (_queueSummaryText != null)
        {
            _queueSummaryText.Text = summaryLine;
        }

        if (_queueCountdownText != null)
        {
            if (_liveRunnerActive)
            {
                var lr = BuildLiveRunnerStatusDto();
                _queueCountdownText.Text = $"Bước {lr.CurrentStepIndex}/{lr.TotalSteps} • Còn {lr.StepRemainingSec}s";
            }
            else
            {
                _queueCountdownText.Text = s.Phase is QueuePhase.Running or QueuePhase.Syncing && s.CountdownSeconds > 0
                    ? (s.Phase == QueuePhase.Syncing ? $"Chờ: {s.CountdownSeconds}s" : $"Nghỉ: {s.CountdownSeconds}s")
                    : s.Phase == QueuePhase.Idle ? "—" : $"{s.LaunchedCount}/{s.TotalCount}";
            }
        }

        if (_queuePauseBtn != null && _queuePauseBtn.Content is StackPanel sp && sp.Children.Count >= 2)
        {
            var isPaused = s.Phase == QueuePhase.Paused || _liveRunnerPaused;
            if (sp.Children[0] is TextBlock ic) ic.Text = isPaused ? FluentIcons.Play : FluentIcons.Pause;
            if (sp.Children[1] is TextBlock tb) tb.Text = isPaused ? "Tiếp tục" : "Tạm dừng";
        }

        var active = s.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.NightPaused or QueuePhase.Syncing || _liveRunnerActive;
        var completedOnly = !active && (s.Phase == QueuePhase.Completed || _liveRunnerCompleted);
        if (_queuePauseBtn != null) _queuePauseBtn.IsEnabled = active;
        if (_queueSkipBtn != null) _queueSkipBtn.IsEnabled = s.Phase is QueuePhase.Running or QueuePhase.Syncing || _liveRunnerActive;
        if (_queueStopBtn != null)
        {
            _queueStopBtn.IsEnabled = active || completedOnly;
            if (_queueStopBtn.Content is StackPanel stopSp && stopSp.Children.Count >= 2 && stopSp.Children[1] is TextBlock stopTb)
            {
                stopTb.Text = completedOnly ? "Đóng thông báo" : "Dừng hẳn";
            }
        }
        if (_queueLiveBanner != null)
        {
            _queueLiveBanner.Visibility = active || completedOnly ? Visibility.Visible : Visibility.Collapsed;
        }
        if (!_overviewWebViewFailed)
        {
            PushLiveTickToWebView();
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

    internal string WrapWithPreAdsWarmupIfEnabled(string targetUrl)
    {
        if (string.IsNullOrWhiteSpace(targetUrl) || !_config.EnablePreAdsManagerWarmup) return targetUrl;
        if (targetUrl.Contains("adsops_preads_warmup=1", StringComparison.OrdinalIgnoreCase)) return targetUrl;
        var isAdsOrBmDeepLink = targetUrl.Contains("adsmanager.facebook.com", StringComparison.OrdinalIgnoreCase) ||
                                targetUrl.Contains("business.facebook.com/settings", StringComparison.OrdinalIgnoreCase) ||
                                targetUrl.Contains("business.facebook.com/billing_hub", StringComparison.OrdinalIgnoreCase);
        if (!isAdsOrBmDeepLink) return targetUrl;
        var sec = Math.Clamp(_config.PreAdsWarmupSeconds < 8 ? 20 : _config.PreAdsWarmupSeconds, 8, 90);
        return $"https://www.facebook.com/?adsops_preads_warmup=1&adsops_preads_sec={sec}&adsops_preads_target={Uri.EscapeDataString(targetUrl)}";
    }

    internal static string WrapWithPrePageCreationWarmup(string targetUrl, bool enabled, int warmupSeconds)
    {
        if (string.IsNullOrWhiteSpace(targetUrl) || !enabled) return targetUrl;
        if (targetUrl.Contains("adsops_prepage_warmup=1", StringComparison.OrdinalIgnoreCase)) return targetUrl;
        if (!targetUrl.Contains("pages/creation", StringComparison.OrdinalIgnoreCase)) return targetUrl;
        var sec = Math.Clamp(warmupSeconds < 10 ? 35 : warmupSeconds, 10, 90);
        return $"https://www.facebook.com/?adsops_prepage_warmup=1&adsops_prepage_sec={sec}&adsops_prepage_target={Uri.EscapeDataString(targetUrl)}";
    }

    internal string WrapWithPrePageCreationWarmupIfEnabled(string targetUrl)
        => WrapWithPrePageCreationWarmup(targetUrl, _config.EnablePrePageCreationWarmup, _config.PrePageCreationWarmupSeconds);

    internal (string LaunchUrl, string TaskSummary) BuildKeepAliveLaunchUrlForVia(
        ViaWorkspaceEntry v,
        string? crossPageUrl,
        bool fastTest = false)
    {
        if (v.IsGoogleAdsAccount)
        {
            var gadsSteps = new[] { "cookie_robot_google", "cookie_robot_news", "cookie_robot_youtube" };
            var gadsUrl = "https://www.google.com/?adsops_gads_keepalive=1&adsops_auto_close=" +
                          (_config.AutoCloseKeepAliveTab ? "1" : "0") +
                          "&adsops_via_label=" + Uri.EscapeDataString(v.Label) +
                          "&adsops_ka_route=" + Uri.EscapeDataString(string.Join(",", gadsSteps)) +
                          (fastTest ? "&adsops_fast_test=1" : "");
            return (gadsUrl, "🌐 Giữ Ấm Hệ Sinh Thái Google (Search ➔ Báo ➔ YouTube • 0% Chạm Ads)");
        }

        var effectiveMode = v.IsInSoakQuarantine && _config.EnforceSoakQuarantine
            ? "soak_72h"
            : ViaMetadataParser.NormalizeWarmupMode(!string.IsNullOrWhiteSpace(v.DefaultWarmupMode) ? v.DefaultWarmupMode : _config.DefaultWarmupMode);

        var seqKeys = effectiveMode == "soak_72h"
            ? new List<string> { "scroll_feed", "read_notifications", "refresh_cookie_and_close" }
            : WarmupActionCatalog.GetEffectiveSequence(_config, v.ViaId, DateTime.Now);

        var routeStops = seqKeys.Where(k => !string.Equals(k, "refresh_cookie_and_close", StringComparison.OrdinalIgnoreCase)).ToList();
        if (routeStops.Count == 0) routeStops.Add("scroll_feed");

        var externalStops = routeStops.Where(WarmupActionCatalog.IsExternalCookieRobotKey).ToList();
        var fbStops = routeStops.Where(k => !WarmupActionCatalog.IsExternalCookieRobotKey(k)).ToList();

        var cookieUrlsCsv = externalStops.Any(s => string.Equals(s, "cookie_robot_custom", StringComparison.OrdinalIgnoreCase))
            ? string.Join(",", WarmupCarePresets.ParseCookieRobotUrls(_config.CookieRobotUrls).Take(10))
            : "";

        bool hasPagePostStop = fbStops.Any(s => string.Equals(s, "page_auto_post_media", StringComparison.OrdinalIgnoreCase));
        bool hasPageShareStop = fbStops.Any(s => string.Equals(s, "page_auto_share_curated", StringComparison.OrdinalIgnoreCase));
        FanpageItemDto? owningPage = null;
        string composerUrl = "";
        string shareUrl = "";
        string postCaptionPreview = "";
        if (hasPagePostStop || hasPageShareStop)
        {
            owningPage = ResolvePrimaryLivePageForVia(v.ViaId);
            postCaptionPreview = PageContentNurtureEngine.SpinText(
                _config.PageCaptionSpintax,
                owningPage?.Name ?? v.Label,
                owningPage?.Category ?? _batchNicheKey);
            if (postCaptionPreview.Length > 260)
            {
                postCaptionPreview = postCaptionPreview[..257].TrimEnd() + "...";
            }
            if (hasPagePostStop)
            {
                composerUrl = owningPage != null && !string.IsNullOrWhiteSpace(owningPage.ExternalPageId)
                    ? $"https://business.facebook.com/latest/composer?asset_id={Uri.EscapeDataString(owningPage.ExternalPageId!)}"
                    : "https://business.facebook.com/latest/composer";
            }
            if (hasPageShareStop)
            {
                var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);
                if (shareUrls.Count > 0)
                {
                    var pageKey = owningPage != null && !string.IsNullOrWhiteSpace(owningPage.ExternalPageId)
                        ? owningPage.ExternalPageId!
                        : (owningPage?.Id ?? v.ViaId);
                    _config.PageSharedUrlHistory ??= new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
                    shareUrl = PageContentNurtureEngine.PickNextShareUrl(pageKey, shareUrls, _config.PageSharedUrlHistory) ?? shareUrls[0];
                }
            }
        }

        string? BuildFbRouteUrl(List<string> stopsToRun)
        {
            if (stopsToRun.Count == 0) return null;
            var fk = stopsToRun[0];
            var fbBase = fk.ToLowerInvariant() switch
            {
                "visit_internal_fanpage" when !string.IsNullOrWhiteSpace(crossPageUrl) && crossPageUrl.Contains("facebook.com", StringComparison.OrdinalIgnoreCase) => crossPageUrl,
                "watch_reels" => "https://www.facebook.com/watch/",
                "read_notifications" => "https://www.facebook.com/notifications",
                "search_keyword" => "https://www.facebook.com/search/top/?q=xu%20huong",
                "visit_own_profile" => "https://www.facebook.com/me",
                "browse_marketplace" => "https://www.facebook.com/marketplace/",
                "browse_groups" => "https://www.facebook.com/groups/feed/",
                "mbs_like_comments_and_invite" => "https://business.facebook.com/latest/home?adsops_auto_invite_followers=1&adsops_like_comments=1",
                "page_auto_post_media" => !string.IsNullOrWhiteSpace(composerUrl) ? composerUrl : "https://business.facebook.com/latest/composer",
                "page_auto_share_curated" => !string.IsNullOrWhiteSpace(shareUrl) ? shareUrl : "https://www.facebook.com/",
                _ => "https://www.facebook.com/",
            };
            var sepChar = fbBase.Contains('?') ? "&" : "?";
            return fbBase + sepChar + "adsops_keepalive_session=1&adsops_auto_close=" + (_config.AutoCloseKeepAliveTab ? "1" : "0") +
                   "&adsops_via_tier=" + Uri.EscapeDataString(v.RoleTier) +
                   "&adsops_via_label=" + Uri.EscapeDataString(v.Label) +
                   "&adsops_ka_mode=" + Uri.EscapeDataString(effectiveMode) +
                   "&adsops_ka_route=" + Uri.EscapeDataString(string.Join(",", stopsToRun)) +
                   (!string.IsNullOrEmpty(crossPageUrl) ? "&adsops_cross_page_url=" + Uri.EscapeDataString(crossPageUrl) : "") +
                   (!string.IsNullOrEmpty(cookieUrlsCsv) ? "&adsops_cookie_urls=" + Uri.EscapeDataString(cookieUrlsCsv) : "") +
                   (!string.IsNullOrEmpty(composerUrl) ? "&adsops_composer_url=" + Uri.EscapeDataString(composerUrl) : "") +
                   (!string.IsNullOrEmpty(shareUrl) ? "&adsops_share_url=" + Uri.EscapeDataString(shareUrl) : "") +
                   (!string.IsNullOrEmpty(postCaptionPreview) ? "&adsops_post_caption=" + Uri.EscapeDataString(postCaptionPreview) : "") +
                   (fastTest ? "&adsops_fast_test=1" : "");
        }

        var arrowSummary = WarmupActionCatalog.FormatSequenceArrowText(seqKeys);
        if (externalStops.Count > 0)
        {
            var fbNextUrl = BuildFbRouteUrl(fbStops) ?? "";
            var robotUrl = "https://www.google.com/?adsops_pre_robot=" + Uri.EscapeDataString(string.Join(",", externalStops)) +
                           "&adsops_auto_close=" + (_config.AutoCloseKeepAliveTab ? "1" : "0") +
                           "&adsops_via_label=" + Uri.EscapeDataString(v.Label) +
                           "&adsops_ka_route=" + Uri.EscapeDataString(string.Join(",", routeStops)) +
                           (!string.IsNullOrEmpty(fbNextUrl) ? "&adsops_fb_next=" + Uri.EscapeDataString(fbNextUrl) : "") +
                           (fastTest ? "&adsops_fast_test=1" : "");
            return (robotUrl, effectiveMode == "soak_72h" ? "Ngâm 72h thụ động" : arrowSummary);
        }

        var launchUrl = BuildFbRouteUrl(fbStops) ?? "https://www.facebook.com/?adsops_keepalive_session=1";
        return (launchUrl, effectiveMode == "soak_72h" ? "Ngâm 72h thụ động" : arrowSummary);
    }

    public void StartNaturalFlowForVias(IReadOnlyList<ViaWorkspaceEntry> targetVias, bool fastTest, bool requireConfirm)
    {
        var title = fastTest
            ? "🧪 Test Nhanh Kịch Bản Tương Tác (5s/bước)"
            : $"▶ Chạy Kịch Bản Tương Tác ({targetVias.Count} Via)";
        EnqueueKeepAliveVias(targetVias, title, requireConfirm, fastTest);
    }

    private void EnqueueKeepAliveVias(IReadOnlyList<ViaWorkspaceEntry> targetVias, string title, bool requireConfirm, bool fastTest = false)
    {
        if (targetVias.Count == 0) return;
        if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.Syncing or QueuePhase.NightPaused)
        {
            MessageBox.Show(this, "Hàng đợi đang chạy dở. Hãy Tạm dừng hoặc Dừng hẳn trước khi xếp lô mới.", "Hàng đợi đang bận", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        lock (_keepAliveFailedVias) _keepAliveFailedVias.Clear();
        _liveActionProgressDetail = "";
        _extHeartbeatByVia.Clear();

        var restMin = fastTest ? 5 : Math.Clamp(_config.QueueRestMinSeconds < 5 ? 15 : _config.QueueRestMinSeconds, 5, 300);
        var restMax = fastTest ? 8 : Math.Clamp(_config.QueueRestMaxSeconds < restMin ? restMin + 10 : _config.QueueRestMaxSeconds, restMin, 600);
        var isCustomFlow = string.Equals(_config.WarmupFlowMode, "custom_sequence", StringComparison.OrdinalIgnoreCase);
        var flowModeTitle = isCustomFlow
            ? "🧩 Chuỗi Hành Động Tự Chọn (Theo trình tự)"
            : "🎲 Bốc thăm Ngẫu nhiên Mỗi Ngày (Mỗi Via 1 kịch bản)";
        var sampleSeq = WarmupActionCatalog.GetEffectiveSequence(_config, targetVias[0].ViaId, DateTime.Now);
        var sampleArrow = WarmupActionCatalog.FormatSequenceArrowText(sampleSeq);

        if (requireConfirm)
        {
            var directCount = targetVias.Count(v => string.IsNullOrWhiteSpace(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel)));
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                title,
                $"Chuẩn bị mở Chrome Profile thật & Proxy riêng để chạy Kịch bản Tương tác Tự nhiên ({flowModeTitle}) cho {targetVias.Count} Via.",
                new (string, string)[]
                {
                    ("Số lượng & Luồng:", $"{targetVias.Count} Via • Tối đa {GetEffectiveMaxConcurrentBrowsers()} luồng song song (Direct IP: {directCount})"),
                    ("Khoảng thời gian nhịp nghỉ:", $"Ngẫu nhiên từ {restMin}s đến {restMax}s giữa mỗi luồng mở"),
                    ("Chế độ Kịch bản (#3):", flowModeTitle),
                    ("Trình tự mẫu hôm nay:", sampleArrow),
                    ("Nuôi chéo Fanpage nội bộ (#1):", _config.EnableInternalPageCrossWarmup ? "BẬT (Tự ghé thăm & thả Like/Tim Fanpage của bạn)" : "Tắt"),
                },
                directCount > _config.MaxDirectIpViasInBatch
                    ? $"CẢNH BÁO: Có {directCount} Via đang chạy Direct IP (Mạng gốc). Hệ thống sẽ chỉ chạy tối đa {_config.MaxDirectIpViasInBatch} Via Direct IP mỗi ca để chống liên đới."
                    : "Khung giờ an toàn: 08:00 - 22:30. Có thể Tạm dừng hoặc Dừng hẳn bất cứ lúc nào.");
            if (!ok) return;
        }

        var liveInternalPages = (_pagesSummary?.Items ?? new List<FanpageItemDto>())
            .Where(p => !p.IsUnsyncedDraft && p.HealthStatus.Equals("LIVE", StringComparison.OrdinalIgnoreCase) && (!string.IsNullOrWhiteSpace(p.Url) || !string.IsNullOrWhiteSpace(p.ExternalPageId)))
            .ToList();

        int pageRoundRobin = 0;
        var tasks = targetVias.Select(v =>
        {
            string crossPageUrl = "";
            if (_config.EnableInternalPageCrossWarmup && liveInternalPages.Count > 0)
            {
                var pg = liveInternalPages[pageRoundRobin++ % liveInternalPages.Count];
                crossPageUrl = !string.IsNullOrWhiteSpace(pg.Url) && pg.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                    ? pg.Url
                    : $"https://www.facebook.com/{pg.ExternalPageId}";
            }

            var (launchUrl, taskSummary) = BuildKeepAliveLaunchUrlForVia(v, crossPageUrl, fastTest);
            return new QueueTaskItem(
                v.ViaId,
                v.Label,
                GetEffectiveBatchProfileKey(v, v.ProfileDir),
                v.NetworkLabel,
                launchUrl,
                taskSummary,
                v.BackendTier,
                v.ClientGroup,
                v.IsInSoakQuarantine,
                v.CooldownUntilUtc,
                v.HasSiloConflict,
                v.SiloConflictDetail);
        }).ToList();

        if (!fastTest)
        {
            tasks = QueueResumeStateStore.FilterRemainingItems(QueueKind.KeepAlive, tasks, out var resumedSkippedCount);
            if (resumedSkippedCount > 0)
            {
                AppendLog($"♻️ Khôi phục tiến độ Hàng đợi: Tự động bỏ qua {resumedSkippedCount} Via đã Đảo Ấm xong trước đó, chạy tiếp {tasks.Count} Via còn lại.");
            }
        }

        _queue.ConfigureRestRange(restMin, restMax);
        _queue.StartQueue(
            QueueKind.KeepAlive,
            tasks,
            restMin,
            _config.PreCheckProxyBeforeLaunch,
            _config.MaxViasPerProxyInBatch,
            _config.AutoKeepAliveStartHour,
            _config.AutoKeepAliveEndHour,
            enforceDaytimeWindow: !fastTest,
            enforceSoakQuarantine: _config.EnforceSoakQuarantine,
            enforceClientSilo: _config.EnforceClientSilo,
            interleaveByProxy: true,
            sameProxyMinStaggerSeconds: _config.SameProxyMinStaggerSeconds,
            maxConcurrentBrowsers: GetEffectiveMaxConcurrentBrowsers(),
            maxDirectIpVias: _config.MaxDirectIpViasInBatch);

        AppendLog($"🚀 Đã xếp hàng {tasks.Count} Via ({flowModeTitle}{(fastTest ? " • Chế độ Test Nhanh" : "")} • Nhịp nghỉ {restMin}s–{restMax}s • Tối đa {GetEffectiveMaxConcurrentBrowsers()} luồng song song).");
        RenderCurrentView();
    }

    internal (WorkstationMemorySnapshot Mem, int OpenChromeCount, int DeadProxyCount, int CooldownCount, int ReadyDueCount) EvaluateAutoPilotPreFlight()
    {
        var mem = WorkstationPerformanceOptimizer.ReadWorkstationMemory();
        _workstationMem = mem;
        var openChrome = ChromeSessionTracker.Default.GetSnapshot().Count(s => s.Alive);
        var deadPx = _vias.Count(v => string.Equals(v.ProxyLastStatus, "DEAD", StringComparison.OrdinalIgnoreCase));
        var cooldown = _vias.Count(v => v.IsInCooldown);
        var readyDue = _vias.Count(v => v.NeedsKeepAlive && !v.IsInCooldown && !string.Equals(v.ProxyLastStatus, "DEAD", StringComparison.OrdinalIgnoreCase));
        return (mem, openChrome, deadPx, cooldown, readyDue);
    }

    private async Task ExecuteAutoPilotStepWithRetryAsync(string stepTitle, Func<Task> stepAction, int maxRetries = 2)
    {
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                await stepAction().ConfigureAwait(true);
                return;
            }
            catch (Exception ex) when (attempt < maxRetries)
            {
                var delayMs = (1200 * (1 << attempt)) + Random.Shared.Next(200, 650);
                AppendLog($"🔄 [{stepTitle}] Lỗi tạm thời ({ex.Message}) -> Tự động thử lại lần {attempt + 1}/{maxRetries} sau {delayMs}ms...");
                await Task.Delay(delayMs).ConfigureAwait(true);
            }
        }
    }

    internal string? RunDailyAutoVaultBackupIfNeeded(bool force = false)
    {
        if (!force && !_config.AutoDailyVaultBackup) return null;
        var todayKey = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (!force && string.Equals(_config.LastAutoVaultBackupDateLocal, todayKey, StringComparison.Ordinal))
        {
            return null;
        }
        try
        {
            var (created, filePath, retained) = VaultBackupService.CreateDailyAutoBackup(_config, _vias);
            if (created && !string.IsNullOrWhiteSpace(filePath))
            {
                _config.LastAutoVaultBackupDateLocal = todayKey;
                try { _config.Save(); } catch { }
                AppendLog($"🔐 [Auto-Backup Két DPAPI] Đã tự động sao lưu file mã hóa AES-256-GCM: {Path.GetFileName(filePath)} (giữ {retained} bản gần nhất).");
                return filePath;
            }
        }
        catch (Exception ex)
        {
            AppendLog($"⚠️ Lỗi sao lưu tự động Két DPAPI: {ex.Message}");
        }
        return null;
    }

    public async Task RunFullAutoPilotPipelineAsync(bool interactiveConfirm = true)
    {
        if (_autoPipelineRunning || _queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.Syncing or QueuePhase.NightPaused)
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
        if (IsLicenseReadOnly(out var readOnlyMsg))
        {
            AppendLog($"🔒 {readOnlyMsg}");
            if (interactiveConfirm)
            {
                MessageBox.Show(this, readOnlyMsg, "Workspace ở chế độ Chỉ-đọc", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            return;
        }

        // #2 Pre-Flight Safety Check
        var preFlight = EvaluateAutoPilotPreFlight();
        AppendLog($"🛡️ [Pre-Flight Check] RAM trống: {preFlight.Mem.AvailablePhysicalMb:N0} MB • Chrome đang mở: {preFlight.OpenChromeCount} phiên • Proxy DEAD tự bỏ qua: {preFlight.DeadProxyCount} • Cooldown: {preFlight.CooldownCount} • Sẵn sàng Đảo Ấm: {preFlight.ReadyDueCount} Via.");

        if (interactiveConfirm)
        {
            var preFlightWarn = preFlight.Mem.AvailablePhysicalMb < 1200
                ? $"⚠️ RAM trống thấp ({preFlight.Mem.AvailablePhysicalMb:N0} MB < 1,200 MB): Bước 1 sẽ tự động dọn Cache & thu hồi RAM trước khi chạy. Có thể Tạm dừng hoặc Dừng hẳn bất cứ lúc nào."
                : $"✓ Pre-Flight an toàn: RAM trống {preFlight.Mem.AvailablePhysicalMb:N0} MB • Đang mở {preFlight.OpenChromeCount} Chrome • Sẵn sàng chạy {preFlight.ReadyDueCount} Via (tự bỏ qua {preFlight.DeadProxyCount} Proxy DEAD).";
            var ok = UiComponents.ShowConfirmActionDialog(
                this,
                "Chu trình Auto-Pilot Khép Kín 5 Bước (Pre-Flight Safe)",
                "Thực thi tuần tự toàn bộ quy trình tự động hóa hằng ngày cho Dàn Via & Fanpage với cơ chế Pre-Flight Check & Smart Retry.",
                new (string, string)[]
                {
                    ("Pre-Flight Check:", $"RAM {preFlight.Mem.AvailablePhysicalMb:N0} MB • {preFlight.OpenChromeCount} Chrome đang mở • Bỏ qua {preFlight.DeadProxyCount} Proxy Dead"),
                    ("Bước 1:", "Sao lưu Két DPAPI (.adsopsvault) & Dọn Cache Chrome + Giải phóng RAM"),
                    ("Bước 2:", "Quét Proxy Live/Dead & kiểm tra khớp Múi giờ (Smart Retry 2x)"),
                    ("Bước 3:", "Chạy Cloud Cron + Đồng bộ Fanpage & TKQC từ Meta (Smart Retry 2x)"),
                    ("Bước 4:", "Tự động Nuôi bài Fanpage đến hạn (tối đa 10 Page • Smart Retry 2x)"),
                    ("Bước 5:", $"Xếp hàng Đảo Ấm tự động các Via quá hạn ({preFlight.ReadyDueCount} Via hợp lệ)"),
                },
                preFlightWarn,
                "Chạy Auto-Pilot 5 Bước");
            if (!ok) return;
        }

        _autoPipelineRunning = true;
        SetBusy(true);
        try
        {
            // Bước 1: Sao lưu Két DPAPI hằng ngày + Dọn Cache & Thu hồi RAM
            RunDailyAutoVaultBackupIfNeeded(force: false);
            var activeSlugs = BuildActiveChromeSlugSet();
            var (cleaned, bytes) = await Task.Run(() =>
                WorkstationPerformanceOptimizer.CleanProfileCachesAndTrimMemory(activeSlugs: activeSlugs));
            _workstationMem = await Task.Run(() => WorkstationPerformanceOptimizer.ReadWorkstationMemory());
            AppendLog($"🤖 [Auto-Pilot 1/5] Đã dọn {cleaned} thư mục Cache ({bytes / (1024.0 * 1024.0):0.0} MB) • RAM trống: {_workstationMem.AvailablePhysicalMb:N0}/{_workstationMem.TotalPhysicalMb:N0} MB.");

            // Bước 2: Quét Proxy Live/Dead & Múi giờ (với Smart Step Retry #5)
            try
            {
                await ExecuteAutoPilotStepWithRetryAsync("Auto-Pilot 2/5 Proxy", async () =>
                {
                    var pxRes = await _api.CheckProxyBatchAsync();
                    ApplyProxyHealthMapToVias(pxRes.HealthMap);
                    AppendLog($"🤖 [Auto-Pilot 2/5] Quét Proxy xong: {pxRes.LiveCount} Live / {pxRes.DeadCount} Dead (Tổng {pxRes.CheckedCount}).");
                });
            }
            catch (Exception exPx)
            {
                AppendLog($"⚠️ [Auto-Pilot 2/5] Bỏ qua quét Proxy sau khi thử lại: {exPx.Message}");
            }

            // Bước 3: Kích hoạt Cloud Cron + Đồng bộ Fanpage từ Meta (với Smart Step Retry #5)
            try
            {
                await ExecuteAutoPilotStepWithRetryAsync("Auto-Pilot 3/5 Meta Sync", async () =>
                {
                    await _api.RunAutomationCronNowAsync(sync: true, warmup: false);
                    var syncPg = await _api.SyncPagesFromMetaAsync();
                    AppendLog($"🤖 [Auto-Pilot 3/5] Đã chạy Cloud Cron & Đồng bộ {syncPg.SyncedCount} Fanpage từ Meta (Mới: {syncPg.NewCount}).");
                });
            }
            catch (Exception exCron)
            {
                AppendLog($"⚠️ [Auto-Pilot 3/5] Bỏ qua đồng bộ Meta/Cron sau khi thử lại: {exCron.Message}");
            }

            // Bước 4: Tự động Nuôi bài Fanpage đến hạn & Mời người tương tác theo dõi Page (với Smart Step Retry #5)
            try
            {
                await ExecuteAutoPilotStepWithRetryAsync("Auto-Pilot 4/5 Page Warmup", async () =>
                {
                    var warmRes = await _api.BatchWarmupPagesAsync(10);
                    var inviteHint = _config.AutoInvitePageFollowersOnWarmup
                        ? $" • Auto-Invite Follow: BẬT (Max {_config.MaxPageFollowerInvitesPerRun}/phiên)"
                        : "";
                    AppendLog($"🤖 [Auto-Pilot 4/5] Đã nuôi lô tự động {warmRes.NurturedCount} Fanpage (Graph API: {warmRes.GraphPublishedCount}){inviteHint}.");
                });
            }
            catch (Exception exWarm)
            {
                AppendLog($"⚠️ [Auto-Pilot 4/5] Bỏ qua Nuôi lô Fanpage sau khi thử lại: {exWarm.Message}");
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

    internal static string BuildPageAutoInviteUrl(FanpageItemDto page, int maxInvites = 25, bool autoClose = true, bool autoLikeComments = true)
    {
        var clamped = Math.Clamp(maxInvites < 5 ? 25 : maxInvites, 5, 50);
        var closeFlag = autoClose ? "1" : "0";
        var likeFlag = autoLikeComments ? "&adsops_like_comments=1" : "";
        var pName = Uri.EscapeDataString(page.Name ?? "Fanpage");
        if (!string.IsNullOrWhiteSpace(page.ExternalPageId))
        {
            var extId = Uri.EscapeDataString(page.ExternalPageId.Trim());
            return $"https://business.facebook.com/latest/home?asset_id={extId}&adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}{likeFlag}";
        }
        if (!string.IsNullOrWhiteSpace(page.Url) && page.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            var sep = page.Url.Contains('?') ? "&" : "?";
            return $"{page.Url}{sep}adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}{likeFlag}";
        }
        return $"https://business.facebook.com/latest/home?adsops_auto_invite_followers=1&adsops_invite_limit={clamped}&adsops_page_name={pName}&adsops_auto_close={closeFlag}{likeFlag}";
    }

    internal void ApplySavedPageHolderOverrides()
    {
        var pages = _pagesSummary?.Items;
        if (pages == null || pages.Count == 0) return;
        _config.PagePendingInviteCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in pages)
        {
            _ = ResolveEffectiveViaForPage(p);
        }
    }

    internal static List<ViaWorkspaceEntry> ExcludeGoogleAdsVias(IEnumerable<ViaWorkspaceEntry>? vias)
        => vias?.Where(v => v != null && !v.IsGoogleAdsAccount).ToList() ?? new List<ViaWorkspaceEntry>();

    internal static ViaWorkspaceEntry? SelectMetaViaForPage(
        IEnumerable<ViaWorkspaceEntry>? vias,
        FanpageItemDto? page,
        string? overrideRaw = null)
    {
        var allVias = vias?.Where(v => v != null).ToList() ?? new List<ViaWorkspaceEntry>();
        var metaVias = ExcludeGoogleAdsVias(allVias);
        if (metaVias.Count == 0) return null;
        if (page == null) return metaVias[0];

        if (!string.IsNullOrWhiteSpace(overrideRaw))
        {
            var parts = overrideRaw.Split('|');
            var viaId = parts.Length > 0 ? parts[0].Trim() : "";
            var profDir = parts.Length > 1 ? parts[1].Trim() : "";
            var viaLbl = parts.Length > 2 ? parts[2].Trim() : "";

            var matchedVia = metaVias.FirstOrDefault(v =>
                (!string.IsNullOrEmpty(viaId) && string.Equals(v.ViaId, viaId, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(profDir) && string.Equals(v.ProfileDir, profDir, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(viaLbl) && string.Equals(v.Label, viaLbl, StringComparison.OrdinalIgnoreCase)));

            if (matchedVia != null) return matchedVia;

            bool pointsToGoogleAds = allVias.Any(v =>
                v.IsGoogleAdsAccount &&
                ((!string.IsNullOrEmpty(viaId) && string.Equals(v.ViaId, viaId, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrEmpty(profDir) && string.Equals(v.ProfileDir, profDir, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrEmpty(viaLbl) && string.Equals(v.Label, viaLbl, StringComparison.OrdinalIgnoreCase))));
            if (!pointsToGoogleAds && !string.IsNullOrEmpty(profDir))
            {
                var dispLbl = !string.IsNullOrEmpty(viaLbl) ? viaLbl : $"Chrome ({profDir})";
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

        return metaVias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderIdentityId) && string.Equals(v.ViaId, page.HolderIdentityId.Trim(), StringComparison.OrdinalIgnoreCase))
               ?? metaVias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderBrowserProfile) && string.Equals(v.ProfileDir, ExtensionProvisioner.ResolveProfileDirectory(page.HolderBrowserProfile, page.HolderLabel), StringComparison.OrdinalIgnoreCase))
               ?? metaVias.FirstOrDefault(v => !string.IsNullOrWhiteSpace(page.HolderLabel) && string.Equals(v.Label, page.HolderLabel.Trim(), StringComparison.OrdinalIgnoreCase))
               ?? metaVias[0];
    }

    internal static ViaWorkspaceEntry? SelectMetaViaForAdAccount(
        IEnumerable<ViaWorkspaceEntry>? vias,
        AdAccountItemDto? account,
        string? overrideRaw = null)
    {
        var metaVias = ExcludeGoogleAdsVias(vias);
        if (metaVias.Count == 0) return null;
        if (account == null) return metaVias[0];

        if (!string.IsNullOrWhiteSpace(overrideRaw))
        {
            var parts = overrideRaw.Split('|');
            var vid = parts.Length > 0 ? parts[0].Trim() : "";
            var pdir = parts.Length > 1 ? parts[1].Trim() : "";
            var matchedOv = metaVias.FirstOrDefault(v =>
                (!string.IsNullOrEmpty(vid) && string.Equals(v.ViaId, vid, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(pdir) && string.Equals(v.ProfileDir, pdir, StringComparison.OrdinalIgnoreCase)));
            if (matchedOv != null) return matchedOv;
        }

        foreach (var ident in account.FacebookIdentities)
        {
            var m = metaVias.FirstOrDefault(v =>
                (!string.IsNullOrWhiteSpace(ident.Id) && string.Equals(v.ViaId, ident.Id.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(ident.Label) && string.Equals(v.Label, ident.Label.Trim(), StringComparison.OrdinalIgnoreCase)));
            if (m != null) return m;
        }
        return metaVias[0];
    }

    internal ViaWorkspaceEntry? ResolveEffectiveViaForPage(FanpageItemDto page)
    {
        _config.PageHolderViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string? ovRaw = null;
        if (page != null)
        {
            if (!string.IsNullOrWhiteSpace(page.Id) && _config.PageHolderViaOverrides.TryGetValue(page.Id.Trim(), out var v1))
            {
                ovRaw = v1;
            }
            else if (!string.IsNullOrWhiteSpace(page.ExternalPageId) && _config.PageHolderViaOverrides.TryGetValue(page.ExternalPageId.Trim(), out var v2))
            {
                ovRaw = v2;
            }
        }

        var chosen = SelectMetaViaForPage(_vias, page, ovRaw);
        if (chosen != null && page != null)
        {
            page.HolderIdentityId = chosen.ViaId;
            page.HolderBrowserProfile = chosen.ProfileDir;
            if (!string.IsNullOrWhiteSpace(chosen.Label))
            {
                page.HolderLabel = chosen.Label;
            }
        }
        return chosen;
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
        _config.AdAccountViaOverrides ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string? ov = null;
        if (a != null && !string.IsNullOrWhiteSpace(a.Id) && _config.AdAccountViaOverrides.TryGetValue(a.Id.Trim(), out var mappedOv))
        {
            ov = mappedOv;
        }
        return SelectMetaViaForAdAccount(_vias, a, ov);
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

    private volatile bool _isSilentInviteRunning;
    private CancellationTokenSource? _silentInviteCts;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _recentCdpStepActions = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _silentMissingLoginBackoffUntil = new(StringComparer.OrdinalIgnoreCase);
    internal bool IsSilentInviteRunning => _isSilentInviteRunning;

    internal bool CheckSilentFacebookSessionReady(
        ViaWorkspaceEntry via,
        LocalVaultLookupResult vaultSecret,
        bool isScheduled,
        out string detail)
    {
        var key = !string.IsNullOrWhiteSpace(via.ViaId) ? via.ViaId : $"{via.ProfileDir}::{via.Label}";
        if (ExtensionProvisioner.HasUsableIsolatedFacebookSession(via.Label, via.ProfileDir, vaultSecret.CookieRaw))
        {
            _silentMissingLoginBackoffUntil.TryRemove(key, out _);
            detail = "OK";
            return true;
        }

        if (isScheduled && _silentMissingLoginBackoffUntil.TryGetValue(key, out var backoffUntil) && DateTimeOffset.UtcNow < backoffUntil)
        {
            detail = $"Tạm bỏ qua '{via.Label}' đến {backoffUntil.ToLocalTime():HH:mm} (chưa có Cookie DPAPI / phiên FB trong Chrome Cô lập).";
            return false;
        }

        _silentMissingLoginBackoffUntil[key] = DateTimeOffset.UtcNow.AddHours(2);
        detail = $"Via '{via.Label}' chưa có Cookie FB hợp lệ trong Két DPAPI hoặc Profile Cô lập -> mở Via 1 lần để tự đồng bộ Cookie.";
        return false;
    }

    private async Task TryRefreshVaultCookieFromSilentCdpAsync(
        int cdpPort,
        ViaWorkspaceEntry via,
        LocalVaultLookupResult curSecret)
    {
        if (!_config.AutoRefreshCookieAfterKeepAlive || via.IsGoogleAdsAccount || cdpPort <= 0) return;
        try
        {
            var harvested = await ChromeCdpController.TryHarvestFacebookCookieHeaderAsync(cdpPort, 1800).ConfigureAwait(false);
            if (!ExtensionProvisioner.HasValidFacebookAuthCookieString(harvested)) return;

            _silentMissingLoginBackoffUntil.TryRemove(!string.IsNullOrWhiteSpace(via.ViaId) ? via.ViaId : $"{via.ProfileDir}::{via.Label}", out _);
            bool changed = !string.Equals(harvested!.Trim(), (curSecret.CookieRaw ?? "").Trim(), StringComparison.Ordinal);
            if (changed)
            {
                LocalSecretVaultStore.Default.Upsert(
                    via.ViaId,
                    via.Label,
                    via.ProfileDir,
                    harvested,
                    curSecret.TwoFaSecret ?? "");
            }
            _ = Dispatcher.BeginInvoke(() =>
            {
                via.HasVaultCookie = true;
                via.LastCookieRefreshUtc = DateTimeOffset.UtcNow;
            });
            ViaStewardshipStore.Default.RecordCookieRefresh(via.ViaId, via.Label, via.ClientGroup);
        }
        catch { }
    }

    internal static bool IsIsolatedProfileLockFileHeld(string? isoDir)
    {
        if (string.IsNullOrWhiteSpace(isoDir) || !Directory.Exists(isoDir)) return false;
        var winLock = Path.Combine(isoDir, "lockfile");
        if (File.Exists(winLock))
        {
            try
            {
                using var fs = new FileStream(winLock, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException)
            {
                return true;
            }
            catch
            {
                return false;
            }
        }
        return false;
    }

    internal static bool IsViaProfileCurrentlyOpen(
        IEnumerable<TrackedChromeSessionDto>? sessions,
        ViaWorkspaceEntry? via,
        Func<string, bool>? lockHeldProbe = null)
    {
        if (via == null) return false;
        var safeProfile = ExtensionProvisioner.ResolveProfileDirectory(via.ProfileDir, via.Label);
        if (sessions != null)
        {
            bool hasTracked = sessions.Any(s =>
                s != null &&
                s.Alive &&
                !s.ClosedAt.HasValue &&
                !s.KeepAliveClosed &&
                ((!string.IsNullOrWhiteSpace(via.ViaId) && string.Equals(s.ViaId, via.ViaId, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(via.Label) && string.Equals(s.ViaLabel, via.Label, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(safeProfile) && string.Equals(s.ProfileDir, safeProfile, StringComparison.OrdinalIgnoreCase))));
            if (hasTracked) return true;
        }

        var isoDir = ExtensionProvisioner.ResolveIsolatedProfileDirectory(via.Label, safeProfile);
        return (lockHeldProbe ?? IsIsolatedProfileLockFileHeld)(isoDir);
    }

    internal static async Task<(bool Ok, string Reason)> PreCheckViaProxyTcpQuickAsync(
        ViaWorkspaceEntry? via,
        bool preCheckEnabled,
        CancellationToken ct)
    {
        if (via == null) return (false, "Không tìm thấy hồ sơ Via.");
        if (via.IsInCooldown)
        {
            return (false, $"Via '{via.Label}' đang trong thời gian Cooldown ({via.CooldownUntilUtc:HH:mm}).");
        }
        if (!preCheckEnabled || string.IsNullOrWhiteSpace(via.NetworkLabel))
        {
            return (true, "Direct/OK");
        }
        var parsedPx = ExtensionProvisioner.ParseProxy(via.NetworkLabel);
        if (parsedPx == null)
        {
            return (false, $"Cấu hình Proxy của '{via.Label}' không hợp lệ.");
        }
        try
        {
            using var tcp = new System.Net.Sockets.TcpClient();
            using var pxCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            pxCts.CancelAfter(TimeSpan.FromSeconds(4));
            await tcp.ConnectAsync(parsedPx.Host, parsedPx.Port, pxCts.Token).ConfigureAwait(false);
            return (true, $"Proxy {parsedPx.Host}:{parsedPx.Port} LIVE");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            return (false, $"Proxy {parsedPx.Host}:{parsedPx.Port} không phản hồi ({ex.Message}).");
        }
    }

    internal static void CleanupTempNurtureVariantFile(string? variantPath, string? sourcePath)
    {
        if (string.IsNullOrWhiteSpace(variantPath)) return;
        if (!string.IsNullOrWhiteSpace(sourcePath) &&
            string.Equals(variantPath, sourcePath, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        try
        {
            if (File.Exists(variantPath))
            {
                File.Delete(variantPath);
            }
        }
        catch { }
    }

    private FanpageItemDto? ResolvePrimaryLivePageForVia(string? viaId)
    {
        var availPages = _pagesSummary?.Items ?? new List<FanpageItemDto>();
        return availPages.FirstOrDefault(p =>
                   !string.IsNullOrWhiteSpace(p.ExternalPageId) &&
                   !string.IsNullOrWhiteSpace(viaId) &&
                   string.Equals(ResolveEffectiveViaForPage(p)?.ViaId, viaId, StringComparison.OrdinalIgnoreCase))
               ?? availPages.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p.ExternalPageId));
    }

    private void TryDispatchHybridCdpPageActionFromStep(
        string stepTitle,
        int stepIdx,
        ViaWorkspaceEntry? matched,
        string? resolvedViaId,
        string? resolvedViaLabel,
        string? browserProfile)
    {
        if (matched?.IsGoogleAdsAccount == true) return;
        bool isPostStep = stepTitle.Contains("Đăng bài nuôi Fanpage", StringComparison.OrdinalIgnoreCase);
        bool isShareStep = stepTitle.Contains("Chia sẻ bài nguồn về Page", StringComparison.OrdinalIgnoreCase);
        if (!isPostStep && !isShareStep) return;

        var cdpMatch = ChromeSessionTracker.Default.GetSnapshot().FirstOrDefault(s =>
            s.CdpPort is > 0 &&
            s.Alive &&
            !s.ClosedAt.HasValue &&
            ((!string.IsNullOrWhiteSpace(resolvedViaId) && string.Equals(s.ViaId, resolvedViaId, StringComparison.OrdinalIgnoreCase)) ||
             (!string.IsNullOrWhiteSpace(resolvedViaLabel) && string.Equals(s.ViaLabel, resolvedViaLabel, StringComparison.OrdinalIgnoreCase)) ||
             (!string.IsNullOrWhiteSpace(browserProfile) && string.Equals(s.ProfileDir, browserProfile, StringComparison.OrdinalIgnoreCase))));
        if (cdpMatch?.CdpPort is not int cdpPort || cdpPort <= 0)
        {
            return;
        }

        var actionKey = $"{resolvedViaId ?? resolvedViaLabel ?? cdpPort.ToString()}:{(isShareStep ? "share" : "post")}:{stepIdx}";
        var nowUtc = DateTimeOffset.UtcNow;
        if (_recentCdpStepActions.TryGetValue(actionKey, out var prevAt) && (nowUtc - prevAt).TotalSeconds < 90)
        {
            return;
        }
        _recentCdpStepActions[actionKey] = nowUtc;

        var viaIdCopy = resolvedViaId ?? matched?.ViaId ?? "";
        var viaLblCopy = resolvedViaLabel ?? matched?.Label ?? "Via";
        var profileDirCopy = matched?.ProfileDir ?? browserProfile ?? cdpMatch.ProfileDir;
        var owningPage = ResolvePrimaryLivePageForVia(viaIdCopy);
        var pageName = owningPage?.Name ?? viaLblCopy;
        var nicheKey = owningPage?.Category ?? _batchNicheKey;
        var pageKey = owningPage != null && !string.IsNullOrWhiteSpace(owningPage.ExternalPageId)
            ? owningPage.ExternalPageId!
            : (owningPage?.Id ?? viaIdCopy);

        _ = Task.Run(async () =>
        {
            string? tempVariantPath = null;
            try
            {
                using var stepCts = new CancellationTokenSource(TimeSpan.FromSeconds(22));
                await Task.Delay(2500, stepCts.Token).ConfigureAwait(false);
                var caption = PageContentNurtureEngine.SpinText(_config.PageCaptionSpintax, pageName, nicheKey);

                ChromeCdpController.SilentPageContentResult res;
                if (isShareStep)
                {
                    res = await ChromeCdpController.RunSilentPageSharePostAsync(cdpPort, caption, stepCts.Token).ConfigureAwait(false);
                    if (res.Ok && !string.IsNullOrWhiteSpace(pageKey))
                    {
                        _ = Dispatcher.BeginInvoke(() =>
                        {
                            _config.PageLocalShareCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                            _config.PageLocalShareCounts[pageKey] = (_config.PageLocalShareCounts.TryGetValue(pageKey, out var cur) ? cur : 0) + 1;
                            try { _config.Save(); } catch { }
                        });
                    }
                }
                else
                {
                    var (imgPath, isTempCardOrVariant) = PageContentNurtureEngine.ResolveOrGeneratePostImage(
                        _config.PageAssetsDir, nicheKey, pageName, caption, _config.EnableImageHashJitter);
                    if (isTempCardOrVariant)
                    {
                        tempVariantPath = imgPath;
                    }
                    res = await ChromeCdpController.RunSilentPagePublishPostAsync(
                        cdpPort, caption, imgPath, stepCts.Token, owningPage?.ExternalPageId).ConfigureAwait(false);
                }

                if (res.Ok && owningPage != null && !string.IsNullOrWhiteSpace(owningPage.Id))
                {
                    try
                    {
                        await _api.PublishWarmupPostAsync(
                            owningPage.Id, caption, viaIdCopy, viaLblCopy, profileDirCopy,
                            postMode: "chrome_assist", contentType: isShareStep ? "share" : (res.MediaAttached ? "photo" : "post")).ConfigureAwait(false);
                    }
                    catch { }
                }
                _ = Dispatcher.BeginInvoke(() =>
                    AppendLog($"{(isShareStep ? "🔗" : "📸")} [CDP Hybrid • {viaLblCopy}] {(res.Ok ? "✓" : "⚠️")} {res.Detail}"));
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _ = Dispatcher.BeginInvoke(() => AppendLog($"⚠️ [CDP Hybrid • {viaLblCopy}] {ex.Message}"));
            }
            finally
            {
                CleanupTempNurtureVariantFile(tempVariantPath, null);
            }
        });
    }

    internal void CancelSilentInviteIfRunning()
    {
        try { _silentInviteCts?.Cancel(); } catch { }
    }

    internal async Task<ChromeCdpController.SilentMbsInviteResult> ExecuteSilentInviteForPageCoreAsync(
        FanpageItemDto page,
        CancellationToken ct,
        bool isScheduled = false)
    {
        var via = ResolveEffectiveViaForPage(page);
        if (via == null)
        {
            return new ChromeCdpController.SilentMbsInviteResult(false, false, 0, 0, $"Không tìm thấy Via Meta cầm Page '{page.Name}' (hồ sơ Google Ads luôn được cách ly).");
        }
        if (string.IsNullOrWhiteSpace(page.ExternalPageId))
        {
            return new ChromeCdpController.SilentMbsInviteResult(false, false, 0, 0, $"Page '{page.Name}' chưa có ID Facebook.");
        }
        if (IsViaProfileCurrentlyOpen(ChromeSessionTracker.Default.GetSnapshot(), via))
        {
            return new ChromeCdpController.SilentMbsInviteResult(false, false, 0, 0, $"Chrome Profile '{via.ProfileDir}' ({via.Label}) đang mở -> bỏ qua Mời Ẩn để tránh xung đột Profile Lock.");
        }

        var vaultSecret = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        if (!CheckSilentFacebookSessionReady(via, vaultSecret, isScheduled, out var sessionDetail))
        {
            return new ChromeCdpController.SilentMbsInviteResult(false, true, 0, 0, sessionDetail);
        }

        var (pxOk, pxReason) = await PreCheckViaProxyTcpQuickAsync(via, _config.PreCheckProxyBeforeLaunch, ct).ConfigureAwait(false);
        if (!pxOk)
        {
            return new ChromeCdpController.SilentMbsInviteResult(false, false, 0, 0, pxReason);
        }

        var mbsUrl = $"https://business.facebook.com/latest/home?asset_id={Uri.EscapeDataString(page.ExternalPageId)}";
        var envProf = ResolveViaEnvironmentProfileFor(via);

        int? launchedPid = null;
        int? launchedCdpPort = null;
        try
        {
            var launch = await ExtensionProvisioner.LaunchChromeSmartAsync(
                mbsUrl,
                via.ProfileDir,
                via.ExtensionFolder,
                isolatedMode: true,
                viaSlug: via.Label,
                antidetectShield: _config.EnableChromeAntidetectShield,
                lowRamMode: true,
                vaultCookieRaw: vaultSecret.CookieRaw,
                envProfile: envProf,
                hiddenOffscreen: true).ConfigureAwait(false);

            launchedPid = launch.Pid;
            launchedCdpPort = launch.CdpPort;
            if (!launch.CdpPort.HasValue || launch.CdpPort.Value <= 0)
            {
                return new ChromeCdpController.SilentMbsInviteResult(false, false, 0, 0, "Không khởi tạo được phiên Chrome Cô lập chạy ẩn.");
            }

            var res = await ChromeCdpController.RunSilentMbsAutoInviteAsync(
                launch.CdpPort.Value,
                Math.Clamp(_config.MaxPageFollowerInvitesPerRun, 5, 50),
                ct).ConfigureAwait(false);

            if (res.Ok)
            {
                if (res.InvitedSent > 0)
                {
                    _config.TotalPageFollowerInvitesSent += res.InvitedSent;
                    _config.Save();
                    SetPagePendingInviteCount(page, 0, renderNow: true);
                }
                else
                {
                    SetPagePendingInviteCount(page, res.DetectedPending, renderNow: true);
                }
                await TryRefreshVaultCookieFromSilentCdpAsync(launch.CdpPort.Value, via, vaultSecret).ConfigureAwait(false);
            }
            return res;
        }
        finally
        {
            if (launchedCdpPort is > 0)
            {
                try { await ChromeCdpController.CloseBrowserGracefullyAsync(launchedCdpPort.Value, 1500).ConfigureAwait(false); } catch { }
            }
            if (launchedPid is > 0)
            {
                try
                {
                    using var p = Process.GetProcessById(launchedPid.Value);
                    if (!p.HasExited) p.Kill(entireProcessTree: true);
                }
                catch { }
            }
        }
    }

    internal async Task RunSilentInviteSinglePageAsync(FanpageItemDto page)
    {
        if (_isSilentInviteRunning)
        {
            AppendLog("⏳ Đang có phiên Mời Ẩn khác chạy ngầm. Vui lòng đợi vài giây...");
            return;
        }
        _isSilentInviteRunning = true;
        _silentInviteCts?.Dispose();
        _silentInviteCts = new CancellationTokenSource();
        var ct = _silentInviteCts.Token;

        AppendLog($"👻 [Mời Ẩn] Đang quét & tự mời ngầm cho Page '{page.Name}' (không mở cửa sổ che màn hình)...");
        PushOverviewStateToWebView();

        try
        {
            var res = await ExecuteSilentInviteForPageCoreAsync(page, ct);
            if (res.NeedsLogin)
            {
                AppendLog($"⚠️ [Mời Ẩn] Page '{page.Name}': {res.Detail}");
                _tray?.ShowBalloon("👻 Mời Ẩn cần Cookie đăng nhập", $"Page '{page.Name}': hãy lưu Cookie của Via vào Két DPAPI hoặc đăng nhập 1 lần trong Chrome Cô lập.", 4500, error: true);
            }
            else if (res.InvitedSent > 0)
            {
                AppendLog($"✅ [Mời Ẩn] Page '{page.Name}': Đã tự động mời thành công {res.InvitedSent} người theo dõi!");
                _tray?.ShowBalloon("✅ Mời Ẩn Thành Công", $"Page '{page.Name}': đã tự động mời {res.InvitedSent} người theo dõi!", 4000, error: false);
            }
            else if (res.Ok)
            {
                AppendLog($"👻 [Mời Ẩn] Page '{page.Name}': {res.Detail}");
                _tray?.ShowBalloon("👻 Mời Ẩn Hoàn Tất", $"Page '{page.Name}': {res.Detail}", 3000, error: false);
            }
            else
            {
                AppendLog($"⚠️ [Mời Ẩn] Page '{page.Name}': {res.Detail}");
            }
        }
        catch (OperationCanceledException)
        {
            AppendLog($"⏹️ [Mời Ẩn] Đã dừng phiên chạy ẩn cho Page '{page.Name}'.");
        }
        finally
        {
            _isSilentInviteRunning = false;
            PushOverviewStateToWebView();
        }
    }

    internal async Task RunSilentInviteBatchPagesAsync(bool isScheduled = false)
    {
        if (_isSilentInviteRunning)
        {
            if (!isScheduled) AppendLog("⏳ Đang có phiên Mời Ẩn khác chạy ngầm.");
            return;
        }
        var livePages = (_pagesSummary?.Items ?? new())
            .Where(p => string.Equals(p.HealthStatus, "LIVE", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(p.ExternalPageId))
            .ToList();
        if (livePages.Count == 0)
        {
            if (!isScheduled) AppendLog("⚠️ Chưa có Fanpage LIVE nào để chạy Mời Ẩn.");
            return;
        }

        _isSilentInviteRunning = true;
        _silentInviteCts?.Dispose();
        _silentInviteCts = new CancellationTokenSource();
        var ct = _silentInviteCts.Token;

        _config.LastAutoSilentInviteUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        _config.Save();

        var tag = isScheduled ? "Tự động định kỳ" : "Lô thủ công";
        AppendLog($"👻 [Mời Ẩn • {tag}] Bắt đầu quét & tự mời ngầm {livePages.Count} Fanpage LIVE (0% che màn hình)...");
        PushOverviewStateToWebView();

        int totalInvited = 0;
        int pagesWithInvites = 0;
        int needsLoginCount = 0;

        try
        {
            for (int i = 0; i < livePages.Count && !ct.IsCancellationRequested; i++)
            {
                var pg = livePages[i];
                var res = await ExecuteSilentInviteForPageCoreAsync(pg, ct, isScheduled);
                if (res.NeedsLogin)
                {
                    needsLoginCount++;
                    AppendLog($"⚠️ [Mời Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': chưa có phiên đăng nhập trong Chrome Cô lập / Két Cookie.");
                }
                else if (res.InvitedSent > 0)
                {
                    totalInvited += res.InvitedSent;
                    pagesWithInvites++;
                    AppendLog($"✅ [Mời Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': đã mời thành công {res.InvitedSent} người!");
                }
                else
                {
                    AppendLog($"👻 [Mời Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': 0 người mới cần mời.");
                }

                PushOverviewStateToWebView();
                if (i + 1 < livePages.Count && !ct.IsCancellationRequested)
                {
                    await Task.Delay(Random.Shared.Next(8000, 15000), ct);
                }
            }

            if (totalInvited > 0)
            {
                AppendLog($"🎉 [Mời Ẩn • {tag}] Hoàn tất: đã tự động mời thành công tổng cộng {totalInvited} người trên {pagesWithInvites}/{livePages.Count} Fanpage!");
                _tray?.ShowBalloon(
                    "🎉 Mời Ẩn Tự Động Thành Công",
                    $"Đã tự động mời {totalInvited} người theo dõi trên {pagesWithInvites} Fanpage (chạy ẩn hoàn toàn).",
                    5000,
                    error: false);
            }
            else if (!isScheduled)
            {
                var msg = needsLoginCount == livePages.Count
                    ? "Các Via chưa lưu Cookie vào Két DPAPI / chưa đăng nhập Chrome Cô lập để chạy ẩn."
                    : $"Đã quét ẩn {livePages.Count} Page — hiện chưa có người mới cần mời.";
                AppendLog($"👻 [Mời Ẩn] {msg}");
                _tray?.ShowBalloon("👻 Mời Ẩn Hoàn Tất", msg, 3500, error: needsLoginCount == livePages.Count);
            }
        }
        catch (OperationCanceledException)
        {
            AppendLog($"⏹️ [Mời Ẩn] Đã dừng lô chạy ẩn (đã mời được {totalInvited} người).");
        }
        finally
        {
            _isSilentInviteRunning = false;
            PushOverviewStateToWebView();
        }
    }

    private volatile bool _isSilentPageNurtureRunning;
    private CancellationTokenSource? _silentPageNurtureCts;
    internal bool IsSilentPageNurtureRunning => _isSilentPageNurtureRunning;

    private volatile bool _isSilentPreBakeRunning;
    private CancellationTokenSource? _silentPreBakeCts;
    internal bool IsSilentPreBakeRunning => _isSilentPreBakeRunning;

    internal void CancelSilentPreBakeIfRunning()
    {
        try { _silentPreBakeCts?.Cancel(); } catch { }
    }

    internal static bool IsEmbryoVia(ViaWorkspaceEntry v, DesktopConfig cfg, LocalVaultLookupResult sec)
    {
        var hasCookie = v.HasVaultCookie || (sec.Found && !string.IsNullOrWhiteSpace(sec.CookieRaw));
        if (hasCookie) return false;
        var hasTag = cfg.ViaCustomTags != null &&
                     cfg.ViaCustomTags.TryGetValue(v.ViaId, out var tag) &&
                     !string.IsNullOrWhiteSpace(tag) &&
                     (tag.Contains("Phôi", StringComparison.OrdinalIgnoreCase) ||
                      tag.Contains("Khai Sinh", StringComparison.OrdinalIgnoreCase));
        var hasSessions = cfg.ViaPreBakeSessionCounts != null &&
                          cfg.ViaPreBakeSessionCounts.TryGetValue(v.ViaId, out var cnt) &&
                          cnt > 0;
        return string.Equals(v.RoleTier, "standby", StringComparison.OrdinalIgnoreCase) || hasTag || hasSessions;
    }

    private void MaybeNotifyReadyEmbryo(ViaWorkspaceEntry? via, int newSessionCount, int persistedCookiesCount)
    {
        if (via == null) return;
        var reqSess = Math.Clamp(_config.AutoEmbryoRequiredSessions, 2, 10);
        if (newSessionCount < reqSess) return;

        var sec = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        if (via.HasVaultCookie || !string.IsNullOrWhiteSpace(sec.CookieRaw)) return;

        _config.ViaCustomTags ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        _config.ViaCustomTags[via.ViaId] = "🔔 Chờ Khai Sinh 60s";
        _config.NotifiedReadyEmbryoIds ??= new List<string>();
        bool firstNotify = !_config.NotifiedReadyEmbryoIds.Any(x => string.Equals(x, via.ViaId, StringComparison.OrdinalIgnoreCase));
        if (firstNotify)
        {
            _config.NotifiedReadyEmbryoIds.Add(via.ViaId);
        }
        try { _config.Save(); } catch { }

        if (firstNotify)
        {
            var ckNote = persistedCookiesCount > 0 ? $" ({persistedCookiesCount} cookies nền sạch)" : "";
            _ = Dispatcher.BeginInvoke(() =>
            {
                AppendLog($"🔔 [Phôi Sạch Ủ Chín] '{via.Label}' đã đủ {newSessionCount}/{reqSess} phiên Cookie Robot{ckNote} -> Bấm 'Khai Sinh 60s' để đăng ký chính chủ!");
                _tray?.ShowBalloon(
                    "🔔 Phôi Sạch Đã Ủ Chín!",
                    $"'{via.Label}' đã ủ đủ {newSessionCount}/{reqSess} phiên Cookie sạch{ckNote}. Bấm «Khai Sinh 60s» để đăng ký chính chủ!",
                    5500,
                    error: false);
                PushOverviewStateToWebView();
            });
        }
    }

    internal async Task<ViaWorkspaceEntry?> SpawnCleanEmbryoProfileAsync(bool runInitialSilentBake = true, bool isScheduled = false)
    {
        var nextIndex = _vias.Count + 1;
        var existingLabels = new HashSet<string>(_vias.Select(v => v.Label), StringComparer.OrdinalIgnoreCase);
        string label;
        do
        {
            label = $"Phôi Dự Phòng #{nextIndex:D2} ({DateTime.Now:dd/MM})";
            if (!existingLabels.Contains(label)) break;
            nextIndex++;
        } while (nextIndex <= 999);

        var profileDir = AutoEmbryoFactoryPlanner.AllocateNextIsolatedProfileDir(
            _vias,
            _chromeProfiles.Select(p => p.Folder));
        var assignedProxy = AutoEmbryoFactoryPlanner.AllocateCleanProxyForEmbryo(
            _config.AutoEmbryoProxyPoolRaw,
            _vias,
            _config.AutoEmbryoDefaultClientGroup,
            _config.MaxViasPerProxyInBatch);
        var normEng = AntidetectBrowserConnector.NormalizeEngine(_config.DefaultBrowserEngine);
        var builtNotes = ViaMetadataParser.BuildNotes(
            "Phôi sạch tự động ủ Cookie Robot định kỳ",
            "standby",
            "",
            _config.AutoEmbryoDefaultClientGroup ?? "",
            "soak_72h",
            normEng,
            "");

        ViaWorkspaceEntry? createdVia = null;
        if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            try
            {
                var createdDto = await _api.CreatePersonalAccountAsync(new PersonalAccountUpsertRequestDto
                {
                    Label = label,
                    DisplayName = label,
                    ExternalReferenceId = null,
                    Status = "active",
                    BrowserProfileLabel = profileDir,
                    NetworkLabel = assignedProxy,
                    VaultReference = "",
                    Notes = builtNotes,
                });
                await SyncCloudAsync(silent: true);
                createdVia = _vias.FirstOrDefault(v => string.Equals(v.ViaId, createdDto.Id, StringComparison.OrdinalIgnoreCase))
                    ?? _vias.FirstOrDefault(v => string.Equals(v.Label, label, StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception ex)
            {
                AppendLog($"⚠️ [Xưởng Phôi] Chưa đồng bộ Cloud được ({ex.Message}) — khởi tạo Phôi cục bộ để tiếp tục ủ.");
            }
        }

        if (createdVia == null)
        {
            var localId = $"local-embryo-{Guid.NewGuid():N}"[..21];
            createdVia = new ViaWorkspaceEntry
            {
                ViaId = localId,
                Label = label,
                DisplayName = label,
                Status = "active",
                BrowserProfileLabel = profileDir,
                ProfileDir = profileDir,
                NetworkLabel = assignedProxy,
                RoleTier = "standby",
                ClientGroup = _config.AutoEmbryoDefaultClientGroup ?? "",
                DefaultWarmupMode = "soak_72h",
                AntidetectEngine = normEng,
            };
            _vias.Add(createdVia);
        }

        _config.ViaCustomTags ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        _config.ViaPreBakeSessionCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        _config.ViaCustomTags[createdVia.ViaId] = "🥚 Phôi Tự Động";
        if (!_config.ViaPreBakeSessionCounts.ContainsKey(createdVia.ViaId))
        {
            _config.ViaPreBakeSessionCounts[createdVia.ViaId] = 0;
        }
        _config.LastAutoEmbryoSpawnUtc = DateTimeOffset.UtcNow.ToString("O");

        if (!string.IsNullOrWhiteSpace(_config.AutoEmbryoCustomDomain))
        {
            var suggestedMail = AutoEmbryoFactoryPlanner.SuggestAgencyDomainEmail(
                _config.AutoEmbryoCustomDomain,
                nextIndex,
                DateTimeOffset.Now);
            if (!string.IsNullOrWhiteSpace(suggestedMail))
            {
                LocalSecretVaultStore.Default.UpsertFull(
                    createdVia.ViaId,
                    createdVia.Label,
                    createdVia.ProfileDir,
                    "",
                    "",
                    suggestedMail,
                    "",
                    "",
                    "",
                    allowOverwriteEmpty: false);
            }
        }

        try { createdVia.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(createdVia, config: _config); } catch { }
        ExtensionProvisioner.MarkIsolatedProfilePreBaked(createdVia.Label, createdVia.ProfileDir);
        _config.Save();

        var proxyDisp = string.IsNullOrWhiteSpace(assignedProxy) ? "Direct IP" : AutomationQueueEngine.ExtractProxyHostPort(assignedProxy);
        var modeTag = isScheduled ? "Tự động định kỳ" : "Thủ công";
        AppendLog($"🥚 [Xưởng Phôi • {modeTag}] Đã tạo '{createdVia.Label}' ({createdVia.ProfileDir} • {proxyDisp}).");
        PushOverviewStateToWebView();

        if (runInitialSilentBake)
        {
            await RunSilentPreBakeForViaAsync(createdVia, isScheduled);
        }
        return createdVia;
    }

    internal async Task<bool> RunSilentPreBakeForViaAsync(ViaWorkspaceEntry via, bool isScheduled = false)
    {
        if (_isSilentPreBakeRunning)
        {
            if (!isScheduled) AppendLog("⏳ Đang có phiên Ủ Phôi chạy ẩn khác. Vui lòng đợi vài giây...");
            return false;
        }

        _isSilentPreBakeRunning = true;
        _silentPreBakeCts?.Dispose();
        _silentPreBakeCts = new CancellationTokenSource();
        var ct = _silentPreBakeCts.Token;

        var reqSess = Math.Clamp(_config.AutoEmbryoRequiredSessions, 2, 10);
        AppendLog($"👻 [Ủ Phôi Ẩn] Đang chạy Multi-Site Cookie Robot chạy ẩn cho '{via.Label}' ({via.ProfileDir})...");
        PushOverviewStateToWebView();

        int? launchedPid = null;
        int? launchedCdpPort = null;
        try
        {
            if (IsViaProfileCurrentlyOpen(ChromeSessionTracker.Default.GetSnapshot(), via))
            {
                _ = Dispatcher.BeginInvoke(() => AppendLog($"🛑 [Ủ Phôi Ẩn] Bỏ qua '{via.Label}': Chrome Profile '{via.ProfileDir}' đang mở thủ công."));
                return false;
            }
            var (pxOk, pxReason) = await PreCheckViaProxyTcpQuickAsync(via, _config.PreCheckProxyBeforeLaunch, ct).ConfigureAwait(false);
            if (!pxOk)
            {
                _ = Dispatcher.BeginInvoke(() => AppendLog($"🛑 [Ủ Phôi Ẩn] Bỏ qua '{via.Label}': {pxReason}"));
                return false;
            }

            try { via.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(via, config: _config); } catch { }
            ExtensionProvisioner.MarkIsolatedProfilePreBaked(via.Label, via.ProfileDir);
            var envProf = ResolveViaEnvironmentProfileFor(via);
            var candidateUrls = WarmupCarePresets.ParseCookieRobotUrls(_config.CookieRobotUrls);

            var launch = await ExtensionProvisioner.LaunchChromeSmartAsync(
                "https://www.google.com/",
                via.ProfileDir,
                via.ExtensionFolder,
                isolatedMode: true,
                viaSlug: via.Label,
                antidetectShield: _config.EnableChromeAntidetectShield,
                lowRamMode: true,
                vaultCookieRaw: "",
                envProfile: envProf,
                hiddenOffscreen: true).ConfigureAwait(false);

            launchedPid = launch.Pid;
            launchedCdpPort = launch.CdpPort;
            if (!launch.CdpPort.HasValue || launch.CdpPort.Value <= 0)
            {
                _ = Dispatcher.BeginInvoke(() => AppendLog($"⚠️ [Ủ Phôi Ẩn] '{via.Label}': Không mở được cổng CDP Chrome Cô lập."));
                return false;
            }

            var res = await ChromeCdpController.RunSilentCookieRobotPreBakeAsync(launch.CdpPort.Value, candidateUrls, ct).ConfigureAwait(false);
            if (!res.Ok)
            {
                _ = Dispatcher.BeginInvoke(() => AppendLog($"⚠️ [Ủ Phôi Ẩn] '{via.Label}': {res.Detail}"));
                return false;
            }

            _ = Dispatcher.BeginInvoke(() =>
            {
                _config.ViaPreBakeSessionCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                _config.ViaLastPreBakeAtUtc ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var newCount = (_config.ViaPreBakeSessionCounts.TryGetValue(via.ViaId, out var c) ? c : 0) + 1;
                _config.ViaPreBakeSessionCounts[via.ViaId] = newCount;
                _config.ViaLastPreBakeAtUtc[via.ViaId] = DateTimeOffset.UtcNow.ToString("O");
                try { _config.Save(); } catch { }

                AppendLog($"🥚 [Ủ Phôi Ẩn] '{via.Label}' đạt {newCount}/{reqSess} phiên — {res.Detail}");
                MaybeNotifyReadyEmbryo(via, newCount, res.PersistedCookiesCount);
                PushOverviewStateToWebView();
            });
            return true;
        }
        catch (OperationCanceledException)
        {
            _ = Dispatcher.BeginInvoke(() => AppendLog($"⏹️ [Ủ Phôi Ẩn] Đã dừng phiên ủ ẩn cho '{via.Label}'."));
            return false;
        }
        catch (Exception ex)
        {
            _ = Dispatcher.BeginInvoke(() => AppendLog($"⚠️ [Ủ Phôi Ẩn] '{via.Label}' lỗi: {ex.Message}"));
            return false;
        }
        finally
        {
            if (launchedCdpPort is > 0)
            {
                try { await ChromeCdpController.CloseBrowserGracefullyAsync(launchedCdpPort.Value, 1500).ConfigureAwait(false); } catch { }
            }
            if (launchedPid is > 0)
            {
                try
                {
                    using var p = Process.GetProcessById(launchedPid.Value);
                    if (!p.HasExited) p.Kill(entireProcessTree: true);
                }
                catch { }
            }
            _isSilentPreBakeRunning = false;
            _ = Dispatcher.BeginInvoke(PushOverviewStateToWebView);
        }
    }

    internal async Task RunSilentPreBakeBatchDueAsync(bool forceAllEmbryos = false, bool isScheduled = false)
    {
        if (_isSilentPreBakeRunning)
        {
            if (!isScheduled) AppendLog("⏳ Đang có phiên Ủ Phôi chạy ẩn khác.");
            return;
        }

        var reqSess = Math.Clamp(_config.AutoEmbryoRequiredSessions, 2, 10);
        var nowUtc = DateTimeOffset.UtcNow;
        var targets = _vias
            .Where(v => !v.IsInCooldown)
            .Where(v =>
            {
                var sec = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
                if (!IsEmbryoVia(v, _config, sec)) return false;
                var curSess = (_config.ViaPreBakeSessionCounts != null && _config.ViaPreBakeSessionCounts.TryGetValue(v.ViaId, out var s)) ? s : 0;
                if (curSess >= reqSess) return false;
                if (forceAllEmbryos) return true;
                var lastUtc = (_config.ViaLastPreBakeAtUtc != null && _config.ViaLastPreBakeAtUtc.TryGetValue(v.ViaId, out var lu)) ? lu : "";
                return AutoEmbryoFactoryPlanner.IsEmbryoSessionDue(curSess, reqSess, lastUtc, nowUtc, minGapHours: 10.0);
            })
            .Take(2)
            .ToList();

        if (targets.Count == 0)
        {
            if (!isScheduled) AppendLog("ℹ️ Chưa có Phôi nào cần ủ thêm Cookie Robot lúc này.");
            return;
        }

        for (int i = 0; i < targets.Count; i++)
        {
            await RunSilentPreBakeForViaAsync(targets[i], isScheduled);
            if (i + 1 < targets.Count)
            {
                await Task.Delay(Random.Shared.Next(6000, 11000));
            }
        }
    }

    internal void CancelSilentPageNurtureIfRunning()
    {
        try { _silentPageNurtureCts?.Cancel(); } catch { }
    }

    internal async Task<ChromeCdpController.SilentPageContentResult> ExecuteSilentPageNurtureCoreAsync(
        FanpageItemDto page,
        string actionMode,
        CancellationToken ct,
        bool isScheduled = false)
    {
        var via = ResolveEffectiveViaForPage(page);
        if (via == null)
        {
            return new ChromeCdpController.SilentPageContentResult(false, false, actionMode, false, $"Không tìm thấy Via Meta cầm Page '{page.Name}' (hồ sơ Google Ads luôn được cách ly).");
        }
        if (IsViaProfileCurrentlyOpen(ChromeSessionTracker.Default.GetSnapshot(), via))
        {
            return new ChromeCdpController.SilentPageContentResult(false, false, actionMode, false, $"Chrome Profile '{via.ProfileDir}' ({via.Label}) đang mở -> bỏ qua Nuôi Page Ẩn để tránh xung đột Profile Lock.");
        }

        var vaultSecret = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        if (!CheckSilentFacebookSessionReady(via, vaultSecret, isScheduled, out var sessionDetail))
        {
            return new ChromeCdpController.SilentPageContentResult(false, true, actionMode, false, sessionDetail);
        }

        var (pxOk, pxReason) = await PreCheckViaProxyTcpQuickAsync(via, _config.PreCheckProxyBeforeLaunch, ct).ConfigureAwait(false);
        if (!pxOk)
        {
            return new ChromeCdpController.SilentPageContentResult(false, false, actionMode, false, pxReason);
        }

        var pageKey = !string.IsNullOrWhiteSpace(page.ExternalPageId) ? page.ExternalPageId! : page.Id;
        var nicheKey = page.Category ?? _batchNicheKey;
        var caption = PageContentNurtureEngine.SpinText(_config.PageCaptionSpintax, page.Name, nicheKey);
        var envProf = ResolveViaEnvironmentProfileFor(via);

        string targetUrl = "";
        string? preparedImagePath = null;
        string? tempCreatedVariantPath = null;
        bool isShare = string.Equals(actionMode, "share", StringComparison.OrdinalIgnoreCase);

        if (isShare)
        {
            var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);
            _config.PageSharedUrlHistory ??= new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            var nextUrl = PageContentNurtureEngine.PickNextShareUrl(pageKey, shareUrls, _config.PageSharedUrlHistory);
            if (string.IsNullOrWhiteSpace(nextUrl))
            {
                isShare = false;
                actionMode = "post";
                _ = Dispatcher.BeginInvoke(() =>
                    AppendLog($"ℹ️ [Nuôi Page Ẩn] Page '{page.Name}' chưa có danh sách Link nguồn chia sẻ -> tự động chuyển sang Đăng bài Ảnh Card + Caption Spin."));
            }
            else
            {
                targetUrl = nextUrl;
            }
        }

        if (!isShare)
        {
            targetUrl = !string.IsNullOrWhiteSpace(page.ExternalPageId)
                ? $"https://business.facebook.com/latest/composer?asset_id={Uri.EscapeDataString(page.ExternalPageId!)}"
                : "https://business.facebook.com/latest/composer";
            var (resolvedImg, isTempCardOrVariant) = PageContentNurtureEngine.ResolveOrGeneratePostImage(
                _config.PageAssetsDir, nicheKey, page.Name, caption, _config.EnableImageHashJitter);
            preparedImagePath = resolvedImg;
            if (isTempCardOrVariant)
            {
                tempCreatedVariantPath = resolvedImg;
            }
        }

        int? launchedPid = null;
        int? launchedCdpPort = null;
        try
        {
            var launch = await ExtensionProvisioner.LaunchChromeSmartAsync(
                targetUrl,
                via.ProfileDir,
                via.ExtensionFolder,
                isolatedMode: true,
                viaSlug: via.Label,
                antidetectShield: _config.EnableChromeAntidetectShield,
                lowRamMode: true,
                vaultCookieRaw: vaultSecret.CookieRaw,
                envProfile: envProf,
                hiddenOffscreen: true).ConfigureAwait(false);

            launchedPid = launch.Pid;
            launchedCdpPort = launch.CdpPort;
            if (!launch.CdpPort.HasValue || launch.CdpPort.Value <= 0)
            {
                return new ChromeCdpController.SilentPageContentResult(false, false, actionMode, false, "Không khởi tạo được phiên Chrome Cô lập chạy ẩn.");
            }

            var res = isShare
                ? await ChromeCdpController.RunSilentPageSharePostAsync(launch.CdpPort.Value, caption, ct).ConfigureAwait(false)
                : await ChromeCdpController.RunSilentPagePublishPostAsync(launch.CdpPort.Value, caption, preparedImagePath, ct, page.ExternalPageId).ConfigureAwait(false);

            if (res.NeedsLogin)
            {
                ViaStewardshipStore.Default.AppendEvent(
                    "PAGE_NURTURE_NO_COOKIE",
                    via.ViaId,
                    via.Label,
                    via.ClientGroup,
                    $"Cần đăng nhập lại để {(isShare ? "chia sẻ" : "đăng bài")} Page '{page.Name}'");
            }
            else if (res.Ok)
            {
                var usedFallback = res.Detail.Contains("Tier 2", StringComparison.OrdinalIgnoreCase)
                    || res.Detail.Contains("Fallback", StringComparison.OrdinalIgnoreCase)
                    || res.Detail.Contains("Pivot", StringComparison.OrdinalIgnoreCase)
                    || res.Detail.Contains("Native", StringComparison.OrdinalIgnoreCase);
                ViaStewardshipStore.Default.AppendEvent(
                    usedFallback ? "PAGE_NURTURE_FALLBACK_OK" : "PAGE_NURTURE_OK",
                    via.ViaId,
                    via.Label,
                    via.ClientGroup,
                    $"{(isShare ? "Chia sẻ" : "Đăng bài")} Page '{page.Name}': {res.Detail}");

                await TryRefreshVaultCookieFromSilentCdpAsync(launch.CdpPort.Value, via, vaultSecret).ConfigureAwait(false);
                if (isShare)
                {
                    _config.PageLocalShareCounts ??= new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    _config.PageLocalShareCounts[pageKey] = (_config.PageLocalShareCounts.TryGetValue(pageKey, out var cur) ? cur : 0) + 1;
                    _config.Save();
                }
                try
                {
                    await _api.PublishWarmupPostAsync(
                        page.Id, caption, via.ViaId, via.Label, via.ProfileDir,
                        postMode: "chrome_assist", contentType: isShare ? "share" : (res.MediaAttached ? "photo" : "post")).ConfigureAwait(false);
                }
                catch { }
            }
            else if (!res.NeedsLogin)
            {
                ViaStewardshipStore.Default.AppendEvent(
                    "PAGE_NURTURE_FAIL",
                    via.ViaId,
                    via.Label,
                    via.ClientGroup,
                    $"{(isShare ? "Chia sẻ" : "Đăng bài")} chưa xong Page '{page.Name}': {res.Detail}");
            }
            return res;
        }
        finally
        {
            if (launchedCdpPort is > 0)
            {
                try { await ChromeCdpController.CloseBrowserGracefullyAsync(launchedCdpPort.Value, 1500).ConfigureAwait(false); } catch { }
            }
            if (launchedPid is > 0)
            {
                try
                {
                    using var p = Process.GetProcessById(launchedPid.Value);
                    if (!p.HasExited) p.Kill(entireProcessTree: true);
                }
                catch { }
            }
            CleanupTempNurtureVariantFile(tempCreatedVariantPath, null);
        }
    }

    internal async Task RunSilentPageNurtureSingleAsync(FanpageItemDto page, string actionMode)
    {
        if (_isSilentPageNurtureRunning)
        {
            AppendLog("⏳ Đang có phiên Đăng/Share Ẩn khác chạy ngầm. Vui lòng đợi vài giây...");
            return;
        }
        _isSilentPageNurtureRunning = true;
        _silentPageNurtureCts?.Dispose();
        _silentPageNurtureCts = new CancellationTokenSource();
        var ct = _silentPageNurtureCts.Token;

        var label = string.Equals(actionMode, "share", StringComparison.OrdinalIgnoreCase) ? "Chia sẻ bài Ẩn" : "Đăng bài Ảnh Ẩn";
        AppendLog($"👻 [{label}] Đang chạy ngầm 100% tự động cho Page '{page.Name}' (không mở cửa sổ che màn hình)...");
        PushOverviewStateToWebView();

        try
        {
            var res = await ExecuteSilentPageNurtureCoreAsync(page, actionMode, ct);
            if (res.NeedsLogin)
            {
                AppendLog($"⚠️ [{label}] Page '{page.Name}': {res.Detail}");
                _tray?.ShowBalloon($"👻 {label} cần Cookie", $"Page '{page.Name}': hãy lưu Cookie Via vào Két DPAPI hoặc bấm 'Thu Cookie đang mở'.", 4500, error: true);
            }
            else if (res.Ok)
            {
                AppendLog($"✅ [{label}] Page '{page.Name}': {res.Detail}");
                _tray?.ShowBalloon($"✅ {label} Thành Công", $"Page '{page.Name}': {res.Detail}", 4200, error: false);
            }
            else
            {
                AppendLog($"⚠️ [{label}] Page '{page.Name}': {res.Detail}");
                _tray?.ShowBalloon($"⚠️ {label} Chưa Hoàn Tất", $"Page '{page.Name}': {res.Detail}", 3800, error: true);
            }
        }
        catch (OperationCanceledException)
        {
            AppendLog($"⏹️ [{label}] Đã dừng phiên chạy ẩn cho Page '{page.Name}'.");
        }
        finally
        {
            _isSilentPageNurtureRunning = false;
            PushOverviewStateToWebView();
        }
    }

    internal async Task RunSilentPageNurtureBatchAsync(string rawMode, bool isScheduled = false)
    {
        if (_isSilentPageNurtureRunning)
        {
            if (!isScheduled) AppendLog("⏳ Đang có phiên Nuôi Page chạy ẩn khác.");
            return;
        }
        var mode = rawMode is "post" or "share" or "alternate" ? rawMode : "alternate";
        var livePages = (_pagesSummary?.Items ?? new())
            .Where(p => string.Equals(p.HealthStatus, "LIVE", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(p.ExternalPageId))
            .OrderBy(p => p.WarmupPostsCount)
            .Take(5)
            .ToList();
        if (livePages.Count == 0)
        {
            if (!isScheduled) AppendLog("⚠️ Chưa có Fanpage LIVE nào để chạy Nuôi Page Ẩn.");
            return;
        }

        _isSilentPageNurtureRunning = true;
        _silentPageNurtureCts?.Dispose();
        _silentPageNurtureCts = new CancellationTokenSource();
        var ct = _silentPageNurtureCts.Token;

        _config.LastAutoSilentPageNurtureUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        _config.Save();

        var tag = isScheduled ? "Tự động định kỳ" : "Lô thủ công";
        var shareUrls = PageContentNurtureEngine.ParseShareUrls(_config.PageShareSourceUrls);
        AppendLog($"👻 [Nuôi Page Ẩn • {tag}] Bắt đầu chạy ẩn 100% tự động cho {livePages.Count} Fanpage LIVE (Chế độ: {mode})...");
        PushOverviewStateToWebView();

        int okCount = 0;
        int loginMissing = 0;
        try
        {
            for (int i = 0; i < livePages.Count && !ct.IsCancellationRequested; i++)
            {
                var pg = livePages[i];
                var stepMode = mode == "share" || (mode == "alternate" && shareUrls.Count > 0 && i % 2 == 1) ? "share" : "post";
                var res = await ExecuteSilentPageNurtureCoreAsync(pg, stepMode, ct, isScheduled);
                if (res.NeedsLogin)
                {
                    loginMissing++;
                    AppendLog($"⚠️ [Nuôi Page Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': chưa có Cookie đăng nhập trong Két DPAPI.");
                }
                else if (res.Ok)
                {
                    okCount++;
                    AppendLog($"✅ [Nuôi Page Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': {res.Detail}");
                }
                else
                {
                    AppendLog($"⚠️ [Nuôi Page Ẩn] ({i + 1}/{livePages.Count}) '{pg.Name}': {res.Detail}");
                }

                PushOverviewStateToWebView();
                if (i + 1 < livePages.Count && !ct.IsCancellationRequested)
                {
                    await Task.Delay(Random.Shared.Next(15000, 28000), ct);
                }
            }

            if (okCount > 0)
            {
                AppendLog($"🎉 [Nuôi Page Ẩn • {tag}] Hoàn tất: đã tự động đăng/chia sẻ thành công cho {okCount}/{livePages.Count} Fanpage!");
                _tray?.ShowBalloon("🎉 Nuôi Page Ẩn Thành Công", $"Đã tự động đăng/chia sẻ thành công cho {okCount}/{livePages.Count} Fanpage.", 4800, error: false);
            }
            else if (!isScheduled)
            {
                var msg = loginMissing == livePages.Count
                    ? "Các Via chưa lưu Cookie vào Két DPAPI — hãy mở Via 1 lần rồi bấm '🔑 Thu Cookie đang mở'."
                    : "Chưa đăng/chia sẻ được bài nào trong lô chạy ẩn này (xem Nhật ký để biết chi tiết).";
                _tray?.ShowBalloon("👻 Nuôi Page Ẩn", msg, 4000, error: true);
            }
        }
        catch (OperationCanceledException)
        {
            AppendLog($"⏹️ [Nuôi Page Ẩn] Đã dừng lô chạy ẩn (đã xong {okCount} Page).");
        }
        finally
        {
            _isSilentPageNurtureRunning = false;
            PushOverviewStateToWebView();
        }
    }

    internal async Task HarvestCookiesFromOpenIsolatedSessionsAsync()
    {
        var activeSessions = ChromeSessionTracker.Default.GetSnapshot()
            .Where(s => s.Alive && s.CdpPort.HasValue && s.CdpPort.Value > 0)
            .ToList();
        if (activeSessions.Count == 0)
        {
            AppendLog("ℹ️ Hiện không có cửa sổ Chrome Cô lập (CDP) nào đang mở để thu Cookie. Hãy bấm 'Mở Chrome' cho Via trước rồi bấm 'Thu Cookie đang mở'.");
            _tray?.ShowBalloon("🔑 Thu Cookie DPAPI", "Chưa có Chrome Cô lập nào đang mở. Hãy mở Via bằng Chrome Cô lập trước.", 3500, error: false);
            return;
        }

        int savedCount = 0;
        foreach (var sess in activeSessions)
        {
            var cookieRaw = await ChromeCdpController.TryHarvestFacebookCookieHeaderAsync(sess.CdpPort!.Value, 2500);
            if (string.IsNullOrWhiteSpace(cookieRaw)) continue;
            var via = _vias.FirstOrDefault(v => string.Equals(v.ViaId, sess.ViaId, StringComparison.OrdinalIgnoreCase)
                                             || string.Equals(v.Label, sess.ViaLabel, StringComparison.OrdinalIgnoreCase));
            var targetViaId = via?.ViaId ?? sess.ViaId;
            var targetLabel = via?.Label ?? sess.ViaLabel;
            var targetProfile = via?.ProfileDir ?? sess.ProfileDir;
            var existing = LocalSecretVaultStore.Default.Find(targetViaId, targetProfile, targetLabel);
            LocalSecretVaultStore.Default.Upsert(targetViaId, targetLabel, targetProfile, cookieRaw, existing.TwoFaSecret);
            if (via != null)
            {
                via.HasVaultCookie = true;
            }
            savedCount++;
            AppendLog($"🔑 [Thu Cookie DPAPI] Đã lưu Cookie Facebook sạch cho Via '{targetLabel}' vào Két DPAPI!");
        }

        if (savedCount > 0)
        {
            _tray?.ShowBalloon("🔑 Thu Cookie DPAPI Thành Công", $"Đã lưu Cookie cho {savedCount} Via vào Két DPAPI — sẵn sàng chạy Ẩn 100%!", 4200, error: false);
            PushOverviewStateToWebView();
        }
        else
        {
            AppendLog("⚠️ Không tìm thấy phiên Facebook đã đăng nhập (c_user + xs) trong các cửa sổ Chrome Cô lập đang mở.");
            _tray?.ShowBalloon("🔑 Thu Cookie DPAPI", "Chưa phát hiện Facebook đã đăng nhập trong Chrome Cô lập đang mở.", 3500, error: true);
        }
    }

    internal static int TryExtractParenthesizedCount(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return 0;
        var m = System.Text.RegularExpressions.Regex.Match(text, @"\((\d+)\)");
        return m.Success && int.TryParse(m.Groups[1].Value, out var n) ? Math.Clamp(n, 0, 9999) : 0;
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
                if (!_overviewWebViewFailed || _activeView is AppView.PagesBm or AppView.Overview or AppView.Automation)
                {
                    RenderCurrentView();
                }
            });
        }
    }

    // Non-intrusive UIAutomation helpers for Native Browser Auto-Invite (NEVER moves physical cursor or steals focus)
    private System.Threading.CancellationTokenSource? _autoInviteCts;
    internal bool IsAutoInviteRunning => _autoInviteCts != null;
    internal string ActiveAutoInvitePageId { get; private set; } = "";

    internal void CancelAutoInvite()
    {
        try { _autoInviteCts?.Cancel(); } catch { }
        _autoInviteCts = null;
        ActiveAutoInvitePageId = "";
        AppendLog("⏹️ Đã dừng tác vụ Auto-Invite Followers theo yêu cầu.");
        if (!_overviewWebViewFailed || _activeView is AppView.PagesBm or AppView.Automation or AppView.Overview)
        {
            RenderCurrentView();
        }
    }

    private delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

    private const uint WM_GETOBJECT = 0x003D;
    private const int OBJID_CLIENT = unchecked((int)0xFFFFFFFC);

    private static bool TryInvokeElementNonIntrusive(AutomationElement? el)
    {
        var cur = el;
        for (int depth = 0; depth < 4 && cur != null; depth++)
        {
            try
            {
                if (cur.TryGetCurrentPattern(InvokePattern.Pattern, out var ipObj) && ipObj is InvokePattern ip)
                {
                    ip.Invoke();
                    return true;
                }
            }
            catch { }

            try
            {
                if (cur.TryGetCurrentPattern(TogglePattern.Pattern, out var tpObj) && tpObj is TogglePattern tp)
                {
                    tp.Toggle();
                    return true;
                }
            }
            catch { }

            try
            {
                if (cur.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var spObj) && spObj is SelectionItemPattern sp)
                {
                    sp.Select();
                    return true;
                }
            }
            catch { }

            try
            {
                cur = TreeWalker.ControlViewWalker.GetParent(cur);
            }
            catch
            {
                break;
            }
        }
        return false;
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
            // Wake up Chrome renderer accessibility tree immediately via WM_GETOBJECT (OBJID_CLIENT) without stealing focus
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
        try { _autoInviteCts?.Cancel(); } catch { }
        var cts = new System.Threading.CancellationTokenSource();
        _autoInviteCts = cts;
        ActiveAutoInvitePageId = page.Id ?? page.ExternalPageId ?? "";
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (_activeView is AppView.PagesBm or AppView.Automation) RenderCurrentView();
        });

        var ct = cts.Token;
        try
        {
            await Task.Delay(3800, ct).ConfigureAwait(false);
            int detectedCount = -1;
            bool modalOpened = false;
            int invitedClicks = 0;

            for (int attempt = 0; attempt < 18 && !ct.IsCancellationRequested; attempt++)
            {
                try
                {
                    var completed = await Task.Run(() =>
                    {
                        if (ct.IsCancellationRequested) return false;
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

                        // Auto-detect if the Meta Business Suite invite modal is already open on screen
                        if (!modalOpened)
                        {
                            bool hasModalHeader = elements.Any(x =>
                                x.Name.Contains("Mời mọi người tương tác với nội dung", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.Contains("Invite people who interacted", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Bình luận (", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Comments (", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Cảm xúc (", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Reactions (", StringComparison.OrdinalIgnoreCase));
                            if (hasModalHeader)
                            {
                                modalOpened = true;
                            }
                        }

                        // If modal is already open: read BOTH "Cảm xúc (X)" & "Bình luận (Y)" tabs, update tool count, switch tab if needed, Select All and click "Gửi lời mời (N)"
                        if (modalOpened)
                        {
                            var reactTabEl = elements.FirstOrDefault(x =>
                                x.Name.StartsWith("Cảm xúc", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Reactions", StringComparison.OrdinalIgnoreCase));
                            var commentTabEl = elements.FirstOrDefault(x =>
                                x.Name.StartsWith("Bình luận", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Comments", StringComparison.OrdinalIgnoreCase));
                            int reactTabCount = TryExtractParenthesizedCount(reactTabEl.Name);
                            int commentTabCount = TryExtractParenthesizedCount(commentTabEl.Name);

                            var preSendBtn = elements.FirstOrDefault(x =>
                                (x.Type == ControlType.Button || x.Type == ControlType.Custom || x.Type == ControlType.Text) &&
                                !x.Name.Contains("bạn bè", StringComparison.OrdinalIgnoreCase) &&
                                !x.Name.Contains("friends", StringComparison.OrdinalIgnoreCase) &&
                                (x.Name.StartsWith("Gửi lời mời", StringComparison.OrdinalIgnoreCase) ||
                                 x.Name.StartsWith("Send invitation", StringComparison.OrdinalIgnoreCase) ||
                                 x.Name.StartsWith("Send invite", StringComparison.OrdinalIgnoreCase)));
                            int preSendCount = TryExtractParenthesizedCount(preSendBtn.Name);

                            int modalTotalPending = Math.Max(reactTabCount + commentTabCount, preSendCount);
                            if (modalTotalPending > 0 && modalTotalPending != detectedCount)
                            {
                                detectedCount = modalTotalPending;
                                SetPagePendingInviteCount(page, modalTotalPending, renderNow: true);
                                _ = Dispatcher.BeginInvoke(() =>
                                    AppendLog($"🔔 [Auto-Invite] Phát hiện {modalTotalPending} người cần mời trên '{page.Name}' (Cảm xúc: {reactTabCount} • Bình luận: {commentTabCount})."));
                            }

                            var checkBoxes = elements
                                .Where(x => x.Type == ControlType.CheckBox && x.Bounds.Width >= 8 && x.Bounds.Height >= 8)
                                .ToList();

                            // If current tab has no selectable people but "Bình luận (Y)" has pending people, switch to Comments tab
                            if (checkBoxes.Count == 0 && preSendCount == 0 && commentTabCount > 0 && commentTabEl.El != null)
                            {
                                if (TryInvokeElementNonIntrusive(commentTabEl.El))
                                {
                                    _ = Dispatcher.BeginInvoke(() =>
                                        AppendLog($"💬 [Auto-Invite] Tab Cảm xúc trống -> tự động chuyển sang tab '{commentTabEl.Name}' trên Page '{page.Name}'..."));
                                    System.Threading.Thread.Sleep(550);
                                    return false;
                                }
                            }

                            var selectAllEl = elements.FirstOrDefault(x =>
                                x.Name.StartsWith("Chọn tất cả", StringComparison.OrdinalIgnoreCase) ||
                                x.Name.StartsWith("Select all", StringComparison.OrdinalIgnoreCase));

                            if (selectAllEl.El != null && invitedClicks == 0 && preSendCount == 0)
                            {
                                if (TryInvokeElementNonIntrusive(selectAllEl.El))
                                {
                                    invitedClicks = Math.Max(1, modalTotalPending > 0 ? modalTotalPending : (detectedCount > 0 ? detectedCount : 1));
                                    System.Threading.Thread.Sleep(350);
                                }
                            }

                            int alreadyCheckedCount = 0;
                            if (checkBoxes.Count > 0)
                            {
                                int toCheck = Math.Min(maxInvites, checkBoxes.Count);
                                int newlyToggled = 0;
                                for (int i = 0; i < toCheck && !ct.IsCancellationRequested; i++)
                                {
                                    var cb = checkBoxes[i];
                                    try
                                    {
                                        if (cb.El.TryGetCurrentPattern(TogglePattern.Pattern, out var tpObj) && tpObj is TogglePattern tp)
                                        {
                                            if (tp.Current.ToggleState == ToggleState.Off)
                                            {
                                                tp.Toggle();
                                                newlyToggled++;
                                            }
                                            else if (tp.Current.ToggleState == ToggleState.On)
                                            {
                                                alreadyCheckedCount++;
                                            }
                                        }
                                        else if (invitedClicks == 0 && TryInvokeElementNonIntrusive(cb.El))
                                        {
                                            newlyToggled++;
                                        }
                                    }
                                    catch { }
                                    System.Threading.Thread.Sleep(80);
                                }
                                int totalSelected = newlyToggled + alreadyCheckedCount;
                                if (totalSelected > 0)
                                {
                                    invitedClicks = Math.Max(invitedClicks, totalSelected);
                                }
                            }

                            if (preSendCount > 0)
                            {
                                invitedClicks = Math.Max(invitedClicks, preSendCount);
                            }

                            // Re-query fresh UIAutomation elements after selecting checkboxes so the newly-enabled "Gửi lời mời (X)" button is captured accurately
                            if (invitedClicks > 0)
                            {
                                System.Threading.Thread.Sleep(750);
                                FindActiveMetaBusinessSuiteChromeWindow();
                                var freshAll = root.FindAll(TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition);
                                if (freshAll != null && freshAll.Count > 0)
                                {
                                    elements.Clear();
                                    foreach (AutomationElement el in freshAll)
                                    {
                                        try
                                        {
                                            if (!el.Current.IsEnabled) continue;
                                            var nm = (el.Current.Name ?? "").Trim();
                                            if (string.IsNullOrEmpty(nm)) continue;
                                            var b = el.Current.BoundingRectangle;
                                            if (double.IsInfinity(b.Width) || double.IsInfinity(b.Height) || b.Width <= 2 || b.Height <= 2) continue;
                                            elements.Add((el, nm, el.Current.ControlType, b));
                                        }
                                        catch { }
                                    }
                                }
                            }

                            var confirmSendBtns = elements.Where(x =>
                                (x.Type == ControlType.Button || x.Type == ControlType.Custom || x.Type == ControlType.Text) &&
                                !x.Name.Contains("bạn bè", StringComparison.OrdinalIgnoreCase) &&
                                !x.Name.Contains("friends", StringComparison.OrdinalIgnoreCase) &&
                                (x.Name.StartsWith("Gửi lời mời", StringComparison.OrdinalIgnoreCase) ||
                                 x.Name.StartsWith("Send invitation", StringComparison.OrdinalIgnoreCase) ||
                                 x.Name.StartsWith("Send invite", StringComparison.OrdinalIgnoreCase)))
                                .OrderByDescending(x => x.Name.Contains('(') ? 1 : 0)
                                .ThenByDescending(x => x.Bounds.Top)
                                .ToList();

                            if (confirmSendBtns.Count > 0 && invitedClicks > 0)
                            {
                                var finalBtn = confirmSendBtns[0];
                                if (TryInvokeElementNonIntrusive(finalBtn.El))
                                {
                                    _ = Dispatcher.BeginInvoke(() =>
                                        AppendLog($"🚀 [Auto-Invite] Đã tự động chọn tất cả ({invitedClicks} người bình luận & thả cảm xúc) và nhấn '{finalBtn.Name}' thành công!"));
                                    return true;
                                }
                            }

                            var singleInviteBtns = elements.Where(x =>
                                (x.Type == ControlType.Button || x.Type == ControlType.Custom || x.Type == ControlType.Text) &&
                                (string.Equals(x.Name, "Mời", StringComparison.OrdinalIgnoreCase) ||
                                 string.Equals(x.Name, "Invite", StringComparison.OrdinalIgnoreCase))).ToList();

                            if (singleInviteBtns.Count > 0)
                            {
                                int toClick = Math.Min(maxInvites, singleInviteBtns.Count);
                                for (int i = 0; i < toClick && !ct.IsCancellationRequested; i++)
                                {
                                    var b = singleInviteBtns[i];
                                    if (TryInvokeElementNonIntrusive(b.El))
                                    {
                                        invitedClicks++;
                                    }
                                    System.Threading.Thread.Sleep(250);
                                }
                                return invitedClicks > 0;
                            }
                        }

                        // Optional #4: Auto-Like customer comments on Meta Business Suite if enabled
                        if (_config.AutoLikeCommentsOnPageInvite && attempt == 0)
                        {
                            var likeBtns = elements
                                .Where(x =>
                                    (x.Type == ControlType.Button || x.Type == ControlType.Custom || x.Type == ControlType.Text) &&
                                    (string.Equals(x.Name, "Thích", StringComparison.OrdinalIgnoreCase) ||
                                     string.Equals(x.Name, "Like", StringComparison.OrdinalIgnoreCase)))
                                .Take(2)
                                .ToList();
                            foreach (var lb in likeBtns)
                            {
                                TryInvokeElementNonIntrusive(lb.El);
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
                                // Scroll down non-intrusively via ScrollPattern if available
                                try
                                {
                                    foreach (AutomationElement el in all)
                                    {
                                        if (el.TryGetCurrentPattern(ScrollPattern.Pattern, out var scObj) && scObj is ScrollPattern sc && sc.Current.VerticallyScrollable)
                                        {
                                            sc.Scroll(ScrollAmount.NoAmount, ScrollAmount.LargeIncrement);
                                            break;
                                        }
                                    }
                                }
                                catch { }
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

                            if (sendBtn.El != null && TryInvokeElementNonIntrusive(sendBtn.El))
                            {
                                modalOpened = true;
                                _ = Dispatcher.BeginInvoke(() =>
                                    AppendLog($"🤖 [Auto-Invite] Đã kích hoạt ngầm nút 'Gửi lời mời' trên Meta Business Suite cho Page '{page.Name}' (không chiếm chuột)..."));
                            }
                        }

                        return false;
                    }, ct).ConfigureAwait(false);

                    if (completed)
                    {
                        var sentNow = invitedClicks > 0 ? invitedClicks : Math.Max(0, detectedCount);
                        if (sentNow > 0)
                        {
                            _config.TotalPageFollowerInvitesSent += sentNow;
                            try { _config.Save(); } catch { }
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
                        var holderVia = ResolveEffectiveViaForPage(page);
                        _queue.MarkItemCompleted(holderVia?.ViaId, holderVia?.Label);
                        _ = Dispatcher.BeginInvoke(RenderCurrentView);
                        return;
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch { }

                await Task.Delay(2500, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            if (ReferenceEquals(_autoInviteCts, cts))
            {
                _autoInviteCts = null;
                ActiveAutoInvitePageId = "";
                _ = Dispatcher.BeginInvoke(() =>
                {
                    if (!_overviewWebViewFailed || _activeView is AppView.PagesBm or AppView.Automation) RenderCurrentView();
                });
            }
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
        var targetUrl = BuildPageAutoInviteUrl(page, _config.MaxPageFollowerInvitesPerRun, autoClose, _config.AutoLikeCommentsOnPageInvite);
        var likeHint = _config.AutoLikeCommentsOnPageInvite ? " + Tự thả Like bình luận khách" : "";
        AppendLog($"🤝 Khởi chạy Auto-Invite Followers{likeHint} cho Page '{page.Name}' qua '{via.Label}' (Chrome: {via.ProfileDir}) — Tự động chọn tất cả & gửi lời mời (0% chiếm chuột)...");
        LaunchViaChromeSafe(via, targetUrl);
        _ = RunNativeUiAutoInviteForPageAsync(page, _config.MaxPageFollowerInvitesPerRun);
    }

    public void EnqueueBatchPageAutoInviteFollowers(bool requireConfirm = true)
    {
        if (_queue.Current.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.Syncing or QueuePhase.NightPaused)
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
            var url = BuildPageAutoInviteUrl(p, _config.MaxPageFollowerInvitesPerRun, autoClose: _config.AutoCloseKeepAliveTab, autoLikeComments: _config.AutoLikeCommentsOnPageInvite);
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

        var restMin = Math.Clamp(_config.QueueRestMinSeconds < 5 ? 15 : _config.QueueRestMinSeconds, 5, 300);
        var restMax = Math.Clamp(_config.QueueRestMaxSeconds < restMin ? restMin + 10 : _config.QueueRestMaxSeconds, restMin, 600);
        _queue.ConfigureRestRange(restMin, restMax);
        _queue.StartQueue(
            QueueKind.KeepAlive,
            tasks,
            restMin,
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
        var now = DateTime.Now;
        // #7 Daily Automatic Vault Backup (.adsopsvault)
        RunDailyAutoVaultBackupIfNeeded(force: false);

        // Silent 6-hour background update check
        if ((DateTime.UtcNow - _lastAutoUpdateCheckUtc).TotalHours >= 6)
        {
            _ = CheckForAppUpdatesAsync(silent: true);
        }

        if (IsLicenseReadOnly(out _)) return;
        if (_autoPipelineRunning) return;
        if (_queue.Current.Phase != QueuePhase.Idle && _queue.Current.Phase != QueuePhase.Completed) return;

        bool hasLiveCloud = !string.IsNullOrWhiteSpace(_config.GetJwt()) && !_isOfflineSnapshotMode && !_isAuthExpired;

        // #6 Multi-Time Specific Schedule (e.g. "08:30, 20:00") — requires active Cloud link
        if (hasLiveCloud && _config.AutoDailyFullPipeline)
        {
            var matchedSlot = DesktopConfig.FindMatchingScheduleSlot(_config.AutoPilotScheduleTimesCsv, now, _config.LastTriggeredScheduleSlotKey);
            if (!string.IsNullOrWhiteSpace(matchedSlot))
            {
                _config.LastTriggeredScheduleSlotKey = matchedSlot;
                _config.LastAutoPipelineDateLocal = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                _config.Save();
                AppendLog($"⏰ [Hẹn Giờ Auto-Pilot] Đến khung giờ '{matchedSlot}' -> Tự động khởi chạy Chu trình Khép Kín 5 Bước...");
                await RunFullAutoPilotPipelineAsync(interactiveConfirm: false);
                return;
            }
        }

        if (now.Hour < _config.AutoKeepAliveStartHour || now.Hour >= _config.AutoKeepAliveEndHour) return;

        // v3.6.0 Scheduled Silent Background Auto-Invite (runs off-screen without opening visible Chrome)
        if (_config.AutoSilentInviteEnabled && !_isSilentInviteRunning && !IsAutoInviteRunning)
        {
            int intervalMin = Math.Clamp(_config.AutoSilentInviteIntervalMinutes, 15, 480);
            bool dueSilent = true;
            if (!string.IsNullOrWhiteSpace(_config.LastAutoSilentInviteUtc) &&
                DateTimeOffset.TryParse(_config.LastAutoSilentInviteUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var lastSilentDto))
            {
                if ((DateTimeOffset.UtcNow - lastSilentDto).TotalMinutes < intervalMin)
                {
                    dueSilent = false;
                }
            }
            if (dueSilent)
            {
                _ = RunSilentInviteBatchPagesAsync(isScheduled: true);
                return;
            }
        }

        // v3.7.0 Scheduled Silent Background Page Nurture (14-Day Auto-Post Media / Auto-Share via CDP)
        if (_config.AutoSilentPageNurtureEnabled && !_isSilentPageNurtureRunning && !_isSilentInviteRunning && !IsAutoInviteRunning)
        {
            int intervalHrs = Math.Clamp(_config.AutoSilentPageNurtureIntervalHours, 4, 48);
            bool dueNurture = true;
            if (!string.IsNullOrWhiteSpace(_config.LastAutoSilentPageNurtureUtc) &&
                DateTimeOffset.TryParse(_config.LastAutoSilentPageNurtureUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var lastNurtureDto))
            {
                if ((DateTimeOffset.UtcNow - lastNurtureDto).TotalHours < intervalHrs)
                {
                    dueNurture = false;
                }
            }
            if (dueNurture)
            {
                _ = RunSilentPageNurtureBatchAsync(_config.PageNurtureMode, isScheduled: true);
                return;
            }
        }

        // v3.9.0 Scheduled 2-3 Day Auto Embryo Spawner & Silent Cookie Pre-Bake
        if (_config.AutoEmbryoFactoryEnabled && !_isSilentPreBakeRunning && !_isSilentInviteRunning && !_isSilentPageNurtureRunning && !IsAutoInviteRunning)
        {
            var reqSess = Math.Clamp(_config.AutoEmbryoRequiredSessions, 2, 10);
            var nowUtc = DateTimeOffset.UtcNow;
            var pendingEmbryos = _vias.Count(v => IsEmbryoVia(v, _config, LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label)));
            if (AutoEmbryoFactoryPlanner.IsSpawnDue(
                    _config.AutoEmbryoFactoryEnabled,
                    _config.AutoEmbryoSpawnIntervalDays,
                    _config.LastAutoEmbryoSpawnUtc,
                    pendingEmbryos,
                    _config.AutoEmbryoMaxPending,
                    nowUtc))
            {
                _ = SpawnCleanEmbryoProfileAsync(runInitialSilentBake: true, isScheduled: true);
                return;
            }

            bool hasDueEmbryoSession = _vias.Any(v =>
            {
                if (v.IsInCooldown) return false;
                var sec = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
                if (!IsEmbryoVia(v, _config, sec)) return false;
                var curSess = (_config.ViaPreBakeSessionCounts != null && _config.ViaPreBakeSessionCounts.TryGetValue(v.ViaId, out var s)) ? s : 0;
                var lastUtc = (_config.ViaLastPreBakeAtUtc != null && _config.ViaLastPreBakeAtUtc.TryGetValue(v.ViaId, out var lu)) ? lu : "";
                return AutoEmbryoFactoryPlanner.IsEmbryoSessionDue(curSess, reqSess, lastUtc, nowUtc, minGapHours: 10.0);
            });
            if (hasDueEmbryoSession)
            {
                _ = RunSilentPreBakeBatchDueAsync(forceAllEmbryos: false, isScheduled: true);
                return;
            }
        }

        if (hasLiveCloud && _config.AutoDailyFullPipeline && string.IsNullOrWhiteSpace(_config.AutoPilotScheduleTimesCsv))
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
        try
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

            if (_liveRunnerActive)
            {
                if (_liveRunnerPaused || _queueSnapshot.Phase == QueuePhase.Paused)
                {
                    if (_liveRunnerStartedAtUtc != DateTime.MinValue) _liveRunnerStartedAtUtc = _liveRunnerStartedAtUtc.AddSeconds(1);
                    if (_liveRunnerStepStartedAtUtc != DateTime.MinValue) _liveRunnerStepStartedAtUtc = _liveRunnerStepStartedAtUtc.AddSeconds(1);
                }
                else if (_liveRunnerStartedAtUtc != DateTime.MinValue &&
                         (utcNow - _liveRunnerStartedAtUtc).TotalSeconds > 6 &&
                         ChromeSessionTracker.Default.GetActiveAutomationBrowserCount() == 0)
                {
                    _liveRunnerActive = false;
                    _liveRunnerPaused = false;
                    AppendLog("ℹ️ Phát hiện cửa sổ Chrome Auto đã đóng thủ công — Kết thúc phiên theo dõi kịch bản.");
                }
                UpdateLiveQueueWidgets();
            }

            if (++_watchdogTickCount % 5 == 0)
            {
                RefreshLiveSessionTelemetryOnVias();
                if (_queueSnapshot.Phase is QueuePhase.Running or QueuePhase.Syncing)
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
            if (!_overviewWebViewFailed && !_liveRunnerActive)
            {
                PushLiveTickToWebView();
            }
        }
        catch (Exception ex)
        {
            var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AdsOpsDesktop", "runtime.log");
            try { File.AppendAllText(logPath, $"[{DateTime.UtcNow:O}] OnUiSecondTick EXCEPTION: {ex}\n"); } catch { }
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
        var themeBtn = UiComponents.CreateButton(paletteLabel, ButtonVariant.Secondary, compact: true, onClick: (_, _) => ToggleUiThemePalette(), tooltip: "Chuyển đổi chủ đề màu UI/UX Pro Max (Linear Obsidian <-> Emerald Cyber-Vault)");
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
        if (!_overviewWebViewFailed) PushLiveTickToWebView();
    }

    private void AppendLog(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        try
        {
            var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AdsOpsDesktop", "runtime.log");
            File.AppendAllText(logPath, line + Environment.NewLine);
        }
        catch { }

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
            if (!_overviewWebViewFailed)
            {
                PushLiveTickToWebView();
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

    private void ToggleUiThemePalette()
    {
        var nextPalette = ThemeTokens.CurrentPalette == "emerald" ? "obsidian" : "emerald";
        _config.UiThemePalette = nextPalette;
        _config.Save();
        ThemeTokens.ApplyPalette(nextPalette);
        Background = ThemeTokens.BgCanvas;
        Foreground = ThemeTokens.TextPrimary;
        if (_overviewWebViewFailed)
        {
            _navButtons.Clear();
            _navBadges.Clear();
            BuildShellLayout();
            UpdateNavStyles();
            RefreshHeaderAndSidebar();
        }
        else if (_overviewWebView != null)
        {
            _overviewWebViewHost!.Background = ThemeTokens.BgCanvas;
            _overviewWebView.DefaultBackgroundColor = GetWebViewBgColor();
        }
        RenderCurrentView();
        AppendLog($"🎨 Đã chuyển giao diện UI/UX sang chủ đề '{(nextPalette == "emerald" ? "Emerald Cyber-Vault" : "Linear Obsidian")}'.");
    }

    private bool HandleShortcutKey(Key key, ModifierKeys modifiers)
    {
        if (key == Key.F5 && modifiers == ModifierKeys.None)
        {
            _ = SyncCloudAsync(silent: false);
            return true;
        }

        if (modifiers != ModifierKeys.Control) return false;

        switch (key)
        {
            case Key.K:
            case Key.P:
                OpenCommandPaletteDialog();
                return true;
            case Key.B:
                if (!string.IsNullOrWhiteSpace(_config.GetJwt())) OpenBulkImportViasDialog();
                else SwitchView(AppView.Settings);
                return true;
            case Key.N:
                if (!string.IsNullOrWhiteSpace(_config.GetJwt())) OpenViaEditorDialog(null);
                else SwitchView(AppView.Settings);
                return true;
            case Key.D1:
                SwitchView(AppView.Overview);
                return true;
            case Key.D2:
                SwitchView(AppView.Vias);
                return true;
            case Key.D3:
                SwitchView(AppView.Automation);
                return true;
            case Key.D4:
                SwitchView(AppView.PagesBm);
                return true;
            case Key.D5:
                SwitchView(AppView.AdAccounts);
                return true;
            case Key.D6:
                SwitchView(AppView.HealthTokens);
                return true;
            case Key.D7:
                SwitchView(AppView.WorkspaceOps);
                return true;
            case Key.D8:
                SwitchView(AppView.Settings);
                return true;
            default:
                return false;
        }
    }

    private void OnMainWindowPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (HandleShortcutKey(e.Key, Keyboard.Modifiers))
        {
            e.Handled = true;
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
        CancelSilentPreBakeIfRunning();
        StopQueueAndActiveRunners();
        _queue.Dispose();
        _bridge?.Dispose();
        _tray?.Dispose();
        try { _overviewWebView?.Dispose(); } catch { }
        Application.Current.Shutdown();
    }

    // =====================================================================
}
