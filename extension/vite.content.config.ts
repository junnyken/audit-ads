import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * The content script, built alone as one self-contained IIFE.
 *
 * A content script runs in an isolated world with no module loader, so a build that emitted
 * `import { … } from '../chunks/validation.js'` would simply fail to run on the page — silently,
 * which is the worst way for this particular component to break.
 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist/content'),
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'src/content/page-bridge.ts'),
      formats: ['iife'],
      name: 'AdsOpsContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
})
