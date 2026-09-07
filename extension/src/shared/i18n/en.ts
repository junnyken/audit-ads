/**
 * English strings — the exact wording that shipped before i18n existed, unchanged. Checked
 * against `vi.ts`'s keys via `satisfies`: a missing or extra key here fails `tsc`.
 */
import type { TranslationKey } from './types'

export const en = {
  'common.loading': 'Loading…',
  'common.appTitle': 'AdsOps Control Center',
  'common.refresh': 'Refresh',
  'common.openSettings': 'Open settings',
  'common.none': 'None',

  'presentation.readiness.operationallyReady.label': 'Operationally ready',
  'presentation.readiness.readyWithWarnings.label': 'Ready with warnings',
  'presentation.readiness.notReady.label': 'Not ready',
  'presentation.readiness.unknown.label': 'Unknown',

  'presentation.health.clearSignals.label': 'No current issues found',
  'presentation.health.attentionNeeded.label': 'Attention needed',
  'presentation.health.warning.label': 'Warning',
  'presentation.health.critical.label': 'Critical',
  'presentation.health.unknown.label': 'Unknown',

  'presentation.freshness.current.label': 'Current',
  'presentation.freshness.stale.label': 'Stale',
  'presentation.freshness.neverEvaluated.label': 'Never evaluated',
  'presentation.freshness.notApplicable.label': 'Not applicable',

  'presentation.context.confirmed.label': 'Confirmed',
  'presentation.context.confirmed.hint': 'This page matches a registered account by exact account id.',
  'presentation.context.ambiguous.label': 'Not confirmed',
  'presentation.context.ambiguous.hint': 'This page could not be matched to one registered account safely.',
  'presentation.context.unknown.label': 'Not registered',
  'presentation.context.unknown.hint': 'No registered account matches the account id on this page.',
  'presentation.context.unsupportedPage.label': 'Not an Ads Manager page',
  'presentation.context.unsupportedPage.hint': 'Open an Ads Manager page to see account context.',

  'presentation.event.manualReviewStarted': 'Manual review started',
  'presentation.event.manualReviewCompleted': 'Manual review completed',
  'presentation.event.campaignChangeIntent': 'Change intent recorded',
  'presentation.event.campaignChangeCompleted': 'Change completed',
  'presentation.event.accountNoteAdded': 'Note added',
  'presentation.event.policyIssueReported': 'Policy issue reported',
  'presentation.event.paymentIssueReported': 'Payment issue reported',

  'presentation.guardChecklist.context': 'Context is confirmed by exact account id',
  'presentation.guardChecklist.readiness': 'I reviewed the account readiness',
  'presentation.guardChecklist.alerts': 'I reviewed active critical alerts',
  'presentation.guardChecklist.reason': 'I recorded why I am making this change',

  'presentation.disclaimer':
    'Operational states recorded in this product. They are not a platform decision, and they do ' +
    'not guarantee that an account cannot be restricted.',
  'presentation.readOnlyNote':
    'This extension reads the page and shows what this product already knows. It changes nothing ' +
    'in Ads Manager.',

  'popup.notConnected.body': 'The extension is not connected to a dashboard yet.',
  'popup.openAccount': 'Open account',
  'popup.openAlerts': 'Open alerts',
  'popup.readingContext': 'Reading page context…',
  'popup.openDashboard': 'Open dashboard',
  'popup.selectAccountManually': 'Select account manually',

  'contextView.accountId': 'Account ID',
  'contextView.businessManager': 'Business Manager',
  'contextView.owner': 'Owner',
  'contextView.page': 'Page',
  'contextView.archivedNotice': 'This account is archived and is no longer actively managed.',
  'contextView.readiness': 'Readiness',
  'contextView.health': 'Health',
  'contextView.dataFreshness': 'Data freshness',
  'contextView.openAlerts': 'Open alerts',
  'contextView.critical': 'Critical: {count}',
  'contextView.warning': 'Warning: {count}',
  'contextView.info': 'Info: {count}',
  'contextView.readinessReasons': 'Readiness reasons',
  'contextView.moreInDashboard': 'and {count} more in the dashboard',
  'contextView.healthSignals': 'Health signals',
  'contextView.wontGuess':
    'The extension will not guess which account this is. Open the account in the dashboard if ' +
    'you need to be certain.',

  'sidepanel.title': 'Account context',
  'sidepanel.notConnected.body': 'Connect the extension to your dashboard to see account context.',
  'sidepanel.openAccountDetail': 'Open account detail',
  'sidepanel.openRelatedAlerts': 'Open related alerts',
  'sidepanel.guard.title': 'Before you change campaign settings',
  'sidepanel.guard.reasonLabel': 'Why are you making this change?',
  'sidepanel.guard.reasonPlaceholder': 'Recorded in the account timeline and the audit log.',
  'sidepanel.guard.recording': 'Recording…',
  'sidepanel.guard.save': 'Save change intent',
  'sidepanel.guard.hint':
    'Tick every item and record a reason first. This checklist records what you checked; it ' +
    'does not block anything in Ads Manager.',
  'sidepanel.guard.success': 'Change intent recorded in the account timeline.',
  'sidepanel.guard.failure': 'Could not record the change intent.',
  'sidepanel.quick.title': 'Record an event',
  'sidepanel.quick.eventLabel': 'Event',
  'sidepanel.quick.noteLabel': 'Note',
  'sidepanel.quick.noteOptionalSuffix': ' (optional)',
  'sidepanel.quick.recording': 'Recording…',
  'sidepanel.quick.record': 'Record event',
  'sidepanel.quick.recorded': '{label} recorded.',
  'sidepanel.quick.failure': 'Could not record that event.',

  'options.title': 'AdsOps Control Center — extension settings',
  'options.version': 'Version {version}',
  'options.connection.title': 'Connection',
  'options.connection.status': 'Status',
  'options.connection.connectedBadge': 'Connected',
  'options.connection.workspace': 'Workspace',
  'options.connection.signedInAs': 'Signed in as',
  'options.connection.dashboard': 'Dashboard',
  'options.connection.sessionExpires': 'Session expires',
  'options.connection.unknown': 'unknown',
  'options.connection.disconnect': 'Disconnect and revoke this browser',
  'options.connection.dashboardUrlLabel': 'Dashboard URL',
  'options.connection.dashboardUrlPlaceholder': 'https://adsops.example.com',
  'options.connection.urlHint':
    'Use an HTTPS address. Plain HTTP is accepted only for localhost during development.',
  'options.connection.emailLabel': 'Email',
  'options.connection.passwordLabel': 'Password',
  'options.connection.labelLabel': 'Label for this browser (optional)',
  'options.connection.labelPlaceholder': 'Chrome — BM USA profile',
  'options.connection.connecting': 'Connecting…',
  'options.connection.connect': 'Connect',
  'options.connection.connected': 'Connected.',
  'options.connection.connectFailed': 'Could not connect.',
  'options.connection.disconnected': 'Disconnected. The session was revoked on the server.',
  'options.privacy.title': 'What this extension does with your data',
  'options.privacy.item1':
    'It reads the account id in the Ads Manager URL, the route path, and the page title. ' +
    'Nothing else.',
  'options.privacy.item2':
    'It never reads cookies, local storage, session storage, network traffic or page content, ' +
    'and it never writes to the Ads Manager page.',
  'options.privacy.item3':
    'Your password is used once to connect and is never stored. The extension then holds a ' +
    'separate, shorter-lived session that cannot change accounts, readiness or alerts.',
  'options.privacy.item4':
    "The session is kept in the browser's in-memory extension storage and is cleared when the " +
    'browser closes.',
  'options.privacy.item5':
    'Disconnecting revokes the session on the server, so it stops working immediately rather ' +
    'than when it expires.',

  'languageToggle.vi': 'VI',
  'languageToggle.en': 'EN',
} satisfies Record<TranslationKey, string>
