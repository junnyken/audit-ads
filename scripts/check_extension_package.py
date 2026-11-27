#!/usr/bin/env python3
"""Bounded, non-executing extension ZIP inspection and deterministic local packaging."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import zipfile

MAX_FILES = 200
MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
FORBIDDEN = re.compile(r'\bchrome\s*(?:\.\s*(?:cookies|debugger|scripting|webRequest|proxy|management|offscreen|identity|downloads|history|privacy)\b|\[\s*["\'](?:cookies|debugger|scripting|webRequest|proxy)["\']\s*\])|\bdocument\s*\.\s*cookie\b|\b(?:eval|importScripts)\s*\(|\bnew\s+Function\s*\(|\b(?:sendNativeMessage|connectNative)\s*\(')
IMPORTS = re.compile(r'\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["\']([^"\']+)["\']|\bimport\s*\(\s*["\']([^"\']+)["\']\s*\)')

def require(condition, message):
    if not condition:
        raise ValueError(message)

def safe_name(name):
    p = PurePosixPath(name)
    require(bool(name) and not name.startswith('/') and '\\' not in name and ':' not in name and not any(ord(c) < 32 for c in name), 'unsafe ZIP path')
    require(all(part not in ('', '.', '..') for part in name.split('/')) and str(p) == name, 'noncanonical ZIP path')
    return name

def read_zip(path):
    require(path.stat().st_size <= MAX_TOTAL, 'archive too large')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(0 < len(infos) <= MAX_FILES, 'file count limit')
        files = {}
        total = 0
        for info in infos:
            name = safe_name(info.filename)
            require(name not in files and name.casefold() not in {n.casefold() for n in files}, 'duplicate path')
            require(not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG), 'nonregular entry')
            require(not info.flag_bits & 1, 'encrypted entry')
            require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'compression method')
            require(0 < info.file_size <= MAX_FILE, 'empty or oversized entry')
            total += info.file_size
            require(total <= MAX_TOTAL, 'decompression limit')
            with archive.open(info) as stream:
                data = stream.read(MAX_FILE + 1)
            require(len(data) == info.file_size, 'size mismatch')
            files[name] = data
        return files

def reference(files, parent, ref):
    require(not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', ref) and not ref.startswith(('/', '\\')) and '\\' not in ref and '%' not in ref, 'external/ambiguous reference')
    ref = ref.split('?')[0].split('#')[0]
    target = posixpath.normpath(posixpath.join(posixpath.dirname(parent), ref))
    require(target in files, f'missing reference: {parent} -> {ref}')

def validate(files, source_manifest, version):
    require('manifest.json' in files, 'missing root manifest')
    manifest = json.loads(files['manifest.json'])
    require(manifest == source_manifest and manifest['version'] == version == '0.3.2', 'manifest/version mismatch')
    require(manifest['permissions'] == ['storage', 'sidePanel', 'activeTab'], 'permissions widened')
    hosts = ['https://adsmanager.facebook.com/*', 'https://business.facebook.com/*', 'https://www.facebook.com/adsmanager/*']
    require(manifest['host_permissions'] == hosts and len(manifest['content_scripts']) == 1 and manifest['content_scripts'][0]['matches'] == hosts, 'hosts widened')
    require(not any(k in manifest for k in ('externally_connectable', 'optional_permissions', 'optional_host_permissions')), 'unexpected privileges')
    entries = [manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_page'], manifest['side_panel']['default_path']]
    entries += list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values())
    for content in manifest['content_scripts']:
        entries += content['js']
    for name in entries:
        require(name in files, 'manifest reference missing: ' + name)
    for name, data in files.items():
        require(bool(data), 'empty entry')
        require(PurePosixPath(name).suffix in ('.json', '.js', '.css', '.html', '.png', '.woff2', '.txt'), 'unexpected file type')
        if name.endswith('.js'):
            code = data.decode('utf-8')
            require(not FORBIDDEN.search(code), 'forbidden API: ' + name)
            require(not any(term in code for term in ('localStorage', 'sessionStorage', 'indexedDB', 'graph.facebook.com')), 'forbidden storage/provider reference: ' + name)
            require(not re.search(r'\bimport\s*\(\s*(?![\s"\'])', code), 'nonliteral dynamic import')
            refs = [a or b for a, b in IMPORTS.findall(code)]
            if name == 'content/content.js':
                require(not refs, 'content script must be self-contained')
            for ref in refs:
                reference(files, name, ref)
        if name.endswith('.html'):
            code = data.decode('utf-8')
            for ref in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', code):
                reference(files, name, ref)
        if name.endswith('.css'):
            for ref in re.findall(r'url\(\s*["\']?([^"\')\s]+)', data.decode('utf-8')):
                reference(files, name, ref)
    return {'file_count': len(files), 'js_chunks_scanned': sum(n.endswith('.js') for n in files), 'uncompressed_bytes': sum(map(len, files.values()))}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def source_hash(root):
    paths = []
    for folder in ('src', 'icons', 'scripts', 'tests'):
        paths.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    paths += [root / name for name in ('package.json', 'package-lock.json', 'vite.config.ts', 'vite.content.config.ts', 'vitest.config.ts', 'tsconfig.json', 'eslint.config.js')]
    hashes = {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in sorted(paths)}
    return digest(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()), hashes

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extension', type=Path, default=Path(__file__).resolve().parents[1] / 'extension')
    parser.add_argument('--build', action='store_true', help='package existing clean dist; no builds or network')
    args = parser.parse_args()
    root = args.extension.resolve()
    target = root / 'adsops-extension-0.3.2-reviewed.zip'
    dist = root / 'dist'
    source_manifest = json.loads((root / 'src/manifest.json').read_text())
    package = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    require(package['version'] == lock['version'] == lock['packages']['']['version'], 'source version mismatch')
    paths = sorted(p for p in dist.rglob('*') if p.is_file())
    require(not any(p.is_symlink() for p in dist.rglob('*')), 'dist symlink')
    expected = {p.relative_to(dist).as_posix(): p.read_bytes() for p in paths}
    validate(expected, source_manifest, package['version'])
    if args.build:
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in expected.items():
                info = zipfile.ZipInfo(safe_name(name), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, data, compresslevel=9)
    files = read_zip(target)
    require(files == expected, 'ZIP/dist mismatch')
    result = validate(files, source_manifest, package['version'])
    source_digest, sources = source_hash(root)
    provenance = {'schema': 1, 'version': package['version'], 'sha256': digest(target.read_bytes()), 'zip_bytes': target.stat().st_size, 'source_sha256': source_digest, 'source_files': sources, 'lock_sha256': digest((root / 'package-lock.json').read_bytes()), 'checker_sha256': digest(Path(__file__).read_bytes()), 'files': {n: {'size': len(d), 'sha256': digest(d)} for n, d in files.items()}, 'validation': result, 'limits': {'files': MAX_FILES, 'file_bytes': MAX_FILE, 'total_bytes': MAX_TOTAL}, 'runtime_tested': False}
    sha_path = target.with_suffix('.sha256')
    provenance_path = target.with_suffix('.provenance.json')
    sha_text = provenance['sha256'] + '  ' + target.name + '\n'
    encoded = json.dumps(provenance, sort_keys=True, indent=2) + '\n'
    if args.build:
        sha_path.write_text(sha_text)
        provenance_path.write_text(encoded)
    else:
        require(sha_path.read_text() == sha_text and provenance_path.read_text() == encoded, 'provenance mismatch')
    print(json.dumps({'artifact': str(target), 'sha256': provenance['sha256'], **result}, sort_keys=True))

if __name__ == '__main__':
    main()
