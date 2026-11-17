import animate from 'tailwindcss-animate'

// Every colour reads a CSS variable declared in src/tokens.css, so light and dark share one
// set of class names. The legacy names (surface/ink/line/brand) are kept and re-pointed at the
// tokens, which is what lets pages that U1b-U1d have not restyled yet follow the theme.
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`
const tone = (name) => ({
  bg: channel(`tone-${name}-bg`),
  fg: channel(`tone-${name}-fg`),
  border: channel(`tone-${name}-border`),
})

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: channel('surface'), muted: channel('bg'), sunken: channel('surface-2') },
        ink: { DEFAULT: channel('fg'), muted: channel('fg-muted'), faint: channel('fg-faint') },
        line: { DEFAULT: channel('border'), strong: channel('border-strong') },
        brand: {
          DEFAULT: channel('brand'),
          dark: channel('brand-hover'),
          light: channel('brand-soft'),
          fg: channel('brand-fg'),
          text: channel('brand-text'),
        },
        tone: {
          positive: tone('positive'),
          caution: tone('caution'),
          attention: tone('attention'),
          info: tone('info'),
          neutral: tone('neutral'),
          muted: tone('muted'),
        },
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        popover: '0 4px 12px rgb(10 18 36 / 0.10)',
        sheet: '0 16px 40px rgb(10 18 36 / 0.24)',
      },
      spacing: {
        header: '52px',
        sidebar: '240px',
      },
    },
  },
  plugins: [animate],
}
