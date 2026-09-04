// Kept separate from vite.config.ts: vitest ships its own Vite copy, and merging the two
// configs in one type-checked file makes tsc compare two different Vite type trees.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
