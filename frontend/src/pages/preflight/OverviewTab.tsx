import type { CampaignDraft } from '../../lib/types'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { DL_CLASS, Panel, Row } from '../account/parts'

export default function OverviewTab({ draft }: { draft: CampaignDraft }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={t('pf.ov.identity')}>
        <dl className={DL_CLASS}>
          <Row label={t('pf.ov.title')}>{draft.title}</Row>
          <Row label={t('pf.ov.account')}>{draft.account_display_name ?? '—'}</Row>
          <Row label={t('pf.ov.objective')}>{draft.objective ? enumLabel('objective', draft.objective) : '—'}</Row>
        </dl>
      </Panel>

      <Panel title={t('pf.ov.copy')}>
        <dl className={DL_CLASS}>
          <Row label={t('pf.ov.primaryCopy')}>
            <span className="whitespace-pre-wrap">{draft.primary_copy || '—'}</span>
          </Row>
          <Row label={t('pf.ov.headline')}>{draft.headline ?? '—'}</Row>
          <Row label={t('pf.ov.description')}>{draft.description ?? '—'}</Row>
          <Row label={t('pf.ov.cta')}>{draft.call_to_action ?? '—'}</Row>
        </dl>
      </Panel>

      <Panel title={t('pf.ov.landing')}>
        <dl className={DL_CLASS}>
          <Row label={t('pf.ov.url')}>
            {draft.landing_page_url ? (
              <a href={draft.landing_page_url} target="_blank" rel="noreferrer" className="break-all text-brand-text hover:underline">
                {draft.landing_page_url}
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label={t('pf.ov.creative')}>{draft.creative_reference ?? '—'}</Row>
        </dl>
      </Panel>

      <Panel title={t('pf.ov.budget')}>
        <dl className={DL_CLASS}>
          <Row label={t('pf.ov.budgetAmount')}>
            <span className="font-mono">{draft.budget_amount ? `${draft.budget_amount} ${draft.budget_currency ?? ''}` : '—'}</span>
          </Row>
          <Row label={t('pf.ov.change')}>
            <span className="font-mono">{draft.budget_change_percent !== null ? `${draft.budget_change_percent}%` : '—'}</span>
          </Row>
          <Row label={t('pf.ov.targeting')}>
            <span className="whitespace-pre-wrap">{draft.targeting_summary ?? '—'}</span>
          </Row>
        </dl>
      </Panel>
    </div>
  )
}
