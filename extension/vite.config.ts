import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const src = resolve(__dirname, 'src')
const out = resolve(__dirname, 'dist')

/**
 * MV3 has two shapes Vite does not produce by default:
 *  - the service worker must be a single ES module at a stable path;
 *  - the content script must be one self-contained file, because an isolated-world script has
 *    no module loader and cannot import a chunk at runtime.
 * This config builds the pages and the worker; `vite.content.config.ts` builds the content
 * script as a single IIFE. The manifest is copied verbatim, so what ships is what was reviewed.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'adsops-copy-manifest',
      closeBundle() {
        mkdirSync(out, { recursive: true })
        copyFileSync(resolve(src, 'manifest.json'), resolve(out, 'manifest.json'))
      },
    },
  ],
  root: src,
  // Relative asset URLs: an extension page loaded from chrome-extension://<id>/popup/popup.html
  // must not depend on an absolute path resolving the way a web server would.
  base: './',
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: true,
    // Readable output: a Chrome Web Store reviewer, and the operator, should be able to read
    // what this extension actually does.
    minify: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(src, 'popup/popup.html'),
        sidepanel: resolve(src, 'sidepanel/sidepanel.html'),
        options: resolve(src, 'options/options.html'),
        'background/service-worker': resolve(src, 'background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
