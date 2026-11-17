import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The extension must never reach for a page's storage or its cookies. These are the
      // APIs an accidental refactor would reach for first, so they are errors, not warnings.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'The extension never reads a page’s storage.' },
        { name: 'sessionStorage', message: 'The extension never reads a page’s storage.' },
        { name: 'indexedDB', message: 'The extension never reads a page’s storage.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'cookie', message: 'The extension never reads cookies.' },
        { object: 'chrome', property: 'cookies', message: 'Not a permission this extension has.' },
        { object: 'chrome', property: 'webRequest', message: 'The extension never intercepts requests.' },
        { object: 'chrome', property: 'debugger', message: 'The extension never drives the browser.' },
        { object: 'chrome', property: 'proxy', message: 'The extension never configures a proxy.' },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
