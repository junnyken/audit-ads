import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Badge, EmptyState, ErrorState, Progress, Skeleton } from '../components/ui'
import AuditDiff from '../components/AuditDiff'
import AccountFormDrawer from '../components/AccountFormDrawer'
import { READINESS_META } from '../lib/readiness'
import type { ReadinessStatus } from '../lib/types'

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('readiness badges', () => {
  it('renders all four readiness states with their own label', () => {
    const states: ReadinessStatus[] = [
      'operationally_ready',
      'ready_with_warnings',
      'not_ready',
      'unknown',
    ]
    wrap(
      <>
        {states.map((state) => (
          <Badge key={state} tone={READINESS_META[state].tone} dot>
            {READINESS_META[state].label}
          </Badge>
        ))}
      </>,
    )
    for (const state of states) {
      expect(screen.getByText(READINESS_META[state].label)).toBeInTheDocument()
    }
  })

  it('does not give unknown or not_ready a success class', () => {
    wrap(
      <>
        <Badge tone={READINESS_META.unknown.tone}>Unknown</Badge>
        <Badge tone={READINESS_META.not_ready.tone}>Not ready</Badge>
      </>,
    )
    expect(screen.getByText('Unknown').className).not.toMatch(/emerald/)
    expect(screen.getByText('Not ready').className).not.toMatch(/emerald/)
  })
})

describe('state components', () => {
  it('shows the correlation id on an error so it can be quoted', () => {
    wrap(<ErrorState error={{ message: 'Boom', requestId: 'req-42' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    expect(screen.getByText(/req-42/)).toBeInTheDocument()
  })

  it('guides the operator when the registry is empty', () => {
    wrap(
      <EmptyState
        title="No accounts registered yet"
        description="Start by adding a Business Manager."
      />,
    )
    expect(screen.getByText('No accounts registered yet')).toBeInTheDocument()
  })

  it('marks the loading skeleton as busy for assistive technology', () => {
    wrap(<Skeleton rows={2} />)
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true')
  })

  it('reports checklist progress as a fraction', () => {
    wrap(<Progress value={7} total={10} />)
    expect(screen.getByText('7/10')).toBeInTheDocument()
  })
})

describe('audit diff', () => {
  it('renders before and after values', () => {
    wrap(<AuditDiff before={{ display_name: 'Old' }} after={{ display_name: 'New' }} metadata={null} />)
    expect(screen.getByText('Old')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('renders a redacted value as the marker rather than hiding it', () => {
    wrap(<AuditDiff before={null} after={{ proxy_url: '[REDACTED]' }} metadata={null} />)
    expect(screen.getByText('[REDACTED]')).toBeInTheDocument()
  })
})

describe('account form', () => {
  it('offers no field for a password, cookie, token or proxy credential', () => {
    const { container } = wrap(<AccountFormDrawer open onClose={() => {}} />)
    expect(container.querySelector('input[type="password"]')).toBeNull()

    const names = Array.from(container.querySelectorAll('input, textarea, select'))
      .map((element) => `${element.getAttribute('id') ?? ''} ${element.getAttribute('name') ?? ''}`)
      .join(' ')
      .toLowerCase()
    for (const banned of ['password', 'cookie', 'token', 'secret', 'credential', 'proxy_url']) {
      expect(names).not.toContain(banned)
    }
  })

  it('tells the operator that credentials are never stored', () => {
    wrap(<AccountFormDrawer open onClose={() => {}} />)
    expect(screen.getByText(/never stores passwords, cookies, session data/i)).toBeInTheDocument()
  })
})
