import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `/api` is proxied to the backend in development so the browser only ever talks to the dev
 * server's own origin.
 */
export default defineConfig({
  plugins: [react()],
  esbuild: {
    legalComments: 'none',
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/e-[hash].js',
        chunkFileNames: 'assets/c-[hash].js',
        assetFileNames: 'assets/a-[hash].[ext]',
        manualChunks(id) {
          if (id.includes('/src/i18n/') || id.includes('\\src\\i18n\\')) {
            return 'v0'
          }
          if (!id.includes('node_modules')) return undefined
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'v1'
          }
          if (id.includes('/@tanstack/')) {
            return 'v2'
          }
          if (id.includes('/lucide-react/') || id.includes('/@radix-ui/')) {
            return 'v3'
          }
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
