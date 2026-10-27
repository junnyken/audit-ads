import type { ReactNode } from 'react'

/**
 * The title block every dashboard page starts with (U1 templates T1-T5): h1, one line saying what
 * the page is for, an optional count, and the page's primary action on the right. The h1 takes
 * programmatic focus (`tabIndex=-1`) so a dialog that was opened from state has somewhere to
 * return focus to when its opener is gone.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string
  description?: ReactNode
  /** A small line under the title, e.g. the record count. */
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1
          tabIndex={-1}
          className="text-xl font-semibold leading-7 outline-none min-[1024px]:text-2xl min-[1024px]:leading-8"
        >
          {title}
        </h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-ink-muted">{description}</p>}
        {meta && <p className="mt-0.5 text-xs text-ink-muted">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
