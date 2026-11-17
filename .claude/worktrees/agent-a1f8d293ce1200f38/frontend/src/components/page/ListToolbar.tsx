import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Columns3, ListFilter } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'

/**
 * The T2 toolbar: a primary row (search, the three or four filters that matter, an optional
 * column chooser) and a "Bộ lọc khác" panel that holds the rest. The panel opens by default when
 * one of its filters is already active, so an active filter is never hidden.
 */
export function ListToolbar({
  label,
  primary,
  more,
  moreCount,
  columns,
}: {
  label: string
  primary: ReactNode
  more?: ReactNode
  /** How many filters inside the panel are active (shown as a badge on the button). */
  moreCount?: number
  columns?: ReactNode
}) {
  const { t } = useI18n()
  const [moreOpen, setMoreOpen] = useState((moreCount ?? 0) > 0)
  const moreId = useId()
  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {primary}
        {more && (
          <Button type="button" variant="secondary" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((open) => !open)}>
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            {t('filter.more')}
            {(moreCount ?? 0) > 0 && (
              <span className="rounded-full bg-brand-light px-1.5 text-2xs font-semibold text-brand-text">{moreCount}</span>
            )}
          </Button>
        )}
        {columns}
      </div>
      {more && moreOpen && (
        <Card id={moreId} className="flex flex-wrap items-end gap-3 p-3">
          {more}
        </Card>
      )}
    </section>
  )
}

/** "Cột" chooser: optional columns on/off, remembered by the caller. */
export function ColumnChooser<T extends string>({
  ids,
  labelOf,
  visible,
  defaults,
  onChange,
}: {
  ids: readonly T[]
  labelOf: Record<T, TranslationKey>
  visible: readonly T[]
  defaults: readonly T[]
  onChange: (next: T[]) => void
}) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary">
          <Columns3 className="h-4 w-4" aria-hidden="true" />
          {t('col.chooser')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('col.chooserLabel')}</DropdownMenuLabel>
        {ids.map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={visible.includes(id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onChange(ids.filter((c) => (c === id ? checked : visible.includes(c))))}
          >
            {t(labelOf[id])}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange([...defaults])}>{t('col.chooserReset')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
