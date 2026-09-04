import type { Tone } from './readiness'
import type { AlertSeverity, AlertStatus, DeliveryStatus, DeliverySkipReason } from './types'

/**
 * How an alert looks and what it is allowed to say.
 *
 * Same discipline as readiness and health: one map, so a wording or colour rule cannot hold on
 * one page and break on another. Nothing here may call an account safe, protected or approved.
 */
export const ALERT_SEVERITY_META: Record<AlertSeverity, { label: string; tone: Tone; description: string }> = {
  critical: {
    label: 'Critical',
    tone: 'attention',
    description: 'A critical internal health signal is open on this account.',
  },
  warning: {
    label: 'Warning',
    tone: 'caution',
    description: 'A warning condition is open and needs operator review.',
  },
  info: {
    label: 'Info',
    tone: 'info',
    description:
      'Recorded for awareness. Telegram delivery is off for this severity unless you enable it.',
  },
}

export const ALERT_STATUS_META: Record<AlertStatus, { label: string; tone: Tone; hint: string }> = {
  open: { label: 'Open', tone: 'attention', hint: 'Needs attention and may be delivered.' },
  acknowledged: {
    label: 'Acknowledged',
    tone: 'caution',
    hint: 'Alert acknowledged; source condition may still be active.',
  },
  suppressed: {
    label: 'Suppressed',
    tone: 'info',
    hint: 'Delivery is muted until the expiry. The alert and its history stay visible.',
  },
  resolved: { label: 'Resolved', tone: 'positive', hint: 'Closed. The history remains.' },
  expired: { label: 'Expired', tone: 'muted', hint: 'No longer current. The history remains.' },
  archived: { label: 'Archived', tone: 'muted', hint: 'Archived. The history remains.' },
}

export const DELIVERY_STATUS_META: Record<DeliveryStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: 'Pending', tone: 'neutral', hint: 'Waiting for the next dispatch.' },
  queued: { label: 'Queued', tone: 'neutral', hint: 'Selected for dispatch.' },
  sending: { label: 'Sending', tone: 'neutral', hint: 'A send is in progress.' },
  sent: { label: 'Sent', tone: 'positive', hint: 'Telegram accepted the message.' },
  failed_transient: {
    label: 'Retrying',
    tone: 'caution',
    hint: 'A temporary failure. A bounded retry is scheduled.',
  },
  failed_final: {
    label: 'Notification delivery failed',
    tone: 'attention',
    hint: 'No further automatic retries. The alert is still here.',
  },
  skipped: { label: 'Not sent', tone: 'muted', hint: 'Deliberately not sent. See the reason.' },
  cancelled: {
    label: 'Cancelled',
    tone: 'muted',
    hint: 'The condition ended before the message went out.',
  },
}

/** Plain-language reasons. An operator should never have to guess why nothing arrived. */
export const SKIP_REASON_LABEL: Record<DeliverySkipReason, string> = {
  no_recipient_configured:
    'Telegram is not configured; this alert remains available in the Alert Center.',
  policy_disabled: 'Notification policy is turned off.',
  severity_delivery_disabled: 'Telegram delivery is off for this severity in your policy.',
  alert_suppressed: 'The alert was suppressed when this delivery was planned.',
  alert_not_active: 'The alert was no longer active.',
  timezone_not_configured: 'The policy timezone could not be resolved, so nothing was scheduled.',
  duplicate_suppressed_by_dedupe: 'An equivalent message was already planned.',
  reminders_disabled: 'Reminders are disabled in your policy.',
}

export const ALERT_DISCLAIMER =
  'Alerts are internal operational attention items derived from records in this product. They describe what the configured checks observed; they are not a platform decision, not a safety guarantee, and not a prediction of enforcement.'

export const ACKNOWLEDGE_HINT =
  'Acknowledging records that you have seen this. It does not resolve the underlying health signal, and the alert keeps counting.'

export const RESOLVE_HINT =
  'Resolving records an internal workflow outcome. It does not change the health signal, the account event or the checklist item behind it.'

export const SUPPRESS_HINT =
  'Suppression mutes Telegram delivery until the expiry you choose. The alert stays visible here and its history is kept.'

export const CRITICAL_SUPPRESS_WARNING =
  'This is a critical alert. Suppressing it mutes delivery only — it stays visible in the Alert Center and the action is recorded in the audit log.'

export const TRANSPORT_NOT_CONFIGURED =
  'Telegram is not configured; alerts remain available in the Alert Center and nothing is sent.'
