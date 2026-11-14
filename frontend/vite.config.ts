import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `/api` is proxied to the backend in development so the browser only ever talks to the dev
 * server's own origin.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/i18n/') || id.includes('\\src\\i18n\\')) {
            return 'i18n-dict'
          }
          if (!id.includes('node_modules')) return undefined
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react'
          }
          if (id.includes('/@tanstack/')) {
            return 'vendor-query'
          }
          if (id.includes('/lucide-react/') || id.includes('/@radix-ui/')) {
            return 'vendor-ui'
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
