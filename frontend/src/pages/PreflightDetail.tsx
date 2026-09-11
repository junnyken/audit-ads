import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CampaignDraft, PreflightEvaluationRun } from '../lib/types'
import { Badge, ErrorState, Skeleton, Tabs } from '../components/ui'
import { DRAFT_STATUS_META, PREFLIGHT_DISCLAIMER } from '../lib/preflight'
import PreflightDraftFormDrawer from '../components/PreflightDraftFormDrawer'
import OverviewTab from './preflight/OverviewTab'
import FindingsTab from './preflight/FindingsTab'
import EvidenceTab from './preflight/EvidenceTab'
import RunsTab from './preflight/RunsTab'
import AuditTab from './preflight/AuditTab'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'findings', label: 'Findings' },
  { key: 'evidence', label: 'Landing Page Evidence' },
  { key: 'runs', label: 'Evaluation History' },
  { key: 'audit', label: 'Audit History' },
]

export default function PreflightDetail() {
  const { draftId = '' } = useParams()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') ?? 'overview'
  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }
  const [editing, setEditing] = useState(false)
  const [lastRunFailure, setLastRunFailure] = useState<string | null>(null)

  const draft = useQuery({
    queryKey: ['preflight-draft', draftId],
    queryFn: () => api.get<CampaignDraft>(`/api/v1/campaign-drafts/${draftId}`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['preflight-draft', draftId] })
    void queryClient.invalidateQueries({ queryKey: ['preflight-findings', draftId] })
    void queryClient.invalidateQueries({ queryKey: ['preflight-evidence', draftId] })
    void queryClient.invalidateQueries({ queryKey: ['preflight-runs', draftId] })
    void queryClient.invalidateQueries({ queryKey: ['preflight-drafts'] })
  }

  const archive = useMutation({
    mutationFn: () => api.post(`/api/v1/campaign-drafts/${draftId}/archive`),
    onSuccess: refresh,
  })
  const restore = useMutation({
    mutationFn: () => api.post(`/api/v1/campaign-drafts/${draftId}/restore`),
    onSuccess: refresh,
  })
  const evaluate = useMutation({
    mutationFn: () => api.post<PreflightEvaluationRun>(`/api/v1/campaign-drafts/${draftId}/evaluate`),
    onSuccess: (run) => {
      // A 200 response only means the API call worked — the run itself can still have failed
      // (a rule/fetch bug), and that must never read as a silent "ready" (A6 guardrail 16).
      setLastRunFailure(run.status === 'failed' ? run.error_summary ?? 'The evaluation failed.' : null)
      refresh()
    },
  })

  if (draft.isLoading) return <Skeleton rows={8} />
  if (draft.isError) return <ErrorState error={draft.error} onRetry={() => draft.refetch()} />

  const record = draft.data!
  const meta = DRAFT_STATUS_META[record.draft_status]
  const archived = record.archived_at !== null

  return (
    <div className="space-y-4">
      <nav className="text-[12px] text-ink-muted">
        <Link to="/preflight" className="hover:underline">Preflight</Link>
        <span className="mx-1">/</span>
        <span className="text-ink">{record.title}</span>
      </nav>

      <header className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold">{record.title}</h1>
            <Badge tone={meta.tone} dot title={meta.description}>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {record.account_display_name ?? 'No account linked'}
            {record.objective ? ` · ${record.objective}` : ''}
          </p>
          <p className="mt-2 max-w-2xl text-[12px] text-ink-faint">{meta.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => evaluate.mutate()}
            disabled={evaluate.isPending || archived}
          >
            {evaluate.isPending ? 'Evaluating…' : '▶ Run evaluation'}
          </button>
          {!archived && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {archived ? (
            <button type="button" className="btn-secondary" onClick={() => restore.mutate()} disabled={restore.isPending}>
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (window.confirm('Archive this draft? Findings and history are kept, and it can be restored.')) {
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

      {evaluate.isError && <ErrorState error={evaluate.error} />}
      {lastRunFailure && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-900">
          <p className="font-semibold">The evaluation did not complete</p>
          <p className="mt-0.5">{lastRunFailure}</p>
          <p className="mt-1 text-[11.5px] text-rose-700">
            The draft was set to "Unknown — missing evidence", not "Ready".
          </p>
        </div>
      )}

      {archived && (
        <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink-muted">
          This draft is archived. It is excluded from active evaluation and cannot be edited or
          re-evaluated until it is restored. All history remains visible.
        </p>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab draft={record} />}
      {tab === 'findings' && <FindingsTab draft={record} onChanged={refresh} />}
      {tab === 'evidence' && <EvidenceTab draft={record} />}
      {tab === 'runs' && <RunsTab draft={record} />}
      {tab === 'audit' && <AuditTab draft={record} />}

      <PreflightDraftFormDrawer open={editing} draft={record} onClose={() => setEditing(false)} onSaved={refresh} />

      <p className="text-[11px] text-ink-faint">{PREFLIGHT_DISCLAIMER}</p>
    </div>
  )
}
