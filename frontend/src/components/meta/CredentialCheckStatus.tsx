import type { OperationsOverview } from '../../lib/types'
import { STATE_META } from '../../lib/operations'
import { formatRelative } from '../../lib/format'
import { useI18n } from '../../i18n'
import { Badge, Card, InlineNote } from '../ui'

/**
 * O4. System Status line for the scheduled check of vault reader credentials. "Never" is its own
 * answer (rule 28): the check is off by default, and a check that never ran is not a check that
 * passed. Any credential that needs reconnecting is the strongest tone on the line.
 */
export function CredentialCheckStatus({ data }: { data: OperationsOverview }) {
  const { t } = useI18n()
  if (data.credential_check_state === undefined) return null
  const state = STATE_META[data.credential_check_state]
  const counts = data.reader_credentials ?? {}
  const reconnect = counts.reconnect_required ?? 0
  const lastRun = data.credential_check_last_run
  return (
    <Card title={t('systemStatus.credentialCheck')}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Badge tone={state.tone}>{state.label}</Badge>
        {lastRun && <span className="text-ink-muted">{formatRelative(lastRun.started_at)}</span>}
        <Badge tone={reconnect > 0 ? 'attention' : 'neutral'}>
          {t('systemStatus.credentialCounts', {
            active: counts.active ?? 0,
            expiring: counts.expiring ?? 0,
            reconnect,
            pending: counts.pending_verification ?? 0,
          })}
        </Badge>
      </div>
      {data.meta_login_configured === false && (
        <div className="mt-2">
          <InlineNote>{t('metaReader.notConfigured')}</InlineNote>
        </div>
      )}
      {data.meta_login_configured && data.credential_vault_configured === false && (
        <div className="mt-2">
          <InlineNote tone="attention">{t('metaReader.vaultUnavailable')}</InlineNote>
        </div>
      )}
    </Card>
  )
}
