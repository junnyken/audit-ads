import * as React from 'react'
import { cn } from '../../lib/cn'

/** shadcn/ui Skeleton: one decorative pulsing block. The busy state is announced by the wrapper. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-sunken', className)} {...props} />
}

export { Skeleton }
