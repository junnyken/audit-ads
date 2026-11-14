using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;

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
            if (string.IsNullOrWhiteSpace(pb1.Password) || pb1.Password.Length < 4)
            {
                errTb.Text = "Mật khẩu cần tối thiểu 4 ký tự.";
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
}
