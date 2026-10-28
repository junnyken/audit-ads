import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { FacebookIdentitySummary, Paged, ReferenceRecord, TeamMember } from '../lib/types'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { PageHeader } from '../components/page/PageHeader'
import { SearchField, SelectField } from '../components/page/Filters'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { EmptyState, ErrorState } from '../components/states'
import { Badge } from '../components/primitives/badge'
import { Card } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { twoFactorTone } from '../lib/readiness'

export default function FacebookAccounts() {
  const { t } = useI18n(); const enumLabel = useEnumLabel(); const [search, setSearch] = useState(''); const [holder, setHolder] = useState('')
  const list = useQuery({ queryKey: ['personal-account-references', 'facebook-list', search], queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/personal-account-references${query({ search, page_size: 200 })}`) })
  const summary = useQuery({ queryKey: ['facebook-identities', 'summary'], queryFn: () => api.get<FacebookIdentitySummary[]>('/api/v1/facebook-identities/summary') })
  const members = useQuery({ queryKey: ['team-members', 'options'], queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'), retry: false })
  const bySummary = useMemo(() => new Map((summary.data ?? []).map((row) => [row.id, row])), [summary.data])
  const rows = (list.data?.items ?? []).filter((row) => !holder || row.owner_member_id === holder)
  const columns = [t('res.f.label'), t('fb.owner'), t('fb.twoFactor'), t('fb.businessManagers'), t('fb.adAccounts'), t('fb.status')]
  return <div className="space-y-4">
    <PageHeader title={t('fb.title')} description={t('fb.desc')} />
    <div className="flex flex-wrap items-end gap-2"><SearchField label={t('pg.search')} placeholder={t('fb.search')} value={search} onApply={setSearch} />
      {members.data && <SelectField label={t('fb.owner')} value={holder} onChange={setHolder} options={[['', t('fb.anyOwner')], ...members.data.map((m) => [m.id, m.full_name || m.email] as [string, string])]} />}</div>
    {list.isLoading ? <TableSkeleton columns={columns} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} title={t('fb.error.title')} /> : rows.length === 0 ? <EmptyState title={t('fb.empty.title')} description={t('fb.empty.body')} action={<Link className="font-medium text-brand-text hover:underline" to="/assets">{t('fb.empty.action')}</Link>} /> : <Card><Table cards aria-label={t('fb.title')}><TableHeader><TableRow className="hover:bg-transparent">{columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader><TableBody>
      {rows.map((row) => { const s = bySummary.get(row.id); return <TableRow key={row.id}>
        <TableCell label={columns[0]} className="cell-title"><Link to={`/facebook-accounts/${row.id}`} className="font-medium text-brand-text hover:underline">{String(row.label)}</Link></TableCell>
        <TableCell label={columns[1]}>{s?.owner_member_name ?? '—'}</TableCell>
        <TableCell label={columns[2]}><Badge tone={twoFactorTone(String(row.two_factor_method))}>{t(`twoFactor.${String(row.two_factor_method)}` as never)}</Badge></TableCell>
        <TableCell label={columns[3]}>{s ? s.business_manager_count : '—'}</TableCell><TableCell label={columns[4]}>{s ? s.ad_account_count : '—'}</TableCell>
        <TableCell label={columns[5]}><Badge tone={String(row.status) === 'active' ? 'positive' : 'neutral'}>{enumLabel('refStatus', String(row.status))}</Badge></TableCell></TableRow> })}
    </TableBody></Table></Card>}
  </div>
}
