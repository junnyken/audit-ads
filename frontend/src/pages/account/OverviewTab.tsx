import type { UseQueryResult } from '@tanstack/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { AccountStatus, AdAccount, ImportProvenance, Readiness, SpendView } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Skeleton } from '../../components/primitives/skeleton'
import { ErrorState, LoadingRegion } from '../../components/states'
import PlatformStatusBadge from '../../components/PlatformStatusBadge'
import { READINESS_META, accountStatusTone, severityTone } from '../../lib/readiness'
import { disableReasonText, platformStatusBadge, recordedStatusSuggestion } from '../../lib/platformStatus'
import { formatDateTime, formatRelative } from '../../lib/format'
import { getActiveLanguage, translate } from '../../i18n/translate'
import type { Language } from '../../i18n/types'
import { useEnumLabel } from '../../i18n/labels'
import { useI18n } from '../../i18n'
import { useAuth } from '../../hooks/useAuth'
import { DL_CLASS, Note, Panel, Row } from './parts'
import { LoginToFixPanel } from '../../components/facebook/LoginToFixPanel'

/** Where an imported record came from, in one sentence. O3 adds two facts: whether the discovery
 * sweep added it on its own, and — for an account shared into the hub — which Business Manager
 * Meta said owns it. That owner is provenance only; the record stays under the Business Manager
 * whose connection can read it. When Meta did not return an owner, the sentence says so rather
 * than guessing. */
export function provenanceText(imported: ImportProvenance, language: Language = getActiveLanguage()): string {
  const bm = imported.business_manager_reference ?? translate(language, 'prov.bmNone')
  const how = translate(language, imported.automatic ? 'prov.how.auto' : 'prov.how.manual', { bm })
  const edge = imported.source_edge ? translate(language, 'prov.edge', { edge: imported.source_edge }) : ''
  const when = imported.imported_at
    ? translate(language, 'prov.when', { time: formatDateTime(imported.imported_at, language) })
    : ''
  let owner: string | null = null
  if (imported.source_edge === 'client_ad_accounts') {
    owner = imported.owner_business_reference
      ? translate(language, imported.owner_business_name ? 'prov.sharedNamed' : 'prov.shared', {
          ref: imported.owner_business_reference,
          name: imported.owner_business_name ?? '',
        })
      : translate(language, 'prov.ownerMissing')
  }
  return [`${how}${edge}${when}.`, owner, translate(language, 'prov.nothing')].filter(Boolean).join(' ')
}

/** The `unknown` sentence was written when every record in A1 was typed by hand, and A10.3's
 * registry import made half of it false: an imported account's name and external id *were* fetched
 * from a platform, by a read-only discovery. "Never synced" stays true — no figures or platform
 * status have been pulled — which is why the wrong half survived: the sentence is half right.
 *
 * So the claim is made per record rather than per freshness status. Seen on a real screen on
 * 2026-09-14 under an imported account. */
export function freshnessText(
  status: string,
  imported: ImportProvenance | null | undefined,
  language: Language = getActiveLanguage(),
): string {
  if (status === 'current') return translate(language, 'fresh.current')
  if (status === 'stale') return translate(language, 'fresh.stale')
  if (status === 'unknown') return translate(language, imported ? 'fresh.unknownImported' : 'fresh.unknown')
  return ''
}

export default function OverviewTab({
  account,
  readiness,
  onChanged,
  onRecordMetaStatus,
  onOpenSpend,
}: {
  account: AdAccount
  readiness: UseQueryResult<Readiness>
  onChanged: () => void
  /** S2: opens the existing edit sheet, optionally pre-selecting a recorded status. Never saves. */
  onRecordMetaStatus?: (status: AccountStatus | null, note: string) => void
  onOpenSpend?: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const canRecord = user?.role === 'owner' || user?.role === 'admin'
  // S2: the full platform-status block lives on the spend view (stored observations only).
  const spend = useQuery({
    queryKey: ['spend', account.id],
    queryFn: () => api.get<SpendView>(`/api/v1/ad-accounts/${account.id}/spend`),
  })
  const platform = spend.data?.platform_status ?? null
  const [note, setNote] = useState('')
  const recordReview = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${account.id}/readiness/manual-review`, { note }),
    onSuccess: () => {
      setNote('')
      onChanged()
    },
  })

  const meta = READINESS_META[account.readiness_status]
  const readinessData = readiness.data

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={t('ov.identity.title')}>
        <dl className={DL_CLASS}>
          <Row label={t('ov.name')}>{account.display_name}</Row>
          <Row label={t('ov.externalId')}>
            <span className="font-mono">{account.external_account_id ?? '—'}</span>
          </Row>
          <Row label={t('ov.type')}>{enumLabel('accountType', account.account_type)}</Row>
          <Row label={t('ov.recorded')}>
            <Badge tone={accountStatusTone(account.status)}>{enumLabel('accountStatus', account.status)}</Badge>
          </Row>
          <Row label={t('ov.meta')}>
            {spend.isLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : spend.isError ? (
              <span className="text-ink-muted">{t('ov.metaFailed')}</span>
            ) : (
              <PlatformStatusBadge value={platform} inline />
            )}
          </Row>
          {platform && (
            <>
              <Row label={t('ov.disableReason')}>
                <span className="font-mono text-xs">
                  {disableReasonText(platform.disable_reason, platform.disable_reason_raw)}
                </span>
              </Row>
              <Row label={t('ov.observedAt')}>
                <span className="tabular-nums">{formatDateTime(platform.observed_at)}</span>
                {platform.observation_status === 'failed' && (
                  <span className="text-ink-muted">
                    {' · '}
                    {t('ov.readFailedNote', { code: platform.failure_code ?? t('common.unknownCode') })}
                  </span>
                )}
                {platform.previous?.account_status_raw && (
                  <span className="block text-xs text-ink-muted">
                    {t('ov.before', {
                      code: platform.previous.account_status_raw,
                      time: formatDateTime(platform.previous.observed_at),
                    })}
                  </span>
                )}
              </Row>
            </>
          )}
          {spend.data && spend.data.latest_attempt?.status === 'failed' && platform && (
            <Row label={t('ov.latestRead')}>
              <span className="text-ink-muted">
                {t('ov.latestReadFailed', {
                  code: spend.data.latest_attempt.failure_code ?? t('common.unknownCode'),
                  time: formatDateTime(spend.data.latest_attempt.observed_at),
                })}
              </span>
            </Row>
          )}
          <Row label={t('ov.countryCurrency')}>
            {[account.country, account.currency].filter(Boolean).join(' / ') || '—'}
          </Row>
          <Row label={t('ov.timezone')}>{account.timezone ?? '—'}</Row>
          <Row label={t('ov.tags')}>{account.tags.length ? account.tags.join(', ') : '—'}</Row>
          <Row label={t('ov.created')}>
            <span className="tabular-nums">{formatDateTime(account.created_at)}</span>
          </Row>
        </dl>
        {platform && <Note>{platform.disclaimer}</Note>}
        <div className="flex flex-wrap gap-2">
          {onOpenSpend && (
            <Button variant="ghost" size="sm" onClick={onOpenSpend}>
              {t('ov.statusHistory')}
            </Button>
          )}
          {canRecord && account.archived_at === null && platform && onRecordMetaStatus && (
            <Button
              variant="secondary"
              size="sm"
              title={t('ov.recordMetaHint')}
              onClick={() =>
                onRecordMetaStatus(
                  recordedStatusSuggestion(platform.status),
                  t('ov.recordMetaNote', {
                    code: platform.account_status_raw ?? '—',
                    label: platformStatusBadge(platform).label,
                    time: formatDateTime(platform.observed_at),
                  }),
                )
              }
            >
              {t('ov.recordMeta')}
            </Button>
          )}
        </div>
      </Panel>

      <Panel title={t('ov.ownership.title')}>
        <dl className={DL_CLASS}>
          <Row label={t('ov.bm')}>{account.business_manager_name ?? t('ov.notMapped')}</Row>
          <Row label={t('ov.personalRef')}>{account.personal_account_reference_label ?? t('ov.notMapped')}</Row>
          <Row label={t('ov.ownerLabel')}>{account.owner_label || '—'}</Row>
          <Row label={t('ov.landing')}>
            {account.landing_page_url ? (
              <a
                className="text-brand-text hover:underline"
                href={account.landing_page_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {account.landing_page_url}
              </a>
            ) : (
              t('ov.landingNone')
            )}
          </Row>
          <Row label={t('ov.workflow')}>
            {[account.requires_page && 'Page', account.requires_pixel && 'Pixel'].filter(Boolean).join(', ') ||
              t('ov.workflowNone')}
          </Row>
        </dl>
      </Panel>

      <LoginToFixPanel identities={account.facebook_identities} />

      <Panel title={t('ov.readiness.title')}>
        {readiness.isLoading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </LoadingRegion>
        ) : readiness.isError ? (
          <ErrorState error={readiness.error} onRetry={() => readiness.refetch()} compact />
        ) : readinessData ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone} dot>
                {enumLabel('readiness', account.readiness_status)}
              </Badge>
              <span className="text-xs text-ink-muted">
                {readinessData.required_item_count > 0
                  ? t('ov.itemsSatisfied', {
                      done: readinessData.completed_item_count,
                      total: readinessData.required_item_count,
                    })
                  : t('ov.itemsNone')}
              </span>
            </div>
            <p className="text-sm text-ink-muted">{t(`readinessHint.${account.readiness_status}`)}</p>
            {readinessData.reasons.length > 0 && (
              <ul className="space-y-1.5">
                {readinessData.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="flex items-start gap-2">
                    <Badge tone={severityTone(reason.severity)}>{enumLabel('severity', reason.severity)}</Badge>
                    {/* Server-written sentence, shown as the server sent it. */}
                    <span className="text-sm">{reason.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <Note>{readinessData.disclaimer}</Note>
          </div>
        ) : null}
      </Panel>

      <Panel title={t('ov.review.title')}>
        <dl className={DL_CLASS}>
          <Row label={t('ov.lastReview')}>
            {account.last_manual_review_at ? (
              <span className="tabular-nums">
                {formatDateTime(account.last_manual_review_at)} ({formatRelative(account.last_manual_review_at)})
              </span>
            ) : (
              t('ov.neverReviewed')
            )}
          </Row>
          <Row label={t('ov.evaluated')}>
            <span className="tabular-nums">{formatDateTime(account.readiness_evaluated_at)}</span>
          </Row>
          <Row label={t('ov.lastSynced')}>
            {readinessData ? enumLabel('dataFreshness', readinessData.data_freshness.status) : '—'}
          </Row>
        </dl>
        {readinessData && (
          <Note>{freshnessText(readinessData.data_freshness.status, account.imported_from_discovery)}</Note>
        )}
        {account.imported_from_discovery && (
          // Provenance was always in the Audit History tab, behind a raw action name and a JSON
          // blob. Saying it here costs one sentence and answers the question an operator actually
          // has in front of the record: where did this come from?
          <p className="text-xs text-ink-muted">{provenanceText(account.imported_from_discovery)}</p>
        )}

        {account.archived_at === null && (
          <form
            className="space-y-2 border-t border-line pt-3"
            onSubmit={(event) => {
              event.preventDefault()
              recordReview.mutate()
            }}
          >
            <label className="label" htmlFor="review-note">
              {t('ov.record.label')}
            </label>
            <textarea
              id="review-note"
              className="input min-h-[64px]"
              placeholder={t('ov.record.placeholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              required
            />
            {recordReview.isError && <ErrorState error={recordReview.error} compact />}
            <Button type="submit" disabled={!note.trim() || recordReview.isPending}>
              {recordReview.isPending ? t('common.working') : t('ov.record.submit')}
            </Button>
          </form>
        )}
      </Panel>

      <Panel title={t('ov.notes.title')} className="xl:col-span-2">
        <p className="whitespace-pre-wrap text-sm text-ink-muted">{account.notes || t('ov.notes.none')}</p>
      </Panel>
    </div>
  )
}
