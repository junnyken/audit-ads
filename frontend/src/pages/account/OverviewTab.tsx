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
import { Building2, Calendar, ExternalLink, ShieldCheck, Wallet } from 'lucide-react'
import { formatDateTime, formatRelative } from '../../lib/format'
import { prettyMoney } from '../../lib/spend'
import { launchInAssignedChromeProfile } from '../../lib/chromeProfileLauncher'
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
      {/* Bảng Thanh toán, Ngưỡng Bill & Thông tin Doanh nghiệp (chuẩn Meta Billing Hub) */}
      {(() => {
        const bm = account.billing_meta ?? {}
        const curr = account.currency || account.spend?.observed_currency || 'VND'
        const rawBal = bm.balance_raw ?? account.spend_periods?.balance_raw ?? '0'
        const numBal = Number(rawBal) || 0
        const rawThresh = bm.billing_threshold_raw ?? null
        const numThresh = rawThresh ? Number(rawThresh) || 0 : 0
        const pctThresh = numThresh > 0 ? Math.min(100, Math.round((numBal / numThresh) * 100)) : 0
        const billDate = bm.next_bill_date ?? 'Chưa thiết lập'
        const dailyLimit = bm.meta_daily_limit_raw ?? null
        const cardDisplay =
          bm.payment_card_display ||
          (account.payment_profile_labels?.[0]
            ? account.payment_profile_labels[0].split(' (')[0].replace('VISA *', 'Visa ···· ').replace('Mastercard *', 'Mastercard ···· ')
            : null)
        const cardExpiry = bm.payment_card_expiry ?? null
        const actRaw = (account.external_account_id || '').replace(/^act[-_]/i, '').trim()
        const billingUrl = actRaw
          ? `https://business.facebook.com/billing_hub/accounts/details?act=${encodeURIComponent(actRaw)}`
          : 'https://business.facebook.com/billing_hub/payment_activity'

        return (
          <div className="grid gap-4 xl:col-span-2 lg:grid-cols-12">
            {/* Cột trái (7/12): Dư nợ, Ngưỡng thanh toán, Ngày TT, Giới hạn chi tiêu ngày & Phương thức thanh toán */}
            <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xs lg:col-span-7">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Dư nợ hiện tại</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                      {prettyMoney(String(rawBal), curr)}
                    </span>
                    <span className="text-xs text-ink-muted">+ bất kỳ khoản phí nào có thể áp dụng</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {account.status === 'restricted' && numBal > 0
                      ? 'Tài khoản đang có khoản thanh toán đến hạn cần xử lý.'
                      : 'Hiện chưa có khoản thanh toán nào đến hạn.'}
                  </p>
                </div>
                {account.facebook_identities?.[0]?.browser_profile_label && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      launchInAssignedChromeProfile(
                        billingUrl,
                        account.facebook_identities![0].browser_profile_label,
                        account.facebook_identities![0].label,
                        account.facebook_identities![0].network_label,
                      )
                    }
                  >
                    Thanh toán ngay trên Meta
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>

              {/* Bạn sẽ thanh toán khi */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Bạn sẽ thanh toán khi
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted/50 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-muted">
                      <Wallet className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink-muted">Số dư của bạn đạt</div>
                      <div className="font-mono text-sm font-bold tabular-nums text-ink">
                        {rawThresh ? prettyMoney(rawThresh, curr) : 'Chưa đặt ngưỡng'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted/50 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-muted">
                      <Calendar className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink-muted">Và vào ngày này</div>
                      <div className="text-sm font-bold text-ink">{billDate}</div>
                    </div>
                  </div>
                </div>
                {numThresh > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${
                          pctThresh >= 90 ? 'bg-rose-500' : pctThresh >= 65 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pctThresh}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs font-semibold tabular-nums text-ink-muted">
                      Đã dùng {pctThresh}% ngưỡng bill
                    </span>
                  </div>
                )}
              </div>

              {/* Giới hạn chi tiêu hàng ngày (do Meta đặt) */}
              <div className="rounded-lg border border-line/80 bg-surface-muted/30 px-3.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    Giới hạn chi tiêu hàng ngày (do Meta đặt):{' '}
                    <strong className="font-mono font-bold tabular-nums">
                      {dailyLimit ? prettyMoney(dailyLimit, curr) : 'Không giới hạn'}
                    </strong>
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  Mức chi tiêu dự kiến hôm nay của bạn nằm trong giới hạn này
                </p>
              </div>

              {/* Phương thức thanh toán */}
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Phương thức thanh toán
                </h3>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 items-center rounded bg-blue-700 px-2.5 font-mono text-xs font-extrabold tracking-wider text-white">
                      {cardDisplay?.toLowerCase().includes('master') ? 'MASTERCARD' : 'VISA'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-ink">
                          {cardDisplay ?? 'Chưa gắn thẻ thanh toán'}
                        </span>
                        {cardDisplay && (
                          <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted border border-line">
                            Mặc định
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted">
                        {cardExpiry
                          ? `Hết hạn vào ${cardExpiry} · Tự động tính phí theo ${cardDisplay} để thanh toán dư nợ`
                          : 'Thanh toán tự động khi đạt ngưỡng lập hóa đơn'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-muted">
                    <div>Quỹ trả trước</div>
                    <div className="font-mono font-bold tabular-nums text-ink">{prettyMoney('0', curr)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cột phải (5/12): Thông tin doanh nghiệp & Xác minh thuế */}
            <div className="flex flex-col justify-between space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xs lg:col-span-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-brand-text" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-ink">Thông tin doanh nghiệp</h3>
                  </div>
                  {bm.bm_verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      BM Đã XMDN
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      BM Chưa XMDN
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-ink-muted">Tên doanh nghiệp</div>
                    <div className="mt-1 text-sm font-bold text-ink">
                      {bm.business_legal_name || 'Chưa khai báo pháp nhân'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-ink-muted">Địa chỉ</div>
                    <div className="mt-1 text-sm font-medium text-ink">
                      {bm.business_country_label || bm.business_country_code || account.country || 'Việt Nam'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-ink-muted">Đơn vị tiền tệ</div>
                    <div className="mt-1 text-sm font-medium text-ink">
                      {curr === 'VND' ? 'Đồng Việt Nam VND' : curr === 'USD' ? 'Đô la Mỹ USD' : curr}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                      <span>Mã số thuế</span>
                      {bm.tax_id_verified && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500" title="Đã xác minh" />
                      )}
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold text-ink">
                      {bm.tax_id
                        ? `${bm.tax_id} ${bm.tax_id_verified ? 'đã được xác minh' : '(chưa xác minh)'}`
                        : bm.tax_id_verified
                          ? 'Đã xác minh thuế trên Meta'
                          : 'Chưa cập nhật MST'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs text-ink-muted">
                <div className="font-semibold text-ink">
                  BM chủ quản: {account.business_manager_name ?? account.personal_account_reference_label ?? '—'}
                </div>
                <p className="mt-0.5">
                  Bạn có thể bấm nút <strong>Sửa</strong> ở góc phải phía trên để cập nhật nhanh Ngưỡng thanh toán, Ngày lập hóa đơn hoặc Thông tin doanh nghiệp của tài khoản này.
                </p>
              </div>
            </div>
          </div>
        )
      })()}

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
