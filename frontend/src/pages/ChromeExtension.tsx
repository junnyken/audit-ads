import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useI18n, type TranslationKey } from '../i18n'
import type { ExtensionProvenanceKey } from '../i18n/extensionProvenance'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { exactExtensionAccounts, rawSnapshotValue, safeStoredNetworkReference } from '../lib/extensionProvenance'
import { fetchRealLocalChromeProfiles } from '../lib/chromeProfileLauncher'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'

export default function ChromeExtension() {
  const { t } = useI18n()
  // Dictionary exports are integrated centrally by the main worker.
  const text = (key: ExtensionProvenanceKey, vars?: Record<string, string | number>) => t(key as TranslationKey, vars)
  const [selectedViaId, setSelectedViaId] = useState('')
  const [selectedProfile, setSelectedProfile] = useState('')
  const viasQuery = useQuery({
    queryKey: ['personal-account-references', 'ext-page'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=100'),
  })
  const accountsQuery = useQuery({
    queryKey: ['ad-accounts', 'ext-page'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })
  const profilesQuery = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    staleTime: 60_000,
  })
  const vias = viasQuery.data?.items ?? []
  const selectedVia = vias.find(via => via.id === selectedViaId)
  const viaAccounts = exactExtensionAccounts(accountsQuery.data?.items ?? [], selectedVia?.id ?? '')
  const network = safeStoredNetworkReference(selectedVia?.network_label)
  const profiles = profilesQuery.isError ? [] : profilesQuery.data ?? []
  const profileValue = profiles.some(profile => profile.folder === selectedProfile) ? selectedProfile : ''
  const failed = viasQuery.isError || accountsQuery.isError
  const loading = viasQuery.isPending || accountsQuery.isPending
  const unknown = text('extensionProvenance.unknown')
  const statusLabels: Record<string, ExtensionProvenanceKey> = {
    active: 'extensionProvenance.active', restricted: 'extensionProvenance.restricted',
    disabled: 'extensionProvenance.disabled', archived: 'extensionProvenance.archived',
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{text('extensionProvenance.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p>{text('extensionProvenance.retired')}</p>
          <Button disabled>{text('extensionProvenance.bundle')}</Button>
          <p className="text-sm text-ink-muted">{text('extensionProvenance.scope')}</p>
          <a className="text-brand underline" href="https://business.facebook.com/overview" target="_blank" rel="noopener noreferrer">{text('extensionProvenance.portal')}</a>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3">
          <label className="block" htmlFor="extension-profile">{text('extensionProvenance.profile')}</label>
          <select id="extension-profile" className="rounded border border-line bg-surface p-2" value={profileValue} disabled={!profiles.length || profilesQuery.isFetching} onChange={event => setSelectedProfile(event.target.value)}>
            <option value="">{text('extensionProvenance.noProfile')}</option>
            {profiles.map(profile => <option key={profile.folder} value={profile.folder}>{profile.name || profile.folder}</option>)}
          </select>
          {!profiles.length && <p>{text('extensionProvenance.profileUnknown')}</p>}
          <p className="text-sm text-ink-muted">{text('extensionProvenance.noLaunch')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4">
          <label className="block" htmlFor="extension-via">{text('extensionProvenance.subject')}</label>
          <select id="extension-via" className="max-w-full rounded border border-line bg-surface p-2" value={selectedVia?.id ?? ''} disabled={viasQuery.isPending || viasQuery.isError} onChange={event => setSelectedViaId(event.target.value)}>
            <option value="">{text('extensionProvenance.choose')}</option>
            {vias.map(via => <option key={via.id} value={via.id}>{typeof via.label === 'string' && via.label ? via.label : via.id}</option>)}
          </select>
          {failed ? <p role="alert">{text('extensionProvenance.error')}</p> : loading ? <p role="status">{text('extensionProvenance.loading')}</p> : <>
            {!vias.length && <p>{text('extensionProvenance.emptyReferences')}</p>}
            {!selectedVia ? <p>{text('extensionProvenance.chooseHint')}</p> : <>
              <p>{text('extensionProvenance.network')}: {network === 'withheld' ? text('extensionProvenance.hiddenReference') : network ?? unknown}</p>
              <p>{text('extensionProvenance.count', { count: viaAccounts.length })}</p>
              {!viaAccounts.length && <p>{text('extensionProvenance.empty')}</p>}
              {!!viaAccounts.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead><tr>{(['account', 'status', 'balance', 'currency', 'payment', 'asOf'] as const).map(key => <th className="p-2" key={key} scope="col">{text(`extensionProvenance.${key}`)}</th>)}</tr></thead>
                <tbody>{viaAccounts.map(account => <tr key={account.id} className="border-t border-line">
                  <td className="p-2">{account.display_name || account.external_account_id || account.id}</td>
                  <td className="p-2">{text(statusLabels[account.status] ?? 'extensionProvenance.unknown')}</td>
                  <td className="p-2">{rawSnapshotValue(account.billing_meta?.balance_raw ?? account.spend_periods?.balance_raw, unknown)}</td>
                  <td className="p-2">{rawSnapshotValue(account.currency, unknown)}</td>
                  <td className="p-2">{rawSnapshotValue(account.billing_meta?.payment_card_display, unknown)}</td>
                  <td className="p-2">{rawSnapshotValue(account.last_synced_at, unknown)}</td>
                </tr>)}</tbody>
              </table></div>}
              <p className="text-sm text-ink-muted">{text('extensionProvenance.noAggregate')}</p>
            </>}
          </>}
        </CardContent>
      </Card>
    </div>
  )
}
