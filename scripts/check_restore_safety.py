"""Control-flow tests using fake Docker; never runs a database or Docker daemon."""
import gzip
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.archive = self.directory / 'backup.sql.gz'
        self.archive.write_bytes(gzip.compress(b'SELECT 1;\n'))
        self.envfile = self.directory / 'target.env'
        self.envfile.write_text('POSTGRES_USER=test\nPOSTGRES_DB=dedicated_test\nPOSTGRES_PASSWORD=fake-only\n')
        self.envfile.chmod(0o600)
        self.log = self.directory / 'calls'
        docker = self.directory / 'docker'
        docker.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *ON_ERROR_STOP=1*) /bin/cat >/dev/null; [[ "${FAKE_SQL_FAIL:-0}" == 0 ]] || exit 9 ;;
  *information_schema*) printf '25\\n' ;;
  *version_num*) printf 'test_revision\\n' ;;
  *'count(*) FROM ad_accounts'*) printf '0\\n' ;;
esac
''')
        docker.chmod(0o700)
        self.env = {**os.environ, 'PATH': f'{self.directory}:/usr/bin:/bin', 'FAKE_LOG': str(self.log)}

    def tearDown(self):
        self.temp.cleanup()

    def checksum(self):
        Path(str(self.archive) + '.sha256').write_text(f'{hashlib.sha256(self.archive.read_bytes()).hexdigest()}  {self.archive.name}\n')

    def run_restore(self):
        return subprocess.run(['bash', str(ROOT / 'scripts/restore_drill.sh'), '--file', str(self.archive), '--env-file', str(self.envfile)], cwd=ROOT, env=self.env, text=True, capture_output=True, timeout=20)

    def test_missing_checksum_prevents_docker(self):
        self.assertNotEqual(self.run_restore().returncode, 0)
        self.assertFalse(self.log.exists())

    def test_bad_checksum_prevents_docker(self):
        self.checksum()
        self.archive.write_bytes(b'changed')
        self.assertNotEqual(self.run_restore().returncode, 0)
        self.assertFalse(self.log.exists())

    def test_corrupt_gzip_prevents_docker(self):
        self.archive.write_bytes(b'not gzip')
        self.checksum()
        self.assertNotEqual(self.run_restore().returncode, 0)
        self.assertFalse(self.log.exists())

    def test_sql_failure_cannot_report_success(self):
        self.checksum()
        self.env['FAKE_SQL_FAIL'] = '1'
        result = self.run_restore()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('restore drill passed', result.stdout)
        self.assertIn('DROP DATABASE', self.log.read_text())

    def test_fake_success_selects_explicit_env_and_strict_sql(self):
        self.checksum()
        result = self.run_restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text().splitlines()
        self.assertTrue(all(f'--env-file {self.envfile}' in call for call in calls))
        self.assertTrue(any('ON_ERROR_STOP=1' in call for call in calls))
        self.assertIn('restore drill passed', result.stdout)


if __name__ == '__main__':
    unittest.main()
