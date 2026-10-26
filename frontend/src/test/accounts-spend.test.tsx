import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccountSpendCell from '../components/AccountSpendCell'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import type { AccountSpendCompact, SpendFreshness } from '../lib/types'

const compact = (over: Partial<AccountSpendCompact> = {}): AccountSpendCompact => ({
  freshness: 'current',
  observed_currency: 'VND',
  latest_complete_day: { date: '2026-10-25', spend_raw: '1600000' },
  ...over,
})

describe('Accounts list spend cell', () => {
  it.each(['current', 'stale', 'never_observed', 'not_observable'] as SpendFreshness[])(
    'renders %s without success styling',
    (freshness) => {
      render(<AccountSpendCell spend={compact({ freshness })} />)
      const badge = screen.getByText(SPEND_FRESHNESS_META[freshness].label, { selector: 'span' })
      expect(badge.className).not.toMatch(/emerald|green/)
    },
  )

  it('shows the raw spend with its currency', () => {
    render(<AccountSpendCell spend={compact()} />)
    expect(screen.getByText('1600000 VND')).toBeInTheDocument()
  })

  it('shows a dash, never 0, when Meta returned no row for the day', () => {
    render(<AccountSpendCell spend={compact({ latest_complete_day: { date: '2026-10-25', spend_raw: null } })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/^0/)).toBeNull()
  })

  it('shows a real zero row as 0', () => {
    render(<AccountSpendCell spend={compact({ latest_complete_day: { date: '2026-10-25', spend_raw: '0' } })} />)
    expect(screen.getByText('0 VND')).toBeInTheDocument()
  })

  it('shows only the badge when there is no complete day', () => {
    render(<AccountSpendCell spend={compact({ freshness: 'never_observed', observed_currency: null, latest_complete_day: null })} />)
    expect(screen.getByText('Never observed')).toBeInTheDocument()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('shows a dash when the payload carries no spend object', () => {
    render(<AccountSpendCell spend={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
