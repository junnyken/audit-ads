import type { Tone } from './readiness'

/** One place decides how an operational state is coloured, as with readiness, health and alerts. */
export const STATE_META: Record<string, { label: string; tone: Tone; hint: string }> = {
  current: {
    label: 'Current',
    tone: 'positive',
    hint: 'Ran recently enough to be trusted.',
  },
  stale: {
    label: 'Stale',
    tone: 'caution',
    hint: 'It ran before, but not recently enough. Something has stopped.',
  },
  never: {
    label: 'Never run',
    tone: 'attention',
    hint: 'There is no record of this ever running. It is not configured, or it has never started.',
  },
}

export const BAND_META: Record<string, { label: string; tone: Tone }> = {
  ok: { label: 'OK', tone: 'positive' },
  warning: { label: 'Warning', tone: 'caution' },
  critical: { label: 'Critical', tone: 'attention' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const RUN_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  succeeded: { label: 'Succeeded', tone: 'positive' },
  partial: { label: 'Partial', tone: 'caution' },
  failed: { label: 'Failed', tone: 'attention' },
}

export const RUN_KIND_LABEL: Record<string, string> = {
  dispatch: 'Notification dispatch',
  recovery_sweep: 'Recovery sweep',
  backup: 'Database backup',
  restore_drill: 'Restore drill',
  migration_release: 'Migration release',
  test_send: 'Controlled test send',
}

export const TRANSPORT_LABEL: Record<string, string> = {
  disabled: 'Disabled — nothing is delivered',
  fake: 'Fake — messages are recorded, never sent',
  telegram: 'Telegram — real delivery',
}

export const OPERATIONS_DISCLAIMER =
  'These are operational signals about this deployment. They say nothing about any advertising ' +
  'account or platform, and they are not a health or readiness state.'

export const TEST_SEND_DISCLAIMER =
  'A controlled delivery verification. It sends one clearly-labelled test message to the ' +
  'configured chat, creates no alert, and changes no account, health or readiness record.'
