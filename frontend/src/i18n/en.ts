/**
 * English strings — the secondary language. Checked against `vi.ts`'s keys via `satisfies`:
 * a missing or extra key here fails `tsc -b`. Where a string already shipped in English
 * (Login, the shell), the original wording is kept.
 */
import { o4En } from './o4'
import type { TranslationKey } from './types'

export const en = {
  'common.appName': 'AdsOps Control Center',
  'common.appTagline': 'Account registry and operational readiness',
  'common.loading': 'Loading…',

  'shell.skipToContent': 'Skip navigation, go to main content',
  'shell.mainNavLabel': 'Main navigation',
  'shell.openMenu': 'Open navigation menu',
  'shell.closeMenu': 'Close navigation menu',
  'shell.menuTitle': 'Navigation menu',
  'shell.workspace': 'Workspace',
  'shell.disclaimer':
    'Readiness is an internal operational state derived from recorded evidence. It is not a platform approval, and it is not a guarantee against restriction.',

  'nav.group.overview': 'Overview',
  'nav.group.accounts': 'Accounts',
  'nav.group.monitoring': 'Monitoring',
  'nav.group.operations': 'Operations',
  'nav.group.meta': 'Meta connection',
  'nav.group.teamSecurity': 'Team & security',
  'nav.group.system': 'System',

  'nav.item.overview': 'Overview',
  'nav.item.accounts': 'Ad accounts',
  'nav.item.businessManagers': 'Business Managers',
  'nav.item.assets': 'Assets',
  'nav.item.accountHealth': 'Account health',
  'nav.item.readiness': 'Readiness',
  'nav.item.alerts': 'Alerts',
  'nav.item.preflight': 'Preflight',
  'nav.item.operations': 'Operations',
  'nav.item.metaConnections': 'Meta connection',
  'nav.item.team': 'Team',
  'nav.item.securityDevices': 'Security devices',
  'nav.item.auditLog': 'Audit log',
  'nav.item.settings': 'Settings',
  'nav.item.systemStatus': 'System status',

  'theme.label': 'Light/dark theme',
  'theme.system': 'Follow system',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'language.label': 'Language',
  'language.vi': 'Tiếng Việt',
  'language.en': 'English',
  'language.shortVi': 'VI',
  'language.shortEn': 'EN',

  'user.menuLabel': 'User account',
  'user.signedInAs': 'Signed in as',
  'user.signOut': 'Sign out',
  'role.owner': 'Workspace owner',
  'role.operator': 'Operator',
  'role.viewer': 'Viewer',
  'role.auditor': 'Auditor',

  'login.title': 'Sign in',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.failed': 'Sign-in failed. Try again.',

  'format.never': 'never',
  'format.justNow': 'just now',

  // O4 — Meta reader credentials; strings live in ./o4.ts.
  ...o4En,
} satisfies Record<TranslationKey, string>
