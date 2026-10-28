import { Link } from 'react-router-dom'
import type { FacebookIdentity } from '../../lib/types'
import { useI18n } from '../../i18n'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { twoFactorTone } from '../../lib/readiness'
import { Panel } from '../../pages/account/parts'

export function LoginToFixPanel({ identities }: { identities: FacebookIdentity[] | undefined }) {
  const { t } = useI18n()
  return <Panel title={t('fb.login.title')} className="xl:col-span-2">
    {!identities?.length ? <p className="text-sm text-ink-muted">{t('fb.login.empty')}</p> : <ul className="grid gap-2 sm:grid-cols-2">
      {identities.map((identity) => <li key={identity.id} className="rounded-md border border-line bg-surface-sunken p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><Link to={`/facebook-accounts/${identity.id}`} className="font-medium text-brand-text hover:underline">{identity.label}</Link><Badge tone={twoFactorTone(identity.two_factor_method)}>{t(`twoFactor.${identity.two_factor_method}`)}</Badge></div>
        {identity.owner_member_name && <p className="mt-1 text-xs text-ink-muted">{t('fb.login.holder', { name: identity.owner_member_name })}</p>}
        <p className="mt-1 text-xs text-ink-muted">{t(`fb.login.via.${identity.via}`)}</p>
        <Button asChild variant="ghost" size="sm" className="mt-2"><Link to={`/facebook-accounts/${identity.id}`}>{t('fb.open', { name: identity.label })}</Link></Button>
      </li>)}</ul>}
  </Panel>
}
