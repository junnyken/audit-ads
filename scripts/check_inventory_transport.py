"""DB-free regression for the standalone inventory helper.

Run: python3 -I scripts/check_inventory_transport.py
Extracts the actual helper without importing application/DB configuration.
No network request is permitted: urlopen is always patched.
"""
import ast
import json
from pathlib import Path
from typing import Any
import unittest
from unittest.mock import patch
import urllib.parse
import urllib.request

SOURCE = Path(__file__).resolve().parents[1] / 'backend/app/services/meta_graph_transport.py'
tree = ast.parse(SOURCE.read_text())
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'fetch_facebook_identity_and_businesses')
namespace = {'Any': Any, 'json': json, 'urllib': __import__('urllib')}
exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), namespace)
fetch = namespace[node.name]


class Response:
    def __init__(self, data):
        self.data = data
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return json.dumps(self.data).encode()


class InventoryTests(unittest.TestCase):
    def run_read(self, pages):
        requests = []
        responses = iter([{'id': '123', 'name': 'Operator'}, *pages])
        def fake(req, timeout):
            requests.append(req)
            value = next(responses)
            if isinstance(value, Exception):
                raise value
            return Response(value)
        with patch('urllib.request.urlopen', side_effect=fake):
            result = fetch('test-secret')
        return result, requests

    def test_empty_is_valid(self):
        result, _ = self.run_read([{'data': []}])
        self.assertEqual(result[1], [])

    def test_pagination_uses_fixed_host_and_bearer(self):
        result, requests = self.run_read([
            {'data': [{'id': '1'}], 'paging': {'next': 'https://other.invalid/?access_token=bad', 'cursors': {'after': 'cursor1'}}},
            {'data': [{'id': '2'}]},
        ])
        self.assertEqual([b['id'] for b in result[1]], ['1', '2'])
        for req in requests:
            self.assertEqual(urllib.parse.urlsplit(req.full_url).hostname, 'graph.facebook.com')
            self.assertEqual(req.get_header('Authorization'), 'Bearer test-secret')
            self.assertNotIn('test-secret', req.full_url)
            self.assertNotIn('access_token', req.full_url)
        self.assertIn('after=cursor1', requests[-1].full_url)

    def test_failures_never_become_empty_success(self):
        for page in [TimeoutError(), {'error': {'code': 190}}, {}, {'data': [None]}, {'data': [{'name': 'missing id'}]}, {'data': [], 'paging': []}]:
            with self.subTest(page=type(page).__name__), self.assertRaises((ValueError, TimeoutError)):
                self.run_read([page])

    def test_later_page_failure_never_returns_partial(self):
        with self.assertRaises(TimeoutError):
            self.run_read([{'data': [{'id': '1'}], 'paging': {'next': 'ignored', 'cursors': {'after': 'a'}}}, TimeoutError()])

    def test_missing_or_repeated_cursor_fails(self):
        for paging in [{'next': 'ignored'}, {'next': 'ignored', 'cursors': {'after': ''}}]:
            with self.assertRaises(ValueError):
                self.run_read([{'data': [], 'paging': paging}])
        page = {'data': [], 'paging': {'next': 'ignored', 'cursors': {'after': 'same'}}}
        with self.assertRaises(ValueError):
            self.run_read([page, page])

    def test_page_limit_fails(self):
        pages = [{'data': [], 'paging': {'next': 'ignored', 'cursors': {'after': str(i)}}} for i in range(20)]
        with self.assertRaisesRegex(ValueError, 'limit'):
            self.run_read(pages)

    def test_missing_identity_fails(self):
        with patch('urllib.request.urlopen', return_value=Response({})), self.assertRaises(ValueError):
            fetch('test-secret')


if __name__ == '__main__':
    unittest.main()
