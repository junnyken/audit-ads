using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace AdsOpsDesktop;

/// <summary>
/// Semantic Design Tokens for AdsOps Desktop Pro v2.3 (Slate Dark UI, WCAG AA >= 4.5:1 verified).
/// </summary>
internal static class ThemeTokens
{
    public static readonly FontFamily UiFont = new("Segoe UI");
    public static readonly FontFamily MonoFont = new("Cascadia Mono, Consolas, Courier New");
    public static readonly FontFamily IconFont = new("Segoe Fluent Icons, Segoe MDL2 Assets, Segoe UI Symbol");

    // Surfaces
    public static readonly SolidColorBrush BgCanvas = Freeze(15, 23, 42);           // #0F172A
    public static readonly SolidColorBrush BgSidebar = Freeze(11, 17, 32);          // #0B1120
    public static readonly SolidColorBrush BgHeader = Freeze(15, 23, 42);           // #0F172A
    public static readonly SolidColorBrush BgSurface = Freeze(22, 32, 50);          // #162032
    public static readonly SolidColorBrush BgSurfaceElevated = Freeze(30, 41, 59);  // #1E293B
    public static readonly SolidColorBrush BgSurfaceHover = Freeze(40, 53, 72);     // #283548
    public static readonly SolidColorBrush BgNavActive = Freeze(23, 37, 84);        // #172554
    public static readonly SolidColorBrush BgNavHover = Freeze(26, 36, 56);         // #1A2438
    public static readonly SolidColorBrush BgLogDrawer = Freeze(9, 14, 26);         // #090E1A

    // Borders
    public static readonly SolidColorBrush BorderSubtle = Freeze(38, 51, 72);       // #263348
    public static readonly SolidColorBrush BorderDefault = Freeze(51, 65, 85);      // #334155
    public static readonly SolidColorBrush BorderFocus = Freeze(96, 165, 250);      // #60A5FA

    // Text
    public static readonly SolidColorBrush TextWhite = Freeze(255, 255, 255);       // #FFFFFF
    public static readonly SolidColorBrush TextPrimary = Freeze(241, 245, 249);     // #F1F5F9
    public static readonly SolidColorBrush TextSecondary = Freeze(203, 213, 225);   // #CBD5E1
    public static readonly SolidColorBrush TextMuted = Freeze(148, 163, 184);       // #94A3B8

    // Solid action fills (chosen so #FFFFFF label achieves >= 4.5:1 WCAG AA)
    public static readonly SolidColorBrush AccentPrimary = Freeze(29, 78, 216);     // #1D4ED8 (6.52:1)
    public static readonly SolidColorBrush AccentPrimaryHover = Freeze(30, 64, 175);// #1E40AF
    public static readonly SolidColorBrush SuccessSolid = Freeze(4, 120, 87);       // #047857 (5.55:1)
    public static readonly SolidColorBrush SuccessSolidHover = Freeze(6, 95, 70);   // #065F46
    public static readonly SolidColorBrush DangerSolid = Freeze(185, 28, 28);       // #B91C1C (6.48:1)
    public static readonly SolidColorBrush DangerSolidHover = Freeze(153, 27, 27);  // #991B1B

    // Semantic foregrounds & dark tinted pill backgrounds (>= 4.5:1)
    public static readonly SolidColorBrush AccentText = Freeze(96, 165, 250);       // #60A5FA
    public static readonly SolidColorBrush InfoBg = Freeze(18, 36, 64);             // #122440
    public static readonly SolidColorBrush InfoBorder = Freeze(37, 99, 235);        // #2563EB

    public static readonly SolidColorBrush SuccessText = Freeze(52, 211, 153);      // #34D399
    public static readonly SolidColorBrush SuccessBg = Freeze(11, 43, 35);          // #0B2B23
    public static readonly SolidColorBrush SuccessBorder = Freeze(16, 185, 129);    // #10B981

    public static readonly SolidColorBrush WarningText = Freeze(251, 191, 36);      // #FBBF24
    public static readonly SolidColorBrush WarningBg = Freeze(43, 33, 11);          // #2B210B
    public static readonly SolidColorBrush WarningBorder = Freeze(217, 119, 6);     // #D97706

    public static readonly SolidColorBrush DangerText = Freeze(248, 113, 113);      // #F87171
    public static readonly SolidColorBrush DangerBg = Freeze(45, 21, 25);           // #2D1519
    public static readonly SolidColorBrush DangerBorder = Freeze(220, 38, 38);      // #DC2626

    public static readonly SolidColorBrush PurpleText = Freeze(192, 132, 252);      // #C084FC
    public static readonly SolidColorBrush PurpleBg = Freeze(37, 24, 56);           // #251838
    public static readonly SolidColorBrush PurpleBorder = Freeze(147, 51, 234);     // #9333EA

    public static readonly SolidColorBrush NeutralBg = Freeze(30, 41, 59);          // #1E293B
    public static readonly SolidColorBrush NeutralBorder = Freeze(71, 85, 105);     // #475569

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
