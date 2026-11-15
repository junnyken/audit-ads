using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace AdsOpsDesktop;

public sealed record TotpResult(bool Valid, string Code6, string FormattedCode, int SecondsRemaining);

/// <summary>RFC 6238 HMAC-SHA1 30-second TOTP generator (zero external NuGet dependencies).</summary>
public static class TotpService
{
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static readonly Regex Base32Regex = new(@"^[A-Z2-7]{8,128}$", RegexOptions.Compiled);
    private static readonly Regex OtpAuthSecretRegex = new(@"[?&]secret=([A-Za-z2-7=\s-]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string NormalizeBase32Secret(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = raw.Trim();
        if (s.StartsWith("otpauth://", StringComparison.OrdinalIgnoreCase))
        {
            var m = OtpAuthSecretRegex.Match(s);
            if (!m.Success) return "";
            s = m.Groups[1].Value;
        }
        else if (s.StartsWith("2fa://", StringComparison.OrdinalIgnoreCase))
        {
            s = s[6..];
        }
        else if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                 s.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                 s.StartsWith("meta-user://", StringComparison.OrdinalIgnoreCase))
        {
            return "";
        }

        s = Regex.Replace(s, @"[\s\-=]+", "").ToUpperInvariant();
        return Base32Regex.IsMatch(s) ? s : "";
    }

    public static byte[] Base32ToBytes(string normalizedBase32)
    {
        int bits = 0;
        int value = 0;
        var output = new List<byte>(normalizedBase32.Length * 5 / 8);
        foreach (var ch in normalizedBase32)
        {
            var idx = Base32Alphabet.IndexOf(ch);
            if (idx < 0) continue;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)((value >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }
        return output.ToArray();
    }

    public static TotpResult ComputeTotp(string? rawSecret, DateTimeOffset? now = null)
    {
        var norm = NormalizeBase32Secret(rawSecret);
        var ts = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var rem = 30 - (int)(ts % 30);
        if (string.IsNullOrEmpty(norm))
        {
            return new TotpResult(false, "", "--- ---", rem);
        }

        try
        {
            var key = Base32ToBytes(norm);
            if (key.Length == 0) return new TotpResult(false, "", "--- ---", rem);

            var counter = ts / 30;
            var counterBytes = new byte[8];
            for (int i = 7; i >= 0; i--)
            {
                counterBytes[i] = (byte)(counter & 0xFF);
                counter >>= 8;
            }

            using var hmac = new HMACSHA1(key);
            var hash = hmac.ComputeHash(counterBytes);
            var offset = hash[^1] & 0x0F;
            var binary =
                ((hash[offset] & 0x7F) << 24) |
                ((hash[offset + 1] & 0xFF) << 16) |
                ((hash[offset + 2] & 0xFF) << 8) |
                (hash[offset + 3] & 0xFF);

            var otp = (binary % 1_000_000).ToString("D6");
            return new TotpResult(true, otp, $"{otp[..3]} {otp[3..]}", rem);
        }
        catch
        {
            return new TotpResult(false, "", "--- ---", rem);
        }
    }
}
