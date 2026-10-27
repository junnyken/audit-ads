import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, LandingPageEvidence } from '../../lib/types'
import { formatDateTime } from '../../lib/format'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/primitives/badge'
import { EmptyState, ErrorState } from '../../components/states'
import { Note, Panel, TabSkeleton } from '../account/parts'

/** A boolean the evidence may not have determined: "Chưa xác định", never a made-up "No". */
function YesNo({ value }: { value: boolean | null }) {
  const { t } = useI18n()
  if (value === null)
    return (
      <span title={t('pf.evidence.unknown')}>
        <span aria-hidden="true" className="text-ink-faint">—</span>
        <span className="sr-only">{t('pf.evidence.unknown')}</span>
      </span>
    )
  return <Badge tone={value ? 'positive' : 'caution'}>{value ? t('pg.yes') : t('pg.no')}</Badge>
}

export default function EvidenceTab({ draft }: { draft: CampaignDraft }) {
  const { t } = useI18n()
  const evidence = useQuery({
    queryKey: ['preflight-evidence', draft.id],
    queryFn: () => api.get<LandingPageEvidence[]>(`/api/v1/campaign-drafts/${draft.id}/landing-page-evidence`),
  })

  if (evidence.isLoading) return <TabSkeleton cards={1} />
  if (evidence.isError) return <ErrorState error={evidence.error} onRetry={() => evidence.refetch()} title={t('pf.evidence.error')} />

  const rows = evidence.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('pf.evidence.empty.title')}
        description={draft.landing_page_url ? t('pf.evidence.empty.run') : t('pf.evidence.empty.noUrl')}
      />
    )
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const stale = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false
        return (
          <Panel
            key={row.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t('pf.evidence.checked', { time: formatDateTime(row.checked_at) })}
                {stale && <Badge tone="caution">{t('pf.evidence.stale')}</Badge>}
              </span>
            }
          >
            <p className="break-all font-mono text-xs text-ink-muted">{row.url}</p>
            {row.fetch_error ? <Note tone="attention" role="alert">{t('pf.evidence.fetchError', { error: row.fetch_error })}</Note> : null}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <Item label={t('pf.evidence.http')}>
                <span className="font-mono">{row.http_status ?? '—'}</span>
              </Item>
              <Item label={t('pf.evidence.https')}>
                <YesNo value={row.is_https} />
              </Item>
              <Item label={t('pf.evidence.redirects')}>
                <span className="font-mono">{row.redirect_count ?? '—'}</span>
              </Item>
              <Item label={t('pf.evidence.time')}>
                <span className="font-mono">{row.response_time_ms !== null ? `${row.response_time_ms} ms` : '—'}</span>
              </Item>
              <Item label={t('pf.evidence.viewport')}>
                <YesNo value={row.mobile_viewport_meta_present} />
              </Item>
              <Item label={t('pf.evidence.contact')}>
                <YesNo value={row.contact_or_policy_link_detected} />
              </Item>
              <Item label={t('pf.evidence.final')}>
                <span className="break-all">{row.final_url ?? '—'}</span>
              </Item>
              <Item label={t('pf.evidence.expires')}>{row.expires_at ? formatDateTime(row.expires_at) : '—'}</Item>
            </dl>
          </Panel>
        )
      })}
      <p className="text-xs text-ink-muted">{t('pf.evidence.note')}</p>
    </div>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
