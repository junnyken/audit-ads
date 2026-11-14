using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace AdsOpsDesktop;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(a => string.Equals(a, "--self-test", StringComparison.OrdinalIgnoreCase)))
        {
            return RunSelfTestAsync().GetAwaiter().GetResult();
        }

        var uriIdx = Array.FindIndex(args, a => string.Equals(a, "--uri", StringComparison.OrdinalIgnoreCase));
        if (uriIdx >= 0 && uriIdx + 1 < args.Length)
        {
            return HandleProtocolInvocationAsync(args[uriIdx + 1]).GetAwaiter().GetResult();
        }

        using var mutex = new Mutex(initiallyOwned: true, @"Local\AdsOpsDesktopProSingleton", out var createdNew);
        if (!createdNew)
        {
            // Another desktop instance is already guarding port 17890
            return 0;
        }

        var minimized = args.Any(a => string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase));
        var app = new Application
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown,
        };
        var win = new MainWindow(startMinimized: minimized);
        app.MainWindow = win;
        if (!minimized)
        {
            win.Show();
        }
        app.Run();
        return 0;
    }

    private static async Task<int> HandleProtocolInvocationAsync(string rawUri)
    {
        if (!ProtocolRegistrar.TryParseAdsOpsUri(rawUri, out var parsed))
        {
            return 1;
        }
        var cfg = DesktopConfig.Load();
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1500) };
            var json = JsonSerializer.Serialize(new
            {
                profile = parsed.Profile,
                name = parsed.Name,
                proxy = parsed.Proxy,
                url = parsed.Url,
            });
            var resp = await http.PostAsync(
                $"http://127.0.0.1:{cfg.BridgePort}/open",
                new StringContent(json, Encoding.UTF8, "application/json")).ConfigureAwait(false);
            if (resp.IsSuccessStatusCode) return 0;
        }
        catch { }

        var fallbackVia = new ViaWorkspaceEntry
        {
            Label = string.IsNullOrWhiteSpace(parsed.Name) ? parsed.Profile : parsed.Name,
            BrowserProfileLabel = parsed.Profile,
            ProfileDir = ExtensionProvisioner.ResolveProfileDirectory(parsed.Profile, parsed.Name),
            NetworkLabel = parsed.Proxy,
        };
        var extDir = ExtensionProvisioner.ProvisionForVia(fallbackVia);
        ExtensionProvisioner.LaunchChrome(
            parsed.Url,
            fallbackVia.ProfileDir,
            extDir,
            cfg.UseIsolatedProfiles,
            ExtensionProvisioner.SanitizeFolderSlug(fallbackVia.Label));
        return 0;
    }

    private static async Task<int> RunSelfTestAsync()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"adsops-desktop-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);
        try
        {
            var testSecretStore = new LocalSecretVaultStore(Path.Combine(tempRoot, "local_secrets_dpapi.json"));
            testSecretStore.Upsert(
                "11111111-2222-3333-4444-555555555555",
                "Via Test Desktop",
                "Profile 7",
                "c_user=10001; xs=secret_xs",
                "JBSWY3DPEHPK3PXP");

            // 1. ExtensionProvisioner 7-file output + version 2.9.3 + real AdAccount & DEFAULT_VIA_META injection
            var via = new ViaWorkspaceEntry
            {
                ViaId = "11111111-2222-3333-4444-555555555555",
                Label = "Via Test Desktop",
                BrowserProfileLabel = "Profile 7",
                ProfileDir = "Profile 7",
                NetworkLabel = "103.10.20.30:8080:usr:pwd",
                TwoFaSecret = "JBSWY3DPEHPK3PXP",
                ViaTier = "vault",
                BundledAccounts = new List<BundledExtensionAccountDto>
                {
                    new()
                    {
                        Name = "TKQC Test 01",
                        ExternalAccountId = "act_999888777",
                        Status = "active",
                        Currency = "VND",
                        BalanceRaw = "1500000",
                    },
                },
            };
            var extDir = ExtensionProvisioner.ProvisionForVia(via, Path.Combine(tempRoot, "Ext"), testSecretStore);
            foreach (var fname in new[] { "manifest.json", "passkey_shield.js", "background.js", "content.js", "popup.html", "popup.js", "HUONG-DAN-CAI-DAT.txt" })
            {
                if (!File.Exists(Path.Combine(extDir, fname)))
                    throw new InvalidOperationException($"Missing provisioned file: {fname}");
            }
            using (var mfDoc = JsonDocument.Parse(File.ReadAllText(Path.Combine(extDir, "manifest.json"))))
            {
                if (mfDoc.RootElement.GetProperty("version").GetString() != "2.9.3")
                    throw new InvalidOperationException("Manifest version is not 2.9.3");
            }
            var bgText = File.ReadAllText(Path.Combine(extDir, "background.js"));
            if (!bgText.Contains("ADSOPS_REPORT_BROWSER_EVENT", StringComparison.Ordinal) ||
                !bgText.Contains("11111111-2222-3333-4444-555555555555", StringComparison.Ordinal) ||
                !bgText.Contains("act_999888777", StringComparison.Ordinal) ||
                !bgText.Contains("ensureVaultCookiesBootstrapped", StringComparison.Ordinal) ||
                !bgText.Contains("close_sender_window", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("background.js missing v2.9.3 bridge, bootstrap, auto-close, viaId, or bundled account");
            }
            var popupText = File.ReadAllText(Path.Combine(extDir, "popup.js"));
            if (!popupText.Contains("act_999888777", StringComparison.Ordinal) ||
                !popupText.Contains("DEFAULT_VIA_META", StringComparison.Ordinal) ||
                !popupText.Contains("btn-vault-save", StringComparison.Ordinal) ||
                !popupText.Contains("btn-push-token-cloud", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("popup.js missing DEFAULT_ACCOUNTS, DEFAULT_VIA_META, btn-vault-save, or btn-push-token-cloud");
            }

            // 2. LocalSecretVaultStore + VaultBackupService AES-256-GCM round-trip + wrong password rejection
            var exportedSecrets = testSecretStore.ExportPlainEntries();
            if (exportedSecrets.Count != 1 || exportedSecrets[0].CookieRaw != "c_user=10001; xs=secret_xs")
                throw new InvalidOperationException("LocalSecretVaultStore DPAPI roundtrip mismatch");

            var backup = new VaultBackupPayload
            {
                UserEmail = "owner@test.local",
                Vias = new List<ViaWorkspaceEntry> { via },
                LocalSecrets = exportedSecrets,
            };
            var enc = VaultBackupService.EncryptToBytes(backup, "StrongPass!2026");
            var dec = VaultBackupService.DecryptFromBytes(enc, "StrongPass!2026");
            if (dec.Vias.Count != 1 || dec.Vias[0].Label != "Via Test Desktop" ||
                dec.LocalSecrets.Count != 1 || dec.LocalSecrets[0].CookieRaw != "c_user=10001; xs=secret_xs")
            {
                throw new InvalidOperationException("Vault decrypt mismatch");
            }
            bool wrongRejected = false;
            try { VaultBackupService.DecryptFromBytes(enc, "WrongPass123"); }
            catch (CryptographicException) { wrongRejected = true; }
            if (!wrongRejected) throw new InvalidOperationException("Vault wrong password was not rejected");

            // 3. DPAPI JWT protection round-trip
            var protectedJwt = WindowsDpapi.ProtectString("eyJ.sample.jwt.token");
            if (WindowsDpapi.UnprotectString(protectedJwt) != "eyJ.sample.jwt.token")
                throw new InvalidOperationException("DPAPI roundtrip mismatch");

            // 4. LocalBridgeServer ephemeral port 0 tests (/health v2.0.0, OPTIONS PNA, /chrome-profiles, /browser-event, /local-vault/save & get, /totp)
            BrowserEventPayloadDto? capturedEv = null;
            using var srv = new LocalBridgeServer(
                0,
                _ => Task.FromResult((true, "OK")),
                ev =>
                {
                    capturedEv = ev;
                    return Task.FromResult(new BrowserEventResponseDto { Ok = true, EventType = ev.EventType, MatchedPageId = ev.PageId });
                },
                () => Task.FromResult(1),
                _ => { },
                req =>
                {
                    var s = testSecretStore.Upsert(req.ViaId, req.ViaLabel, req.ProfileDir, req.CookieRaw, req.TwoFaSecret);
                    return Task.FromResult(new LocalVaultGetResult
                    {
                        Ok = true,
                        Found = s.Found,
                        ViaId = s.ViaId,
                        ViaLabel = s.ViaLabel,
                        ProfileDir = s.ProfileDir,
                        CookieRaw = s.CookieRaw,
                        TwoFaSecret = s.TwoFaSecret,
                        UpdatedAt = s.UpdatedAtUtc,
                    });
                },
                (vid, prof, nm) =>
                {
                    var f = testSecretStore.Find(vid, prof, nm);
                    return Task.FromResult(new LocalVaultGetResult
                    {
                        Ok = true,
                        Found = f.Found,
                        ViaId = f.ViaId,
                        ViaLabel = f.ViaLabel,
                        ProfileDir = f.ProfileDir,
                        CookieRaw = f.CookieRaw,
                        TwoFaSecret = f.TwoFaSecret,
                        UpdatedAt = f.UpdatedAtUtc,
                    });
                },
                req => Task.FromResult(new AutoConnectTokenBridgeResponse
                {
                    Ok = true,
                    Id = "via-cloud-1",
                    Label = req.ViaLabel ?? "Via Auto",
                    LinkedBusinessManagers = 2,
                }));
            srv.Start();
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var baseUrl = $"http://127.0.0.1:{srv.BoundPort}";

            var healthResp = await http.GetAsync($"{baseUrl}/health");
            healthResp.EnsureSuccessStatusCode();
            var healthBody = await healthResp.Content.ReadAsStringAsync();
            if (!healthBody.Contains("\"app\":\"AdsOpsDesktop\"", StringComparison.Ordinal) ||
                !healthBody.Contains("\"version\":\"2.2.0\"", StringComparison.Ordinal) ||
                !healthBody.Contains("\"extVersion\":\"2.9.3\"", StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Unexpected /health response: {healthBody}");
            }

            var sessResp = await http.GetAsync($"{baseUrl}/chrome-sessions");
            sessResp.EnsureSuccessStatusCode();
            var sessBody = await sessResp.Content.ReadAsStringAsync();
            if (!sessBody.Contains("\"ok\":true", StringComparison.Ordinal) ||
                !sessBody.Contains("\"sessions\":", StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Unexpected /chrome-sessions response: {sessBody}");
            }

            var acBadResp = await http.PostAsync(
                $"{baseUrl}/auto-connect-token",
                new StringContent("{}", Encoding.UTF8, "application/json"));
            if ((int)acBadResp.StatusCode != 400)
                throw new InvalidOperationException($"Expected 400 for empty /auto-connect-token, got {(int)acBadResp.StatusCode}");

            var acOkResp = await http.PostAsync(
                $"{baseUrl}/auto-connect-token",
                new StringContent("{\"access_token\":\"EAABtesttoken1234567890\",\"via_label\":\"Via Cloud\"}", Encoding.UTF8, "application/json"));
            acOkResp.EnsureSuccessStatusCode();
            var acOkBody = await acOkResp.Content.ReadAsStringAsync();
            if (!acOkBody.Contains("via-cloud-1", StringComparison.Ordinal))
                throw new InvalidOperationException($"Unexpected /auto-connect-token response: {acOkBody}");

            var optReq = new HttpRequestMessage(HttpMethod.Options, $"{baseUrl}/open");
            var optResp = await http.SendAsync(optReq);
            if ((int)optResp.StatusCode != 204 || !optResp.Headers.TryGetValues("Access-Control-Allow-Private-Network", out var pnaVals) || !pnaVals.Contains("true"))
                throw new InvalidOperationException("OPTIONS /open missing 204 or PNA header");

            var profResp = await http.GetAsync($"{baseUrl}/chrome-profiles");
            profResp.EnsureSuccessStatusCode();

            var evResp = await http.PostAsync(
                $"{baseUrl}/browser-event",
                new StringContent("{\"event_type\":\"PAGE_CREATED\",\"page_id\":\"p1\",\"external_page_id\":\"1000888999\"}", Encoding.UTF8, "application/json"));
            evResp.EnsureSuccessStatusCode();
            if (capturedEv == null || capturedEv.EventType != "PAGE_CREATED" || capturedEv.ExternalPageId != "1000888999")
                throw new InvalidOperationException("Browser event callback did not receive payload");

            var vsResp = await http.PostAsync(
                $"{baseUrl}/local-vault/save",
                new StringContent("{\"via_id\":\"via-2\",\"via_label\":\"Via Hai\",\"profile_dir\":\"Profile 8\",\"cookie_raw\":\"c_user=2002; xs=abc\",\"two_fa_secret\":\"MFRGGZDFMZTWQ2LK\"}", Encoding.UTF8, "application/json"));
            vsResp.EnsureSuccessStatusCode();
            var vgResp = await http.GetAsync($"{baseUrl}/local-vault/get?via_id=via-2");
            vgResp.EnsureSuccessStatusCode();
            var vgJson = await vgResp.Content.ReadAsStringAsync();
            if (!vgJson.Contains("c_user=2002; xs=abc", StringComparison.Ordinal) || !vgJson.Contains("MFRGGZDFMZTWQ2LK", StringComparison.Ordinal))
                throw new InvalidOperationException($"Local vault bridge roundtrip mismatch: {vgJson}");

            var totpResp = await http.GetAsync($"{baseUrl}/totp?via_id=via-2");
            totpResp.EnsureSuccessStatusCode();
            using (var totpDoc = JsonDocument.Parse(await totpResp.Content.ReadAsStringAsync()))
            {
                var found = totpDoc.RootElement.GetProperty("found").GetBoolean();
                var code = totpDoc.RootElement.GetProperty("code").GetString() ?? "";
                if (!found || code.Length != 6 || !code.All(char.IsDigit))
                    throw new InvalidOperationException($"Unexpected /totp response: {totpDoc.RootElement}");
            }

            // 5. ProtocolRegistrar.TryParseAdsOpsUri valid vs non-https reject
            if (!ProtocolRegistrar.TryParseAdsOpsUri("adsops-chrome://open?profile=Profile%209&url=https%3A%2F%2Fwww.facebook.com%2F", out var okUri)
                || okUri.Profile != "Profile 9" || !okUri.Url.StartsWith("https://", StringComparison.Ordinal))
                throw new InvalidOperationException("TryParseAdsOpsUri valid URL failed");
            if (ProtocolRegistrar.TryParseAdsOpsUri("adsops-chrome://open?profile=Default&url=javascript%3Aalert(1)", out _))
                throw new InvalidOperationException("TryParseAdsOpsUri failed to reject non-https URL");

            // 6. TotpService RFC 6238 deterministic vector + invalid reject
            var rfcVec = TotpService.ComputeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", DateTimeOffset.FromUnixTimeSeconds(59));
            if (!rfcVec.Valid || rfcVec.Code6 != "287082" || rfcVec.SecondsRemaining != 1)
                throw new InvalidOperationException($"RFC 6238 vector mismatch: {rfcVec}");
            if (TotpService.ComputeTotp("not_valid!").Valid)
                throw new InvalidOperationException("Invalid Base32 secret should fail TOTP");

            // 7. ViaMetadataParser tier, warmup round-trip, alias support & 72h/7d/trusted states
            var built = ViaMetadataParser.BuildNotes("Via cầm BM chính", "hold", "2026-11-10T00:00:00Z");
            var parsedNotes = ViaMetadataParser.ParseNotes(built, "Via Test", 0, 0);
            if (parsedNotes.Tier != "vault" || parsedNotes.WarmupStartIso != "2026-11-10T00:00:00Z" || parsedNotes.CleanNotes != "Via cầm BM chính")
                throw new InvalidOperationException($"ViaMetadataParser round-trip mismatch: {parsedNotes}");
            var builtClearedWarmup = ViaMetadataParser.BuildNotes("Trusted", "standby", "");
            var parsedCleared = ViaMetadataParser.ParseNotes(builtClearedWarmup, "Via Test", 0, 0);
            if (parsedCleared.Tier != "standby" || !string.IsNullOrEmpty(parsedCleared.WarmupStartIso))
                throw new InvalidOperationException($"ViaMetadataParser cleared-warmup mismatch: {parsedCleared}");
            var wmNow = new DateTimeOffset(2026, 11, 14, 12, 0, 0, TimeSpan.Zero);
            if (ViaMetadataParser.ComputeWarmupStatus(wmNow.AddHours(-12).ToString("O"), wmNow).Phase != "72h_lock" ||
                ViaMetadataParser.ComputeWarmupStatus(wmNow.AddDays(-5).ToString("O"), wmNow).Phase != "7d_warmup" ||
                ViaMetadataParser.ComputeWarmupStatus(wmNow.AddDays(-10).ToString("O"), wmNow).Phase != "trusted")
                throw new InvalidOperationException("ComputeWarmupStatus phase mismatch");

            // 8. AutomationQueueEngine: Proxy pre-check skip negative control + IP Cluster Guard + NightPaused
            var launchedIds = new List<string>();
            var synced = false;
            using var qEngine = new AutomationQueueEngine(
                item => Task.FromResult(item.NetworkLabel.StartsWith("9.9.9.9", StringComparison.Ordinal)
                    ? (false, "Dead proxy test")
                    : (true, "Live OK")),
                item => { launchedIds.Add(item.ViaId); return Task.CompletedTask; },
                _ => { synced = true; return Task.CompletedTask; },
                _ => { });
            qEngine.ConfigureTiming(tickIntervalMs: 15, syncWaitSeconds: 1);
            qEngine.StartQueue(
                QueueKind.PageCreation,
                new[]
                {
                    new QueueTaskItem("v1", "Via Live", "Profile 1", "1.2.3.4:8080:u:p", "https://facebook.com", "T1", "standard_via"),
                    new QueueTaskItem("v2", "Via Dead Proxy", "Profile 2", "9.9.9.9:8080:u:p", "https://facebook.com", "T2", "standard_via"),
                    new QueueTaskItem("v3", "Via Same IP", "Profile 3", "1.2.3.4:8080:u:p", "https://facebook.com", "T3", "standard_via"),
                },
                baseStaggerSeconds: 1,
                preCheckProxy: true,
                maxViasPerProxy: 1,
                enforceDaytimeWindow: false);

            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (qEngine.Current.Phase != QueuePhase.Completed && DateTime.UtcNow < deadline)
            {
                await Task.Delay(30);
            }
            if (qEngine.Current.Phase != QueuePhase.Completed || launchedIds.Count != 1 || launchedIds[0] != "v1" || qEngine.Current.SkippedCount != 2 || !synced)
            {
                throw new InvalidOperationException($"Queue test failed: phase={qEngine.Current.Phase}, launched=[{string.Join(",", launchedIds)}], skipped={qEngine.Current.SkippedCount}, synced={synced}");
            }

            using var nightEngine = new AutomationQueueEngine(
                _ => Task.FromResult((true, "OK")),
                _ => Task.CompletedTask,
                _ => Task.CompletedTask,
                _ => { },
                clockNow: () => new DateTime(2026, 11, 14, 23, 30, 0));
            nightEngine.ConfigureTiming(tickIntervalMs: 25, syncWaitSeconds: 1);
            nightEngine.StartQueue(
                QueueKind.PageCreation,
                new[]
                {
                    new QueueTaskItem("n1", "N1", "Default", "", "https://facebook.com", "N1", "standard_via"),
                    new QueueTaskItem("n2", "N2", "Profile 1", "", "https://facebook.com", "N2", "standard_via"),
                    new QueueTaskItem("n3", "N3", "Profile 2", "", "https://facebook.com", "N3", "standard_via"),
                },
                baseStaggerSeconds: 300,
                preCheckProxy: false,
                daytimeStartHour: 8,
                daytimeEndHour: 22,
                enforceDaytimeWindow: true);
            await Task.Delay(120);
            if (nightEngine.Current.Phase != QueuePhase.NightPaused)
                throw new InvalidOperationException($"Expected NightPaused at 23:30, got {nightEngine.Current.Phase}");
            nightEngine.Stop();

            // 9. ThemeTokens WCAG AA contrast audit (>= 4.5:1)
            var audit = ThemeTokens.RunContrastAudit();
            foreach (var pair in audit)
            {
                if (pair.Ratio < 4.5)
                    throw new InvalidOperationException($"WCAG AA contrast failure for {pair.Name}: {pair.Ratio}:1 < 4.5:1");
            }

            // 10. Extension v2.9.3 template verification (2FA bridge + cookie bootstrap + keepalive auto-close + cloud token push)
            var extTpl = ExtensionProvisioner.LoadTemplates();
            if (extTpl.Version != "2.9.3" ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("ADSOPS_GET_LOCAL_TOTP", StringComparison.Ordinal) ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("ensureVaultCookiesBootstrapped", StringComparison.Ordinal) ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("close_sender_window", StringComparison.Ordinal) ||
                !extTpl.ContentJs.Contains("handleTwoFactorAssistDom", StringComparison.Ordinal) ||
                !extTpl.PopupHtml.Contains("btn-push-token-cloud", StringComparison.Ordinal) ||
                !extTpl.PopupJsAfterDefaults.Contains("_desktopTotpCache", StringComparison.Ordinal) ||
                !extTpl.PopupJsAfterDefaults.Contains("btn-push-token-cloud", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Extension template bundle missing v2.9.3 helpers");
            }

            // 11. ViaBulkImportParser (Pass/Mail secret stripping + auto Profile N + duplicate Proxy warning)
            var bulkText = string.Join("\n", new[]
            {
                "100089123456789|MatKhauBiMatKhongGuiCloud|JBSWY3DPEHPK3PXP|c_user=100089123456789; xs=abc123|via_mail@example.com|103.10.20.30:8080:u1:p1",
                "Via Test 2|100089123456790|MZXW6YTBOI5W2===|c_user=100089123456790; xs=def456|103.10.20.30:8080:u2:p2",
            });
            var bulkSummary = ViaBulkImportParser.ParseBulkText(
                bulkText,
                "Via Camp",
                "camp",
                new List<ViaWorkspaceEntry>
                {
                    new() { ViaId = "existing-1", Label = "Existing", BrowserProfileLabel = "Profile 1", ProfileDir = "Profile 1", NetworkLabel = "10.0.0.1:8080" },
                },
                autoAssignProfile: true);
            if (bulkSummary.Rows.Count != 2)
                throw new InvalidOperationException($"Expected 2 bulk rows, got {bulkSummary.Rows.Count}");
            var b0 = bulkSummary.Rows[0];
            var b1 = bulkSummary.Rows[1];
            if (b0.ExternalReferenceId != "100089123456789" ||
                b0.TwoFaSecret != "JBSWY3DPEHPK3PXP" ||
                !b0.CookieRaw.Contains("c_user=100089123456789", StringComparison.Ordinal) ||
                b0.CleanNotes.Contains("MatKhauBiMatKhongGuiCloud", StringComparison.Ordinal) ||
                b0.CleanNotes.Contains("via_mail@example.com", StringComparison.Ordinal) ||
                b0.StrippedSecretsCount < 2 ||
                b0.AssignedProfile != "Profile 2" ||
                b1.AssignedProfile != "Profile 3" ||
                !bulkSummary.DuplicateProxyHosts.Contains("103.10.20.30:8080") ||
                string.IsNullOrWhiteSpace(b0.DuplicateProxyWarning) ||
                string.IsNullOrWhiteSpace(b1.DuplicateProxyWarning))
            {
                throw new InvalidOperationException("ViaBulkImportParser failed secret-stripping / profile / duplicate proxy checks");
            }

            // 12. CsvExporter UTF-8 BOM + Excel formula injection protection
            var csvBytes = CsvExporter.BuildCsvBytes(
                new[] { "Tên Via", "Công thức" },
                new[]
                {
                    new string?[] { "Via \"Alpha\", số 1", "=CMD('calc')" },
                    new string?[] { "+123", "@SUM(A1)" },
                });
            if (csvBytes.Length < 4 || csvBytes[0] != 0xEF || csvBytes[1] != 0xBB || csvBytes[2] != 0xBF)
                throw new InvalidOperationException("CsvExporter missing UTF-8 BOM");
            var csvText = System.Text.Encoding.UTF8.GetString(csvBytes, 3, csvBytes.Length - 3);
            if (!csvText.Contains("\"Via \"\"Alpha\"\", số 1\"", StringComparison.Ordinal) ||
                !csvText.Contains("'=CMD('calc')", StringComparison.Ordinal) ||
                !csvText.Contains("'+123", StringComparison.Ordinal) ||
                !csvText.Contains("'@SUM(A1)", StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"CsvExporter output unexpected: {csvText}");
            }

            // 13. v2.2 ChromeSessionTracker + AdAccountSpendPeriodsDto + TelegramDetectedChatDto checks
            var tracker = new ChromeSessionTracker();
            tracker.RecordLaunch(999999, "via-track-1", "Via Tracker", "Profile 9", "https://www.facebook.com/");
            tracker.MarkKeepAliveClosed("via-track-1", "Via Tracker", "Profile 9");
            var snap = tracker.GetSnapshot();
            if (snap.Count != 1 || !snap[0].KeepAliveClosed || snap[0].ProfileDir != "Profile 9")
                throw new InvalidOperationException("ChromeSessionTracker KeepAliveClosed check failed");

            var spendDto = JsonSerializer.Deserialize<AdAccountSpendPeriodsDto>("{\"today_partial_raw\":\"125000\",\"last_7d_raw\":890000}")
                ?? throw new InvalidOperationException("AdAccountSpendPeriodsDto deserialize returned null");
            if (spendDto.TodayText != "125000" || spendDto.Last7dText != "890000")
                throw new InvalidOperationException($"Unexpected spendDto values: {spendDto.TodayText}/{spendDto.Last7dText}");

            var chatDto = JsonSerializer.Deserialize<TelegramDetectedChatDto>("{\"chat_id\":-100987654321,\"title\":\"AdsOps Alerts\",\"type\":\"supergroup\"}")
                ?? throw new InvalidOperationException("TelegramDetectedChatDto deserialize returned null");
            if (chatDto.ChatIdText != "-100987654321" || chatDto.Title != "AdsOps Alerts")
                throw new InvalidOperationException($"Unexpected chatDto ChatIdText: {chatDto.ChatIdText}");

            Console.WriteLine("ADSOPS_DESKTOP_V22_SELFTEST_100_PASS");
            return 0;
        }
        finally
        {
            try { Directory.Delete(tempRoot, recursive: true); } catch { }
        }
    }
}
