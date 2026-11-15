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
        void RefreshProxyDupWarning()
        {
            var hostPort = AutomationQueueEngine.ExtractProxyHostPort(tbProxy.Text);
            if (string.IsNullOrWhiteSpace(hostPort))
            {
                proxyDupHint.Visibility = Visibility.Collapsed;
                return;
            }
            var collisions = _vias.Where(v =>
                !string.Equals(v.ViaId, existing?.ViaId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(AutomationQueueEngine.ExtractProxyHostPort(v.NetworkLabel), hostPort, StringComparison.OrdinalIgnoreCase))
                .Select(v => v.Label)
                .ToList();
            if (collisions.Count > 0)
            {
                proxyDupHint.Text = $"⚠ Cảnh báo trùng IP Proxy ({hostPort}) với Via khác: {string.Join(", ", collisions)}. Dễ gây Checkpoint chéo khi mở nhiều Profile!";
                proxyDupHint.Visibility = Visibility.Visible;
            }
            else
            {
                proxyDupHint.Visibility = Visibility.Collapsed;
            }
        }
        tbProxy.TextChanged += (_, _) => RefreshProxyDupWarning();
        RefreshProxyDupWarning();
        root.Children.Add(proxyDupHint);

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
                var nextWarmupIso = wmTag switch
                {
                    "now" => DateTimeOffset.UtcNow.ToString("O"),
                    "clear" => "",
                    _ => existing?.WarmupStartIso ?? "",
                };

                var builtNotes = ViaMetadataParser.BuildNotes(tbNotes.Text.Trim(), tierTag, nextWarmupIso);
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
            Title = $"Két DPAPI Local • {via.Label}",
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

        var existing = LocalSecretVaultStore.Default.Find(via.ViaId, via.ProfileDir, via.Label);
        var root = new StackPanel { Margin = new Thickness(20) };

        root.Children.Add(new TextBlock
        {
            Text = $"Hồ sơ Chrome: {via.ProfileDir} • Mã hóa Windows DPAPI gắn theo user Windows hiện tại.",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var tb2Fa = UiComponents.CreateTextBox(!string.IsNullOrWhiteSpace(existing.TwoFaSecret) ? existing.TwoFaSecret : via.TwoFaSecret, "Mã 2FA Base32");
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
        var copyOtpBtn = UiComponents.CreateButton("Copy 6 số", ButtonVariant.Secondary, FluentIcons.Copy, compact: true, onClick: (_, _) =>
        {
            var r = TotpService.ComputeTotp(tb2Fa.Text);
            if (r.Valid) Clipboard.SetText(r.Code6);
        });
        copyOtpBtn.Margin = new Thickness(0, 6, 0, 0);
        copyOtpBtn.HorizontalAlignment = HorizontalAlignment.Left;
        otpPanel.Children.Add(copyOtpBtn);

        root.Children.Add(BuildLabeledBox("Secret 2FA (Base32)", tb2Fa));
        var previewCard = UiComponents.CreateCard(otpPanel, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault);
        previewCard.Margin = new Thickness(0, 8, 0, 10);
        root.Children.Add(previewCard);

        var tbCookie = UiComponents.CreateTextBox(existing.CookieRaw, "c_user=...; xs=...", multiline: true, height: 96);
        tbCookie.FontFamily = ThemeTokens.MonoFont;
        root.Children.Add(BuildLabeledBox("Cookie Facebook (Lưu cục bộ DPAPI)", tbCookie));

        var btnRow = new Grid { Margin = new Thickness(0, 16, 0, 0) };
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var wipeBtn = UiComponents.CreateButton("Xóa trắng Két này", ButtonVariant.Danger, FluentIcons.Delete, onClick: (_, _) =>
        {
            var confirm = UiComponents.ShowConfirmActionDialog(
                dlg,
                "Xác nhận xóa Cookie & 2FA Local",
                $"Xóa toàn bộ Cookie và Secret 2FA lưu trên máy cho Via '{via.Label}'.",
                new (string, string)[] { ("Via:", via.Label), ("Profile:", via.ProfileDir) },
                "Hành động này chỉ xóa trên DPAPI Vault của máy tính này, không đụng dữ liệu Cloud.",
                "Xóa trắng Local",
                isDanger: true);
            if (!confirm) return;
            LocalSecretVaultStore.Default.Upsert(via.ViaId, via.Label, via.ProfileDir, "", "", allowOverwriteEmpty: true);
            via.TwoFaSecret = "";
            AppendLog($"Đã xóa Cookie & 2FA local cho Via '{via.Label}'.");
            dlg.DialogResult = true;
            RenderCurrentView();
        });
        btnRow.Children.Add(wipeBtn);

        var rightBtns = new StackPanel { Orientation = Orientation.Horizontal };
        var cancelBtn = UiComponents.CreateButton("Đóng", ButtonVariant.Secondary, onClick: (_, _) => dlg.Close());
        cancelBtn.Margin = new Thickness(0, 0, 8, 0);
        var saveBtn = UiComponents.CreateButton("Lưu Két Local", ButtonVariant.Primary, FluentIcons.CheckCircle, onClick: (_, _) =>
        {
            LocalSecretVaultStore.Default.Upsert(via.ViaId, via.Label, via.ProfileDir, tbCookie.Text.Trim(), tb2Fa.Text.Trim(), allowOverwriteEmpty: true);
            via.TwoFaSecret = TotpService.NormalizeBase32Secret(tb2Fa.Text);
            AppendLog($"Đã lưu Két DPAPI local cho Via '{via.Label}'.");
            dlg.DialogResult = true;
            RenderCurrentView();
        });
        rightBtns.Children.Add(cancelBtn);
        rightBtns.Children.Add(saveBtn);
        Grid.SetColumn(rightBtns, 2);
        btnRow.Children.Add(rightBtns);

        root.Children.Add(btnRow);
        dlg.Content = root;
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
                var prof = ExtensionProvisioner.ResolveProfileDirectory(page.HolderBrowserProfile, page.HolderLabel);
                var res = await _api.PublishWarmupPostAsync(page.Id, tbMsg.Text.Trim(), page.HolderIdentityId ?? "", page.HolderLabel ?? "", prof);
                AppendLog($"Đã gửi bài Warmup cho Page '{page.Name}' ({res.DeliveryMode}).");
                if (res.DeliveryMode != "graph_api")
                {
                    var holderVia = _vias.FirstOrDefault(v => string.Equals(v.ViaId, page.HolderIdentityId, StringComparison.OrdinalIgnoreCase));
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
                wmIso);

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
            int failed = 0;

            foreach (var r in targets)
            {
                statusTb.Foreground = ThemeTokens.AccentText;
                statusTb.Text = $"Đang nhập {created + failed + 1}/{targets.Count}: {r.Label} ({r.AssignedProfile})...";
                try
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
                catch (Exception ex)
                {
                    failed++;
                    AppendLog($"Nhập Lô dòng #{r.RowNumber} ({r.Label}) lỗi: {ex.Message}");
                }
            }

            AppendLog($"Nhập Lô hoàn tất: thành công {created}/{targets.Count} Via" + (failed > 0 ? $", lỗi {failed}." : "."));
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
}
