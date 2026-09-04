import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, query } from '../../lib/api'
import type { AdAccount, AssetLink, AssetType, Paged, ReferenceRecord } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import { formatDateTime, titleCase } from '../../lib/format'

const ASSET_KINDS: {
  type: AssetType
  label: string
  path: string
  labelField: string
  singleActive: boolean
  note?: string
}[] = [
  { type: 'page', label: 'Pages', path: '/api/v1/pages', labelField: 'name', singleActive: false },
  { type: 'pixel', label: 'Pixels', path: '/api/v1/pixels', labelField: 'name', singleActive: false },
  {
    type: 'payment_profile',
    label: 'Payment profile references',
    path: '/api/v1/payment-profile-references',
    labelField: 'reference_code',
    singleActive: false,
    note: 'A pointer to a payment arrangement you manage elsewhere. No card or billing credential is stored.',
  },
  {
    type: 'browser_profile',
    label: 'Browser profile reference',
    path: '/api/v1/browser-profile-references',
    labelField: 'profile_reference',
    singleActive: true,
    note: 'One active mapping at a time. Assigning a new reference closes the previous mapping and keeps it in history.',
  },
  {
    type: 'proxy',
    label: 'Proxy reference',
    path: '/api/v1/proxy-references',
    labelField: 'proxy_reference',
    singleActive: true,
    note: 'An opaque operator label only. A proxy reference never makes an account ready on its own.',
  },
]

export default function AssetsTab({ account, onChanged }: { account: AdAccount; onChanged: () => void }) {
  const links = useQuery({
    queryKey: ['asset-links', account.id],
    queryFn: () => api.get<AssetLink[]>(`/api/v1/ad-accounts/${account.id}/asset-links`),
  })

  if (links.isLoading) return <Skeleton rows={6} />
  if (links.isError) return <ErrorState error={links.error} onRetry={() => links.refetch()} />

  const all = links.data!
  const history = all.filter((link) => !link.is_active)

  return (
    <div className="space-y-4">
      <Card title="Ownership">
        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,200px)_1fr]">
          <dt className="text-ink-faint">Business Manager</dt>
          <dd>{account.business_manager_name ?? 'Not mapped'}</dd>
          <dt className="text-ink-faint">Personal account reference</dt>
          <dd>{account.personal_account_reference_label ?? 'Not mapped'}</dd>
        </dl>
      </Card>

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

      <Card title="Historical link timeline">
        {history.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            No mapping has been closed yet. Unlinking never deletes a row, so past assignments
            appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {history
              .slice()
              .sort((a, b) => (a.unlinked_at! < b.unlinked_at! ? 1 : -1))
              .map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <Badge tone="muted">{titleCase(link.asset_type)}</Badge>
                  <span className="font-medium">{link.asset_label ?? link.asset_id}</span>
                  <span className="text-ink-faint">
                    linked {formatDateTime(link.linked_at)} · unlinked {formatDateTime(link.unlinked_at)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
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
  const [choice, setChoice] = useState('')

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
    mutationFn: (linkId: string) =>
      api.post(`/api/v1/ad-accounts/${account.id}/asset-links/${linkId}/unlink`),
    onSuccess: onChanged,
  })

  const linkedIds = new Set(links.map((item) => item.asset_id))
  const available = (options.data?.items ?? []).filter((item) => !linkedIds.has(item.id))

  return (
    <Card title={kind.label}>
      {kind.note && <InlineNote>{kind.note}</InlineNote>}

      {links.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-muted">No active mapping.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {links.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.asset_label ?? item.asset_id}</p>
                <p className="text-[11.5px] text-ink-faint">Linked {formatDateTime(item.linked_at)}</p>
              </div>
              {account.archived_at === null && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => unlink.mutate(item.id)}
                  disabled={unlink.isPending}
                >
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {account.archived_at === null && (
        <div className="mt-3 space-y-2">
          {available.length === 0 && links.length === 0 ? (
            <EmptyState
              title={`No ${kind.label.toLowerCase()} recorded`}
              description="Create the reference under Assets in the sidebar, then map it here."
            />
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label className="label">Assign a reference</label>
                <select className="input" value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">Select…</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {String(item[kind.labelField] ?? item.id)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={!choice || link.isPending}
                onClick={() => link.mutate()}
              >
                {link.isPending ? 'Linking…' : 'Link'}
              </button>
            </div>
          )}
          {link.isError && <ErrorState error={link.error} />}
          {unlink.isError && <ErrorState error={unlink.error} />}
        </div>
      )}
    </Card>
  )
}
