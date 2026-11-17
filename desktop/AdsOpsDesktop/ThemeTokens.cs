using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace AdsOpsDesktop;

/// <summary>
/// Semantic Design Tokens for AdsOps Desktop Pro v3.0 (UI/UX Pro Max — Linear Obsidian &amp; Emerald Cyber-Vault, WCAG AA >= 4.5:1 verified).
/// </summary>
internal static class ThemeTokens
{
    public static readonly FontFamily UiFont = new("Segoe UI Variable Text, Segoe UI");
    public static readonly FontFamily MonoFont = new("Cascadia Mono, JetBrains Mono, Consolas, Courier New");
    public static readonly FontFamily IconFont = new("Segoe Fluent Icons, Segoe MDL2 Assets, Segoe UI Symbol");

    public static string CurrentPalette { get; private set; } = "obsidian";

    // Surfaces (Default: Linear Obsidian #090A0F / #121521)
    public static SolidColorBrush BgCanvas { get; private set; } = Freeze(9, 10, 15);            // #090A0F
    public static SolidColorBrush BgSidebar { get; private set; } = Freeze(13, 15, 23);         // #0D0F17
    public static SolidColorBrush BgHeader { get; private set; } = Freeze(9, 10, 15);           // #090A0F
    public static SolidColorBrush BgSurface { get; private set; } = Freeze(18, 21, 33);         // #121521
    public static SolidColorBrush BgSurfaceElevated { get; private set; } = Freeze(24, 28, 43); // #181C2B
    public static SolidColorBrush BgSurfaceHover { get; private set; } = Freeze(34, 40, 62);    // #22283E
    public static SolidColorBrush BgNavActive { get; private set; } = Freeze(30, 27, 75);       // #1E1B4B
    public static SolidColorBrush BgNavHover { get; private set; } = Freeze(22, 26, 41);        // #161A29
    public static SolidColorBrush BgLogDrawer { get; private set; } = Freeze(7, 8, 13);         // #07080D

    // Borders
    public static SolidColorBrush BorderSubtle { get; private set; } = Freeze(35, 41, 62);      // #23293E
    public static SolidColorBrush BorderDefault { get; private set; } = Freeze(49, 57, 84);     // #313954
    public static SolidColorBrush BorderFocus { get; private set; } = Freeze(129, 140, 248);    // #818CF8

    // Text
    public static readonly SolidColorBrush TextWhite = Freeze(255, 255, 255);                   // #FFFFFF
    public static SolidColorBrush TextPrimary { get; private set; } = Freeze(248, 250, 252);    // #F8FAFC
    public static SolidColorBrush TextSecondary { get; private set; } = Freeze(203, 213, 225);  // #CBD5E1
    public static SolidColorBrush TextMuted { get; private set; } = Freeze(148, 163, 184);      // #94A3B8

    // Solid action fills (chosen so #FFFFFF label achieves >= 4.5:1 WCAG AA)
    public static SolidColorBrush AccentPrimary { get; private set; } = Freeze(79, 70, 229);      // #4F46E5 (6.29:1)
    public static SolidColorBrush AccentPrimaryHover { get; private set; } = Freeze(67, 56, 202); // #4338CA
    public static SolidColorBrush SuccessSolid { get; private set; } = Freeze(4, 120, 87);        // #047857 (5.55:1)
    public static SolidColorBrush SuccessSolidHover { get; private set; } = Freeze(6, 95, 70);    // #065F46
    public static SolidColorBrush DangerSolid { get; private set; } = Freeze(185, 28, 28);        // #B91C1C (6.48:1)
    public static SolidColorBrush DangerSolidHover { get; private set; } = Freeze(153, 27, 27);   // #991B1B

    // Semantic foregrounds & dark tinted pill backgrounds (>= 4.5:1)
    public static SolidColorBrush AccentText { get; private set; } = Freeze(129, 140, 248);     // #818CF8
    public static SolidColorBrush InfoBg { get; private set; } = Freeze(22, 24, 56);            // #161838
    public static SolidColorBrush InfoBorder { get; private set; } = Freeze(79, 70, 229);       // #4F46E5

    public static SolidColorBrush SuccessText { get; private set; } = Freeze(52, 211, 153);     // #34D399
    public static SolidColorBrush SuccessBg { get; private set; } = Freeze(11, 43, 35);         // #0B2B23
    public static SolidColorBrush SuccessBorder { get; private set; } = Freeze(16, 185, 129);   // #10B981

    public static SolidColorBrush WarningText { get; private set; } = Freeze(251, 191, 36);     // #FBBF24
    public static SolidColorBrush WarningBg { get; private set; } = Freeze(43, 33, 11);         // #2B210B
    public static SolidColorBrush WarningBorder { get; private set; } = Freeze(217, 119, 6);    // #D97706

    public static SolidColorBrush DangerText { get; private set; } = Freeze(248, 113, 113);     // #F87171
    public static SolidColorBrush DangerBg { get; private set; } = Freeze(45, 21, 25);          // #2D1519
    public static SolidColorBrush DangerBorder { get; private set; } = Freeze(220, 38, 38);     // #DC2626

    public static SolidColorBrush PurpleText { get; private set; } = Freeze(192, 132, 252);     // #C084FC
    public static SolidColorBrush PurpleBg { get; private set; } = Freeze(37, 24, 56);          // #251838
    public static SolidColorBrush PurpleBorder { get; private set; } = Freeze(147, 51, 234);    // #9333EA

    public static SolidColorBrush NeutralBg { get; private set; } = Freeze(24, 28, 43);         // #181C2B
    public static SolidColorBrush NeutralBorder { get; private set; } = Freeze(63, 73, 107);    // #3F496B

    public static void ApplyPalette(string? paletteKey)
    {
        var norm = (paletteKey ?? "obsidian").Trim().ToLowerInvariant();
        if (norm == "emerald")
        {
            CurrentPalette = "emerald";
            BgCanvas = Freeze(7, 11, 10);
            BgSidebar = Freeze(11, 18, 16);
            BgHeader = Freeze(7, 11, 10);
            BgSurface = Freeze(16, 26, 23);
            BgSurfaceElevated = Freeze(22, 36, 32);
            BgSurfaceHover = Freeze(29, 48, 42);
            BgNavActive = Freeze(13, 48, 38);
            BgNavHover = Freeze(18, 32, 28);
            BgLogDrawer = Freeze(5, 9, 8);
            BorderSubtle = Freeze(31, 53, 46);
            BorderDefault = Freeze(45, 79, 68);
            BorderFocus = Freeze(52, 211, 153);
            AccentPrimary = Freeze(4, 120, 87);
            AccentPrimaryHover = Freeze(6, 95, 70);
            AccentText = Freeze(52, 211, 153);
            InfoBg = Freeze(11, 43, 35);
            InfoBorder = Freeze(16, 185, 129);
            NeutralBg = Freeze(22, 36, 32);
            NeutralBorder = Freeze(45, 79, 68);
        }
        else
        {
            CurrentPalette = "obsidian";
            BgCanvas = Freeze(9, 10, 15);
            BgSidebar = Freeze(13, 15, 23);
            BgHeader = Freeze(9, 10, 15);
            BgSurface = Freeze(18, 21, 33);
            BgSurfaceElevated = Freeze(24, 28, 43);
            BgSurfaceHover = Freeze(34, 40, 62);
            BgNavActive = Freeze(30, 27, 75);
            BgNavHover = Freeze(22, 26, 41);
            BgLogDrawer = Freeze(7, 8, 13);
            BorderSubtle = Freeze(35, 41, 62);
            BorderDefault = Freeze(49, 57, 84);
            BorderFocus = Freeze(129, 140, 248);
            AccentPrimary = Freeze(79, 70, 229);
            AccentPrimaryHover = Freeze(67, 56, 202);
            AccentText = Freeze(129, 140, 248);
            InfoBg = Freeze(22, 24, 56);
            InfoBorder = Freeze(79, 70, 229);
            NeutralBg = Freeze(24, 28, 43);
            NeutralBorder = Freeze(63, 73, 107);
        }
    }

    private static SolidColorBrush Freeze(byte r, byte g, byte b)
    {
        var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
        brush.Freeze();
        return brush;
    }

    public static SolidColorBrush WithAlpha(Color baseColor, byte alpha)
    {
        var brush = new SolidColorBrush(Color.FromArgb(alpha, baseColor.R, baseColor.G, baseColor.B));
        brush.Freeze();
        return brush;
    }

    public static double RelativeLuminance(Color c)
    {
        static double Channel(byte v)
        {
            var s = v / 255.0;
            return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
        }

        return 0.2126 * Channel(c.R) + 0.7152 * Channel(c.G) + 0.0722 * Channel(c.B);
    }

    public static double ContrastRatio(Color fg, Color bg)
    {
        var l1 = RelativeLuminance(fg);
        var l2 = RelativeLuminance(bg);
        var lighter = Math.Max(l1, l2);
        var darker = Math.Min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    public static List<(string Name, double Ratio)> RunContrastAudit()
    {
        var pairs = new (string Name, SolidColorBrush Fg, SolidColorBrush Bg)[]
        {
            ("TextPrimary on Canvas", TextPrimary, BgCanvas),
            ("TextPrimary on Surface", TextPrimary, BgSurface),
            ("TextPrimary on Elevated", TextPrimary, BgSurfaceElevated),
            ("TextSecondary on Surface", TextSecondary, BgSurface),
            ("TextSecondary on Elevated", TextSecondary, BgSurfaceElevated),
            ("TextMuted on Canvas", TextMuted, BgCanvas),
            ("TextMuted on Surface", TextMuted, BgSurface),
            ("TextMuted on Elevated", TextMuted, BgSurfaceElevated),
            ("White on AccentPrimary", TextWhite, AccentPrimary),
            ("White on SuccessSolid", TextWhite, SuccessSolid),
            ("White on DangerSolid", TextWhite, DangerSolid),
            ("AccentText on InfoBg", AccentText, InfoBg),
            ("AccentText on Surface", AccentText, BgSurface),
            ("SuccessText on SuccessBg", SuccessText, SuccessBg),
            ("WarningText on WarningBg", WarningText, WarningBg),
            ("DangerText on DangerBg", DangerText, DangerBg),
            ("PurpleText on PurpleBg", PurpleText, PurpleBg),
        };

        var results = new List<(string Name, double Ratio)>(pairs.Length);
        foreach (var p in pairs)
        {
            results.Add((p.Name, Math.Round(ContrastRatio(p.Fg.Color, p.Bg.Color), 2)));
        }

        return results;
    }

    public static void ApplyDarkTitleBar(Window window)
    {
        window.SourceInitialized += (_, _) =>
        {
            try
            {
                var hwnd = new WindowInteropHelper(window).Handle;
                if (hwnd == IntPtr.Zero) return;
                int dark = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref dark, sizeof(int)) != 0)
                {
                    DwmSetWindowAttribute(hwnd, 19, ref dark, sizeof(int));
                }

                // Match #0B1120 (B=0x20, G=0x11, R=0x0B)
                int captionColor = 0x0020110B;
                DwmSetWindowAttribute(hwnd, 35, ref captionColor, sizeof(int));

                // DWMWCP_ROUND = 2
                int cornerPref = 2;
                DwmSetWindowAttribute(hwnd, 33, ref cornerPref, sizeof(int));
            }
            catch
            {
                // Older Windows builds silently ignore newer DWM attributes
            }
        };
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
}

/// <summary>
/// Unified Segoe Fluent Icons / Segoe MDL2 Assets glyphs so every screen uses one icon family.
/// </summary>
internal static class FluentIcons
{
    public const string Home = "\uE80F";
    public const string People = "\uE716";
    public const string Play = "\uE768";
    public const string Pause = "\uE769";
    public const string Stop = "\uE71A";
    public const string FastForward = "\uEB9D";
    public const string Page = "\uE8A5";
    public const string Chart = "\uE9D2";
    public const string ShieldKey = "\uEA18";
    public const string Key = "\uE8D7";
    public const string Copy = "\uE8C8";
    public const string Sync = "\uE895";
    public const string Globe = "\uE774";
    public const string Lock = "\uE72E";
    public const string Warning = "\uE7BA";
    public const string CheckCircle = "\uE73E";
    public const string Add = "\uE710";
    public const string Edit = "\uE70F";
    public const string Delete = "\uE74D";
    public const string Search = "\uE721";
    public const string CoffeeWarmup = "\uE706"; // Brightness/Warmth sun-star for Safe Warmup
    public const string RocketLaunch = "\uE77B"; // Browser profile launch
    public const string Send = "\uE724";
    public const string Alert = "\uEA8F";
    public const string Settings = "\uE713";
    public const string ChevronUp = "\uE70E";
    public const string ChevronDown = "\uE70D";
    public const string FolderOpen = "\uE838";
    public const string ShieldCheck = "\uE83D";
    public const string Download = "\uE896";
    public const string Upload = "\uE898";
    public const string Lightning = "\uE945";
    public const string Diagnostic = "\uE9D9";
}
