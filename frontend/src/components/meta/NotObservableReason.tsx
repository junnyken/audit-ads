import { useI18n } from '../../i18n'
import { notObservableText } from '../../lib/metaReaders'
import { Note } from '../../pages/account/parts'

/**
 * O4. Why the product cannot read this account, in one sentence — not the raw code, and never
 * dressed as "fine". `reader_reconnect_required` gets the strongest tone: something used to read
 * this account and now nothing does.
 */
export function NotObservableReason({ reason }: { reason: string | null | undefined }) {
  const { t } = useI18n()
  const text = notObservableText(t, reason)
  if (!text) return null
  return (
    <Note role="note" tone={reason === 'reader_reconnect_required' ? 'attention' : 'caution'}>
      {text}
    </Note>
  )
}
