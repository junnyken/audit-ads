"""Only inert temporary ZIP bytes; never execute or extract archive payloads."""
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('checker', Path(__file__).resolve().parents[2] / 'scripts/check_extension_package.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

class PackageCheckerTests(unittest.TestCase):
    def archive(self, entries):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'fixture.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                for name, data in entries:
                    archive.writestr(name, data)
            return checker.read_zip(path)

    def fixture(self):
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'src/manifest.json').read_text())
        files = {'manifest.json': json.dumps(manifest).encode()}
        names = [manifest['background']['service_worker'], manifest['options_page'], manifest['action']['default_popup'], manifest['side_panel']['default_path'], 'content/content.js'] + list(manifest['icons'].values())
        files.update({n: b'/* inert */' for n in names})
        return manifest, files

    def test_safe_archive(self):
        self.assertEqual(self.archive([('manifest.json', b'{}')]), {'manifest.json': b'{}'})

    def test_unsafe_paths(self):
        for name in ('../payload.js', '/payload.js', 'a\\payload.js', 'a//b.js', 'C:payload.js', './a.js'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.archive([(name, b'inert')])

    def test_empty_duplicate_and_limits(self):
        for entries in ([('a.js', b'')], [('a.js', b'x'), ('A.js', b'y')], [('a.js', b'x' * (checker.MAX_FILE + 1))]):
            with self.assertRaises(ValueError):
                self.archive(entries)

    def test_symlink(self):
        info = zipfile.ZipInfo('link.js')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            self.archive([(info, b'../elsewhere')])

    def test_manifest_and_version(self):
        manifest, files = self.fixture()
        self.assertEqual(checker.validate(files, manifest, '0.3.2')['js_chunks_scanned'], 2)
        with self.assertRaises(ValueError):
            checker.validate(files, manifest, '0.3.1')
        files['manifest.json'] = b'{}'
        with self.assertRaises(ValueError):
            checker.validate(files, manifest, '0.3.2')

    def test_all_chunks_scanned_and_closure(self):
        manifest, files = self.fixture()
        files['chunks/unreferenced.js'] = b'chrome.cookies.getAll({});'
        with self.assertRaises(ValueError):
            checker.validate(files, manifest, '0.3.2')
        files['chunks/unreferenced.js'] = b'import "./missing.js";'
        with self.assertRaises(ValueError):
            checker.validate(files, manifest, '0.3.2')
        files['chunks/unreferenced.js'] = b'import "https://example.invalid/a.js";'
        with self.assertRaises(ValueError):
            checker.validate(files, manifest, '0.3.2')
        files['chunks/unreferenced.js'] = b'/* inert */'
        self.assertEqual(checker.validate(files, manifest, '0.3.2')['file_count'], len(files))

if __name__ == '__main__':
    unittest.main()
