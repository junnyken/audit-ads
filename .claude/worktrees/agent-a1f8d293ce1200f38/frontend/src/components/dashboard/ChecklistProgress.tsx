import { useI18n } from '../../i18n'
import { cn } from '../../lib/cn'

/**
 * Required checklist items satisfied, as a small bar plus "done/total". No required items
 * determined is "—", never "0/0" or an empty bar (data honesty). The bar uses the brand colour
 * when full, not a success green: a full checklist is one input to readiness, not readiness
 * itself (rule 11), and it often sits beside a "not ready" badge.
 */
export function ChecklistProgress({ done, total }: { done?: number | null; total?: number | null }) {
  const { t } = useI18n()
  if (done === null || done === undefined || total === null || total === undefined || total <= 0) {
    return (
      <span title={t('row.checklistNone')}>
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
        <span className="sr-only">{t('row.checklistNone')}</span>
      </span>
    )
  }
  const percent = Math.min(100, Math.round((done / total) * 100))
  return (
    <div className="inline-flex items-center gap-2" title={t('row.checklist', { done, total })}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <div
          className={cn('h-full rounded-full', done >= total ? 'bg-brand' : 'bg-ink-faint')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-ink-muted">
        {done}/{total}
        <span className="sr-only"> — {t('row.checklist', { done, total })}</span>
      </span>
    </div>
  )
}
