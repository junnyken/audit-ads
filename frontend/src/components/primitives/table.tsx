import * as React from 'react'
import { cn } from '../../lib/cn'

/**
 * shadcn/ui Table, copied in (MIT) with two project additions:
 *  - `cards`: at 640px and below each row becomes a stacked card (CSS in index.css, `.tbl-cards`).
 *    A table whose display is overridden loses its table semantics in some browsers, so in this
 *    mode the ARIA roles are written out explicitly.
 *  - `TableCell label`: the caption shown in front of a value in card mode (`data-label`).
 */
const CardsContext = React.createContext(false)

const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & { cards?: boolean; containerClassName?: string }
>(({ className, containerClassName, cards = false, ...props }, ref) => (
  <CardsContext.Provider value={cards}>
    <div className={cn('w-full overflow-x-auto', containerClassName)}>
      <table
        ref={ref}
        role={cards ? 'table' : undefined}
        className={cn('w-full caption-bottom border-collapse text-sm', cards && 'tbl-cards', className)}
        {...props}
      />
    </div>
  </CardsContext.Provider>
))
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    const cards = React.useContext(CardsContext)
    return (
      <thead
        ref={ref}
        role={cards ? 'rowgroup' : undefined}
        className={cn('bg-surface-sunken', className)}
        {...props}
      />
    )
  },
)
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    const cards = React.useContext(CardsContext)
    return <tbody ref={ref} role={cards ? 'rowgroup' : undefined} className={className} {...props} />
  },
)
TableBody.displayName = 'TableBody'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => {
    const cards = React.useContext(CardsContext)
    return (
      <tr
        ref={ref}
        role={cards ? 'row' : undefined}
        className={cn('transition-colors hover:bg-surface-sunken/60', className)}
        {...props}
      />
    )
  },
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric = false, ...props }, ref) => {
  const cards = React.useContext(CardsContext)
  return (
    <th
      ref={ref}
      scope="col"
      role={cards ? 'columnheader' : undefined}
      className={cn(
        'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase leading-4 tracking-[0.04em] text-ink-faint',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  )
})
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; label?: string }
>(({ className, numeric = false, label, ...props }, ref) => {
  const cards = React.useContext(CardsContext)
  return (
    <td
      ref={ref}
      role={cards ? 'cell' : undefined}
      data-label={label}
      className={cn(
        'min-h-10 border-t border-line px-3 py-2 align-middle',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  )
})
TableCell.displayName = 'TableCell'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
