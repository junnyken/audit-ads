using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

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
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(startMinimized: minimized));
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
            // 1. ExtensionProvisioner 7-file output + version 2.9.0
            var via = new ViaWorkspaceEntry
            {
                ViaId = "11111111-2222-3333-4444-555555555555",
                Label = "Via Test Desktop",
                BrowserProfileLabel = "Profile 7",
                ProfileDir = "Profile 7",
                NetworkLabel = "103.10.20.30:8080:usr:pwd",
                TwoFaSecret = "JBSWY3DPEHPK3PXP",
                ViaTier = "vault",
            };
            var extDir = ExtensionProvisioner.ProvisionForVia(via, Path.Combine(tempRoot, "Ext"));
            foreach (var fname in new[] { "manifest.json", "passkey_shield.js", "background.js", "content.js", "popup.html", "popup.js", "HUONG-DAN-CAI-DAT.txt" })
            {
                if (!File.Exists(Path.Combine(extDir, fname)))
                    throw new InvalidOperationException($"Missing provisioned file: {fname}");
            }
            using (var mfDoc = JsonDocument.Parse(File.ReadAllText(Path.Combine(extDir, "manifest.json"))))
            {
                if (mfDoc.RootElement.GetProperty("version").GetString() != "2.9.0")
                    throw new InvalidOperationException("Manifest version is not 2.9.0");
            }
            var bgText = File.ReadAllText(Path.Combine(extDir, "background.js"));
            if (!bgText.Contains("ADSOPS_REPORT_BROWSER_EVENT", StringComparison.Ordinal) || !bgText.Contains("11111111-2222-3333-4444-555555555555", StringComparison.Ordinal))
                throw new InvalidOperationException("background.js missing v2.9 bridge or viaId");

            // 2. VaultBackupService AES-256-GCM round-trip + wrong password rejection
            var backup = new VaultBackupPayload
            {
                UserEmail = "owner@test.local",
                Vias = new List<ViaWorkspaceEntry> { via },
            };
            var enc = VaultBackupService.EncryptToBytes(backup, "StrongPass!2026");
            var dec = VaultBackupService.DecryptFromBytes(enc, "StrongPass!2026");
            if (dec.Vias.Count != 1 || dec.Vias[0].Label != "Via Test Desktop")
                throw new InvalidOperationException("Vault decrypt mismatch");
            bool wrongRejected = false;
            try { VaultBackupService.DecryptFromBytes(enc, "WrongPass123"); }
            catch (CryptographicException) { wrongRejected = true; }
            if (!wrongRejected) throw new InvalidOperationException("Vault wrong password was not rejected");

            // 3. DPAPI JWT protection round-trip
            var protectedJwt = WindowsDpapi.ProtectString("eyJ.sample.jwt.token");
            if (WindowsDpapi.UnprotectString(protectedJwt) != "eyJ.sample.jwt.token")
                throw new InvalidOperationException("DPAPI roundtrip mismatch");

            // 4. LocalBridgeServer ephemeral port 0 tests (/health, OPTIONS PNA, /chrome-profiles, /browser-event)
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
                _ => { });
            srv.Start();
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var baseUrl = $"http://127.0.0.1:{srv.BoundPort}";

            var healthResp = await http.GetAsync($"{baseUrl}/health");
            healthResp.EnsureSuccessStatusCode();
            var healthBody = await healthResp.Content.ReadAsStringAsync();
            if (!healthBody.Contains("\"app\":\"AdsOpsDesktop\"", StringComparison.Ordinal) || !healthBody.Contains("\"extVersion\":\"2.9.0\"", StringComparison.Ordinal))
                throw new InvalidOperationException($"Unexpected /health response: {healthBody}");

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

            // 5. ProtocolRegistrar.TryParseAdsOpsUri valid vs non-https reject
            if (!ProtocolRegistrar.TryParseAdsOpsUri("adsops-chrome://open?profile=Profile%209&url=https%3A%2F%2Fwww.facebook.com%2F", out var okUri)
                || okUri.Profile != "Profile 9" || !okUri.Url.StartsWith("https://", StringComparison.Ordinal))
                throw new InvalidOperationException("TryParseAdsOpsUri valid URL failed");
            if (ProtocolRegistrar.TryParseAdsOpsUri("adsops-chrome://open?profile=Default&url=javascript%3Aalert(1)", out _))
                throw new InvalidOperationException("TryParseAdsOpsUri failed to reject non-https URL");

            Console.WriteLine("ADSOPS_DESKTOP_SELFTEST_100_PASS");
            return 0;
        }
        finally
        {
            try { Directory.Delete(tempRoot, recursive: true); } catch { }
        }
    }
}
