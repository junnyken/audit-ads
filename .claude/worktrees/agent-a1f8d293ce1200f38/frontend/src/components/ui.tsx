import type { ReactNode } from 'react'
import { TONE_CLASS, type Tone } from '../lib/readiness'

// The old component set. U1d moved every page except the Meta connection screens (O4 owns those) and
// Settings/Login to the primitives in `components/primitives` and `components/states`; what remains here is
// exactly what those files still import. Delete this file when the Meta connection screens are restyled.
// Badge moved to primitives/badge.tsx (U1b); re-exported so existing imports keep working.
export { Badge } from './primitives/badge'

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <p className="text-[14px] font-semibold">{title}</p>
      <p className="max-w-md text-[12.5px] text-ink-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  const apiError = error as { message?: string; requestId?: string | null; code?: string }
  return (
    <div
      role="alert"
      className={`rounded-lg border px-4 py-3 text-[12.5px] ${TONE_CLASS.attention}`}
    >
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-0.5">{apiError?.message ?? 'Unexpected error.'}</p>
      {apiError?.requestId && (
        <p className="mt-1 font-mono text-[11px]">
          Reference ID: {apiError.requestId}
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded bg-surface-sunken" />
      ))}
    </div>
  )
}

export function Field({
  label,
  hint,
  required = false,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
  htmlFor?: string
}) {
  const caption = (
    <>
      {label}
      {required ? (
        <span className="ml-1 text-tone-attention-fg">*</span>
      ) : (
        <span className="ml-1 font-normal text-ink-faint">(optional)</span>
      )}
    </>
  )
  const note = hint ? <p className="mt-1 text-[11.5px] text-ink-faint">{hint}</p> : null

  if (htmlFor) {
    return (
      <div>
        <label className="label" htmlFor={htmlFor}>
          {caption}
        </label>
        {children}
        {note}
      </div>
    )
  }

  // Without an explicit id, wrap the control in the label so the association is implicit rather
  // than absent — an unwrapped <label> with no `for` announces nothing to a screen reader.
  return (
    <label className="block">
      <span className="label">{caption}</span>
      {children}
      {note}
    </label>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; badge?: ReactNode }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="table-scroll border-b border-line">
      <div role="tablist" className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={active === tab.key}
            onClick={() => onChange(tab.key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              active === tab.key
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.badge}
          </button>
        ))}
      </div>
    </div>
  )
}

export function InlineNote({ children, tone }: { children: ReactNode; tone?: Tone }) {
  // Optional and additive: every existing note keeps the neutral styling it was written with.
  // A tone is for a note that must not read as ordinary background information.
  const toned = tone ? TONE_CLASS[tone] : 'border-line bg-surface-muted text-ink-muted'
  return <p className={`rounded-md border px-3 py-2 text-[11.5px] ${toned}`}>{children}</p>
}
