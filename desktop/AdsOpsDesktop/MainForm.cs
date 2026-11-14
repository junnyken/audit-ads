using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace AdsOpsDesktop;

public sealed class MainForm : Form
{
    private readonly DesktopConfig _config;
    private readonly AdsOpsApiClient _api = new();
    private LocalBridgeServer? _bridge;
    private readonly List<ViaWorkspaceEntry> _vias = new();
    private readonly Dictionary<string, DateTime> _kaAttemptedAt = new(StringComparer.OrdinalIgnoreCase);
    private DateTime _lastAutoKaRunUtc = DateTime.MinValue;
    private readonly bool _startMinimized;
    private bool _allowExit;
    private string _currentUserSummary = "Chưa đăng nhập";

    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _trayMenu = new();
    private readonly System.Windows.Forms.Timer _keepAliveTimer = new() { Interval = 60_000 };
    private readonly System.Windows.Forms.Timer _syncTimer = new() { Interval = 300_000 };

    // UI Controls
    private TextBox _txtBackendUrl = null!;
    private TextBox _txtEmail = null!;
    private TextBox _txtPassword = null!;
    private Button _btnLogin = null!;
    private Label _lblAuthStatus = null!;
    private Label _lblBridgeStatus = null!;
    private Button _btnRegUri = null!;
    private CheckBox _chkAutoStart = null!;
    private CheckBox _chkIsolated = null!;
    private CheckBox _chkAutoKeepAlive = null!;
    private DataGridView _gridVias = null!;
    private TextBox _txtLog = null!;

    public MainForm(bool startMinimized = false)
    {
        _startMinimized = startMinimized;
        _config = DesktopConfig.Load();
        _api.Configure(_config.BackendBaseUrl, _config.AccessToken);

        _trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Text = "AdsOps Desktop Pro v1.1",
            Visible = true,
            ContextMenuStrip = _trayMenu,
        };
        RebuildTrayMenu();
        _trayIcon.DoubleClick += (_, _) => RestoreWindow();

        InitializeUi();
        StartLocalBridge();

        _keepAliveTimer.Tick += async (_, _) => await RunScheduledKeepAliveTickAsync();
        _keepAliveTimer.Start();
        _syncTimer.Tick += async (_, _) =>
        {
            if (_api.HasToken) await RefreshWorkspaceDataAsync(silent: true);
        };
        _syncTimer.Start();

        Shown += async (_, _) =>
        {
            if (_startMinimized)
            {
                Hide();
                WindowState = FormWindowState.Minimized;
            }
            if (_api.HasToken)
            {
                await RefreshWorkspaceDataAsync(silent: false);
            }
            else
            {
                AppendLog("Sẵn sàng v1.1. Hãy đăng nhập tài khoản AdsOps Cloud để đồng bộ Dàn Via + TKQC + Relay Telegram.");
            }
        };

        FormClosing += (_, e) =>
        {
            if (!_allowExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                _trayIcon.ShowBalloonTip(2500, "AdsOps Desktop Pro v1.1", "App vẫn đang chạy ngầm tại khay hệ thống (127.0.0.1:17890).", ToolTipIcon.Info);
                return;
            }
            _keepAliveTimer.Stop();
            _syncTimer.Stop();
            _bridge?.Dispose();
            _api.Dispose();
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _trayMenu.Dispose();
        };
    }

    private void RebuildTrayMenu()
    {
        if (InvokeRequired)
        {
            BeginInvoke(RebuildTrayMenu);
            return;
        }
        _trayMenu.Items.Clear();
        _trayMenu.Items.Add("Mở Bảng điều khiển AdsOps v1.1", null, (_, _) => RestoreWindow());

        var launchMenu = new ToolStripMenuItem($"🚀 Mở nhanh Chrome Via ({_vias.Count})");
        if (_vias.Count == 0)
        {
            launchMenu.DropDownItems.Add("(Chưa đồng bộ Via)").Enabled = false;
        }
        else
        {
            foreach (var v in _vias.Take(20))
            {
                var captured = v;
                launchMenu.DropDownItems.Add($"{captured.Label} ({captured.ProfileDir})", null, async (_, _) =>
                    await LaunchViaInChromeAsync(captured, "https://www.facebook.com/"));
            }
        }
        _trayMenu.Items.Add(launchMenu);

        var overdueVias = _vias.Where(v => v.NeedsKeepAlive).ToList();
        var warmItem = new ToolStripMenuItem($"☕ Đảo Ấm Ngay Các Via Quá Hạn ({overdueVias.Count})");
        warmItem.Enabled = overdueVias.Count > 0;
        warmItem.Click += async (_, _) =>
        {
            foreach (var ov in overdueVias.Take(5))
            {
                await LaunchKeepAliveForViaAsync(ov, manual: true);
            }
        };
        _trayMenu.Items.Add(warmItem);

        _trayMenu.Items.Add("🔄 Đồng bộ Dàn Via & TKQC", null, async (_, _) => await RefreshWorkspaceDataAsync());
        _trayMenu.Items.Add("🧩 Cập nhật Extension v2.9.1 hàng loạt", null, (_, _) => ProvisionAllViasExtensions());
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add("Thoát hẳn AdsOps Desktop", null, (_, _) =>
        {
            _allowExit = true;
            Close();
        });
    }

    private void InitializeUi()
    {
        Text = "AdsOps Desktop Pro v1.1 — Cầu Nối Chrome · Extension v2.9.1 · Két Cookie & 2FA Local · TKQC Thật";
        Size = new Size(1240, 760);
        MinimumSize = new Size(980, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(11, 17, 32);
        ForeColor = Color.FromArgb(241, 245, 249);
        Font = new Font("Segoe UI", 9.5f);

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(12),
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 68f));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 32f));

        // 1. Connection Bar
        var pnlAuth = CreateCardPanel();
        var authFlow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            WrapContents = true,
            Margin = new Padding(0),
        };

        _txtBackendUrl = CreateTextBox(_config.BackendBaseUrl, 235);
        _txtEmail = CreateTextBox(_config.UserEmail, 170);
        _txtEmail.PlaceholderText = "Email AdsOps...";
        _txtPassword = CreateTextBox("", 125);
        _txtPassword.UseSystemPasswordChar = true;
        _txtPassword.PlaceholderText = "Mật khẩu...";

        _btnLogin = CreateActionButton("🔑 Đăng nhập & Đồng bộ", Color.FromArgb(14, 116, 144));
        _btnLogin.Click += async (_, _) => await LoginAndSyncAsync();

        _btnRegUri = CreateActionButton(
            ProtocolRegistrar.IsUriProtocolRegistered() ? "✅ Đã gắn adsops-chrome://" : "⚡ Gắn Protocol 1-Chạm",
            Color.FromArgb(51, 65, 85));
        _btnRegUri.Click += (_, _) => RegisterUriHandler();

        _chkAutoStart = new CheckBox
        {
            Text = "Khởi động cùng Windows",
            Checked = ProtocolRegistrar.IsAutoStartEnabled(),
            AutoSize = true,
            ForeColor = Color.FromArgb(203, 213, 225),
            Margin = new Padding(8, 7, 4, 0),
        };
        _chkAutoStart.CheckedChanged += (_, _) => ToggleAutoStart();

        var btnOpenWeb = CreateActionButton("🌐 Mở Web AdsOps", Color.FromArgb(30, 41, 59));
        btnOpenWeb.Click += (_, _) => Process.Start(new ProcessStartInfo(_config.WebAppUrl) { UseShellExecute = true });

        _lblAuthStatus = new Label
        {
            Text = _api.HasToken ? "⏳ Đang xác thực phiên..." : "⚪ Chưa đăng nhập Cloud",
            AutoSize = true,
            ForeColor = Color.FromArgb(148, 163, 184),
            Margin = new Padding(8, 7, 4, 0),
        };

        authFlow.Controls.Add(CreateFieldLabel("Cloud URL:"));
        authFlow.Controls.Add(_txtBackendUrl);
        authFlow.Controls.Add(CreateFieldLabel("Email:"));
        authFlow.Controls.Add(_txtEmail);
        authFlow.Controls.Add(CreateFieldLabel("Mật khẩu:"));
        authFlow.Controls.Add(_txtPassword);
        authFlow.Controls.Add(_btnLogin);
        authFlow.Controls.Add(_btnRegUri);
        authFlow.Controls.Add(_chkAutoStart);
        authFlow.Controls.Add(btnOpenWeb);
        authFlow.Controls.Add(_lblAuthStatus);
        pnlAuth.Controls.Add(authFlow);

        // 2. Controls & Bridge Bar
        var pnlCtrl = CreateCardPanel();
        var ctrlFlow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            WrapContents = true,
        };

        _lblBridgeStatus = new Label
        {
            Text = "⏳ Đang mở Bridge 127.0.0.1:17890...",
            AutoSize = true,
            ForeColor = Color.FromArgb(52, 211, 153),
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            Margin = new Padding(4, 7, 12, 0),
        };

        _chkIsolated = new CheckBox
        {
            Text = "🔒 Cô lập 100% Chrome Profile (--user-data-dir riêng)",
            Checked = _config.UseIsolatedProfiles,
            AutoSize = true,
            ForeColor = Color.FromArgb(125, 211, 252),
            Margin = new Padding(4, 7, 12, 0),
        };
        _chkIsolated.CheckedChanged += (_, _) =>
        {
            _config.UseIsolatedProfiles = _chkIsolated.Checked;
            _config.Save();
            AppendLog($"Chế độ mở Chrome: {(_config.UseIsolatedProfiles ? "100% Isolated Profile (--user-data-dir + Auto-load Ext v2.9.1)" : "Chrome Profile Chuẩn (--profile-directory)")}");
        };

        _chkAutoKeepAlive = new CheckBox
        {
            Text = "☕ Auto Đảo Ấm (08:30–22:00)",
            Checked = _config.AutoKeepAliveScheduler,
            AutoSize = true,
            ForeColor = Color.FromArgb(253, 224, 71),
            Margin = new Padding(4, 7, 12, 0),
        };
        _chkAutoKeepAlive.CheckedChanged += (_, _) =>
        {
            _config.AutoKeepAliveScheduler = _chkAutoKeepAlive.Checked;
            _config.Save();
            AppendLog($"Lịch Auto Đảo Ấm: {(_config.AutoKeepAliveScheduler ? "ĐANG BẬT" : "ĐÃ TẮT")}");
        };

        var btnSync = CreateActionButton("🔄 Đồng bộ Dàn Via & TKQC", Color.FromArgb(30, 58, 138));
        btnSync.Click += async (_, _) => await RefreshWorkspaceDataAsync();

        var btnProvAll = CreateActionButton("🧩 Cài/Cập nhật Ext v2.9.1 Hàng loạt", Color.FromArgb(5, 150, 105));
        btnProvAll.Click += (_, _) => ProvisionAllViasExtensions();

        var btnExportVault = CreateActionButton("📤 Xuất Vault AES-256", Color.FromArgb(180, 83, 9));
        btnExportVault.Click += (_, _) => ExportVaultFile();

        var btnImportVault = CreateActionButton("📥 Nhập Vault", Color.FromArgb(71, 85, 105));
        btnImportVault.Click += (_, _) => ImportVaultFile();

        ctrlFlow.Controls.Add(_lblBridgeStatus);
        ctrlFlow.Controls.Add(_chkIsolated);
        ctrlFlow.Controls.Add(_chkAutoKeepAlive);
        ctrlFlow.Controls.Add(btnSync);
        ctrlFlow.Controls.Add(btnProvAll);
        ctrlFlow.Controls.Add(btnExportVault);
        ctrlFlow.Controls.Add(btnImportVault);
        pnlCtrl.Controls.Add(ctrlFlow);

        // 3. Via Grid
        _gridVias = new DataGridView
        {
            Dock = DockStyle.Fill,
            BackgroundColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(241, 245, 249),
            GridColor = Color.FromArgb(30, 41, 59),
            BorderStyle = BorderStyle.FixedSingle,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            ReadOnly = true,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            EnableHeadersVisualStyles = false,
        };
        _gridVias.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(30, 41, 59);
        _gridVias.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(226, 232, 240);
        _gridVias.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
        _gridVias.DefaultCellStyle.BackColor = Color.FromArgb(15, 23, 42);
        _gridVias.DefaultCellStyle.ForeColor = Color.FromArgb(241, 245, 249);
        _gridVias.DefaultCellStyle.SelectionBackColor = Color.FromArgb(30, 58, 138);
        _gridVias.DefaultCellStyle.SelectionForeColor = Color.White;
        _gridVias.RowTemplate.Height = 32;

        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colName", HeaderText = "Tên Via / Vai trò", FillWeight = 20 });
        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colProfile", HeaderText = "Hồ sơ Chrome", FillWeight = 14 });
        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colProxy", HeaderText = "Proxy riêng", FillWeight = 16 });
        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colHold", HeaderText = "Page / TKQC", FillWeight = 14 });
        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colIdle", HeaderText = "Đảo ấm / Idle", FillWeight = 12 });
        _gridVias.Columns.Add(new DataGridViewTextBoxColumn { Name = "colStatus", HeaderText = "Hạn mức", FillWeight = 9 });
        _gridVias.Columns.Add(new DataGridViewButtonColumn { Name = "colVault", HeaderText = "Két Sắt Ck/2FA", UseColumnTextForButtonValue = false, FillWeight = 10 });
        _gridVias.Columns.Add(new DataGridViewButtonColumn { Name = "colOpen", HeaderText = "Chrome", Text = "🚀 Mở", UseColumnTextForButtonValue = true, FillWeight = 8 });
        _gridVias.Columns.Add(new DataGridViewButtonColumn { Name = "colWarm", HeaderText = "Cookie", Text = "☕ Đảo Ấm", UseColumnTextForButtonValue = true, FillWeight = 9 });
        _gridVias.Columns.Add(new DataGridViewButtonColumn { Name = "colCheckProxy", HeaderText = "Mạng", Text = "🩺 Check", UseColumnTextForButtonValue = true, FillWeight = 8 });
        _gridVias.CellContentClick += async (_, e) => await HandleGridButtonClickAsync(e.RowIndex, e.ColumnIndex);

        // 4. Bottom Log Box
        var pnlLog = CreateCardPanel();
        pnlLog.Padding = new Padding(8);
        _txtLog = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(2, 6, 23),
            ForeColor = Color.FromArgb(148, 163, 184),
            BorderStyle = BorderStyle.None,
            Font = new Font("Consolas", 9f),
        };
        pnlLog.Controls.Add(_txtLog);

        root.Controls.Add(pnlAuth, 0, 0);
        root.Controls.Add(pnlCtrl, 0, 1);
        root.Controls.Add(_gridVias, 0, 2);
        root.Controls.Add(pnlLog, 0, 3);
        Controls.Add(root);
    }

    private static Panel CreateCardPanel() => new()
    {
        Dock = DockStyle.Fill,
        BackColor = Color.FromArgb(17, 24, 39),
        Padding = new Padding(8),
        Margin = new Padding(0, 0, 0, 8),
        AutoSize = true,
    };

    private static Label CreateFieldLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Color.FromArgb(148, 163, 184),
        Margin = new Padding(4, 7, 2, 0),
    };

    private static TextBox CreateTextBox(string initialText, int width) => new()
    {
        Text = initialText,
        Width = width,
        BackColor = Color.FromArgb(30, 41, 59),
        ForeColor = Color.White,
        BorderStyle = BorderStyle.FixedSingle,
        Margin = new Padding(2, 4, 8, 2),
    };

    private static Button CreateActionButton(string text, Color backColor) => new()
    {
        Text = text,
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        BackColor = backColor,
        ForeColor = Color.White,
        Padding = new Padding(8, 3, 8, 3),
        Margin = new Padding(2, 2, 6, 2),
        Cursor = Cursors.Hand,
    };

    private void StartLocalBridge()
    {
        try
        {
            LocalBridgeServer.RetireLegacyBridgeHoldingPort(_config.BridgePort, AppendLog);
            _bridge = new LocalBridgeServer(
                _config.BridgePort,
                HandleOpenChromeRequestAsync,
                HandleBrowserEventAsync,
                () => Task.FromResult(ProvisionAllViasExtensions()),
                AppendLog,
                HandleLocalVaultSaveAsync,
                HandleLocalVaultGetAsync);
            _bridge.Start();
            _lblBridgeStatus.Text = $"🟢 Cầu nối v1.1 · 127.0.0.1:{_bridge.BoundPort} (Ext v2.9.1)";
            _lblBridgeStatus.ForeColor = Color.FromArgb(52, 211, 153);
            AppendLog($"Cầu nối HTTP v1.1 đang lắng nghe tại http://127.0.0.1:{_bridge.BoundPort}");
        }
        catch (Exception ex)
        {
            _lblBridgeStatus.Text = $"🟡 Cổng {_config.BridgePort} đang bận ({ex.Message})";
            _lblBridgeStatus.ForeColor = Color.FromArgb(251, 191, 36);
            AppendLog($"Không thể mở cổng {_config.BridgePort}: {ex.Message}. Hãy tắt tiến trình đang chiếm cổng.");
        }
    }

    private void RestoreWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void AppendLog(string message)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke(() => AppendLog(message));
            return;
        }
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}";
        _txtLog.AppendText(line);
    }

    private async Task LoginAndSyncAsync()
    {
        var baseUrl = _txtBackendUrl.Text.Trim().TrimEnd('/');
        var email = _txtEmail.Text.Trim();
        var pass = _txtPassword.Text;
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(pass))
        {
            MessageBox.Show(this, "Vui lòng nhập đủ Cloud URL, Email và Mật khẩu.", "Thiếu thông tin", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _btnLogin.Enabled = false;
        try
        {
            _api.Configure(baseUrl, "");
            var tok = await _api.LoginAsync(email, pass);
            _config.BackendBaseUrl = baseUrl;
            _config.UserEmail = email;
            _config.AccessToken = tok.AccessToken;
            _config.Save();
            _txtPassword.Text = "";
            AppendLog($"Đăng nhập thành công với {email} (JWT đã mã hóa an toàn bằng Windows DPAPI).");
            await RefreshWorkspaceDataAsync(silent: false);
        }
        catch (Exception ex)
        {
            _lblAuthStatus.Text = "🔴 Lỗi đăng nhập";
            _lblAuthStatus.ForeColor = Color.FromArgb(248, 113, 113);
            AppendLog($"Lỗi đăng nhập: {ex.Message}");
            MessageBox.Show(this, ex.Message, "Đăng nhập thất bại", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _btnLogin.Enabled = true;
        }
    }

    private async Task RefreshWorkspaceDataAsync(bool silent = false)
    {
        if (!_api.HasToken) return;
        try
        {
            var me = await _api.GetCurrentUserAsync();
            var refs = await _api.ListPersonalAccountsAsync();
            var summary = await _api.GetPagesSummaryAsync();
            List<AdAccountItemDto> allAdAccounts = new();
            try
            {
                var accRes = await _api.ListAdAccountsAsync();
                allAdAccounts = accRes.Items ?? new();
            }
            catch (Exception ex)
            {
                if (!silent) AppendLog($"⚠️ Tạm chưa tải được danh sách TKQC ({ex.Message}); tiếp tục đồng bộ Via.");
            }

            var allBundled = allAdAccounts.Select(BundledExtensionAccountDto.FromApi).ToList();
            var quotaById = summary.ViaQuotas.ToDictionary(q => q.ViaId ?? "", StringComparer.OrdinalIgnoreCase);
            var refById = refs.Items.ToDictionary(r => r.Id ?? "", StringComparer.OrdinalIgnoreCase);

            List<BundledExtensionAccountDto> ResolveAccountsForVia(string viaId, string viaLabel)
            {
                if (allAdAccounts.Count == 0) return new();
                var lblLow = (viaLabel ?? "").Trim().ToLowerInvariant();
                var matched = allAdAccounts.Where(a =>
                    a.FacebookIdentities.Any(fid =>
                        (!string.IsNullOrEmpty(viaId) && string.Equals(fid.Id, viaId, StringComparison.OrdinalIgnoreCase)) ||
                        (!string.IsNullOrEmpty(lblLow) && string.Equals((fid.Label ?? "").Trim().ToLowerInvariant(), lblLow, StringComparison.Ordinal))
                    )).ToList();
                return matched.Count > 0
                    ? matched.Select(BundledExtensionAccountDto.FromApi).ToList()
                    : allBundled;
            }

            var merged = new List<ViaWorkspaceEntry>();
            foreach (var r in refs.Items)
            {
                quotaById.TryGetValue(r.Id, out var q);
                var backendTier = q?.ViaTier ?? "standard_via";
                var profDir = ExtensionProvisioner.ResolveProfileDirectory(r.BrowserProfileLabel, r.Label);
                var extracted2fa = ExtensionProvisioner.ExtractTwoFaSecret(r.VaultReference, r.Notes);
                if (string.IsNullOrEmpty(extracted2fa))
                {
                    var localSec = LocalSecretVaultStore.Default.Find(r.Id, profDir, r.Label);
                    if (localSec.Found) extracted2fa = localSec.TwoFaSecret;
                }
                merged.Add(new ViaWorkspaceEntry
                {
                    ViaId = r.Id,
                    Label = r.Label,
                    BrowserProfileLabel = string.IsNullOrWhiteSpace(r.BrowserProfileLabel) ? (q?.BrowserProfile ?? "Default") : r.BrowserProfileLabel,
                    ProfileDir = profDir,
                    NetworkLabel = string.IsNullOrWhiteSpace(r.NetworkLabel) ? (q?.NetworkLabel ?? "") : r.NetworkLabel,
                    TwoFaSecret = extracted2fa,
                    ViaTier = backendTier == "veteran_xmdt" ? "vault" : "camp",
                    BackendTier = backendTier,
                    HoldingPagesCount = q?.HoldingPagesCount ?? 0,
                    CreatedTodayCount = q?.CreatedTodayCount ?? 0,
                    DailyLimit = q?.DailyLimit ?? 1,
                    QuotaStatus = q?.QuotaStatus ?? "SAFE",
                    IdleDays = q?.IdleDays ?? 0,
                    KeepAliveIntervalDays = q?.KeepAliveIntervalDays ?? 3.0,
                    NeedsKeepAlive = q?.NeedsKeepAlive ?? false,
                    BundledAccounts = ResolveAccountsForVia(r.Id, r.Label),
                });
            }

            foreach (var q in summary.ViaQuotas)
            {
                if (!string.IsNullOrEmpty(q.ViaId) && refById.ContainsKey(q.ViaId)) continue;
                var profDir = ExtensionProvisioner.ResolveProfileDirectory(q.BrowserProfile, q.Label);
                var localSec = LocalSecretVaultStore.Default.Find(q.ViaId, profDir, q.Label);
                merged.Add(new ViaWorkspaceEntry
                {
                    ViaId = q.ViaId,
                    Label = q.Label,
                    BrowserProfileLabel = q.BrowserProfile,
                    ProfileDir = profDir,
                    NetworkLabel = q.NetworkLabel,
                    TwoFaSecret = localSec.Found ? localSec.TwoFaSecret : "",
                    ViaTier = q.ViaTier == "veteran_xmdt" ? "vault" : "camp",
                    BackendTier = q.ViaTier,
                    HoldingPagesCount = q.HoldingPagesCount,
                    CreatedTodayCount = q.CreatedTodayCount,
                    DailyLimit = q.DailyLimit,
                    QuotaStatus = q.QuotaStatus,
                    IdleDays = q.IdleDays,
                    KeepAliveIntervalDays = q.KeepAliveIntervalDays,
                    NeedsKeepAlive = q.NeedsKeepAlive,
                    BundledAccounts = ResolveAccountsForVia(q.ViaId, q.Label),
                });
            }

            Invoke(() =>
            {
                _vias.Clear();
                _vias.AddRange(merged);
                _currentUserSummary = $"{me.Email} · {me.Workspace?.Name ?? "Workspace"}";
                _lblAuthStatus.Text = $"🟢 {_currentUserSummary} ({_vias.Count} Via · {allBundled.Count} TKQC)";
                _lblAuthStatus.ForeColor = Color.FromArgb(52, 211, 153);
                RenderViaGrid();
                RebuildTrayMenu();
            });
            ProvisionAllViasExtensions(quiet: true);
            if (!silent)
            {
                AppendLog($"Đã đồng bộ {merged.Count} Via & {allBundled.Count} TKQC từ {_currentUserSummary} -> đóng gói Extension v2.9.1.");
            }
        }
        catch (Exception ex)
        {
            Invoke(() =>
            {
                _lblAuthStatus.Text = "🟡 Phiên hết hạn / Mất kết nối Cloud";
                _lblAuthStatus.ForeColor = Color.FromArgb(251, 191, 36);
            });
            if (!silent) AppendLog($"Lỗi đồng bộ Cloud: {ex.Message}");
        }
    }

    private void RenderViaGrid()
    {
        _gridVias.Rows.Clear();
        foreach (var v in _vias)
        {
            var idleText = v.NeedsKeepAlive ? $"⚠️ {v.IdleDays:0.0}d (Cần ấm)" : $"✅ {v.IdleDays:0.0}d / {v.KeepAliveIntervalDays:0.0}d";
            var holdText = $"{v.HoldingPagesCount} Page ({v.CreatedTodayCount}/{v.DailyLimit}) · {v.BundledAccounts.Count} TKQC";
            var proxyDisp = string.IsNullOrWhiteSpace(v.NetworkLabel) ? "(Mạng gốc)" : v.NetworkLabel;

            var stored = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
            var hasCk = stored.Found && !string.IsNullOrWhiteSpace(stored.CookieRaw);
            var has2fa = !string.IsNullOrWhiteSpace(v.TwoFaSecret) || (stored.Found && !string.IsNullOrWhiteSpace(stored.TwoFaSecret));
            var vaultBtnText = (hasCk, has2fa) switch
            {
                (true, true) => "🔐 Ck+2FA",
                (true, false) => "🍪 Có Ck",
                (false, true) => "🔑 Có 2FA",
                _ => "➕ Lưu Ck",
            };

            var rowIdx = _gridVias.Rows.Add(
                v.Label,
                string.IsNullOrWhiteSpace(v.BrowserProfileLabel) ? v.ProfileDir : $"{v.ProfileDir} ({v.BrowserProfileLabel})",
                proxyDisp,
                holdText,
                idleText,
                v.QuotaStatus,
                vaultBtnText);
            _gridVias.Rows[rowIdx].Tag = v;
        }
    }

    private int ProvisionAllViasExtensions(bool quiet = false)
    {
        int count = 0;
        var snapshot = _vias.ToList();
        foreach (var v in snapshot)
        {
            ExtensionProvisioner.ProvisionForVia(v);
            count++;
        }
        if (count == 0)
        {
            var fallback = new ViaWorkspaceEntry { Label = "Via Chính", BrowserProfileLabel = "Default" };
            ExtensionProvisioner.ProvisionForVia(fallback);
            count = 1;
        }
        if (!quiet)
        {
            AppendLog($"🧩 Đã đóng gói/cập nhật Extension v2.9.1 (kèm TKQC + 2FA) cho {count} Via tại {ExtensionProvisioner.ExtensionsRoot}");
            _trayIcon.ShowBalloonTip(2500, "Extension v2.9.1", $"Đã cập nhật tự động cho {count} hồ sơ Via.", ToolTipIcon.Info);
        }
        return count;
    }

    private async Task HandleGridButtonClickAsync(int rowIndex, int colIndex)
    {
        if (rowIndex < 0 || rowIndex >= _gridVias.Rows.Count) return;
        if (_gridVias.Rows[rowIndex].Tag is not ViaWorkspaceEntry via) return;
        var colName = _gridVias.Columns[colIndex].Name;

        if (colName == "colVault")
        {
            OpenLocalVaultEditorDialog(via);
        }
        else if (colName == "colOpen")
        {
            await LaunchViaInChromeAsync(via, "https://www.facebook.com/");
        }
        else if (colName == "colWarm")
        {
            await LaunchKeepAliveForViaAsync(via, manual: true);
        }
        else if (colName == "colCheckProxy")
        {
            await CheckProxyForViaAsync(via);
        }
    }

    private void OpenLocalVaultEditorDialog(ViaWorkspaceEntry via)
    {
        var cur = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        using var dlg = new Form
        {
            Text = $"🔐 Két Sắt Cookie & 2FA Local (DPAPI) — {via.Label}",
            Width = 560,
            Height = 360,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterParent,
            MaximizeBox = false,
            MinimizeBox = false,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.White,
        };

        var lblNote = new Label
        {
            Left = 14,
            Top = 12,
            Width = 516,
            Height = 34,
            ForeColor = Color.FromArgb(148, 163, 184),
            Text = "Dữ liệu chỉ mã hóa & lưu 100% cục bộ bằng Windows DPAPI trên máy này (không bao giờ gửi lên Cloud). Dùng nút «📥 Nạp từ Két App Win» trong Chrome Extension v2.9.1 để bơm vào Chrome.",
        };
        var lbl2fa = new Label { Left = 14, Top = 52, Width = 516, Text = "Khóa 2FA Base32:" };
        var txt2fa = new TextBox
        {
            Left = 14,
            Top = 74,
            Width = 516,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            Text = !string.IsNullOrEmpty(cur.TwoFaSecret) ? cur.TwoFaSecret : via.TwoFaSecret,
        };
        var lblCk = new Label { Left = 14, Top = 108, Width = 516, Text = "Cookie Facebook (JSON hoặc c_user=...; xs=...):" };
        var txtCk = new TextBox
        {
            Left = 14,
            Top = 130,
            Width = 516,
            Height = 130,
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            Font = new Font("Consolas", 9f),
            Text = cur.CookieRaw,
        };
        var btnSave = new Button
        {
            Text = "💾 Lưu vào Két DPAPI",
            Left = 390,
            Top = 274,
            Width = 140,
            Height = 32,
            DialogResult = DialogResult.OK,
            BackColor = Color.FromArgb(5, 150, 105),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        var btnClear = new Button
        {
            Text = "🗑️ Xóa sạch Két Via này",
            Left = 14,
            Top = 274,
            Width = 165,
            Height = 32,
            BackColor = Color.FromArgb(127, 29, 29),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        bool clearRequested = false;
        btnClear.Click += (_, _) =>
        {
            clearRequested = true;
            txtCk.Text = "";
            txt2fa.Text = "";
            dlg.DialogResult = DialogResult.OK;
            dlg.Close();
        };

        dlg.Controls.AddRange(new Control[] { lblNote, lbl2fa, txt2fa, lblCk, txtCk, btnClear, btnSave });
        dlg.AcceptButton = btnSave;
        if (dlg.ShowDialog(this) == DialogResult.OK)
        {
            var next2fa = new string((txt2fa.Text ?? "").Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();
            var nextCk = (txtCk.Text ?? "").Trim();
            LocalSecretVaultStore.Default.Upsert(
                via.ViaId,
                via.Label,
                via.ProfileDir,
                nextCk,
                next2fa,
                allowOverwriteEmpty: clearRequested || string.IsNullOrEmpty(nextCk) || string.IsNullOrEmpty(next2fa));
            via.TwoFaSecret = next2fa;
            ExtensionProvisioner.ProvisionForVia(via);
            RenderViaGrid();
            AppendLog(clearRequested
                ? $"🗑️ Đã xóa Cookie/2FA trong Két Local DPAPI của «{via.Label}»."
                : $"🔐 Đã cập nhật Két Local DPAPI cho «{via.Label}» (Cookie={(string.IsNullOrEmpty(nextCk) ? "Không" : "Có")}, 2FA={(string.IsNullOrEmpty(next2fa) ? "Không" : "Có")}).");
        }
    }

    private Task<LocalVaultGetResult> HandleLocalVaultSaveAsync(LocalVaultSaveRequest req)
    {
        var saved = LocalSecretVaultStore.Default.Upsert(
            req.ViaId,
            req.ViaLabel,
            req.ProfileDir,
            req.CookieRaw,
            req.TwoFaSecret,
            allowOverwriteEmpty: false);

        Invoke(() =>
        {
            var matched = _vias.FirstOrDefault(v =>
                (!string.IsNullOrWhiteSpace(req.ViaId) && string.Equals(v.ViaId, req.ViaId, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(req.ViaLabel) && string.Equals(v.Label, req.ViaLabel, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(req.ProfileDir) && string.Equals(v.ProfileDir, req.ProfileDir, StringComparison.OrdinalIgnoreCase)));
            if (matched != null)
            {
                if (!string.IsNullOrEmpty(saved.TwoFaSecret)) matched.TwoFaSecret = saved.TwoFaSecret;
                ExtensionProvisioner.ProvisionForVia(matched);
            }
            RenderViaGrid();
        });
        AppendLog($"🔐 [Extension -> Két Win DPAPI] Đã lưu bảo mật Cookie/2FA cho «{saved.ViaLabel}» ({saved.ProfileDir}).");
        return Task.FromResult(new LocalVaultGetResult
        {
            Ok = true,
            Found = saved.Found,
            ViaId = saved.ViaId,
            ViaLabel = saved.ViaLabel,
            ProfileDir = saved.ProfileDir,
            CookieRaw = saved.CookieRaw,
            TwoFaSecret = saved.TwoFaSecret,
            UpdatedAt = saved.UpdatedAtUtc,
        });
    }

    private Task<LocalVaultGetResult> HandleLocalVaultGetAsync(string viaId, string profileDir, string viaName)
    {
        var res = LocalSecretVaultStore.Default.Find(viaId, profileDir, viaName);
        var fallback2fa = "";
        if (!res.Found || string.IsNullOrEmpty(res.TwoFaSecret))
        {
            var matched = _vias.FirstOrDefault(v =>
                (!string.IsNullOrWhiteSpace(viaId) && string.Equals(v.ViaId, viaId, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(viaName) && string.Equals(v.Label, viaName, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(profileDir) && string.Equals(v.ProfileDir, profileDir, StringComparison.OrdinalIgnoreCase)));
            if (matched != null) fallback2fa = matched.TwoFaSecret;
        }
        var effective2fa = !string.IsNullOrEmpty(res.TwoFaSecret) ? res.TwoFaSecret : fallback2fa;
        var foundAny = res.Found || !string.IsNullOrEmpty(effective2fa);
        return Task.FromResult(new LocalVaultGetResult
        {
            Ok = true,
            Found = foundAny,
            ViaId = res.ViaId,
            ViaLabel = res.ViaLabel,
            ProfileDir = res.ProfileDir,
            CookieRaw = res.CookieRaw,
            TwoFaSecret = effective2fa,
            UpdatedAt = res.UpdatedAtUtc,
        });
    }

    private Task LaunchViaInChromeAsync(ViaWorkspaceEntry via, string url)
    {
        try
        {
            var extDir = ExtensionProvisioner.ProvisionForVia(via);
            ExtensionProvisioner.LaunchChrome(
                url,
                via.ProfileDir,
                extDir,
                _config.UseIsolatedProfiles,
                ExtensionProvisioner.SanitizeFolderSlug(via.Label, via.ViaId));
            AppendLog($"🚀 Mở Chrome ({(_config.UseIsolatedProfiles ? "Isolated" : via.ProfileDir)}) + Ext v2.9.1 cho «{via.Label}»");
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi mở Chrome cho «{via.Label}»: {ex.Message}");
        }
        return Task.CompletedTask;
    }

    private async Task<bool> CheckProxyForViaAsync(ViaWorkspaceEntry via)
    {
        if (string.IsNullOrWhiteSpace(via.NetworkLabel))
        {
            AppendLog($"ℹ️ Via «{via.Label}» không gắn Proxy riêng (dùng mạng trực tiếp).");
            return true;
        }
        if (!_api.HasToken)
        {
            AppendLog("⚠️ Cần đăng nhập Cloud để kiểm tra Proxy qua Backend.");
            return true;
        }
        try
        {
            var res = await _api.CheckProxyLiveAsync(via.NetworkLabel, via.Label);
            var ok = string.Equals(res.Status, "LIVE", StringComparison.OrdinalIgnoreCase);
            AppendLog($"🩺 Proxy Via «{via.Label}»: {res.Status} ({res.LatencyMs ?? 0}ms) — {res.Message}");
            if (!ok)
            {
                _trayIcon.ShowBalloonTip(4000, "Proxy Chết!", $"Via «{via.Label}» Proxy DEAD ({res.Message})", ToolTipIcon.Warning);
            }
            return ok;
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi kiểm tra Proxy «{via.Label}»: {ex.Message}");
            return false;
        }
    }

    private async Task LaunchKeepAliveForViaAsync(ViaWorkspaceEntry via, bool manual)
    {
        if (!string.IsNullOrWhiteSpace(via.NetworkLabel) && _api.HasToken)
        {
            var proxyAlive = await CheckProxyForViaAsync(via);
            if (!proxyAlive)
            {
                AppendLog($"🛑 Bỏ qua Đảo Ấm Via «{via.Label}» vì Proxy không phản hồi.");
                return;
            }
        }
        var route = via.BackendTier == "veteran_xmdt" ? "feed,notif,biz" : "feed,notif";
        var url =
            $"https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=1" +
            $"&adsops_via_tier={Uri.EscapeDataString(via.ViaTier)}" +
            $"&adsops_ka_route={Uri.EscapeDataString(route)}" +
            $"&adsops_via_id={Uri.EscapeDataString(via.ViaId)}";
        await LaunchViaInChromeAsync(via, url);
        if (!manual) AppendLog($"☕ [Auto Scheduler] Đã chạy phiên Đảo Ấm cho Via quá hạn «{via.Label}» ({via.IdleDays:0.0} ngày idle).");
    }

    private async Task RunScheduledKeepAliveTickAsync()
    {
        if (!_config.AutoKeepAliveScheduler || _vias.Count == 0) return;
        var nowLocal = DateTime.Now;
        var totalMins = nowLocal.Hour * 60 + nowLocal.Minute;
        if (totalMins < 8 * 60 + 30 || totalMins > 22 * 60) return; // Daytime 08:30-22:00 only
        if ((DateTime.UtcNow - _lastAutoKaRunUtc) < TimeSpan.FromMinutes(20)) return;

        var candidate = _vias.FirstOrDefault(v =>
            v.NeedsKeepAlive &&
            (!_kaAttemptedAt.TryGetValue(v.ViaId + v.Label, out var prev) || (DateTime.UtcNow - prev) > TimeSpan.FromMinutes(60)));
        if (candidate == null) return;

        _lastAutoKaRunUtc = DateTime.UtcNow;
        _kaAttemptedAt[candidate.ViaId + candidate.Label] = DateTime.UtcNow;
        await LaunchKeepAliveForViaAsync(candidate, manual: false);
    }

    private Task<(bool Ok, string Message)> HandleOpenChromeRequestAsync(OpenChromeBridgeRequest req)
    {
        try
        {
            var targetUrl = req.Url ?? "";
            var reqProfile = string.IsNullOrWhiteSpace(req.Profile) ? "Default" : req.Profile.Trim();
            var matched = _vias.FirstOrDefault(v =>
                (!string.IsNullOrWhiteSpace(req.Name) && v.Label.Contains(req.Name, StringComparison.OrdinalIgnoreCase)) ||
                string.Equals(v.ProfileDir, reqProfile, StringComparison.OrdinalIgnoreCase));

            var viaObj = matched ?? new ViaWorkspaceEntry
            {
                Label = string.IsNullOrWhiteSpace(req.Name) ? reqProfile : req.Name,
                BrowserProfileLabel = reqProfile,
                ProfileDir = ExtensionProvisioner.ResolveProfileDirectory(reqProfile, req.Name),
                NetworkLabel = req.Proxy ?? "",
            };
            var extDir = ExtensionProvisioner.ProvisionForVia(viaObj);
            ExtensionProvisioner.LaunchChrome(
                targetUrl,
                viaObj.ProfileDir,
                extDir,
                _config.UseIsolatedProfiles,
                ExtensionProvisioner.SanitizeFolderSlug(viaObj.Label, viaObj.ViaId));
            AppendLog($"🔗 [Web -> Desktop Bridge] Mở {viaObj.ProfileDir} ({viaObj.Label}) -> {TruncateUrl(targetUrl)}");
            return Task.FromResult((true, "Launched"));
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi /open từ Bridge: {ex.Message}");
            return Task.FromResult((false, ex.Message));
        }
    }

    private async Task<BrowserEventResponseDto> HandleBrowserEventAsync(BrowserEventPayloadDto ev)
    {
        var evType = (ev.EventType ?? "").Trim().ToUpperInvariant();
        var viaLbl = string.IsNullOrWhiteSpace(ev.ViaLabel) ? ev.BrowserProfile : ev.ViaLabel;
        AppendLog($"📡 [Chrome -> Desktop] {evType} · {viaLbl} · Page={ev.ExternalPageId} · {ev.Detail}");

        if (evType == "COOKIE_LOGGED_OUT" || evType == "SAFETY_CHALLENGE")
        {
            var title = evType == "COOKIE_LOGGED_OUT" ? "⚠️ Via Văng Cookie!" : "🛑 Cảnh báo Checkpoint / CAPTCHA!";
            _trayIcon.ShowBalloonTip(5000, title, $"{viaLbl}: {ev.Detail}", ToolTipIcon.Warning);
        }
        else if (evType == "PAGE_CREATED")
        {
            _trayIcon.ShowBalloonTip(4000, "✅ Đã bắt được Fanpage mới!", $"«{ev.PageName}» (ID: {ev.ExternalPageId})", ToolTipIcon.Info);
        }

        if (!_api.HasToken)
        {
            return new BrowserEventResponseDto { Ok = true, EventType = evType };
        }

        try
        {
            var res = await _api.PostBrowserEventAsync(ev).ConfigureAwait(false);
            AppendLog($"☁️ [Desktop -> Cloud] Đã đồng bộ {evType} (MatchedPage={res.MatchedPageId}, AutoClaimBM={res.AutoClaimedBm}, Telegram={res.TelegramNotified})");
            if (evType is "PAGE_CREATED" or "KEEPALIVE_OK")
            {
                _ = Task.Run(() => RefreshWorkspaceDataAsync(silent: true));
            }
            return res;
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi gửi sự kiện lên Cloud: {ex.Message}");
            return new BrowserEventResponseDto { Ok = false, EventType = evType };
        }
    }

    private void RegisterUriHandler()
    {
        try
        {
            ProtocolRegistrar.RegisterUriProtocol();
            _btnRegUri.Text = "✅ Đã gắn adsops-chrome://";
            AppendLog("Đã đăng ký URL Protocol HKCU\\Software\\Classes\\adsops-chrome -> AdsOpsDesktop.exe.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Lỗi đăng ký URI Protocol", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ToggleAutoStart()
    {
        try
        {
            ProtocolRegistrar.SetAutoStart(_chkAutoStart.Checked);
            AppendLog(_chkAutoStart.Checked ? "Đã bật tự chạy AdsOps Desktop Pro khi mở Windows." : "Đã tắt tự khởi động cùng Windows.");
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi cấu hình Startup Registry: {ex.Message}");
        }
    }

    private void ExportVaultFile()
    {
        var pw = PromptPassword("Khóa sao lưu .adsopsvault (AES-256-GCM)", "Nhập mật khẩu bảo vệ tệp Vault (ít nhất 6 ký tự):");
        if (string.IsNullOrEmpty(pw)) return;

        using var sfd = new SaveFileDialog
        {
            Title = "Xuất Vault Backup AES-256",
            Filter = "AdsOps Encrypted Vault (*.adsopsvault)|*.adsopsvault",
            FileName = $"AdsOps-Vault-{DateTime.Now:yyyyMMdd-HHmm}.adsopsvault",
        };
        if (sfd.ShowDialog(this) != DialogResult.OK) return;

        try
        {
            var secrets = LocalSecretVaultStore.Default.ExportPlainEntries();
            var payload = new VaultBackupPayload
            {
                BackendBaseUrl = _config.BackendBaseUrl,
                UserEmail = _config.UserEmail,
                Vias = _vias.ToList(),
                LocalSecrets = secrets,
            };
            var bytes = VaultBackupService.EncryptToBytes(payload, pw);
            File.WriteAllBytes(sfd.FileName, bytes);
            AppendLog($"🔐 Đã xuất {payload.Vias.Count} Via + {secrets.Count} Két Cookie/2FA ra tệp mã hóa AES-256-GCM: {sfd.FileName}");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Lỗi xuất Vault", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ImportVaultFile()
    {
        using var ofd = new OpenFileDialog
        {
            Title = "Nhập Vault Backup (.adsopsvault)",
            Filter = "AdsOps Encrypted Vault (*.adsopsvault)|*.adsopsvault",
        };
        if (ofd.ShowDialog(this) != DialogResult.OK) return;

        var pw = PromptPassword("Mở khóa Vault", "Nhập mật khẩu giải mã tệp Vault:");
        if (string.IsNullOrEmpty(pw)) return;

        try
        {
            var raw = File.ReadAllBytes(ofd.FileName);
            var payload = VaultBackupService.DecryptFromBytes(raw, pw);
            var restoredSecrets = LocalSecretVaultStore.Default.ImportPlainEntries(payload.LocalSecrets);
            _vias.Clear();
            _vias.AddRange(payload.Vias);
            RenderViaGrid();
            RebuildTrayMenu();
            ProvisionAllViasExtensions(quiet: true);
            AppendLog($"🔓 Đã khôi phục {_vias.Count} Via + {restoredSecrets} Két Cookie/2FA từ tệp Vault (Exported {payload.ExportedAtUtc}) & nạp sẵn Extension v2.9.1.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Giải mã thất bại (sai mật khẩu hoặc tệp hỏng): {ex.Message}", "Lỗi mở Vault", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private string PromptPassword(string title, string promptText)
    {
        using var dlg = new Form
        {
            Text = title,
            Width = 420,
            Height = 165,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterParent,
            MaximizeBox = false,
            MinimizeBox = false,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.White,
        };
        var lbl = new Label { Left = 14, Top = 14, Width = 376, Text = promptText };
        var box = new TextBox { Left = 14, Top = 40, Width = 376, UseSystemPasswordChar = true, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
        var btnOk = new Button { Text = "Xác nhận", Left = 290, Width = 100, Top = 78, DialogResult = DialogResult.OK, BackColor = Color.FromArgb(5, 150, 105), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        dlg.Controls.AddRange(new Control[] { lbl, box, btnOk });
        dlg.AcceptButton = btnOk;
        return dlg.ShowDialog(this) == DialogResult.OK ? box.Text : "";
    }

    private static string TruncateUrl(string url) => url.Length > 75 ? url[..75] + "..." : url;
}
