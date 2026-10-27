import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { api } from '../../lib/api'
import type { MetaConnection } from '../../lib/types'
import { Button } from '../primitives/button'
import { useI18n } from '../../i18n'
import { ConfirmDialog, ReadBackNote, type ReadBack } from './confirm'

/**
 * O4. Other active vault credentials that also saw this connection's Business Manager.
 *
 * Offered, never applied: which identity reads a Business Manager decides what an inventory
 * shows, so switching is the owner's explicit, audited act (`POST …/reader-credential`). The
 * system never switches on its own — not even when the bound credential has died. The owner is
 * asked once, in words, and then shown which credential the server says is bound now.
 */
export function ConnectionReaderSwitch({ connection }: { connection: MetaConnection }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const others = connection.other_readers ?? []
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null)
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const assign = useMutation({
    mutationFn: (readerId: string) =>
      api.post<MetaConnection>(`/api/v1/meta-connections/${connection.id}/reader-credential`, {
        reader_id: readerId,
      }),
  })
  if (others.length === 0 && !readBack) return null

  async function apply() {
    if (!target) return
    const saved = await assign.mutateAsync(target.id)
    await queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
    await queryClient.invalidateQueries({ queryKey: ['meta-connection', connection.id] })
    await queryClient.invalidateQueries({ queryKey: ['meta-reader-credentials'] })
    // The response is the server's own statement of which credential is bound now.
    const actual = saved.reader_credential?.label ?? '—'
    const ok = saved.reader_credential?.id === target.id
    setReadBack({
      ok,
      text: ok
        ? t('readerSwitch.readback.ok', { connection: connection.label, reader: target.label })
        : t('readerSwitch.readback.mismatch', { connection: connection.label, reader: target.label, actual }),
    })
  }

  return (
    <div className="space-y-1.5 text-xs text-ink-muted">
      {others.length > 0 && (
        <>
          <p>{t('readerSource.otherReaders', { labels: others.map((o) => o.label).join(', ') })}</p>
          <div className="flex flex-wrap gap-2">
            {others.map((other) => (
              <Button key={other.id} variant="secondary" size="sm" onClick={() => setTarget(other)}>
                <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" />
                {t('readerSource.useThis', { label: other.label })}
              </Button>
            ))}
          </div>
        </>
      )}
      <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={t('readerSwitch.title', { reader: target?.label ?? '', connection: connection.label })}
        object={connection.label}
        effects={[
          t('readerSwitch.effect', { reader: target?.label ?? '' }),
          t('readerSwitch.keep'),
        ]}
        irreversible={false}
        confirmLabel={t('readerSwitch.confirm')}
        onConfirm={apply}
      />
    </div>
  )
}
