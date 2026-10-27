import type { MetaConnection } from '../../lib/types'
import { getActiveLanguage, translate, useI18n } from '../../i18n'
import type { Language } from '../../i18n'
import { Badge } from '../primitives/badge'

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
  // `business_specific` is neutral, not positive: a reader that is configured says nothing about
  // whether the accounts behind it are fine (rule 5's spirit). The only strong tone a reader
  // state may carry is the one that says nothing is being read.
  if (source === 'business_specific') return <Badge tone="neutral">{t('readerSource.businessSpecific')}</Badge>
  if (source === 'server_default') return <Badge tone="neutral">{t('readerSource.serverDefault')}</Badge>
  return <Badge tone="attention">{t('readerSource.none')}</Badge>
}

export function readerSourceNote(
  source: MetaConnection['reader_source'],
  language: Language = getActiveLanguage(),
): string | null {
  if (source === 'vault') return translate(language, 'readerSource.vaultNote')
  if (source === 'vault_reconnect_required') return translate(language, 'readerSource.vaultReconnectNote')
  if (source === 'business_specific') return translate(language, 'readerSource.note.business_specific')
  if (source === 'server_default') return translate(language, 'readerSource.note.server_default')
  if (source === 'none') return translate(language, 'readerSource.note.none')
  return null
}
