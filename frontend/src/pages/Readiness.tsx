import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { ReadinessStatus } from '../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Progress, Skeleton } from '../components/ui'
import { READINESS_META, severityTone } from '../lib/readiness'

interface BoardRow {
  ad_account_id: string
  display_name: string
  external_account_id: string | null
  readiness_status: ReadinessStatus
  status: string
  required_item_count: number
  completed_item_count: number
  reasons: { code: string; severity: string; message: string }[]
}

interface Board {
  rows: BoardRow[]
  groups: {
    code: string
    message: string
    severity: string
    accounts: { ad_account_id: string; display_name: string }[]
  }[]
}

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All active accounts' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'ready_with_warnings', label: 'Ready with warnings' },
  { value: 'operationally_ready', label: 'Operationally ready' },
]

export default function ReadinessPage() {
  const [filter, setFilter] = useState('')
  const board = useQuery({
    queryKey: ['readiness-board', filter],
    queryFn: () =>
      api.get<Board>(`/api/v1/ad-accounts/readiness/board${query({ readiness_status: filter })}`),
  })

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Readiness</h1>
        <p className="text-[12.5px] text-ink-muted">
          Cross-account view of what is holding each account back, grouped by reason.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`btn ${filter === option.value ? 'btn-primary' : 'btn-secondary'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <InlineNote>
        This view is read-only on purpose. There is no bulk &ldquo;mark complete&rdquo; action:
        each item has to be reviewed on the account it belongs to.
      </InlineNote>

      {board.isLoading ? (
        <Skeleton rows={6} />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : board.data!.rows.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          description="No active account matches this readiness state."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <Card title="Grouped by blocking reason">
            {board.data!.groups.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">
                No blocking reasons in this selection.
              </p>
            ) : (
              <ul className="space-y-3">
                {board.data!.groups.map((group) => (
                  <li key={group.code}>
                    <div className="flex items-center gap-2">
                      <Badge tone={severityTone(group.severity)}>{group.accounts.length}</Badge>
                      <span className="font-mono text-[11.5px] text-ink-muted">{group.code}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px]">{group.message}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.accounts.map((account) => (
                        <Link
                          key={account.ad_account_id}
                          to={`/accounts/${account.ad_account_id}`}
                          className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-brand hover:underline"
                        >
                          {account.display_name}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Accounts (${board.data!.rows.length})`}>
            <ul className="divide-y divide-line">
              {board.data!.rows.map((row) => {
                const meta = READINESS_META[row.readiness_status]
                return (
                  <li key={row.ad_account_id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        to={`/accounts/${row.ad_account_id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {row.display_name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <Badge tone={meta.tone} dot>
                          {meta.label}
                        </Badge>
                        <Progress value={row.completed_item_count} total={row.required_item_count} />
                      </div>
                    </div>
                    {row.reasons.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {row.reasons.slice(0, 4).map((reason, index) => (
                          <li key={`${reason.code}-${index}`} className="text-[12px] text-ink-muted">
                            · {reason.message}
                          </li>
                        ))}
                        {row.reasons.length > 4 && (
                          <li className="text-[12px] text-ink-faint">
                            +{row.reasons.length - 4} more
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}
