import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { PageHeader } from '../components/page/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { api, query } from '../lib/api'
import { EmailEntry, REGISTRY, RegistryPage, registryAdmin, registryRole } from '../lib/emailRegistry'
import { Button } from '../components/primitives/button'
import { ReminderPolicy } from '../components/email-registry/ReminderPolicy'
import { Detail } from '../components/email-registry/Detail'
import { EntryForm, useEligibleMembers } from '../components/email-registry/EntryForm'
import { Failure, Field, Pager } from '../components/email-registry/Shared'
/** Keying the entire scope prevents detail/intake/reveal state surviving auth or route changes. */
export default function Emails() {
 const {user} = useAuth(); const {t} = useI18n(); const location = useLocation()
 if (!user || !registryRole(user.role)) return <p role="alert">{t('er.denied')}</p>
 const scope = `${user.workspace.id}:${user.id}:${user.role}`
 return <Registry key={`${scope}:${location.key}`} scope={scope} admin={registryAdmin(user.role)} />
}
function Registry({scope,admin}: {scope: string; admin: boolean}) {
 const {t} = useI18n(); const [params,setParams] = useSearchParams(); const client = useQueryClient(); const [create,setCreate] = useState(false)
 const selected = params.get('entry'); const page = Math.max(1,Number(params.get('page')) || 1)
 const provider = params.get('provider') || ''; const kind = params.get('account_kind') || ''; const state = params.get('state') || ''; const archived = params.get('archived') || 'exclude'; const overdue = params.get('overdue') || ''; const member = admin ? params.get('responsible_member_id') || '' : ''
 const attention = params.get('attention') === 'true' ? 'true' : ''
 const members = useEligibleMembers(admin)
 const list = useQuery({queryKey:['email-registry',scope,'list',page,provider,kind,state,archived,overdue,member,attention],queryFn:()=>api.get<RegistryPage<EmailEntry>>(REGISTRY+query({page,page_size:25,provider,account_kind:kind,state,archived,overdue,attention,responsible_member_id:member})),retry:false})
 function change(key: string,value: string) {setParams(prev=>{const next=new URLSearchParams(prev); if(value)next.set(key,value);else next.delete(key); if(key!=='page')next.delete('page'); next.delete('entry');return next})}
 return <div className="space-y-4"><PageHeader title={t('er.title')} meta={<Mail aria-hidden="true" className="h-4 w-4" />} actions={admin && <Button onClick={()=>setCreate(true)}>{t('er.create')}</Button>} /><p className="rounded border border-line bg-surface-sunken p-3 text-sm">{t('er.notice')}</p>
 <ReminderPolicy scope={scope} />
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
 ['provider','er.provider',provider,['gmail','microsoft']],['account_kind','er.kind',kind,['unknown','personal','managed']],['state','er.state',state,['unknown','pending','recorded','blocked']],
 ] as const).map(([key,label,value,options])=><Field key={key} label={label}><select className="input" value={value} onChange={e=>change(key,e.target.value)}><option value="">{t('er.all')}</option>{options.map(v=><option key={v} value={v}>{t(`er.${v}`)}</option>)}</select></Field>)}
 <Field label="er.archived"><select className="input" value={archived} onChange={e=>change('archived',e.target.value)}><option value="exclude">{t('er.active')}</option><option value="only">{t('er.archived')}</option><option value="all">{t('er.all')}</option></select></Field><Field label="er.overdue"><select className="input" value={overdue} onChange={e=>change('overdue',e.target.value)}><option value="">{t('er.all')}</option><option value="true">{t('er.overdue')}</option></select></Field>
 <Field label="er.attention"><select className="input" value={attention} onChange={e=>change('attention',e.target.value)}><option value="">{t('er.all')}</option><option value="true">{t('er.attention')}</option></select></Field>
 {admin && <Field label="er.assignee"><select className="input" value={member} disabled={!members.isSuccess} onChange={e=>change('responsible_member_id',e.target.value)}><option value="">{t('er.all')}</option>{members.data?.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>}</div>
 {admin && members.isError && <><p role="alert">{t('er.teamUnavailable')}</p><Button onClick={()=>void members.refetch()}>{t('er.retry')}</Button></>}
 {list.isPending ? <p role="status">{t('er.loading')}</p> : list.isError ? <Failure error={list.error} retry={()=>void list.refetch()} /> : <>{!list.data.items.length ? <p>{t('er.empty')}</p> : <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.data.items.map(entry=><li key={entry.id} className="min-w-0 rounded-lg border border-line bg-surface p-4"><Button variant="ghost" className="max-w-full whitespace-normal break-all" onClick={()=>setParams(prev=>{const p=new URLSearchParams(prev);p.set('entry',entry.id);return p})}>{entry.address_hint}</Button><p>{t(`er.${entry.provider}`)} · {t(`er.${entry.account_kind}`)}</p><p>{t(`er.${entry.state}`)}</p><p className="break-all">{t('er.assignee')}: {entry.responsible_member_id ?? t('er.unassigned')}</p>{entry.review_due_at && <p>{entry.review_due_at}</p>}{entry.overdue && <p>{t('er.overdue')}</p>}{entry.archived_at && <p>{t('er.archived')}</p>}</li>)}</ul>}<Pager page={page} total={list.data.total_pages} change={p=>change('page',String(p))} /></>}
 {selected && <><Button variant="secondary" onClick={()=>change('entry','')}>{t('er.back')}</Button><Detail key={selected} id={selected} scope={scope} admin={admin} onChanged={()=>void client.invalidateQueries({queryKey:['email-registry',scope,'list']})} /></>}
 {create && admin && <EntryForm admin onClose={()=>setCreate(false)} onSaved={()=>{setCreate(false);void client.invalidateQueries({queryKey:['email-registry',scope]})}} />}
 </div>
}
