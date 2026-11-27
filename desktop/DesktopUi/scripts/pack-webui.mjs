import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uiRoot = path.resolve(__dirname, '..')
const distDir = path.join(uiRoot, 'dist')
const outZip = path.resolve(uiRoot, '..', 'AdsOpsDesktop', 'webui_bundle.zip')

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('Missing dist/index.html. Run vite build first.')
  process.exit(1)
}

const pyScript = `
import os, pathlib, zipfile, sys
dist = pathlib.Path(sys.argv[1])
out_zip = pathlib.Path(sys.argv[2])
out_zip.parent.mkdir(parents=True, exist_ok=True)
if out_zip.exists():
    out_zip.unlink()
count = 0
with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for p in sorted(dist.rglob('*')):
        if p.is_file():
            rel = p.relative_to(dist).as_posix()
            zf.write(p, rel)
            count += 1
print(f"Packed {count} files -> {out_zip} ({out_zip.stat().st_size} bytes)")
`

const res = spawnSync('python', ['-I', '-c', pyScript, distDir, outZip], {
  stdio: 'inherit',
})
if (res.status !== 0) {
  process.exit(res.status ?? 1)
}
