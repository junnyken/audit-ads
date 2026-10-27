import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/primitives/card'
import { Skeleton } from '../../components/primitives/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/primitives/tooltip'
import { LoadingRegion } from '../../components/states'
import { cn } from '../../lib/cn'
import { TONE_CLASS, type Tone } from '../../lib/readiness'

/** A titled card: the building block of every tab panel (template T3, two columns from xl). */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="items-center">
        <CardTitle className="text-sm">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

/** One term/description pair inside a `<dl className="grid ...">`. */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

export const DL_CLASS = 'grid grid-cols-[minmax(0,9.5rem)_1fr] gap-x-3 gap-y-2 text-sm'

/** A short note. Neutral unless a tone is given; a tone is for a note that must not read as
 * background information (and never `positive` for an unknown state). */
export function Note({
  children,
  tone,
  className,
  role,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  role?: 'alert' | 'status' | 'note'
}) {
  return (
    <p
      role={role}
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        tone ? TONE_CLASS[tone] : 'border-line bg-surface-muted text-ink-muted',
        className,
      )}
    >
      {children}
    </p>
  )
}

/** Loading state for a tab: blocks shaped like the cards that will replace them. */
export function TabSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <LoadingRegion className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </LoadingRegion>
  )
}

/**
 * Why a control is unavailable, for people who still need to know the feature exists (skill 6.6).
 * A disabled button cannot take focus, so the tooltip hangs on a focusable wrapper, and the reason
 * is also in the DOM (sr-only) and linked with aria-describedby for assistive technology.
 */
export function DisabledReason({
  reason,
  id,
  children,
}: {
  /** `null` when the control is available: children render untouched. */
  reason: string | null
  id: string
  children: ReactNode
}) {
  if (!reason) return <>{children}</>
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md" aria-describedby={id}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </TooltipProvider>
  )
}
