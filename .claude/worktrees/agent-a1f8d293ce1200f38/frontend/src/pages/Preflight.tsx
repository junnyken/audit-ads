import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api, query } from '../lib/api'
import type { CampaignDraft, Paged } from '../lib/types'
import PreflightDraftFormDrawer from '../components/PreflightDraftFormDrawer'
import { DRAFT_STATUS_META } from '../lib/preflight'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState } from '../components/states'
import { PageHeader } from '../components/page/PageHeader'
import { CheckField, FilterChips, SearchField, SelectField } from '../components/page/Filters'
import type { FilterChip } from '../components/page/Filters'
import { ListToolbar } from '../components/page/ListToolbar'
import { Pager } from '../components/page/Pager'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Note } from './account/parts'

const STATUSES = ['draft', 'submitted_for_review', 'needs_changes', 'ready_for_manual_review', 'blocked_by_internal_policy', 'unknown_missing_evidence']

export default function Preflight() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [params, setParams] = useSearchParams()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const filters = {
    search: params.get('search') ?? '',
    draft_status: params.get('draft_status') ?? '',
    has_blocking_findings: params.get('has_blocking_findings') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: 25,
    sort: params.get('sort') ?? 'updated_at',
    sort_direction: params.get('sort_direction') ?? 'desc',
  }

  function update(patch: Record<string, string | number | boolean | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === false) next.delete(key)
      else next.set(key, String(value))
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const drafts = useQuery({
    queryKey: ['preflight-drafts', filters],
    queryFn: () => api.get<Paged<CampaignDraft>>(`/api/v1/campaign-drafts${query(filters)}`),
  })

  const rows = drafts.data?.items ?? []
  const chips: FilterChip[] = []
  if (filters.search) chips.push({ key: 'search', text: `${t('pg.search')}: ${filters.search}`, clear: { search: null } })
  if (filters.draft_status) chips.push({ key: 'draft_status', text: `${t('pf.filter.status')}: ${enumLabel('draftStatus', filters.draft_status)}`, clear: { draft_status: null } })
  if (filters.has_blocking_findings)
    chips.push({
      key: 'has_blocking_findings',
      text: `${t('pf.filter.blocking')}: ${filters.has_blocking_findings === 'true' ? t('pf.filter.hasBlocking') : t('pf.filter.noBlocking')}`,
      clear: { has_blocking_findings: null },
    })
  if (filters.archived) chips.push({ key: 'archived', text: t('filter.archivedOnly'), clear: { archived: null } })
  const filtersActive = chips.length > 0
  const clearAll = () => setParams({}, { replace: true })
  const columns = [t('pf.col.title'), t('pf.col.account'), t('pf.col.status'), t('pf.col.blocking'), t('pf.col.warning'), t('pf.col.evaluated'), t('pf.col.updated'), t('col.actions')]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('pf.title')}
        description={t('pf.desc')}
        meta={drafts.data ? t('pf.count', { count: formatCount(drafts.data.total) }) : '—'}
        actions={
          <Button type="button" onClick={() => setDrawerOpen(true)}>
            {t('pf.create')}
          </Button>
        }
      />

      <ListToolbar
        label={t('pf.toolbar')}
        primary={
          <>
            <SearchField label={t('pg.search')} placeholder={t('pf.search.placeholder')} value={filters.search} onApply={(value) => update({ search: value })} />
            <SelectField
              label={t('pf.filter.status')}
              value={filters.draft_status}
              onChange={(value) => update({ draft_status: value })}
              options={[['', t('filter.any')], ...STATUSES.map((v) => [v, enumLabel('draftStatus', v)] as [string, string])]}
            />
            <SelectField
              label={t('pf.filter.blocking')}
              value={filters.has_blocking_findings}
              onChange={(value) => update({ has_blocking_findings: value })}
              options={[['', t('filter.any')], ['true', t('pf.filter.hasBlocking')], ['false', t('pf.filter.noBlocking')]]}
            />
            <CheckField label={t('pg.archivedOnly')} checked={filters.archived} onChange={(checked) => update({ archived: checked })} />
          </>
        }
      />
      <FilterChips chips={chips} onClear={update} onClearAll={clearAll} />

      {drafts.isLoading ? (
        <TableSkeleton columns={columns} rows={8} />
      ) : drafts.isError ? (
        <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} title={t('pf.error.title')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('pf.empty.filtered.title') : t('pf.empty.none.title')}
          description={filtersActive ? t('pf.empty.filtered.body') : t('pf.empty.none.body')}
          action={
            filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearAll}>
                {t('filter.clear')}
              </Button>
            ) : (
              <Button type="button" onClick={() => setDrawerOpen(true)}>
                {t('pf.create')}
              </Button>
            )
          }
        />
      ) : (
        <>
          <Card>
            <Table cards aria-label={t('pf.title')}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('pf.col.title')}</TableHead>
                  <TableHead>{t('pf.col.account')}</TableHead>
                  <TableHead>{t('pf.col.status')}</TableHead>
                  <TableHead numeric>{t('pf.col.blocking')}</TableHead>
                  <TableHead numeric>{t('pf.col.warning')}</TableHead>
                  <TableHead>{t('pf.col.evaluated')}</TableHead>
                  <TableHead>{t('pf.col.updated')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((draft) => {
                  const meta = DRAFT_STATUS_META[draft.draft_status]
                  // No evaluation yet means there is no count at all: "0 blocking" would read as clean.
                  const evaluated = draft.last_evaluated_at !== null
                  return (
                    <TableRow key={draft.id}>
                      <TableCell className="cell-title min-w-[220px]">
                        <Link to={`/preflight/${draft.id}`} className="font-medium text-brand-text hover:underline">
                          {draft.title}
                        </Link>
                        {draft.objective && <span className="block text-xs text-ink-muted">{enumLabel('objective', draft.objective)}</span>}
                      </TableCell>
                      <TableCell label={t('pf.col.account')}>{draft.account_display_name ?? '—'}</TableCell>
                      <TableCell label={t('pf.col.status')}>
                        <Badge tone={meta?.tone ?? 'neutral'} dot title={enumLabel('draftStatusHint', draft.draft_status)}>
                          {enumLabel('draftStatus', draft.draft_status)}
                        </Badge>
                      </TableCell>
                      <TableCell label={t('pf.col.blocking')} numeric className="font-mono">
                        {evaluated ? (
                          <span className={draft.open_blocking_count > 0 ? 'font-semibold text-tone-attention-fg' : 'text-ink-muted'}>
                            {formatCount(draft.open_blocking_count)}
                          </span>
                        ) : (
                          <span title={t('pf.neverEvaluated')}>
                            <span aria-hidden="true" className="text-ink-faint">—</span>
                            <span className="sr-only">{t('pf.neverEvaluated')}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell label={t('pf.col.warning')} numeric className="font-mono">
                        {evaluated ? (
                          <span className={draft.open_warning_count > 0 ? 'font-semibold text-tone-caution-fg' : 'text-ink-muted'}>
                            {formatCount(draft.open_warning_count)}
                          </span>
                        ) : (
                          <span title={t('pf.neverEvaluated')}>
                            <span aria-hidden="true" className="text-ink-faint">—</span>
                            <span className="sr-only">{t('pf.neverEvaluated')}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell label={t('pf.col.evaluated')} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(draft.last_evaluated_at)}>
                        {formatRelative(draft.last_evaluated_at)}
                      </TableCell>
                      <TableCell label={t('pf.col.updated')} className="whitespace-nowrap text-xs text-ink-muted">
                        {formatDateTime(draft.updated_at)}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <Link to={`/preflight/${draft.id}`} aria-label={t('pf.openNamed', { name: draft.title })}>
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
          <Pager page={drafts.data!.page} pages={drafts.data!.total_pages} total={drafts.data!.total} onPage={(page) => update({ page })} />
        </>
      )}

      <Note>{t('pf.disclaimer')}</Note>

      <PreflightDraftFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
