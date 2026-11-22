import { useI18n } from '../../i18n'
import { cn } from '../../lib/cn'

/** Product mark + name. The product name is a proper noun and is not translated. */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center')}>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand text-xs font-bold text-brand-fg shadow-xs"
      >
        AO
      </span>
      <span className={cn('text-sm font-semibold leading-tight tracking-tight text-ink', collapsed && 'sr-only')}>
        {t('common.appName')}
      </span>
    </div>
  )
}
