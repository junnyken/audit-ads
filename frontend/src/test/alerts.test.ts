import { describe, expect, it } from 'vitest'
import {
  ACKNOWLEDGE_HINT,
  ALERT_DISCLAIMER,
  ALERT_SEVERITY_META,
  ALERT_STATUS_META,
  CRITICAL_SUPPRESS_WARNING,
  DELIVERY_STATUS_META,
  RESOLVE_HINT,
  SKIP_REASON_LABEL,
  SUPPRESS_HINT,
  TRANSPORT_NOT_CONFIGURED,
} from '../lib/alerts'
import { HEALTH_META } from '../lib/health'
import { READINESS_META, TONE_CLASS } from '../lib/readiness'

describe('alert presentation rules', () => {
  it('covers the three alert severities and the six alert statuses', () => {
    expect(Object.keys(ALERT_SEVERITY_META).sort()).toEqual(['critical', 'info', 'warning'])
    expect(Object.keys(ALERT_STATUS_META).sort()).toEqual([
      'acknowledged',
      'archived',
      'expired',
      'open',
      'resolved',
      'suppressed',
    ])
  })

  it('never styles an open or critical alert as success', () => {
    for (const key of ['critical', 'warning'] as const) {
      expect(ALERT_SEVERITY_META[key].tone).not.toBe('positive')
      expect(TONE_CLASS[ALERT_SEVERITY_META[key].tone]).not.toMatch(/emerald|green/)
    }
    expect(ALERT_STATUS_META.open.tone).not.toBe('positive')
  })

  it('uses no safety, approval or score language anywhere in alert copy', () => {
    const texts = [
      ...Object.values(ALERT_SEVERITY_META).map((m) => `${m.label} ${m.description}`),
      ...Object.values(ALERT_STATUS_META).map((m) => `${m.label} ${m.hint}`),
      ...Object.values(DELIVERY_STATUS_META).map((m) => `${m.label} ${m.hint}`),
      ...Object.values(SKIP_REASON_LABEL),
      ALERT_DISCLAIMER,
      ACKNOWLEDGE_HINT,
      RESOLVE_HINT,
      SUPPRESS_HINT,
      CRITICAL_SUPPRESS_WARNING,
      TRANSPORT_NOT_CONFIGURED,
    ]
    const forbidden =
      /\b(safe account|is safe|no ban risk|ban risk|guaranteed approval|account protected|bypass detected|unlock account|trust score|risk score|safety score)\b/i
    for (const text of texts) {
      expect(forbidden.test(text), text).toBe(false)
    }
  })

  it('uses the approved wording for a failed delivery and an unconfigured transport', () => {
    expect(DELIVERY_STATUS_META.failed_final.label).toBe('Notification delivery failed')
    expect(TRANSPORT_NOT_CONFIGURED).toContain('Telegram is not configured')
    expect(TRANSPORT_NOT_CONFIGURED).toContain('remain available in the Alert Center')
  })

  it('states that acknowledgement is not resolution', () => {
    expect(ALERT_STATUS_META.acknowledged.hint).toContain('source condition may still be active')
    expect(ACKNOWLEDGE_HINT.toLowerCase()).toContain('does not resolve')
  })

  it('states that resolving an alert does not change the source record', () => {
    expect(RESOLVE_HINT.toLowerCase()).toContain('does not change the health signal')
  })

  it('states that suppression is time-bounded and keeps the alert visible', () => {
    expect(SUPPRESS_HINT.toLowerCase()).toContain('until the expiry')
    expect(SUPPRESS_HINT.toLowerCase()).toContain('stays visible')
    expect(CRITICAL_SUPPRESS_WARNING.toLowerCase()).toContain('mutes delivery only')
    expect(CRITICAL_SUPPRESS_WARNING.toLowerCase()).toContain('audit log')
  })

  it('explains every reason a message was not sent', () => {
    expect(Object.keys(SKIP_REASON_LABEL)).toHaveLength(8)
    for (const label of Object.values(SKIP_REASON_LABEL)) {
      expect(label.length).toBeGreaterThan(10)
    }
    expect(SKIP_REASON_LABEL.no_recipient_configured).toContain('remains available in the Alert Center')
  })

  it('keeps alert, health and readiness vocabularies distinct', () => {
    const alertLabels = Object.values(ALERT_SEVERITY_META).map((m) => m.label)
    const healthLabels = Object.values(HEALTH_META).map((m) => m.label)
    const readinessLabels = Object.values(READINESS_META).map((m) => m.label)
    expect(alertLabels).not.toEqual(healthLabels)
    expect(alertLabels).not.toEqual(readinessLabels)
    // "Critical" and "Warning" are shared words by design (A3 reuses the A1/A2 severity words),
    // but no alert label claims a health or readiness state.
    expect(alertLabels).not.toContain('Clear signals')
    expect(alertLabels).not.toContain('Operationally ready')
  })
})
