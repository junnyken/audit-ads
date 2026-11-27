import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { EmailEntry, REGISTRY, observation, safeMetadata, dueForWrite } from '../../lib/emailRegistry'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { Failure, Field, Modal } from './Shared'
export function useEligibleMembers(enabled: boolean) {
 const { user } = useAuth()
 return useQuery({ queryKey: ['email-registry-members', user?.workspace.id, user?.id, user?.role], queryFn: () => api.get<{id: string; full_name: string}[]>(`${REGISTRY}/eligible-members`), enabled, retry: false })
}
export function EntryForm({ entry, admin, onClose, onSaved }: { entry?: EmailEntry; admin: boolean; onClose: () => void; onSaved: () => void }) {
 const { t } = useI18n(); const members = useEligibleMembers(admin && !entry)
 const { user } = useAuth(); const client = useQueryClient()
 const scope = `${user?.workspace.id}:${user?.id}:${user?.role}`
 const live = useRef(true); const submitting = useRef(false)
 useEffect(() => { live.current = true; return () => { live.current = false } }, [])
 const [address,setAddress] = useState(''); const [provider,setProvider] = useState(entry?.provider ?? 'gmail'); const [kind,setKind] = useState(entry?.account_kind ?? 'personal'); const [assignee,setAssignee] = useState('')
 const [state,setState] = useState(entry?.state ?? 'unknown'); const [observed,setObserved] = useState(''); const [due,setDue] = useState(entry?.review_due_at ?? ''); const [zone,setZone] = useState(entry?.review_timezone ?? ''); const [reason,setReason] = useState(entry?.reason ?? ''); const [next,setNext] = useState(entry?.next_action ?? '')
 const [review,setReview] = useState<Record<string,unknown> | null>(null); const [invalid,setInvalid] = useState(false); const [error,setError] = useState<unknown>(); const [busy,setBusy] = useState(false)
 function preview() {
  try {
   if (!safeMetadata(reason) || !safeMetadata(next) || reason.trim().length > 500 || next.trim().length > 240 || (!!due !== !!zone)) throw new Error()
   const pair = { review_due_at: due ? (entry && due === entry.review_due_at && zone === entry.review_timezone ? due : dueForWrite(due,zone)) : null, review_timezone: zone || null }
   const nextValue = next.trim() || null; const reasonValue = reason.trim() || null
   if (!entry) {
    const trimmed = address.trim()
    if (trimmed.length > 320 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(trimmed) || !admin) throw new Error()
    // Review deliberately omits the contact. It remains only in this mounted form state.
    setReview({ provider, account_kind: kind, responsible_member_id: assignee || null, ...pair, next_action: nextValue })
   } else {
    const payload: Record<string, unknown> = {}
    if (kind !== entry.account_kind) { if (!reasonValue) throw new Error(); payload.account_kind = kind }
    if (state !== entry.state) payload.state = state
    if (state === 'unknown' && state !== entry.state && (!reasonValue || observed)) throw new Error()
    if (observed) { if (state === 'unknown' || !entry.responsible_member_id) throw new Error(); payload.evidence_observed_at = observation(observed) }
    if ((state !== entry.state && state !== 'unknown' || kind === 'managed' && kind !== entry.account_kind) && !observed) throw new Error()
    if (state === 'blocked' && (!reasonValue || !nextValue)) throw new Error()
    if (pair.review_due_at !== entry.review_due_at && !(pair.review_due_at && entry.review_due_at && Date.parse(pair.review_due_at) === Date.parse(entry.review_due_at)) || pair.review_timezone !== entry.review_timezone) Object.assign(payload,pair)
    if (nextValue !== entry.next_action) payload.next_action = nextValue
    if (reasonValue !== entry.reason) payload.reason = reasonValue
    if (!Object.keys(payload).length) throw new Error()
    setReview(payload)
   }
   setInvalid(false); setError(undefined)
  } catch { setInvalid(true) }
 }
 const labels = { provider:'er.provider', account_kind:'er.kind', responsible_member_id:'er.assignee', state:'er.state', evidence_observed_at:'er.observed', review_due_at:'er.due', review_timezone:'er.zone', next_action:'er.next', reason:'er.reason' } as const
 return <Modal title={entry ? 'er.edit' : 'er.create'} onClose={onClose}><form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (!review) { preview(); return } if (submitting.current) return; submitting.current = true; setBusy(true); setError(undefined)
  try {
   if (entry) await api.patch(`${REGISTRY}/${entry.id}`,review,{'If-Match': `"${entry.version}"`}); else await api.post(REGISTRY,{...review,contact_address:address.trim()})
   // A sent write can finish after cancellation. Refresh its original scope, but
   // never let the old form close or modify a newer form instance.
   void client.invalidateQueries({queryKey:['email-registry',scope]})
   if (live.current) { setAddress(''); onSaved() }
  }
  catch(err) { if (live.current) { setError(err); setReview(null) } }
  finally { submitting.current = false; if (live.current) setBusy(false) }
 }}>
 {invalid && <p role="alert">{t('er.invalid')}</p>}{error != null && <Failure error={error} />}
 {review ? <><h3>{t('er.review')}</h3><dl className="space-y-2">{Object.entries(review).map(([key,value]) => <div key={key}><dt className="font-semibold">{t(labels[key as keyof typeof labels])}</dt>{entry && <dd>{t('er.before')}: {String(entry[key as keyof EmailEntry] ?? '—')}</dd>}<dd>{t('er.after')}: {String(value ?? '—')}</dd></div>)}</dl><Button variant="secondary" onClick={() => setReview(null)} disabled={busy}>{t('er.back')}</Button></> : <>
 {!entry && <><Field label="er.address"><input className="input" autoComplete="off" type="text" maxLength={320} value={address} onChange={e=>setAddress(e.target.value)} required /></Field><p className="text-xs text-ink-muted">{t('er.intakeHelp')}</p><Field label="er.provider"><select className="input" value={provider} onChange={e=>{setProvider(e.target.value as typeof provider);setKind(e.target.value === 'gmail' ? 'personal' : 'unknown')}}><option value="gmail">{t('er.gmail')}</option><option value="microsoft">{t('er.microsoft')}</option></select></Field></>}
 <Field label="er.kind"><select className="input" value={kind} disabled={provider==='gmail'} onChange={e=>setKind(e.target.value as typeof kind)}>{(provider==='gmail' ? ['personal'] : entry ? ['unknown','personal','managed'] : ['unknown','personal']).map(v=><option key={v} value={v}>{t(`er.${v}` as 'er.unknown')}</option>)}</select></Field>
 {!entry && <><Field label="er.assignee"><select className="input" value={assignee} disabled={!members.isSuccess} onChange={e=>setAssignee(e.target.value)}><option value="">{t('er.unassigned')}</option>{members.data?.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>{members.isError && <><p role="alert">{t('er.teamUnavailable')}</p><Button onClick={()=>void members.refetch()}>{t('er.retry')}</Button></>}</>}
 {entry && <><Field label="er.state"><select className="input" value={state} onChange={e=>setState(e.target.value as typeof state)}>{['unknown','pending','recorded','blocked'].map(v=><option key={v} value={v}>{t(`er.${v}` as 'er.unknown')}</option>)}</select></Field><Field label="er.observed"><input className="input" value={observed} onChange={e=>setObserved(e.target.value)} /></Field><p className="text-xs">{t('er.refreshEvidence')}</p><Field label="er.reason"><textarea className="input" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></Field></>}
 <Field label="er.due"><input className="input" value={due} onChange={e=>setDue(e.target.value)} /></Field><Field label="er.zone"><input className="input" value={zone} maxLength={64} onChange={e=>setZone(e.target.value)} /></Field><p className="text-xs text-ink-muted">{t('er.timeHelp')}</p><Field label="er.next"><textarea className="input" maxLength={240} value={next} onChange={e=>setNext(e.target.value)} /></Field>
 </>}
 <div className="flex gap-2"><Button type="submit" disabled={busy}>{t(review ? 'er.save' : 'er.review')}</Button><Button variant="secondary" onClick={onClose}>{t('er.cancel')}</Button></div></form></Modal>
}
