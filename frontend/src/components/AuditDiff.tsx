import { humanise } from '../lib/format'

/**
 * Renders a before/after diff from an audit record.
 *
 * The backend redacts payloads before persisting them, so a masked value can still reach this
 * component; it is rendered as the literal marker rather than being hidden, because an operator
 * reading the trail should see that a field existed and was deliberately not stored.
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
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  if (keys.length === 0 && !metadata) return null

  return (
    <div className="mt-1.5 space-y-1.5">
      {keys.length > 0 && (
        <div className="table-scroll">
          <table className="min-w-[420px] border-collapse text-[11.5px]">
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td className="py-0.5 pr-3 align-top text-ink-faint">{humanise(key)}</td>
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
        <p className="font-mono text-[11px] text-ink-faint">{JSON.stringify(metadata)}</p>
      )}
    </div>
  )
}

function Value({ value, tone }: { value: unknown; tone: 'removed' | 'added' }) {
  if (value === undefined) return <span className="text-ink-faint">—</span>
  const text = value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const redacted = text === '[REDACTED]'
  return (
    <span
      className={`inline-block max-w-[280px] break-words rounded px-1 font-mono ${
        redacted
          ? 'bg-slate-200 text-slate-700'
          : tone === 'removed'
            ? 'bg-rose-50 text-rose-800 line-through decoration-rose-300'
            : 'bg-emerald-50 text-emerald-800'
      }`}
    >
      {text}
    </span>
  )
}
