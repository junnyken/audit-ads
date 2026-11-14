using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace AdsOpsDesktop;

/// <summary>
/// Isolates System.Windows.Forms &amp; System.Drawing (NotifyIcon + Native File Dialogs) away from WPF types.
/// </summary>
internal sealed class SystemTrayService : IDisposable
{
    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _menu;
    private readonly Icon _customIcon;

    private readonly Action _onShowWindow;
    private readonly Action _onSyncNow;
    private readonly Action _onWarmupDueVias;
    private readonly Action _onToggleQueuePause;
    private readonly Action _onExitApp;
    private readonly Action<ViaWorkspaceEntry> _onLaunchViaChrome;
    private readonly Action<ViaWorkspaceEntry> _onCopyViaTotp;

    public SystemTrayService(
        Action onShowWindow,
        Action onSyncNow,
        Action onWarmupDueVias,
        Action onToggleQueuePause,
        Action onExitApp,
        Action<ViaWorkspaceEntry> onLaunchViaChrome,
        Action<ViaWorkspaceEntry> onCopyViaTotp)
    {
        _onShowWindow = onShowWindow;
        _onSyncNow = onSyncNow;
        _onWarmupDueVias = onWarmupDueVias;
        _onToggleQueuePause = onToggleQueuePause;
        _onExitApp = onExitApp;
        _onLaunchViaChrome = onLaunchViaChrome;
        _onCopyViaTotp = onCopyViaTotp;

        _customIcon = CreateAppBadgeIcon();
        _menu = new ContextMenuStrip
        {
            BackColor = Color.FromArgb(22, 32, 50),
            ForeColor = Color.FromArgb(241, 245, 249),
            ShowImageMargin = false,
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
        };

        _trayIcon = new NotifyIcon
        {
            Icon = _customIcon,
            Text = "AdsOps Desktop Pro v2.2 — Sẵn sàng",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _trayIcon.DoubleClick += (_, _) => _onShowWindow();
        UpdateMenu(Array.Empty<ViaWorkspaceEntry>(), new QueueSnapshot(QueuePhase.Idle, QueueKind.KeepAlive, 0, 0, 0, 0, 0, 0, "", "", false, ""), false);
    }

    public void UpdateMenu(IReadOnlyList<ViaWorkspaceEntry> vias, QueueSnapshot queue, bool isLoggedIn)
    {
        _menu.Items.Clear();

        var openItem = new ToolStripMenuItem("Mở AdsOps Desktop Pro v2.2");
        openItem.Font = new Font(_menu.Font, FontStyle.Bold);
        openItem.Click += (_, _) => _onShowWindow();
        _menu.Items.Add(openItem);

        var totpParent = new ToolStripMenuItem("Copy nhanh Mã 2FA (6 số)");
        int twoFaCount = 0;
        foreach (var v in vias)
        {
            var stored = LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label);
            var secret = !string.IsNullOrWhiteSpace(stored.TwoFaSecret) ? stored.TwoFaSecret : v.TwoFaSecret;
            var res = TotpService.ComputeTotp(secret);
            if (!res.Valid) continue;

            twoFaCount++;
            var captured = v;
            var item = new ToolStripMenuItem($"{v.Label}  •  {res.FormattedCode} ({res.SecondsRemaining}s)");
            item.Click += (_, _) => _onCopyViaTotp(captured);
            totpParent.DropDownItems.Add(item);
        }
        if (twoFaCount == 0)
        {
            var empty = new ToolStripMenuItem("(Chưa có Via nào gắn 2FA Local)") { Enabled = false };
            totpParent.DropDownItems.Add(empty);
        }
        _menu.Items.Add(totpParent);

        var launchParent = new ToolStripMenuItem("Mở nhanh Chrome Via");
        int launchCount = 0;
        foreach (var v in vias)
        {
            launchCount++;
            if (launchCount > 20) break;
            var captured = v;
            var item = new ToolStripMenuItem($"{v.Label} ({v.ProfileDir})");
            item.Click += (_, _) => _onLaunchViaChrome(captured);
            launchParent.DropDownItems.Add(item);
        }
        if (launchCount == 0)
        {
            launchParent.DropDownItems.Add(new ToolStripMenuItem("(Chưa có Via nào)") { Enabled = false });
        }
        _menu.Items.Add(launchParent);

        _menu.Items.Add(new ToolStripSeparator());

        var warmupBtn = new ToolStripMenuItem("Đảo Ấm Via quá hạn (>3 ngày)");
        warmupBtn.Enabled = isLoggedIn && vias.Count > 0;
        warmupBtn.Click += (_, _) => _onWarmupDueVias();
        _menu.Items.Add(warmupBtn);

        if (queue.Phase is QueuePhase.Running or QueuePhase.Paused or QueuePhase.NightPaused)
        {
            var toggleLabel = queue.Phase == QueuePhase.Paused ? "Tiếp tục Hàng đợi Auto" : "Tạm dừng Hàng đợi Auto";
            var toggleItem = new ToolStripMenuItem(toggleLabel);
            toggleItem.Click += (_, _) => _onToggleQueuePause();
            _menu.Items.Add(toggleItem);
        }

        var syncItem = new ToolStripMenuItem("Đồng bộ Cloud & Extension ngay");
        syncItem.Enabled = isLoggedIn;
        syncItem.Click += (_, _) => _onSyncNow();
        _menu.Items.Add(syncItem);

        _menu.Items.Add(new ToolStripSeparator());

        var exitItem = new ToolStripMenuItem("Thoát hẳn ứng dụng");
        exitItem.Click += (_, _) => _onExitApp();
        _menu.Items.Add(exitItem);

        var statusSuffix = queue.Phase == QueuePhase.Running
            ? $"Đang chạy {queue.CurrentIndex}/{queue.TotalCount}"
            : isLoggedIn ? $"{vias.Count} Via sẵn sàng" : "Chờ đăng nhập";
        var text = $"AdsOps Desktop Pro v2.2 — {statusSuffix}";
        _trayIcon.Text = text.Length > 63 ? text[..63] : text;
    }

    public void ShowBalloon(string title, string text, int timeoutMs = 2800, bool error = false)
    {
        try
        {
            _trayIcon.BalloonTipTitle = title;
            _trayIcon.BalloonTipText = text;
            _trayIcon.BalloonTipIcon = error ? ToolTipIcon.Warning : ToolTipIcon.Info;
            _trayIcon.ShowBalloonTip(timeoutMs);
        }
        catch
        {
            // Tray notifications can be disabled by OS Focus Assist
        }
    }

    public static string? ShowSaveVaultDialog(string defaultFileName)
    {
        using var dlg = new SaveFileDialog
        {
            Title = "Xuất Két sao lưu Két Via (.adsopsvault)",
            Filter = "AdsOps Encrypted Vault (*.adsopsvault)|*.adsopsvault|All files (*.*)|*.*",
            FileName = defaultFileName,
        };
        return dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : null;
    }

    public static string? ShowOpenVaultDialog()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Chọn file Két sao lưu (.adsopsvault)",
            Filter = "AdsOps Encrypted Vault (*.adsopsvault)|*.adsopsvault|All files (*.*)|*.*",
        };
        return dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : null;
    }

    public static string? ShowSaveCsvDialog(string defaultFileName)
    {
        using var dlg = new SaveFileDialog
        {
            Title = "Xuất báo cáo Excel CSV (UTF-8)",
            Filter = "CSV UTF-8 (*.csv)|*.csv|All files (*.*)|*.*",
            FileName = defaultFileName,
        };
        return dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : null;
    }

    private static Icon CreateAppBadgeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Color.Transparent);

        using var bgBrush = new SolidBrush(Color.FromArgb(29, 78, 216));
        using var borderPen = new Pen(Color.FromArgb(96, 165, 250), 2f);
        g.FillEllipse(bgBrush, 2, 2, 28, 28);
        g.DrawEllipse(borderPen, 2, 2, 28, 28);

        using var font = new Font("Segoe UI", 14f, FontStyle.Bold, GraphicsUnit.Pixel);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString("A", font, Brushes.White, new RectangleF(1, 1, 30, 30), sf);

        var hIcon = bmp.GetHicon();
        return Icon.FromHandle(hIcon);
    }

    public void Dispose()
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _menu.Dispose();
        _customIcon.Dispose();
    }
}
