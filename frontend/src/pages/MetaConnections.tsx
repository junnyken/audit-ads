import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { MetaConnection, MetaEnvironment } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Field } from '../components/primitives/field'
import { Skeleton } from '../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion, NoPermissionState, PartialDataNote } from '../components/states'
import { DiscoverySection } from '../components/meta/DiscoverySection'
import { ReaderSourceBadge } from '../components/meta/ReaderSource'
import { ConnectionReaderSwitch } from '../components/meta/ConnectionReaderSwitch'
import { AutomationBadge, AutomationControls, automationOf } from '../components/meta/AutomationControls'
import { ReadBackNote, type ReadBack } from '../components/meta/confirm'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { EnvironmentBadge } from '../components/meta/EnvironmentBadge'

function CapabilityRow({ label, allowed }: { label: string; allowed: boolean | undefined }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-ink-muted">{label}</span>
      {allowed === undefined ? (
        <span className="text-ink-faint">{t('mc.cap.notChecked')}</span>
      ) : allowed ? (
        // A capability the last check found allowed is a measurement at one moment, not a
        // promise: neutral, never the success tone.
        <Badge tone="neutral">{t('mc.cap.allowed')}</Badge>
      ) : (
        <Badge tone="attention">{t('mc.cap.notAllowed')}</Badge>
      )}
    </div>
  )
}

function ConnectionCard({ connection }: { connection: MetaConnection }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const check = useMutation({
    mutationFn: () => api.post<MetaConnection>(`/api/v1/meta-connections/${connection.id}/check-capability`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meta-connections'] }),
  })

  return (
    <Card>
      <CardHeader className="flex-wrap items-center">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {connection.label}
          <EnvironmentBadge environment={connection.environment} />
          <AutomationBadge automation={automationOf(connection)} />
          {connection.business_manager_source === 'server' && (
            // Inheriting is legitimate, but it means this card is not about a business of its
            // own: every inheriting connection reads the one configured Business Manager.
            <Badge tone="neutral">{t('meta.usesServerBm')}</Badge>
          )}
        </CardTitle>
        <span className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/meta-connections/${connection.id}`}>{t('mc.card.open')}</Link>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? t('mc.card.checking') : t('mc.card.check')}
          </Button>
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-muted">{t('mc.card.reader')}</span>
          <ReaderSourceBadge source={connection.reader_source} readerLabel={connection.reader_credential?.label} />
        </div>
        <ConnectionReaderSwitch connection={connection} />
        <CapabilityRow label={t('mc.cap.list')} allowed={connection.capabilities?.list_business_managers} />
        <CapabilityRow label={t('mc.cap.create')} allowed={connection.capabilities?.create_ad_account} />
        <CapabilityRow label={t('mc.cap.share')} allowed={connection.capabilities?.share_ad_account_access} />
        {connection.capabilities?.reason && (
          <p className="text-xs text-tone-attention-fg">{t('mc.card.reason', { reason: connection.capabilities.reason })}</p>
        )}
        {check.isError && (
          <ErrorState title={t('mc.card.checkFailed')} error={check.error} noPermissionText={t('confirm.noPermission')} compact />
        )}
        <p className="text-xs text-ink-faint">
          {t('meta.lastCheckLabel', {
            time: connection.last_capability_check_at
              ? formatDateTime(connection.last_capability_check_at, language)
              : t('format.never'),
          })}
        </p>
        {connection.business_managers && connection.business_managers.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">{t('mc.card.bms')}</p>
            <ul className="space-y-0.5 text-xs">
              {connection.business_managers.map((bm) => (
                <li key={bm.external_id} className="font-mono text-2xs">
                  {bm.name} ({bm.external_id})
                </li>
              ))}
            </ul>
          </div>
        )}
        <AutomationControls connection={connection} />
        <DiscoverySection connectionId={connection.id} connectionLabel={connection.label} />
      </CardContent>
    </Card>
  )
}

/** A connection that currently reads nothing: no credential, or a dead one. Said once above the
 * list, so a card full of zeroes is not read as "nothing to find". */
function cannotRead(connection: MetaConnection): boolean {
  return connection.reader_source === 'none' || connection.reader_source === 'vault_reconnect_required'
}

export default function MetaConnections() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const enumLabel = useEnumLabel()
  const connections = useQuery({
    queryKey: ['meta-connections'],
    queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
  })

  const [environment, setEnvironment] = useState<MetaEnvironment>('fake')
  const [businessManager, setBusinessManager] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api.post<MetaConnection>('/api/v1/meta-connections', {
        label,
        environment,
        business_manager_reference: businessManager.trim(),
      }),
    onSuccess: async (created) => {
      setLabel('')
      setBusinessManager('')
      // Read back: the list the server returns now, not the click, says whether it exists.
      const fresh = await queryClient.fetchQuery({
        queryKey: ['meta-connections'],
        queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
        staleTime: 0,
      })
      const found = fresh.find((candidate) => candidate.id === created.id)
      setReadBack({
        ok: Boolean(found),
        text: found
          ? t('mc.add.readback.ok', { label: found.label, env: enumLabel('metaEnv', found.environment) })
          : t('mc.add.readback.mismatch', { label: created.label }),
      })
    },
  })

  const forbidden = connections.isError && (connections.error as { status?: number }).status === 403
  const list = connections.data ?? []
  const unreadable = list.filter(cannotRead)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold leading-7">{t('nav.item.metaConnections')}</h1>
        <p className="max-w-3xl text-sm text-ink-muted">{t('mc.intro')}</p>
      </header>

      {forbidden ? (
        <NoPermissionState title={t('mc.list.noPermissionTitle')} description={t('mc.list.noPermissionBody')} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('mc.add.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  setReadBack(null)
                  create.mutate()
                }}
              >
                <div className="min-w-[220px] flex-1">
                  <Field label={t('mc.add.label')} htmlFor="connection-label" required>
                    <input
                      id="connection-label"
                      ref={labelRef}
                      className="input"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder={t('mc.add.labelPlaceholder')}
                      maxLength={200}
                      required
                    />
                  </Field>
                </div>
                <div className="min-w-[180px]">
                  <Field label={t('mc.add.env')} htmlFor="connection-environment" required>
                    <select
                      id="connection-environment"
                      className="input"
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value as MetaEnvironment)}
                    >
                      <option value="fake">{t('metaEnv.fake')}</option>
                      <option value="sandbox">{t('metaEnv.sandbox')}</option>
                      <option value="production">{t('metaEnv.production')}</option>
                    </select>
                  </Field>
                </div>
                <div className="min-w-[220px]">
                  <Field label={t('mc.add.bm')} htmlFor="connection-bm">
                    <input
                      id="connection-bm"
                      className="input"
                      value={businessManager}
                      onChange={(event) => setBusinessManager(event.target.value)}
                      placeholder={t('mc.add.bmPlaceholder')}
                      maxLength={120}
                    />
                  </Field>
                </div>
                <Button type="submit" disabled={create.isPending || !label.trim()}>
                  {create.isPending ? t('mc.add.adding') : t('mc.add.submit')}
                </Button>
              </form>
              {create.isError && (
                <ErrorState title={t('mc.add.error')} error={create.error} noPermissionText={t('confirm.noPermission')} compact />
              )}
              <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />
              <p className="text-xs text-ink-faint">{t('mc.add.note')}</p>
            </CardContent>
          </Card>

          {connections.isLoading ? (
            <LoadingRegion className="grid gap-4 xl:grid-cols-2">
              {[0, 1].map((index) => (
                <div key={index} className="space-y-3 rounded-lg border border-line bg-surface p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </LoadingRegion>
          ) : connections.isError ? (
            <ErrorState title={t('mc.list.error')} error={connections.error} onRetry={() => connections.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              title={t('mc.empty.title')}
              description={t('mc.empty.body')}
              action={
                <>
                  <Button onClick={() => labelRef.current?.focus()}>{t('mc.empty.add')}</Button>
                  <Button asChild variant="secondary">
                    <Link to="/settings#meta-readers">{t('mc.empty.facebook')}</Link>
                  </Button>
                </>
              }
            />
          ) : (
            <>
              {unreadable.length > 0 && (
                <PartialDataNote>{t('mc.partial', { labels: unreadable.map((c) => c.label).join(', ') })}</PartialDataNote>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                {list.map((connection) => (
                  <ConnectionCard key={connection.id} connection={connection} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
