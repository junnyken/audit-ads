import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FacebookIdentityProfile, Paged, ReferenceRecord } from '../lib/types'
import { useI18n } from '../i18n'
import { PageHeader } from '../components/page/PageHeader'
import { ErrorState, LoadingRegion } from '../components/states'
import { Skeleton } from '../components/primitives/skeleton'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { DL_CLASS, Note, Panel, Row } from './account/parts'
import { RevealEmailDialog } from '../components/facebook/RevealEmailDialog'
import { twoFactorTone } from '../lib/readiness'

export function isHttpsLink(value: string): boolean { return value.startsWith('https://') }

export default function FacebookAccountDetail() {
  const { identityId = '' } = useParams(); const { t } = useI18n(); const queryClient = useQueryClient(); const [revealOpen, setRevealOpen] = useState(false); const [bmId, setBmId] = useState('')
  const record = useQuery({ queryKey: ['personal-account-references', identityId], queryFn: () => api.get<ReferenceRecord>(`/api/v1/personal-account-references/${identityId}`) })
  const profile = useQuery({ queryKey: ['facebook-identities', identityId, 'profile'], queryFn: () => api.get<FacebookIdentityProfile>(`/api/v1/personal-account-references/${identityId}/profile`) })
  const bms = useQuery({ queryKey: ['business-managers', 'options'], queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200') })
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] }); void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] }) }
  const link = useMutation({ mutationFn: () => api.post(`/api/v1/personal-account-references/${identityId}/business-links`, { business_manager_id: bmId }), onSuccess: () => { setBmId(''); refresh() } })
  const unlink = useMutation({ mutationFn: (linkId: string) => api.post(`/api/v1/personal-account-references/${identityId}/business-links/${linkId}/unlink`), onSuccess: refresh })
  if (record.isLoading || profile.isLoading) return <LoadingRegion className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></LoadingRegion>
  if (record.isError || profile.isError || !record.data || !profile.data) return <ErrorState error={record.error ?? profile.error} title={t('fb.error.title')} onRetry={() => { void record.refetch(); void profile.refetch() }} />
  const r = record.data; const p = profile.data; const vault = String(r.vault_reference ?? '')
  return <div className="space-y-4"><PageHeader title={String(r.label)} description={t('fb.detail.title')} actions={<Link className="text-sm font-medium text-brand-text hover:underline" to="/facebook-accounts">{t('fb.back')}</Link>} />
    <div className="grid gap-4 xl:grid-cols-2"><Panel title={t('fb.detail.title')}><dl className={DL_CLASS}>
      <Row label={t('fb.owner')}>{p.owner_member_name ?? '—'}</Row><Row label={t('fb.twoFactor')}><Badge tone={twoFactorTone(String(r.two_factor_method))}>{t(`twoFactor.${String(r.two_factor_method)}` as never)}</Badge></Row>
      <Row label={t('fb.detail.email')}><span className="font-mono">{String(r.email_hint ?? t('fb.detail.emailNone'))}</span>{p.has_full_email && p.can_reveal_email && <Button type="button" variant="secondary" size="sm" className="ml-2" onClick={() => setRevealOpen(true)}>{t('fb.detail.reveal')}</Button>}</Row>
      <Row label={t('fb.detail.vault')}>{vault ? (isHttpsLink(vault) ? <a className="text-brand-text hover:underline" href={vault} target="_blank" rel="noreferrer noopener">{t('fb.detail.vault')}</a> : <span>{vault}</span>) : t('fb.detail.vaultNone')}</Row>
      <Row label={t('fb.detail.recovery')}>{String(r.recovery_note || '—')}</Row></dl></Panel>
    <Panel title={t('fb.detail.bm')}>{p.business_links.length ? <ul className="space-y-2">{p.business_links.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2"><span>{item.business_manager_name}</span><Button type="button" size="sm" variant="secondary" disabled={unlink.isPending} onClick={() => unlink.mutate(item.id)}>{t('ref.archive.confirm')}</Button></li>)}</ul> : <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (bmId) link.mutate() }}><label className="label" htmlFor="fb-bm">{t('fb.businessManagers')}</label><select id="fb-bm" className="input" value={bmId} onChange={(e) => setBmId(e.target.value)}><option value="">—</option>{(bms.data?.items ?? []).map((bm) => <option key={bm.id} value={bm.id}>{String(bm.name)}</option>)}</select><Button type="submit" disabled={!bmId || link.isPending}>{t('ref.add', { name: t('fb.businessManagers') })}</Button></form>{(link.isError || unlink.isError) && <ErrorState compact error={link.error ?? unlink.error} />}</Panel>
    <Panel title={t('fb.detail.accounts')}>{p.ad_accounts.length ? <ul className="space-y-1">{p.ad_accounts.map((a) => <li key={a.id}><Link to={`/accounts/${a.id}`} className="text-brand-text hover:underline">{a.display_name}</Link></li>)}</ul> : <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>}</Panel>
    <Panel title={t('fb.detail.readers')}>{p.readers.length ? <ul>{p.readers.map((x) => <li key={x.id}>{x.label}</li>)}</ul> : <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>}<Note>{t('fb.pin.desc')}</Note></Panel></div>
    <RevealEmailDialog identityId={identityId} open={revealOpen} onOpenChange={setRevealOpen} /></div>
}
