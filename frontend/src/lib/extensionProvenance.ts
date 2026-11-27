import type { AdAccount } from './types'

export function exactExtensionAccounts(accounts: AdAccount[], selectedId: string): AdAccount[] {
  if (!selectedId) return []
  return accounts.filter(account =>
    account.personal_account_reference_id === selectedId ||
    account.facebook_identities?.some(identity => identity.id === selectedId),
  )
}

export function rawSnapshotValue(value: unknown, unknownLabel: string): string {
  return (typeof value === 'string' && value.trim()) ||
    (typeof value === 'number' && Number.isFinite(value) ? String(value) : unknownLabel)
}

// Keep legacy descriptive references visible, but never render proxy credentials or tokens.
export function safeStoredNetworkReference(value: unknown): 'withheld' | string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  if (/@|(?:password|passwd|token|secret|authorization|username|user|auth)\s*[:=]|\S+:\d+:[^\s:]+:[^\s:]+/i.test(text)) return 'withheld'
  // Only descriptive references may be displayed; opaque strings may be credentials.
  if (/^[A-Za-z0-9_+/=.-]{16,}$/.test(text)) return 'withheld'
  return text
}
