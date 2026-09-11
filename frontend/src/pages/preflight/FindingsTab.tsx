import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, PreflightFinding } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { FINDING_SEVERITY_META, FINDING_STATUS_META } from '../../lib/preflight'
import { humanise } from '../../lib/format'
import PreflightFindingDrawer from '../../components/PreflightFindingDrawer'

export default function FindingsTab({ draft, onChanged }: { draft: CampaignDraft; onChanged: () => void }) {
  const [selected, setSelected] = useState<PreflightFinding | null>(null)

  const findings = useQuery({
    queryKey: ['preflight-findings', draft.id],
    queryFn: () => api.get<PreflightFinding[]>(`/api/v1/campaign-drafts/${draft.id}/findings`),
  })

  if (findings.isLoading) return <Skeleton rows={6} />
  if (findings.isError) return <ErrorState error={findings.error} onRetry={() => findings.refetch()} />

  const rows = findings.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No open findings"
        description="Either this draft has never been evaluated, or the last evaluation found nothing to flag."
      />
    )
  }

  const ordered = [...rows].sort((a, b) => {
    const rank = { blocking: 0, warning: 1, info: 2 }
    return rank[a.severity] - rank[b.severity]
  })

  return (
    <>
      <Card title={`Findings — ${rows.length}`}>
        <div className="table-scroll">
          <table className="w-full min-w-[800px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Severity</th>
                <th className="th">Category</th>
                <th className="th">Message</th>
                <th className="th">Status</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((finding) => {
                const severity = FINDING_SEVERITY_META[finding.severity]
                const status = FINDING_STATUS_META[finding.status]
                return (
                  <tr key={finding.id} className="hover:bg-surface-muted">
                    <td className="td">
                      <Badge tone={severity.tone} dot>{severity.label}</Badge>
                    </td>
                    <td className="td text-[12px] text-ink-muted">{humanise(finding.category)}</td>
                    <td className="td max-w-[420px] text-[12.5px]">
                      {finding.message}
                      <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {finding.rule_key} v{finding.rule_version}
                      </div>
                    </td>
                    <td className="td">
                      <Badge tone={status.tone} title={status.hint}>{status.label}</Badge>
                    </td>
                    <td className="td">
                      <button type="button" className="btn-secondary" onClick={() => setSelected(finding)}>
                        {finding.status === 'open' || finding.status === 'acknowledged' ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PreflightFindingDrawer
        finding={selected}
        readOnly={draft.archived_at !== null}
        onClose={() => setSelected(null)}
        onChanged={onChanged}
      />
    </>
  )
}
