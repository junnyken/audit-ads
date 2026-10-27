import type { MetaConnection } from '../../lib/types'
import { getActiveLanguage, translate, useI18n } from '../../i18n'
import { Badge } from '../ui'

/** Which credential reads this connection's Business Manager.
 *
 * A single global "token configured: yes" used to answer a question nobody was asking. A token
 * that reads one business proves nothing about another — measured on real Meta, a token with no
 * role in a Business Manager still reads its node and every asset edge answers 200 with an empty
 * list. So the reader is named per Business Manager, and `server_default` is stated as what it is:
 * a fallback that may or may not have a role there.
 *
 * O4 adds the vault: `vault` names the Facebook Login credential by its label (never `positive` —
 * a credential that reads proves nothing about the accounts), and `vault_reconnect_required` is
 * the strongest tone, because nothing is being read and nothing else stands in.
 */
export function ReaderSourceBadge({
  source,
  readerLabel,
}: {
  source: MetaConnection['reader_source']
  readerLabel?: string | null
}) {
  const { t } = useI18n()
  if (source === 'fake') return null
  if (source === 'vault')
    return (
      <Badge tone="neutral">
        {readerLabel ? t('readerSource.vault', { label: readerLabel }) : t('readerSource.vaultNoLabel')}
      </Badge>
    )
  if (source === 'vault_reconnect_required')
    return <Badge tone="attention">{t('readerSource.vaultReconnect')}</Badge>
  if (source === 'business_specific')
    return <Badge tone="positive">Own reader for this Business Manager</Badge>
  if (source === 'server_default')
    return <Badge tone="neutral">Server default reader</Badge>
  return <Badge tone="attention">No reader configured</Badge>
}

export function readerSourceNote(source: MetaConnection['reader_source']): string | null {
  if (source === 'vault') return translate(getActiveLanguage(), 'readerSource.vaultNote')
  if (source === 'vault_reconnect_required')
    return translate(getActiveLanguage(), 'readerSource.vaultReconnectNote')
  if (source === 'business_specific')
    return 'This Business Manager has its own configured credential, so what comes back is what that credential can read here.'
  if (source === 'server_default')
    return 'This Business Manager has no credential of its own, so the single server credential is used. It may have no role in this business — in which case an empty result is not evidence the business is empty.'
  if (source === 'none')
    return 'No credential is configured that could read this Business Manager. Nothing is being read, and no result should be interpreted as absence.'
  return null
}
