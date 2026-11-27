import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { api, ApiError } from '../../lib/api'
import { REGISTRY } from '../../lib/emailRegistry'
import { Button } from '../primitives/button'
import { Field, Modal } from './Shared'
/** Intentionally no mutation/query: neither plaintext nor PIN enters Tanstack caches. */
export function Reveal({ id, onClose }: { id: string; onClose: () => void }) {
 const { t } = useI18n(); const [pin, setPin] = useState(''); const [address, setAddress] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const live = useRef(true)
 useEffect(() => { live.current = true; return () => { live.current = false } }, [])
 useEffect(() => { if (!address) return; const timer = setTimeout(onClose, 30000); return () => clearTimeout(timer) }, [address, onClose])
 return <Modal title="er.reveal" description="er.pinHelp" onClose={onClose}>{address ? <p className="break-all font-mono">{address}</p> : <form onSubmit={async e => {
  e.preventDefault(); if (busy || !/^\d{6}$/.test(pin)) return; setBusy(true); setError('')
  try { const result = await api.post<{address: string}>(`${REGISTRY}/${id}/reveal-address`, { pin }); if (live.current) { setPin(''); setAddress(result.address) } }
  catch (err) { if (live.current) { setPin(''); setError(err instanceof ApiError && err.status === 423 ? 'locked' : 'error') } }
  finally { if (live.current) setBusy(false) }
 }} className="space-y-3"><Field label="er.pin"><input className="input" type="password" autoComplete="off" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))} /></Field>{error && <p role="alert">{t(error === 'locked' ? 'er.locked' : 'er.pinError')}</p>}<Button type="submit" disabled={busy || pin.length !== 6}>{t('er.reveal')}</Button></form>}</Modal>
}
