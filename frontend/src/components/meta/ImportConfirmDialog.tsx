import { useI18n } from '../../i18n'
import { ConfirmDialog } from './confirm'

/**
 * Adding a discovered account to the registry is the one irreversible step on this surface
 * (rule 2: a registry record is archived, never deleted; the audit row is permanent), so it is
 * asked for once, in words, before anything is written. Both inventories use this dialog — the
 * connection cards used to import on a single click.
 */
export function ImportConfirmDialog({
  row,
  onClose,
  onConfirm,
  fallbackFocus,
}: {
  row: { external_id: string; name: string } | null
  onClose: () => void
  onConfirm: (externalId: string, name: string) => Promise<unknown> | void
  fallbackFocus?: () => void
}) {
  const { t } = useI18n()
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('import.title')}
      object={row ? t('import.object', { name: row.name, id: row.external_id }) : undefined}
      effects={[t('import.effect'), t('import.irreversible'), t('import.audit')]}
      irreversible
      confirmLabel={t('import.confirm')}
      onConfirm={async () => {
        if (row) await onConfirm(row.external_id, row.name)
      }}
      fallbackFocus={fallbackFocus}
    />
  )
}
