using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace AdsOpsDesktop;

/// <summary>
/// Hybrid Page Content Nurture Engine (v3.3.0):
/// - Nested Spintax generator ({A|B|C}) with {page_name}, {niche}, {date} placeholders.
/// - Anti-duplicate Image Hash Jitter (strips EXIF + subtle 1px RGB delta + re-encode JPEG 88-94%).
/// - Curated Share URL rotation with per-Page deduplication history.
/// - Niche-organized local PageAssets folder provisioning (avatars / covers / posts).
/// </summary>
public static class PageContentNurtureEngine
{
    public const string DefaultCaptionSpintax =
        "{Chào ngày mới|Hôm nay thật tuyệt|Góc chia sẻ nhỏ|Cập nhật mới từ {page_name}} {cả nhà|mọi người|cả nhà mình}! " +
        "{Cảm ơn mọi người đã luôn đồng hành cùng|Rất vui được kết nối với mọi người tại} {page_name}. " +
        "{Chúc cả nhà một ngày làm việc hiệu quả và nhiều năng lượng|Đừng quên theo dõi Trang để cập nhật thêm nhiều thông tin hữu ích nhé}!";

    private static readonly Regex InnerSpintaxRegex = new(@"\{([^{}]+)\}", RegexOptions.Compiled);
    private static readonly string[] SupportedImageExts = { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };

    public static string DefaultAssetsBaseDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AdsOpsDesktop",
            "PageAssets");

    public static string ResolveEffectiveAssetsDir(string? configuredDir)
    {
        var clean = (configuredDir ?? "").Trim();
        return string.IsNullOrWhiteSpace(clean) ? DefaultAssetsBaseDir : clean;
    }

    public static string SanitizeFolderSegment(string? raw)
    {
        var s = (raw ?? "general").Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(s)) return "general";
        var cleaned = Regex.Replace(s, @"[^a-z0-9_\-]+", "_").Trim('_');
        return string.IsNullOrWhiteSpace(cleaned) ? "general" : cleaned;
    }

    /// <summary>Ensures avatars/, covers/, posts/ folders exist for the given niche and returns the niche root path.</summary>
    public static string EnsurePageAssetFolders(string? configuredBaseDir, string? nicheKey = "general")
    {
        var baseDir = ResolveEffectiveAssetsDir(configuredBaseDir);
        var nicheSeg = SanitizeFolderSegment(nicheKey);
        var nicheRoot = Path.Combine(baseDir, nicheSeg);
        Directory.CreateDirectory(Path.Combine(nicheRoot, "avatars"));
        Directory.CreateDirectory(Path.Combine(nicheRoot, "covers"));
        Directory.CreateDirectory(Path.Combine(nicheRoot, "posts"));

        var readmePath = Path.Combine(baseDir, "HUONG_DAN_THU_MUC_ANH.txt");
        if (!File.Exists(readmePath))
        {
            try
            {
                File.WriteAllText(
                    readmePath,
                    "AdsOps Desktop Pro v3.3.0 — Kho Anh Nuoi Fanpage (Chong trung hash tu dong)\r\n" +
                    "==========================================================================\r\n" +
                    "- Bo anh vao cac thu muc con theo nganh hang:\r\n" +
                    "  + avatars/ : Anh dai dien Page (khi hoan thien ho so sau tao Page)\r\n" +
                    "  + covers/  : Anh bia Page\r\n" +
                    "  + posts/   : Kho anh dang bai nuoi Page 7-14 ngay\r\n\r\n" +
                    "Luu y: He thong tu dong xoa EXIF va bien doi 1px + tai nen JPEG truoc khi dang\r\n" +
                    "de moi Fanpage co ma bam (MD5/SHA-256) doc nhat, tranh bi Meta quet trung anh.\r\n");
            }
            catch
            {
                // Ignore read-only folder errors.
            }
        }
        return nicheRoot;
    }

    /// <summary>Expands nested spintax {A|B|C} and dynamic placeholders {page_name}, {niche}, {date}.</summary>
    public static string SpinText(string? template, string? pageName = "", string? nicheLabel = "", Random? rng = null)
    {
        var text = string.IsNullOrWhiteSpace(template) ? DefaultCaptionSpintax : template.Trim();
        var r = rng ?? Random.Shared;

        // First substitute known named tokens so they aren't mistaken for spintax groups.
        var safePage = string.IsNullOrWhiteSpace(pageName) ? "Fanpage" : pageName.Trim();
        var safeNiche = string.IsNullOrWhiteSpace(nicheLabel) ? "Thương hiệu" : nicheLabel.Trim();
        var today = DateTime.Now.ToString("dd/MM/yyyy");

        text = text.Replace("{page_name}", safePage, StringComparison.OrdinalIgnoreCase)
                   .Replace("{niche}", safeNiche, StringComparison.OrdinalIgnoreCase)
                   .Replace("{date}", today, StringComparison.OrdinalIgnoreCase);

        for (int pass = 0; pass < 8; pass++)
        {
            if (!InnerSpintaxRegex.IsMatch(text)) break;
            text = InnerSpintaxRegex.Replace(text, m =>
            {
                var body = m.Groups[1].Value;
                if (!body.Contains('|')) return body;
                var choices = body.Split('|');
                return choices[r.Next(choices.Length)];
            });
        }

        // Collapse accidental double spaces while preserving newlines.
        text = Regex.Replace(text, @"[ \t]{2,}", " ").Trim();
        return text;
    }

    /// <summary>Picks a random image from posts/ (or avatars/covers) in niche folder or fallback general/root folder.</summary>
    public static string? PickRandomImageFromDir(
        string? configuredBaseDir,
        string? nicheKey,
        string subFolder = "posts",
        Random? rng = null)
    {
        var baseDir = ResolveEffectiveAssetsDir(configuredBaseDir);
        var nicheSeg = SanitizeFolderSegment(nicheKey);
        var candidatesDirs = new[]
        {
            Path.Combine(baseDir, nicheSeg, subFolder),
            Path.Combine(baseDir, "general", subFolder),
            Path.Combine(baseDir, subFolder),
            baseDir,
        };

        var files = new List<string>();
        foreach (var dir in candidatesDirs)
        {
            if (!Directory.Exists(dir)) continue;
            try
            {
                var found = Directory.EnumerateFiles(dir, "*.*", SearchOption.TopDirectoryOnly)
                    .Where(f => SupportedImageExts.Contains(Path.GetExtension(f).ToLowerInvariant()))
                    .ToList();
                if (found.Count > 0)
                {
                    files = found;
                    break;
                }
            }
            catch
            {
                // Ignore inaccessible dirs.
            }
        }

        if (files.Count == 0) return null;
        var r = rng ?? Random.Shared;
        return files[r.Next(files.Count)];
    }

    /// <summary>
    /// Creates a unique visual-identical JPEG variant of sourceImagePath by stripping EXIF,
    /// tweaking 1 subtle corner pixel RGB by ±1..3, and re-encoding with randomized JPEG quality (88-94).
    /// Guarantees a distinct SHA-256 hash for every Page post.
    /// </summary>
    public static string CreateUniqueImageVariant(
        string sourceImagePath,
        string? outputDir = null,
        Random? rng = null)
    {
        if (string.IsNullOrWhiteSpace(sourceImagePath) || !File.Exists(sourceImagePath))
        {
            throw new FileNotFoundException("Không tìm thấy file ảnh nguồn nuôi Page.", sourceImagePath);
        }

        var r = rng ?? Random.Shared;
        var outFolder = string.IsNullOrWhiteSpace(outputDir)
            ? Path.Combine(Path.GetTempPath(), "AdsOpsNurtureMedia")
            : outputDir;
        Directory.CreateDirectory(outFolder);

        var outPath = Path.Combine(
            outFolder,
            $"adsops_media_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}.jpg");

        using var fs = File.OpenRead(sourceImagePath);
        var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
        return EncodeUniqueJpegWithCornerJitter(decoder.Frames[0], outPath, r);
    }

    private static string EncodeUniqueJpegWithCornerJitter(BitmapSource sourceFrame, string outPath, Random r)
    {
        var converted = new FormatConvertedBitmap(sourceFrame, PixelFormats.Bgra32, null, 0);
        var wb = new WriteableBitmap(converted);

        int w = wb.PixelWidth;
        int h = wb.PixelHeight;
        if (w > 0 && h > 0)
        {
            int pxX = r.Next(0, Math.Min(w, 8));
            int pxY = r.Next(0, Math.Min(h, 8));
            byte[] pixel = new byte[4];
            wb.CopyPixels(new Int32Rect(pxX, pxY, 1, 1), pixel, 4, 0);

            int deltaB = r.Next(1, 5) * (r.Next(2) == 0 ? 1 : -1);
            int deltaG = r.Next(1, 5) * (r.Next(2) == 0 ? 1 : -1);
            int deltaR = r.Next(1, 5) * (r.Next(2) == 0 ? 1 : -1);
            pixel[0] = (byte)Math.Clamp(pixel[0] + deltaB, 0, 255);
            pixel[1] = (byte)Math.Clamp(pixel[1] + deltaG, 0, 255);
            pixel[2] = (byte)Math.Clamp(pixel[2] + deltaR, 0, 255);
            pixel[3] = 255;

            wb.WritePixels(new Int32Rect(pxX, pxY, 1, 1), pixel, 4, 0);
        }

        var encoder = new JpegBitmapEncoder
        {
            QualityLevel = r.Next(88, 95),
        };
        encoder.Frames.Add(BitmapFrame.Create(wb));

        using var outStream = File.Create(outPath);
        encoder.Save(outStream);
        return outPath;
    }

    private static T RunOnStaThread<T>(Func<T> action)
    {
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
        {
            return action();
        }
        T result = default!;
        Exception? captured = null;
        var t = new Thread(() =>
        {
            try { result = action(); }
            catch (Exception ex) { captured = ex; }
        })
        {
            IsBackground = true,
        };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        if (captured != null) ExceptionDispatchInfo.Capture(captured).Throw();
        return result;
    }

    /// <summary>
    /// Generates a crisp 1080x1080 visual social post card (niche gradient backdrop + card frame + spun headline + page footer)
    /// when the user has not yet stocked images inside PageAssets. Automatically marshals to an STA thread.
    /// </summary>
    public static string GenerateFallbackPostCardImage(
        string? pageName,
        string? captionText,
        string? nicheKey = "general",
        string? outputDir = null,
        Random? rng = null)
    {
        var r = rng ?? Random.Shared;
        var outFolder = string.IsNullOrWhiteSpace(outputDir)
            ? Path.Combine(Path.GetTempPath(), "AdsOpsNurtureMedia")
            : outputDir;
        Directory.CreateDirectory(outFolder);

        var outPath = Path.Combine(
            outFolder,
            $"adsops_autocard_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}.jpg");

        var nicheNorm = SanitizeFolderSegment(nicheKey);
        (Color bg1, Color bg2, Color accent) = nicheNorm switch
        {
            var s when s.Contains("beauty") || s.Contains("spa") || s.Contains("cosmetic")
                => (Color.FromRgb(131, 24, 67), Color.FromRgb(190, 24, 93), Color.FromRgb(251, 113, 133)),
            var s when s.Contains("fashion") || s.Contains("shop") || s.Contains("clothing")
                => (Color.FromRgb(30, 27, 75), Color.FromRgb(79, 70, 229), Color.FromRgb(129, 140, 248)),
            var s when s.Contains("food") || s.Contains("cafe") || s.Contains("fnb")
                => (Color.FromRgb(124, 45, 18), Color.FromRgb(194, 65, 12), Color.FromRgb(251, 146, 60)),
            var s when s.Contains("real") || s.Contains("bds") || s.Contains("home")
                => (Color.FromRgb(6, 78, 59), Color.FromRgb(4, 120, 87), Color.FromRgb(52, 211, 153)),
            _ => (Color.FromRgb(15, 23, 42), Color.FromRgb(30, 64, 175), Color.FromRgb(56, 189, 248)),
        };

        var safePage = string.IsNullOrWhiteSpace(pageName) ? "Fanpage Chính Hãng" : pageName.Trim();
        var cleanBody = Regex.Replace((captionText ?? "").Trim(), @"\s+", " ");
        if (string.IsNullOrWhiteSpace(cleanBody))
        {
            cleanBody = SpinText(DefaultCaptionSpintax, safePage, nicheKey, r);
        }
        if (cleanBody.Length > 210) cleanBody = cleanBody[..207].TrimEnd() + "...";
        var footerText = $"@ {safePage}  •  {DateTime.Now:dd/MM/yyyy}";
        var badgeText = string.IsNullOrWhiteSpace(nicheKey) || nicheNorm == "general"
            ? "TIN MỚI HÔM NAY"
            : nicheNorm.Replace('_', ' ').ToUpperInvariant();

        // Snapshot jitter values before entering STA thread so rng is never accessed concurrently.
        double angle = 30 + r.NextDouble() * 35;
        double e1x = 120 + r.NextDouble() * 240;
        double e1y = 120 + r.NextDouble() * 220;
        double e2x = 760 + r.NextDouble() * 220;
        double e2y = 740 + r.NextDouble() * 220;

        return RunOnStaThread(() =>
        {
            const int size = 1080;
            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                var bgBrush = new LinearGradientBrush(bg1, bg2, angle);
                dc.DrawRectangle(bgBrush, null, new Rect(0, 0, size, size));

                var glow1 = new SolidColorBrush(Color.FromArgb(34, 255, 255, 255));
                var glow2 = new SolidColorBrush(Color.FromArgb(40, accent.R, accent.G, accent.B));
                dc.DrawEllipse(glow1, null, new Point(e1x, e1y), 260, 260);
                dc.DrawEllipse(glow2, null, new Point(e2x, e2y), 310, 310);

                var cardBg = new SolidColorBrush(Color.FromArgb(236, 15, 23, 42));
                var cardBorder = new Pen(new SolidColorBrush(Color.FromArgb(110, accent.R, accent.G, accent.B)), 3);
                dc.DrawRoundedRectangle(cardBg, cardBorder, new Rect(92, 110, size - 184, size - 220), 40, 40);

                var barBrush = new SolidColorBrush(accent);
                dc.DrawRoundedRectangle(barBrush, null, new Rect(156, 182, 120, 8), 4, 4);

                var badgeFt = new FormattedText(
                    badgeText,
                    CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal),
                    24,
                    barBrush,
                    1.0)
                {
                    MaxTextWidth = 760,
                    MaxLineCount = 1,
                };
                dc.DrawText(badgeFt, new Point(156, 210));

                var mainFt = new FormattedText(
                    cleanBody,
                    CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal),
                    42,
                    Brushes.White,
                    1.0)
                {
                    MaxTextWidth = 768,
                    MaxTextHeight = 520,
                    LineHeight = 58,
                    Trimming = TextTrimming.WordEllipsis,
                };
                dc.DrawText(mainFt, new Point(156, 290));

                var footerFt = new FormattedText(
                    footerText,
                    CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Medium, FontStretches.Normal),
                    26,
                    new SolidColorBrush(Color.FromRgb(203, 213, 225)),
                    1.0)
                {
                    MaxTextWidth = 768,
                    MaxLineCount = 1,
                    Trimming = TextTrimming.CharacterEllipsis,
                };
                dc.DrawText(footerFt, new Point(156, 868));
            }

            var rtb = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(dv);
            return EncodeUniqueJpegWithCornerJitter(rtb, outPath, r);
        });
    }

    /// <summary>
    /// Resolves a random post photo from PageAssets (applying Hash Jitter if enabled),
    /// or automatically generates a unique 1080x1080 visual post card when PageAssets is empty.
    /// </summary>
    public static (string ImagePath, bool IsTemporaryVariant) ResolveOrGeneratePostImage(
        string? configuredBaseDir,
        string? nicheKey,
        string? pageName,
        string? captionText,
        bool enableHashJitter,
        string? outputDir = null,
        Random? rng = null)
    {
        var picked = PickRandomImageFromDir(configuredBaseDir, nicheKey, "posts", rng);
        if (!string.IsNullOrWhiteSpace(picked))
        {
            if (enableHashJitter)
            {
                try
                {
                    var variant = CreateUniqueImageVariant(picked, outputDir, rng);
                    return (variant, !string.Equals(variant, picked, StringComparison.OrdinalIgnoreCase));
                }
                catch
                {
                    return (picked, false);
                }
            }
            return (picked, false);
        }

        var generated = GenerateFallbackPostCardImage(pageName, captionText, nicheKey, outputDir, rng);
        return (generated, true);
    }

    public static string ComputeFileSha256Hex(string filePath)
    {
        using var sha = SHA256.Create();
        using var fs = File.OpenRead(filePath);
        var hash = sha.ComputeHash(fs);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static List<string> ParseShareUrls(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new List<string>();
        return raw.Split(new[] { '\r', '\n', ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                     || x.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Picks the next curated share URL that has NOT been shared on this pageId yet.
    /// Records it into sharedHistory; if all URLs were used, resets the cycle for this pageId.
    /// </summary>
    public static string? PickNextShareUrl(
        string pageId,
        IEnumerable<string> sourceUrls,
        Dictionary<string, List<string>> sharedHistory)
    {
        var urls = sourceUrls
            .Select(u => (u ?? "").Trim())
            .Where(u => u.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                     || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (urls.Count == 0) return null;

        var key = string.IsNullOrWhiteSpace(pageId) ? "_default" : pageId.Trim();
        if (!sharedHistory.TryGetValue(key, out var used) || used == null)
        {
            used = new List<string>();
            sharedHistory[key] = used;
        }

        var next = urls.FirstOrDefault(u => !used.Any(x => string.Equals(x, u, StringComparison.OrdinalIgnoreCase)));
        if (next == null)
        {
            used.Clear();
            next = urls[0];
        }

        used.Add(next);
        if (used.Count > 100)
        {
            used.RemoveRange(0, used.Count - 100);
        }
        return next;
    }

    public static (int DayIndex, string StageLabel, bool IsAdsReadyLifecycle) ComputeLifecycleProgress(
        int warmupPostsCount,
        int shareCount,
        bool adsReadyFlag)
    {
        int totalTouches = Math.Max(0, warmupPostsCount) + Math.Max(0, shareCount);
        int estimatedDay = Math.Clamp(1 + totalTouches * 2, 1, 14);
        if (adsReadyFlag || totalTouches >= 6)
        {
            return (14, $"Ngày {estimatedDay}/14 • {warmupPostsCount} bài • {shareCount} share (Sẵn sàng Ads)", true);
        }
        if (totalTouches >= 3)
        {
            return (estimatedDay, $"Ngày {estimatedDay}/14 • {warmupPostsCount} bài • {shareCount} share (Đang nuôi)", false);
        }
        return (estimatedDay, $"Ngày {estimatedDay}/14 • {warmupPostsCount} bài • {shareCount} share (Mới tạo)", false);
    }
}
