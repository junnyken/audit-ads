import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet'
import { cn } from '../../lib/cn'

/**
 * The right-hand form/detail Sheet (template T4): title, description, scrolling body, footer.
 * Radix returns focus only to a `<Trigger>`; these sheets are opened from state, so the element
 * that had focus when the sheet opened is remembered and given back on close, falling back to the
 * page heading when that element is gone.
 */
export function FormSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const { t } = useI18n()
  const returnFocusTo = useRef<HTMLElement | null>(null)
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('common.close')}
        className={cn('w-full sm:w-[30rem] sm:max-w-[30rem]', wide && 'sm:w-[40rem] sm:max-w-[40rem]')}
        onOpenAutoFocus={() => {
          returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = returnFocusTo.current
          if (target?.isConnected && target !== document.body) target.focus()
          else document.querySelector<HTMLElement>('h1')?.focus()
        }}
      >
        <header className="space-y-1 border-b border-line px-4 py-3 pr-14">
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-sm text-ink-muted">{description}</SheetDescription>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </SheetContent>
    </Sheet>
  )
}
