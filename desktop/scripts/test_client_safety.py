"""Static guards + Python ZIP/cache model fixtures; NOT C# runtime/build proof."""
import hashlib
import io
import re
from pathlib import Path, PurePosixPath
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1] / 'AdsOpsDesktop'


def model_bundle(data):
    result = {}
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if not 0 < len(archive.infolist()) <= 4096:
            raise ValueError('count')
        for entry in archive.infolist():
            name = entry.orig_filename
            parts = name.split('/')
            total += entry.file_size
            if (any(p in ('', '.', '..') or p.endswith(('.', ' ')) for p in parts)
                    or any(re.match(r'^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)', p, re.I) for p in parts)
                    or any(c in name for c in '\\:<>"|?*')
                    or name.startswith('/') or name.lower() in result
                    or (entry.external_attr >> 16) & 0xF000 == 0xA000
                    or PurePosixPath(name).suffix.lower() not in
                    {'.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf'}
                    or not 0 < entry.file_size <= 32 * 1024 * 1024
                    or total > 128 * 1024 * 1024):
                raise ValueError('asset')
            result[name.lower()] = archive.read(entry)
    if 'index.html' not in result or sum(PurePosixPath(n).name == 'index.html' for n in result) != 1:
        raise ValueError('index')
    return result


def bundle(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, data in entries:
            archive.writestr(name, data)
    # Windows ZipInfo normalizes backslashes when constructed. Patch equal-length
    # names in both headers so the checker actually receives the hostile fixture.
    data = output.getvalue()
    for name, _ in entries:
        if isinstance(name, str) and "\\" in name:
            data = data.replace(name.replace("\\", "/").encode("utf-8"), name.encode("utf-8"))
    return data


def model_cache(actual, expected):
    return {n: hashlib.sha256(b).digest() for n, b in actual.items() if n != '.ready'} == {
        n: hashlib.sha256(b).digest() for n, b in expected.items()}


class ClientSafety(unittest.TestCase):
    def test_static_startup_and_entry_guards(self):
        main = (ROOT / 'MainWindow.cs').read_text(encoding='utf-8')
        self.assertIn('private const bool SafeCandidateMode = true;', main)
        startup = main.split('private async Task OnWindowLoadedAsync()', 1)[1].split('private void HydrateFromOfflineSnapshot', 1)[0]
        self.assertLess(startup.index('if (SafeCandidateMode)'), startup.index('StartBridgeServer();'))
        self.assertLess(startup.index('return;'), startup.index('_uiTimer.Start();'))
        for signature, ret in [('private void StartBridgeServer()', 'return;'),
                               ('private int ProvisionAllViaExtensions(bool silent)', 'return 0;'),
                               ('private async Task RunAutoKeepAliveTickAsync()', 'return;'),
                               ('private void OnUiSecondTick()', 'return;')]:
            self.assertIn(signature + '\n    {\n        if (SafeCandidateMode) ' + ret, main)
        shell = (ROOT / 'MainWindow.WebShell.cs').read_text(encoding='utf-8')
        switch = shell.split('case "switch_view":', 1)[1].split('break;', 1)[0]
        self.assertLess(switch.index('if (SafeCandidateMode)'), switch.index('SwitchView('))

    def test_static_cache_guards(self):
        source = (ROOT / 'DesktopWebUiBridge.cs').read_text(encoding='utf-8')
        self.assertNotIn('ExtractToDirectory', source)
        for guard in ['MaxAssetFiles = 4096', 'MaxAssetSize = 32L', 'MaxAssetTotal = 128L',
                      'FileAttributes.ReparsePoint', 'Path.IsPathRooted(name)', 'files.ContainsKey(name)',
                      'output.Length + read > entry.Length', 'SHA256.HashData(stream)',
                      'ValidateAssetCache(targetDir, files)', 'ValidateAssetCache(tempDir, files)',
                      'Directory.Move(backup, targetDir)', 'FileMode.CreateNew']:
            self.assertIn(guard, source)
        self.assertNotIn('Directory.Delete(', source)

    def test_bundle_fixtures(self):
        good = [('index.html', b'<html/>'), ('assets/main.js', b'void 0')]
        self.assertEqual(len(model_bundle(bundle(good))), 2)
        for name in ['../x.js', '/x.js', 'a\\x.js', 'C:/x.js', 'a/../x.js', 'a//x.js', 'x.exe', 'CON.js', 'a/index.html', 'INDEX.HTML']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                model_bundle(bundle(good + [(name, b'x')]))
        with self.assertRaises(ValueError):
            model_bundle(bundle([('index.html', b'')]))
        link = zipfile.ZipInfo('link.js')
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        with self.assertRaises(ValueError):
            model_bundle(bundle(good + [(link, b'target')]))
        with self.assertRaises(ValueError):
            model_bundle(bundle([('index.html', b'x')] + [(f'{i}.js', b'x') for i in range(4096)]))

    def test_cache_tampering_fixtures(self):
        expected = {'index.html': b'ok', 'main.js': b'code'}
        self.assertTrue(model_cache(dict(expected, **{'.ready': b'untrusted'}), expected))
        for actual in [{'index.html': b'ok'}, dict(expected, **{'main.js': b'evil'}),
                       dict(expected, **{'extra.js': b'x'})]:
            self.assertFalse(model_cache(actual, expected))


if __name__ == '__main__':
    unittest.main()
