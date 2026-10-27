import { useI18n } from '../i18n'
import { cn } from '../lib/cn'

/**
 * Renders a before/after diff from an audit record.
 *
 * The backend redacts payloads before persisting them, so a masked value can still reach this
 * component; it is rendered as the literal marker rather than being hidden, because an operator
 * reading the trail should see that a field existed and was deliberately not stored.
 *
 * Field names and values are shown exactly as recorded (mono): they are the record, not a
 * translation of it. "Removed" uses the attention tone and "added" the info tone — a change is
 * not a verdict, so neither is painted as success.
 */
export default function AuditDiff({
  before,
  after,
  metadata,
}: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}) {
  const { t } = useI18n()
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  if (keys.length === 0 && !metadata) return null

  return (
    <div className="mt-1.5 space-y-1.5">
      {keys.length > 0 && (
        <div className="table-scroll">
          <table className="min-w-[420px] border-collapse text-xs">
            <caption className="sr-only">{t('diff.caption')}</caption>
            <thead>
              <tr className="text-2xs uppercase tracking-[0.04em] text-ink-faint">
                <th scope="col" className="py-0.5 pr-3 text-left font-semibold">
                  {t('diff.field')}
                </th>
                <th scope="col" className="py-0.5 pr-3 text-left font-semibold">
                  {t('diff.before')}
                </th>
                <th scope="col" className="py-0.5 text-left font-semibold">
                  {t('diff.after')}
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td className="py-0.5 pr-3 align-top font-mono text-ink-muted">{key}</td>
                  <td className="py-0.5 pr-3 align-top">
                    <Value value={before?.[key]} tone="removed" />
                  </td>
                  <td className="py-0.5 align-top">
                    <Value value={after?.[key]} tone="added" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metadata && Object.keys(metadata).length > 0 && (
        <p className="break-all font-mono text-2xs text-ink-muted">{JSON.stringify(metadata)}</p>
      )}
    </div>
  )
}

function Value({ value, tone }: { value: unknown; tone: 'removed' | 'added' }) {
  const { t } = useI18n()
  if (value === undefined) return <span className="text-ink-faint">—</span>
  const text = value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const redacted = text === '[REDACTED]'
  return (
    <span
      title={redacted ? t('diff.redacted') : undefined}
      className={cn(
        'inline-block max-w-[280px] break-words rounded border px-1 font-mono',
        redacted
          ? 'tone-muted'
          : tone === 'removed'
            ? 'tone-attention line-through'
            : 'tone-info',
      )}
    >
      {text}
    </span>
  )
}
