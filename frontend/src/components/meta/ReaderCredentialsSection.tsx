import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Link2, RefreshCw, RotateCw, ShieldOff } from 'lucide-react'
import { api } from '../../lib/api'
import type { MetaReaderCredential, MetaReaderCredentialList } from '../../lib/types'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { Skeleton } from '../primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion, NoPermissionState } from '../states'
import { DL_CLASS, Note, Panel, Row } from '../../pages/account/parts'
import { formatDateTime, formatRelative } from '../../lib/format'
import { READER_STATE_TONE, readCallbackParams, readerReasonText } from '../../lib/metaReaders'
import { useI18n } from '../../i18n'
import { ConfirmDialog, ReadBackNote, type ReadBack } from './confirm'

const QUERY_KEY = ['meta-reader-credentials']

/**
 * O4. Settings → Meta reader credentials (owner only).
 *
 * Shows what may be disclosed about each vault credential — label, kind, who granted it, scopes,
 * expiry, last check, Business Managers seen, status — and never the token: the API has no field
 * that could carry one. Connecting hands the browser to Meta's own dialog; the product never sees
 * a password or cookie (rules 1, 7).
 *
 * U1f: connect, reconnect and revoke each ask once, in words (what happens, whether it can be
 * undone), and revoke reads the credential back from the server before it says it is done.
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
      <Panel title={<span id="meta-readers-title">{t('metaReader.title')}</span>}>
        <p className="text-sm text-ink-muted">{t('metaReader.intro')}</p>

        {callback && (
          <Note role="status" tone={callback.outcome === 'ok' ? 'info' : 'attention'}>
            {callback.outcome === 'ok'
              ? t('metaReader.callback.ok')
              : t('metaReader.callback.error', { reason: readerReasonText(t, callback.reason) })}
          </Note>
        )}

        {!isOwner ? (
          <NoPermissionState compact description={t('metaReader.notOwner')} />
        ) : list.isLoading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </LoadingRegion>
        ) : list.isError ? (
          <ErrorState title={t('rc.error')} error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <ReaderList data={list.data!} />
        )}
      </Panel>
    </section>
  )
}

function ReaderList({ data }: { data: MetaReaderCredentialList }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      {!data.configured && (
        <Note role="note" tone="caution">
          {data.unavailable_reason === 'vault_unavailable'
            ? t('metaReader.vaultUnavailable')
            : t('metaReader.notConfigured')}
        </Note>
      )}
      <ConnectForm disabled={!data.configured} bmRequired={data.business_manager_required} />
      {data.items.length === 0 ? (
        <EmptyState title={t('metaReader.empty')} description={t('metaReader.emptyHint')} />
      ) : (
        <ul aria-label={t('rc.list')} className="space-y-3">
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
  const [confirming, setConfirming] = useState(false)
  const start = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>('/api/v1/meta-reader-credentials/connect/start', {
        label,
        business_manager_reference: bm,
      }),
  })
  const ready = !disabled && label.trim().length > 0 && (!bmRequired || /^\d+$/.test(bm.trim()))

  return (
    <form
      className="rounded-md border border-line bg-surface-muted p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) setConfirming(true)
      }}
    >
      <p className="text-sm font-medium">{t('metaReader.beforeYouStart')}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-ink-muted">
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
      <div className="mt-3">
        <Button type="submit" disabled={!ready}>
          <Link2 aria-hidden className="h-4 w-4" />
          {t('metaReader.connect')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('rc.connectDialog.title')}
        object={t('rc.connectDialog.object', { label: label.trim(), bm: bm.trim() || t('rc.connectDialog.noBm') })}
        effects={[
          t('rc.connectDialog.e1'),
          t('rc.connectDialog.e2'),
          t('rc.connectDialog.e3'),
          t('rc.connectDialog.e4'),
        ]}
        irreversible={false}
        confirmLabel={t('rc.connectDialog.confirm')}
        onConfirm={async () => {
          const { url } = await start.mutateAsync()
          // The browser leaves for Meta's own dialog; the callback brings it back to this page
          // with the outcome in the URL, which the section above reads.
          window.location.assign(url)
        }}
      />
    </form>
  )
}

function ReaderCard({ item, configured }: { item: MetaReaderCredential; configured: boolean }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'reconnect' | 'revoke' | null>(null)
  const [reason, setReason] = useState('')
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
    return queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }
  const stateLabel = (state: MetaReaderCredential['derived_state']) => t(`metaReader.state.${state}`)

  const verify = useMutation({
    mutationFn: () => api.post<MetaReaderCredential>(`/api/v1/meta-reader-credentials/${item.id}/verify`),
    onSuccess: async (checked) => {
      await refresh()
      setReadBack({
        ok: true,
        tone: READER_STATE_TONE[checked.derived_state] === 'attention' ? 'attention' : 'info',
        text: t('rc.verify.readback', { label: item.label, state: stateLabel(checked.derived_state) }),
      })
    },
  })
  const reconnect = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/v1/meta-reader-credentials/${item.id}/reconnect/start`),
  })
  const revoke = useMutation({
    mutationFn: () => api.post<MetaReaderCredential>(`/api/v1/meta-reader-credentials/${item.id}/revoke`, { reason }),
  })
  const revoked = item.status === 'revoked'
  const canVerify = configured && (item.status === 'active' || item.status === 'pending_verification')
  const canReconnect = configured && !revoked
  const error = verify.error

  return (
    <article className="rounded-lg border border-line bg-surface p-4" aria-label={item.label}>
      <header className="flex flex-wrap items-center gap-2">
        <KeyRound aria-hidden className="h-4 w-4 text-ink-faint" />
        <h3 className="text-sm font-semibold">{item.label}</h3>
        <Badge tone={READER_STATE_TONE[item.derived_state]} dot>
          {stateLabel(item.derived_state)}
        </Badge>
        <Badge tone="muted">{t(`metaReader.kind.${item.kind}`)}</Badge>
      </header>

      <dl className={`mt-3 ${DL_CLASS}`}>
        <Row label={t('metaReader.grantedBy')}>{item.provider_user_name ?? item.provider_user_external_id ?? '—'}</Row>
        <Row label={t('metaReader.scopes')}>
          <span className="font-mono text-xs">{item.scopes.length ? item.scopes.join(', ') : '—'}</span>
        </Row>
        <Row label={t('metaReader.expiry')}>
          {item.expires_at
            ? `${t('metaReader.expiresOn', { date: formatDateTime(item.expires_at, language) })} (${formatRelative(item.expires_at, language)})`
            : t('metaReader.neverExpires')}
        </Row>
        <Row label={t('metaReader.lastChecked')}>
          {item.last_verified_at
            ? `${formatRelative(item.last_verified_at, language)} · ${item.last_verify_outcome ?? '—'}`
            : t('metaReader.neverChecked')}
        </Row>
        {item.reconnect_reason && (
          <Row label={t('metaReader.reason')}>{readerReasonText(t, item.reconnect_reason)}</Row>
        )}
        <Row label={t('metaReader.businesses')}>
          {item.businesses_seen.length === 0 ? (
            item.status === 'active' ? t('metaReader.noBusinesses') : '—'
          ) : (
            <ul className="space-y-0.5">
              {item.businesses_seen.map((bm) => (
                <li key={bm.external_id}>
                  {bm.name ?? '—'} <span className="font-mono text-2xs text-ink-faint">{bm.external_id}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label={t('metaReader.connectionsUsing')}>
          {item.connections.length ? item.connections.map((c) => c.label).join(', ') : '—'}
        </Row>
      </dl>

      {error && (
        <div className="mt-3">
          <ErrorState error={error} noPermissionText={t('confirm.noPermission')} compact />
        </div>
      )}
      <div className="mt-3">
        <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />
      </div>

      {!revoked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!canVerify || verify.isPending} onClick={() => verify.mutate()}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {verify.isPending ? t('rc.verifying') : t('metaReader.verify')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canReconnect} onClick={() => setDialog('reconnect')}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" />
            {t('metaReader.reconnect')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog('revoke')}>
            <ShieldOff aria-hidden className="h-3.5 w-3.5" />
            {t('metaReader.revoke')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'reconnect'}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        title={t('rc.reconnectDialog.title', { label: item.label })}
        object={item.label}
        effects={[t('rc.reconnectDialog.e1'), t('rc.reconnectDialog.e2'), t('rc.reconnectDialog.e3')]}
        irreversible={false}
        confirmLabel={t('rc.reconnectDialog.confirm')}
        onConfirm={async () => {
          const { url } = await reconnect.mutateAsync()
          window.location.assign(url)
        }}
      />

      <ConfirmDialog
        open={dialog === 'revoke'}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
            setReason('')
          }
        }}
        title={t('rc.revokeDialog.title', { label: item.label })}
        object={item.label}
        effects={[t('rc.revokeDialog.e1'), t('rc.revokeDialog.e2'), t('rc.revokeDialog.e3')]}
        irreversible
        destructive
        disabled={!reason.trim()}
        confirmLabel={t('rc.revokeDialog.confirm')}
        onConfirm={async () => {
          await revoke.mutateAsync()
          await refresh()
          // Read back from the list the server now returns, not from the click.
          const fresh = queryClient
            .getQueryData<MetaReaderCredentialList>(QUERY_KEY)
            ?.items.find((candidate) => candidate.id === item.id)
          const status = fresh?.status ?? 'unknown'
          const ok = status === 'revoked'
          setReadBack({
            ok,
            tone: ok ? 'info' : 'caution',
            text: ok
              ? t('rc.revoke.readback.ok', { label: item.label, state: stateLabel('revoked') })
              : t('rc.revoke.readback.mismatch', { label: item.label, state: fresh ? stateLabel(fresh.derived_state) : '—' }),
          })
          setReason('')
        }}
      >
        <Field label={t('metaReader.revokeReason')} required htmlFor={`revoke-${item.id}`} hint={reason.trim() ? undefined : t('rc.revokeDialog.reasonRequired')}>
          <input
            id={`revoke-${item.id}`}
            className="input"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </article>
  )
}
