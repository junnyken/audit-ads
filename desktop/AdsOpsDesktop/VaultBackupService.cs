using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AdsOpsDesktop;

public sealed class VaultBackupPayload
{
    [JsonPropertyName("app_version")] public string AppVersion { get; set; } = DesktopAppInfo.Version;
    [JsonPropertyName("exported_at_utc")] public string ExportedAtUtc { get; set; } = DateTime.UtcNow.ToString("O");
    [JsonPropertyName("backend_base_url")] public string BackendBaseUrl { get; set; } = DesktopConfig.DefaultBackendUrl;
    [JsonPropertyName("user_email")] public string UserEmail { get; set; } = "";
    [JsonPropertyName("cloud_jwt_plain")] public string CloudJwtPlain { get; set; } = "";
    [JsonPropertyName("config_snapshot")] public DesktopConfig? ConfigSnapshot { get; set; }
    [JsonPropertyName("stewardship_snapshot")] public ViaStewardshipDocument? StewardshipSnapshot { get; set; }
    [JsonPropertyName("vias")] public List<ViaWorkspaceEntry> Vias { get; set; } = new();
    [JsonPropertyName("local_secrets")] public List<PlainViaSecretBackupEntry> LocalSecrets { get; set; } = new();
}

internal sealed class EncryptedVaultEnvelope
{
    [JsonPropertyName("format")] public string Format { get; set; } = "adsops-vault-v1";
    [JsonPropertyName("kdf")] public string Kdf { get; set; } = "PBKDF2-SHA256";
    [JsonPropertyName("iterations")] public int Iterations { get; set; } = 210_000;
    [JsonPropertyName("salt_b64")] public string SaltB64 { get; set; } = "";
    [JsonPropertyName("nonce_b64")] public string NonceB64 { get; set; } = "";
    [JsonPropertyName("tag_b64")] public string TagB64 { get; set; } = "";
    [JsonPropertyName("cipher_b64")] public string CipherB64 { get; set; } = "";
}

/// <summary>Zero-dependency PBKDF2-SHA256 + AES-256-GCM encrypted backup for local workstation Via vault.</summary>
public static class VaultBackupService
{
    private const int KdfIterations = 210_000;
    private const int SaltSize = 16;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;

    public static byte[] EncryptToBytes(VaultBackupPayload payload, string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 6)
        {
            throw new ArgumentException("Mật khẩu khóa file Vault phải từ 6 ký tự trở lên.");
        }
        var plainBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, KdfIterations, HashAlgorithmName.SHA256, KeySize);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        using (var aes = new AesGcm(key, TagSize))
        {
            aes.Encrypt(nonce, plainBytes, cipher, tag);
        }

        var env = new EncryptedVaultEnvelope
        {
            SaltB64 = Convert.ToBase64String(salt),
            NonceB64 = Convert.ToBase64String(nonce),
            TagB64 = Convert.ToBase64String(tag),
            CipherB64 = Convert.ToBase64String(cipher),
        };
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(env, new JsonSerializerOptions { WriteIndented = true }));
    }

    public static VaultBackupPayload DecryptFromBytes(byte[] fileBytes, string password)
    {
        if (string.IsNullOrEmpty(password)) throw new ArgumentException("Thiếu mật khẩu giải mã.");
        var env = JsonSerializer.Deserialize<EncryptedVaultEnvelope>(Encoding.UTF8.GetString(fileBytes))
            ?? throw new InvalidDataException("Tệp Vault không hợp lệ.");
        if (!string.Equals(env.Format, "adsops-vault-v1", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Định dạng Vault không được hỗ trợ.");
        }
        var salt = Convert.FromBase64String(env.SaltB64);
        var nonce = Convert.FromBase64String(env.NonceB64);
        var tag = Convert.FromBase64String(env.TagB64);
        var cipher = Convert.FromBase64String(env.CipherB64);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Math.Max(100_000, env.Iterations), HashAlgorithmName.SHA256, KeySize);
        var plain = new byte[cipher.Length];

        using (var aes = new AesGcm(key, TagSize))
        {
            aes.Decrypt(nonce, cipher, tag, plain);
        }

        return JsonSerializer.Deserialize<VaultBackupPayload>(Encoding.UTF8.GetString(plain))
            ?? throw new InvalidDataException("Nội dung giải mã Vault rỗng.");
    }

    public static string AutoBackupsFolder => Path.Combine(DesktopConfig.AppDataRoot, "AutoBackups");

    public static (bool Created, string FilePath, int RetainedCount) CreateDailyAutoBackup(
        DesktopConfig config,
        List<ViaWorkspaceEntry> vias,
        string? customFolder = null,
        int maxRetainedFiles = 14)
    {
        var folder = customFolder ?? AutoBackupsFolder;
        Directory.CreateDirectory(folder);

        var todayKey = DateTime.Now.ToString("yyyy-MM-dd");
        var targetFile = Path.Combine(folder, $"AdsOps-AutoBackup-{todayKey}.adsopsvault");

        var payload = new VaultBackupPayload
        {
            AppVersion = DesktopAppInfo.Version,
            ExportedAtUtc = DateTime.UtcNow.ToString("O"),
            BackendBaseUrl = config.BackendBaseUrl,
            UserEmail = config.UserEmail,
            CloudJwtPlain = config.GetJwt(),
            ConfigSnapshot = config.CloneWithoutSecrets(),
            StewardshipSnapshot = ViaStewardshipStore.Default.ExportSnapshot(),
            Vias = vias ?? new List<ViaWorkspaceEntry>(),
            LocalSecrets = LocalSecretVaultStore.Default.ExportPlainEntries(),
        };

        // Derive deterministic machine-bound passphrase from the DPAPI-protected bridge token
        var autoPass = config.GetOrCreateBridgeToken();
        if (string.IsNullOrWhiteSpace(autoPass) || autoPass.Length < 8)
        {
            autoPass = $"adsops-dpapi-{Environment.MachineName}-{Environment.UserName}";
        }

        var encrypted = EncryptToBytes(payload, autoPass);
        File.WriteAllBytes(targetFile, encrypted);

        var allFiles = new DirectoryInfo(folder)
            .GetFiles("AdsOps-AutoBackup-*.adsopsvault")
            .OrderByDescending(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        for (int i = Math.Max(1, maxRetainedFiles); i < allFiles.Length; i++)
        {
            try { allFiles[i].Delete(); } catch { }
        }

        var retained = Math.Min(allFiles.Length, Math.Max(1, maxRetainedFiles));
        return (true, targetFile, retained);
    }
}
