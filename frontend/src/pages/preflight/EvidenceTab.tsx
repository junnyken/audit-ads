import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, LandingPageEvidence } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { formatDateTime } from '../../lib/format'

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-ink-faint">—</span>
  return <Badge tone={value ? 'positive' : 'caution'}>{value ? 'Yes' : 'No'}</Badge>
}

export default function EvidenceTab({ draft }: { draft: CampaignDraft }) {
  const evidence = useQuery({
    queryKey: ['preflight-evidence', draft.id],
    queryFn: () => api.get<LandingPageEvidence[]>(`/api/v1/campaign-drafts/${draft.id}/landing-page-evidence`),
  })

  if (evidence.isLoading) return <Skeleton rows={6} />
  if (evidence.isError) return <ErrorState error={evidence.error} onRetry={() => evidence.refetch()} />

  const rows = evidence.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No landing-page checks yet"
        description={
          draft.landing_page_url
            ? "Run an evaluation to fetch this — safety-bounded metadata only, never the page's HTML."
            : 'This draft has no landing page URL set.'
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const stale = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false
        return (
          <Card
            key={row.id}
            title={
              <span className="flex items-center gap-2">
                Checked {formatDateTime(row.checked_at)}
                {stale && <Badge tone="caution">Stale — cache expired</Badge>}
              </span>
            }
          >
            <p className="mb-3 break-all font-mono text-[11.5px] text-ink-faint">{row.url}</p>
            {row.fetch_error ? (
              <div role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">
                Fetch error: {row.fetch_error}
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-y-2 text-[12.5px] sm:grid-cols-4">
              <Row label="HTTP status">{row.http_status ?? '—'}</Row>
              <Row label="HTTPS">
                <YesNo value={row.is_https} />
              </Row>
              <Row label="Redirects">{row.redirect_count ?? '—'}</Row>
              <Row label="Response time">{row.response_time_ms !== null ? `${row.response_time_ms}ms` : '—'}</Row>
              <Row label="Mobile viewport">
                <YesNo value={row.mobile_viewport_meta_present} />
              </Row>
              <Row label="Contact/policy link">
                <YesNo value={row.contact_or_policy_link_detected} />
              </Row>
              <Row label="Final URL">
                <span className="break-all">{row.final_url ?? '—'}</span>
              </Row>
              <Row label="Expires">{row.expires_at ? formatDateTime(row.expires_at) : '—'}</Row>
            </dl>
          </Card>
        )
      })}
      <p className="text-[11px] text-ink-faint">
        Only the fields above are ever stored — the fetched page&apos;s full HTML is never
        persisted.
      </p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
