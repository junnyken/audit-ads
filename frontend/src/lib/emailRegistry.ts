import { ApiError } from './api'
export const REGISTRY = '/api/v1/email-registry'
export const registryRole = (role?: string) => ['owner', 'admin', 'buyer'].includes(role ?? '')
export const registryAdmin = (role?: string) => ['owner', 'admin'].includes(role ?? '')
export interface RegistryPage<T> { items: T[]; page: number; page_size: number; total: number; total_pages: number }
export interface EmailEntry {
 id: string; address_hint: string; provider: 'gmail' | 'microsoft'; account_kind: 'personal' | 'managed' | 'unknown';
 responsible_member_id: string | null; state: 'unknown' | 'pending' | 'recorded' | 'blocked'; review_due_at: string | null;
 overdue: boolean; updated_at: string; version: number; archived_at: string | null;
 review_timezone: string | null; next_action: string | null; reason: string | null; evidence_observed_at: string | null;
 evidence_recorded_at: string | null; evidence_recorded_by: string | null; evidence_source: string | null;
 created_at: string; created_by: string; updated_by: string; archived_by: string | null; can_reveal_address: boolean;
}
export interface EmailHistory { id: string; action: string; entity_id: string; actor_id: string; created_at: string; request_id: string }
export function errorKey(error: unknown) {
 if (error instanceof ApiError) {
  if (error.status === 422) return 'er.invalid'
  if (error.status === 503 || error.status === 404) return 'er.unavailable'
  if (error.status === 409 || error.status === 428) return 'er.stale'
  if (error.status === 403 || error.status === 401) return 'er.denied'
 }
 return 'er.error'
}
/** Explicit offset selects the DST occurrence. Match wall-clock components in the IANA zone;
 * this rejects spring gaps and mismatched offsets without guessing browser timezone. */
export function utcDue(value: string, zone: string): string {
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('invalid')
 const instant = new Date(value)
 if (!Number.isFinite(instant.getTime())) throw new Error('invalid')
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
 const get = (key: string) => parts.find(p => p.type === key)?.value
 if (`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}` !== value.slice(0, 19)) throw new Error('invalid')
 return instant.toISOString()
}
/** Keep the selected offset on the wire: D2 validates it against the zone before
 * storing UTC. A Z readback with a non-UTC zone must not be resubmitted as a changed due. */
export function dueForWrite(value: string, zone: string): string {
 utcDue(value, zone)
 return value
}
export function observation(value: string) {
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now()) throw new Error('invalid')
 // Validate calendar components using the supplied fixed offset as a wall clock.
 const suffix = value.match(/(Z|[+-]\d{2}:\d{2})$/)![0]
 const minutes = suffix === 'Z' ? 0 : (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(4))) * (suffix[0] === '-' ? -1 : 1)
 if (new Date(Date.parse(value) + minutes * 60000).toISOString().slice(0,19) !== value.slice(0,19)) throw new Error('invalid')
 return new Date(value).toISOString()
}
export function safeMetadata(value: string) {
 return !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && !/\S+@\S+|password|passwd|otp|token|secret|bearer|mật khẩu/i.test(value)
}
