import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertDrawer from '../components/AlertDrawer'
import type { AlertDetail } from '../lib/types'

const detail: AlertDetail = {
  alert: {
    id: 'alert-1',
    ad_account_id: 'acc-1',
    source_type: 'health_signal',
    source_entity_type: 'account_health_signal',
    source_entity_id: 'sig-1',
    alert_key: 'health_signal:acc-1:account_restricted_status:account',
    category: 'account_status',
    severity: 'critical',
    status: 'open',
    title: 'Account status is restricted',
    summary: 'The recorded account status is restricted.',
    source_snapshot_json: {
      rule_key: 'account_restricted_status',
      rule_version: 1,
      health_severity: 'critical',
      recommended_next_step: 'Review the account in the ads interface.',
    },
    first_observed_at: '2026-09-04T10:00:00Z',
    last_observed_at: '2026-09-04T10:00:00Z',
    last_notified_at: null,
    acknowledged_at: null,
    acknowledgement_note: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    suppressed_at: null,
    suppression_reason: null,
    suppression_expires_at: null,
    created_at: '2026-09-04T10:00:00Z',
  },
  source_label: 'Health signal',
  account: {
    id: 'acc-1',
    display_name: 'Pilot C',
    external_account_id: 'act_c',
    status: 'restricted',
    readiness_status: 'not_ready',
    health_status: 'critical',
  },
  notifications: [
    {
      id: 'del-1',
      alert_id: 'alert-1',
      channel: 'telegram',
      reason: 'initial',
      status: 'failed_final',
      message_template_version: 'a3-v1',
      scheduled_for: '2026-09-04T10:00:00Z',
      quiet_hours_decision: null,
      sent_at: null,
      last_attempt_at: '2026-09-04T10:01:00Z',
      attempt_count: 1,
      next_retry_at: null,
      skip_reason: null,
      failure_code: 'invalid_recipient',
      failure_summary: 'The configured Telegram chat is not reachable by this bot.',
      telegram_message_id: null,
      created_at: '2026-09-04T10:00:00Z',
      payload_snapshot_json: { severity: 'critical' },
      recipient_masked: '…7890',
    },
  ],
  policy_decision: {
    timezone: 'Asia/Ho_Chi_Minh',
    quiet_hours_enabled: true,
    critical_bypasses_quiet_hours: true,
    recipient_configured: true,
    latest_delivery: null,
  },
  disclaimer: 'Alerts are internal operational attention items derived from records in this product.',
}

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubFetch(payload: unknown = detail) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  )
}

describe('alert drawer', () => {
  it('renders severity, status, source rule and version, and the recommended next step', async () => {
    stubFetch()
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Account status is restricted')).toBeInTheDocument()
    expect(await screen.findByText('Critical')).toBeInTheDocument()
    expect(await screen.findByText('Open')).toBeInTheDocument()
    expect(await screen.findByText(/account_restricted_status v1/)).toBeInTheDocument()
    expect(await screen.findByText(/Review the account in the ads interface/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows health and readiness beside each other, not merged', async () => {
    stubFetch()
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText(/^Health: /)).toBeInTheDocument()
    expect(await screen.findByText(/^Readiness: /)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('requires a note before acknowledging and a reason before resolving', async () => {
    stubFetch()
    const user = userEvent.setup()
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    const ack = await screen.findByRole('button', { name: 'Acknowledge' })
    const resolve = await screen.findByRole('button', { name: 'Resolve alert' })
    expect(ack).toBeDisabled()
    expect(resolve).toBeDisabled()

    await user.type(screen.getByLabelText(/Note/), 'Seen it.')
    await waitFor(() => expect(ack).toBeEnabled())
    await user.type(screen.getByLabelText(/Resolution reason/), 'Handled.')
    await waitFor(() => expect(resolve).toBeEnabled())
    vi.unstubAllGlobals()
  })

  it('requires a reason and a future expiry before suppressing, and warns on a critical alert', async () => {
    stubFetch()
    const user = userEvent.setup()
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    const suppress = await screen.findByRole('button', { name: 'Suppress' })
    expect(suppress).toBeDisabled()
    expect(await screen.findByText(/Suppressing it mutes delivery only/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Reason/), 'Appeal filed.')
    await waitFor(() => expect(suppress).toBeEnabled())
    expect((screen.getByLabelText(/Expires at/) as HTMLInputElement).value).not.toBe('')
    vi.unstubAllGlobals()
  })

  it('shows a failed delivery with its safe summary and never a raw provider response', async () => {
    stubFetch()
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Notification delivery failed')).toBeInTheDocument()
    expect(
      await screen.findByText(/invalid_recipient: The configured Telegram chat is not reachable/),
    ).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body.toLowerCase()).not.toContain('bot_token')
    expect(body.toLowerCase()).not.toContain('authorization')
    vi.unstubAllGlobals()
  })

  it('offers no send-now control and no recipient field', async () => {
    stubFetch()
    const { container } = wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('Account status is restricted')
    const buttons = Array.from(container.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').toLowerCase(),
    )
    for (const banned of ['send now', 'send message', 'resend', 'test send']) {
      expect(buttons.some((label) => label.includes(banned))).toBe(false)
    }
    const inputs = Array.from(container.querySelectorAll('input, textarea'))
      .map((el) => `${el.getAttribute('id') ?? ''} ${el.getAttribute('placeholder') ?? ''}`)
      .join(' ')
      .toLowerCase()
    for (const banned of ['chat_id', 'recipient', 'token', 'message body']) {
      expect(inputs).not.toContain(banned)
    }
    vi.unstubAllGlobals()
  })

  it('offers no workflow actions on a resolved alert', async () => {
    stubFetch({ ...detail, alert: { ...detail.alert, status: 'resolved', resolved_at: '2026-09-04T12:00:00Z', resolution_reason: 'Done.' } })
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('Account status is restricted')
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resolve alert' })).toBeNull()
    vi.unstubAllGlobals()
  })

  it('explains a suppressed alert without hiding it', async () => {
    stubFetch({
      ...detail,
      alert: {
        ...detail.alert,
        status: 'suppressed',
        suppressed_at: '2026-09-04T11:00:00Z',
        suppression_reason: 'Appeal filed.',
        suppression_expires_at: '2026-09-05T11:00:00Z',
      },
    })
    wrap(<AlertDrawer alertId="alert-1" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Suppressed')).toBeInTheDocument()
    expect(await screen.findByText(/Delivery is muted until/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Unsuppress' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
