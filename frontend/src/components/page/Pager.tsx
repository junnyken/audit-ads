import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { formatCount } from '../../lib/format'

/** Previous / next with "Trang x/y". Counts are real counts: a missing total is not shown as 0. */
export function Pager({
  page,
  pages,
  total,
  onPage,
  note,
}: {
  page: number
  pages: number
  total?: number
  onPage: (page: number) => void
  note?: string
}) {
  const { t } = useI18n()
  const last = pages || 1
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ink-muted">
        {t('pager.page', { page, pages: last })}
        {total !== undefined && ` · ${t('pager.total', { count: formatCount(total) })}`}
        {note && ` · ${note}`}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('pager.prev')}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>
          {t('pager.next')}
        </Button>
      </div>
    </div>
  )
}
