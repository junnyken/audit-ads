import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, query } from '../../lib/api'
import type { AuditEntry, CampaignDraft, Paged } from '../../lib/types'
import { formatDateTime } from '../../lib/format'
import { useI18n } from '../../i18n'
import { Button } from '../../components/primitives/button'
import { EmptyState, ErrorState } from '../../components/states'
import AuditDiff from '../../components/AuditDiff'
import { Note, Panel, TabSkeleton } from '../account/parts'

/**
 * Scoped to the draft row's own audit trail (created/updated/archived/restored). Finding
 * acknowledge/resolve and evaluation-run events have their own audit rows too, under
 * `entity_type=preflight_finding` / `preflight_evaluation_run` — not merged in here, a scoped
 * simplification versus A1's account audit tab (documented, and stated on the tab itself).
 */
export default function AuditTab({ draft }: { draft: CampaignDraft }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const logs = useQuery({
    queryKey: ['preflight-audit', draft.id, page],
    queryFn: () =>
      api.get<Paged<AuditEntry>>(
        `/api/v1/audit-logs${query({ entity_type: 'campaign_draft', entity_id: draft.id, page, page_size: 25 })}`,
      ),
  })

  if (logs.isLoading) return <TabSkeleton cards={2} />
  if (logs.isError) return <ErrorState error={logs.error} onRetry={() => logs.refetch()} title={t('pf.audit.error')} />
  if (logs.data!.items.length === 0) {
    return <EmptyState title={t('pf.audit.empty.title')} description={t('pf.audit.empty.body')} />
  }
  const totalPages = logs.data!.total_pages || 1

  return (
    <Panel title={t('pf.audit.title', { count: logs.data!.total })}>
      <p className="text-xs text-ink-muted">{t('pf.audit.note')}</p>
      <Note>{t('pf.audit.scope')}</Note>
      <ol className="space-y-3">
        {logs.data!.items.map((entry) => (
          <li key={entry.id} className="border-l-2 border-line pl-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-medium">{entry.action}</span>
              <span className="text-xs tabular-nums text-ink-muted">{formatDateTime(entry.created_at)}</span>
              <span className="text-xs text-ink-muted">{entry.actor_email ?? t('au.actor.system')}</span>
              {entry.request_id && (
                <span className="font-mono text-xs text-ink-muted">{t('au.request', { id: entry.request_id.slice(0, 8) })}</span>
              )}
            </div>
            <AuditDiff before={entry.before_json} after={entry.after_json} metadata={entry.metadata_json} />
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-xs tabular-nums text-ink-muted">{t('common.page', { page: logs.data!.page, total: totalPages })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.prev')}
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
