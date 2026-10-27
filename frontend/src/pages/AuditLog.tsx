import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { AuditEntry, Paged } from '../lib/types'
import AuditDiff from '../components/AuditDiff'
import { formatCount, formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { EmptyState, ErrorState } from '../components/states'
import { PageHeader } from '../components/page/PageHeader'
import { FilterChips, SearchField, SelectField } from '../components/page/Filters'
import type { FilterChip } from '../components/page/Filters'
import { ListToolbar } from '../components/page/ListToolbar'
import { Pager } from '../components/page/Pager'
import { ListSkeleton } from '../components/page/TableSkeleton'

const ENTITY_TYPES = [
  'ad_account',
  'business_manager',
  'personal_account_reference',
  'account_asset_link',
  'readiness_checklist_item',
  'readiness_evidence',
  'account_event',
]

export default function AuditLog() {
  const { t } = useI18n()
  const [filters, setFilters] = useState({ action: '', entity_type: '', page: 1 })
  const logs = useQuery({
    queryKey: ['audit', filters],
    queryFn: () => api.get<Paged<AuditEntry>>(`/api/v1/audit-logs${query({ ...filters, page_size: 50 })}`),
  })

  const chips: FilterChip[] = []
  if (filters.action) chips.push({ key: 'action', text: `${t('aud.filter.action')}: ${filters.action}`, clear: { action: null } })
  if (filters.entity_type) chips.push({ key: 'entity_type', text: `${t('aud.filter.entity')}: ${t(`aud.entity.${filters.entity_type}` as 'aud.entity.ad_account')}`, clear: { entity_type: null } })
  const filtersActive = chips.length > 0
  const clearAll = () => setFilters({ action: '', entity_type: '', page: 1 })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('aud.title')}
        description={t('aud.desc')}
        meta={logs.data ? t('aud.count', { count: formatCount(logs.data.total) }) : '—'}
      />

      <ListToolbar
        label={t('aud.toolbar')}
        primary={
          <>
            <SearchField
              label={t('aud.filter.action')}
              placeholder="ad_account.updated"
              value={filters.action}
              onApply={(value) => setFilters((current) => ({ ...current, action: value, page: 1 }))}
            />
            <SelectField
              label={t('aud.filter.entity')}
              value={filters.entity_type}
              onChange={(value) => setFilters((current) => ({ ...current, entity_type: value, page: 1 }))}
              options={[['', t('filter.any')], ...ENTITY_TYPES.map((v) => [v, t(`aud.entity.${v}` as 'aud.entity.ad_account')] as [string, string])]}
            />
          </>
        }
      />
      <FilterChips
        chips={chips}
        onClear={(patch) => setFilters((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, ''])), page: 1 }))}
        onClearAll={clearAll}
      />

      {logs.isLoading ? (
        <ListSkeleton lines={8} />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} title={t('aud.error.title')} />
      ) : logs.data!.items.length === 0 ? (
        <EmptyState
          title={t('aud.empty.title')}
          description={filtersActive ? t('aud.empty.filtered') : t('aud.empty.none')}
          action={
            filtersActive && (
              <Button type="button" variant="secondary" onClick={clearAll}>
                {t('aud.clear')}
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('aud.count', { count: formatCount(logs.data!.total) })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {logs.data!.items.map((entry) => (
                <li key={entry.id} className="border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {/* Audit identifiers are shown exactly as recorded, in mono: they are the record. */}
                    <span className="font-mono font-medium">{entry.action}</span>
                    <span className="font-mono text-xs text-ink-muted">{entry.entity_type}</span>
                    <span className="font-mono text-xs text-ink-muted">{entry.entity_id.slice(0, 8)}</span>
                    <span className="text-xs tabular-nums text-ink-muted">{formatDateTime(entry.created_at)}</span>
                    <span className="text-xs text-ink-muted">{entry.actor_email ?? t('au.actor.system')}</span>
                    {entry.request_id && (
                      <span className="font-mono text-xs text-ink-muted">{t('aud.request', { id: entry.request_id.slice(0, 8) })}</span>
                    )}
                  </div>
                  <AuditDiff before={entry.before_json} after={entry.after_json} metadata={entry.metadata_json} />
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Pager
                page={logs.data!.page}
                pages={logs.data!.total_pages}
                onPage={(page) => setFilters((current) => ({ ...current, page }))}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
