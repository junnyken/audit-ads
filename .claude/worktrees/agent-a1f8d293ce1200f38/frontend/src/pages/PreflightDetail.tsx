import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight, MoreHorizontal, Play } from 'lucide-react'
import { api } from '../lib/api'
import type { CampaignDraft, PreflightEvaluationRun } from '../lib/types'
import { DRAFT_STATUS_META } from '../lib/preflight'
import PreflightDraftFormDrawer from '../components/PreflightDraftFormDrawer'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/primitives/dropdown-menu'
import { ErrorState, LoadingRegion } from '../components/states'
import { ConfirmDialog } from '../components/page/ConfirmDialog'
import { Note } from './account/parts'
import OverviewTab from './preflight/OverviewTab'
import FindingsTab from './preflight/FindingsTab'
import EvidenceTab from './preflight/EvidenceTab'
import RunsTab from './preflight/RunsTab'
import AuditTab from './preflight/AuditTab'

/** Tab keys are part of the URL (`?tab=`) and so of every bookmark: do not rename them. */
const TAB_KEYS = ['overview', 'findings', 'evidence', 'runs', 'audit'] as const
type TabKey = (typeof TAB_KEYS)[number]

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value)
}

export default function PreflightDetail() {
  const { draftId = '' } = useParams()
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: TabKey = isTabKey(requested) ? requested : 'overview'
  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }
  const [editing, setEditing] = useState(false)
  const [lastRunFailure, setLastRunFailure] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'archive' | 'restore' | null>(null)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)

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

  // Archive / restore: ask, write, then re-read the draft and say what the server now holds.
  const change = useMutation({
    mutationFn: async (kind: 'archive' | 'restore') => {
      await api.post(`/api/v1/campaign-drafts/${draftId}/${kind}`)
      const fresh = await queryClient.fetchQuery({
        queryKey: ['preflight-draft', draftId],
        queryFn: () => api.get<CampaignDraft>(`/api/v1/campaign-drafts/${draftId}`),
        staleTime: 0,
      })
      return { kind, fresh }
    },
    onSuccess: ({ kind, fresh }) => {
      refresh()
      const isArchived = fresh.archived_at !== null
      const ok = kind === 'archive' ? isArchived : !isArchived
      setReadBack(
        ok
          ? { ok, text: t(kind === 'archive' ? 'pf.readback.archived' : 'pf.readback.restored', { title: fresh.title }) }
          : { ok, text: t('pf.readback.mismatch') },
      )
      setConfirm(null)
    },
  })
  const evaluate = useMutation({
    mutationFn: () => api.post<PreflightEvaluationRun>(`/api/v1/campaign-drafts/${draftId}/evaluate`),
    onSuccess: (run) => {
      // A 200 response only means the API call worked — the run itself can still have failed
      // (a rule/fetch bug), and that must never read as a silent "ready" (A6 guardrail 16).
      setLastRunFailure(run.status === 'failed' ? run.error_summary ?? t('pf.runFailed.fallback') : null)
      refresh()
    },
  })

  if (draft.isLoading) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-56 w-full" />
      </LoadingRegion>
    )
  }
  if (draft.isError) {
    return (
      <div className="space-y-3">
        <ErrorState error={draft.error} onRetry={() => draft.refetch()} title={t('pf.detail.error')} />
        <Link to="/preflight" className="text-sm font-medium text-brand-text hover:underline">
          {t('pf.detail.back')}
        </Link>
      </div>
    )
  }

  const record = draft.data!
  const meta = DRAFT_STATUS_META[record.draft_status]
  const archived = record.archived_at !== null

  return (
    <div className="space-y-4">
      <nav aria-label={t('pf.breadcrumb')} className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to="/preflight" className="hover:underline">
          {t('nav.item.preflight')}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span aria-current="page" className="text-ink">
          {record.title}
        </span>
      </nav>

      <Card className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 tabIndex={-1} className="text-xl font-semibold leading-7 outline-none">
              {record.title}
            </h1>
            <Badge tone={meta?.tone ?? 'neutral'} dot title={enumLabel('draftStatusHint', record.draft_status)}>
              {enumLabel('draftStatus', record.draft_status)}
            </Badge>
          </div>
          <p className="text-sm text-ink-muted">
            {record.account_display_name ?? t('pf.noAccount')}
            {record.objective ? ` · ${enumLabel('objective', record.objective)}` : ''}
          </p>
          <p className="max-w-2xl text-xs text-ink-muted">{enumLabel('draftStatusHint', record.draft_status)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {archived ? (
            <Button type="button" onClick={() => setConfirm('restore')}>
              {t('pf.restore')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                {t('pf.edit')}
              </Button>
              <Button type="button" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
                <Play className="h-4 w-4" aria-hidden="true" />
                {evaluate.isPending ? t('pf.running') : t('pf.run')}
              </Button>
              {/* modal={false}: a modal menu that opens a modal dialog leaves the page unclickable. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label={t('pf.more')}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setConfirm('archive')}>{t('pf.archive')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </Card>

      {evaluate.isError && <ErrorState error={evaluate.error} title={t('pf.error.run')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
      {lastRunFailure && (
        <div role="alert" className="rounded-lg border border-tone-attention-border bg-tone-attention-bg px-4 py-3 text-sm text-tone-attention-fg">
          <p className="font-semibold">{t('pf.runFailed.title')}</p>
          <p className="mt-0.5">{lastRunFailure}</p>
          <p className="mt-1 text-xs">{t('pf.runFailed.body')}</p>
        </div>
      )}
      {readBack && (
        <Note role="status" tone={readBack.ok ? 'info' : 'caution'}>
          {readBack.text}
        </Note>
      )}
      {archived && <Note role="note">{t('pf.archivedNote')}</Note>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('pf.tabs.label')}>
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`pf.tab.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab draft={record} />
        </TabsContent>
        <TabsContent value="findings">
          <FindingsTab draft={record} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceTab draft={record} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab draft={record} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab draft={record} />
        </TabsContent>
      </Tabs>

      <PreflightDraftFormDrawer open={editing} draft={record} onClose={() => setEditing(false)} onSaved={refresh} />

      <Note>{t('pf.disclaimer')}</Note>

      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => {
          setConfirm(null)
          change.reset()
        }}
        title={confirm === 'restore' ? t('pf.restore.title') : t('pf.archive.title')}
        object={t('pf.archive.object', { title: record.title })}
        effects={
          confirm === 'restore'
            ? [t('pf.restore.effect'), t('pf.restore.reversible')]
            : [t('pf.archive.effect'), t('pf.archive.keeps'), t('pf.archive.reversible')]
        }
        confirmLabel={confirm === 'restore' ? t('pf.restore.confirm') : t('pf.archive.confirm')}
        tone={confirm === 'restore' ? 'default' : 'destructive'}
        pending={change.isPending}
        error={change.isError ? change.error : undefined}
        onConfirm={() => confirm && change.mutate(confirm)}
      />
    </div>
  )
}
