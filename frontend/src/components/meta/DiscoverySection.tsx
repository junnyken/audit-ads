import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type {
  CoverageStatus,
  DiscoveryAssetResult,
  DiscoveryRun,
  ReconciliationRow,
  ReconciliationStatus,
} from '../../lib/types'
import { useI18n } from '../../i18n'
import type { TranslationKey, TranslationVars } from '../../i18n'
import { hasKey } from '../../i18n/labels'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Skeleton } from '../primitives/skeleton'
import { ErrorState, LoadingRegion } from '../states'
import { Note } from '../../pages/account/parts'
import { ImportConfirmDialog } from './ImportConfirmDialog'
import { ReadBackNote } from './confirm'
import { useImportAccount } from './useImportAccount'
import { BusinessUsersSection } from './BusinessUsersSection'

export type T = (key: TranslationKey, vars?: TranslationVars) => string

/** Coverage is never styled as success unless it is actually complete. `partial`, `incomplete`
 * and `unknown` all mean the same thing to the operator — this run cannot be used to conclude
 * anything is absent — so none of them may look reassuring. */
export function CoverageBadge({ status }: { status: CoverageStatus }) {
  const { t } = useI18n()
  if (status === 'complete') return <Badge tone="positive">{t('coverage.complete')}</Badge>
  if (status === 'not_attempted') return <Badge tone="neutral">{t('coverage.not_attempted')}</Badge>
  if (status === 'partial') return <Badge tone="caution">{t('coverage.partial')}</Badge>
  if (status === 'stale') return <Badge tone="caution">{t('coverage.stale')}</Badge>
  return <Badge tone="attention">{status === 'unknown' ? t('coverage.unknown') : t('coverage.incomplete')}</Badge>
}

/** Deliberately factual. Never "deleted", "removed" or "lost" — this product only knows what the
 * latest completed discovery returned. */
export function reconciliationLabel(t: T, status: ReconciliationStatus): string {
  return t(`recon.${status}` as TranslationKey)
}

export function ReconciliationBadge({ status }: { status: ReconciliationStatus }) {
  const { t } = useI18n()
  const label = reconciliationLabel(t, status)
  if (status === 'matched') return <Badge tone="positive">{label}</Badge>
  if (status === 'missing_in_registry') return <Badge tone="info">{label}</Badge>
  if (status === 'missing_from_latest_discovery') return <Badge tone="caution">{label}</Badge>
  return <Badge tone="neutral">{label}</Badge>
}

/** Why a run may not conclude anything is missing — stated per coverage status rather than as one
 * sentence for all of them.
 *
 * The single sentence used to read "because not every required source was read", which is only
 * true of `incomplete`. Seen live on an authority-blocked run where every required source *was*
 * read and every one answered: the product gave a reason that was not the reason. Naming a cause
 * that did not happen is the same class of error as naming a conclusion that was not established.
 */
export function whyNotMissing(t: T, status: CoverageStatus): string {
  if (status === 'incomplete') return t('why.incomplete')
  if (status === 'partial') return t('why.partial')
  if (status === 'stale') return t('why.stale')
  // `unknown` covers both an edge that failed in a way this product cannot categorise and a run
  // whose access to the Business Manager could not be established. Both mean the same thing here,
  // and the specific cause is stated separately rather than guessed at in this sentence.
  return t('why.unknown')
}

export function edgeLabel(t: T, edge: string): string {
  const key = `edge.${edge}`
  return hasKey(key) ? t(key) : edge
}

/** The short noun used inside a breakdown such as "5 owned · 3 client". */
export function edgeShortLabel(t: T, edge: string): string {
  const key = `edge.short.${edge}`
  return hasKey(key) ? t(key) : edge
}

/** An edge that did not finish: the server's error code if it sent one, else the status in words. */
export function edgeProblem(t: T, status: string, errorCode: string | null | undefined): string {
  if (errorCode) return errorCode
  const key = `edgeStatus.${status}`
  return hasKey(key) ? t(key) : status.replace('_', ' ')
}

/** Exported so the wording rules can be tested directly, the way the other component tests in
 * this project work: props in, rendered output asserted, no network. */
export function AssetResult({
  title,
  result,
  emptyNote,
  onImport,
  importingId,
}: {
  title: string
  result: DiscoveryAssetResult
  emptyNote?: string
  /** Supplied only for ad accounts. A registry Pixel has no Business Manager relationship in the
   * A1 schema, so there is nothing to import a Pixel *into* — offering the button there would
   * promise a mapping the schema cannot hold. Resolves when the write and its read-back are done. */
  onImport?: (externalId: string, name: string) => Promise<unknown> | void
  importingId?: string | null
}) {
  const { t } = useI18n()
  const edges = Object.entries(result.coverage.edges ?? {})
  const completed = edges.filter(([, e]) => e.status === 'completed')
  const notCompleted = edges.filter(([, e]) => e.status !== 'completed')
  const returned = result.coverage.total_unique_assets ?? result.reconciliation.length
  const [pending, setPending] = useState<{ external_id: string; name: string } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  return (
    <div ref={rootRef} tabIndex={-1} className="rounded-md border border-line p-3 outline-none">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {/* "returned", not "discovered": the wording must not imply this is everything in Meta. */}
        <span className="text-sm font-medium">{t('disc.returned', { title, n: returned })}</span>
        <CoverageBadge status={result.coverage_status} />
      </div>

      {completed.length > 0 && (
        <p className="text-xs text-ink-muted">
          {t('disc.completed', {
            list: completed.map(([edge, e]) => `${edgeLabel(t, edge)} (${e.items})`).join(', '),
          })}
        </p>
      )}
      {notCompleted.length > 0 && (
        <p className="text-xs text-tone-caution-fg">
          {t('disc.notCompleted', {
            list: notCompleted
              .map(([edge, e]) => `${edgeLabel(t, edge)} (${edgeProblem(t, e.status, e.error_code)})`)
              .join(', '),
          })}
        </p>
      )}

      {!result.complete && result.coverage_status !== 'not_attempted' && (
        <p className="mt-1 text-xs text-tone-caution-fg">
          {t('disc.noMissing', { why: whyNotMissing(t, result.coverage_status) })}
        </p>
      )}
      {emptyNote && <p className="mt-1 text-xs text-ink-faint">{emptyNote}</p>}

      {result.reconciliation.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {result.reconciliation.map((row: ReconciliationRow) => (
            <li
              key={`${row.external_id ?? 'none'}-${row.internal_entity_id ?? 'none'}`}
              className="flex flex-wrap items-start justify-between gap-2 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate">{row.display_name || t('meta.noName')}</span>
                <span className="font-mono text-2xs text-ink-faint">{row.external_id ?? '—'}</span>
                {/* The edge comes from the structured field, never from prose — the two used to
                    be rendered side by side, printing the same fact twice, once translated and
                    once raw. */}
                {row.source_edge && (
                  <span className="block text-2xs text-ink-faint">
                    {t('disc.returnedBy', { edge: edgeLabel(t, row.source_edge) })}
                  </span>
                )}
                {row.detail && <span className="block text-2xs text-ink-faint">{row.detail}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <ReconciliationBadge status={row.status} />
                {onImport && row.status === 'missing_in_registry' && row.external_id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPending({ external_id: row.external_id as string, name: row.display_name })}
                    disabled={importingId === row.external_id}
                  >
                    {importingId === row.external_id ? t('disc.adding') : t('disc.addToRegistry')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {onImport && (
        <ImportConfirmDialog
          row={pending}
          onClose={() => setPending(null)}
          onConfirm={(externalId, name) => onImport(externalId, name)}
          fallbackFocus={() => rootRef.current?.focus()}
        />
      )}
    </div>
  )
}

/** The failure sentence of a run that did not complete, with its code. */
export function RunFailure({ code, summary }: { code: string; summary: string | null }) {
  const { t } = useI18n()
  return (
    <p className="text-xs text-tone-attention-fg">
      {t('disc.failure', { summary: summary ?? t('disc.runFailed'), code })}
    </p>
  )
}

/** Who read, when — the sentence that stops a count being read as "everything the BM holds". */
export function ReadAtSentence({
  completedAt,
  identity,
  keyPrefix = 'disc',
}: {
  completedAt: string | null
  identity: string
  keyPrefix?: 'disc' | 'ws'
}) {
  const { t, language } = useI18n()
  const time = completedAt ? formatDateTime(completedAt, language) : t('meta.timeUnknown')
  return (
    <p className="text-xs text-ink-faint">
      {keyPrefix === 'disc' ? t('disc.readAtPrefix', { time }) : t('ws.readAt', { time })}
      <strong className="text-ink">{identity}</strong>
      {keyPrefix === 'disc' ? t('disc.readAtSuffix') : t('ws.readAtSuffix')}
    </p>
  )
}

/** The authority caveat. Measured on real Meta: a token with no role in a Business Manager still
 * reads its node, and every asset edge answers 200 with an empty list and no error. Without this
 * sentence an empty result reads as "this Business Manager is empty". */
export function AuthorityNote() {
  const { t } = useI18n()
  return (
    <Note role="note" tone="attention">
      <strong>{t('disc.authority.title')}</strong> {t('disc.authority.body')}
    </Note>
  )
}

export function DiscoverySection({
  connectionId,
  connectionLabel,
}: {
  connectionId: string
  connectionLabel: string
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const key = ['meta-discovery', connectionId]

  const latest = useQuery({
    queryKey: key,
    queryFn: () => api.get<DiscoveryRun | null>(`/api/v1/meta-connections/${connectionId}/discoveries/latest`),
  })
  const run = useMutation({
    mutationFn: () => api.post<DiscoveryRun>(`/api/v1/meta-connections/${connectionId}/discoveries`),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data)
    },
  })

  const data = latest.data
  const imports = useImportAccount(connectionId, data, key)

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('disc.title')}</span>
        <Button variant="secondary" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? t('disc.running') : t('disc.run')}
        </Button>
      </div>
      <p className="mb-2 text-xs text-ink-faint">{t('disc.intro')}</p>

      {latest.isLoading && (
        <LoadingRegion>
          <Skeleton className="h-16 w-full" />
        </LoadingRegion>
      )}
      {latest.isError && <ErrorState title={t('disc.loadFailed')} error={latest.error} onRetry={() => latest.refetch()} compact />}
      {!latest.isLoading && !latest.isError && !data && <p className="text-xs text-ink-faint">{t('disc.none')}</p>}

      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted">
              {t('disc.bm', {
                name: data.business_manager.name ?? data.business_manager.reference ?? t('meta.notConfigured'),
              })}
            </span>
            {data.business_manager.name &&
              data.business_manager.name.trim().toLowerCase() !== connectionLabel.trim().toLowerCase() && (
                // The connection label is a nickname an operator typed; the Business Manager is
                // whatever the server is configured to read. Today every connection reads the
                // same configured BM, so a card headed "Triu Shop" can list another business's
                // accounts. Both facts are true, and side by side they invite one false reading.
                <Badge tone="caution">{t('disc.labelDiffers')}</Badge>
              )}
            {data.freshness === 'stale' && <Badge tone="caution">{t('disc.staleReading')}</Badge>}
          </div>
          {data.failure_code && <RunFailure code={data.failure_code} summary={data.failure_summary} />}
          <AssetResult
            title={t('disc.adAccounts')}
            result={data.ad_accounts}
            onImport={imports.importAccount}
            importingId={imports.importingId}
          />
          <AssetResult
            title={t('disc.pixels')}
            result={data.pixels}
            emptyNote={data.pixels.registry_absence_evaluable === false ? t('disc.pixelNoMapping') : undefined}
          />
          {data.business_users && (
            <BusinessUsersSection
              connectionId={connectionId}
              runId={data.id}
              result={data.business_users}
            />
          )}
          <ReadAtSentence
            completedAt={data.completed_at}
            identity={data.read_as?.name || data.read_as?.external_id || t('meta.unknownIdentity')}
          />
          {data.business_authority === 'not_established' && <AuthorityNote />}
        </div>
      )}
      <div className="mt-2 space-y-2">
        <ReadBackNote readBack={imports.readBack} onDismiss={imports.clearReadBack} />
        {run.isError && <ErrorState error={run.error} title={t('disc.startFailed')} compact />}
      </div>
    </div>
  )
}
