import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StudioTone = 'live' | 'warning' | 'critical' | 'info' | 'muted'

const DOT_STYLES: Record<StudioTone, string> = {
  live: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)]',
  warning: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]',
  critical: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]',
  info: 'bg-primary shadow-[0_0_8px_rgba(59,130,246,0.45)]',
  muted: 'bg-muted-foreground/45',
}

const TEXT_STYLES: Record<StudioTone, string> = {
  live: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-rose-600 dark:text-rose-400',
  info: 'text-primary',
  muted: 'text-muted-foreground',
}

/**
 * 6px luminous StatusDot replacing loud rectangle neon badges.
 */
export function StatusDot({
  tone = 'muted',
  label,
  className,
  dotClassName,
  labelClassName,
}: {
  tone?: StudioTone
  label?: ReactNode
  className?: string
  dotClassName?: string
  labelClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)}>
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_STYLES[tone], dotClassName)}
      />
      {label !== undefined && label !== null ? (
        <span className={cn(TEXT_STYLES[tone], labelClassName)}>{label}</span>
      ) : null}
    </span>
  )
}

/**
 * Compact radial TrustRing (28px SVG) + 3 micro signal indicators.
 */
export function TrustRing({
  score,
  signals,
  size = 28,
}: {
  score: number
  signals?: Array<{ label: string; ok: boolean; warn?: boolean }>
  size?: number
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const strokeWidth = 2.6
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (clamped / 100) * circumference

  const ringColor =
    clamped >= 70
      ? 'text-emerald-500'
      : clamped >= 45
      ? 'text-amber-500'
      : 'text-rose-500'

  return (
    <div className="inline-flex items-center gap-2.5">
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/80"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn('transition-all duration-300', ringColor)}
          />
        </svg>
        <span className="absolute font-mono text-[9px] font-semibold tabular-nums text-foreground">
          {clamped}
        </span>
      </div>

      {signals && signals.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {signals.map((sig) => (
              <span
                key={sig.label}
                title={`${sig.label}: ${sig.ok ? 'Đạt' : 'Cần bổ sung'}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1 py-[1px] font-mono text-[10px] font-medium',
                  sig.ok
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : sig.warn
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-muted/70 text-muted-foreground/75',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1 w-1 rounded-full',
                    sig.ok ? 'bg-emerald-500' : sig.warn ? 'bg-amber-500' : 'bg-muted-foreground/45',
                  )}
                />
                {sig.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export interface SegmentedTabItem<T extends string> {
  value: T
  label: string
  count?: number
}

/**
 * Quiet Linear-style segmented switcher replacing noisy chip rows.
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: SegmentedTabItem<T>[]
  value: T
  onChange: (val: T) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/75 bg-muted/55 p-0.5',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all whitespace-nowrap',
              active
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground border border-transparent',
            )}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={cn(
                  'font-mono text-[10.5px] tabular-nums',
                  active ? 'text-muted-foreground' : 'text-muted-foreground/65',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Progressive-disclosure anchored "+ Bộ lọc" popover housing secondary filters cleanly.
 */
export function FilterPopover({
  activeCount = 0,
  onReset,
  children,
  label = 'Bộ lọc',
  align = 'right',
}: {
  activeCount?: number
  onReset?: () => void
  children: ReactNode
  label?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
          open || activeCount > 0
            ? 'border-primary/45 bg-primary/10 text-primary'
            : 'border-border/80 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>{label}</span>
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-40 mt-1.5 w-[340px] max-w-[92vw] rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="mb-3 flex items-center justify-between border-b border-border/70 pb-2">
            <span className="text-xs font-semibold text-foreground">Bộ lọc nâng cao</span>
            {onReset && activeCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Đặt lại
              </button>
            )}
          </div>
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </div>
  )
}

/**
 * Mutes zero/dash financial values while highlighting real amounts in crisp tabular monospace.
 */
export function FinancialValue({
  value,
  className,
}: {
  value: string | null | undefined
  className?: string
}) {
  const raw = (value ?? '').trim()
  const isZeroOrEmpty =
    !raw ||
    raw === '—' ||
    raw === '-' ||
    /^0(\.0+)?(\s*(VND|USD|vnđ|đ))?$/i.test(raw) ||
    /^(HN|7D):\s*—$/i.test(raw)

  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        isZeroOrEmpty ? 'text-muted-foreground/45 font-normal' : 'text-foreground font-medium',
        className,
      )}
    >
      {raw || '—'}
    </span>
  )
}
