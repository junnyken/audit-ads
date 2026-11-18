using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web;
using System.Windows;
using System.Windows.Automation;

namespace AdsOpsDesktop;

/// <summary>
/// Non-intrusive background action runner for Native Chrome windows (--profile-directory mode),
/// where Chrome 137-158+ blocks unpacked --load-extension and --remote-debugging-port.
/// Never moves the physical mouse cursor or steals window focus.
/// </summary>
public static class NativeChromeActionRunner
{
    private delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWinProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect lpRect);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint msg,
        IntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private const uint WM_CLOSE = 0x0010;
    private const uint WM_GETOBJECT = 0x003D;
    private const uint WM_MOUSEWHEEL = 0x020A;
    private const int OBJID_CLIENT = unchecked((int)0xFFFFFFFC);

    private sealed record NativeStopMeta(
        string Label,
        string Url,
        int MinMs,
        int MaxMs,
        string MicroAction,
        string[] NavNames);

    private static readonly Dictionary<string, NativeStopMeta> NativeStops = new(StringComparer.OrdinalIgnoreCase)
    {
        ["scroll_feed"] = new("Cuộn Newsfeed", "https://www.facebook.com/", 9500, 14000, "", new[] { "Trang chủ", "Home" }),
        ["feed"] = new("Cuộn Newsfeed", "https://www.facebook.com/", 9500, 14000, "", new[] { "Trang chủ", "Home" }),
        ["watch_reels"] = new("Xem Reels & Watch", "https://www.facebook.com/watch/", 9500, 13500, "", new[] { "Video", "Watch", "Reels" }),
        ["watch"] = new("Xem Reels & Watch", "https://www.facebook.com/watch/", 9500, 13500, "", new[] { "Video", "Watch", "Reels" }),
        ["react_feed_post"] = new("Thả Like/Tim bài Feed", "https://www.facebook.com/", 8500, 12000, "like_post", new[] { "Trang chủ", "Home" }),
        ["visit_internal_fanpage"] = new("Nuôi chéo Fanpage nội bộ", "https://www.facebook.com/pages/?category=your_pages", 10000, 14500, "like_post", Array.Empty<string>()),
        ["view_photo_post"] = new("Xem ảnh / Đọc bình luận", "https://www.facebook.com/", 9000, 13000, "expand_comments", Array.Empty<string>()),
        ["view_photo_comments"] = new("Xem ảnh / Đọc bình luận", "https://www.facebook.com/", 9000, 13000, "expand_comments", Array.Empty<string>()),
        ["read_notifications"] = new("Đọc Thông báo", "https://www.facebook.com/notifications", 7500, 11000, "", new[] { "Thông báo", "Notifications" }),
        ["notif"] = new("Đọc Thông báo", "https://www.facebook.com/notifications", 7500, 11000, "", new[] { "Thông báo", "Notifications" }),
        ["search_keyword"] = new("Tìm kiếm từ khóa", "https://www.facebook.com/search/top/?q=xu%20huong", 8500, 12500, "", Array.Empty<string>()),
        ["visit_own_profile"] = new("Xem Trang cá nhân", "https://www.facebook.com/me", 7500, 11000, "", new[] { "Trang cá nhân", "Profile" }),
        ["profile"] = new("Xem Trang cá nhân", "https://www.facebook.com/me", 7500, 11000, "", new[] { "Trang cá nhân", "Profile" }),
        ["browse_marketplace"] = new("Dạo Marketplace", "https://www.facebook.com/marketplace/", 9000, 13000, "", new[] { "Marketplace" }),
        ["browse_groups"] = new("Lướt Nhóm (Groups)", "https://www.facebook.com/groups/feed/", 9000, 13000, "", new[] { "Nhóm", "Groups" }),
        ["pages"] = new("Quản lý Trang", "https://www.facebook.com/pages/?category=your_pages", 7500, 11000, "", new[] { "Trang", "Pages" }),
        ["mbs_like_comments_and_invite"] = new("Thả Tim Comment & Mời Follow", "https://business.facebook.com/latest/home", 10000, 14500, "", Array.Empty<string>()),
        ["biz"] = new("Business Suite (BM)", "https://business.facebook.com/latest/home", 9500, 13500, "", Array.Empty<string>()),
        ["refresh_cookie_and_close"] = new("Lưu Cookie DPAPI & Đóng", "https://www.facebook.com/", 2500, 4000, "save_close", Array.Empty<string>()),
        ["save_cookie_close"] = new("Lưu Cookie DPAPI & Đóng", "https://www.facebook.com/", 2500, 4000, "save_close", Array.Empty<string>()),
    };

    private static string GetWindowTitleSafe(IntPtr hWnd)
    {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string GetClassNameSafe(IntPtr hWnd)
    {
        var sb = new StringBuilder(128);
        GetClassName(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    /// <summary>Captures handles of currently visible Chrome top-level windows (excluding AdsOps Desktop itself).</summary>
    public static HashSet<IntPtr> SnapshotVisibleChromeWindows()
    {
        var set = new HashSet<IntPtr>();
        try
        {
            EnumWindows((hWnd, _) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                if (!string.Equals(GetClassNameSafe(hWnd), "Chrome_WidgetWin_1", StringComparison.Ordinal)) return true;
                var title = GetWindowTitleSafe(hWnd);
                if (string.IsNullOrWhiteSpace(title) || title.Contains("AdsOps Desktop Pro", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
                set.Add(hWnd);
                return true;
            }, IntPtr.Zero);
        }
        catch { }
        return set;
    }

    /// <summary>Waits for the newly opened Chrome window HWND created after <paramref name="before"/>.</summary>
    public static async Task<IntPtr> WaitForNewChromeWindowAsync(
        HashSet<IntPtr> before,
        int timeoutMs = 5500,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(800, timeoutMs));
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            var current = SnapshotVisibleChromeWindows();
            foreach (var hWnd in current)
            {
                if (!before.Contains(hWnd))
                {
                    return hWnd;
                }
            }
            await Task.Delay(180, ct).ConfigureAwait(false);
        }

        var fallback = SnapshotVisibleChromeWindows()
            .FirstOrDefault(h =>
            {
                var t = GetWindowTitleSafe(h);
                return t.Contains("Facebook", StringComparison.OrdinalIgnoreCase)
                    || t.Contains("Meta Business Suite", StringComparison.OrdinalIgnoreCase);
            });
        return fallback;
    }

    /// <summary>Locates Chrome_RenderWidgetHostHWND inside a Chrome window and wakes its UIAutomation tree without focus steal.</summary>
    public static IntPtr FindRenderWidgetChild(IntPtr chromeHwnd)
    {
        if (chromeHwnd == IntPtr.Zero || !IsWindow(chromeHwnd)) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(chromeHwnd, (child, _) =>
        {
            if (GetClassNameSafe(child).Contains("Chrome_RenderWidgetHostHWND", StringComparison.OrdinalIgnoreCase))
            {
                SendMessageTimeout(child, WM_GETOBJECT, IntPtr.Zero, new IntPtr(OBJID_CLIENT), 2, 200, out _);
                if (found == IntPtr.Zero) found = child;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// <summary>Sends smooth background mouse wheel scroll messages directly to the Chrome renderer HWND.</summary>
    public static void PostSmoothScroll(IntPtr chromeHwnd, int wheelDelta)
    {
        if (chromeHwnd == IntPtr.Zero || !IsWindow(chromeHwnd)) return;
        var target = FindRenderWidgetChild(chromeHwnd);
        if (target == IntPtr.Zero) target = chromeHwnd;
        if (!GetWindowRect(target, out var rect)) return;

        int cx = (rect.Left + rect.Right) / 2;
        int cy = (rect.Top + rect.Bottom) / 2;
        var lParam = new IntPtr(((cy & 0xFFFF) << 16) | (cx & 0xFFFF));
        int notches = Math.Max(1, Math.Min(4, Math.Abs(wheelDelta) / 120));
        int singleDelta = wheelDelta < 0 ? -120 : 120;
        var wParam = new IntPtr(unchecked((int)singleDelta << 16));

        for (int i = 0; i < notches; i++)
        {
            PostMessage(target, WM_MOUSEWHEEL, wParam, lParam);
            if (i + 1 < notches) Thread.Sleep(75);
        }
    }

    private static bool TryInvokeNonIntrusive(AutomationElement? el)
    {
        var cur = el;
        for (int depth = 0; depth < 3 && cur != null; depth++)
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

            try { cur = TreeWalker.ControlViewWalker.GetParent(cur); }
            catch { break; }
        }
        return false;
    }

    /// <summary>Inspects visible title &amp; accessibility text inside Chrome window to detect checkpoint or logged-out screen.</summary>
    public static (string? ChallengeReason, string? LoggedOutReason) InspectWindowState(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return (null, null);
        try
        {
            var title = GetWindowTitleSafe(hwnd).ToLowerInvariant();
            if (title.Contains("checkpoint") || title.Contains("xác minh") || title.Contains("verify"))
            {
                return ("Tiêu đề xác minh/checkpoint", null);
            }
            if (title.Contains("đăng nhập") || title.Contains("log in to facebook") || title.Contains("login"))
            {
                return (null, "Màn hình đăng nhập Facebook (chưa có phiên trong Chrome Profile này)");
            }

            FindRenderWidgetChild(hwnd);
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return (null, null);

            var all = root.FindAll(TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition);
            if (all == null) return (null, null);

            int inspected = 0;
            bool sawEmailOrPass = false;
            bool sawLoginBtn = false;
            foreach (AutomationElement el in all)
            {
                if (inspected++ > 260) break;
                try
                {
                    var nm = (el.Current.Name ?? "").Trim().ToLowerInvariant();
                    if (string.IsNullOrEmpty(nm)) continue;

                    if (nm.Contains("xác minh bạn là con người") ||
                        nm.Contains("verify you are human") ||
                        nm.Contains("tài khoản của bạn tạm thời bị chặn") ||
                        nm.Contains("your account is temporarily restricted") ||
                        nm.Contains("bạn hiện không thể tạo"))
                    {
                        return (nm, null);
                    }

                    if (nm.Contains("email hoặc số điện thoại") ||
                        nm.Contains("email or phone") ||
                        nm == "mật khẩu" ||
                        nm == "password")
                    {
                        sawEmailOrPass = true;
                    }
                    if ((nm == "đăng nhập" || nm == "log in") && el.Current.ControlType == ControlType.Button)
                    {
                        sawLoginBtn = true;
                    }
                    if (nm.Contains("đăng nhập facebook") || nm.Contains("log in to facebook"))
                    {
                        return (null, "Form đăng nhập Facebook (chưa đăng nhập trên Profile gốc)");
                    }
                }
                catch { }
            }

            if (sawEmailOrPass && sawLoginBtn)
            {
                return (null, "Form đăng nhập Facebook (chưa đăng nhập trên Profile gốc)");
            }
        }
        catch { }
        return (null, null);
    }

    /// <summary>Clicks Facebook top/left navigation links in-tab via UIAutomation without touching the cursor.</summary>
    public static bool TryInvokeFacebookSectionNav(IntPtr hwnd, string stepKey)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        if (!NativeStops.TryGetValue(stepKey, out var meta) || meta.NavNames.Length == 0) return false;

        try
        {
            FindRenderWidgetChild(hwnd);
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return false;

            var cond = new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
            var items = root.FindAll(TreeScope.Descendants, cond);
            if (items == null) return false;

            int checkedCount = 0;
            foreach (AutomationElement el in items)
            {
                if (checkedCount++ > 200) break;
                try
                {
                    var nm = (el.Current.Name ?? "").Trim();
                    if (string.IsNullOrEmpty(nm)) continue;
                    var b = el.Current.BoundingRectangle;
                    if (double.IsInfinity(b.Width) || b.Width < 16 || b.Height < 14) continue;
                    if (meta.NavNames.Any(t => string.Equals(nm, t, StringComparison.OrdinalIgnoreCase)))
                    {
                        if (TryInvokeNonIntrusive(el)) return true;
                    }
                }
                catch { }
            }
        }
        catch { }
        return false;
    }

    private static void NavigateNativeProfileStep(IntPtr hwnd, string safeProfile, string stepKey, string stepUrl)
    {
        if (TryInvokeFacebookSectionNav(hwnd, stepKey))
        {
            return;
        }

        try
        {
            var chromeExe = ExtensionProvisioner.FindChromeExecutable() ?? "chrome.exe";
            var psi = new ProcessStartInfo
            {
                FileName = chromeExe,
                UseShellExecute = !System.IO.File.Exists(chromeExe),
            };
            // Intentionally omit --new-window so the existing native profile window handles navigation
            psi.ArgumentList.Add($"--profile-directory={safeProfile}");
            psi.ArgumentList.Add(stepUrl);
            using var p = Process.Start(psi);
        }
        catch { }
    }

    /// <summary>Finds an unpressed Like button inside the Chrome viewport and invokes it via UIAutomation.</summary>
    public static bool TryLikeVisiblePostInWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        try
        {
            if (!GetWindowRect(hwnd, out var winRect)) return false;
            FindRenderWidgetChild(hwnd);
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return false;

            var btnCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            var btns = root.FindAll(TreeScope.Descendants, btnCond);
            if (btns == null) return false;

            int scanned = 0;
            foreach (AutomationElement el in btns)
            {
                if (scanned++ > 250) break;
                try
                {
                    var nm = (el.Current.Name ?? "").Trim();
                    if (!string.Equals(nm, "Thích", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(nm, "Like", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    var b = el.Current.BoundingRectangle;
                    if (double.IsInfinity(b.Width) || b.Width < 18 || b.Height < 14) continue;
                    if (b.Top < winRect.Top + 120 || b.Bottom > winRect.Bottom - 35) continue;

                    if (el.TryGetCurrentPattern(TogglePattern.Pattern, out var tpObj) && tpObj is TogglePattern tp)
                    {
                        if (tp.Current.ToggleState == ToggleState.On) continue;
                        tp.Toggle();
                        return true;
                    }
                    if (TryInvokeNonIntrusive(el)) return true;
                }
                catch { }
            }
        }
        catch { }
        return false;
    }

    /// <summary>Finds and invokes a comment-expansion control inside the Chrome viewport.</summary>
    public static bool TryExpandCommentsInWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        try
        {
            if (!GetWindowRect(hwnd, out var winRect)) return false;
            FindRenderWidgetChild(hwnd);
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return false;

            var cond = new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink));
            var items = root.FindAll(TreeScope.Descendants, cond);
            if (items == null) return false;

            int scanned = 0;
            foreach (AutomationElement el in items)
            {
                if (scanned++ > 250) break;
                try
                {
                    var nm = (el.Current.Name ?? "").Trim().ToLowerInvariant();
                    if (string.IsNullOrEmpty(nm)) continue;
                    if (!nm.Contains("xem thêm bình luận") &&
                        !nm.Contains("view more comments") &&
                        !nm.Contains("bình luận") &&
                        !nm.Contains("comment"))
                    {
                        continue;
                    }
                    var b = el.Current.BoundingRectangle;
                    if (double.IsInfinity(b.Width) || b.Width < 18 || b.Height < 12) continue;
                    if (b.Top < winRect.Top + 110 || b.Bottom > winRect.Bottom - 30) continue;

                    if (TryInvokeNonIntrusive(el)) return true;
                }
                catch { }
            }
        }
        catch { }
        return false;
    }

    private static List<string> ParseSteps(string rawRoute)
    {
        var steps = (rawRoute ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => NativeStops.ContainsKey(s))
            .ToList();
        if (steps.Count == 0)
        {
            steps.Add("scroll_feed");
            steps.Add("read_notifications");
        }
        return steps;
    }

    /// <summary>
    /// Executes the scheduled interaction sequence against an opened Native Chrome window,
    /// stepping aside immediately if the unpacked Extension sends a live heartbeat.
    /// </summary>
    public static async Task RunIfNeededAsync(
        IntPtr hwnd,
        ViaWorkspaceEntry via,
        string targetUrl,
        Func<string, bool> hasExtensionHeartbeat,
        Func<BrowserEventPayloadDto, Task> emitEvent,
        Action<string> log,
        bool autoCloseWindowConfig,
        CancellationToken ct,
        Func<bool>? isPaused = null,
        Func<bool>? consumeSkipStep = null)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || string.IsNullOrWhiteSpace(targetUrl)) return;
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var uri)) return;

        var qs = HttpUtility.ParseQueryString(uri.Query);
        bool isPreAdsWarmup = string.Equals(qs["adsops_preads_warmup"], "1", StringComparison.Ordinal);
        bool isKeepAlive = string.Equals(qs["adsops_keepalive_session"], "1", StringComparison.Ordinal)
                        || string.Equals(qs["adsops_keepalive"], "1", StringComparison.Ordinal);
        if (!isPreAdsWarmup && !isKeepAlive) return;

        var safeProfile = ExtensionProvisioner.ResolveProfileDirectory(via.BrowserProfileLabel, via.Label);
        var viaKey = !string.IsNullOrWhiteSpace(via.ViaId) ? via.ViaId : via.Label;
        var startedAt = DateTime.UtcNow;

        try
        {
            // Give native Chrome & any manually loaded Extension 2.8s to initialize
            await Task.Delay(2800, ct).ConfigureAwait(false);
            if (hasExtensionHeartbeat(viaKey))
            {
                return;
            }

            if (isPreAdsWarmup)
            {
                int warmSec = int.TryParse(qs["adsops_preads_sec"], out var ps) ? Math.Clamp(ps, 6, 90) : 20;
                var finalTarget = qs["adsops_preads_target"] ?? "";
                await emitEvent(new BrowserEventPayloadDto
                {
                    EventType = "KEEPALIVE_STEP",
                    Source = "native_runner",
                    ViaId = via.ViaId,
                    ViaLabel = via.Label,
                    BrowserProfile = safeProfile,
                    StepIndex = 1,
                    TotalSteps = 1,
                    StepTitle = "Đệm Newsfeed trước Ads",
                    WaitSeconds = warmSec,
                    Detail = $"Bước 1/1: Đệm Newsfeed tự nhiên ({warmSec}s)",
                }).ConfigureAwait(false);

                var endAt = DateTime.UtcNow.AddSeconds(warmSec);
                while (DateTime.UtcNow < endAt && !ct.IsCancellationRequested && IsWindow(hwnd))
                {
                    PostSmoothScroll(hwnd, -Random.Shared.Next(240, 480));
                    await Task.Delay(Random.Shared.Next(1900, 2900), ct).ConfigureAwait(false);
                }

                if (!ct.IsCancellationRequested && IsWindow(hwnd) &&
                    Uri.TryCreate(finalTarget, UriKind.Absolute, out _))
                {
                    NavigateNativeProfileStep(hwnd, safeProfile, "biz", finalTarget);
                }
                return;
            }

            var steps = ParseSteps(qs["adsops_ka_route"] ?? "");
            var crossPageUrl = qs["adsops_cross_page_url"] ?? "";
            bool wantAutoClose = !string.Equals(qs["adsops_auto_close"], "0", StringComparison.Ordinal);
            bool fastTest = string.Equals(qs["adsops_fast_test"], "1", StringComparison.Ordinal);
            int fixedStepMs = int.TryParse(qs["adsops_step_ms"], out var parsedMs) && parsedMs >= 500 ? parsedMs : 0;

            var summaryParts = steps.Select(k => NativeStops.TryGetValue(k, out var m) ? m.Label : k).ToList();
            var routeSummary = string.Join(" → ", summaryParts);

            log($"🤖 [Native Runner] Đã kích hoạt thực thi {steps.Count} bước cho '{via.Label}' (0% chiếm chuột)...");

            for (int idx = 0; idx < steps.Count && !ct.IsCancellationRequested; idx++)
            {
                if (!IsWindow(hwnd)) return;
                if (hasExtensionHeartbeat(viaKey)) return;

                var (challengeReason, loggedOutReason) = InspectWindowState(hwnd);
                if (!string.IsNullOrEmpty(challengeReason))
                {
                    await emitEvent(new BrowserEventPayloadDto
                    {
                        EventType = "SAFETY_CHALLENGE",
                        Source = "native_runner",
                        ViaId = via.ViaId,
                        ViaLabel = via.Label,
                        BrowserProfile = safeProfile,
                        Detail = challengeReason,
                    }).ConfigureAwait(false);
                    return;
                }
                if (!string.IsNullOrEmpty(loggedOutReason))
                {
                    await emitEvent(new BrowserEventPayloadDto
                    {
                        EventType = "COOKIE_LOGGED_OUT",
                        Source = "native_runner",
                        ViaId = via.ViaId,
                        ViaLabel = via.Label,
                        BrowserProfile = safeProfile,
                        Detail = loggedOutReason,
                    }).ConfigureAwait(false);
                    return;
                }

                var code = steps[idx];
                var meta = NativeStops.TryGetValue(code, out var foundMeta) ? foundMeta : NativeStops["scroll_feed"];
                var stepUrl = string.Equals(code, "visit_internal_fanpage", StringComparison.OrdinalIgnoreCase) &&
                              crossPageUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                    ? crossPageUrl
                    : meta.Url;

                if (idx > 0 || (!string.Equals(code, "scroll_feed", StringComparison.OrdinalIgnoreCase) && !string.Equals(code, "feed", StringComparison.OrdinalIgnoreCase)))
                {
                    NavigateNativeProfileStep(hwnd, safeProfile, code, stepUrl);
                    await Task.Delay(1800, ct).ConfigureAwait(false);
                    if (!IsWindow(hwnd)) return;
                }

                int waitMs = fixedStepMs >= 500
                    ? fixedStepMs
                    : fastTest
                        ? Random.Shared.Next(4500, 6500)
                        : Random.Shared.Next(meta.MinMs, meta.MaxMs);

                await emitEvent(new BrowserEventPayloadDto
                {
                    EventType = "KEEPALIVE_STEP",
                    Source = "native_runner",
                    ViaId = via.ViaId,
                    ViaLabel = via.Label,
                    BrowserProfile = safeProfile,
                    StepIndex = idx + 1,
                    TotalSteps = steps.Count,
                    StepTitle = meta.Label,
                    WaitSeconds = Math.Max(1, (int)Math.Round(waitMs / 1000.0)),
                    Detail = $"Bước {idx + 1}/{steps.Count}: {meta.Label}",
                    RouteSummary = routeSummary,
                }).ConfigureAwait(false);

                var stepDeadline = DateTime.UtcNow.AddMilliseconds(waitMs);
                var halfPoint = DateTime.UtcNow.AddMilliseconds(waitMs * 0.45);
                bool microDone = string.IsNullOrEmpty(meta.MicroAction) || string.Equals(meta.MicroAction, "save_close", StringComparison.Ordinal);

                while (DateTime.UtcNow < stepDeadline && !ct.IsCancellationRequested)
                {
                    if (!IsWindow(hwnd)) return;
                    if (consumeSkipStep != null && consumeSkipStep())
                    {
                        log($"⏭️ [Native Runner] Đã bỏ qua bước {idx + 1}/{steps.Count} ({meta.Label}) cho '{via.Label}'.");
                        break;
                    }
                    while (isPaused != null && isPaused() && !ct.IsCancellationRequested)
                    {
                        if (!IsWindow(hwnd)) return;
                        if (consumeSkipStep != null && consumeSkipStep())
                        {
                            log($"⏭️ [Native Runner] Đã bỏ qua bước {idx + 1}/{steps.Count} ({meta.Label}) cho '{via.Label}'.");
                            stepDeadline = DateTime.UtcNow;
                            break;
                        }
                        stepDeadline = stepDeadline.AddMilliseconds(350);
                        halfPoint = halfPoint.AddMilliseconds(350);
                        await Task.Delay(350, ct).ConfigureAwait(false);
                    }
                    if (DateTime.UtcNow >= stepDeadline || ct.IsCancellationRequested) break;

                    int delta = Random.Shared.NextDouble() < 0.2 ? 120 : -Random.Shared.Next(180, 420);
                    PostSmoothScroll(hwnd, delta);

                    if (!microDone && DateTime.UtcNow >= halfPoint)
                    {
                        microDone = true;
                        if (string.Equals(meta.MicroAction, "like_post", StringComparison.Ordinal))
                        {
                            if (TryLikeVisiblePostInWindow(hwnd))
                            {
                                log($"👍 [Native Runner] Đã thả Like tự nhiên bài viết trong '{via.Label}' (Bước {idx + 1}).");
                            }
                        }
                        else if (string.Equals(meta.MicroAction, "expand_comments", StringComparison.Ordinal))
                        {
                            if (TryExpandCommentsInWindow(hwnd))
                            {
                                log($"💬 [Native Runner] Đã bấm mở rộng bình luận trong '{via.Label}' (Bước {idx + 1}).");
                            }
                        }
                    }

                    int slice = (int)Math.Min(700, Math.Max(200, (stepDeadline - DateTime.UtcNow).TotalMilliseconds));
                    await Task.Delay(slice, ct).ConfigureAwait(false);
                }
            }

            if (ct.IsCancellationRequested) return;

            int durationSec = Math.Max(5, (int)Math.Round((DateTime.UtcNow - startedAt).TotalSeconds));
            await emitEvent(new BrowserEventPayloadDto
            {
                EventType = "KEEPALIVE_OK",
                Source = "native_runner",
                ViaId = via.ViaId,
                ViaLabel = via.Label,
                BrowserProfile = safeProfile,
                Detail = routeSummary,
                RouteSummary = routeSummary,
                DurationSec = durationSec,
            }).ConfigureAwait(false);

            if (wantAutoClose || autoCloseWindowConfig)
            {
                await Task.Delay(2200, ct).ConfigureAwait(false);
                if (IsWindow(hwnd))
                {
                    PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                }
                ChromeSessionTracker.Default.MarkKeepAliveClosed(via.ViaId, via.Label, safeProfile);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            log($"⚠️ [Native Runner] Lỗi thực thi cho '{via.Label}': {ex.Message}");
        }
    }
}
