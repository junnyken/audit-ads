import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { api } from '../../lib/api'
import { EmailEntry, EmailHistory, REGISTRY, RegistryPage } from '../../lib/emailRegistry'
import { Button } from '../primitives/button'
import { EntryForm, useEligibleMembers } from './EntryForm'
import { Failure, Field, Modal, Pager } from './Shared'
import { Reveal } from './Reveal'
function AdminAction({ entry, mode, onClose, onSaved }: { entry: EmailEntry; mode: 'reassign'|'archive'; onClose: () => void; onSaved: () => void }) {
 const {t} = useI18n(); const members = useEligibleMembers(mode==='reassign'); const [target,setTarget] = useState(entry.responsible_member_id ?? ''); const [busy,setBusy] = useState(false); const [error,setError] = useState<unknown>()
 const {user} = useAuth(); const client = useQueryClient(); const live = useRef(true); const submitting = useRef(false)
 const scope = `${user?.workspace.id}:${user?.id}:${user?.role}`
 useEffect(() => { live.current = true; return () => { live.current = false } }, [])
 return <Modal title={mode==='archive' ? 'er.archive' : 'er.reassign'} description={mode==='archive' ? 'er.archiveHelp' : 'er.teamUnavailable'} onClose={onClose}>
 {mode==='reassign' && <><Field label="er.assignee"><select className="input" value={target} onChange={e=>setTarget(e.target.value)} disabled={!members.isSuccess}><option value="">{t('er.unassigned')}</option>{members.data?.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>{members.isError && <Failure error={members.error} retry={()=>void members.refetch()} />}</>}
 {error != null && <Failure error={error} />}<Button variant={mode==='archive' ? 'destructive' : 'default'} disabled={busy || mode==='reassign' && !members.isSuccess} onClick={async()=>{if(submitting.current)return;submitting.current=true;setBusy(true);try {await api.post(`${REGISTRY}/${entry.id}/${mode}`,mode==='archive' ? {} : {responsible_member_id:target || null},{'If-Match':`"${entry.version}"`});void client.invalidateQueries({queryKey:['email-registry',scope]});if(live.current)onSaved()} catch(err){if(live.current)setError(err)}finally{submitting.current=false;if(live.current)setBusy(false)}}}>{t(mode==='archive' ? 'er.archive' : 'er.save')}</Button>
 </Modal>
}
export function Detail({ id, scope, admin, onChanged }: { id: string; scope: string; admin: boolean; onChanged: () => void }) {
 const {t} = useI18n(); const client = useQueryClient(); const [mode,setMode] = useState<'edit'|'reassign'|'archive'|'reveal'|null>(null); const [page,setPage] = useState(1); const [saved,setSaved] = useState(false)
 const detail = useQuery({ queryKey:['email-registry',scope,'detail',id],queryFn:()=>api.get<EmailEntry>(`${REGISTRY}/${id}`),retry:false })
 const history = useQuery({ queryKey:['email-registry',scope,'history',id,page], queryFn:()=>api.get<RegistryPage<EmailHistory>>(`${REGISTRY}/${id}/history?page=${page}&page_size=25`),retry:false, enabled:detail.isSuccess })
 async function reload() { setMode(null); await client.invalidateQueries({queryKey:['email-registry',scope]}); onChanged() }
 if(detail.isPending) return <p role="status">{t('er.loading')}</p>
 if(detail.isError) return <Failure error={detail.error} retry={()=>{setMode(null);void detail.refetch()}} />
 const entry = detail.data
 return <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
 <h2 className="break-all text-lg font-semibold">{entry.address_hint}</h2>{saved && <p role="status">{t('er.saved')}</p>}
 <dl className="grid gap-3 sm:grid-cols-2">{([
 ['er.provider',entry.provider],['er.kind',t(`er.${entry.account_kind}`)],['er.state',t(`er.${entry.state}`)],['er.assignee',entry.responsible_member_id ?? t('er.unassigned')],['er.due',entry.review_due_at],['er.zone',entry.review_timezone],['er.observed',entry.evidence_observed_at],['er.reason',entry.reason],['er.next',entry.next_action],
 ] as const).map(([label,value])=><div key={label} className="min-w-0"><dt className="text-sm text-ink-muted">{t(label)}</dt><dd className="break-words">{value ?? '—'}</dd></div>)}</dl>
 {entry.archived_at ? <p>{t('er.archived')}</p> : <div className="flex flex-wrap gap-2"><Button onClick={()=>{setSaved(false);setMode('edit')}}>{t('er.edit')}</Button>{admin && <><Button variant="secondary" onClick={()=>setMode('reassign')}>{t('er.reassign')}</Button><Button variant="destructive" onClick={()=>setMode('archive')}>{t('er.archive')}</Button></>}{entry.can_reveal_address && <Button variant="secondary" onClick={()=>setMode('reveal')}>{t('er.reveal')}</Button>}</div>}
 <Button variant="secondary" onClick={()=>void reload()}>{t('er.retry')}</Button>
 <h3 className="font-semibold">{t('er.history')}</h3>{history.isPending ? <p role="status">{t('er.loading')}</p> : history.isError ? <Failure error={history.error} retry={()=>void history.refetch()} /> : <>{!history.data.items.length && <p>{t('er.historyEmpty')}</p>}<ol className="space-y-2">{history.data.items.map(event=><li key={event.id} className="break-words border-b border-line py-2"><span>{/^email_registry\.(created|updated|reassigned|archived|address_revealed|list_read|detail_read|history_read)$/.test(event.action) ? event.action : '—'}</span><time className="ml-2">{event.created_at}</time><span className="ml-2">{event.actor_id}</span></li>)}</ol><Pager page={page} total={history.data.total_pages} change={setPage} /></>}
 {mode==='edit' && !entry.archived_at && <EntryForm entry={entry} admin={admin} onClose={()=>setMode(null)} onSaved={()=>{setSaved(true);void reload()}} />}
 {(mode==='reassign'||mode==='archive') && admin && !entry.archived_at && <AdminAction entry={entry} mode={mode} onClose={()=>setMode(null)} onSaved={()=>{setSaved(true);void reload()}} />}
 {mode==='reveal' && entry.can_reveal_address && !entry.archived_at && <Reveal id={id} onClose={()=>setMode(null)} />}
 </section>
}
