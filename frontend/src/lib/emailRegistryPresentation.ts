import { INTL_LOCALE, getActiveLanguage } from '../i18n/translate'
import type { Language, TranslationKey } from '../i18n/types'

export function registryTimezone(zone?: string | null): string {
 try { if (zone) return new Intl.DateTimeFormat('en', {timeZone: zone}).resolvedOptions().timeZone } catch { /* Fall back to the viewer's zone. */ }
 return new Intl.DateTimeFormat().resolvedOptions().timeZone
}
export function registryDate(value?: string | null, zone?: string | null, language: Language = getActiveLanguage()): string {
 if (!value || !Number.isFinite(Date.parse(value))) return '—'
 const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value)
 if (!calendar || new Date(`${calendar[1]}-${calendar[2]}-${calendar[3]}T00:00:00Z`).toISOString().slice(0,10) !== calendar[0].slice(0,10)) return '—'
 return new Intl.DateTimeFormat(INTL_LOCALE[language], {timeZone: registryTimezone(zone), year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', timeZoneName:'short'}).format(new Date(value))
}
export function registryAssignee(id: unknown, members: {id: string; full_name: string}[] | undefined, t: (key: TranslationKey) => string): string {
 if (!id) return t('er.unassigned')
 return members?.find(member => member.id === id)?.full_name?.trim() || t('er.assigned')
}
const actions: Record<string, TranslationKey> = {
 'email_registry.created':'er.actionCreated', 'email_registry.updated':'er.actionUpdated',
 'email_registry.reassigned':'er.actionReassigned', 'email_registry.archived':'er.actionArchived',
 'email_registry.address_revealed':'er.actionRevealed', 'email_registry.list_read':'er.actionListRead',
 'email_registry.detail_read':'er.actionDetailRead', 'email_registry.history_read':'er.actionHistoryRead',
}
export function registryAction(action: string): TranslationKey { return Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : 'er.actionOther' }
export function registryActor(actor: string | null, user: {id: string; full_name?: string} | null, t: (key: TranslationKey) => string): string {
 if (!actor) return t('er.actorUnknown')
 if (actor === user?.id) return user.full_name?.trim() || t('er.you')
 return t('er.workspaceMember')
}
export function registryValue(key: string, value: unknown, zone: string | null, members: {id: string; full_name: string}[] | undefined, t: (key: TranslationKey) => string): string {
 if (key === 'responsible_member_id') return registryAssignee(value, members, t)
 if (['review_due_at','evidence_observed_at'].includes(key)) return registryDate(typeof value === 'string' ? value : null, zone)
 if (key === 'review_timezone') return value == null || value === '' ? '—' : registryTimezone(typeof value === 'string' ? value : null)
 if (value == null || value === '') return '—'
 if (['provider','account_kind','state'].includes(key)) {
  const options = ['gmail','microsoft','unknown','personal','managed','pending','recorded','blocked']
  return options.includes(String(value)) ? t(`er.${value}` as TranslationKey) : '—'
 }
 return String(value)
}
