import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Link2, RefreshCw, RotateCw, ShieldOff } from 'lucide-react'
import { api } from '../../lib/api'
import type { MetaReaderCredential, MetaReaderCredentialList } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, Field, InlineNote, Skeleton } from '../ui'
import { Button } from '../primitives/button'
import { formatDateTime, formatRelative } from '../../lib/format'
import { READER_STATE_TONE, readCallbackParams, readerReasonText } from '../../lib/metaReaders'
import { useI18n } from '../../i18n'

const QUERY_KEY = ['meta-reader-credentials']

/**
 * O4. Settings → Meta reader credentials (owner only).
 *
 * Shows what may be disclosed about each vault credential — label, kind, who granted it, scopes,
 * expiry, last check, Business Managers seen, status — and never the token: the API has no field
 * that could carry one. Connecting hands the browser to Meta's own dialog; the product never sees
 * a password or cookie (rules 1, 7).
 */
export function ReaderCredentialsSection({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n()
  const location = useLocation()
  const callback = readCallbackParams(location.search)

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<MetaReaderCredentialList>('/api/v1/meta-reader-credentials'),
    enabled: isOwner,
  })

  return (
    <section id="meta-readers" aria-labelledby="meta-readers-title">
      <Card title={<span id="meta-readers-title">{t('metaReader.title')}</span>}>
        <p className="text-[12.5px] text-ink-muted">{t('metaReader.intro')}</p>

        {callback && (
          <div role="status" className="mt-3">
            <InlineNote tone={callback.outcome === 'ok' ? 'info' : 'attention'}>
              {callback.outcome === 'ok'
                ? t('metaReader.callback.ok')
                : t('metaReader.callback.error', { reason: readerReasonText(t, callback.reason) })}
            </InlineNote>
          </div>
        )}

        <div className="mt-3">
          {!isOwner ? (
            <InlineNote>{t('metaReader.notOwner')}</InlineNote>
          ) : list.isLoading ? (
            <Skeleton rows={3} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <ReaderList data={list.data!} />
          )}
        </div>
      </Card>
    </section>
  )
}

function ReaderList({ data }: { data: MetaReaderCredentialList }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      {!data.configured && (
        <InlineNote tone="caution">
          {data.unavailable_reason === 'vault_unavailable'
            ? t('metaReader.vaultUnavailable')
            : t('metaReader.notConfigured')}
        </InlineNote>
      )}
      <ConnectForm disabled={!data.configured} bmRequired={data.business_manager_required} />
      {data.items.length === 0 ? (
        <EmptyState title={t('metaReader.empty')} description={t('metaReader.emptyHint')} />
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <li key={item.id}>
              <ReaderCard item={item} configured={data.configured} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConnectForm({ disabled, bmRequired }: { disabled: boolean; bmRequired: boolean }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  const [bm, setBm] = useState('')
  const start = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>('/api/v1/meta-reader-credentials/connect/start', {
        label,
        business_manager_reference: bm,
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  const ready = !disabled && label.trim().length > 0 && (!bmRequired || /^\d+$/.test(bm.trim()))

  return (
    <form
      className="rounded-md border border-line bg-surface-muted p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) start.mutate()
      }}
    >
      <p className="text-[12.5px] font-medium">{t('metaReader.beforeYouStart')}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] text-ink-muted">
        <li>{t('metaReader.beforeStep1')}</li>
        <li>{t('metaReader.beforeStep2')}</li>
        <li>{t('metaReader.beforeStep3')}</li>
      </ol>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t('metaReader.label')} hint={t('metaReader.labelHint')} required htmlFor="reader-label">
          <input
            id="reader-label"
            className="input"
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label={t('metaReader.bmId')} hint={t('metaReader.bmIdHint')} required={bmRequired} htmlFor="reader-bm">
          <input
            id="reader-bm"
            className="input font-mono"
            inputMode="numeric"
            value={bm}
            maxLength={30}
            onChange={(event) => setBm(event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      {start.isError && (
        <div className="mt-2">
          <ErrorState error={start.error} />
        </div>
      )}
      <div className="mt-3">
        <Button type="submit" disabled={!ready || start.isPending}>
          <Link2 aria-hidden className="h-4 w-4" />
          {start.isPending ? t('metaReader.connecting') : t('metaReader.connect')}
        </Button>
      </div>
    </form>
  )
}

function ReaderCard({ item, configured }: { item: MetaReaderCredential; configured: boolean }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState(false)
  const [reason, setReason] = useState('')
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
  }
  const verify = useMutation({
    mutationFn: () => api.post<MetaReaderCredential>(`/api/v1/meta-reader-credentials/${item.id}/verify`),
    onSuccess: refresh,
  })
  const reconnect = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/v1/meta-reader-credentials/${item.id}/reconnect/start`),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  const revoke = useMutation({
    mutationFn: () => api.post<MetaReaderCredential>(`/api/v1/meta-reader-credentials/${item.id}/revoke`, { reason }),
    onSuccess: () => {
      setRevoking(false)
      refresh()
    },
  })
  const revoked = item.status === 'revoked'
  const canVerify = configured && (item.status === 'active' || item.status === 'pending_verification')
  const canReconnect = configured && !revoked
  const error = verify.error ?? reconnect.error ?? revoke.error

  return (
    <article className="card p-3" aria-label={item.label}>
      <header className="flex flex-wrap items-center gap-2">
        <KeyRound aria-hidden className="h-4 w-4 text-ink-faint" />
        <h3 className="text-[13px] font-semibold">{item.label}</h3>
        <Badge tone={READER_STATE_TONE[item.derived_state]} dot>
          {t(`metaReader.state.${item.derived_state}`)}
        </Badge>
        <Badge tone="muted">{t(`metaReader.kind.${item.kind}`)}</Badge>
      </header>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-[minmax(0,160px)_1fr]">
        <dt className="text-ink-faint">{t('metaReader.grantedBy')}</dt>
        <dd>{item.provider_user_name ?? item.provider_user_external_id ?? '—'}</dd>
        <dt className="text-ink-faint">{t('metaReader.scopes')}</dt>
        <dd className="font-mono text-[11.5px]">{item.scopes.length ? item.scopes.join(', ') : '—'}</dd>
        <dt className="text-ink-faint">{t('metaReader.expiry')}</dt>
        <dd>
          {item.expires_at
            ? `${t('metaReader.expiresOn', { date: formatDateTime(item.expires_at) })} (${formatRelative(item.expires_at)})`
            : t('metaReader.neverExpires')}
        </dd>
        <dt className="text-ink-faint">{t('metaReader.lastChecked')}</dt>
        <dd>
          {item.last_verified_at
            ? `${formatRelative(item.last_verified_at)} · ${item.last_verify_outcome ?? '—'}`
            : t('metaReader.neverChecked')}
        </dd>
        {item.reconnect_reason && (
          <>
            <dt className="text-ink-faint">{t('metaReader.reason')}</dt>
            <dd>{readerReasonText(t, item.reconnect_reason)}</dd>
          </>
        )}
        <dt className="text-ink-faint">{t('metaReader.businesses')}</dt>
        <dd>
          {item.businesses_seen.length === 0 ? (
            item.status === 'active' ? t('metaReader.noBusinesses') : '—'
          ) : (
            <ul className="space-y-0.5">
              {item.businesses_seen.map((bm) => (
                <li key={bm.external_id}>
                  {bm.name ?? '—'} <span className="font-mono text-[11px] text-ink-faint">{bm.external_id}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="text-ink-faint">{t('metaReader.connectionsUsing')}</dt>
        <dd>{item.connections.length ? item.connections.map((c) => c.label).join(', ') : '—'}</dd>
      </dl>

      {error && (
        <div className="mt-2">
          <ErrorState error={error} />
        </div>
      )}

      {!revoked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!canVerify || verify.isPending} onClick={() => verify.mutate()}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {t('metaReader.verify')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canReconnect || reconnect.isPending} onClick={() => reconnect.mutate()}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" />
            {t('metaReader.reconnect')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRevoking(true)} disabled={revoking}>
            <ShieldOff aria-hidden className="h-3.5 w-3.5" />
            {t('metaReader.revoke')}
          </Button>
        </div>
      )}

      {revoking && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason.trim()) revoke.mutate()
          }}
        >
          <InlineNote tone="caution">{t('metaReader.revokeConfirm')}</InlineNote>
          <Field label={t('metaReader.revokeReason')} required htmlFor={`revoke-${item.id}`}>
            <input
              id={`revoke-${item.id}`}
              className="input"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!reason.trim() || revoke.isPending}>
              {t('metaReader.revokeSubmit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRevoking(false)}>
              {t('metaReader.cancel')}
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}
