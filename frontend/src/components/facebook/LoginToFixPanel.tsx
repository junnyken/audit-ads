import { Link } from 'react-router-dom'
import type { FacebookIdentity } from '../../lib/types'
import { useI18n } from '../../i18n'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { twoFactorTone } from '../../lib/readiness'
import { Panel } from '../../pages/account/parts'

function isHttpsLink(value: string | null | undefined): value is string {
  return Boolean(value && /^https:\/\//i.test(value.trim()))
}

export function LoginToFixPanel({ identities }: { identities: FacebookIdentity[] | undefined }) {
  const { t } = useI18n()
  return (
    <Panel title={t('fb.login.title')} className="xl:col-span-2">
      {!identities?.length ? (
        <p className="text-sm text-ink-muted">{t('fb.login.empty')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {identities.map((identity) => {
            const ownership = identity.ownership_type ?? 'agency_owned'
            const hasEnv = Boolean(
              identity.device_label || identity.browser_profile_label || identity.network_label,
            )
            return (
              <li key={identity.id} className="rounded-md border border-line bg-surface-sunken p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <Link
                      to={`/facebook-accounts/${identity.id}`}
                      className="font-medium text-brand-text hover:underline"
                    >
                      {identity.label}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={ownership === 'client_provided' ? 'info' : 'neutral'}>
                        {t(`fb.ownership.${ownership}` as never)}
                      </Badge>
                      {identity.client_name && (
                        <span className="text-ink-muted">{identity.client_name}</span>
                      )}
                    </div>
                  </div>
                  <Badge tone={twoFactorTone(identity.two_factor_method)}>
                    {t(`twoFactor.${identity.two_factor_method}`)}
                  </Badge>
                </div>
                {identity.owner_member_name && (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {t('fb.login.holder', { name: identity.owner_member_name })}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-muted">{t(`fb.login.via.${identity.via}`)}</p>
                {hasEnv && (
                  <div
                    className="mt-2 rounded border border-line bg-surface p-2 text-xs space-y-0.5"
                    data-testid="login-to-fix-env"
                  >
                    {identity.device_label && (
                      <p>
                        <span className="text-ink-muted">{t('fb.deviceLabel')}:</span>{' '}
                        <span className="font-medium text-ink">{identity.device_label}</span>
                      </p>
                    )}
                    {identity.browser_profile_label && (
                      <p>
                        <span className="text-ink-muted">{t('fb.browserLabel')}:</span>{' '}
                        <span className="font-medium text-ink">{identity.browser_profile_label}</span>
                      </p>
                    )}
                    {identity.network_label && (
                      <p>
                        <span className="text-ink-muted">IP/Mạng:</span>{' '}
                        <span className="font-mono text-ink">{identity.network_label}</span>
                      </p>
                    )}
                  </div>
                )}
                {identity.vault_reference &&
                  (isHttpsLink(identity.vault_reference) ? (
                    <a
                      href={identity.vault_reference}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1.5 inline-block text-xs text-brand-text hover:underline"
                    >
                      {t('fb.detail.vault')}
                    </a>
                  ) : (
                    <p className="mt-1.5 text-xs text-ink-muted">
                      {t('fb.login.vault', { vault: identity.vault_reference })}
                    </p>
                  ))}
                <Button asChild variant="ghost" size="sm" className="mt-2">
                  <Link to={`/facebook-accounts/${identity.id}`}>
                    {t('fb.open', { name: identity.label })}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
