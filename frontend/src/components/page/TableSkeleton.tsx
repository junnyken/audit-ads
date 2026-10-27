import { LoadingRegion } from '../states'
import { Skeleton } from '../primitives/skeleton'
import { Card } from '../primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'

/** A table-shaped loading state: the real column names stay, the cells are placeholders. */
export function TableSkeleton({ columns, rows = 6 }: { columns: string[]; rows?: number }) {
  return (
    <LoadingRegion>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((name, index) => (
                <TableHead key={index}>{name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, row) => (
              <TableRow key={row} className="hover:bg-transparent">
                {columns.map((__, cell) => (
                  <TableCell key={cell}>
                    <Skeleton className="h-4 w-4/5" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </LoadingRegion>
  )
}

/** A stack of line placeholders for list-shaped content. */
export function ListSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <LoadingRegion className="space-y-2">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </LoadingRegion>
  )
}
