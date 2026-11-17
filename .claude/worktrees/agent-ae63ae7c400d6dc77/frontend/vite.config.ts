import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `/api` is proxied to the backend in development so the browser only ever talks to the dev
 * server's own origin.
 *
 * Without this the page is cross-origin against the API, which means every write is preceded by
 * a CORS preflight and every request depends on `localhost` resolving to the same address family
 * the API happens to be bound to. That cost real debugging time: reads worked while the login
 * POST silently never left the browser, because a simple GET needs no preflight and a JSON POST
 * does. Same-origin removes the preflight and the address-family question together.
 *
 * `VITE_API_BASE_URL` still wins when set, for pointing the dev UI at a deployed API.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        // 127.0.0.1 rather than localhost: Node resolves `localhost` to ::1 on this machine,
        // and naming the address explicitly keeps the proxy independent of that.
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
