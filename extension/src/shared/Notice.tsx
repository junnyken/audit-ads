import type { ReactNode } from 'react'
import { useLanguage } from './i18n'
import { Icon } from './Icon'

/** A boxed note with a leading icon. `error` and `caution` use tone tokens, never raw colours. */
export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'error' | 'caution'
  children: ReactNode
}) {
  return (
    <p className={kind === 'info' ? 'notice' : `notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name={kind === 'info' ? 'info' : 'alert'} />
      <span>{children}</span>
    </p>
  )
}

/** Icon-only refresh; its accessible name is the translated "Refresh". */
export function RefreshButton({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" className="icon" aria-label={t('common.refresh')} title={t('common.refresh')} onClick={onClick}>
      <Icon name="refresh" />
    </button>
  )
}
