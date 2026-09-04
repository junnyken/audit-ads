import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { AdAccount, Readiness } from '../lib/types'
import { Badge, ErrorState, Progress, Skeleton, Tabs } from '../components/ui'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import AccountFormDrawer from '../components/AccountFormDrawer'
import OverviewTab from './account/OverviewTab'
import AssetsTab from './account/AssetsTab'
import ReadinessTab from './account/ReadinessTab'
import EventsTab from './account/EventsTab'
import AuditTab from './account/AuditTab'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Assets & References' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'events', label: 'Events' },
  { key: 'audit', label: 'Audit History' },
]

export default function AccountDetail() {
  const { accountId = '' } = useParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)

  const account = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => api.get<AdAccount>(`/api/v1/ad-accounts/${accountId}`),
  })
  const readiness = useQuery({
    queryKey: ['readiness', accountId],
    queryFn: () => api.get<Readiness>(`/api/v1/ad-accounts/${accountId}/readiness`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['account', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['readiness', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['checklist', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['events', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['asset-links', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['account-audit', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
  }

  const archive = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/archive`),
    onSuccess: refresh,
  })
  const restore = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/restore`),
    onSuccess: refresh,
  })
  const recalculate = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/readiness/recalculate`),
    onSuccess: refresh,
  })

  if (account.isLoading) return <Skeleton rows={8} />
  if (account.isError) return <ErrorState error={account.error} onRetry={() => account.refetch()} />

  const record = account.data!
  const meta = READINESS_META[record.readiness_status]
  const archived = record.archived_at !== null

  return (
    <div className="space-y-4">
      <nav className="text-[12px] text-ink-muted">
        <Link to="/accounts" className="hover:underline">
          Accounts
        </Link>
        <span className="mx-1">/</span>
        <span className="text-ink">{record.display_name}</span>
      </nav>

      <header className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold">{record.display_name}</h1>
            <Badge tone={accountStatusTone(archived ? 'archived' : record.status)}>
              {archived ? 'Archived' : record.status.replace(/_/g, ' ')}
            </Badge>
            <Badge tone={meta.tone} dot title={meta.description}>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-ink-faint">
            {record.external_account_id ?? 'No external ID recorded'}
          </p>
          {readiness.data && (
            <div className="mt-2">
              <Progress
                value={readiness.data.completed_item_count}
                total={readiness.data.required_item_count}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => recalculate.mutate()}
            disabled={recalculate.isPending}
          >
            {recalculate.isPending ? 'Recalculating…' : 'Recalculate readiness'}
          </button>
          {!archived && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {archived ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (window.confirm('Archive this account? It stays fully readable and auditable, and can be restored.')) {
                  archive.mutate()
                }
              }}
              disabled={archive.isPending}
            >
              Archive
            </button>
          )}
        </div>
      </header>

      {archived && (
        <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink-muted">
          This account is archived. It is excluded from active readiness assessment and cannot be
          edited until it is restored. All history remains visible.
        </p>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab account={record} readiness={readiness} onChanged={refresh} />}
      {tab === 'assets' && <AssetsTab account={record} onChanged={refresh} />}
      {tab === 'readiness' && <ReadinessTab account={record} onChanged={refresh} />}
      {tab === 'events' && <EventsTab account={record} onChanged={refresh} />}
      {tab === 'audit' && <AuditTab account={record} />}

      <AccountFormDrawer
        open={editing}
        account={record}
        onClose={() => setEditing(false)}
        onSaved={refresh}
      />
    </div>
  )
}
