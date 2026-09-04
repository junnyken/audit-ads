import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HealthSignalDrawer from '../components/HealthSignalDrawer'
import { Badge } from '../components/ui'
import { HEALTH_META } from '../lib/health'
import type { HealthSignal, HealthStatus } from '../lib/types'

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const signal: HealthSignal = {
  id: 'sig-1',
  ad_account_id: 'acc-1',
  rule_key: 'manual_review_due_or_stale',
  rule_version: 1,
  signal_key: 'manual_review_due_or_stale:manual_review',
  category: 'operations',
  severity: 'warning',
  status: 'open',
  source_type: 'account_status',
  source_entity_type: 'ad_account',
  source_entity_id: 'acc-1',
  evidence_json: {
    message: 'The last manual review is older than the configured 30-day interval.',
    policy_interval_days: 30,
  },
  observed_at: '2026-09-04T10:00:00Z',
  last_evaluated_at: '2026-09-04T10:00:00Z',
  expires_at: null,
  acknowledged_at: null,
  acknowledgement_note: null,
  resolved_at: null,
  resolved_by: null,
  resolution_reason: null,
  resolution_evidence_reference: null,
  superseded_at: null,
  superseded_by_signal_id: null,
  created_at: '2026-09-04T10:00:00Z',
  rule_name: 'Manual review is due or stale',
  why_it_matters: 'Nobody has looked at this account recently.',
  recommended_next_step: 'Review the account and record the review with a note.',
  resolution_guidance: 'Closes automatically once a manual review is recorded.',
}

describe('health badges', () => {
  it('renders all five health states with distinct labels', () => {
    const states: HealthStatus[] = [
      'critical',
      'warning',
      'attention_needed',
      'unknown',
      'clear_signals',
    ]
    wrap(
      <>
        {states.map((state) => (
          <Badge key={state} tone={HEALTH_META[state].tone} dot>
            {HEALTH_META[state].label}
          </Badge>
        ))}
      </>,
    )
    for (const state of states) {
      expect(screen.getByText(HEALTH_META[state].label)).toBeInTheDocument()
    }
    expect(screen.getByText('Unknown health').className).not.toMatch(/emerald/)
  })
})

describe('signal detail drawer', () => {
  it('shows source, rule version, timestamps, evidence and the recommended next step', () => {
    wrap(<HealthSignalDrawer signal={signal} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    expect(screen.getByText('Manual review is due or stale')).toBeInTheDocument()
    expect(screen.getAllByText(/manual_review_due_or_stale v1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/older than the configured 30-day interval/)).toBeInTheDocument()
    expect(screen.getByText('Why it matters')).toBeInTheDocument()
    expect(screen.getByText('Recommended next step')).toBeInTheDocument()
    expect(screen.getByText('Policy interval days')).toBeInTheDocument()
    expect(screen.getByText('sig-1')).toBeInTheDocument()
  })

  it('requires a note before acknowledging', async () => {
    const user = userEvent.setup()
    wrap(<HealthSignalDrawer signal={signal} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    const button = screen.getByRole('button', { name: 'Acknowledge' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/Note/), 'Seen it.')
    expect(button).toBeEnabled()
  })

  it('requires a reason before resolving', async () => {
    const user = userEvent.setup()
    wrap(<HealthSignalDrawer signal={signal} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    const button = screen.getByRole('button', { name: 'Resolve signal' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/Resolution reason/), 'Reviewed today.')
    expect(button).toBeEnabled()
  })

  it('states that acknowledging is not resolving and that resolving asserts nothing about a platform', () => {
    wrap(<HealthSignalDrawer signal={signal} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    expect(screen.getByText(/does not assert that any platform/i)).toBeInTheDocument()
    expect(screen.getByText(/keeps counting towards/i)).toBeInTheDocument()
  })

  it('offers no actions on an archived account', () => {
    wrap(<HealthSignalDrawer signal={signal} readOnly onClose={() => {}} onChanged={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resolve signal' })).toBeNull()
  })

  it('labels an engine-closed signal as automatic rather than operator action', () => {
    wrap(
      <HealthSignalDrawer
        signal={{
          ...signal,
          status: 'resolved',
          resolved_at: '2026-09-04T12:00:00Z',
          resolved_by: null,
          resolution_reason: 'The source condition is no longer true.',
        }}
        readOnly={false}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )
    expect(screen.getByText(/closed automatically/i)).toBeInTheDocument()
  })

  it('offers no credential field and no numeric score', () => {
    const { container } = wrap(
      <HealthSignalDrawer signal={signal} readOnly={false} onClose={() => {}} onChanged={() => {}} />,
    )
    expect(container.querySelector('input[type="password"]')).toBeNull()
    const text = (container.textContent ?? '').toLowerCase()
    for (const banned of ['risk score', 'safety score', 'trust score', 'ban risk']) {
      expect(text).not.toContain(banned)
    }
  })
})
