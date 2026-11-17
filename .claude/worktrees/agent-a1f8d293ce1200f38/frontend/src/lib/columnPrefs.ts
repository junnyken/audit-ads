/**
 * Which optional table columns a viewer chose (U1b column chooser). Stored per viewer in
 * `localStorage`; every access is wrapped because storage can be blocked (private mode, policy)
 * or hold garbage from an older build. On any failure the default columns are the answer and the
 * choice simply applies for this session — it never throws into the page.
 */
const PREFIX = 'adsops.columns.'

export function columnsStorageKey(table: string, viewerId: string | null | undefined): string {
  return `${PREFIX}${table}.${viewerId || 'anonymous'}`
}

export function loadColumns<T extends string>(key: string, allowed: readonly T[], fallback: readonly T[]): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return [...fallback]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...fallback]
    // Keep only ids this build still knows, in the table's own order.
    return allowed.filter((id) => parsed.includes(id))
  } catch {
    return [...fallback]
  }
}

export function saveColumns(key: string, columns: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(columns))
  } catch {
    /* the choice still applies for this session */
  }
}
