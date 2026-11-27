"""STATIC source/metadata checks only; never proof of Windows runtime safety."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unittest


def check_sources(shell, publish):
    required_shell = [
        'if (!IsBundledOrigin(ev.Source)) return;',
        'OnOverviewWebMessageReceived(raw, ev.Source)',
        'core.NavigationStarting +=', 'if (!IsBundledOrigin(ev.Uri)) ev.Cancel = true;',
        'core.NewWindowRequested += (_, ev) => { ev.Handled = true; };',
        'if (!navArgs.IsSuccess || !IsBundledOrigin(core.Source)) return;',
        'if (!_overviewWebViewReady || !IsBundledOrigin(source)',
        '|| !IsBundledOrigin(_overviewWebView?.CoreWebView2?.Source)) return;',
        'if (!HasSafeNativeCapability(action))', 'ExplainSafeNativeBoundary();',
        'InputManager.Current.PreProcessInput +=', 'input.Cancel();',
        'uri.UserInfo.Length == 0 && uri.IsDefaultPort',
        '@"^https://adsops\\.local(?:/|$|[?#])"',
        'emailValue.ValueKind != JsonValueKind.String',
        'passwordValue.ValueKind != JsonValueKind.String',
        'apiUri.Scheme != "https" || apiUri.UserInfo.Length != 0',
    ]
    required_publish = [
        '[PlatformID]::Win32NT', 'dotnet --list-sdks',
        '[string]$project.Project.PropertyGroup.Version -cne $Version',
        'Remove-Item $uiZip -Force', 'Remove-Item $dist -Recurse -Force',
        '.LastWriteTimeUtc -lt $buildStarted', 'backend\\private_releases',
        '$exeInfo.Length -le 0', '$exeInfo.VersionInfo.ProductVersion -cne $Version',
        "if ($sig.Status -ne 'Valid')", 'Get-AuthenticodeSignature',
        '$proc.ExitCode -ne 0', 'source_commit = $sourceCommit',
        'ui_zip_sha256 = $uiHash', 'exe_sha256 = $exeHash',
        'exe_size_bytes = (Get-Item $exePath).Length',
        "status = 'candidate'; auto_promote = $false; manual_verified_promotion_required = $true",
        'Move-Item $tempManifest (Join-Path $candidate "candidate.json")',
    ]
    errors = [f'missing shell guard: {x}' for x in required_shell if x not in shell]
    errors += [f'missing packaging guard: {x}' for x in required_publish if x not in publish]
    match = re.search(r'bool HasSafeNativeCapability\(string action\)(.*?)\n\n', shell, re.S)
    allowed = set(re.findall(r'"([a-z_]+)"', match.group(1))) if match else set()
    if allowed != {'ready', 'switch_view', 'toggle_palette', 'dismiss_error_banner', 'refresh_state', 'cloud_login'}:
        errors.append('capability allowlist changed')
    if shell.find('if (!HasSafeNativeCapability(action))') > shell.find('switch (action)'):
        errors.append('capability check must precede dispatch')
    if 'HandleShortcutKey(' in shell:
        errors.append('Web hotkey bypass remains')
    for forbidden in ['UnknownError', 'frontend\\public\\downloads', 'latest.zip', 'latest.json']:
        if forbidden in publish:
            errors.append(f'unsafe publish token: {forbidden}')
    return errors


def require(condition):
    if not condition:
        raise ValueError('Candidate metadata/integrity check failed')


def check_candidate(folder):
    """Integrity consistency only: Authenticode/self-test fields are untrusted claims here."""
    m = json.loads((folder / 'candidate.json').read_text(encoding='utf-8-sig'))
    require(m['status'] == 'candidate' and m['auto_promote'] is False)
    require(m['manual_verified_promotion_required'] is True)
    require(m['authenticode_status'] == 'Valid' and m['authenticode_signed'] is True)
    require(m['self_test_passed'] is True)
    require(re.fullmatch(r'[0-9a-f]{40,64}', m['source_commit']))
    require(isinstance(m['source_dirty'], bool))
    for field in ['ui_zip_sha256', 'exe_sha256', 'sha256']:
        require(re.fullmatch(r'[0-9a-f]{64}', m[field]))
    with (folder / 'webui_bundle.zip').open('rb') as stream:
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == m['ui_zip_sha256'])
    for name, hash_field, size_field in [
        ('payload/AdsOpsDesktop.exe', 'exe_sha256', 'exe_size_bytes'),
        ('AdsOps-Desktop-Pro-candidate.zip', 'sha256', 'size_bytes'),
    ]:
        p = folder / name
        require(p.stat().st_size == m[size_field] > 0)
        with p.open('rb') as stream:
            require(hashlib.file_digest(stream, 'sha256').hexdigest() == m[hash_field])


ROOT = Path(__file__).resolve().parents[2]
SHELL = ROOT / 'desktop/AdsOpsDesktop/MainWindow.WebShell.cs'
PUBLISH = ROOT / 'desktop/scripts/publish-release.ps1'


class StaticGateTests(unittest.TestCase):
    def test_current_sources(self):
        self.assertEqual(check_sources(SHELL.read_text(encoding='utf-8'), PUBLISH.read_text(encoding='utf-8')), [])

    def test_removed_guards_fail(self):
        shell, publish = SHELL.read_text(encoding='utf-8'), PUBLISH.read_text(encoding='utf-8')
        for guard in ['if (!IsBundledOrigin(ev.Source)) return;', 'if (!HasSafeNativeCapability(action))',
                      'input.Cancel();', 'if (!IsBundledOrigin(ev.Uri)) ev.Cancel = true;',
                      'core.NewWindowRequested += (_, ev) => { ev.Handled = true; };',
                      'if (!navArgs.IsSuccess || !IsBundledOrigin(core.Source)) return;']:
            with self.subTest(guard=guard):
                self.assertTrue(check_sources(shell.replace(guard, ''), publish))
        for guard in ["if ($sig.Status -ne 'Valid')", 'Remove-Item $uiZip -Force',
                      '[PlatformID]::Win32NT', 'exe_sha256 = $exeHash']:
            with self.subTest(guard=guard):
                self.assertTrue(check_sources(shell, publish.replace(guard, '')))

    def test_unsafe_allowlist_fails(self):
        self.assertTrue(check_sources(SHELL.read_text(encoding='utf-8').replace('or "cloud_login";', 'or "cloud_login" or "hotkey";'), PUBLISH.read_text(encoding='utf-8')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--candidate', type=Path)
    args = parser.parse_args()
    if args.self_test:
        unittest.main(argv=[__file__])
    else:
        errors = check_sources(SHELL.read_text(encoding='utf-8'), PUBLISH.read_text(encoding='utf-8'))
        if errors:
            raise SystemExit('\n'.join(errors))
        if args.candidate:
            check_candidate(args.candidate)
        print('STATIC gate PASS; Windows compilation/runtime/signature verification NOT performed.')
