import { useI18n } from '../../i18n'

/** Product mark + name. The product name is a proper noun and is not translated. */
export function BrandMark() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded-md bg-brand text-xs font-bold text-brand-fg"
      >
        AO
      </span>
      <span className="text-sm font-semibold leading-tight">{t('common.appName')}</span>
    </div>
  )
}
