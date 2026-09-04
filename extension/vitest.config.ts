// Separate from vite.config.ts for the same reason as the dashboard: vitest ships its own Vite
// copy, and type-checking both in one file compares two different Vite type trees.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
