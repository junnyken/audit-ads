import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { ReadinessStatus } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion } from '../components/states'
import { ChecklistProgress } from '../components/dashboard/ChecklistProgress'
import { PageHeader } from '../components/page/PageHeader'
import { Note } from './account/parts'
import { READINESS_META, severityTone } from '../lib/readiness'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { formatCount } from '../lib/format'

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

const FILTERS = ['', 'not_ready', 'unknown', 'ready_with_warnings', 'operationally_ready']

export default function ReadinessPage() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [filter, setFilter] = useState('')
  const board = useQuery({
    queryKey: ['readiness-board', filter],
    queryFn: () =>
      api.get<Board>(`/api/v1/ad-accounts/readiness/board${query({ readiness_status: filter })}`),
  })

  return (
    <div className="space-y-4">
      <PageHeader title={t('rdb.title')} description={t('rdb.desc')} />

      <div role="group" aria-label={t('rdb.filter.label')} className="flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? 'default' : 'secondary'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === '' ? t('rdb.filter.all') : enumLabel('readiness', value)}
          </Button>
        ))}
      </div>

      <Note>{t('rdb.readonly')}</Note>

      {board.isLoading ? (
        <LoadingRegion className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          {[0, 1].map((key) => (
            <Card key={key} className="space-y-3 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </LoadingRegion>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} title={t('rdb.error.title')} />
      ) : board.data!.rows.length === 0 ? (
        <EmptyState
          title={t('rdb.empty.title')}
          description={t('rdb.empty.body')}
          action={
            filter !== '' && (
              <Button type="button" variant="secondary" onClick={() => setFilter('')}>
                {t('rdb.empty.reset')}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('rdb.groups.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {board.data!.groups.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('rdb.groups.empty')}</p>
              ) : (
                <ul className="space-y-3">
                  {board.data!.groups.map((group) => (
                    <li key={group.code}>
                      <div className="flex items-center gap-2">
                        <Badge tone={severityTone(group.severity)} title={t('rdb.groups.count', { count: group.accounts.length })}>
                          {formatCount(group.accounts.length)}
                        </Badge>
                        <span className="font-mono text-xs text-ink-muted">{group.code}</span>
                      </div>
                      <p className="mt-0.5 text-sm">{group.message}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {group.accounts.map((account) => (
                          <Link
                            key={account.ad_account_id}
                            to={`/accounts/${account.ad_account_id}`}
                            className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-brand-text hover:underline"
                          >
                            {account.display_name}
                          </Link>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('rdb.accounts.title', { count: formatCount(board.data!.rows.length) })}</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <ul className="divide-y divide-line">
                {board.data!.rows.map((row) => {
                  const meta = READINESS_META[row.readiness_status]
                  return (
                    <li key={row.ad_account_id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/accounts/${row.ad_account_id}`} className="font-medium text-brand-text hover:underline">
                          {row.display_name}
                        </Link>
                        <div className="flex items-center gap-2">
                          <Badge tone={meta?.tone ?? 'neutral'} dot>
                            {enumLabel('readiness', row.readiness_status)}
                          </Badge>
                          <ChecklistProgress done={row.completed_item_count} total={row.required_item_count} />
                        </div>
                      </div>
                      {row.reasons.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {row.reasons.slice(0, 4).map((reason, index) => (
                            <li key={`${reason.code}-${index}`} className="text-xs text-ink-muted">
                              · {reason.message}
                            </li>
                          ))}
                          {row.reasons.length > 4 && (
                            <li className="text-xs text-ink-faint">{t('rdb.more', { count: row.reasons.length - 4 })}</li>
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
