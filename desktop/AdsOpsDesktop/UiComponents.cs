using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;

namespace AdsOpsDesktop;

internal enum ButtonVariant
{
    Primary,
    Secondary,
    Success,
    Danger,
    Subtle,
}

/// <summary>
/// Reusable, dark-themed WPF UI primitives built strictly from ThemeTokens (no white Win32 artifacts).
/// </summary>
internal static class UiComponents
{
    public static TextBlock CreateIcon(string glyph, double size = 14, Brush? brush = null)
    {
        return new TextBlock
        {
            Text = glyph,
            FontFamily = ThemeTokens.IconFont,
            FontSize = size,
            Foreground = brush ?? ThemeTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
    }

    public static Button CreateButton(
        string text,
        ButtonVariant variant = ButtonVariant.Secondary,
        string? iconGlyph = null,
        bool compact = false,
        RoutedEventHandler? onClick = null,
        string? tooltip = null)
    {
        var (bg, bgHover, fg, border) = variant switch
        {
            ButtonVariant.Primary => (ThemeTokens.AccentPrimary, ThemeTokens.AccentPrimaryHover, ThemeTokens.TextWhite, ThemeTokens.AccentPrimary),
            ButtonVariant.Success => (ThemeTokens.SuccessSolid, ThemeTokens.SuccessSolidHover, ThemeTokens.TextWhite, ThemeTokens.SuccessSolid),
            ButtonVariant.Danger => (ThemeTokens.DangerSolid, ThemeTokens.DangerSolidHover, ThemeTokens.TextWhite, ThemeTokens.DangerSolid),
            ButtonVariant.Subtle => (Brushes.Transparent, ThemeTokens.BgSurfaceHover, ThemeTokens.TextSecondary, Brushes.Transparent),
            _ => (ThemeTokens.BgSurfaceElevated, ThemeTokens.BgSurfaceHover, ThemeTokens.TextPrimary, ThemeTokens.BorderDefault),
        };

        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        if (!string.IsNullOrEmpty(iconGlyph))
        {
            var icon = CreateIcon(iconGlyph, compact ? 13 : 14, fg);
            if (!string.IsNullOrEmpty(text))
            {
                icon.Margin = new Thickness(0, 0, 6, 0);
            }
            panel.Children.Add(icon);
        }

        if (!string.IsNullOrEmpty(text))
        {
            panel.Children.Add(new TextBlock
            {
                Text = text,
                FontFamily = ThemeTokens.UiFont,
                FontSize = compact ? 12 : 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = fg,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var btn = new Button
        {
            Content = panel,
            Background = bg,
            Foreground = fg,
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            Padding = compact ? new Thickness(10, 5, 10, 5) : new Thickness(14, 7, 14, 7),
            MinHeight = compact ? 28 : 34,
            Cursor = Cursors.Hand,
            FocusVisualStyle = null,
            Template = BuildButtonTemplate(bg, bgHover, border, compact ? 6 : 8),
        };

        if (!string.IsNullOrWhiteSpace(tooltip))
        {
            btn.ToolTip = tooltip;
        }

        if (onClick != null)
        {
            btn.Click += onClick;
        }

        return btn;
    }

    private static ControlTemplate BuildButtonTemplate(Brush normalBg, Brush hoverBg, Brush borderBrush, double radius)
    {
        var template = new ControlTemplate(typeof(Button));
        var borderFactory = new FrameworkElementFactory(typeof(Border));
        borderFactory.Name = "Bd";
        borderFactory.SetValue(Border.BackgroundProperty, normalBg);
        borderFactory.SetValue(Border.BorderBrushProperty, borderBrush);
        borderFactory.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(radius));
        borderFactory.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));
        borderFactory.SetValue(Border.SnapsToDevicePixelsProperty, true);

        var presenterFactory = new FrameworkElementFactory(typeof(ContentPresenter));
        presenterFactory.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        presenterFactory.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        borderFactory.AppendChild(presenterFactory);
        template.VisualTree = borderFactory;

        var hoverTrigger = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        hoverTrigger.Setters.Add(new Setter(Border.BackgroundProperty, hoverBg, "Bd"));
        template.Triggers.Add(hoverTrigger);

        var pressedTrigger = new Trigger { Property = ButtonBase.IsPressedProperty, Value = true };
        pressedTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.85, "Bd"));
        template.Triggers.Add(pressedTrigger);

        var disabledTrigger = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabledTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
        template.Triggers.Add(disabledTrigger);

        return template;
    }

    public static Border CreateCard(UIElement child, Thickness? padding = null, Brush? bg = null, Brush? border = null)
    {
        return new Border
        {
            Background = bg ?? ThemeTokens.BgSurface,
            BorderBrush = border ?? ThemeTokens.BorderSubtle,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = padding ?? new Thickness(14),
            Child = child,
        };
    }

    public static Border CreateBadgePill(string text, Brush fg, Brush bg, Brush border, string? iconGlyph = null)
    {
        var sp = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!string.IsNullOrEmpty(iconGlyph))
        {
            var ic = CreateIcon(iconGlyph, 12, fg);
            ic.Margin = new Thickness(0, 0, 5, 0);
            sp.Children.Add(ic);
        }

        sp.Children.Add(new TextBlock
        {
            Text = text,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = fg,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return new Border
        {
            Background = bg,
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(8, 3, 8, 3),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = sp,
        };
    }

    public static Button CreateFilterChip(string label, bool active, RoutedEventHandler onClick)
    {
        var bg = active ? ThemeTokens.InfoBg : ThemeTokens.BgSurfaceElevated;
        var bgHover = active ? ThemeTokens.BgNavActive : ThemeTokens.BgSurfaceHover;
        var border = active ? ThemeTokens.InfoBorder : ThemeTokens.BorderSubtle;
        var fg = active ? ThemeTokens.AccentText : ThemeTokens.TextSecondary;

        var tb = new TextBlock
        {
            Text = label,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal,
            Foreground = fg,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var btn = new Button
        {
            Content = tb,
            Background = bg,
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(11, 5, 11, 5),
            MinHeight = 28,
            Margin = new Thickness(0, 0, 6, 0),
            Cursor = Cursors.Hand,
            FocusVisualStyle = null,
            Template = BuildButtonTemplate(bg, bgHover, border, 14),
        };
        btn.Click += onClick;
        return btn;
    }

    public static Border CreateMetricCard(
        string title,
        string initialValue,
        string initialSub,
        string iconGlyph,
        Brush accentBrush,
        out TextBlock valueBlock,
        out TextBlock subBlock)
    {
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var topRow = new Grid();
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleTb = new TextBlock
        {
            Text = title,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        topRow.Children.Add(titleTb);

        var iconBox = new Border
        {
            Width = 26,
            Height = 26,
            CornerRadius = new CornerRadius(7),
            Background = ThemeTokens.WithAlpha(((SolidColorBrush)accentBrush).Color, 34),
            Child = CreateIcon(iconGlyph, 14, accentBrush),
        };
        Grid.SetColumn(iconBox, 1);
        topRow.Children.Add(iconBox);
        grid.Children.Add(topRow);

        valueBlock = new TextBlock
        {
            Text = initialValue,
            FontFamily = ThemeTokens.MonoFont,
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(0, 6, 0, 2),
        };
        Grid.SetRow(valueBlock, 1);
        grid.Children.Add(valueBlock);

        subBlock = new TextBlock
        {
            Text = initialSub,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 12,
            Foreground = ThemeTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetRow(subBlock, 2);
        grid.Children.Add(subBlock);

        return CreateCard(grid, new Thickness(12, 10, 12, 10));
    }

    public static TextBox CreateTextBox(string initialText = "", string placeholder = "", bool multiline = false, double height = 34)
    {
        var tb = new TextBox
        {
            Text = initialText ?? "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextPrimary,
            CaretBrush = ThemeTokens.TextPrimary,
            Background = ThemeTokens.BgSurfaceElevated,
            BorderBrush = ThemeTokens.BorderDefault,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 6, 10, 6),
            MinHeight = multiline ? Math.Max(68, height) : height,
            AcceptsReturn = multiline,
            TextWrapping = multiline ? TextWrapping.Wrap : TextWrapping.NoWrap,
            VerticalContentAlignment = multiline ? VerticalAlignment.Top : VerticalAlignment.Center,
            VerticalScrollBarVisibility = multiline ? ScrollBarVisibility.Auto : ScrollBarVisibility.Disabled,
            Tag = placeholder,
        };

        var tpl = new ControlTemplate(typeof(TextBox));
        var bd = new FrameworkElementFactory(typeof(Border));
        bd.Name = "Bd";
        bd.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
        bd.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
        bd.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
        bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        bd.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));

        var hostGrid = new FrameworkElementFactory(typeof(Grid));

        var sv = new FrameworkElementFactory(typeof(ScrollViewer));
        sv.Name = "PART_ContentHost";
        sv.SetValue(FrameworkElement.VerticalAlignmentProperty, multiline ? VerticalAlignment.Top : VerticalAlignment.Center);
        hostGrid.AppendChild(sv);

        var wm = new FrameworkElementFactory(typeof(TextBlock));
        wm.Name = "Watermark";
        wm.SetValue(TextBlock.TextProperty, new TemplateBindingExtension(FrameworkElement.TagProperty));
        wm.SetValue(TextBlock.ForegroundProperty, ThemeTokens.TextMuted);
        wm.SetValue(TextBlock.FontSizeProperty, 12.5);
        wm.SetValue(FrameworkElement.MarginProperty, new Thickness(2, 0, 0, 0));
        wm.SetValue(FrameworkElement.VerticalAlignmentProperty, multiline ? VerticalAlignment.Top : VerticalAlignment.Center);
        wm.SetValue(UIElement.IsHitTestVisibleProperty, false);
        wm.SetValue(UIElement.VisibilityProperty, Visibility.Collapsed);
        wm.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        hostGrid.AppendChild(wm);

        bd.AppendChild(hostGrid);
        tpl.VisualTree = bd;

        var emptyTrig = new Trigger { Property = TextBox.TextProperty, Value = "" };
        emptyTrig.Setters.Add(new Setter(UIElement.VisibilityProperty, Visibility.Visible, "Watermark"));
        tpl.Triggers.Add(emptyTrig);

        var focusTrig = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
        focusTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ThemeTokens.BorderFocus, "Bd"));
        tpl.Triggers.Add(focusTrig);

        tb.Template = tpl;
        return tb;
    }

    public static PasswordBox CreatePasswordBox(string initialPassword = "", double height = 34)
    {
        var pb = new PasswordBox
        {
            Password = initialPassword ?? "",
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextPrimary,
            CaretBrush = ThemeTokens.TextPrimary,
            Background = ThemeTokens.BgSurfaceElevated,
            BorderBrush = ThemeTokens.BorderDefault,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 6, 10, 6),
            MinHeight = height,
            VerticalContentAlignment = VerticalAlignment.Center,
        };

        var tpl = new ControlTemplate(typeof(PasswordBox));
        var bd = new FrameworkElementFactory(typeof(Border));
        bd.Name = "Bd";
        bd.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
        bd.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
        bd.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
        bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        bd.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));

        var sv = new FrameworkElementFactory(typeof(ScrollViewer));
        sv.Name = "PART_ContentHost";
        sv.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        bd.AppendChild(sv);
        tpl.VisualTree = bd;

        var focusTrig = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
        focusTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ThemeTokens.BorderFocus, "Bd"));
        tpl.Triggers.Add(focusTrig);

        pb.Template = tpl;
        return pb;
    }

    public static ComboBox CreateComboBox(IEnumerable<ComboBoxItem> items, double minWidth = 150)
    {
        var itemStyle = new Style(typeof(ComboBoxItem));
        itemStyle.Setters.Add(new Setter(Control.BackgroundProperty, ThemeTokens.BgSurfaceElevated));
        itemStyle.Setters.Add(new Setter(Control.ForegroundProperty, ThemeTokens.TextPrimary));
        itemStyle.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(10, 7, 10, 7)));
        itemStyle.Setters.Add(new Setter(Control.FontSizeProperty, 13.0));

        var itemHover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        itemHover.Setters.Add(new Setter(Control.BackgroundProperty, ThemeTokens.BgSurfaceHover));
        itemStyle.Triggers.Add(itemHover);

        var cb = new ComboBox
        {
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextPrimary,
            Background = ThemeTokens.BgSurfaceElevated,
            BorderBrush = ThemeTokens.BorderDefault,
            BorderThickness = new Thickness(1),
            MinHeight = 34,
            MinWidth = minWidth,
            ItemContainerStyle = itemStyle,
            Cursor = Cursors.Hand,
        };

        cb.Resources[SystemColors.WindowBrushKey] = ThemeTokens.BgSurfaceElevated;
        cb.Resources[SystemColors.HighlightBrushKey] = ThemeTokens.AccentPrimary;
        cb.Resources[SystemColors.HighlightTextBrushKey] = ThemeTokens.TextWhite;
        cb.Template = BuildDarkComboTemplate();

        foreach (var item in items)
        {
            cb.Items.Add(item);
        }

        if (cb.Items.Count > 0) cb.SelectedIndex = 0;
        return cb;
    }

    private static ControlTemplate BuildDarkComboTemplate()
    {
        var tpl = new ControlTemplate(typeof(ComboBox));
        var root = new FrameworkElementFactory(typeof(Grid));

        var toggle = new FrameworkElementFactory(typeof(ToggleButton));
        toggle.Name = "ToggleButton";
        toggle.SetValue(Control.BackgroundProperty, ThemeTokens.BgSurfaceElevated);
        toggle.SetValue(Control.BorderBrushProperty, ThemeTokens.BorderDefault);
        toggle.SetValue(Control.BorderThicknessProperty, new Thickness(1));
        toggle.SetValue(ToggleButton.IsCheckedProperty, new System.Windows.Data.Binding("IsDropDownOpen")
        {
            Mode = System.Windows.Data.BindingMode.TwoWay,
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent),
        });

        var toggleTpl = new ControlTemplate(typeof(ToggleButton));
        var toggleBd = new FrameworkElementFactory(typeof(Border));
        toggleBd.SetValue(Border.BackgroundProperty, ThemeTokens.BgSurfaceElevated);
        toggleBd.SetValue(Border.BorderBrushProperty, ThemeTokens.BorderDefault);
        toggleBd.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        toggleBd.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        var toggleGrid = new FrameworkElementFactory(typeof(Grid));
        var arrow = new FrameworkElementFactory(typeof(TextBlock));
        arrow.SetValue(TextBlock.TextProperty, FluentIcons.ChevronDown);
        arrow.SetValue(TextBlock.FontFamilyProperty, ThemeTokens.IconFont);
        arrow.SetValue(TextBlock.FontSizeProperty, 11.0);
        arrow.SetValue(TextBlock.ForegroundProperty, ThemeTokens.TextSecondary);
        arrow.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Right);
        arrow.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        arrow.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 0, 10, 0));
        toggleGrid.AppendChild(arrow);
        toggleBd.AppendChild(toggleGrid);
        toggleTpl.VisualTree = toggleBd;
        toggle.SetValue(Control.TemplateProperty, toggleTpl);
        root.AppendChild(toggle);

        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.Name = "ContentSite";
        content.SetValue(UIElement.IsHitTestVisibleProperty, false);
        content.SetValue(ContentPresenter.ContentProperty, new TemplateBindingExtension(ComboBox.SelectionBoxItemProperty));
        content.SetValue(ContentPresenter.ContentTemplateProperty, new TemplateBindingExtension(ComboBox.SelectionBoxItemTemplateProperty));
        content.SetValue(FrameworkElement.MarginProperty, new Thickness(10, 5, 28, 5));
        content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        content.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Left);
        root.AppendChild(content);

        var popup = new FrameworkElementFactory(typeof(Popup));
        popup.Name = "Popup";
        popup.SetValue(Popup.PlacementProperty, PlacementMode.Bottom);
        popup.SetValue(Popup.IsOpenProperty, new TemplateBindingExtension(ComboBox.IsDropDownOpenProperty));
        popup.SetValue(Popup.AllowsTransparencyProperty, true);
        popup.SetValue(Popup.FocusableProperty, false);

        var dropBorder = new FrameworkElementFactory(typeof(Border));
        dropBorder.SetValue(Border.BackgroundProperty, ThemeTokens.BgSurfaceElevated);
        dropBorder.SetValue(Border.BorderBrushProperty, ThemeTokens.BorderDefault);
        dropBorder.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        dropBorder.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
        dropBorder.SetValue(FrameworkElement.MinWidthProperty, new TemplateBindingExtension(FrameworkElement.ActualWidthProperty));
        dropBorder.SetValue(FrameworkElement.MaxHeightProperty, 300.0);
        dropBorder.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 3, 0, 0));

        var sv = new FrameworkElementFactory(typeof(ScrollViewer));
        var itemsHost = new FrameworkElementFactory(typeof(StackPanel));
        itemsHost.SetValue(Panel.IsItemsHostProperty, true);
        sv.AppendChild(itemsHost);
        dropBorder.AppendChild(sv);
        popup.AppendChild(dropBorder);
        root.AppendChild(popup);

        tpl.VisualTree = root;
        return tpl;
    }

    public static CheckBox CreateCheckBox(string label, bool isChecked = false)
    {
        return new CheckBox
        {
            Content = new TextBlock
            {
                Text = label,
                FontFamily = ThemeTokens.UiFont,
                FontSize = 13,
                Foreground = ThemeTokens.TextPrimary,
                VerticalAlignment = VerticalAlignment.Center,
            },
            IsChecked = isChecked,
            VerticalAlignment = VerticalAlignment.Center,
            Cursor = Cursors.Hand,
        };
    }

    public static Border CreateEmptyState(
        string iconGlyph,
        string title,
        string description,
        string? primaryCtaText = null,
        RoutedEventHandler? onPrimaryCta = null)
    {
        var sp = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(24, 36, 24, 36),
            MaxWidth = 460,
        };

        sp.Children.Add(new Border
        {
            Width = 48,
            Height = 48,
            CornerRadius = new CornerRadius(24),
            Background = ThemeTokens.InfoBg,
            BorderBrush = ThemeTokens.InfoBorder,
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 12),
            Child = CreateIcon(iconGlyph, 20, ThemeTokens.AccentText),
        });

        sp.Children.Add(new TextBlock
        {
            Text = title,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Foreground = ThemeTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 6),
        });

        sp.Children.Add(new TextBlock
        {
            Text = description,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 14),
        });

        if (!string.IsNullOrWhiteSpace(primaryCtaText) && onPrimaryCta != null)
        {
            var cta = CreateButton(primaryCtaText, ButtonVariant.Primary, FluentIcons.Add, onClick: onPrimaryCta);
            cta.HorizontalAlignment = HorizontalAlignment.Center;
            sp.Children.Add(cta);
        }

        return CreateCard(sp, new Thickness(20));
    }

    /// <summary>
    /// Write-Safe Confirmation Dialog (Target, Diff/Parameters, Impact Scope, and Cancel escape).
    /// </summary>
    public static bool ShowConfirmActionDialog(
        Window? owner,
        string title,
        string targetSummary,
        IReadOnlyList<(string Key, string Value)> diffLines,
        string impactNote,
        string confirmText = "Xác nhận thực thi",
        bool isDanger = false)
    {
        var dialog = new Window
        {
            Title = title,
            Width = 520,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = owner != null ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen,
            Owner = owner,
            ResizeMode = ResizeMode.NoResize,
            Background = ThemeTokens.BgCanvas,
            Foreground = ThemeTokens.TextPrimary,
            ShowInTaskbar = false,
        };
        ThemeTokens.ApplyDarkTitleBar(dialog);

        var confirmed = false;
        var root = new StackPanel { Margin = new Thickness(20) };

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10) };
        headerRow.Children.Add(CreateIcon(isDanger ? FluentIcons.Warning : FluentIcons.ShieldCheck, 20, isDanger ? ThemeTokens.DangerText : ThemeTokens.AccentText));
        headerRow.Children.Add(new TextBlock
        {
            Text = title,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Foreground = ThemeTokens.TextPrimary,
            Margin = new Thickness(10, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        });
        root.Children.Add(headerRow);

        root.Children.Add(new TextBlock
        {
            Text = targetSummary,
            FontFamily = ThemeTokens.UiFont,
            FontSize = 13,
            Foreground = ThemeTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var diffStack = new StackPanel();
        foreach (var (k, v) in diffLines)
        {
            var row = new Grid { Margin = new Thickness(0, 3, 0, 3) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            row.Children.Add(new TextBlock
            {
                Text = k,
                FontFamily = ThemeTokens.UiFont,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = ThemeTokens.TextMuted,
            });

            var valTb = new TextBlock
            {
                Text = v,
                FontFamily = ThemeTokens.UiFont,
                FontSize = 13,
                Foreground = ThemeTokens.TextPrimary,
                TextWrapping = TextWrapping.Wrap,
            };
            Grid.SetColumn(valTb, 1);
            row.Children.Add(valTb);
            diffStack.Children.Add(row);
        }
        root.Children.Add(CreateCard(diffStack, new Thickness(12), ThemeTokens.BgSurfaceElevated, ThemeTokens.BorderDefault));

        root.Children.Add(new Border
        {
            Background = isDanger ? ThemeTokens.DangerBg : ThemeTokens.InfoBg,
            BorderBrush = isDanger ? ThemeTokens.DangerBorder : ThemeTokens.InfoBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12, 9, 12, 9),
            Margin = new Thickness(0, 12, 0, 16),
            Child = new TextBlock
            {
                Text = impactNote,
                FontFamily = ThemeTokens.UiFont,
                FontSize = 12,
                Foreground = isDanger ? ThemeTokens.DangerText : ThemeTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            },
        });

        var btnRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var cancelBtn = CreateButton("Hủy bỏ", ButtonVariant.Secondary, onClick: (_, _) =>
        {
            confirmed = false;
            dialog.DialogResult = false;
        });
        cancelBtn.IsCancel = true;
        cancelBtn.Margin = new Thickness(0, 0, 10, 0);

        var okBtn = CreateButton(confirmText, isDanger ? ButtonVariant.Danger : ButtonVariant.Primary, onClick: (_, _) =>
        {
            confirmed = true;
            dialog.DialogResult = true;
        });
        okBtn.IsDefault = true;

        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(okBtn);
        root.Children.Add(btnRow);

        dialog.Content = root;
        dialog.ShowDialog();
        return confirmed;
    }
}
