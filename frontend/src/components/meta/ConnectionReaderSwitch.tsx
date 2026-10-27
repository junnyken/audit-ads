import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { api } from '../../lib/api'
import type { MetaConnection } from '../../lib/types'
import { Button } from '../primitives/button'
import { ErrorState } from '../ui'
import { useI18n } from '../../i18n'

/**
 * O4. Other active vault credentials that also saw this connection's Business Manager.
 *
 * Offered, never applied: which identity reads a Business Manager decides what an inventory
 * shows, so switching is the owner's explicit, audited act (`POST …/reader-credential`). The
 * system never switches on its own — not even when the bound credential has died.
 */
export function ConnectionReaderSwitch({ connection }: { connection: MetaConnection }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const others = connection.other_readers ?? []
  const assign = useMutation({
    mutationFn: (readerId: string) =>
      api.post<MetaConnection>(`/api/v1/meta-connections/${connection.id}/reader-credential`, {
        reader_id: readerId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-connection', connection.id] })
      void queryClient.invalidateQueries({ queryKey: ['meta-reader-credentials'] })
    },
  })
  if (others.length === 0) return null

  return (
    <div className="space-y-1.5 text-[11.5px] text-ink-muted">
      <p>{t('readerSource.otherReaders', { labels: others.map((o) => o.label).join(', ') })}</p>
      <div className="flex flex-wrap gap-2">
        {others.map((other) => (
          <Button
            key={other.id}
            variant="secondary"
            size="sm"
            disabled={assign.isPending}
            onClick={() => assign.mutate(other.id)}
          >
            <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" />
            {t('readerSource.useThis', { label: other.label })}
          </Button>
        ))}
      </div>
      {assign.isError && <ErrorState error={assign.error} />}
    </div>
  )
}
