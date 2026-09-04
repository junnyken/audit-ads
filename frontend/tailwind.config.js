/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: '#ffffff', muted: '#f6f7f9', sunken: '#eceff3' },
        ink: { DEFAULT: '#12171f', muted: '#5a6675', faint: '#8994a3' },
        line: { DEFAULT: '#e2e6ec', strong: '#cfd6df' },
        brand: { DEFAULT: '#1f5fbf', dark: '#17488f', light: '#e8f0fc' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
