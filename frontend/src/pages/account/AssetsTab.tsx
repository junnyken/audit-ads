import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../../lib/api'
import type { AdAccount, AssetLink, AssetType, Paged, ReferenceRecord } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { EmptyState, ErrorState } from '../../components/states'
import { formatDateTime } from '../../lib/format'
import { useI18n } from '../../i18n'
import { DL_CLASS, Note, Panel, Row, TabSkeleton } from './parts'

const ASSET_KINDS: {
  type: AssetType
  path: string
  labelField: string
  singleActive: boolean
  hasNote: boolean
}[] = [
  { type: 'page', path: '/api/v1/pages', labelField: 'name', singleActive: false, hasNote: false },
  { type: 'pixel', path: '/api/v1/pixels', labelField: 'name', singleActive: false, hasNote: false },
  {
    type: 'payment_profile',
    path: '/api/v1/payment-profile-references',
    labelField: 'reference_code',
    singleActive: false,
    hasNote: true,
  },
  {
    type: 'browser_profile',
    path: '/api/v1/browser-profile-references',
    labelField: 'profile_reference',
    singleActive: true,
    hasNote: true,
  },
  {
    type: 'proxy',
    path: '/api/v1/proxy-references',
    labelField: 'proxy_reference',
    singleActive: true,
    hasNote: true,
  },
]

export default function AssetsTab({ account, onChanged }: { account: AdAccount; onChanged: () => void }) {
  const { t } = useI18n()
  const links = useQuery({
    queryKey: ['asset-links', account.id],
    queryFn: () => api.get<AssetLink[]>(`/api/v1/ad-accounts/${account.id}/asset-links`),
  })

  if (links.isLoading) return <TabSkeleton cards={3} />
  if (links.isError) return <ErrorState error={links.error} onRetry={() => links.refetch()} title={t('as.error.title')} />

  const all = links.data!
  const history = all.filter((link) => !link.is_active)

  return (
    <div className="space-y-4">
      <Panel title={t('as.ownership.title')}>
        <dl className={DL_CLASS}>
          <Row label={t('as.bm')}>{account.business_manager_name ?? t('ov.notMapped')}</Row>
          <Row label={t('as.personalRef')}>{account.personal_account_reference_label ?? t('ov.notMapped')}</Row>
        </dl>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {ASSET_KINDS.map((kind) => (
          <AssetSection
            key={kind.type}
            kind={kind}
            account={account}
            links={all.filter((link) => link.asset_type === kind.type && link.is_active)}
            onChanged={() => {
              onChanged()
              void links.refetch()
            }}
          />
        ))}
      </div>

      <Panel title={t('as.history.title')}>
        {history.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('as.history.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {history
              .slice()
              .sort((a, b) => (a.unlinked_at! < b.unlinked_at! ? 1 : -1))
              .map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="muted">{t(`as.kind.${link.asset_type}`)}</Badge>
                  <span className="font-medium">{link.asset_label ?? link.asset_id}</span>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {t('as.history.row', {
                      linked: formatDateTime(link.linked_at),
                      unlinked: formatDateTime(link.unlinked_at),
                    })}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function AssetSection({
  kind,
  account,
  links,
  onChanged,
}: {
  kind: (typeof ASSET_KINDS)[number]
  account: AdAccount
  links: AssetLink[]
  onChanged: () => void
}) {
  const { t } = useI18n()
  const selectId = useId()
  const [choice, setChoice] = useState('')
  const kindLabel = t(`as.kind.${kind.type}`)

  const options = useQuery({
    queryKey: ['asset-options', kind.type],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`${kind.path}${query({ page_size: 200 })}`),
  })

  const link = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/ad-accounts/${account.id}/asset-links`, {
        asset_type: kind.type,
        asset_id: choice,
      }),
    onSuccess: () => {
      setChoice('')
      onChanged()
    },
  })

  const unlink = useMutation({
    mutationFn: (linkId: string) => api.post(`/api/v1/ad-accounts/${account.id}/asset-links/${linkId}/unlink`),
    onSuccess: onChanged,
  })

  const linkedIds = new Set(links.map((item) => item.asset_id))
  const available = (options.data?.items ?? []).filter((item) => !linkedIds.has(item.id))
  const editable = account.archived_at === null

  return (
    <Panel title={kindLabel}>
      {kind.hasNote && <Note>{t(`as.note.${kind.type}` as 'as.note.payment_profile')}</Note>}

      {links.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('as.none')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.asset_label ?? item.asset_id}</p>
                <p className="text-xs text-ink-muted tabular-nums">{t('as.linkedAt', { time: formatDateTime(item.linked_at) })}</p>
              </div>
              {editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => unlink.mutate(item.id)}
                  disabled={unlink.isPending}
                  aria-label={t('as.unlinkNamed', { name: item.asset_label ?? item.asset_id })}
                >
                  {t('as.unlink')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="space-y-2">
          {options.isError ? (
            <ErrorState error={options.error} onRetry={() => options.refetch()} title={t('as.options.error')} compact />
          ) : available.length === 0 && links.length === 0 && !options.isLoading ? (
            <EmptyState
              title={t('as.empty.title', { kind: kindLabel })}
              description={t('as.empty.body')}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/assets">{t('as.empty.action')}</Link>
                </Button>
              }
              className="py-6"
            />
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <label className="label" htmlFor={selectId}>
                  {t('as.assign')}
                </label>
                <select id={selectId} className="input" value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">{t('as.select')}</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {String(item[kind.labelField] ?? item.id)}
                    </option>
                  ))}
                </select>
              </div>
              <Button disabled={!choice || link.isPending} onClick={() => link.mutate()}>
                {link.isPending ? t('as.linking') : t('as.link')}
              </Button>
            </div>
          )}
          {link.isError && <ErrorState error={link.error} compact />}
          {unlink.isError && <ErrorState error={unlink.error} compact />}
        </div>
      )}
    </Panel>
  )
}
