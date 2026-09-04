import type { ReactNode } from 'react'
import { TONE_CLASS, TONE_DOT, type Tone } from '../lib/readiness'

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  title,
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  )
}

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

export function StatTile({
  label,
  value,
  tone = 'neutral',
  hint,
  onClick,
  active = false,
}: {
  label: string
  value: number | string
  tone?: Tone
  hint?: string
  onClick?: () => void
  active?: boolean
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={hint}
      className={`card w-full px-4 py-3 text-left transition-colors ${
        onClick ? 'hover:border-line-strong cursor-pointer' : ''
      } ${active ? 'ring-2 ring-brand' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-faint">
          {label}
        </span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Wrapper>
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
      className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-900"
    >
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-0.5">{apiError?.message ?? 'Unexpected error.'}</p>
      {apiError?.requestId && (
        <p className="mt-1 font-mono text-[11px] text-rose-700">
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
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-1 text-rose-600">*</span>
        ) : (
          <span className="ml-1 font-normal text-ink-faint">(optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-ink-faint">{hint}</p>}
    </div>
  )
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-xl flex-col bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
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

export function Progress({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0
  const complete = total > 0 && value >= total
  return (
    <div className="flex items-center gap-2" title={`${value} of ${total} required items satisfied`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-slate-400'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="tabular-nums text-[11.5px] text-ink-muted">
        {value}/{total}
      </span>
    </div>
  )
}

export function InlineNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[11.5px] text-ink-muted">
      {children}
    </p>
  )
}
