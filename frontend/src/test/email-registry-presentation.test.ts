import { describe, expect, it } from 'vitest'
import { registryAction, registryActor, registryAssignee, registryDate, registryTimezone, registryValue } from '../lib/emailRegistryPresentation'
import { emailRegistryVi, emailRegistryEn } from '../i18n/emailRegistry'
const t = (key: string) => emailRegistryVi[key as keyof typeof emailRegistryVi]
describe('email registry presentation', () => {
 it('formats the instant in the explicit review zone in each language', () => {
  const value = '2026-11-27T02:00:00Z'
  for (const language of ['vi','en'] as const) expect(registryDate(value,'Asia/Ho_Chi_Minh',language)).toBe(new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)))
  expect(registryTimezone('invalid')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(registryDate(value,'invalid')).toBe(registryDate(value))
 })
 it.each([null,undefined,'','bad','2026-02-30T09:00:00Z'])('shows a dash for missing or invalid date %s', value => expect(registryDate(value)).toBe('—'))
 it('uses human history actions and a generic label for unknown actions', () => {
  for (const action of ['created','updated','reassigned','archived','address_revealed','list_read','detail_read','history_read']) {
   const key = registryAction(`email_registry.${action}`)
   expect(t(key)).toBeTruthy(); expect(t(key)).not.toContain('email_registry.'); expect(emailRegistryEn[key as keyof typeof emailRegistryEn]).not.toBe(t(key))
  }
  expect(t(registryAction('private.raw_event'))).toBe('Hoạt động khác')
 })
 it('uses membership IDs only for assignees and trusts only the current user for actor names', () => {
  const uuid = '11111111-1111-4111-8111-111111111111'
  const members = [{id:uuid,full_name:'Eligible member'}]
  expect(registryAssignee(uuid,members,t)).toBe('Eligible member')
  expect(registryAssignee(uuid,undefined,t)).toBe('Người phụ trách đã được gán')
  expect(registryActor(uuid,{id:'different-user',full_name:'Current user'},t)).toBe('Thành viên trong không gian làm việc')
  expect(registryActor(uuid,{id:uuid,full_name:'Current user'},t)).toBe('Current user')
  expect(registryActor(uuid,{id:uuid},t)).toBe('Bạn')
  expect(registryActor(null,null,t)).toBe('Không xác định người thao tác')
  expect(registryValue('provider','gmail',null,undefined,t)).toBe('Gmail')
  expect(registryValue('state','pending',null,undefined,t)).toBe('Chờ xử lý thủ công')
  expect(registryValue('account_kind','managed',null,undefined,t)).toBe('Được quản lý (tự khai)')
 })
})
