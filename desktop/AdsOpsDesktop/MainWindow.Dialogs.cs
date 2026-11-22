using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace AdsOpsDesktop;

internal sealed partial class MainWindow
{
    private void OpenViaEditorDialog(ViaWorkspaceEntry? existing)
    {
        var isEdit = existing != null && !string.IsNullOrWhiteSpace(existing.ViaId);
        var dlg = new Window
        {
            Title = isEdit ? $"Chỉnh sửa Via: {existing!.Label}" : "Thêm Via mới vào Cloud & Két Local",
            Width = 600,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };

        void AddField(string label, UIElement control, string? hint = null)
        {
            root.Children.Add(new TextBlock
            {
                Text = label,
                FontFamily = ThemeTokens.UiFont,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = ThemeTokens.TextSecondary,
                Margin = new Thickness(0, 8, 0, 4),
            });
            root.Children.Add(control);
            if (!string.IsNullOrWhiteSpace(hint))
            {
                root.Children.Add(new TextBlock
                {
                    Text = hint,
                    FontFamily = ThemeTokens.UiFont,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextMuted,
                    Margin = new Thickness(0, 3, 0, 0),
                });
            }
        }

        var twoCol1 = new Grid();
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbLabel = UiComponents.CreateTextBox(existing?.Label ?? "", "VD: Via Hold BM 01");
        var tbDisplay = UiComponents.CreateTextBox(existing?.DisplayName ?? "", "Tên Facebook hiển thị");
        var lb1 = BuildLabeledBox("Tên định danh Via *", tbLabel);
        var lb2 = BuildLabeledBox("Tên hiển thị Facebook", tbDisplay);
        Grid.SetColumn(lb1, 0);
        Grid.SetColumn(lb2, 2);
        twoCol1.Children.Add(lb1);
        twoCol1.Children.Add(lb2);
        root.Children.Add(twoCol1);

        var twoCol2 = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbUid = UiComponents.CreateTextBox(existing?.ExternalReferenceId ?? "", "VD: 100088...");
        var cbTier = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Via Lên Camp (1 Page/ngày, Max 10)", Tag = "camp" },
            new ComboBoxItem { Content = "Via Hold / Cầm BM Tổng (2 Page/ngày, Max 25)", Tag = "vault" },
            new ComboBoxItem { Content = "Via Dự phòng / Đang ngâm (Standby)", Tag = "standby" },
        });
        cbTier.SelectedIndex = existing?.RoleTier switch { "vault" or "hold" => 1, "standby" => 2, _ => 0 };
        var uidBox = BuildLabeledBox("Facebook UID", tbUid);
        var tierBox = BuildLabeledBox("Phân hạng Via", cbTier);
        Grid.SetColumn(uidBox, 0);
        Grid.SetColumn(tierBox, 2);
        twoCol2.Children.Add(uidBox);
        twoCol2.Children.Add(tierBox);
        root.Children.Add(twoCol2);

        // v4.0.0 Platform & Google Ads MCC / Standalone 1:1 CID
        var twoColPlat = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoColPlat.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoColPlat.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoColPlat.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var cbPlatform = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "📘 Meta Ads — Via Facebook (Mặc định)", Tag = "meta" },
            new ComboBoxItem { Content = "🔷 Google Ads — Tài khoản MCC Quản lý", Tag = "google_ads_mcc" },
            new ComboBoxItem { Content = "🟢 Google Ads — Gmail Khách Độc Lập (1:1 Silo)", Tag = "google_ads_standalone" },
        });
        cbPlatform.SelectedIndex = ViaMetadataParser.NormalizePlatform(existing?.AccountPlatform) switch
        {
            "google_ads_mcc" => 1,
            "google_ads_standalone" => 2,
            _ => 0,
        };
        var tbGadsCid = UiComponents.CreateTextBox(existing?.GoogleAdsCustomerId ?? "", "VD: 123-456-7890 (bỏ trống nếu là Meta)");
        tbGadsCid.FontFamily = ThemeTokens.MonoFont;
        var platBox = BuildLabeledBox("Nền tảng Tài khoản (Meta / Google Ads)", cbPlatform);
        var cidBox = BuildLabeledBox("Mã Google Ads / MCC ID (xxx-xxx-xxxx)", tbGadsCid);
        Grid.SetColumn(platBox, 0);
        Grid.SetColumn(cidBox, 2);
        twoColPlat.Children.Add(platBox);
        twoColPlat.Children.Add(cidBox);
        root.Children.Add(twoColPlat);

        // Chrome Profile & Proxy
        var twoCol3 = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoCol3.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol3.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol3.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var profileOptions = _chromeProfiles.Select(p => p.Folder).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (!profileOptions.Contains("Default", StringComparer.OrdinalIgnoreCase)) profileOptions.Insert(0, "Default");
        var currentProf = existing?.BrowserProfileLabel ?? "Default";
        if (!string.IsNullOrWhiteSpace(currentProf) && !profileOptions.Contains(currentProf, StringComparer.OrdinalIgnoreCase))
        {
            profileOptions.Insert(0, currentProf);
        }
        var cbProfile = UiComponents.CreateComboBox(profileOptions.Select(p =>
        {
            var info = _chromeProfiles.FirstOrDefault(x => string.Equals(x.Folder, p, StringComparison.OrdinalIgnoreCase));
            var dispName = info?.Name ?? "";
            var lbl = info != null && !string.IsNullOrWhiteSpace(dispName) && !string.Equals(dispName, info.Folder, StringComparison.OrdinalIgnoreCase)
                ? $"{info.Folder} ({dispName})"
                : p;
            return new ComboBoxItem { Content = lbl, Tag = p };
        }));
        var profIdx = profileOptions.FindIndex(p => string.Equals(p, currentProf, StringComparison.OrdinalIgnoreCase));
        if (profIdx >= 0) cbProfile.SelectedIndex = profIdx;

        var tbProxy = UiComponents.CreateTextBox(existing?.NetworkLabel ?? "", "ip:port:user:pass hoặc http://...");
        var profBox = BuildLabeledBox("Hồ sơ Chrome Profile", cbProfile);
        var proxyBox = BuildLabeledBox("Proxy tĩnh (riêng của Via)", tbProxy);
        Grid.SetColumn(profBox, 0);
        Grid.SetColumn(proxyBox, 2);
        twoCol3.Children.Add(profBox);
        twoCol3.Children.Add(proxyBox);
        root.Children.Add(twoCol3);

        var proxyDupHint = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.WarningText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6, 0, 0),
            Visibility = Visibility.Collapsed,
        };

        // Multi-Client Silo & Default Warmup Route (v2.4.2)
        var twoColSilo = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoColSilo.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoColSilo.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoColSilo.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbClientGroup = UiComponents.CreateTextBox(existing?.ClientGroup ?? "", "VD: NhaKhoa_A, Spa_B (để trống nếu dùng chung)");
        var cbWarmupRoute = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Nuôi Tương Tác Thật (Feed + Watch + Notif)", Tag = "human_organic" },
            new ComboBoxItem { Content = "Ngâm 72h Thụ Động (Chỉ Feed + Notif)", Tag = "soak_72h" },
            new ComboBoxItem { Content = "Nuôi Cầm BM (Anti-Deep-Link)", Tag = "bm_warmup" },
            new ComboBoxItem { Content = "Trước Lên Camp (Feed + Pages)", Tag = "pre_camp" },
        });
        cbWarmupRoute.SelectedIndex = ViaMetadataParser.NormalizeWarmupMode(existing?.DefaultWarmupMode) switch
        {
            "soak_72h" => 1,
            "bm_warmup" => 2,
            "pre_camp" => 3,
            _ => 0,
        };
        var clientBox = BuildLabeledBox("Nhóm Khách Hàng (Client Silo)", tbClientGroup);
        var routeBox = BuildLabeledBox("Kịch bản Nuôi mặc định", cbWarmupRoute);
        Grid.SetColumn(clientBox, 0);
        Grid.SetColumn(routeBox, 2);
        twoColSilo.Children.Add(clientBox);
        twoColSilo.Children.Add(routeBox);

        // 5-Engine Antidetect Binding (AdsPower / Dolphin{anty} / Hidemyacc / Genlogin / GoLogin)
        var twoColAnti = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoColAnti.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoColAnti.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoColAnti.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var cbAdEngine = UiComponents.CreateComboBox(
            AntidetectBrowserConnector.SupportedEngines.Select(e => new ComboBoxItem { Content = e.Label, Tag = e.Key }));
        var curAdEng = string.IsNullOrWhiteSpace(existing?.AntidetectEngine)
            ? AntidetectBrowserConnector.NormalizeEngine(_config.DefaultBrowserEngine)
            : AntidetectBrowserConnector.NormalizeEngine(existing!.AntidetectEngine);
        var adEngIdx = Array.FindIndex(AntidetectBrowserConnector.SupportedEngines, e => e.Key == curAdEng);
        cbAdEngine.SelectedIndex = adEngIdx >= 0 ? adEngIdx : 0;

        var tbAdProfileId = UiComponents.CreateTextBox(existing?.AntidetectProfileId ?? "", "Để trống nếu dùng Chrome Gốc (VD: j12ab3c)");
        var pickAdWrap = new Grid();
        pickAdWrap.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        pickAdWrap.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(6) });
        pickAdWrap.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        pickAdWrap.Children.Add(tbAdProfileId);
        var btnPickAd = UiComponents.CreateButton("Quét ID", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
        {
            var engKey = (cbAdEngine.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "chrome_native";
            var list = await AntidetectBrowserConnector.ListProfilesAsync(engKey, _config.AntidetectApiBaseUrl, _config.AntidetectApiKey);
            if (list.Count == 0)
            {
                MessageBox.Show(dlg, $"Chưa đọc được Profile nào từ {AntidetectBrowserConnector.GetDisplayName(engKey)}. Hãy đảm bảo phần mềm Antidetect đang mở!", "Thông báo", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var exact = list.FirstOrDefault(p => p.Name.Equals(tbLabel.Text.Trim(), StringComparison.OrdinalIgnoreCase)) ?? list[0];
            tbAdProfileId.Text = exact.ProfileId;
            AppendLog($"Đã quét {list.Count} Profile từ {AntidetectBrowserConnector.GetDisplayName(engKey)}, chọn ID '{exact.ProfileId}' ({exact.Name}).");
        });
        Grid.SetColumn(btnPickAd, 2);
        pickAdWrap.Children.Add(btnPickAd);

        var adEngBox = BuildLabeledBox("Trình duyệt Antidetect (tùy chọn)", cbAdEngine);
        var adIdBox = BuildLabeledBox("Antidetect Profile ID", pickAdWrap);
        Grid.SetColumn(adEngBox, 0);
        Grid.SetColumn(adIdBox, 2);
        twoColAnti.Children.Add(adEngBox);
        twoColAnti.Children.Add(adIdBox);

        void RefreshProxyDupWarning()
        {
            var hostPort = AutomationQueueEngine.ExtractProxyHostPort(tbProxy.Text);
            var clientVal = tbClientGroup.Text.Trim();
            var platVal = (cbPlatform.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "meta";
            var isGads = ViaMetadataParser.NormalizePlatform(platVal) != "meta";
            var profVal = (cbProfile.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "Default";
            var maxSafe = Math.Max(1, _config.MaxViasPerProxyInBatch);
            var hints = new List<string>();
            bool isDanger = false;
            bool isWarn = false;

            if (isGads && string.IsNullOrWhiteSpace(hostPort))
            {
                var otherDirectGads = _vias.Where(v =>
                    !string.Equals(v.ViaId, existing?.ViaId, StringComparison.OrdinalIgnoreCase) &&
                    v.IsGoogleAdsAccount &&
                    string.IsNullOrWhiteSpace(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel))).ToList();
                if (otherDirectGads.Count > 0)
                {
                    isDanger = true;
                    hints.Add($"🚨 RỦI RO LIÊN ĐỚI GOOGLE ADS: Đang có {otherDirectGads.Count} tài khoản Google Ads dùng chung Direct IP ({string.Join(", ", otherDirectGads.Select(x => x.Label))}) — Bắt buộc gắn Proxy Tĩnh 1:1 riêng!");
                }
            }

            // Unconditional duplicate Chrome Profile check (across ALL Vias regardless of ClientGroup)
            if (!string.IsNullOrWhiteSpace(profVal))
            {
                var profDups = _vias.Where(v =>
                    !string.Equals(v.ViaId, existing?.ViaId, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(v.ProfileDir, profVal, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (profDups.Count > 0)
                {
                    isDanger = true;
                    hints.Add($"🚨 Trùng Hồ sơ Chrome «{profVal}» với Via {string.Join(", ", profDups.Select(v => v.Label))} — Bắt buộc tách Profile riêng để không đè Cookie!");
                }
            }

            if (!string.IsNullOrWhiteSpace(hostPort))
            {
                var collisions = _vias.Where(v =>
                    !string.Equals(v.ViaId, existing?.ViaId, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel), hostPort, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (collisions.Count > 0)
                {
                    var gadsCollisions = isGads ? collisions.Where(v => v.IsGoogleAdsAccount).ToList() : new List<ViaWorkspaceEntry>();
                    var crossClient = collisions.Where(v =>
                        !string.Equals(v.ClientGroup ?? "", clientVal, StringComparison.OrdinalIgnoreCase) &&
                        (!string.IsNullOrEmpty(clientVal) || !string.IsNullOrEmpty(v.ClientGroup))).ToList();
                    if (gadsCollisions.Count > 0)
                    {
                        isDanger = true;
                        hints.Add($"🚨 CHẶN CHẾT CHÙM GOOGLE ADS: Proxy {hostPort} đang gắn cho Google Ads khác ({string.Join(", ", gadsCollisions.Select(x => x.Label))}) — Phải dùng Proxy 1:1 riêng tuyệt đối!");
                    }
                    else if (crossClient.Count > 0)
                    {
                        isDanger = true;
                        hints.Add($"🚨 XUNG ĐỘT SILO KHÁCH HÀNG: Proxy {hostPort} đang gắn cho khách khác ({string.Join(", ", crossClient.Select(x => $"{x.Label} [{x.ClientGroup}]"))})!");
                    }
                    else if (collisions.Count + 1 <= maxSafe)
                    {
                        hints.Add($"✓ Cụm Proxy Dân cư an toàn ({collisions.Count + 1}/{maxSafe} Via cùng nhóm trên {hostPort}): {string.Join(", ", collisions.Select(v => v.Label))}.");
                    }
                    else
                    {
                        isWarn = true;
                        hints.Add($"⚠ Vượt ngưỡng Cụm Proxy Dân cư ({collisions.Count + 1}/{maxSafe} Via trên {hostPort}): {string.Join(", ", collisions.Select(v => v.Label))}.");
                    }
                }
            }

            if (hints.Count > 0)
            {
                proxyDupHint.Text = string.Join(" ", hints);
                proxyDupHint.Foreground = isDanger
                    ? ThemeTokens.DangerText
                    : (isWarn ? ThemeTokens.WarningText : ThemeTokens.SuccessText);
                proxyDupHint.Visibility = Visibility.Visible;
            }
            else
            {
                proxyDupHint.Visibility = Visibility.Collapsed;
            }
        }
        tbProxy.TextChanged += (_, _) => RefreshProxyDupWarning();
        tbClientGroup.TextChanged += (_, _) => RefreshProxyDupWarning();
        cbProfile.SelectionChanged += (_, _) => RefreshProxyDupWarning();
        cbPlatform.SelectionChanged += (_, _) => RefreshProxyDupWarning();
        RefreshProxyDupWarning();
        root.Children.Add(proxyDupHint);
        root.Children.Add(twoColSilo);
        root.Children.Add(twoColAnti);

        if (existing?.IsInCooldown == true)
        {
            var cdGrid = new Grid();
            cdGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cdGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var cdText = new TextBlock
            {
                Text = $"❄️ Via đang Cooldown đến {existing.CooldownUntilUtc!.Value.ToLocalTime():dd/MM HH:mm}: {existing.CooldownReason}",
                FontFamily = ThemeTokens.UiFont,
                FontSize = 12,
                Foreground = ThemeTokens.DangerText,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var clearCdBtn = UiComponents.CreateButton("Gỡ đóng băng ngay", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
            {
                ViaStewardshipStore.Default.ClearCooldown(existing.ViaId, existing.Label);
                existing.CooldownUntilUtc = null;
                existing.CooldownReason = "";
                AppendLog($"Đã gỡ đóng băng Cooldown cho Via '{existing.Label}'.");
                MessageBox.Show(this, $"Đã gỡ Cooldown cho '{existing.Label}'.", "Hoàn tất", MessageBoxButton.OK, MessageBoxImage.Information);
            });
            Grid.SetColumn(clearCdBtn, 1);
            cdGrid.Children.Add(cdText);
            cdGrid.Children.Add(clearCdBtn);
            var cdCard = UiComponents.CreateCard(cdGrid, new Thickness(10, 8, 10, 8), ThemeTokens.DangerBg, ThemeTokens.DangerBorder);
            cdCard.Margin = new Thickness(0, 8, 0, 0);
            root.Children.Add(cdCard);
        }

        // Warmup baseline + Status
        var twoCol4 = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        twoCol4.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol4.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol4.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var warmupMode = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = string.IsNullOrWhiteSpace(existing?.WarmupStartIso) ? "Giữ nguyên (Đã Trust)" : $"Giữ nguyên mốc hiện tại ({existing!.WarmupLabel})", Tag = "keep" },
            new ComboBoxItem { Content = "Đặt mốc ngâm mới hôm nay (Khóa 72h vàng)", Tag = "now" },
            new ComboBoxItem { Content = "Đánh dấu Đã Trust >7 ngày", Tag = "clear" },
        });

        var cbStatus = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Đang hoạt động (active)", Tag = "active" },
            new ComboBoxItem { Content = "Tạm nghỉ (paused)", Tag = "paused" },
            new ComboBoxItem { Content = "Cảnh báo / Check (restricted)", Tag = "restricted" },
        });
        cbStatus.SelectedIndex = (existing?.Status?.Trim().ToLowerInvariant()) switch
        {
            "paused" => 1,
            "restricted" => 2,
            _ => 0,
        };
        var wmBox = BuildLabeledBox("Chế độ Ngâm Thiết Bị", warmupMode);
        var stBox = BuildLabeledBox("Trạng thái Cloud", cbStatus);
        Grid.SetColumn(wmBox, 0);
        Grid.SetColumn(stBox, 2);
        twoCol4.Children.Add(wmBox);
        twoCol4.Children.Add(stBox);
        root.Children.Add(twoCol4);

        var tbNotes = UiComponents.CreateTextBox(existing?.CleanNotes ?? "", "Ghi chú thêm (KHÔNG dán Cookie/2FA vào ô ghi chú Cloud)", multiline: true, height: 60);
        AddField("Ghi chú vận hành (Cloud)", tbNotes);

        // Local DPAPI Secret Box
        var preloadedSecret = existing != null
            ? LocalSecretVaultStore.Default.Find(existing.ViaId, existing.ProfileDir, existing.Label)
            : new LocalVaultLookupResult(false, "", "", "", "", "", "");

        var initial2Fa = !string.IsNullOrWhiteSpace(preloadedSecret.TwoFaSecret) ? preloadedSecret.TwoFaSecret : (existing?.TwoFaSecret ?? "");
        var initialCookie = preloadedSecret.CookieRaw;

        var tb2Fa = UiComponents.CreateTextBox(initial2Fa, "Mã Base32 2FA (VD: JBSWY3DPEHPK3PXP)");
        tb2Fa.FontFamily = ThemeTokens.MonoFont;
        var liveTotpPreview = new TextBlock
        {
            Text = "Mã OTP hiện tại: —",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 4, 0, 0),
        };
        void Refresh2FaPreview()
        {
            var r = TotpService.ComputeTotp(tb2Fa.Text);
            liveTotpPreview.Text = r.Valid ? $"Mã OTP test: {r.FormattedCode} (còn {r.SecondsRemaining}s)" : "Mã OTP test: Chưa có / sai Base32";
            liveTotpPreview.Foreground = r.Valid ? ThemeTokens.SuccessText : ThemeTokens.TextMuted;
        }
        tb2Fa.TextChanged += (_, _) => Refresh2FaPreview();
        Refresh2FaPreview();

        var tbCookie = UiComponents.CreateTextBox(initialCookie, "c_user=...; xs=...; fr=... (Chỉ lưu tại máy Windows bằng DPAPI)", multiline: true, height: 64);
        tbCookie.FontFamily = ThemeTokens.MonoFont;

        var secretCardStack = new StackPanel();
        secretCardStack.Children.Add(new TextBlock
        {
            Text = "Két bảo mật 100% Local (Windows DPAPI — Tuyệt đối KHÔNG gửi lên Cloud Server)",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.SuccessText,
            Margin = new Thickness(0, 0, 0, 6),
        });
        secretCardStack.Children.Add(BuildLabeledBox("Secret 2FA (Base32)", tb2Fa));
        secretCardStack.Children.Add(liveTotpPreview);
        var ckBoxWrap = BuildLabeledBox("Cookie Facebook thô (c_user / xs)", tbCookie);
        ckBoxWrap.Margin = new Thickness(0, 8, 0, 0);
        secretCardStack.Children.Add(ckBoxWrap);

        var secretCard = UiComponents.CreateCard(secretCardStack, new Thickness(12), ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder);
        secretCard.Margin = new Thickness(0, 12, 0, 14);
        root.Children.Add(secretCard);

        var statusHint = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.DangerText,
            Margin = new Thickness(0, 0, 0, 8),
            Visibility = Visibility.Collapsed,
        };
        root.Children.Add(statusHint);

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancelBtn = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 10, 0);

        Button saveBtn = null!;
        saveBtn = UiComponents.CreateButton(isEdit ? "Lưu cập nhật Via" : "Tạo Via mới", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            var labelVal = tbLabel.Text.Trim();
            if (string.IsNullOrWhiteSpace(labelVal))
            {
                statusHint.Text = "Vui lòng nhập Tên định danh Via.";
                statusHint.Visibility = Visibility.Visible;
                return;
            }

            saveBtn.IsEnabled = false;
            statusHint.Visibility = Visibility.Collapsed;
            try
            {
                var tierTag = (cbTier.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "camp";
                var profTag = (cbProfile.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "Default";
                var statusTag = (cbStatus.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "active";
                var wmTag = (warmupMode.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "keep";
                var wModeTag = (cbWarmupRoute.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "human_organic";
                var adEngTag = (cbAdEngine.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "chrome_native";
                var nextWarmupIso = wmTag switch
                {
                    "now" => DateTimeOffset.UtcNow.ToString("O"),
                    "clear" => "",
                    _ => existing?.WarmupStartIso ?? "",
                };

                var builtNotes = ViaMetadataParser.BuildNotes(
                    tbNotes.Text.Trim(),
                    tierTag,
                    nextWarmupIso,
                    tbClientGroup.Text.Trim(),
                    wModeTag,
                    adEngTag,
                    tbAdProfileId.Text.Trim(),
                    (cbPlatform.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "meta",
                    tbGadsCid.Text.Trim());
                var payload = new PersonalAccountUpsertRequestDto
                {
                    Label = labelVal,
                    DisplayName = string.IsNullOrWhiteSpace(tbDisplay.Text) ? labelVal : tbDisplay.Text.Trim(),
                    ExternalReferenceId = string.IsNullOrWhiteSpace(tbUid.Text) ? null : tbUid.Text.Trim(),
                    Status = statusTag,
                    BrowserProfileLabel = profTag,
                    NetworkLabel = tbProxy.Text.Trim(),
                    VaultReference = !string.IsNullOrWhiteSpace(tb2Fa.Text) || !string.IsNullOrWhiteSpace(tbCookie.Text)
                        ? "Két DPAPI Local (Desktop)"
                        : "",
                    Notes = builtNotes,
                };

                var saved = isEdit
                    ? await _api.UpdatePersonalAccountAsync(existing!.ViaId, payload)
                    : await _api.CreatePersonalAccountAsync(payload);

                LocalSecretVaultStore.Default.Upsert(
                    saved.Id,
                    saved.Label,
                    profTag,
                    tbCookie.Text.Trim(),
                    tb2Fa.Text.Trim(),
                    allowOverwriteEmpty: isEdit);

                AppendLog($"Đã {(isEdit ? "cập nhật" : "thêm mới")} Via '{saved.Label}' (Cloud + DPAPI Local).");
                dlg.DialogResult = true;
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                statusHint.Text = $"Lỗi lưu Cloud: {ex.Message}";
                statusHint.Visibility = Visibility.Visible;
                saveBtn.IsEnabled = true;
            }
        });

        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(saveBtn);
        root.Children.Add(btnRow);

        dlg.Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 760, Content = root };
        dlg.ShowDialog();
    }

    private void OpenLocalVaultDialog(ViaWorkspaceEntry via)
    {
        var dlg = new Window
        {
            Title = $"Két DPAPI Local 6 Lớp • {via.Label}",
            Width = 580,
            MaxHeight = 720,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var existing = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        var root = new StackPanel { Margin = new Thickness(20) };

        root.Children.Add(new TextBlock
        {
            Text = $"Hồ sơ Chrome: {via.ProfileDir} • Mã hóa Windows DPAPI cục bộ 6 lớp (chưa bao giờ đẩy lên Cloud).",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var tb2Fa = UiComponents.CreateTextBox(!string.IsNullOrWhiteSpace(existing.TwoFaSecret) ? existing.TwoFaSecret : via.TwoFaSecret, "Mã 2FA Base32 Facebook");
        tb2Fa.FontFamily = ThemeTokens.MonoFont;
        var otpCodeText = new TextBlock
        {
            Text = "—",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.AccentText,
        };
        var otpRemainText = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            Margin = new Thickness(0, 2, 0, 0),
        };
        void RefreshOtp()
        {
            var r = TotpService.ComputeTotp(tb2Fa.Text);
            if (r.Valid)
            {
                otpCodeText.Text = r.FormattedCode;
                otpRemainText.Text = $"Hết hạn sau {r.SecondsRemaining}s (RFC 6238 SHA1)";
            }
            else
            {
                otpCodeText.Text = "Chưa hợp lệ";
                otpRemainText.Text = "Nhập chuỗi Base32 >= 8 ký tự";
            }
        }
        tb2Fa.TextChanged += (_, _) => RefreshOtp();
        RefreshOtp();

        var otpPanel = new StackPanel();
        otpPanel.Children.Add(otpCodeText);
        otpPanel.Children.Add(otpRemainText);
        var copyOtpBtn = UiComponents.CreateButton("Copy 6 số FB", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(tb2Fa.Text);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        copyOtpBtn.Margin = new Thickness(0, 6, 0, 0);
        copyOtpBtn.HorizontalAlignment = HorizontalAlignment.Left;
        otpPanel.Children.Add(copyOtpBtn);

        root.Children.Add(BuildLabeledBox("Secret 2FA Facebook (Base32)", tb2Fa));
        var previewCard = UiComponents.CreateCard(otpPanel, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        previewCard.Margin = new Thickness(0, 6, 0, 10);
        root.Children.Add(previewCard);

        var tbCookie = UiComponents.CreateTextBox(existing.CookieRaw, "c_user=...; xs=...", multiline: true, height: 82);
        tbCookie.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(BuildLabeledBox("Cookie Facebook (Lưu cục bộ DPAPI)", tbCookie));

        // ===== SECTION: RECOVERY EMAIL + EMAIL 2FA + BACKUP CODES (6-LAYER AGENCY VAULT) =====
        var mailHeader = new TextBlock
        {
            Text = "📧 Két Email Khôi Phục (Gmail / Outlook) & Mã Dự Phòng 8 Số",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 14, 0, 6),
        };
        root.Children.Add(mailHeader);

        var tbRecEmail = UiComponents.CreateTextBox(existing.RecoveryEmail, "vd: agency.backup01@gmail.com");
        root.Children.Add(BuildLabeledBox("Địa chỉ Email Khôi phục (Gmail / Outlook / Hotmail)", tbRecEmail));

        var tbEmailPass = UiComponents.CreateTextBox(existing.EmailPassword, "Mật khẩu hộp thư khôi phục (mã hóa DPAPI)");
        tbEmailPass.FontFamily = ThemeTokens.MonoFont;
        var passBoxWrap = BuildLabeledBox("Mật khẩu Email Khôi phục", tbEmailPass);
        passBoxWrap.Margin = new Thickness(0, 8, 0, 0);
        root.Children.Add(passBoxWrap);

        var tbEmail2Fa = UiComponents.CreateTextBox(existing.EmailTwoFaSecret, "Secret 2FA của Gmail / Outlook (Base32)");
        tbEmail2Fa.FontFamily = ThemeTokens.MonoFont;
        var email2FaWrap = BuildLabeledBox("Secret 2FA Email (Base32)", tbEmail2Fa);
        email2FaWrap.Margin = new Thickness(0, 8, 0, 0);
        root.Children.Add(email2FaWrap);

        var mailOtpText = new TextBlock
        {
            Text = "Chưa có 2FA Mail",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.SuccessText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        void RefreshMailOtp()
        {
            var r = TotpService.ComputeTotp(tbEmail2Fa.Text);
            mailOtpText.Text = r.Valid ? $"OTP Mail: {r.FormattedCode} ({r.SecondsRemaining}s)" : "OTP Mail: Chưa cấu hình";
            mailOtpText.Foreground = r.Valid ? ThemeTokens.SuccessText : ThemeTokens.TextMuted;
        }
        tbEmail2Fa.TextChanged += (_, _) => RefreshMailOtp();
        RefreshMailOtp();

        var mailActionsRow = new WrapPanel { Margin = new Thickness(0, 6, 0, 8) };
        mailOtpText.Margin = new Thickness(0, 0, 10, 0);
        mailActionsRow.Children.Add(mailOtpText);
        var copyMailOtpBtn = UiComponents.CreateButton("Copy 6 số Mail", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(tbEmail2Fa.Text);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        copyMailOtpBtn.Margin = new Thickness(0, 0, 8, 0);
        mailActionsRow.Children.Add(copyMailOtpBtn);
        var openMailBtn = UiComponents.CreateButton("📧 Mở Hộp Thư Trên Cùng Profile/Proxy", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            var mailUrl = LocalSecretVaultStore.ResolveWebmailUrl(tbRecEmail.Text);
            LaunchViaChromeSafe(via, mailUrl);
            AppendLog($"📧 Đã mở hộp thư '{mailUrl}' trên cùng Profile & Proxy của Via '{via.Label}'.");
        });
        mailActionsRow.Children.Add(openMailBtn);
        root.Children.Add(mailActionsRow);

        var tbBackupCodes = UiComponents.CreateTextBox(existing.BackupCodesRaw, "Mỗi dòng 1 mã dự phòng 8 số Facebook/Google (VD: 4829 1034)...", multiline: true, height: 82);
        tbBackupCodes.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(BuildLabeledBox("10 Mã Dự Phòng 8 Số (Backup Codes)", tbBackupCodes));

        var backupRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 4) };
        var backupCountLabel = new TextBlock
        {
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 11,
            Foreground = ThemeTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(10, 0, 0, 0),
        };
        void RefreshBackupCount()
        {
            var cnt = LocalSecretVaultStore.CountUnusedBackupCodes(tbBackupCodes.Text);
            backupCountLabel.Text = cnt > 0 ? $"Còn {cnt} mã chưa dùng" : "Chưa có mã chưa dùng";
            backupCountLabel.Foreground = cnt > 0 ? ThemeTokens.SuccessText : ThemeTokens.WarningText;
        }
        tbBackupCodes.TextChanged += (_, _) => RefreshBackupCount();
        RefreshBackupCount();

        var consumeBackupBtn = UiComponents.CreateButton("📋 Rút & Copy 1 Mã 8 Số Chưa Dùng", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var (code, updatedRaw, remaining) = LocalSecretVaultStore.ConsumeNextUnusedBackupCode(tbBackupCodes.Text);
            if (string.IsNullOrWhiteSpace(code))
            {
                MessageBox.Show(dlg, "Không còn mã dự phòng 8 số nào chưa dùng trong danh sách.", "Hết mã dự phòng", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            Clipboard.SetText(code);
            tbBackupCodes.Text = updatedRaw;
            LocalSecretVaultStore.Default.UpsertFull(
                via.ViaId, via.Label, via.ProfileDir,
                tbCookie.Text.Trim(), tb2Fa.Text.Trim(),
                tbRecEmail.Text.Trim(), tbEmailPass.Text.Trim(), tbEmail2Fa.Text.Trim(), updatedRaw,
                allowOverwriteEmpty: true);
            AppendLog($"📋 Đã rút & copy mã dự phòng '{code}' cho Via '{via.Label}' (còn {remaining} mã chưa dùng).");
            RefreshBackupCount();
            RenderCurrentView();
        });
        backupRow.Children.Add(consumeBackupBtn);
        backupRow.Children.Add(backupCountLabel);
        root.Children.Add(backupRow);

        var btnRow = new Grid { Margin = new Thickness(0, 16, 0, 0) };
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var wipeBtn = UiComponents.CreateButton("Xóa trắng Két này", ButtonVariant.Danger, FluentIcons.Delete, onClick: (_, _) =>
        {
            var confirm = UiComponents.ShowConfirmActionDialog(
                dlg,
                "Xác nhận xóa toàn bộ Két 6 Lớp Local",
                $"Xóa Cookie, 2FA FB, Email khôi phục & Mã 8 số lưu trên máy cho Via '{via.Label}'.",
                new (string, string)[] { ("Via:", via.Label), ("Profile:", via.ProfileDir) },
                "Hành động này chỉ xóa trên DPAPI Vault của máy tính này, không đụng dữ liệu Cloud.",
                "Xóa trắng Local",
                isDanger: true);
            if (!confirm) return;
            LocalSecretVaultStore.Default.UpsertFull(via.ViaId, via.Label, via.ProfileDir, "", "", "", "", "", "", allowOverwriteEmpty: true);
            via.TwoFaSecret = "";
            via.HasVaultCookie = false;
            ApplyUpdatedProxyClusterLimits();
            try { via.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(via, config: _config); } catch { }
            AppendLog($"Đã xóa toàn bộ Két DPAPI 6 lớp cho Via '{via.Label}'.");
            dlg.DialogResult = true;
            RenderCurrentView();
        });
        btnRow.Children.Add(wipeBtn);

        var rightBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var cancelBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        var saveBtn = UiComponents.CreateButton("Lưu Két 6 Lớp", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            LocalSecretVaultStore.Default.UpsertFull(
                via.ViaId, via.Label, via.ProfileDir,
                tbCookie.Text.Trim(), tb2Fa.Text.Trim(),
                tbRecEmail.Text.Trim(), tbEmailPass.Text.Trim(), tbEmail2Fa.Text.Trim(), tbBackupCodes.Text.Trim(),
                allowOverwriteEmpty: true);
            via.TwoFaSecret = TotpService.NormalizeBase32Secret(tb2Fa.Text);
            via.HasVaultCookie = !string.IsNullOrWhiteSpace(tbCookie.Text);
            ApplyUpdatedProxyClusterLimits();
            try { via.ExtensionFolder = ExtensionProvisioner.ProvisionForVia(via, config: _config); } catch { }
            AppendLog($"✅ Đã lưu Két DPAPI 6 lớp (Cookie + 2FA FB + Mail khôi phục + Mã 8 số) cho Via '{via.Label}'.");
            dlg.DialogResult = true;
            RenderCurrentView();
        });
        rightBtns.Children.Add(cancelBtn);
        rightBtns.Children.Add(saveBtn);
        Grid.SetColumn(rightBtns, 2);
        btnRow.Children.Add(rightBtns);

        root.Children.Add(btnRow);
        var vaultOtpTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        vaultOtpTimer.Tick += (_, _) =>
        {
            RefreshOtp();
            RefreshMailOtp();
        };
        vaultOtpTimer.Start();
        dlg.Closed += (_, _) => vaultOtpTimer.Stop();
        dlg.Content = new ScrollViewer
        {
            MaxHeight = 680,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = root,
        };
        dlg.ShowDialog();
    }

    private void OpenCheckpointRescueDialog(ViaWorkspaceEntry via)
    {
        var dlg = new Window
        {
            Title = $"🚑 Ứng cứu Checkpoint 1-Chạm • {via.Label}",
            Width = 580,
            MaxHeight = 700,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var sec = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        var fbSecret = !string.IsNullOrWhiteSpace(sec.TwoFaSecret) ? sec.TwoFaSecret : via.TwoFaSecret;
        var root = new StackPanel { Margin = new Thickness(20) };

        root.Children.Add(new TextBlock
        {
            Text = $"Mở đồng thời Facebook + Hộp thư Khôi phục trên cùng Profile '{via.ProfileDir}' ({(string.IsNullOrWhiteSpace(via.NetworkLabel) ? "Direct IP" : via.NetworkLabel)}) để gỡ xác minh an toàn.",
            TextWrapping = TextWrapping.Wrap,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, 12),
        });

        // 1. Live Facebook 2FA & Quick Browser Launch
        var fbOtp = TotpService.ComputeTotp(fbSecret);
        var fbPanel = new StackPanel();
        fbPanel.Children.Add(new TextBlock
        {
            Text = fbOtp.Valid ? $"🔑 OTP 2FA Facebook: {fbOtp.FormattedCode} (còn {fbOtp.SecondsRemaining}s)" : "🔑 OTP 2FA Facebook: Chưa gắn trong Két",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = fbOtp.Valid ? ThemeTokens.AccentText : ThemeTokens.WarningText,
        });
        var fbBtnRow = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        var copyFbOtp = UiComponents.CreateButton("Copy OTP FB", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(fbSecret);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        copyFbOtp.Margin = new Thickness(0, 0, 8, 0);
        fbBtnRow.Children.Add(copyFbOtp);
        var openFbRescue = UiComponents.CreateButton("🌐 Mở Facebook Gỡ Khóa", ButtonVariant.Primary, compact: true, onClick: (_, _) =>
        {
            LaunchViaChromeSafe(via, "https://www.facebook.com/");
        });
        fbBtnRow.Children.Add(openFbRescue);
        fbPanel.Children.Add(fbBtnRow);
        var fbCard = UiComponents.CreateCard(fbPanel, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        fbCard.Margin = new Thickness(0, 0, 0, 10);
        root.Children.Add(fbCard);

        // 2. Recovery Mail & Email 2FA & Backup Code
        var mailOtp = TotpService.ComputeTotp(sec.EmailTwoFaSecret);
        var unusedCnt = LocalSecretVaultStore.CountUnusedBackupCodes(sec.BackupCodesRaw);
        var mailPanel = new StackPanel();
        mailPanel.Children.Add(new TextBlock
        {
            Text = !string.IsNullOrWhiteSpace(sec.RecoveryEmail)
                ? $"📧 Mail Khôi Phục: {sec.RecoveryEmail}"
                : "📧 Mail Khôi Phục: Chưa lưu trong Két (bấm 'Mở Két 6 Lớp' để bổ sung)",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = !string.IsNullOrWhiteSpace(sec.RecoveryEmail) ? ThemeTokens.TextPrimary : ThemeTokens.WarningText,
        });
        mailPanel.Children.Add(new TextBlock
        {
            Text = mailOtp.Valid ? $"OTP 2FA Mail: {mailOtp.FormattedCode} (còn {mailOtp.SecondsRemaining}s)" : "OTP 2FA Mail: Chưa gắn",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = mailOtp.Valid ? ThemeTokens.SuccessText : ThemeTokens.TextMuted,
            Margin = new Thickness(0, 4, 0, 0),
        });
        var backupStatusTxt = new TextBlock
        {
            Text = $"Mã dự phòng 8 số chưa dùng: {unusedCnt} mã",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            Foreground = unusedCnt > 0 ? ThemeTokens.SuccessText : ThemeTokens.TextMuted,
            Margin = new Thickness(0, 2, 0, 0),
        };
        mailPanel.Children.Add(backupStatusTxt);

        var mailBtnRow = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        var openMailBtn = UiComponents.CreateButton("📧 Mở Hộp Thư Cùng Proxy", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            LaunchViaChromeSafe(via, LocalSecretVaultStore.ResolveWebmailUrl(sec.RecoveryEmail));
        });
        openMailBtn.Margin = new Thickness(0, 0, 6, 4);
        mailBtnRow.Children.Add(openMailBtn);

        var copyMailPassBtn = UiComponents.CreateButton("Copy Pass Mail", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(sec.EmailPassword)) Clipboard.SetText(sec.EmailPassword);
        });
        copyMailPassBtn.Margin = new Thickness(0, 0, 6, 4);
        mailBtnRow.Children.Add(copyMailPassBtn);

        var copyMailOtpBtn = UiComponents.CreateButton("Copy OTP Mail", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(sec.EmailTwoFaSecret);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        copyMailOtpBtn.Margin = new Thickness(0, 0, 6, 4);
        mailBtnRow.Children.Add(copyMailOtpBtn);

        var popBackupBtn = UiComponents.CreateButton($"📋 Rút 1 Mã 8 Số ({unusedCnt})", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var cur = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
            var (code, updatedRaw, rem) = LocalSecretVaultStore.ConsumeNextUnusedBackupCode(cur.BackupCodesRaw);
            if (string.IsNullOrWhiteSpace(code))
            {
                MessageBox.Show(dlg, "Chưa có hoặc đã dùng hết mã dự phòng 8 số cho Via này.", "Hết mã dự phòng", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            Clipboard.SetText(code);
            LocalSecretVaultStore.Default.UpsertFull(
                via.ViaId, via.Label, via.ProfileDir,
                cur.CookieRaw, cur.TwoFaSecret,
                cur.RecoveryEmail, cur.EmailPassword, cur.EmailTwoFaSecret, updatedRaw,
                allowOverwriteEmpty: true);
            backupStatusTxt.Text = $"Đã copy '{code}' • Còn {rem} mã chưa dùng";
            AppendLog($"🚑 [Ứng cứu] Đã rút & copy mã 8 số '{code}' cho '{via.Label}' (còn {rem} mã).");
            RenderCurrentView();
        });
        popBackupBtn.Margin = new Thickness(0, 0, 6, 4);
        mailBtnRow.Children.Add(popBackupBtn);
        mailPanel.Children.Add(mailBtnRow);

        var mailCard = UiComponents.CreateCard(mailPanel, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        mailCard.Margin = new Thickness(0, 0, 0, 12);
        root.Children.Add(mailCard);

        // 3. Standby Ready Failover Candidates in same ClientGroup
        var targetGroup = (via.ClientGroup ?? "").Trim();
        var standbyCandidates = _vias
            .Where(other =>
                !string.Equals(other.ViaId, via.ViaId, StringComparison.OrdinalIgnoreCase) &&
                !other.IsInCooldown &&
                (string.IsNullOrEmpty(targetGroup) || string.Equals((other.ClientGroup ?? "").Trim(), targetGroup, StringComparison.OrdinalIgnoreCase)))
            .Select(other =>
            {
                var os = LocalSecretVaultStore.Default.Find(other.ViaId, other.ProfileDir, other.Label);
                var days = ViaMetadataParser.ComputeWarmupStatus(other.WarmupStartIso, soakHours: _config.SoakQuarantineHours).DaysElapsed;
                if (string.IsNullOrWhiteSpace(other.WarmupStartIso) && !other.IsInSoakQuarantine) days = Math.Max(days, 7);
                var pb = (_config.ViaPreBakeSessionCounts != null && _config.ViaPreBakeSessionCounts.TryGetValue(other.ViaId, out var c)) ? c : 0;
                var inc = AgencyIncubationAdvisor.ComputeIncubationStatus(
                    !string.IsNullOrWhiteSpace(other.NetworkLabel),
                    !string.IsNullOrWhiteSpace(os.CookieRaw) || other.HasVaultCookie,
                    !string.IsNullOrWhiteSpace(os.TwoFaSecret) || !string.IsNullOrWhiteSpace(other.TwoFaSecret),
                    !string.IsNullOrWhiteSpace(os.RecoveryEmail),
                    !string.IsNullOrWhiteSpace(os.EmailTwoFaSecret) || LocalSecretVaultStore.CountUnusedBackupCodes(os.BackupCodesRaw) > 0,
                    pb,
                    other.WarmupPhase,
                    days);
                return (Via: other, Inc: inc);
            })
            .OrderByDescending(x => x.Via.RoleTier == "standby" ? 1 : 0)
            .ThenByDescending(x => x.Inc.RecoveryReadinessScore)
            .Take(4)
            .ToList();

        var poolTitle = new TextBlock
        {
            Text = string.IsNullOrEmpty(targetGroup)
                ? "🛡️ Via Dự Phòng Sẵn Sàng Tiếp Quản (Agency Pool):"
                : $"🛡️ Via Dự Phòng Cùng Nhóm '{targetGroup}' Để Tiếp Quản:",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 6),
        };
        root.Children.Add(poolTitle);

        if (standbyCandidates.Count == 0)
        {
            root.Children.Add(new TextBlock
            {
                Text = "Chưa có Via dự phòng cùng nhóm — hãy thêm phôi mới và ủ Cookie Robot trước.",
                FontSize = 11,
                Foreground = ThemeTokens.WarningText,
                Margin = new Thickness(0, 0, 0, 10),
            });
        }
        else
        {
            foreach (var cand in standbyCandidates)
            {
                var rowGrid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var info = new TextBlock
                {
                    Text = $"{cand.Via.Label} • {cand.Inc.StageLabel} • Kháng {cand.Inc.RecoveryReadinessScore}/100",
                    FontSize = 12,
                    Foreground = ThemeTokens.TextSecondary,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                var launchCandBtn = UiComponents.CreateButton("Mở Via Dự Phòng", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
                {
                    LaunchViaChromeSafe(cand.Via, "https://business.facebook.com/");
                });
                Grid.SetColumn(launchCandBtn, 1);
                rowGrid.Children.Add(info);
                rowGrid.Children.Add(launchCandBtn);
                root.Children.Add(rowGrid);
            }
        }

        var footerRow = new WrapPanel { Margin = new Thickness(0, 14, 0, 0), HorizontalAlignment = HorizontalAlignment.Right };
        var editVaultBtn = UiComponents.CreateButton("🔑 Mở Két 6 Lớp", ButtonVariant.Secondary, onClick: (_, _) =>
        {
            dlg.Close();
            OpenLocalVaultDialog(via);
        });
        editVaultBtn.Margin = new Thickness(0, 0, 8, 0);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Primary, onClick: (_, _) => dlg.Close());
        footerRow.Children.Add(editVaultBtn);
        footerRow.Children.Add(closeBtn);
        root.Children.Add(footerRow);

        dlg.Content = new ScrollViewer
        {
            MaxHeight = 660,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = root,
        };
        dlg.ShowDialog();
    }

    private void OpenClaimBmDialog(FanpageItemDto page)
    {
        var dlg = new Window
        {
            Title = $"Kéo Fanpage vào BM • {page.Name}",
            Width = 480,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = $"Chọn Business Manager đích để Claim Fanpage '{page.Name}' ({page.ExternalPageId ?? "chưa có ID"}).",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var bmItems = new List<ComboBoxItem> { new() { Content = "(Tự động chọn BM Hold chính)", Tag = "" } };
        bmItems.AddRange(_bms.Select(b => new ComboBoxItem { Content = $"{b.Name} ({b.ExternalId ?? b.Id})", Tag = b.Id }));
        var cbBm = UiComponents.CreateComboBox(bmItems);
        root.Children.Add(BuildLabeledBox("Business Manager Đích", cbBm));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        Button ok = null!;
        ok = UiComponents.CreateButton("Kéo vào BM ngay", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            ok.IsEnabled = false;
            errTb.Text = "";
            try
            {
                var bmId = (cbBm.SelectedItem as ComboBoxItem)?.Tag?.ToString();
                var res = await _api.ClaimPageToBmAsync(page.Id, string.IsNullOrWhiteSpace(bmId) ? null : bmId);
                AppendLog($"Claim BM Page '{page.Name}': {res.Message}");
                dlg.DialogResult = true;
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                errTb.Text = $"Lỗi Claim BM: {ex.Message}";
                ok.IsEnabled = true;
            }
        });
        row.Children.Add(cancel);
        row.Children.Add(ok);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    private void OpenWarmupPostDialog(FanpageItemDto page)
    {
        var dlg = new Window
        {
            Title = $"Đăng bài Nuôi Page • {page.Name}",
            Width = 520,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        var tbMsg = UiComponents.CreateTextBox(PageNicheTemplates.All[0].DefaultWarmupPost, "Nội dung bài viết tự nhiên để tạo tương tác...", multiline: true, height: 110);
        root.Children.Add(BuildLabeledBox("Nội dung bài đăng Nuôi Page", tbMsg));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        Button ok = null!;
        ok = UiComponents.CreateButton("Đăng bài Warmup", ButtonVariant.Success, FluentIcons.Send, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbMsg.Text))
            {
                errTb.Text = "Vui lòng nhập nội dung bài viết.";
                return;
            }
            ok.IsEnabled = false;
            try
            {
                var holderVia = ResolveEffectiveViaForPage(page);
                var prof = holderVia?.ProfileDir ?? ExtensionProvisioner.ResolveProfileDirectory(page.HolderBrowserProfile, page.HolderLabel);
                var res = await _api.PublishWarmupPostAsync(page.Id, tbMsg.Text.Trim(), holderVia?.ViaId ?? page.HolderIdentityId ?? "", holderVia?.Label ?? page.HolderLabel ?? "", prof);
                AppendLog($"Đã gửi bài Warmup cho Page '{page.Name}' ({res.DeliveryMode}).");
                if (res.DeliveryMode != "graph_api")
                {
                    if (holderVia != null && !string.IsNullOrWhiteSpace(page.Url))
                    {
                        LaunchViaChromeSafe(holderVia, page.Url!);
                    }
                }
                dlg.DialogResult = true;
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                errTb.Text = $"Lỗi Warmup: {ex.Message}";
                ok.IsEnabled = true;
            }
        });
        row.Children.Add(cancel);
        row.Children.Add(ok);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    private string? PromptPasswordDialog(string title, string description, bool confirmMatch)
    {
        var dlg = new Window
        {
            Title = title,
            Width = 440,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        string? result = null;
        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = description,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var pb1 = UiComponents.CreatePasswordBox();
        root.Children.Add(BuildLabeledBox("Mật khẩu mã hóa AES-256-GCM", pb1));
        PasswordBox? pb2 = null;
        if (confirmMatch)
        {
            pb2 = UiComponents.CreatePasswordBox();
            var w2 = BuildLabeledBox("Nhập lại mật khẩu", pb2);
            w2.Margin = new Thickness(0, 8, 0, 0);
            root.Children.Add(w2);
        }

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 8, 0, 0) };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        var ok = UiComponents.CreateButton("Xác nhận", ButtonVariant.Primary, onClick: (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(pb1.Password) || pb1.Password.Length < 6)
            {
                errTb.Text = "Mật khẩu cần tối thiểu 6 ký tự.";
                return;
            }
            if (confirmMatch && pb2 != null && pb1.Password != pb2.Password)
            {
                errTb.Text = "Hai ô mật khẩu không khớp.";
                return;
            }
            result = pb1.Password;
            dlg.DialogResult = true;
        });
        row.Children.Add(cancel);
        row.Children.Add(ok);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
        return result;
    }

    private static StackPanel BuildLabeledBox(string label, UIElement element)
    {
        var sp = new StackPanel();
        sp.Children.Add(new TextBlock
        {
            Text = label,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, 4),
        });
        sp.Children.Add(element);
        return sp;
    }

    private void OpenBulkImportViasDialog()
    {
        var dlg = new Window
        {
            Title = "Nhập Hàng Loạt Via (Auto DPAPI + Chia Chrome Profile)",
            Width = 920,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };

        root.Children.Add(new Border
        {
            Background = ThemeTokens.InfoBg,
            BorderBrush = ThemeTokens.InfoBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12, 9, 12, 9),
            Margin = new Thickness(0, 0, 0, 12),
            Child = new TextBlock
            {
                Text = "Hỗ trợ dán định dạng UID|Pass|2FA|Cookie|Mail|Proxy hoặc Tên|UID|2FA|Cookie|Proxy. Trường Mật khẩu (Pass) và Mail sẽ bị lọc bỏ 100% trước khi đẩy lên Cloud; Cookie & 2FA chỉ lưu mã hóa DPAPI tại máy Windows này.",
                FontFamily = ThemeTokens.UiFont,
                FontSize = 12,
                Foreground = ThemeTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            },
        });

        var optGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        optGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        optGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        optGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        optGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        optGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbPrefix = UiComponents.CreateTextBox("Via Nhập", "VD: Via Camp VN");
        var cbTier = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Via Lên Camp (camp)", Tag = "camp" },
            new ComboBoxItem { Content = "Via Trữ / Cầm BM (vault)", Tag = "vault" },
            new ComboBoxItem { Content = "Via Dự phòng (standby)", Tag = "standby" },
        });
        var cbWarmup = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Khóa Ngâm 72h mới hôm nay", Tag = "now" },
            new ComboBoxItem { Content = "Đã Trust (>7 ngày)", Tag = "clear" },
        });

        var pBox = BuildLabeledBox("Tiền tố tên Via (khi thiếu tên)", tbPrefix);
        var tBox = BuildLabeledBox("Nhóm mặc định", cbTier);
        var wBox = BuildLabeledBox("Chế độ Ngâm thiết bị", cbWarmup);
        Grid.SetColumn(pBox, 0);
        Grid.SetColumn(tBox, 2);
        Grid.SetColumn(wBox, 4);
        optGrid.Children.Add(pBox);
        optGrid.Children.Add(tBox);
        optGrid.Children.Add(wBox);
        root.Children.Add(optGrid);

        var chkAutoProfile = UiComponents.CreateCheckBox("Tự động chia Chrome Profile chưa sử dụng (Profile 1, Profile 2...) để tránh chồng chéo phiên", true);
        chkAutoProfile.Margin = new Thickness(0, 0, 0, 10);
        root.Children.Add(chkAutoProfile);

        var rawHeaderRow = new Grid { Margin = new Thickness(0, 0, 0, 4) };
        rawHeaderRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        rawHeaderRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        rawHeaderRow.Children.Add(new TextBlock
        {
            Text = "Danh sách Via thô (mỗi Via 1 dòng, ngăn cách bằng dấu | hoặc Tab)",
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var tbRaw = UiComponents.CreateTextBox("", "100089123456789|MatKhauAnToanBiLoc|JBSWY3DPEHPK3PXP|c_user=100089123456789; xs=abc...|103.1.2.3:8080:user:pass", multiline: true, height: 120);
        tbRaw.FontFamily = ThemeTokens.MonoFont;

        var pasteBtn = UiComponents.CreateButton("Dán từ Clipboard", ButtonVariant.Secondary, FluentIcons.Upload, compact: true, onClick: (_, _) =>
        {
            try
            {
                if (Clipboard.ContainsText()) tbRaw.Text = Clipboard.GetText();
            }
            catch { }
        });
        Grid.SetColumn(pasteBtn, 1);
        rawHeaderRow.Children.Add(pasteBtn);
        root.Children.Add(rawHeaderRow);
        root.Children.Add(tbRaw);

        var previewSummaryTb = new TextBlock
        {
            Text = "Dán danh sách vào ô trên để xem trước bản tách cột...",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.AccentText,
            Margin = new Thickness(0, 10, 0, 6),
        };
        root.Children.Add(previewSummaryTb);

        var previewHost = new StackPanel();
        var previewScroll = new ScrollViewer
        {
            MaxHeight = 200,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = previewHost,
        };
        var previewCard = UiComponents.CreateCard(previewScroll, new Thickness(8), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        root.Children.Add(previewCard);

        var statusTb = new TextBlock
        {
            Text = "",
            FontSize = 12,
            Foreground = ThemeTokens.WarningText,
            Margin = new Thickness(0, 8, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            Visibility = Visibility.Collapsed,
        };
        root.Children.Add(statusTb);

        Button importBtn = null!;
        ViaBulkParseSummary currentSummary = new(new List<ParsedBulkViaRow>(), new HashSet<string>(), 0, 0);

        void RefreshPreview()
        {
            var tierTag = (cbTier.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "camp";
            var wmTag = (cbWarmup.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "now";
            var wmIso = wmTag == "now" ? DateTimeOffset.UtcNow.ToString("O") : "";
            currentSummary = ViaBulkImportParser.ParseBulkText(
                tbRaw.Text,
                tbPrefix.Text,
                tierTag,
                _vias,
                chkAutoProfile.IsChecked == true,
                wmIso,
                _config.MaxViasPerProxyInBatch);

            previewHost.Children.Clear();
            var rows = currentSummary.Rows;
            if (rows.Count == 0)
            {
                previewSummaryTb.Text = "Chưa có dòng dữ liệu nào.";
                previewSummaryTb.Foreground = ThemeTokens.TextMuted;
                importBtn.IsEnabled = false;
                return;
            }

            var validRows = rows.Where(r => r.HasValidPayload || !string.IsNullOrWhiteSpace(r.ExternalReferenceId)).ToList();
            var dupCount = currentSummary.DuplicateProxyHosts.Count;
            previewSummaryTb.Text = $"Phân tích {rows.Count} dòng • Hợp lệ: {validRows.Count} Via • 2FA: {rows.Count(r => !string.IsNullOrWhiteSpace(r.TwoFaSecret))} • Cookie: {rows.Count(r => !string.IsNullOrWhiteSpace(r.CookieRaw))}"
                + (dupCount > 0 ? $" • ⚠ {dupCount} IP Proxy bị trùng" : "");
            previewSummaryTb.Foreground = dupCount > 0 ? ThemeTokens.WarningText : ThemeTokens.SuccessText;
            importBtn.IsEnabled = validRows.Count > 0;

            foreach (var r in rows.Take(60))
            {
                var rowGrid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(135) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(95) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(85) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.3, GridUnitType.Star) });

                rowGrid.Children.Add(new TextBlock { Text = $"#{r.RowNumber}", FontFamily = ThemeTokens.MonoFont, FontSize = 12, Foreground = ThemeTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });

                var lblTb = new TextBlock { Text = $"{r.Label} ({r.AssignedProfile})", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
                Grid.SetColumn(lblTb, 1);
                rowGrid.Children.Add(lblTb);

                var uidTb = new TextBlock { Text = string.IsNullOrWhiteSpace(r.ExternalReferenceId) ? "UID: —" : r.ExternalReferenceId, FontFamily = ThemeTokens.MonoFont, FontSize = 11, Foreground = ThemeTokens.TextSecondary, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(uidTb, 2);
                rowGrid.Children.Add(uidTb);

                var tfaTb = new TextBlock { Text = string.IsNullOrWhiteSpace(r.TwoFaSecret) ? "Không 2FA" : "2FA OK", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = string.IsNullOrWhiteSpace(r.TwoFaSecret) ? ThemeTokens.TextMuted : ThemeTokens.SuccessText, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(tfaTb, 3);
                rowGrid.Children.Add(tfaTb);

                var ckTb = new TextBlock { Text = string.IsNullOrWhiteSpace(r.CookieRaw) ? "No Cookie" : "Cookie OK", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = string.IsNullOrWhiteSpace(r.CookieRaw) ? ThemeTokens.TextMuted : ThemeTokens.AccentText, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(ckTb, 4);
                rowGrid.Children.Add(ckTb);

                var prxText = string.IsNullOrWhiteSpace(r.ProxyHostPort) ? "Không Proxy" : r.ProxyHostPort;
                if (!string.IsNullOrWhiteSpace(r.DuplicateProxyWarning)) prxText = $"⚠ {r.DuplicateProxyWarning}";
                else if (r.StrippedSecretsCount > 0) prxText += $" (đã lọc {r.StrippedSecretsCount} pass/mail)";
                var prxTb = new TextBlock { Text = prxText, FontSize = 11, Foreground = !string.IsNullOrWhiteSpace(r.DuplicateProxyWarning) ? ThemeTokens.WarningText : ThemeTokens.TextSecondary, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(prxTb, 5);
                rowGrid.Children.Add(prxTb);

                previewHost.Children.Add(new Border
                {
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(0, 0, 0, 1),
                    Padding = new Thickness(4, 3, 4, 3),
                    Child = rowGrid,
                });
            }
            if (rows.Count > 60)
            {
                previewHost.Children.Add(new TextBlock
                {
                    Text = $"... và {rows.Count - 60} dòng nữa sẽ được nhập cùng lúc.",
                    FontSize = 12,
                    Foreground = ThemeTokens.TextMuted,
                    Margin = new Thickness(4, 6, 4, 2),
                });
            }
        }

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 10, 0);

        importBtn = UiComponents.CreateButton("Nhập lên Cloud & Cất Két DPAPI", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            var targets = currentSummary.Rows.Where(r => r.HasValidPayload || !string.IsNullOrWhiteSpace(r.ExternalReferenceId)).ToList();
            if (targets.Count == 0) return;

            var ok = UiComponents.ShowConfirmActionDialog(
                dlg,
                $"Xác nhận Nhập Lô {targets.Count} Via",
                $"Chuẩn bị tạo {targets.Count} Via trên Cloud, tự động gán Chrome Profile và mã hóa DPAPI cho toàn bộ Cookie / 2FA tại máy Windows này.",
                new (string, string)[]
                {
                    ("Số lượng nhập:", $"{targets.Count} Via"),
                    ("Số Via có 2FA / Cookie:", $"{targets.Count(x => !string.IsNullOrWhiteSpace(x.TwoFaSecret))} 2FA / {targets.Count(x => !string.IsNullOrWhiteSpace(x.CookieRaw))} Cookie"),
                    ("Trùng IP Proxy cảnh báo:", currentSummary.DuplicateProxyHosts.Count > 0 ? string.Join(", ", currentSummary.DuplicateProxyHosts) : "Không phát hiện"),
                },
                "Pass và Email thô (nếu có trong dòng nhập) đã bị loại bỏ hoàn toàn trước khi gửi Cloud.");
            if (!ok) return;

            importBtn.IsEnabled = false;
            cancelBtn.IsEnabled = false;
            statusTb.Visibility = Visibility.Visible;
            int created = 0;
            int updated = 0;
            int failed = 0;

            foreach (var r in targets)
            {
                statusTb.Foreground = ThemeTokens.AccentText;
                statusTb.Text = $"Đang nhập {created + updated + failed + 1}/{targets.Count}: {r.Label} ({r.AssignedProfile})...";
                try
                {
                    var matchedVia = _vias.FirstOrDefault(v =>
                        (!string.IsNullOrWhiteSpace(r.ExternalReferenceId) &&
                         string.Equals((v.ExternalReferenceId ?? "").Trim(), r.ExternalReferenceId.Trim(), StringComparison.OrdinalIgnoreCase)) ||
                        (!string.IsNullOrWhiteSpace(r.Label) &&
                         string.Equals((v.Label ?? "").Trim(), r.Label.Trim(), StringComparison.OrdinalIgnoreCase)));

                    if (matchedVia != null)
                    {
                        LocalSecretVaultStore.Default.Upsert(
                            matchedVia.ViaId,
                            matchedVia.Label,
                            matchedVia.ProfileDir,
                            r.CookieRaw,
                            r.TwoFaSecret,
                            allowOverwriteEmpty: false);

                        var nextProxy = !string.IsNullOrWhiteSpace(r.ProxyRaw) ? r.ProxyRaw : matchedVia.NetworkLabel;
                        var updPayload = new PersonalAccountUpsertRequestDto
                        {
                            Label = matchedVia.Label,
                            DisplayName = string.IsNullOrWhiteSpace(matchedVia.DisplayName) ? matchedVia.Label : matchedVia.DisplayName,
                            ExternalReferenceId = string.IsNullOrWhiteSpace(matchedVia.ExternalReferenceId) ? r.ExternalReferenceId : matchedVia.ExternalReferenceId,
                            Status = string.IsNullOrWhiteSpace(matchedVia.Status) ? "active" : matchedVia.Status,
                            BrowserProfileLabel = string.IsNullOrWhiteSpace(matchedVia.BrowserProfileLabel) ? r.AssignedProfile : matchedVia.BrowserProfileLabel,
                            NetworkLabel = nextProxy,
                            VaultReference = (!string.IsNullOrWhiteSpace(r.TwoFaSecret) || !string.IsNullOrWhiteSpace(r.CookieRaw))
                                ? "Két DPAPI Local (Bulk)"
                                : (matchedVia.HasVaultCookie || matchedVia.HasLocalTwoFa ? "Két DPAPI Local (Desktop)" : ""),
                            Notes = string.IsNullOrWhiteSpace(matchedVia.Notes) ? r.CleanNotes : matchedVia.Notes,
                        };
                        await _api.UpdatePersonalAccountAsync(matchedVia.ViaId, updPayload);
                        updated++;
                    }
                    else
                    {
                        var payload = new PersonalAccountUpsertRequestDto
                        {
                            Label = r.Label,
                            DisplayName = r.Label,
                            ExternalReferenceId = string.IsNullOrWhiteSpace(r.ExternalReferenceId) ? null : r.ExternalReferenceId,
                            Status = "active",
                            BrowserProfileLabel = r.AssignedProfile,
                            NetworkLabel = r.ProxyRaw,
                            VaultReference = (!string.IsNullOrWhiteSpace(r.TwoFaSecret) || !string.IsNullOrWhiteSpace(r.CookieRaw))
                                ? "Két DPAPI Local (Bulk)"
                                : "",
                            Notes = r.CleanNotes,
                        };
                        var saved = await _api.CreatePersonalAccountAsync(payload);
                        LocalSecretVaultStore.Default.Upsert(
                            saved.Id,
                            saved.Label,
                            r.AssignedProfile,
                            r.CookieRaw,
                            r.TwoFaSecret,
                            allowOverwriteEmpty: false);
                        created++;
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    AppendLog($"Nhập Lô dòng #{r.RowNumber} ({r.Label}) lỗi: {ex.Message}");
                }
            }

            AppendLog($"Nhập Lô hoàn tất: tạo mới {created}, cập nhật {updated}/{targets.Count} Via" + (failed > 0 ? $", lỗi {failed}." : "."));
            await SyncCloudAsync(silent: false);
            dlg.DialogResult = true;
        });

        tbRaw.TextChanged += (_, _) => RefreshPreview();
        tbPrefix.TextChanged += (_, _) => RefreshPreview();
        cbTier.SelectionChanged += (_, _) => RefreshPreview();
        cbWarmup.SelectionChanged += (_, _) => RefreshPreview();
        chkAutoProfile.Checked += (_, _) => RefreshPreview();
        chkAutoProfile.Unchecked += (_, _) => RefreshPreview();
        RefreshPreview();

        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(importBtn);
        root.Children.Add(btnRow);

        dlg.Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 760, Content = root };
        dlg.ShowDialog();
    }

    private sealed record CommandPaletteItem(
        string Category,
        string Title,
        string Subtitle,
        string Badge,
        string SearchText,
        Action Execute,
        Action? Copy2Fa = null);

    private void OpenCommandPaletteDialog()
    {
        var dlg = new Window
        {
            Title = "Bảng Lệnh Nhanh (Ctrl+K)",
            Width = 660,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var allItems = new List<CommandPaletteItem>();
        var loggedIn = !string.IsNullOrWhiteSpace(_config.GetJwt());

        void AddNavCmd(AppView view, string shortcut, string title, string desc)
        {
            allItems.Add(new CommandPaletteItem(
                "ĐIỀU HƯỚNG",
                title,
                desc,
                shortcut,
                $"nav {title} {desc} {shortcut}",
                () => { dlg.Close(); SwitchView(view); }));
        }

        AddNavCmd(AppView.Overview, "Ctrl+1", "Tổng quan vận hành", "KPI đa Via, cảnh báo hệ thống & hàng đợi");
        AddNavCmd(AppView.Vias, "Ctrl+2", "Quản lý Đa Via", "Danh sách Via, Chrome Profile, Proxy & 2FA");
        AddNavCmd(AppView.Automation, "Ctrl+3", "Trung tâm Tự động hóa", "Tạo Page theo nhịp an toàn & Đảo Ấm Cookie");
        AddNavCmd(AppView.PagesBm, "Ctrl+4", "Fanpage & Business Manager", "Quản lý Fanpage, nuôi lô & xuất CSV");
        AddNavCmd(AppView.AdAccounts, "Ctrl+5", "Tài khoản Quảng cáo", "Bảng TKQC, số dư, ngưỡng & xuất CSV");
        AddNavCmd(AppView.HealthTokens, "Ctrl+6", "Sức khỏe TKQC, Token & Readiness", "Kiểm tra Meta Token, Readiness Board, Signals & Live Audit");
        AddNavCmd(AppView.WorkspaceOps, "Ctrl+7", "Ngân sách & Team", "Hợp đồng Client Retainers, ngân sách & quản lý thành viên");
        AddNavCmd(AppView.Settings, "Ctrl+8", "Két khóa DPAPI & Cài đặt", "Kết nối Cloud, sao lưu két, Tự cập nhật & Extension");

        allItems.Add(new CommandPaletteItem(
            "THAO TÁC",
            "Đồng bộ Cloud & Extension ngay",
            "Kéo dữ liệu mới nhất từ AdsOps Cloud (phím tắt F5)",
            "F5",
            "sync dong bo cloud refresh",
            () => { dlg.Close(); _ = SyncCloudAsync(silent: false); }));

        if (loggedIn)
        {
            allItems.Add(new CommandPaletteItem(
                "THAO TÁC",
                "Nhập Lô nhiều Via từ Clipboard",
                "Dán hàng loạt định dạng UID|Pass|2FA|Cookie|Mail|Proxy",
                "Ctrl+B",
                "bulk import nhap lo via",
                () => { dlg.Close(); OpenBulkImportViasDialog(); }));

            allItems.Add(new CommandPaletteItem(
                "THAO TÁC",
                "Thêm 1 Via mới",
                "Tạo hồ sơ Via mới trên Cloud & Két DPAPI Local",
                "Ctrl+N",
                "add them via moi",
                () => { dlg.Close(); OpenViaEditorDialog(null); }));

            allItems.Add(new CommandPaletteItem(
                "THAO TÁC",
                "Gắn nhanh Token EAAB (1-Click Auto-Connect)",
                "Dán Meta Access Token EAAB... để tự nhận diện Via, BM & TKQC trên Cloud",
                "Token",
                "token eaab auto connect meta",
                () => { dlg.Close(); OpenAutoConnectTokenDialog(null); }));

            allItems.Add(new CommandPaletteItem(
                "THAO TÁC",
                "Quét Live Proxy toàn bộ Via",
                "Kiểm tra tình trạng sống/chết tất cả IP Proxy qua POST /proxies/check-batch",
                "Proxy",
                "proxy live dead check batch quet",
                () => { dlg.Close(); _ = RunBatchProxyCheckAsync(); }));

            allItems.Add(new CommandPaletteItem(
                "THAO TÁC",
                "Tạo Hợp đồng Client Retainer mới",
                "Thiết lập ngân sách cam kết, phí Agency & gán danh sách TKQC",
                "Retainer",
                "retainer hop dong ngan sach",
                () => { dlg.Close(); OpenClientRetainerDialog(null); }));

            var dueCount = _vias.Count(v => v.NeedsKeepAlive);
            if (dueCount > 0)
            {
                allItems.Add(new CommandPaletteItem(
                    "THAO TÁC",
                    $"Chạy Đảo Ấm An Toàn ({dueCount} Via đến hạn)",
                    "Xếp hàng đợi đọc Newsfeed/Notifications giãn cách trên Proxy tĩnh",
                    "Warmup",
                    "dao am keep alive warmup",
                    () => { dlg.Close(); StartKeepAliveDueQueue(requireConfirm: true); }));
            }
        }

        allItems.Add(new CommandPaletteItem(
            "THAO TÁC",
            "Xếp cửa sổ Chrome lưới 2×2",
            "Tự động chia đều các cửa sổ Chrome đang mở thành lưới 2 cột × 2 hàng",
            "2×2",
            "tile window xep luoi chrome 2x2",
            () => { dlg.Close(); TileActiveChromeWindows("2x2"); }));

        allItems.Add(new CommandPaletteItem(
            "THAO TÁC",
            "Xếp cửa sổ Chrome lưới 3×2",
            "Tự động chia đều các cửa sổ Chrome đang mở thành lưới 3 cột × 2 hàng",
            "3×2",
            "tile window xep luoi chrome 3x2",
            () => { dlg.Close(); TileActiveChromeWindows("3x2"); }));

        allItems.Add(new CommandPaletteItem(
            "THAO TÁC",
            "Kiểm tra cập nhật AdsOps Desktop Pro",
            "Đối chiếu phiên bản mới nhất từ AdsOps-Desktop-Pro-latest.json",
            "Update",
            "update cap nhat phien ban",
            () => { dlg.Close(); _ = CheckForAppUpdatesAsync(); }));

        allItems.Add(new CommandPaletteItem(
            "THAO TÁC",
            $"Cấp lại Extension Companion v{DesktopAppInfo.ExtVersion} cho toàn bộ Via",
            $"Đồng bộ code Extension v{DesktopAppInfo.ExtVersion} & Proxy vào thư mục Profile của từng Via",
            $"Ext v{DesktopAppInfo.ExtVersion}",
            $"provision extension cap lai {DesktopAppInfo.ExtVersion}",
            () => { dlg.Close(); ProvisionAllViaExtensions(silent: false); }));

        var now = DateTimeOffset.UtcNow;
        foreach (var v in _vias)
        {
            var secret = !string.IsNullOrWhiteSpace(v.TwoFaSecret)
                ? v.TwoFaSecret
                : LocalSecretVaultStore.Default.Find(v.ViaId, v.ProfileDir, v.Label).TwoFaSecret;
            var totp = TotpService.ComputeTotp(secret, now);
            var badge = totp.Valid ? $"2FA {totp.FormattedCode}" : "Mở Chrome";
            var viaRef = v;

            allItems.Add(new CommandPaletteItem(
                "VIA",
                $"{viaRef.Label} • {viaRef.ProfileDir}",
                $"UID: {viaRef.ExternalReferenceId ?? "—"} • Proxy: {(string.IsNullOrWhiteSpace(viaRef.NetworkLabel) ? "Không" : viaRef.NetworkLabel)}",
                badge,
                $"{viaRef.Label} {viaRef.ProfileDir} {viaRef.ExternalReferenceId} {viaRef.NetworkLabel} {viaRef.ViaTier}",
                () => { dlg.Close(); LaunchViaChromeSafe(viaRef, "https://www.facebook.com/"); },
                totp.Valid ? () => { CopyViaTotpToClipboard(viaRef, showBalloon: true); dlg.Close(); } : null));
        }

        var root = new StackPanel { Margin = new Thickness(16) };
        var tbSearch = UiComponents.CreateTextBox("", "Gõ tên Via, UID, Profile, lệnh (VD: Đảo ấm, Sức khỏe, Nhập lô)...");
        root.Children.Add(tbSearch);

        var listHost = new StackPanel { Margin = new Thickness(0, 10, 0, 8) };
        var listScroll = new ScrollViewer
        {
            MaxHeight = 360,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = listHost,
        };
        root.Children.Add(listScroll);

        root.Children.Add(new TextBlock
        {
            Text = "↑ / ↓: chọn dòng   •   Enter: mở / thực thi   •   Ctrl+C: chép 2FA của Via đang chọn   •   Esc: đóng",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 11,
            Foreground = ThemeTokens.TextMuted,
        });

        var filtered = new List<CommandPaletteItem>();
        var rowBorders = new List<Border>();
        int selectedIdx = 0;

        void UpdateSelectionHighlight()
        {
            for (int i = 0; i < rowBorders.Count; i++)
            {
                var isSel = i == selectedIdx;
                rowBorders[i].Background = isSel ? ThemeTokens.BgNavActive : ThemeTokens.BgSurfaceElevated;
                rowBorders[i].BorderBrush = isSel ? ThemeTokens.InfoBorder : ThemeTokens.BorderSubtle;
            }
            if (selectedIdx >= 0 && selectedIdx < rowBorders.Count)
            {
                rowBorders[selectedIdx].BringIntoView();
            }
        }

        void RenderList()
        {
            listHost.Children.Clear();
            rowBorders.Clear();
            var q = (tbSearch.Text ?? "").Trim();
            filtered = string.IsNullOrEmpty(q)
                ? allItems.Take(25).ToList()
                : allItems.Where(x => x.SearchText.Contains(q, StringComparison.OrdinalIgnoreCase) || x.Title.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(25).ToList();

            if (filtered.Count == 0)
            {
                selectedIdx = -1;
                listHost.Children.Add(new TextBlock
                {
                    Text = "Không tìm thấy Via hoặc lệnh phù hợp.",
                    FontSize = 13,
                    Foreground = ThemeTokens.TextMuted,
                    Margin = new Thickness(8, 18, 8, 18),
                    HorizontalAlignment = HorizontalAlignment.Center,
                });
                return;
            }

            if (selectedIdx < 0 || selectedIdx >= filtered.Count) selectedIdx = 0;

            for (int i = 0; i < filtered.Count; i++)
            {
                var item = filtered[i];
                var idx = i;

                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(86) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var catPill = UiComponents.CreateBadgePill(
                    item.Category,
                    item.Category == "VIA" ? ThemeTokens.AccentText : ThemeTokens.TextSecondary,
                    item.Category == "VIA" ? ThemeTokens.InfoBg : ThemeTokens.BgSurface,
                    ThemeTokens.BorderSubtle);
                g.Children.Add(catPill);

                var mid = new StackPanel { Margin = new Thickness(8, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
                mid.Children.Add(new TextBlock { Text = item.Title, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = ThemeTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
                mid.Children.Add(new TextBlock { Text = item.Subtitle, FontSize = 11, Foreground = ThemeTokens.TextMuted, TextTrimming = TextTrimming.CharacterEllipsis });
                Grid.SetColumn(mid, 1);
                g.Children.Add(mid);

                var rightSp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                if (item.Copy2Fa != null)
                {
                    var cpBtn = UiComponents.CreateButton("Copy 2FA", ButtonVariant.Secondary, compact: true, onClick: (s, args) =>
                    {
                        args.Handled = true;
                        item.Copy2Fa();
                    });
                    cpBtn.Margin = new Thickness(0, 0, 6, 0);
                    rightSp.Children.Add(cpBtn);
                }
                rightSp.Children.Add(UiComponents.CreateBadgePill(item.Badge, ThemeTokens.TextPrimary, ThemeTokens.BgSurface, ThemeTokens.BorderDefault));
                Grid.SetColumn(rightSp, 2);
                g.Children.Add(rightSp);

                var card = new Border
                {
                    Background = ThemeTokens.BgSurfaceElevated,
                    BorderBrush = ThemeTokens.BorderSubtle,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(10, 7, 10, 7),
                    Margin = new Thickness(0, 0, 0, 6),
                    Cursor = Cursors.Hand,
                    Child = g,
                };
                card.MouseLeftButtonUp += (_, _) => item.Execute();
                card.MouseEnter += (_, _) => { selectedIdx = idx; UpdateSelectionHighlight(); };
                rowBorders.Add(card);
                listHost.Children.Add(card);
            }

            UpdateSelectionHighlight();
        }

        tbSearch.TextChanged += (_, _) => { selectedIdx = 0; RenderList(); };
        dlg.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                dlg.Close();
            }
            else if (e.Key == Key.Down && filtered.Count > 0)
            {
                e.Handled = true;
                selectedIdx = (selectedIdx + 1) % filtered.Count;
                UpdateSelectionHighlight();
            }
            else if (e.Key == Key.Up && filtered.Count > 0)
            {
                e.Handled = true;
                selectedIdx = (selectedIdx - 1 + filtered.Count) % filtered.Count;
                UpdateSelectionHighlight();
            }
            else if (e.Key == Key.Enter && selectedIdx >= 0 && selectedIdx < filtered.Count)
            {
                e.Handled = true;
                filtered[selectedIdx].Execute();
            }
            else if (e.Key == Key.C && Keyboard.Modifiers == ModifierKeys.Control && tbSearch.SelectionLength == 0 && selectedIdx >= 0 && selectedIdx < filtered.Count)
            {
                var cp = filtered[selectedIdx].Copy2Fa;
                if (cp != null)
                {
                    e.Handled = true;
                    cp();
                }
            }
        };

        dlg.Loaded += (_, _) =>
        {
            RenderList();
            tbSearch.Focus();
        };

        dlg.Content = root;
        dlg.ShowDialog();
    }

    private void OpenAutoConnectTokenDialog(ViaWorkspaceEntry? presetVia = null)
    {
        if (string.IsNullOrWhiteSpace(_config.GetJwt()))
        {
            MessageBox.Show(this, "Vui lòng đăng nhập AdsOps Cloud ở mục Cài đặt trước khi gắn Token EAAB.", "Chưa đăng nhập Cloud", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var dlg = new Window
        {
            Title = "Gắn nhanh Meta Token EAAB lên Cloud",
            Width = 540,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = "Dán Access Token EAAB... lấy từ Ads Manager hoặc Meta Business. Hệ thống sẽ tự giải mã UID Facebook, cập nhật Via & đồng bộ danh sách BM / TKQC lên Cloud.",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var viaItems = new List<ComboBoxItem> { new() { Content = "(Tự tạo / khớp theo UID Facebook)", Tag = null } };
        int selectedIdx = 0;
        for (int i = 0; i < _vias.Count; i++)
        {
            var v = _vias[i];
            viaItems.Add(new ComboBoxItem { Content = $"{v.Label} ({v.ProfileDir})", Tag = v });
            if (presetVia != null && string.Equals(v.ViaId, presetVia.ViaId, StringComparison.OrdinalIgnoreCase))
            {
                selectedIdx = i + 1;
            }
        }
        var cbVia = UiComponents.CreateComboBox(viaItems);
        cbVia.SelectedIndex = selectedIdx;
        root.Children.Add(BuildLabeledBox("Gắn ngữ cảnh Via & Profile (tùy chọn)", cbVia));

        var tbToken = UiComponents.CreateTextBox("", "EAABwzLixnjYBO...", multiline: true, height: 84);
        tbToken.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(BuildLabeledBox("Meta Access Token (EAAB...) *", tbToken));

        var metaCols = new Grid();
        metaCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        metaCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        metaCols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbProfile = UiComponents.CreateTextBox(presetVia?.ProfileDir ?? "", "VD: Profile 3");
        var tbProxy = UiComponents.CreateTextBox(presetVia?.NetworkLabel ?? "", "host:port:user:pass");
        var bProf = BuildLabeledBox("Chrome Profile Đích", tbProfile);
        var bPx = BuildLabeledBox("Nhãn Proxy / Mạng", tbProxy);
        Grid.SetColumn(bProf, 0);
        Grid.SetColumn(bPx, 2);
        metaCols.Children.Add(bProf);
        metaCols.Children.Add(bPx);
        root.Children.Add(metaCols);

        cbVia.SelectionChanged += (_, _) =>
        {
            if (cbVia.SelectedItem is ComboBoxItem cbi && cbi.Tag is ViaWorkspaceEntry sel)
            {
                tbProfile.Text = sel.ProfileDir;
                if (!string.IsNullOrWhiteSpace(sel.NetworkLabel)) tbProxy.Text = sel.NetworkLabel;
            }
        };

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var pasteBtn = UiComponents.CreateButton("Dán từ Clipboard", ButtonVariant.Secondary, onClick: (_, _) =>
        {
            try
            {
                if (Clipboard.ContainsText())
                {
                    tbToken.Text = Clipboard.GetText().Trim();
                    errTb.Text = "";
                }
            }
            catch { }
        });
        pasteBtn.Margin = new Thickness(0, 0, 8, 0);

        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);

        Button okBtn = null!;
        okBtn = UiComponents.CreateButton("Kết nối & Đồng bộ ngay", ButtonVariant.Primary, FluentIcons.ShieldKey, onClick: async (_, _) =>
        {
            var tok = (tbToken.Text ?? "").Trim();
            if (!tok.StartsWith("EAA", StringComparison.Ordinal) || tok.Length < 30)
            {
                errTb.Text = "Token Meta không hợp lệ (cần bắt đầu bằng EAA... và dài tối thiểu 30 ký tự).";
                return;
            }
            okBtn.IsEnabled = false;
            errTb.Text = "";
            try
            {
                var res = await _api.AutoConnectFacebookTokenAsync(tok, tbProfile.Text, tbProxy.Text);
                AppendLog($"Auto-Connect Token EAAB thành công: {res.Label ?? res.ExternalReferenceId} (BM liên kết: {res.LinkedBusinessManagers ?? 0})");
                dlg.DialogResult = true;
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                errTb.Text = $"Lỗi Auto-Connect Token: {ex.Message}";
                okBtn.IsEnabled = true;
            }
        });

        row.Children.Add(pasteBtn);
        row.Children.Add(cancel);
        row.Children.Add(okBtn);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenHealthSignalsDialog(AccountHealthRowDto row)
    {
        var accTitle = string.IsNullOrWhiteSpace(row.DisplayName) ? $"act_{row.ExternalAccountId}" : row.DisplayName;
        var dlg = new Window
        {
            Title = $"Tín hiệu Sức khỏe • {accTitle}",
            Width = 760,
            Height = 580,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var outer = new Grid { Margin = new Thickness(18) };
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var topInfo = new TextBlock
        {
            Text = $"TKQC: {accTitle} (act_{row.ExternalAccountId}) — Trạng thái: {row.HealthStatus.ToUpperInvariant()}",
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        };
        outer.Children.Add(topInfo);

        var listHost = new StackPanel();
        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = listHost,
        };
        Grid.SetRow(scroll, 1);
        outer.Children.Add(scroll);

        var statusTb = new TextBlock
        {
            Text = "Đang tải danh sách tín hiệu sức khỏe...",
            FontSize = 12,
            Foreground = ThemeTokens.TextMuted,
            Margin = new Thickness(0, 8, 0, 0),
        };

        async Task ReloadSignalsAsync()
        {
            statusTb.Foreground = ThemeTokens.TextMuted;
            statusTb.Text = "Đang tải tín hiệu từ Cloud...";
            listHost.Children.Clear();
            try
            {
                var paged = await _api.ListAccountHealthSignalsAsync(row.AdAccountId);
                var items = paged.Items ?? new();
                if (items.Count == 0)
                {
                    listHost.Children.Add(UiComponents.CreateEmptyState(
                        FluentIcons.ShieldCheck,
                        "Không có tín hiệu sức khỏe nào",
                        "Hệ thống chưa ghi nhận cảnh báo sức khỏe nào cho workspace này."));
                    statusTb.Text = "0 tín hiệu.";
                    return;
                }

                statusTb.Text = $"Tìm thấy {items.Count} tín hiệu sức khỏe.";
                foreach (var sig in items)
                {
                    var cardStack = new StackPanel();
                    var hdrRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };
                    var titleTb = new TextBlock
                    {
                        Text = string.IsNullOrWhiteSpace(sig.RuleName) ? sig.RuleKey : sig.RuleName,
                        FontSize = 13,
                        FontWeight = FontWeights.Bold,
                        Foreground = ThemeTokens.TextPrimary,
                        Margin = new Thickness(0, 0, 8, 0),
                        VerticalAlignment = VerticalAlignment.Center,
                    };
                    hdrRow.Children.Add(titleTb);
                    var isCrit = string.Equals(sig.Severity, "critical", StringComparison.OrdinalIgnoreCase);
                    var sevPill = UiComponents.CreateBadgePill(
                        sig.Severity.ToUpperInvariant(),
                        isCrit ? ThemeTokens.DangerText : ThemeTokens.WarningText,
                        isCrit ? ThemeTokens.DangerBg : ThemeTokens.WarningBg,
                        isCrit ? ThemeTokens.DangerBorder : ThemeTokens.WarningBorder);
                    sevPill.Margin = new Thickness(0, 0, 6, 0);
                    hdrRow.Children.Add(sevPill);

                    var isResolved = string.Equals(sig.Status, "resolved", StringComparison.OrdinalIgnoreCase);
                    hdrRow.Children.Add(UiComponents.CreateBadgePill(
                        sig.Status.ToUpperInvariant(),
                        isResolved ? ThemeTokens.SuccessText : ThemeTokens.AccentText,
                        isResolved ? ThemeTokens.SuccessBg : ThemeTokens.InfoBg,
                        isResolved ? ThemeTokens.SuccessBorder : ThemeTokens.InfoBorder));
                    cardStack.Children.Add(hdrRow);

                    if (!string.IsNullOrWhiteSpace(sig.WhyItMatters))
                    {
                        cardStack.Children.Add(new TextBlock
                        {
                            Text = sig.WhyItMatters,
                            FontSize = 12,
                            Foreground = ThemeTokens.TextSecondary,
                            TextWrapping = TextWrapping.Wrap,
                            Margin = new Thickness(0, 2, 0, 2),
                        });
                    }
                    if (!string.IsNullOrWhiteSpace(sig.RecommendedNextStep))
                    {
                        cardStack.Children.Add(new TextBlock
                        {
                            Text = $"Gợi ý: {sig.RecommendedNextStep}",
                            FontSize = 12,
                            Foreground = ThemeTokens.AccentText,
                            TextWrapping = TextWrapping.Wrap,
                            Margin = new Thickness(0, 2, 0, 6),
                        });
                    }
                    if (!string.IsNullOrWhiteSpace(sig.AcknowledgementNote) || !string.IsNullOrWhiteSpace(sig.ResolutionReason))
                    {
                        cardStack.Children.Add(new TextBlock
                        {
                            Text = $"Ghi chú: {sig.AcknowledgementNote ?? sig.ResolutionReason}",
                            FontSize = 11,
                            Foreground = ThemeTokens.TextMuted,
                            TextWrapping = TextWrapping.Wrap,
                            Margin = new Thickness(0, 0, 0, 6),
                        });
                    }

                    if (!isResolved)
                    {
                        var actGrid = new Grid();
                        actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                        actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                        actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                        var noteTb = UiComponents.CreateTextBox("", "Nhập ghi chú ghi nhận / lý do xử lý...");
                        actGrid.Children.Add(noteTb);

                        var ackBtn = UiComponents.CreateButton("Ghi nhận", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
                        {
                            var txt = string.IsNullOrWhiteSpace(noteTb.Text) ? "Đã ghi nhận từ Desktop Pro" : noteTb.Text.Trim();
                            try
                            {
                                await _api.AcknowledgeHealthSignalAsync(sig.Id, txt);
                                AppendLog($"Đã ghi nhận tín hiệu {sig.RuleKey} của {accTitle}.");
                                await ReloadSignalsAsync();
                                _ = SyncCloudAsync(silent: true);
                            }
                            catch (Exception ex) { statusTb.Foreground = ThemeTokens.DangerText; statusTb.Text = $"Lỗi: {ex.Message}"; }
                        });
                        ackBtn.Margin = new Thickness(8, 0, 6, 0);
                        Grid.SetColumn(ackBtn, 1);
                        actGrid.Children.Add(ackBtn);

                        var resBtn = UiComponents.CreateButton("Xử lý xong", ButtonVariant.Success, FluentIcons.CheckCircle, compact: true, onClick: async (_, _) =>
                        {
                            var txt = string.IsNullOrWhiteSpace(noteTb.Text) ? "Đã khắc phục trên Meta Ads Manager" : noteTb.Text.Trim();
                            try
                            {
                                await _api.ResolveHealthSignalAsync(sig.Id, txt);
                                AppendLog($"Đã đánh dấu xử lý xong tín hiệu {sig.RuleKey} của {accTitle}.");
                                await ReloadSignalsAsync();
                                _ = SyncCloudAsync(silent: true);
                            }
                            catch (Exception ex) { statusTb.Foreground = ThemeTokens.DangerText; statusTb.Text = $"Lỗi: {ex.Message}"; }
                        });
                        Grid.SetColumn(resBtn, 2);
                        actGrid.Children.Add(resBtn);
                        cardStack.Children.Add(actGrid);
                    }

                    var c = UiComponents.CreateCard(cardStack, new Thickness(12, 10, 12, 10), ThemeTokens.BgSurfaceElevated);
                    c.Margin = new Thickness(0, 0, 0, 8);
                    listHost.Children.Add(c);
                }
            }
            catch (Exception ex)
            {
                statusTb.Foreground = ThemeTokens.DangerText;
                statusTb.Text = $"Không thể tải tín hiệu: {ex.Message}";
            }
        }

        var footer = new Grid { Margin = new Thickness(0, 10, 0, 0) };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.Children.Add(statusTb);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        Grid.SetColumn(closeBtn, 1);
        footer.Children.Add(closeBtn);
        Grid.SetRow(footer, 2);
        outer.Children.Add(footer);

        dlg.Loaded += async (_, _) => await ReloadSignalsAsync();
        dlg.Content = outer;
        dlg.ShowDialog();
    }

    internal void OpenCreateBusinessManagerDialog()
    {
        var dlg = new Window
        {
            Title = "Thêm Business Manager mới",
            Width = 480,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        var tbName = UiComponents.CreateTextBox("", "VD: BM Hold Chính #01");
        var tbExtId = UiComponents.CreateTextBox("", "VD: 123456789012345 (tùy chọn)");
        var cbStatus = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Hoạt động (Active)", Tag = "active" },
            new ComboBoxItem { Content = "Chưa rõ (Unknown)", Tag = "unknown" },
            new ComboBoxItem { Content = "Hạn chế (Restricted)", Tag = "restricted" },
        });
        cbStatus.SelectedIndex = 0;
        var tbCountry = UiComponents.CreateTextBox("VN", "2 ký tự, VD: VN, US");
        var tbCurrency = UiComponents.CreateTextBox("VND", "3 ký tự, VD: VND, USD");
        var tbNotes = UiComponents.CreateTextBox("", "Ghi chú BM / Via cầm BM", multiline: true, height: 64);

        root.Children.Add(BuildLabeledBox("Tên Business Manager *", tbName));
        root.Children.Add(BuildLabeledBox("External BM ID", tbExtId));
        root.Children.Add(BuildLabeledBox("Trạng thái", cbStatus));
        root.Children.Add(BuildLabeledBox("Quốc gia (ISO 2 chữ cái)", tbCountry));
        root.Children.Add(BuildLabeledBox("Tiền tệ (ISO 3 chữ cái)", tbCurrency));
        root.Children.Add(BuildLabeledBox("Ghi chú", tbNotes));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        var save = UiComponents.CreateButton("Tạo BM", ButtonVariant.Primary, FluentIcons.Add, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbName.Text)) { errTb.Text = "Vui lòng nhập tên Business Manager."; return; }
            try
            {
                var stTag = (cbStatus.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "active";
                await _api.CreateBusinessManagerAsync(tbName.Text, tbExtId.Text, stTag, tbCountry.Text, tbCurrency.Text, tbNotes.Text);
                AppendLog($"Đã tạo Business Manager '{tbName.Text.Trim()}'.");
                await SyncCloudAsync(silent: false);
                dlg.DialogResult = true;
            }
            catch (Exception ex) { errTb.Text = ex.Message; }
        });
        row.Children.Add(cancel);
        row.Children.Add(save);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenCreatePixelDialog()
    {
        var dlg = new Window
        {
            Title = "Thêm Meta Pixel mới",
            Width = 460,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        var tbName = UiComponents.CreateTextBox("", "VD: Pixel Landing Spa Q1");
        var tbExtId = UiComponents.CreateTextBox("", "VD: 987654321098765 (tùy chọn)");
        var cbStatus = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Hoạt động (Active)", Tag = "active" },
            new ComboBoxItem { Content = "Chưa rõ (Unknown)", Tag = "unknown" },
            new ComboBoxItem { Content = "Vô hiệu (Disabled)", Tag = "disabled" },
        });
        cbStatus.SelectedIndex = 0;
        var tbNotes = UiComponents.CreateTextBox("", "Domain gắn Pixel hoặc chiến dịch", multiline: true, height: 64);

        root.Children.Add(BuildLabeledBox("Tên Meta Pixel *", tbName));
        root.Children.Add(BuildLabeledBox("Pixel ID (số)", tbExtId));
        root.Children.Add(BuildLabeledBox("Trạng thái", cbStatus));
        root.Children.Add(BuildLabeledBox("Ghi chú", tbNotes));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        var save = UiComponents.CreateButton("Lưu Pixel", ButtonVariant.Primary, FluentIcons.Add, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbName.Text)) { errTb.Text = "Vui lòng nhập tên Pixel."; return; }
            try
            {
                var stTag = (cbStatus.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "active";
                await _api.CreatePixelAsync(tbName.Text, tbExtId.Text, stTag, tbNotes.Text);
                AppendLog($"Đã thêm Meta Pixel '{tbName.Text.Trim()}'.");
                await SyncCloudAsync(silent: false);
                dlg.DialogResult = true;
            }
            catch (Exception ex) { errTb.Text = ex.Message; }
        });
        row.Children.Add(cancel);
        row.Children.Add(save);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenClientRetainerDialog(ClientRetainerItemDto? existing)
    {
        var isEdit = existing != null && !string.IsNullOrWhiteSpace(existing.Id);
        var dlg = new Window
        {
            Title = isEdit ? $"Sửa Hợp đồng Retainer • {existing!.ContractCode}" : "Tạo Hợp đồng Client Retainer mới",
            Width = 620,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        var tbCode = UiComponents.CreateTextBox(existing?.ContractCode ?? "", "VD: HD-2026-01 (để trống tự sinh)");
        var tbClient = UiComponents.CreateTextBox(existing?.ClientName ?? "", "Tên Khách hàng / Công ty *");
        var tbProject = UiComponents.CreateTextBox(existing?.ProjectName ?? "", "Tên Dự án / Nhãn hàng");
        var tbCycle = UiComponents.CreateTextBox(existing?.BillingCycle ?? $"Tháng {DateTime.Now:MM/yyyy}", "VD: Tháng 11/2026");
        var tbBudget = UiComponents.CreateTextBox((existing?.CommittedBudgetVnd ?? 100_000_000).ToString(CultureInfo.InvariantCulture), "VND, VD: 100000000");
        var tbFee = UiComponents.CreateTextBox((existing?.AgencyFeePercent ?? 10.0).ToString(CultureInfo.InvariantCulture), "% Phí Agency");
        var tbTax = UiComponents.CreateTextBox((existing?.MetaTaxPercent ?? 5.0).ToString(CultureInfo.InvariantCulture), "% Thuế Meta");
        var tbRate = UiComponents.CreateTextBox((existing?.UsdToVndRate ?? 25400).ToString(CultureInfo.InvariantCulture), "Tỷ giá USD/VND");
        var tbEmail = UiComponents.CreateTextBox(existing?.ContactEmail ?? "", "Email đối soát khách hàng");
        var tbNotes = UiComponents.CreateTextBox(existing?.Notes ?? "", "Ghi chú điều khoản hợp đồng", multiline: true, height: 52);

        var twoCol1 = new Grid();
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol1.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var l1 = BuildLabeledBox("Mã Hợp đồng", tbCode);
        var r1 = BuildLabeledBox("Tên Khách hàng *", tbClient);
        Grid.SetColumn(r1, 2);
        twoCol1.Children.Add(l1);
        twoCol1.Children.Add(r1);
        root.Children.Add(twoCol1);

        var twoCol2 = new Grid();
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol2.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var l2 = BuildLabeledBox("Tên Dự án", tbProject);
        var r2 = BuildLabeledBox("Kỳ đối soát", tbCycle);
        Grid.SetColumn(r2, 2);
        twoCol2.Children.Add(l2);
        twoCol2.Children.Add(r2);
        root.Children.Add(twoCol2);

        var numGrid = new Grid();
        for (int i = 0; i < 4; i++)
        {
            if (i > 0) numGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            numGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }
        var nb = BuildLabeledBox("Cam kết (VNĐ)", tbBudget);
        var nf = BuildLabeledBox("Phí Agency (%)", tbFee); Grid.SetColumn(nf, 2);
        var nt = BuildLabeledBox("Thuế Meta (%)", tbTax); Grid.SetColumn(nt, 4);
        var nr = BuildLabeledBox("Tỷ giá USD", tbRate); Grid.SetColumn(nr, 6);
        numGrid.Children.Add(nb);
        numGrid.Children.Add(nf);
        numGrid.Children.Add(nt);
        numGrid.Children.Add(nr);
        root.Children.Add(numGrid);

        root.Children.Add(BuildLabeledBox("Email liên hệ đối soát", tbEmail));

        // Multi-select AdAccounts
        var selectedAccSet = new HashSet<string>(existing?.AdAccountIds ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        var accCheckBoxes = new List<(string Id, CheckBox Box)>();
        var accStack = new StackPanel();
        if (_adAccounts.Count == 0)
        {
            accStack.Children.Add(new TextBlock { Text = "Chưa có TKQC nào trong Workspace.", FontSize = 12, Foreground = ThemeTokens.TextMuted });
        }
        else
        {
            foreach (var acc in _adAccounts)
            {
                var cb = UiComponents.CreateCheckBox($"{(string.IsNullOrWhiteSpace(acc.DisplayName) ? acc.ExternalAccountId : acc.DisplayName)} (act_{acc.ExternalAccountId} • {acc.Currency})", selectedAccSet.Contains(acc.Id));
                cb.Margin = new Thickness(0, 2, 0, 2);
                accCheckBoxes.Add((acc.Id, cb));
                accStack.Children.Add(cb);
            }
        }
        var accBorder = new Border
        {
            Background = ThemeTokens.BgSurfaceElevated,
            BorderBrush = ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(8),
            MaxHeight = 140,
            Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = accStack },
        };
        root.Children.Add(BuildLabeledBox($"Gán Tài khoản Quảng cáo ({_adAccounts.Count} TKQC)", accBorder));
        root.Children.Add(BuildLabeledBox("Ghi chú", tbNotes));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        var save = UiComponents.CreateButton(isEdit ? "Lưu thay đổi" : "Tạo Hợp đồng", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbClient.Text)) { errTb.Text = "Vui lòng nhập Tên Khách hàng."; return; }
            long.TryParse(tbBudget.Text.Replace(",", "").Replace(".", "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var budget);
            double.TryParse(tbFee.Text.Replace(",", ".").Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var fee);
            double.TryParse(tbTax.Text.Replace(",", ".").Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var tax);
            if (!double.TryParse(tbRate.Text.Replace(",", "").Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var rate) || rate < 1000) rate = 25400;
            var pickedAccs = accCheckBoxes.Where(x => x.Box.IsChecked == true).Select(x => x.Id).ToList();

            var payload = new Dictionary<string, object?>
            {
                ["contract_code"] = tbCode.Text.Trim(),
                ["client_name"] = tbClient.Text.Trim(),
                ["project_name"] = tbProject.Text.Trim(),
                ["contact_email"] = tbEmail.Text.Trim(),
                ["billing_cycle"] = string.IsNullOrWhiteSpace(tbCycle.Text) ? $"Tháng {DateTime.Now:MM/yyyy}" : tbCycle.Text.Trim(),
                ["committed_budget_vnd"] = budget,
                ["agency_fee_percent"] = fee,
                ["meta_tax_percent"] = tax,
                ["usd_to_vnd_rate"] = rate,
                ["notes"] = tbNotes.Text.Trim(),
                ["ad_account_ids"] = pickedAccs,
            };
            if (isEdit) payload["id"] = existing!.Id;

            try
            {
                _retainersOverview = await _api.UpsertClientRetainerAsync(payload);
                AppendLog($"Đã lưu Hợp đồng Retainer '{tbClient.Text.Trim()}'.");
                RefreshHeaderAndSidebar();
                RenderCurrentView();
                dlg.DialogResult = true;
            }
            catch (Exception ex) { errTb.Text = ex.Message; }
        });
        row.Children.Add(cancel);
        row.Children.Add(save);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void ShowInviteTokenPopupDialog(string emailLabel, string inviteLinkToken)
    {
        var dlg = new Window
        {
            Title = "Mã Token Lời mời (Hiển thị 1 lần)",
            Width = 540,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = $"Đã phát hành lời mời cho '{emailLabel}'. Hãy sao chép token một lần bên dưới để gửi cho nhân sự kích hoạt trên Web:",
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var tokTb = UiComponents.CreateTextBox(inviteLinkToken);
        tokTb.IsReadOnly = true;
        tokTb.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(tokTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var copyBtn = UiComponents.CreateButton("Sao chép Token mời", ButtonVariant.Primary, FluentIcons.Copy, onClick: (_, _) =>
        {
            Clipboard.SetText(inviteLinkToken);
            AppendLog($"Đã chép Invite Token cho {emailLabel}.");
        });
        copyBtn.Margin = new Thickness(0, 0, 8, 0);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        row.Children.Add(copyBtn);
        row.Children.Add(closeBtn);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenInviteTeamMemberDialog()
    {
        var dlg = new Window
        {
            Title = "Mời thành viên vào Team Workspace",
            Width = 480,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        var tbEmail = UiComponents.CreateTextBox("", "nhanvien@gmail.com");
        var cbRole = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Operator (Quản lý Via & TKQC)", Tag = "operator" },
            new ComboBoxItem { Content = "Admin (Quản trị vận hành)", Tag = "admin" },
            new ComboBoxItem { Content = "Viewer (Chỉ xem báo cáo)", Tag = "viewer" },
        });
        cbRole.SelectedIndex = 0;

        root.Children.Add(BuildLabeledBox("Email thành viên *", tbEmail));
        root.Children.Add(BuildLabeledBox("Vai trò (Role)", cbRole));

        var errTb = new TextBlock { Text = "", Foreground = ThemeTokens.DangerText, FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancel.Margin = new Thickness(0, 0, 8, 0);
        var sendBtn = UiComponents.CreateButton("Tạo lời mời", ButtonVariant.Primary, FluentIcons.Send, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbEmail.Text) || !tbEmail.Text.Contains('@'))
            {
                errTb.Text = "Vui lòng nhập email hợp lệ.";
                return;
            }
            var role = (cbRole.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "operator";
            try
            {
                var res = await _api.CreateTeamInvitationAsync(tbEmail.Text, role);
                AppendLog($"Đã tạo lời mời Team cho {tbEmail.Text.Trim()} ({role}).");
                await SyncCloudAsync(silent: true);
                dlg.DialogResult = true;
                ShowInviteTokenPopupDialog(tbEmail.Text.Trim(), res.InviteLinkToken);
            }
            catch (Exception ex) { errTb.Text = ex.Message; }
        });
        row.Children.Add(cancel);
        row.Children.Add(sendBtn);
        root.Children.Add(row);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenStewardshipLogDialog()
    {
        var dlg = new Window
        {
            Title = $"Nhật ký Khiên Chống Checkpoint & Cách Ly Đa Khách Hàng (v{DesktopAppInfo.Version})",
            Width = 800,
            Height = 680,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var outer = new Grid { Margin = new Thickness(20) };
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var hdr = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
        hdr.Children.Add(new TextBlock
        {
            Text = "Nhật ký Bảo vệ Tài khoản Khách Hàng & Chống Checkpoint",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        });
        hdr.Children.Add(new TextBlock
        {
            Text = "Ghi nhận tức thì mọi sự kiện chặn rò rỉ IP, kích hoạt Cooldown 24h, cách ly Silo 72h và làm mới Cookie DPAPI Local.",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 3, 0, 0),
        });
        Grid.SetRow(hdr, 0);
        outer.Children.Add(hdr);

        var soakCount = _vias.Count(v => v.IsInSoakQuarantine);
        var cdCount = _vias.Count(v => v.IsInCooldown);
        var siloCount = _vias.Count(v => v.HasSiloConflict);
        var avgTrust = _vias.Count > 0 ? (int)Math.Round(_vias.Average(v => v.TrustScore)) : 0;

        var kpiGrid = new Grid { Margin = new Thickness(0, 0, 0, 12) };
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var k1 = UiComponents.CreateMetricCard("Đang ngâm 72h", soakCount.ToString(), "Khóa Tạo Page hàng loạt", FluentIcons.Lock, ThemeTokens.WarningText, out _, out _);
        var k2 = UiComponents.CreateMetricCard("Đang Cooldown", cdCount.ToString(), "Tự dừng khi gặp biến cố", FluentIcons.Warning, cdCount > 0 ? ThemeTokens.DangerText : ThemeTokens.SuccessText, out _, out _);
        var k3 = UiComponents.CreateMetricCard("Trùng Silo Khách", siloCount.ToString(), "Proxy / Profile dùng chung", FluentIcons.ShieldCheck, siloCount > 0 ? ThemeTokens.DangerText : ThemeTokens.SuccessText, out _, out _);
        var k4 = UiComponents.CreateMetricCard("Trust Trung Bình", $"{avgTrust}/100", "Điểm môi trường toàn dàn", FluentIcons.CheckCircle, avgTrust >= 75 ? ThemeTokens.SuccessText : ThemeTokens.AccentText, out _, out _);
        Grid.SetColumn(k1, 0);
        Grid.SetColumn(k2, 2);
        Grid.SetColumn(k3, 4);
        Grid.SetColumn(k4, 6);
        kpiGrid.Children.Add(k1);
        kpiGrid.Children.Add(k2);
        kpiGrid.Children.Add(k3);
        kpiGrid.Children.Add(k4);
        Grid.SetRow(kpiGrid, 1);
        outer.Children.Add(kpiGrid);

        var eventsListPanel = new StackPanel();
        void PopulateEvents()
        {
            eventsListPanel.Children.Clear();
            var events = ViaStewardshipStore.Default.GetRecentEvents(120);
            if (events.Count == 0)
            {
                eventsListPanel.Children.Add(UiComponents.CreateEmptyState(
                    FluentIcons.ShieldCheck,
                    "Chưa có biến cố hoặc sự kiện bảo vệ",
                    "Khi có sự kiện IP Kill-Switch, Checkpoint Cooldown, Đảo Ấm hoặc làm mới Cookie DPAPI, lịch sử sẽ hiện tại đây."));
                return;
            }
            foreach (var ev in events)
            {
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(132) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(170) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var tsText = DateTimeOffset.TryParse(ev.TimestampUtc, out var dt)
                    ? dt.ToLocalTime().ToString("dd/MM HH:mm:ss")
                    : ev.TimestampUtc;
                row.Children.Add(new TextBlock
                {
                    Text = tsText,
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 11,
                    Foreground = ThemeTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                });

                var badgeCol = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
                var (fg, bg, bd) = ev.EventType switch
                {
                    "IP_LEAK_BLOCKED" or "SAFETY_CHALLENGE" or "SAFETY_COOLDOWN" => (ThemeTokens.DangerText, ThemeTokens.DangerBg, ThemeTokens.DangerBorder),
                    "PROXY_CHANGED_QUARANTINE" => (ThemeTokens.WarningText, ThemeTokens.WarningBg, ThemeTokens.WarningBorder),
                    "VAULT_COOKIE_REFRESHED" or "KEEPALIVE_OK" or "COOLDOWN_CLEARED" or "COOLDOWN_CLEARED_ALL" => (ThemeTokens.SuccessText, ThemeTokens.SuccessBg, ThemeTokens.SuccessBorder),
                    _ => (ThemeTokens.AccentText, ThemeTokens.InfoBg, ThemeTokens.InfoBorder),
                };
                badgeCol.Children.Add(UiComponents.CreateBadgePill(ev.EventType, fg, bg, bd));
                Grid.SetColumn(badgeCol, 1);
                row.Children.Add(badgeCol);

                var detailStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                var siloPart = string.IsNullOrWhiteSpace(ev.ClientGroup) ? "" : $" [Silo: {ev.ClientGroup}]";
                detailStack.Children.Add(new TextBlock
                {
                    Text = $"{ev.ViaLabel}{siloPart}",
                    FontFamily = ThemeTokens.UiFont,
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = ThemeTokens.TextPrimary,
                });
                detailStack.Children.Add(new TextBlock
                {
                    Text = ev.Detail,
                    FontFamily = ThemeTokens.UiFont,
                    FontSize = 12,
                    Foreground = ThemeTokens.TextSecondary,
                    TextWrapping = TextWrapping.Wrap,
                });
                Grid.SetColumn(detailStack, 2);
                row.Children.Add(detailStack);

                var card = UiComponents.CreateCard(row, new Thickness(10, 7, 10, 7), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
                card.Margin = new Thickness(0, 0, 0, 6);
                eventsListPanel.Children.Add(card);
            }
        }
        PopulateEvents();

        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = eventsListPanel,
        };
        Grid.SetRow(scroll, 2);
        outer.Children.Add(scroll);

        var footer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 14, 0, 0),
        };
        var clearAllBtn = UiComponents.CreateButton("Gỡ toàn bộ Cooldown", ButtonVariant.Secondary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            var count = ViaStewardshipStore.Default.ClearAllCooldowns();
            foreach (var v in _vias)
            {
                v.CooldownUntilUtc = null;
                v.CooldownReason = "";
            }
            AppendLog($"Đã gỡ Cooldown cho {count} Via.");
            PopulateEvents();
            RenderCurrentView();
        });
        clearAllBtn.Margin = new Thickness(0, 0, 8, 0);

        var exportLogBtn = UiComponents.CreateButton("Xuất CSV Nhật ký An toàn", ButtonVariant.Secondary, FluentIcons.Upload, onClick: (_, _) =>
        {
            var events = ViaStewardshipStore.Default.GetRecentEvents(250);
            ExportCsvWithDialog(
                $"adsops-stewardship-log-{DateTime.Now:yyyyMMdd-HHmm}.csv",
                new[] { "Thoi_Gian_UTC", "Su_Kien", "Via_ID", "Ten_Via", "Silo_Khach_Hang", "Chi_Tiet" },
                events.Select(e => new string?[] { e.TimestampUtc, e.EventType, e.ViaId, e.ViaLabel, e.ClientGroup, e.Detail }),
                "Nhật ký Bảo vệ Via");
        });
        exportLogBtn.Margin = new Thickness(0, 0, 8, 0);

        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Primary, onClick: (_, _) => dlg.Close());
        footer.Children.Add(clearAllBtn);
        footer.Children.Add(exportLogBtn);
        footer.Children.Add(closeBtn);
        Grid.SetRow(footer, 3);
        outer.Children.Add(footer);

        dlg.Content = outer;
        dlg.ShowDialog();
    }

    internal async void OpenProfileLaunchAuditDialog()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(_config.GetJwt()))
            {
                _launchAudits = await _api.GetProfileLaunchAuditAsync(80);
            }
        }
        catch (Exception ex)
        {
            AppendLog($"Lỗi tải Nhật ký Mở Profile: {ex.Message}");
        }

        var dlg = new Window
        {
            Title = "Nhật ký Team Mở Profile & Auto-Failover (Audit)",
            Width = 860,
            Height = 640,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var outer = new Grid { Margin = new Thickness(20) };
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var hdr = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
        hdr.Children.Add(new TextBlock
        {
            Text = "🕵️ Nhật ký Team Mở Profile, Chạy Kịch Bản & Failover",
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
        });
        hdr.Children.Add(new TextBlock
        {
            Text = "Theo dõi chính xác nhân sự nào đã mở Profile nào, chạy qua Engine nào, trên máy nào và độ trễ khởi động thực tế.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 3, 0, 0),
        });
        Grid.SetRow(hdr, 0);
        outer.Children.Add(hdr);

        var listStack = new StackPanel();
        if (_launchAudits.Count == 0)
        {
            listStack.Children.Add(UiComponents.CreateEmptyState(
                FluentIcons.Diagnostic,
                "Chưa có lịch sử Mở Profile trong Team",
                "Khi bất kỳ thành viên nào mở Chrome / AdsPower / Dolphin / Hidemyacc / Genlogin / GoLogin, nhật ký sẽ tự đồng bộ về đây."));
        }
        else
        {
            foreach (var row in _launchAudits)
            {
                var cardBody = new Grid();
                cardBody.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                cardBody.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var left = new StackPanel();
                var actionTitle = row.Action switch
                {
                    "via.engine_failover" => $"🛡️ Failover ({row.FailoverFrom} → {AntidetectBrowserConnector.GetDisplayName(row.AntidetectEngine)})",
                    "playbook.batch_executed" => "📚 Chạy Kịch bản Lô Lệch Pha",
                    "via.profile_stopped" => "⏹️ Đóng Profile",
                    _ => $"🚀 Mở Profile ({AntidetectBrowserConnector.GetDisplayName(row.AntidetectEngine)})",
                };
                left.Children.Add(new TextBlock
                {
                    Text = $"{actionTitle} • {row.ViaLabel} • Người mở: {(string.IsNullOrWhiteSpace(row.ActorName) ? row.ActorEmail : row.ActorName)} ({row.ActorEmail})",
                    FontSize = 12.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = ThemeTokens.TextPrimary,
                    TextWrapping = TextWrapping.Wrap,
                });
                var metaParts = new List<string>();
                if (!string.IsNullOrWhiteSpace(row.BrowserProfile)) metaParts.Add(row.BrowserProfile);
                if (!string.IsNullOrWhiteSpace(row.Workstation)) metaParts.Add($"Máy: {row.Workstation}");
                if (row.StartupMs.HasValue) metaParts.Add($"{row.StartupMs.Value}ms");
                if (!string.IsNullOrWhiteSpace(row.Detail)) metaParts.Add(row.Detail);
                left.Children.Add(new TextBlock
                {
                    Text = string.Join(" • ", metaParts),
                    FontSize = 11.5,
                    Foreground = ThemeTokens.TextMuted,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 0),
                });
                cardBody.Children.Add(left);

                var tsText = DateTimeOffset.TryParse(row.CreatedAt, out var dt)
                    ? dt.ToLocalTime().ToString("dd/MM HH:mm:ss")
                    : (row.CreatedAt ?? "");
                var timeTb = new TextBlock
                {
                    Text = tsText,
                    FontFamily = ThemeTokens.MonoFont,
                    FontSize = 11,
                    Foreground = ThemeTokens.TextSecondary,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(10, 0, 0, 0),
                };
                Grid.SetColumn(timeTb, 1);
                cardBody.Children.Add(timeTb);

                var c = UiComponents.CreateCard(cardBody, new Thickness(12, 8, 12, 8), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderSubtle);
                c.Margin = new Thickness(0, 0, 0, 6);
                listStack.Children.Add(c);
            }
        }

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = listStack };
        Grid.SetRow(scroll, 1);
        outer.Children.Add(scroll);

        var footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        var expBtn = UiComponents.CreateButton("Xuất CSV Nhật ký Team", ButtonVariant.Secondary, FluentIcons.Upload, onClick: (_, _) =>
        {
            ExportCsvWithDialog(
                $"adsops-launch-audit-{DateTime.Now:yyyyMMdd-HHmm}.csv",
                new[] { "Thoi_Gian", "Hanh_Dong", "Nguoi_Mo", "Email", "Via", "Engine", "Profile", "May", "Startup_ms" },
                _launchAudits.Select(x => new string?[] { x.CreatedAt, x.Action, x.ActorName, x.ActorEmail, x.ViaLabel, x.AntidetectEngine, x.BrowserProfile, x.Workstation, x.StartupMs?.ToString() }),
                "Nhật ký Mở Profile Team");
        });
        expBtn.Margin = new Thickness(0, 0, 8, 0);
        footer.Children.Add(expBtn);
        footer.Children.Add(UiComponents.CreateButton("Đóng", ButtonVariant.Primary, onClick: (_, _) => dlg.Close()));
        Grid.SetRow(footer, 2);
        outer.Children.Add(footer);

        dlg.Content = outer;
        dlg.ShowDialog();
    }

    internal void OpenCreatePlaybookDialog(Action onSaved)
    {
        var dlg = new Window
        {
            Title = "Tạo & Chia sẻ Kịch Bản Automation cho Team",
            Width = 580,
            Height = 520,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = "📚 Đóng gói Kịch bản mới lên Chợ Team",
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 0, 0, 10),
        });

        var tbTitle = UiComponents.CreateTextBox("", "VD: Nuôi Via US chạy Spa — Kiểm tra Page & Billing");
        var cbPlat = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "Meta / Facebook Ads", Tag = "meta" },
            new ComboBoxItem { Content = "Google Ads", Tag = "google_ads" },
            new ComboBoxItem { Content = "TikTok Ads", Tag = "tiktok" },
            new ComboBoxItem { Content = "Đa nền tảng (Multi)", Tag = "multi" },
        });
        cbPlat.SelectedIndex = 0;
        var tbDesc = UiComponents.CreateTextBox("", "Mô tả mục đích kịch bản & lưu ý an toàn...", multiline: true, height: 64);
        var tbTargetUrl = UiComponents.CreateTextBox("https://www.facebook.com/", "URL khởi chạy chính (https://...)");
        var tbStagger = UiComponents.CreateTextBox("60");
        var tbJitter = UiComponents.CreateTextBox("35");

        var numGrid = new Grid { Margin = new Thickness(0, 8, 0, 8) };
        numGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        numGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        numGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var n1 = BuildLabeledBox("Giãn cách cơ sở (giây)", tbStagger);
        var n2 = BuildLabeledBox("Biên độ lệch pha Jitter (%)", tbJitter);
        Grid.SetColumn(n1, 0);
        Grid.SetColumn(n2, 2);
        numGrid.Children.Add(n1);
        numGrid.Children.Add(n2);

        root.Children.Add(BuildLabeledBox("Tên kịch bản", tbTitle));
        var platWrap = BuildLabeledBox("Nền tảng", cbPlat);
        platWrap.Margin = new Thickness(0, 8, 0, 8);
        root.Children.Add(platWrap);
        root.Children.Add(BuildLabeledBox("URL Đích", tbTargetUrl));
        root.Children.Add(numGrid);
        root.Children.Add(BuildLabeledBox("Mô tả & Lưu ý Team", tbDesc));

        var errTb = new TextBlock { Text = "", FontSize = 12, Foreground = ThemeTokens.DangerText, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var btns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        var saveBtn = UiComponents.CreateButton("Lưu & Chia sẻ cho Team", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbTitle.Text))
            {
                errTb.Text = "Vui lòng nhập Tên kịch bản.";
                return;
            }
            var targetUrl = tbTargetUrl.Text.Trim();
            if (!targetUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                errTb.Text = "URL Đích phải bắt đầu bằng https://.";
                return;
            }
            var plat = (cbPlat.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "meta";
            var stagger = int.TryParse(tbStagger.Text, out var s) ? Math.Clamp(s, 25, 600) : 60;
            var jitter = int.TryParse(tbJitter.Text, out var j) ? Math.Clamp(j, 10, 60) : 35;

            try
            {
                var created = await _api.CreatePlaybookAsync(
                    tbTitle.Text,
                    plat,
                    tbDesc.Text,
                    stagger,
                    jitter,
                    new List<AutomationPlaybookStepDto>
                    {
                        new() { Action = "open_url", Target = targetUrl, WaitSec = 15, Note = "Chạy lệch pha Jitter bảo vệ Checkpoint" },
                    });
                _playbooks.Insert(0, created);
                _selectedPlaybookId = created.Id;
                AppendLog($"Đã tạo kịch bản Team '{created.Title}' ({created.Platform} v{created.VersionTag}).");
                dlg.Close();
                onSaved();
            }
            catch (Exception ex)
            {
                errTb.Text = ex.Message;
            }
        });
        btns.Children.Add(cancelBtn);
        btns.Children.Add(saveBtn);
        root.Children.Add(btns);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenBulkDistributeProxiesDialog(IReadOnlyList<ViaWorkspaceEntry>? preselected = null)
    {
        var targets = (preselected != null && preselected.Count > 0)
            ? preselected.ToList()
            : (_selectedViaIds.Count > 0
                ? _vias.Where(v => _selectedViaIds.Contains(v.ViaId)).ToList()
                : _vias.Where(v => string.IsNullOrWhiteSpace(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel))).ToList());
        if (targets.Count == 0) targets = _vias.ToList();
        if (targets.Count == 0)
        {
            MessageBox.Show(this, "Chưa có Via nào trong danh sách để gán Proxy.", "Thông báo", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var dlg = new Window
        {
            Title = $"Chia Proxy Tự Động 1:{_config.MaxViasPerProxyInBatch} ({targets.Count} Via)",
            Width = 640,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = $"Hệ thống sẽ rải đều các Proxy hợp lệ (IP:Port:User:Pass hoặc http://...) cho {targets.Count} Via mục tiêu, giới hạn mỗi Proxy tối đa đúng số Via bên dưới.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var topGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var tbPerProxy = UiComponents.CreateTextBox(_config.MaxViasPerProxyInBatch.ToString());
        var tbSilo = UiComponents.CreateTextBox("", "Để trống = giữ Silo cũ (VD: KhachA)");
        var b1 = BuildLabeledBox("Số Via / 1 Proxy (1–50)", tbPerProxy);
        var b2 = BuildLabeledBox("Nhóm Khách / Client Silo (Tùy chọn)", tbSilo);
        Grid.SetColumn(b1, 0);
        Grid.SetColumn(b2, 2);
        topGrid.Children.Add(b1);
        topGrid.Children.Add(b2);
        root.Children.Add(topGrid);

        var tbProxies = UiComponents.CreateTextBox("", "Mỗi dòng 1 Proxy (VD: 103.10.20.30:8080:user:pass)", multiline: true, height: 120);
        tbProxies.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(BuildLabeledBox("Danh sách Proxy Dân cư / IPv4 (1 dòng / Proxy)", tbProxies));

        var previewTb = new TextBlock
        {
            Text = "Dán danh sách Proxy vào ô trên để xem trước phân bổ...",
            FontSize = 12,
            Foreground = ThemeTokens.AccentText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 10, 0, 0),
        };
        root.Children.Add(previewTb);

        List<(ViaWorkspaceEntry Via, string AssignedProxy)> currentPlan = new();
        void RefreshPlan()
        {
            var cap = int.TryParse(tbPerProxy.Text, out var n) ? Math.Clamp(n, 1, 50) : _config.MaxViasPerProxyInBatch;
            var lines = (tbProxies.Text ?? "").Replace("\r\n", "\n").Split('\n');
            currentPlan = ViaBulkDistributor.DistributeProxies(targets, lines, cap);
            if (currentPlan.Count == 0)
            {
                previewTb.Text = "Chưa có dòng Proxy hợp lệ nào (hỗ trợ IP:Port hoặc IP:Port:User:Pass).";
                previewTb.Foreground = ThemeTokens.TextMuted;
            }
            else
            {
                var sample = string.Join(" | ", currentPlan.Take(3).Select(x => $"{x.Via.Label} -> {AutomationQueueEngine.ExtractProxyHostPort(x.AssignedProxy)}"));
                previewTb.Text = $"Sẵn sàng gắn Proxy cho {currentPlan.Count}/{targets.Count} Via ({cap} Via/IP). Mẫu: {sample}" + (currentPlan.Count > 3 ? "..." : "");
                previewTb.Foreground = ThemeTokens.SuccessText;
            }
        }
        tbProxies.TextChanged += (_, _) => RefreshPlan();
        tbPerProxy.TextChanged += (_, _) => RefreshPlan();

        var errTb = new TextBlock { Text = "", FontSize = 12, Foreground = ThemeTokens.DangerText, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        Button applyBtn = null!;
        applyBtn = UiComponents.CreateButton("Áp dụng & Cập nhật Cloud", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            RefreshPlan();
            if (currentPlan.Count == 0)
            {
                errTb.Text = "Vui lòng nhập ít nhất 1 Proxy hợp lệ.";
                return;
            }
            applyBtn.IsEnabled = false;
            cancelBtn.IsEnabled = false;
            var siloOverride = tbSilo.Text.Trim();
            int okCnt = 0;
            try
            {
                foreach (var (via, px) in currentPlan)
                {
                    var effSilo = string.IsNullOrWhiteSpace(siloOverride) ? via.ClientGroup : siloOverride;
                    var builtNotes = ViaMetadataParser.BuildNotes(
                        via.CleanNotes,
                        via.RoleTier,
                        via.WarmupStartIso,
                        effSilo,
                        via.DefaultWarmupMode,
                        via.AntidetectEngine,
                        via.AntidetectProfileId);
                    await _api.UpdatePersonalAccountAsync(via.ViaId, new PersonalAccountUpsertRequestDto
                    {
                        Label = via.Label,
                        DisplayName = string.IsNullOrWhiteSpace(via.DisplayName) ? via.Label : via.DisplayName,
                        ExternalReferenceId = string.IsNullOrWhiteSpace(via.ExternalReferenceId) ? null : via.ExternalReferenceId,
                        Status = string.IsNullOrWhiteSpace(via.Status) ? "active" : via.Status,
                        BrowserProfileLabel = string.IsNullOrWhiteSpace(via.BrowserProfileLabel) ? via.ProfileDir : via.BrowserProfileLabel,
                        NetworkLabel = px,
                        VaultReference = (via.HasVaultCookie || via.HasLocalTwoFa) ? "Két DPAPI Local (Desktop)" : "",
                        Notes = builtNotes,
                    });
                    ViaStewardshipStore.Default.GetOrTrackProxy(via.ViaId, via.Label, px);
                    okCnt++;
                }
                AppendLog($"🌐 Đã chia Proxy tự động cho {okCnt}/{targets.Count} Via thành công.");
                await SyncCloudAsync(silent: false);
                dlg.Close();
                RenderCurrentView();
            }
            catch (Exception ex)
            {
                errTb.Text = $"Đã cập nhật {okCnt}/{currentPlan.Count} Via, lỗi: {ex.Message}";
                applyBtn.IsEnabled = true;
                cancelBtn.IsEnabled = true;
            }
        });
        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(applyBtn);
        root.Children.Add(btnRow);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenBulkChangeTierAndSiloDialog(IReadOnlyList<ViaWorkspaceEntry>? preselected = null)
    {
        var targets = (preselected != null && preselected.Count > 0)
            ? preselected.ToList()
            : (_selectedViaIds.Count > 0
                ? _vias.Where(v => _selectedViaIds.Contains(v.ViaId)).ToList()
                : _vias.ToList());
        if (targets.Count == 0)
        {
            MessageBox.Show(this, "Chưa có Via nào trong danh sách để chỉnh sửa.", "Thông báo", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var dlg = new Window
        {
            Title = $"Đổi Lớp Via, Silo & Tách Chrome Profile ({targets.Count} Via)",
            Width = 560,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = $"Cập nhật hàng loạt cho {targets.Count} Via đang chọn. Bạn có thể chuyển nhanh từ HOLD BM sang LÊN CAMP hoặc tách sạch Profile trùng.",
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var cbTier = UiComponents.CreateComboBox(new[]
        {
            new ComboBoxItem { Content = "— Giữ nguyên Lớp hiện tại —", Tag = "keep" },
            new ComboBoxItem { Content = "🚀 LÊN CAMP (Via Chạy Ads Chính)", Tag = "camp" },
            new ComboBoxItem { Content = "🛡️ HOLD BM (Chỉ Cầm Tài Sản / BM)", Tag = "vault" },
            new ComboBoxItem { Content = "🌱 DỰ PHÒNG (Standby Ngâm Sẵn)", Tag = "standby" },
        });
        cbTier.SelectedIndex = 0;

        var tbSilo = UiComponents.CreateTextBox("", "Để trống = giữ Silo cũ (VD: Khach_Spa_A)");
        var chkSplitProfiles = UiComponents.CreateCheckBox(
            "Tự động tách Chrome Profile riêng (Profile 1, Profile 2...) cho các Via đang trùng",
            targets.Any(v => v.HasSiloConflict));
        chkSplitProfiles.Margin = new Thickness(0, 10, 0, 10);

        var twoCol = new Grid { Margin = new Thickness(0, 0, 0, 6) };
        twoCol.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        twoCol.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        twoCol.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var l1 = BuildLabeledBox("Đổi Lớp Vận Hành (Tier)", cbTier);
        var l2 = BuildLabeledBox("Gán Client Silo (Tùy chọn)", tbSilo);
        Grid.SetColumn(l1, 0);
        Grid.SetColumn(l2, 2);
        twoCol.Children.Add(l1);
        twoCol.Children.Add(l2);

        root.Children.Add(twoCol);
        root.Children.Add(chkSplitProfiles);

        var errTb = new TextBlock { Text = "", FontSize = 12, Foreground = ThemeTokens.DangerText, Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap };
        root.Children.Add(errTb);

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Hủy", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        Button saveBtn = null!;
        saveBtn = UiComponents.CreateButton($"Cập nhật {targets.Count} Via", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            saveBtn.IsEnabled = false;
            cancelBtn.IsEnabled = false;
            var tierChoice = (cbTier.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "keep";
            var siloOverride = tbSilo.Text.Trim();
            var profileUpdates = chkSplitProfiles.IsChecked == true
                ? ViaBulkDistributor.AllocateDistinctChromeProfiles(targets, _vias).ToDictionary(x => x.Via.ViaId, x => x.NewProfileDir, StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            int okCnt = 0;
            try
            {
                foreach (var via in targets)
                {
                    var effTier = tierChoice == "keep" ? via.RoleTier : tierChoice;
                    var effSilo = string.IsNullOrWhiteSpace(siloOverride) ? via.ClientGroup : siloOverride;
                    var effProf = profileUpdates.TryGetValue(via.ViaId, out var newProf)
                        ? newProf
                        : (string.IsNullOrWhiteSpace(via.BrowserProfileLabel) ? via.ProfileDir : via.BrowserProfileLabel);

                    var builtNotes = ViaMetadataParser.BuildNotes(
                        via.CleanNotes,
                        effTier,
                        via.WarmupStartIso,
                        effSilo,
                        via.DefaultWarmupMode,
                        via.AntidetectEngine,
                        via.AntidetectProfileId);
                    await _api.UpdatePersonalAccountAsync(via.ViaId, new PersonalAccountUpsertRequestDto
                    {
                        Label = via.Label,
                        DisplayName = string.IsNullOrWhiteSpace(via.DisplayName) ? via.Label : via.DisplayName,
                        ExternalReferenceId = string.IsNullOrWhiteSpace(via.ExternalReferenceId) ? null : via.ExternalReferenceId,
                        Status = string.IsNullOrWhiteSpace(via.Status) ? "active" : via.Status,
                        BrowserProfileLabel = effProf,
                        NetworkLabel = via.NetworkLabel,
                        VaultReference = (via.HasVaultCookie || via.HasLocalTwoFa) ? "Két DPAPI Local (Desktop)" : "",
                        Notes = builtNotes,
                    });
                    okCnt++;
                }
                AppendLog($"⚡ Đã cập nhật hàng loạt Lớp/Silo/Profile cho {okCnt}/{targets.Count} Via.");
                await SyncCloudAsync(silent: false);
                dlg.Close();
                RenderCurrentView();
            }
            catch (Exception ex)
            {
                errTb.Text = $"Đã cập nhật {okCnt}/{targets.Count} Via, lỗi: {ex.Message}";
                saveBtn.IsEnabled = true;
                cancelBtn.IsEnabled = true;
            }
        });
        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(saveBtn);
        root.Children.Add(btnRow);

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenQuickReloginDialog()
    {
        var dlg = new Window
        {
            Title = "Đăng nhập lại AdsOps Cloud (Tự giữ phiên 24/7)",
            Width = 460,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = "Phiên JWT cũ đã hết hạn qua đêm. Nhập lại mật khẩu 1 lần để đồng bộ Cloud — App sẽ mã hóa DPAPI tại máy Windows này và tự gia hạn phiên mỗi khi hết hạn 24/7.",
            FontSize = 12.5,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var tbEmail = UiComponents.CreateTextBox(_config.UserEmail, "email@domain.com");
        var pbPass = UiComponents.CreatePasswordBox();
        root.Children.Add(BuildLabeledBox("Email AdsOps Cloud", tbEmail));
        var passWrap = BuildLabeledBox("Mật khẩu Cloud", pbPass);
        passWrap.Margin = new Thickness(0, 8, 0, 0);
        root.Children.Add(passWrap);

        var errTb = new TextBlock
        {
            Text = "",
            FontSize = 12,
            Foreground = ThemeTokens.DangerText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0),
        };
        root.Children.Add(errTb);

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        Button okBtn = null!;
        okBtn = UiComponents.CreateButton("Đăng nhập & Tự giữ phiên 24/7", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbEmail.Text) || string.IsNullOrWhiteSpace(pbPass.Password))
            {
                errTb.Text = "Vui lòng nhập đầy đủ Email và Mật khẩu.";
                return;
            }
            okBtn.IsEnabled = false;
            errTb.Text = "";
            try
            {
                _config.UserEmail = tbEmail.Text.Trim();
                _api.Configure(_config.BackendBaseUrl, "");
                var loginRes = await _api.LoginAsync(_config.UserEmail, pbPass.Password);
                _config.SetJwt(loginRes.AccessToken);
                _config.SetSavedPassword(pbPass.Password);
                _config.Save();
                ConfigureApiClient();
                _isAuthExpired = false;
                pbPass.Clear();
                AppendLog($"🔑 Đã đăng nhập lại Cloud '{_config.UserEmail}' & bật Tự gia hạn phiên DPAPI 24/7.");
                dlg.DialogResult = true;
                await SyncCloudAsync(silent: false);
            }
            catch (Exception ex)
            {
                errTb.Text = $"Đăng nhập thất bại: {ex.Message}";
                okBtn.IsEnabled = true;
            }
        });
        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(okBtn);
        root.Children.Add(btnRow);

        dlg.Loaded += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbEmail.Text)) tbEmail.Focus();
            else pbPass.Focus();
        };

        dlg.Content = root;
        dlg.ShowDialog();
    }

    internal void OpenAssistedOnboardingDialog(ViaWorkspaceEntry via)
    {
        var dlg = new Window
        {
            Title = $"🧭 Bàn Khai Sinh 60 Giây (Assisted Onboarding) • {via.Label}",
            Width = 650,
            MaxHeight = 770,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var existing = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        var envProf = ResolveViaEnvironmentProfileFor(via);
        var reqSess = Math.Clamp(_config.AutoEmbryoRequiredSessions, 2, 10);
        var preBakeCnt = (_config.ViaPreBakeSessionCounts != null && _config.ViaPreBakeSessionCounts.TryGetValue(via.ViaId, out var pb)) ? pb : 0;
        var proxyDisp = string.IsNullOrWhiteSpace(via.NetworkLabel) ? "Direct IP" : AutomationQueueEngine.ExtractProxyHostPort(via.NetworkLabel);

        var root = new StackPanel { Margin = new Thickness(20) };

        // Readiness top banner
        var bannerStack = new StackPanel();
        bannerStack.Children.Add(new TextBlock
        {
            Text = $"🥚 Trạng thái Phôi: Đã ủ {preBakeCnt}/{reqSess} phiên Cookie sạch • {via.ProfileDir} • {proxyDisp} • {envProf.ViewportLabel} ({envProf.CountryCode})",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12.5,
            FontWeight = FontWeights.Bold,
            Foreground = preBakeCnt >= reqSess ? ThemeTokens.SuccessText : ThemeTokens.AccentText,
            TextWrapping = TextWrapping.Wrap,
        });
        bannerStack.Children.Add(new TextBlock
        {
            Text = "Quy trình 90% Auto: Trình duyệt đã có Cookie nền sạch. Bạn tự tay đăng ký / xác minh OTP chính chủ trên Chrome vừa mở, dán mã 2FA vào bên dưới để xem OTP live rồi bấm 1 nút Hoàn Tất Khai Sinh.",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 11.5,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 4, 0, 0),
        });
        var bannerCard = UiComponents.CreateCard(bannerStack, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        bannerCard.Margin = new Thickness(0, 0, 0, 10);
        root.Children.Add(bannerCard);

        // Input fields declared before launch actions
        var tbRecEmail = UiComponents.CreateTextBox(existing.RecoveryEmail, "vd: agency.backup01@gmail.com hoặc mail domain riêng");
        var tbEmailPass = UiComponents.CreateTextBox(existing.EmailPassword, "Mật khẩu hộp thư (mã hóa DPAPI)");
        tbEmailPass.FontFamily = ThemeTokens.MonoFont;
        var tbEmail2Fa = UiComponents.CreateTextBox(existing.EmailTwoFaSecret, "Secret 2FA Mail (Base32)");
        tbEmail2Fa.FontFamily = ThemeTokens.MonoFont;
        var tbFbUid = UiComponents.CreateTextBox(via.ExternalReferenceId, "Để trống để tự đọc c_user từ Cookie khi thu");
        tbFbUid.FontFamily = ThemeTokens.MonoFont;
        var tbFb2Fa = UiComponents.CreateTextBox(!string.IsNullOrWhiteSpace(existing.TwoFaSecret) ? existing.TwoFaSecret : via.TwoFaSecret, "Secret 2FA Facebook (Base32)");
        tbFb2Fa.FontFamily = ThemeTokens.MonoFont;
        var tbBackupCodes = UiComponents.CreateTextBox(existing.BackupCodesRaw, "Mỗi dòng 1 mã dự phòng 8 số Facebook / Google...", multiline: true, height: 68);
        tbBackupCodes.FontFamily = ThemeTokens.MonoFont;

        // 3 Quick Launch Buttons
        var launchRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 12) };
        var btnLaunchMail = UiComponents.CreateButton("🌐 1. Mở Webmail / Gmail Sạch", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            var url = string.IsNullOrWhiteSpace(tbRecEmail.Text)
                ? "https://accounts.google.com/"
                : LocalSecretVaultStore.ResolveWebmailUrl(tbRecEmail.Text);
            LaunchViaChromeSafe(via, url);
            AppendLog($"🧭 [Khai Sinh 60s] Đã mở '{url}' cho '{via.Label}' ({via.ProfileDir}).");
        });
        btnLaunchMail.Margin = new Thickness(0, 0, 8, 6);
        launchRow.Children.Add(btnLaunchMail);

        var btnLaunchFb = UiComponents.CreateButton("📘 2. Mở Facebook Trang Chủ", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            LaunchViaChromeSafe(via, "https://www.facebook.com/");
            AppendLog($"📘 [Khai Sinh 60s] Đã mở Facebook trên '{via.Label}' ({via.ProfileDir}).");
        });
        btnLaunchFb.Margin = new Thickness(0, 0, 8, 6);
        launchRow.Children.Add(btnLaunchFb);

        var btnLaunch2Fa = UiComponents.CreateButton("🔐 3. Mở Bật 2FA Facebook", ButtonVariant.Secondary, compact: true, onClick: (_, _) =>
        {
            LaunchViaChromeSafe(via, "https://accountscenter.facebook.com/password_and_security");
            AppendLog($"🔐 [Khai Sinh 60s] Đã mở Cài đặt Bảo mật/2FA Facebook trên '{via.Label}'.");
        });
        btnLaunch2Fa.Margin = new Thickness(0, 0, 8, 6);
        launchRow.Children.Add(btnLaunch2Fa);

        if (!string.IsNullOrWhiteSpace(_config.AutoEmbryoCustomDomain))
        {
            var btnSuggestMail = UiComponents.CreateButton($"✨ Gợi ý Mail @{_config.AutoEmbryoCustomDomain.TrimStart('@')}", ButtonVariant.Subtle, compact: true, onClick: (_, _) =>
            {
                var idxSeed = Math.Max(1, _vias.FindIndex(x => string.Equals(x.ViaId, via.ViaId, StringComparison.OrdinalIgnoreCase)) + 1);
                var sug = AutoEmbryoFactoryPlanner.SuggestAgencyDomainEmail(_config.AutoEmbryoCustomDomain, idxSeed, DateTimeOffset.Now);
                if (!string.IsNullOrWhiteSpace(sug)) tbRecEmail.Text = sug;
            });
            btnSuggestMail.Margin = new Thickness(0, 0, 0, 6);
            launchRow.Children.Add(btnSuggestMail);
        }
        root.Children.Add(launchRow);

        // Two-column layout: Mail & Mail Pass
        var mailGrid = new Grid();
        mailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        mailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        mailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var bMail = BuildLabeledBox("Email Khôi phục / Chính chủ", tbRecEmail);
        var bMailPass = BuildLabeledBox("Mật khẩu Email (DPAPI)", tbEmailPass);
        Grid.SetColumn(bMail, 0);
        Grid.SetColumn(bMailPass, 2);
        mailGrid.Children.Add(bMail);
        mailGrid.Children.Add(bMailPass);
        root.Children.Add(mailGrid);

        // Email 2FA + Live OTP
        var mail2FaWrap = BuildLabeledBox("Secret 2FA Email (Base32 - Tùy chọn)", tbEmail2Fa);
        mail2FaWrap.Margin = new Thickness(0, 8, 0, 0);
        root.Children.Add(mail2FaWrap);

        var mailOtpTxt = new TextBlock
        {
            Text = "OTP Mail: —",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 10, 0),
        };
        void RefreshMailOtp()
        {
            var r = TotpService.ComputeTotp(tbEmail2Fa.Text);
            mailOtpTxt.Text = r.Valid ? $"OTP Mail: {r.FormattedCode} ({r.SecondsRemaining}s)" : "OTP Mail: Chưa gắn";
            mailOtpTxt.Foreground = r.Valid ? ThemeTokens.SuccessText : ThemeTokens.TextMuted;
        }
        tbEmail2Fa.TextChanged += (_, _) => RefreshMailOtp();
        RefreshMailOtp();
        var copyMailOtpBtn = UiComponents.CreateButton("Copy OTP Mail", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(tbEmail2Fa.Text);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        var mailOtpRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 5, 0, 0) };
        mailOtpRow.Children.Add(mailOtpTxt);
        mailOtpRow.Children.Add(copyMailOtpBtn);
        root.Children.Add(mailOtpRow);

        // Two-column: FB UID & FB 2FA
        var fbGrid = new Grid { Margin = new Thickness(0, 10, 0, 0) };
        fbGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        fbGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        fbGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var bUid = BuildLabeledBox("Facebook UID (tự lấy từ Cookie)", tbFbUid);
        var bFb2Fa = BuildLabeledBox("Secret 2FA Facebook (Base32)", tbFb2Fa);
        Grid.SetColumn(bUid, 0);
        Grid.SetColumn(bFb2Fa, 2);
        fbGrid.Children.Add(bUid);
        fbGrid.Children.Add(bFb2Fa);
        root.Children.Add(fbGrid);

        var fbOtpTxt = new TextBlock
        {
            Text = "OTP Facebook: —",
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 10, 0),
        };
        void RefreshFbOtp()
        {
            var r = TotpService.ComputeTotp(tbFb2Fa.Text);
            fbOtpTxt.Text = r.Valid ? $"🔑 OTP FB Live: {r.FormattedCode} ({r.SecondsRemaining}s)" : "🔑 OTP FB Live: Dán Base32 để lấy 6 số xác nhận khi bật 2FA";
            fbOtpTxt.Foreground = r.Valid ? ThemeTokens.AccentText : ThemeTokens.TextMuted;
        }
        tbFb2Fa.TextChanged += (_, _) => RefreshFbOtp();
        RefreshFbOtp();
        var copyFbOtpBtn = UiComponents.CreateButton("Copy 6 số FB", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(tbFb2Fa.Text);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        var fbOtpRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
        fbOtpRow.Children.Add(fbOtpTxt);
        fbOtpRow.Children.Add(copyFbOtpBtn);
        root.Children.Add(fbOtpRow);

        var backupWrap = BuildLabeledBox("10 Mã Dự Phòng 8 Số (Backup Codes)", tbBackupCodes);
        backupWrap.Margin = new Thickness(0, 10, 0, 0);
        root.Children.Add(backupWrap);

        var statusTxt = new TextBlock
        {
            Text = "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.DangerText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0),
            Visibility = Visibility.Collapsed,
        };
        root.Children.Add(statusTxt);

        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancelBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 10, 0);

        Button finishBtn = null!;
        finishBtn = UiComponents.CreateButton(
            "✅ Hoàn Tất Khai Sinh: Gom Cookie + Lưu Két + Ấp 7 Ngày",
            ButtonVariant.Primary,
            FluentIcons.CheckCircle,
            onClick: async (_, _) =>
            {
                finishBtn.IsEnabled = false;
                statusTxt.Visibility = Visibility.Collapsed;
                try
                {
                    // 1. Harvest active Facebook cookies via CDP if Chrome is open
                    string harvestedCookie = "";
                    var openSess = ChromeSessionTracker.Default.GetSnapshot()
                        .FirstOrDefault(s => s.Alive && s.CdpPort is > 0 &&
                            ((!string.IsNullOrWhiteSpace(via.ViaId) && string.Equals(s.ViaId, via.ViaId, StringComparison.OrdinalIgnoreCase)) ||
                             (!string.IsNullOrWhiteSpace(via.Label) && string.Equals(s.ViaLabel, via.Label, StringComparison.OrdinalIgnoreCase)) ||
                             (!string.IsNullOrWhiteSpace(via.ProfileDir) && string.Equals(s.ProfileDir, via.ProfileDir, StringComparison.OrdinalIgnoreCase))));
                    if (openSess?.CdpPort is int cdpPortVal && cdpPortVal > 0)
                    {
                        harvestedCookie = await ChromeCdpController.TryHarvestFacebookCookieHeaderAsync(cdpPortVal, 2500) ?? "";
                    }

                    var finalCookie = !string.IsNullOrWhiteSpace(harvestedCookie) ? harvestedCookie : existing.CookieRaw;
                    var uidVal = tbFbUid.Text.Trim();
                    if (string.IsNullOrWhiteSpace(uidVal) && !string.IsNullOrWhiteSpace(finalCookie))
                    {
                        var um = System.Text.RegularExpressions.Regex.Match(finalCookie, @"(?:^|;\s*)c_user=(\d+)");
                        if (um.Success) uidVal = um.Groups[1].Value;
                    }

                    // 2. Save 6-layer secrets locally via DPAPI
                    LocalSecretVaultStore.Default.UpsertFull(
                        via.ViaId,
                        via.Label,
                        via.ProfileDir,
                        finalCookie,
                        tbFb2Fa.Text.Trim(),
                        tbRecEmail.Text.Trim(),
                        tbEmailPass.Text.Trim(),
                        tbEmail2Fa.Text.Trim(),
                        tbBackupCodes.Text.Trim(),
                        allowOverwriteEmpty: true);

                    // 3. Hand off to 7-Day Standby Incubation Pipeline ("soak_72h")
                    var nowIso = DateTimeOffset.UtcNow.ToString("O");
                    _config.ViaCustomTags ??= new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    _config.ViaCustomTags[via.ViaId] = "🐣 Đang Ấp 7 Ngày";
                    _config.Save();

                    if (!string.IsNullOrWhiteSpace(_config.GetJwt()) &&
                        !via.ViaId.StartsWith("local-embryo-", StringComparison.OrdinalIgnoreCase))
                    {
                        var builtNotes = ViaMetadataParser.BuildNotes(
                            via.CleanNotes,
                            "standby",
                            nowIso,
                            via.ClientGroup,
                            "soak_72h",
                            via.AntidetectEngine,
                            via.AntidetectProfileId);
                        await _api.UpdatePersonalAccountAsync(via.ViaId, new PersonalAccountUpsertRequestDto
                        {
                            Label = via.Label,
                            DisplayName = string.IsNullOrWhiteSpace(via.DisplayName) ? via.Label : via.DisplayName,
                            ExternalReferenceId = string.IsNullOrWhiteSpace(uidVal) ? null : uidVal,
                            Status = "active",
                            BrowserProfileLabel = string.IsNullOrWhiteSpace(via.BrowserProfileLabel) ? via.ProfileDir : via.BrowserProfileLabel,
                            NetworkLabel = via.NetworkLabel,
                            VaultReference = "Két DPAPI Local 6 Lớp (Desktop)",
                            Notes = builtNotes,
                        });
                        await SyncCloudAsync(silent: true);
                    }
                    else
                    {
                        via.RoleTier = "standby";
                        via.DefaultWarmupMode = "soak_72h";
                        via.WarmupStartIso = nowIso;
                        if (!string.IsNullOrWhiteSpace(uidVal)) via.ExternalReferenceId = uidVal;
                        via.HasVaultCookie = !string.IsNullOrWhiteSpace(finalCookie);
                        via.HasLocalTwoFa = !string.IsNullOrWhiteSpace(tbFb2Fa.Text);
                        via.TwoFaSecret = tbFb2Fa.Text.Trim();
                    }

                    var cookieTag = !string.IsNullOrWhiteSpace(harvestedCookie)
                        ? "Đã tự gom Cookie FB mới"
                        : (!string.IsNullOrWhiteSpace(finalCookie) ? "Giữ Cookie DPAPI hiện có" : "Chưa bắt được Cookie FB (mở FB rồi bấm Thu Cookie sau)");
                    AppendLog($"🎉 [Hoàn Tất Khai Sinh] '{via.Label}' -> {cookieTag} • Lưu Két 6 Lớp • Đưa vào Lò Ấp 7 Ngày (soak_72h)!");
                    _tray?.ShowBalloon("🎉 Hoàn Tất Khai Sinh 60s!", $"'{via.Label}' đã lưu Két 6 Lớp & tự động đưa vào Lò Ấp 7 Ngày.", 4500, error: false);
                    PushOverviewStateToWebView();
                    dlg.DialogResult = true;
                }
                catch (Exception ex)
                {
                    statusTxt.Text = $"Lỗi lưu Khai Sinh: {ex.Message}";
                    statusTxt.Visibility = Visibility.Visible;
                    finishBtn.IsEnabled = true;
                }
            });

        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(finishBtn);
        root.Children.Add(btnRow);

        var onboardOtpTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        onboardOtpTimer.Tick += (_, _) =>
        {
            RefreshFbOtp();
            RefreshMailOtp();
        };
        onboardOtpTimer.Start();
        dlg.Closed += (_, _) => onboardOtpTimer.Stop();

        dlg.Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 730, Content = root };
        dlg.ShowDialog();
    }

    private void OpenGoogleAdsScriptSetupDialog()
    {
        var dlg = new Window
        {
            Title = "📜 Kết Nối Google Ads Zero-Risk (2 MCC + 5 Gmail Khách Độc Lập)",
            Width = 760,
            MaxHeight = 780,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dlg);

        var root = new StackPanel { Margin = new Thickness(20) };

        root.Children.Add(new TextBlock
        {
            Text = "Cách ly rủi ro 100%: Không nối 5 Gmail khách hàng lẻ vào MCC, không chèn bất kỳ automation script nào lên ads.google.com — Dán Official Google Ads Script bên dưới chạy Hàng giờ để tự động đồng bộ Chi tiêu, Ngân sách & Cảnh báo Đỏ về AdsOps + Telegram!",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var statusBanner = new TextBlock
        {
            Text = "⏳ Đang tải cấu hình & khóa Webhook riêng của Workspace từ Cloud...",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.AccentText,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
        };
        root.Children.Add(statusBanner);

        var tbMccScript = UiComponents.CreateTextBox("", "Đang tải Google Ads MCC Script...", multiline: true, height: 155);
        tbMccScript.FontFamily = ThemeTokens.MonoFont;
        tbMccScript.IsReadOnly = true;

        var tbSingleScript = UiComponents.CreateTextBox("", "Đang tải Google Ads Standalone Script...", multiline: true, height: 155);
        tbSingleScript.FontFamily = ThemeTokens.MonoFont;
        tbSingleScript.IsReadOnly = true;

        // Tab 1: MCC Script (for 2 MCCs)
        var mccHdr = new Grid { Margin = new Thickness(0, 4, 0, 4) };
        mccHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        mccHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        mccHdr.Children.Add(new TextBlock
        {
            Text = "🔷 BƯỚC 1 (Cho 2 MCC): Dán vào Công cụ -> Hành động hàng loạt -> Tập lệnh trên từng MCC",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var btnCopyMcc = UiComponents.CreateButton("📋 Copy Mã MCC", ButtonVariant.Primary, compact: true, onClick: (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbMccScript.Text)) return;
            Clipboard.SetText(tbMccScript.Text);
            AppendLog("📋 Đã copy mã Google Ads MCC Script vào Clipboard.");
            MessageBox.Show(dlg, "Đã copy mã MCC Script! Dán vào từng tài khoản MCC (chọn lịch chạy Hàng giờ).", "Đã Copy", MessageBoxButton.OK, MessageBoxImage.Information);
        });
        Grid.SetColumn(btnCopyMcc, 1);
        mccHdr.Children.Add(btnCopyMcc);
        root.Children.Add(mccHdr);
        root.Children.Add(tbMccScript);

        // Tab 2: Standalone Script (for 5 independent client Gmails)
        var singleHdr = new Grid { Margin = new Thickness(0, 12, 0, 4) };
        singleHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        singleHdr.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        singleHdr.Children.Add(new TextBlock
        {
            Text = "🟢 BƯỚC 2 (Cho 5 Gmail Khách Độc Lập 1:1): Dán riêng vào từng TKQC (Không nối MCC)",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.SuccessText,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var btnCopySingle = UiComponents.CreateButton("📋 Copy Mã Gmail Lẻ", ButtonVariant.Primary, compact: true, onClick: (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(tbSingleScript.Text)) return;
            Clipboard.SetText(tbSingleScript.Text);
            AppendLog("📋 Đã copy mã Google Ads Standalone Script vào Clipboard.");
            MessageBox.Show(dlg, "Đã copy mã Standalone Script! Mở từng Gmail khách bằng Chrome Sạch 1:1 -> Tập lệnh -> Dán & đặt lịch Hàng giờ.", "Đã Copy", MessageBoxButton.OK, MessageBoxImage.Information);
        });
        Grid.SetColumn(btnCopySingle, 1);
        singleHdr.Children.Add(btnCopySingle);
        root.Children.Add(singleHdr);
        root.Children.Add(tbSingleScript);

        void ApplyConfigDto(GoogleAdsScriptConfigDto dto)
        {
            tbMccScript.Text = dto.MccScriptCode ?? "";
            tbSingleScript.Text = dto.SingleAccountScriptCode ?? "";
            var pushInfo = string.IsNullOrWhiteSpace(dto.LastPushAt)
                ? "Chưa nhận gói đẩy nào"
                : $"Lần đẩy gần nhất: {AlertItemDto.FormatIsoTimestampLocal(dto.LastPushAt, dto.LastPushAt!)}";
            statusBanner.Text = $"✓ Khóa Webhook: {dto.KeyMasked} • Đã đồng bộ {dto.SyncedAccountsCount} TKQC Google Ads • {pushInfo}";
            statusBanner.Foreground = ThemeTokens.SuccessText;
        }

        async Task LoadConfigAsync()
        {
            if (string.IsNullOrWhiteSpace(_config.GetJwt()))
            {
                statusBanner.Text = "⚠️ Chưa đăng nhập AdsOps Cloud — Hãy đăng nhập để nhận Khóa Webhook thật của Workspace.";
                statusBanner.Foreground = ThemeTokens.WarningText;
                tbMccScript.Text = "// Đăng nhập AdsOps Cloud để lấy mã Google Ads MCC Script kèm Key bảo mật riêng.";
                tbSingleScript.Text = "// Đăng nhập AdsOps Cloud để lấy mã Google Ads Standalone Script kèm Key bảo mật riêng.";
                return;
            }
            try
            {
                var cfgDto = await _api.GetGoogleAdsScriptConfigAsync();
                ApplyConfigDto(cfgDto);
            }
            catch (Exception ex)
            {
                statusBanner.Text = $"❌ Chưa tải được cấu hình từ Cloud: {ex.Message}";
                statusBanner.Foreground = ThemeTokens.DangerText;
            }
        }

        var btnRow = new Grid { Margin = new Thickness(0, 14, 0, 0) };
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var rotateBtn = UiComponents.CreateButton("🔄 Đổi Khóa Webhook Mới", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
        {
            if (!UiComponents.ShowConfirmActionDialog(
                dlg,
                "Đổi Khóa Google Ads Webhook",
                "Tạo khóa X-AdsOps-Ingest-Key mới?",
                new (string, string)[] { ("Lưu ý:", "Sau khi đổi khóa, cần dán lại đoạn mã mới vào các Google Ads Script đang chạy.") },
                "Dùng khi nghi ngờ lộ khóa Ingest.",
                "Xác nhận Đổi Khóa",
                isDanger: true))
            {
                return;
            }
            try
            {
                var cfgNew = await _api.RotateGoogleAdsIngestKeyAsync();
                ApplyConfigDto(cfgNew);
                AppendLog($"🔑 Đã cấp mới khóa Webhook Google Ads ({cfgNew.KeyMasked}).");
            }
            catch (Exception ex)
            {
                MessageBox.Show(dlg, $"Lỗi đổi khóa (chỉ Chủ sở hữu Workspace được phép): {ex.Message}", "Không thể đổi khóa", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        });
        Grid.SetColumn(rotateBtn, 0);

        var rightBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var syncBtn = UiComponents.CreateButton("🔁 Làm mới Bảng TKQC", ButtonVariant.Secondary, compact: true, onClick: async (_, _) =>
        {
            await SyncCloudAsync(silent: false);
            await LoadConfigAsync();
        });
        syncBtn.Margin = new Thickness(0, 0, 8, 0);
        var closeBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Primary, onClick: (_, _) => dlg.Close());
        rightBtns.Children.Add(syncBtn);
        rightBtns.Children.Add(closeBtn);
        Grid.SetColumn(rightBtns, 2);

        btnRow.Children.Add(rotateBtn);
        btnRow.Children.Add(rightBtns);
        root.Children.Add(btnRow);

        dlg.Loaded += async (_, _) => await LoadConfigAsync();
        dlg.Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 740, Content = root };
        dlg.ShowDialog();
    }
}
