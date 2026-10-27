import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, PreflightFinding } from '../../lib/types'
import { FINDING_SEVERITY_META, FINDING_STATUS_META } from '../../lib/preflight'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Card, CardHeader, CardTitle } from '../../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/primitives/table'
import { EmptyState, ErrorState } from '../../components/states'
import { TableSkeleton } from '../../components/page/TableSkeleton'
import PreflightFindingDrawer from '../../components/PreflightFindingDrawer'

export default function FindingsTab({ draft, onChanged }: { draft: CampaignDraft; onChanged: () => void }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [selected, setSelected] = useState<PreflightFinding | null>(null)

  const findings = useQuery({
    queryKey: ['preflight-findings', draft.id],
    queryFn: () => api.get<PreflightFinding[]>(`/api/v1/campaign-drafts/${draft.id}/findings`),
  })

  if (findings.isLoading)
    return <TableSkeleton columns={[t('pf.findings.col.severity'), t('pf.findings.col.category'), t('pf.findings.col.message'), t('pf.findings.col.status'), t('col.actions')]} rows={4} />
  if (findings.isError) return <ErrorState error={findings.error} onRetry={() => findings.refetch()} title={t('pf.findings.error')} />

  const rows = findings.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('pf.findings.empty.title')}
        // A draft that was never evaluated has no verdict; "no findings" there must not read as clean.
        description={draft.last_evaluated_at === null ? t('pf.findings.empty.never') : t('pf.findings.empty.evaluated')}
      />
    )
  }

  const ordered = [...rows].sort((a, b) => {
    const rank = { blocking: 0, warning: 1, info: 2 }
    return rank[a.severity] - rank[b.severity]
  })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('pf.findings.title', { count: rows.length })}</CardTitle>
        </CardHeader>
        <Table cards aria-label={t('pf.tab.findings')}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('pf.findings.col.severity')}</TableHead>
              <TableHead>{t('pf.findings.col.category')}</TableHead>
              <TableHead>{t('pf.findings.col.message')}</TableHead>
              <TableHead>{t('pf.findings.col.status')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('col.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((finding) => {
              const severity = FINDING_SEVERITY_META[finding.severity]
              const status = FINDING_STATUS_META[finding.status]
              const actionable = finding.status === 'open' || finding.status === 'acknowledged'
              const action = actionable ? t('pf.findings.review') : t('pf.findings.view')
              return (
                <TableRow key={finding.id}>
                  <TableCell label={t('pf.findings.col.severity')}>
                    <Badge tone={severity?.tone ?? 'neutral'} dot>
                      {enumLabel('findingSeverity', finding.severity)}
                    </Badge>
                  </TableCell>
                  <TableCell label={t('pf.findings.col.category')} className="text-xs text-ink-muted">
                    {enumLabel('findingCategory', finding.category)}
                  </TableCell>
                  <TableCell label={t('pf.findings.col.message')} className="max-w-[420px]">
                    {finding.message}
                    <span className="mt-0.5 block font-mono text-2xs text-ink-faint">
                      {finding.rule_key} v{finding.rule_version}
                    </span>
                  </TableCell>
                  <TableCell label={t('pf.findings.col.status')}>
                    <Badge tone={status?.tone ?? 'neutral'} title={enumLabel('findingStatusHint', finding.status)}>
                      {enumLabel('findingStatus', finding.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={t('pf.findings.openNamed', { action, rule: finding.rule_key })}
                      onClick={() => setSelected(finding)}
                    >
                      {action}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
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
