import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PreflightFindingDrawer from '../components/PreflightFindingDrawer'
import type { PreflightFinding } from '../lib/types'

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const finding: PreflightFinding = {
  id: 'find-1',
  draft_id: 'draft-1',
  evaluation_run_id: 'run-1',
  category: 'copy_language',
  severity: 'blocking',
  rule_key: 'copy_absolute_claim_detected',
  rule_version: 1,
  message: 'Copy contains an absolute or guaranteed-outcome claim.',
  field_reference: 'primary_copy',
  evidence_reference: null,
  recommended_action: 'Remove or soften the absolute claim.',
  status: 'open',
  resolved_at: null,
  resolved_by: null,
  resolution_reason: null,
  created_at: '2026-09-08T10:00:00Z',
  updated_at: '2026-09-08T10:00:00Z',
}

describe('preflight finding drawer', () => {
  it('shows the rule key, severity, message and recommended action', () => {
    wrap(<PreflightFindingDrawer finding={finding} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    expect(screen.getByText('copy_absolute_claim_detected')).toBeInTheDocument()
    expect(screen.getByText(/absolute or guaranteed-outcome claim/)).toBeInTheDocument()
    expect(screen.getByText('Remove or soften the absolute claim.')).toBeInTheDocument()
  })

  it('requires a reason before acknowledging', async () => {
    const user = userEvent.setup()
    wrap(<PreflightFindingDrawer finding={finding} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    const button = screen.getByRole('button', { name: 'Acknowledge' })
    expect(button).toBeDisabled()
    await user.type(screen.getAllByLabelText(/Reason/)[0], 'Reviewed, will fix.')
    expect(button).toBeEnabled()
  })

  it('requires a reason before resolving', async () => {
    const user = userEvent.setup()
    wrap(<PreflightFindingDrawer finding={finding} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    const button = screen.getByRole('button', { name: 'Resolve finding' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/Resolution reason/), 'Copy rewritten.')
    expect(button).toBeEnabled()
  })

  it('states that neither action changes the draft status', () => {
    wrap(<PreflightFindingDrawer finding={finding} readOnly={false} onClose={() => {}} onChanged={() => {}} />)
    expect(screen.getByText(/does not change the draft's status/i)).toBeInTheDocument()
    expect(screen.getByText(/run the evaluation again/i)).toBeInTheDocument()
  })

  it('offers no actions when read-only', () => {
    wrap(<PreflightFindingDrawer finding={finding} readOnly onClose={() => {}} onChanged={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve finding' })).not.toBeInTheDocument()
  })

  it('offers no actions once resolved', () => {
    wrap(
      <PreflightFindingDrawer
        finding={{ ...finding, status: 'resolved', resolved_at: '2026-09-08T11:00:00Z', resolution_reason: 'Fixed.' }}
        readOnly={false}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve finding' })).not.toBeInTheDocument()
    expect(screen.getByText(/Fixed\./)).toBeInTheDocument()
  })
})
