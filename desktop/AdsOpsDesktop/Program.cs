using System;
using System.Collections.Generic;
using System.Globalization;
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

        if (args.Any(a => string.Equals(a, "--register-protocol", StringComparison.OrdinalIgnoreCase)))
        {
            ProtocolRegistrar.RegisterUriProtocol();
            return 0;
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

            // 1. ExtensionProvisioner 7-file output + version 2.9.5 + real AdAccount & DEFAULT_VIA_META injection
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
                if (mfDoc.RootElement.GetProperty("version").GetString() != "2.9.6")
                    throw new InvalidOperationException("Manifest version is not 2.9.6");
                var perms = mfDoc.RootElement.GetProperty("permissions").EnumerateArray().Select(e => e.GetString()).ToList();
                if (!perms.Contains("alarms"))
                    throw new InvalidOperationException("Manifest permissions missing alarms for v2.9.6 IP Leak Watchdog");
            }
            var bgText = File.ReadAllText(Path.Combine(extDir, "background.js"));
            if (!bgText.Contains("ADSOPS_REPORT_BROWSER_EVENT", StringComparison.Ordinal) ||
                !bgText.Contains("ADSOPS_SYNC_BILLING", StringComparison.Ordinal) ||
                !bgText.Contains("11111111-2222-3333-4444-555555555555", StringComparison.Ordinal) ||
                !bgText.Contains("act_999888777", StringComparison.Ordinal) ||
                !bgText.Contains("ensureVaultCookiesBootstrapped", StringComparison.Ordinal) ||
                !bgText.Contains("close_sender_window", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("background.js missing v2.9.5 bridge, billing sync, bootstrap, auto-close, viaId, or bundled account");
            }
            var contentText = File.ReadAllText(Path.Combine(extDir, "content.js"));
            if (!contentText.Contains("ADSOPS_SYNC_BILLING", StringComparison.Ordinal) ||
                !contentText.Contains("adsops_keepalive_session", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("content.js missing v2.9.5 ADSOPS_SYNC_BILLING or keepalive trigger");
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
                }),
                req => Task.FromResult(new BillingSyncResponseDto
                {
                    Status = "synced",
                    AdAccountId = "acc-sync-1",
                    UpdatedFields = new List<string> { "billing_threshold_raw" },
                }),
                req => new TileWindowsResultDto
                {
                    Ok = true,
                    Grid = WindowTilerService.ParseGridSpec(req?.Grid).Normalized,
                    TiledCount = 4,
                    Screen = "1920x1040",
                    Message = "Tiled 4 windows",
                });
            srv.Start();
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var baseUrl = $"http://127.0.0.1:{srv.BoundPort}";

            var healthResp = await http.GetAsync($"{baseUrl}/health");
            healthResp.EnsureSuccessStatusCode();
            var healthBody = await healthResp.Content.ReadAsStringAsync();
            if (!healthBody.Contains("\"app\":\"AdsOpsDesktop\"", StringComparison.Ordinal) ||
                !healthBody.Contains("\"version\":\"2.4.2\"", StringComparison.Ordinal) ||
                !healthBody.Contains("\"extVersion\":\"2.9.6\"", StringComparison.Ordinal))
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

            var sbBadResp = await http.PostAsync(
                $"{baseUrl}/sync-billing",
                new StringContent("{}", Encoding.UTF8, "application/json"));
            if ((int)sbBadResp.StatusCode != 400)
                throw new InvalidOperationException($"Expected 400 for empty /sync-billing, got {(int)sbBadResp.StatusCode}");

            var sbOkResp = await http.PostAsync(
                $"{baseUrl}/sync-billing",
                new StringContent("{\"external_account_id\":\"123456789\",\"billing_threshold_raw\":\"2000000\"}", Encoding.UTF8, "application/json"));
            sbOkResp.EnsureSuccessStatusCode();
            var sbOkBody = await sbOkResp.Content.ReadAsStringAsync();
            if (!sbOkBody.Contains("\"status\":\"synced\"", StringComparison.Ordinal))
                throw new InvalidOperationException($"Unexpected /sync-billing response: {sbOkBody}");

            var tileResp = await http.PostAsync(
                $"{baseUrl}/tile-windows",
                new StringContent("{\"grid\":\"3×2\"}", Encoding.UTF8, "application/json"));
            tileResp.EnsureSuccessStatusCode();
            var tileBody = await tileResp.Content.ReadAsStringAsync();
            if (!tileBody.Contains("\"grid\":\"3x2\"", StringComparison.Ordinal))
                throw new InvalidOperationException($"Unexpected /tile-windows response: {tileBody}");

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

            // 6. TotpService RFC 6238 deterministic vector + otpauth:// + 8-char Base32 + invalid reject
            var rfcVec = TotpService.ComputeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", DateTimeOffset.FromUnixTimeSeconds(59));
            if (!rfcVec.Valid || rfcVec.Code6 != "287082" || rfcVec.SecondsRemaining != 1)
                throw new InvalidOperationException($"RFC 6238 vector mismatch: {rfcVec}");
            var otpUriRes = TotpService.ComputeTotp("otpauth://totp/AdsOps:via?secret=JBSWY3DPEHPK3PXP&issuer=AdsOps");
            if (!otpUriRes.Valid || otpUriRes.Code6.Length != 6)
                throw new InvalidOperationException("otpauth:// URI should parse valid secret");
            if (string.IsNullOrEmpty(TotpService.NormalizeBase32Secret("JBSWY3DP")))
                throw new InvalidOperationException("8-char Base32 secret should be accepted");
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
            if (qEngine.Current.Phase != QueuePhase.Completed || launchedIds.Count != 1 || launchedIds[0] != "v1" || qEngine.Current.SkippedCount != 2 || !synced ||
                qEngine.LastLaunchedItems.Count != 1 || qEngine.LastLaunchedItems[0].ViaId != "v1")
            {
                throw new InvalidOperationException($"Queue test failed: phase={qEngine.Current.Phase}, launched=[{string.Join(",", launchedIds)}], tracked={qEngine.LastLaunchedItems.Count}, skipped={qEngine.Current.SkippedCount}, synced={synced}");
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

            // 10. Extension v2.9.6 template verification (2FA bridge + billing sync + cookie bootstrap + keepalive auto-close + cloud token push)
            var extTpl = ExtensionProvisioner.LoadTemplates();
            if (extTpl.Version != "2.9.6" ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("ADSOPS_GET_LOCAL_TOTP", StringComparison.Ordinal) ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("ADSOPS_SYNC_BILLING", StringComparison.Ordinal) ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("ensureVaultCookiesBootstrapped", StringComparison.Ordinal) ||
                !extTpl.BackgroundJsAfterDefaultState.Contains("close_sender_window", StringComparison.Ordinal) ||
                !extTpl.ContentJs.Contains("ADSOPS_SYNC_BILLING", StringComparison.Ordinal) ||
                !extTpl.ContentJs.Contains("handleTwoFactorAssistDom", StringComparison.Ordinal) ||
                !extTpl.PopupHtml.Contains("btn-push-token-cloud", StringComparison.Ordinal) ||
                !extTpl.PopupJsAfterDefaults.Contains("_desktopTotpCache", StringComparison.Ordinal) ||
                !extTpl.PopupJsAfterDefaults.Contains("btn-push-token-cloud", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Extension template bundle missing v2.9.6 helpers");
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

            // 13. ChromeSessionTracker + AdAccountSpendPeriodsDto + TelegramDetectedChatDto checks
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

            // 14. v2.3 Proxy key normalization, WindowTilerService grid parser, SelfUpdateService semver, Group 3/4 DTOs
            if (DesktopAppInfo.NormalizeProxyKey("103.1.2.3:8080:user:pass") != "http://103.1.2.3:8080" ||
                DesktopAppInfo.NormalizeProxyKey("socks5://u:p@103.1.2.3:1080") != "socks5://103.1.2.3:1080")
            {
                throw new InvalidOperationException("DesktopAppInfo.NormalizeProxyKey mismatch");
            }
            var parsedGrid = WindowTilerService.ParseGridSpec("3×2");
            if (parsedGrid.Cols != 3 || parsedGrid.Rows != 2 || parsedGrid.Normalized != "3x2")
                throw new InvalidOperationException("WindowTilerService.ParseGridSpec 3x2 failed");
            if (!SelfUpdateService.IsNewerVersion("2.3.1", "2.3.0") || SelfUpdateService.IsNewerVersion("2.3.0", "2.3.0"))
                throw new InvalidOperationException("SelfUpdateService.IsNewerVersion failed");

            var rSumDto = JsonSerializer.Deserialize<ReadinessSummaryDto>("{\"total_active\":5,\"operationally_ready\":2,\"ready_with_warnings\":1,\"not_ready\":1,\"unknown\":1,\"archived\":0}")
                ?? throw new InvalidOperationException("ReadinessSummaryDto null");
            if (rSumDto.TotalActive != 5 || rSumDto.OperationallyReady != 2)
                throw new InvalidOperationException("ReadinessSummaryDto field mismatch");

            var retDto = JsonSerializer.Deserialize<ClientRetainersOverviewDto>("{\"items\":[{\"id\":\"r1\",\"contract_code\":\"HD-01\",\"client_name\":\"Khach A\",\"committed_budget_vnd\":100000000,\"spend_mtd_vnd\":40000000,\"pacing_status\":\"ON_TRACK\"}],\"summary\":{\"total_contracts\":1,\"total_committed_vnd\":100000000}}")
                ?? throw new InvalidOperationException("ClientRetainersOverviewDto null");
            if (retDto.Items.Count != 1 || retDto.Items[0].ContractCode != "HD-01" || retDto.Summary.TotalCommittedVnd != 100000000)
                throw new InvalidOperationException("ClientRetainersOverviewDto field mismatch");

            var invResp = JsonSerializer.Deserialize<TeamInvitationCreateResponseDto>("{\"invitation\":{\"id\":\"i1\",\"email_normalized\":\"nv@gmail.com\",\"invited_role\":\"operator\",\"status\":\"pending\"},\"invite_link_token\":\"tok_abc_123\"}")
                ?? throw new InvalidOperationException("TeamInvitationCreateResponseDto null");
            if (invResp.InviteLinkToken != "tok_abc_123" || invResp.Invitation.EmailNormalized != "nv@gmail.com")
                throw new InvalidOperationException("TeamInvitationCreateResponseDto field mismatch");

            // 15. v2.3.1 bugfix checks: ExtractDetail error.message & FormatMetricOrDash invariant culture parsing
            var parsedErr = AdsOpsApiClient.ExtractDetail("{\"error\":{\"code\":\"bad_request\",\"message\":\"Lỗi thật từ server\"}}");
            if (parsedErr != "Lỗi thật từ server")
                throw new InvalidOperationException($"ExtractDetail AppError mismatch: {parsedErr}");
            var parsed422 = AdsOpsApiClient.ExtractDetail("{\"detail\":[{\"msg\":\"Field required\"},{\"msg\":\"Invalid ID\"}]}");
            if (parsed422 != "Field required; Invalid ID")
                throw new InvalidOperationException($"ExtractDetail 422 mismatch: {parsed422}");

            var prevCulture = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("vi-VN");
                var formattedUsd = MainWindow.FormatMetricOrDash("1500.50", "USD");
                if (formattedUsd != "1,500.50 USD")
                    throw new InvalidOperationException($"FormatMetricOrDash vi-VN inflation bug: {formattedUsd}");
            }
            finally
            {
                CultureInfo.CurrentCulture = prevCulture;
            }

            // 16. v2.4.0 Anti-Checkpoint, Client Silo, 72h Soak Quarantine, Partial Vault Refresh & Extension v2.9.6
            var builtV24 = ViaMetadataParser.BuildNotes("Ghi chú sạch", "camp", "2026-11-15T00:00:00Z", "Khach_NhaKhoa_A", "bm_warmup");
            var parsedV24 = ViaMetadataParser.ParseNotes(builtV24, "Via A", 0, 0);
            if (parsedV24.ClientGroup != "Khach_NhaKhoa_A" || parsedV24.WarmupMode != "bm_warmup" || parsedV24.CleanNotes != "Ghi chú sạch")
                throw new InvalidOperationException($"ViaMetadataParser v2.4 [CLIENT]/[WMODE] round-trip mismatch: {parsedV24}");

            var siloVias = new List<ViaWorkspaceEntry>
            {
                new() { ViaId = "s1", Label = "Via Khách A1", ProfileDir = "Profile 1", NetworkLabel = "103.1.2.3:8080:u:p", ClientGroup = "Khách A", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
                new() { ViaId = "s2", Label = "Via Khách B1", ProfileDir = "Profile 2", NetworkLabel = "103.1.2.3:8080:u:p", ClientGroup = "Khách B", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
                new() { ViaId = "s3", Label = "Via Khách A2", ProfileDir = "Profile 3", NetworkLabel = "103.1.2.9:8080:u:p", ClientGroup = "Khách A", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
            };
            ViaTrustEvaluator.DetectClientSiloConflicts(siloVias);
            if (!siloVias[0].HasSiloConflict || !siloVias[1].HasSiloConflict || siloVias[2].HasSiloConflict)
                throw new InvalidOperationException("ViaTrustEvaluator.DetectClientSiloConflicts mismatch");
            var (tScoreClean, _) = ViaTrustEvaluator.EvaluateTrustScore(siloVias[2], hasTwoFa: true, hasVaultCookie: true);
            var (tScoreConflict, _) = ViaTrustEvaluator.EvaluateTrustScore(siloVias[0], hasTwoFa: true, hasVaultCookie: true);
            if (tScoreClean != 100 || tScoreConflict >= tScoreClean)
                throw new InvalidOperationException($"ViaTrustEvaluator.EvaluateTrustScore unexpected: clean={tScoreClean}, conflict={tScoreConflict}");

            var testStewStore = new ViaStewardshipStore(Path.Combine(tempRoot, "via_stewardship.json"));
            var st1 = testStewStore.GetOrTrackProxy("v-stew", "Via Stew", "103.10.20.30:8080:u:p");
            if (!string.IsNullOrEmpty(st1.ProxyChangedUtc))
                throw new InvalidOperationException("First proxy track should not set ProxyChangedUtc");
            var st2 = testStewStore.GetOrTrackProxy("v-stew", "Via Stew", "103.10.20.99:8080:u:p");
            if (string.IsNullOrEmpty(st2.ProxyChangedUtc))
                throw new InvalidOperationException("Proxy change must set ProxyChangedUtc for 72h soak quarantine");
            testStewStore.TriggerCooldown("v-stew", "Via Stew", "Khách A", 24, "IP leak test", "IP_LEAK_BLOCKED");
            testStewStore.RecordCookieRefresh("v-stew", "Via Stew", "Khách A");
            if (!testStewStore.GetRecentEvents(10).Any(e => e.EventType == "IP_LEAK_BLOCKED") ||
                !testStewStore.GetRecentEvents(10).Any(e => e.EventType == "VAULT_COOKIE_REFRESHED"))
                throw new InvalidOperationException("ViaStewardshipStore failed to record safety events");
            testStewStore.ClearCooldown("v-stew", "Via Stew");

            // Partial cookie refresh must preserve existing 2FA secret
            var refreshedVault = testSecretStore.Upsert(
                "via-2",
                "Via Hai",
                "Profile 8",
                "c_user=2002; xs=refreshed_xs_v296",
                "");
            if (refreshedVault.TwoFaSecret != "MFRGGZDFMZTWQ2LK" || refreshedVault.CookieRaw != "c_user=2002; xs=refreshed_xs_v296")
                throw new InvalidOperationException("LocalSecretVaultStore partial cookie refresh overwrote or dropped 2FA secret");

            // AutomationQueueEngine v2.4 guards: PageCreation blocks 72h soak, cooldown, and silo conflicts; KeepAlive permits 72h soak
            var pcLaunched = new List<string>();
            using var guardEngine = new AutomationQueueEngine(
                _ => Task.FromResult((true, "Live OK")),
                item => { pcLaunched.Add(item.ViaId); return Task.CompletedTask; },
                _ => Task.CompletedTask,
                _ => { });
            guardEngine.ConfigureTiming(tickIntervalMs: 15, syncWaitSeconds: 1);
            guardEngine.StartQueue(
                QueueKind.PageCreation,
                new[]
                {
                    new QueueTaskItem("g-soak", "Via Soak", "Profile 10", "1.1.1.1:8080", "https://facebook.com", "T1", "standard_via", "Khách X", IsInSoakQuarantine: true),
                    new QueueTaskItem("g-cd", "Via Cooldown", "Profile 11", "1.1.1.2:8080", "https://facebook.com", "T2", "standard_via", "Khách X", CooldownUntilUtc: DateTimeOffset.UtcNow.AddHours(12)),
                    new QueueTaskItem("g-silo1", "Via Silo A", "Profile 12", "2.2.2.2:8080", "https://facebook.com", "T3", "standard_via", "Khách A"),
                    new QueueTaskItem("g-silo2", "Via Silo B", "Profile 13", "2.2.2.2:8080", "https://facebook.com", "T4", "standard_via", "Khách B"),
                },
                baseStaggerSeconds: 1,
                preCheckProxy: false,
                maxViasPerProxy: 5,
                enforceDaytimeWindow: false,
                enforceSoakQuarantine: true,
                enforceClientSilo: true);
            var gDeadline = DateTime.UtcNow.AddSeconds(10);
            while (guardEngine.Current.Phase != QueuePhase.Completed && DateTime.UtcNow < gDeadline)
            {
                await Task.Delay(30);
            }
            if (guardEngine.Current.Phase != QueuePhase.Completed || pcLaunched.Count != 1 || pcLaunched[0] != "g-silo1" || guardEngine.Current.SkippedCount != 3)
                throw new InvalidOperationException($"Queue v2.4 PageCreation guard failed: launched=[{string.Join(",", pcLaunched)}], skipped={guardEngine.Current.SkippedCount}");

            var kaLaunched = new List<string>();
            using var kaEngine = new AutomationQueueEngine(
                _ => Task.FromResult((true, "Live OK")),
                item => { kaLaunched.Add(item.ViaId); return Task.CompletedTask; },
                _ => Task.CompletedTask,
                _ => { });
            kaEngine.ConfigureTiming(tickIntervalMs: 15, syncWaitSeconds: 1);
            kaEngine.StartQueue(
                QueueKind.KeepAlive,
                new[]
                {
                    new QueueTaskItem("ka-soak", "Via Soak KeepAlive", "Profile 14", "1.1.1.3:8080", "https://facebook.com/?adsops_ka_mode=soak_72h", "Ngâm 72h", "standard_via", "Khách X", IsInSoakQuarantine: true),
                },
                baseStaggerSeconds: 1,
                preCheckProxy: false,
                maxViasPerProxy: 2,
                enforceDaytimeWindow: false,
                enforceSoakQuarantine: true,
                enforceClientSilo: true);
            var kaDeadline = DateTime.UtcNow.AddSeconds(10);
            while (kaEngine.Current.Phase != QueuePhase.Completed && DateTime.UtcNow < kaDeadline)
            {
                await Task.Delay(30);
            }
            if (kaEngine.Current.Phase != QueuePhase.Completed || kaLaunched.Count != 1 || kaLaunched[0] != "ka-soak")
                throw new InvalidOperationException("Queue v2.4 KeepAlive must permit Vias in 72h Soak Quarantine");

            var popupHtmlText = File.ReadAllText(Path.Combine(extDir, "popup.html"));
            if (!popupHtmlText.Contains("tab-btn-auto", StringComparison.Ordinal) ||
                !bgText.Contains("checkProxyIpLeakGuard", StringComparison.Ordinal) ||
                !bgText.Contains("refreshVaultCookieToDesktop", StringComparison.Ordinal) ||
                !contentText.Contains("soak_72h", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Provisioned Extension v2.9.6 missing Automatic tab, IP Kill-Switch, Auto Vault Cookie Refresh, or soak_72h markers");
            }

            // 17. v2.4.1 Safe 1:4 Residential Proxy Cluster, Unconditional Duplicate Profile Guard, Proxy Interleave & Config Migration
            var resCluster = new List<ViaWorkspaceEntry>
            {
                new() { ViaId = "r1", Label = "Via DC 1", ProfileDir = "Profile 1", NetworkLabel = "103.50.60.70:8080:u:p", ClientGroup = "Khách Dân Cư", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
                new() { ViaId = "r2", Label = "Via DC 2", ProfileDir = "Profile 2", NetworkLabel = "103.50.60.70:8080:u:p", ClientGroup = "Khách Dân Cư", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
                new() { ViaId = "r3", Label = "Via DC 3", ProfileDir = "Profile 3", NetworkLabel = "103.50.60.70:8080:u:p", ClientGroup = "Khách Dân Cư", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
                new() { ViaId = "r4", Label = "Via DC 4", ProfileDir = "Profile 4", NetworkLabel = "103.50.60.70:8080:u:p", ClientGroup = "Khách Dân Cư", ProxyLastStatus = "LIVE", WarmupPhase = "trusted", QuotaStatus = "SAFE" },
            };
            ViaTrustEvaluator.DetectClientSiloConflicts(resCluster, maxSharedPerProxy: 4);
            foreach (var rv in resCluster)
            {
                if (rv.HasSiloConflict || rv.SharedProxyViaCount != 4)
                    throw new InvalidOperationException($"1:4 cluster unexpected conflict/count on {rv.Label}: conflict={rv.HasSiloConflict}, count={rv.SharedProxyViaCount}");
                var (rScore, _) = ViaTrustEvaluator.EvaluateTrustScore(rv, hasTwoFa: true, hasVaultCookie: true, maxSharedPerProxy: 4);
                if (rScore != 100)
                    throw new InvalidOperationException($"Expected 100/100 score for clean 1:4 residential cluster {rv.Label}, got {rScore}");
            }

            // Same-client duplicate Chrome Profile must flag HasSiloConflict AND be skipped by queue
            var sameClientDupProf = new List<ViaWorkspaceEntry>
            {
                new() { ViaId = "dp1", Label = "Dup Prof 1", ProfileDir = "Profile 1", NetworkLabel = "103.50.60.70:8080:u:p", ClientGroup = "Khách Dân Cư" },
                new() { ViaId = "dp2", Label = "Dup Prof 2", ProfileDir = "Profile 1", NetworkLabel = "103.50.60.71:8080:u:p", ClientGroup = "Khách Dân Cư" },
            };
            ViaTrustEvaluator.DetectClientSiloConflicts(sameClientDupProf, maxSharedPerProxy: 4);
            if (!sameClientDupProf[0].HasSiloConflict || !sameClientDupProf[1].HasSiloConflict)
                throw new InvalidOperationException("Same-client duplicate Chrome Profile must set HasSiloConflict");

            var profLaunched = new List<string>();
            using var profEngine = new AutomationQueueEngine(
                _ => Task.FromResult((true, "Live OK")),
                item => { profLaunched.Add(item.ViaId); return Task.CompletedTask; },
                _ => Task.CompletedTask,
                _ => { });
            profEngine.ConfigureTiming(tickIntervalMs: 15, syncWaitSeconds: 1);
            profEngine.StartQueue(
                QueueKind.KeepAlive,
                new[]
                {
                    new QueueTaskItem("dc1", "Via DC 1", "Profile 1", "103.50.60.70:8080:u:p", "https://facebook.com", "KA1", "standard_via", "Khách Dân Cư"),
                    new QueueTaskItem("dc2", "Via DC 2", "Profile 2", "103.50.60.70:8080:u:p", "https://facebook.com", "KA2", "standard_via", "Khách Dân Cư"),
                    new QueueTaskItem("dc3", "Via DC 3", "Profile 3", "103.50.60.70:8080:u:p", "https://facebook.com", "KA3", "standard_via", "Khách Dân Cư"),
                    new QueueTaskItem("dc4", "Via DC 4", "Profile 4", "103.50.60.70:8080:u:p", "https://facebook.com", "KA4", "standard_via", "Khách Dân Cư"),
                    new QueueTaskItem("dc-dup", "Via Dup Prof", "Profile 1", "103.50.60.70:8080:u:p", "https://facebook.com", "KA5", "standard_via", "Khách Dân Cư"),
                },
                baseStaggerSeconds: 1,
                preCheckProxy: false,
                maxViasPerProxy: 4,
                enforceDaytimeWindow: false,
                enforceSoakQuarantine: true,
                enforceClientSilo: true,
                interleaveByProxy: false);
            var pDeadline = DateTime.UtcNow.AddSeconds(10);
            while (profEngine.Current.Phase != QueuePhase.Completed && DateTime.UtcNow < pDeadline)
            {
                await Task.Delay(30);
            }
            if (profEngine.Current.Phase != QueuePhase.Completed || profLaunched.Count != 4 || profEngine.Current.SkippedCount != 1 || profLaunched.Contains("dc-dup"))
                throw new InvalidOperationException($"1:4 queue / duplicate profile guard failed: launched=[{string.Join(",", profLaunched)}], skipped={profEngine.Current.SkippedCount}");

            // InterleaveByProxy check
            var interleaved = AutomationQueueEngine.InterleaveByProxy(new[]
            {
                new QueueTaskItem("a1", "A1", "Profile 1", "1.1.1.1:8080", "https://facebook.com", "T", "standard_via"),
                new QueueTaskItem("a2", "A2", "Profile 2", "1.1.1.1:8080", "https://facebook.com", "T", "standard_via"),
                new QueueTaskItem("b1", "B1", "Profile 3", "2.2.2.2:8080", "https://facebook.com", "T", "standard_via"),
                new QueueTaskItem("b2", "B2", "Profile 4", "2.2.2.2:8080", "https://facebook.com", "T", "standard_via"),
            });
            if (string.Join(",", interleaved.Select(x => x.ViaId)) != "a1,b1,a2,b2")
                throw new InvalidOperationException($"InterleaveByProxy mismatch: {string.Join(",", interleaved.Select(x => x.ViaId))}");

            // ConfigMigrationVersion 2 -> 4 check
            var legCfgPath = Path.Combine(tempRoot, "legacy_cfg.json");
            File.WriteAllText(legCfgPath, "{\"MaxViasPerProxyInBatch\":2}");
            var migratedCfg = DesktopConfig.Load(legCfgPath);
            if (migratedCfg.MaxViasPerProxyInBatch != 4 || migratedCfg.ConfigMigrationVersion != 242)
                throw new InvalidOperationException($"DesktopConfig migration failed: max={migratedCfg.MaxViasPerProxyInBatch}, mig={migratedCfg.ConfigMigrationVersion}");

            // 18. v2.4.2 Custom Proxy Cluster Capacity (1-50) & 5-Layer Workstation Migration Backup
            var eightCluster = Enumerable.Range(1, 8).Select(i => new ViaWorkspaceEntry
            {
                ViaId = $"c8-{i}",
                Label = $"Via Custom {i}",
                ProfileDir = $"Profile {20 + i}",
                NetworkLabel = "103.80.90.100:8080:u:p",
                ClientGroup = "Khách Tùy Chỉnh",
                ProxyLastStatus = "LIVE",
                WarmupPhase = "trusted",
                QuotaStatus = "SAFE",
            }).ToList();
            ViaTrustEvaluator.DetectClientSiloConflicts(eightCluster, maxSharedPerProxy: 8);
            foreach (var ev in eightCluster)
            {
                if (ev.HasSiloConflict || ev.SharedProxyViaCount != 8)
                    throw new InvalidOperationException($"Custom 1:8 cluster failed on {ev.Label}");
                var (s8, _) = ViaTrustEvaluator.EvaluateTrustScore(ev, hasTwoFa: true, hasVaultCookie: true, maxSharedPerProxy: 8);
                if (s8 != 100)
                    throw new InvalidOperationException($"Expected 100/100 score for custom 1:8 cluster, got {s8}");
            }
            var bulk8 = ViaBulkImportParser.ParseBulkText(
                "Via Custom 8|100089123456788|JBSWY3DPEHPK3PXP|103.80.90.100:8080:u:p",
                "Via",
                "camp",
                eightCluster.Take(7).ToList(),
                autoAssignProfile: true,
                warmupStartIso: "",
                maxSafePerProxy: 8);
            if (bulk8.Rows.Count != 1 || !bulk8.Rows[0].DuplicateProxyWarning.Contains("8/8 Via", StringComparison.Ordinal))
                throw new InvalidOperationException($"Custom bulk8 proxy warning mismatch: {bulk8.Rows.FirstOrDefault()?.DuplicateProxyWarning}");

            var srcCfg = new DesktopConfig
            {
                MaxViasPerProxyInBatch = 8,
                MaxPagesPerProxyInBatch = 3,
                SameProxyMinStaggerSeconds = 75,
                AutoKeepAliveScheduler = true,
                PreCheckProxyBeforeLaunch = true,
                BackendBaseUrl = "https://audit-ads-backend.vibe1.tinhgon.xyz",
                UserEmail = "steward@example.com",
            };
            var srcStew = new ViaStewardshipStore(Path.Combine(tempRoot, "stew_src.json"));
            srcStew.GetOrTrackProxy("v-mig-1", "Via Migrated 1", "103.80.90.100:8080:u:p");
            srcStew.RecordKeepAliveSuccess("v-mig-1", "Via Migrated 1", "Khách Tùy Chỉnh", "Keep-alive before migration");
            srcStew.RecordKeepAliveSuccess("v-mig-1", "Via Migrated 1", "Khách Tùy Chỉnh");
            var migPayload = new VaultBackupPayload
            {
                AppVersion = DesktopAppInfo.Version,
                BackendBaseUrl = srcCfg.BackendBaseUrl,
                UserEmail = srcCfg.UserEmail,
                CloudJwtPlain = "jwt_mig_test",
                ConfigSnapshot = srcCfg.CloneWithoutSecrets(),
                StewardshipSnapshot = srcStew.ExportSnapshot(),
                Vias = eightCluster,
                LocalSecrets = testSecretStore.ExportPlainEntries(),
            };
            var encMig = VaultBackupService.EncryptToBytes(migPayload, "MatKhauDiChuyen123");
            var decMig = VaultBackupService.DecryptFromBytes(encMig, "MatKhauDiChuyen123");
            var dstCfg = new DesktopConfig();
            dstCfg.ApplyPreferencesFrom(decMig.ConfigSnapshot);
            var dstStew = new ViaStewardshipStore(Path.Combine(tempRoot, "stew_dst.json"));
            var mergedStewCount = dstStew.ImportSnapshot(decMig.StewardshipSnapshot);
            var dstVault = new LocalSecretVaultStore(Path.Combine(tempRoot, "vault_dst.json"));
            var importedVaultCount = dstVault.ImportPlainEntries(decMig.LocalSecrets);
            if (dstCfg.MaxViasPerProxyInBatch != 8 ||
                dstCfg.MaxPagesPerProxyInBatch != 3 ||
                dstCfg.SameProxyMinStaggerSeconds != 75 ||
                decMig.CloudJwtPlain != "jwt_mig_test" ||
                decMig.Vias.Count != 8 ||
                mergedStewCount < 1 ||
                importedVaultCount < 2)
            {
                throw new InvalidOperationException($"Workstation 5-layer backup verification failed: max={dstCfg.MaxViasPerProxyInBatch}, stew={mergedStewCount}, vault={importedVaultCount}");
            }
            var dstRec = dstStew.GetOrTrackProxy("v-mig-1", "Via Migrated 1", "103.80.90.100:8080:u:p");
            if (dstRec.KeepAliveSuccessCount != 2 || string.IsNullOrEmpty(dstRec.LastProxyKey) || !string.IsNullOrEmpty(dstRec.ProxyChangedUtc))
                throw new InvalidOperationException("Restored ViaStewardshipStore lost KeepAliveSuccessCount, LastProxyKey, or falsely triggered proxy-change quarantine");

            Console.WriteLine("ADSOPS_DESKTOP_V242_SELFTEST_100_PASS");
            return 0;
        }
        finally
        {
            try { Directory.Delete(tempRoot, recursive: true); } catch { }
        }
    }
}
