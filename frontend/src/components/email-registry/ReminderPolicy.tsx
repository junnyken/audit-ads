import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { api } from '../../lib/api'
import { REGISTRY, registryAdmin } from '../../lib/emailRegistry'
import { Button } from '../primitives/button'

type Policy = { email_registry_in_app_reminders_enabled: boolean }
const endpoint = `${REGISTRY}/reminder-policy`
function checked(value: Policy): boolean {
 if (typeof value.email_registry_in_app_reminders_enabled !== 'boolean') throw new Error('Invalid policy')
 return value.email_registry_in_app_reminders_enabled
}
export function ReminderPolicy({scope}: {scope: string}) {
 const {user} = useAuth()
 if (!user || !registryAdmin(user.role)) return null
 return <PolicyControl key={scope} scope={scope} />
}
function PolicyControl({scope}: {scope: string}) {
 const {t} = useI18n(); const client = useQueryClient()
 const [pending,setPending] = useState(false); const [failed,setFailed] = useState(false)
 const policy = useQuery({queryKey:['email-registry',scope,'reminder-policy'],queryFn:async()=>checked(await api.get<Policy>(endpoint)),retry:false})
 async function toggle() {
  if (policy.data === undefined || pending) return
  setPending(true); setFailed(false)
  try {
   await api.patch<Policy>(endpoint,{email_registry_in_app_reminders_enabled:!policy.data})
   const readback = await policy.refetch()
   if (readback.isError) throw new Error('Readback failed')
  } catch { setFailed(true) }
  finally { await client.invalidateQueries({queryKey:['email-registry',scope,'list']}); setPending(false) }
 }
 return <section className="rounded border border-line p-3" aria-label={t('er.reminderPolicy')}><p>{t('er.reminderHelp')}</p>
 {policy.isPending ? <p role="status">{t('er.loading')}</p> : (failed || policy.isError) ? <><p role="alert">{t('er.error')}</p><Button disabled={pending} onClick={()=>{setFailed(false);void policy.refetch()}}>{t('er.retry')}</Button></> : <label><input type="checkbox" checked={policy.data === true} disabled={pending || policy.isFetching} onChange={()=>void toggle()} /> {t('er.reminderPolicy')}</label>}
 </section>
}
