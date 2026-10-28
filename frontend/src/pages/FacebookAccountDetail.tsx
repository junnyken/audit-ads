import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FacebookIdentityProfile, IdentityBusinessRole, Paged, ReferenceRecord, TeamMember } from '../lib/types'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { PageHeader } from '../components/page/PageHeader'
import { ErrorState, LoadingRegion } from '../components/states'
import { Skeleton } from '../components/primitives/skeleton'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { DL_CLASS, Note, Panel, Row } from './account/parts'
import { FacebookAccountFormSheet } from '../components/facebook/FacebookAccountFormSheet'
import { RevealEmailDialog } from '../components/facebook/RevealEmailDialog'
import { twoFactorTone } from '../lib/readiness'

export function isHttpsLink(value: string): boolean {
  return value.startsWith('https://')
}

const BM_ROLES: IdentityBusinessRole[] = ['admin', 'employee', 'unknown']

export default function FacebookAccountDetail() {
  const { identityId = '' } = useParams()
  const { t } = useI18n()
  const { user } = useAuth()
  const role = user?.role ?? 'owner'
  const canWrite = role !== 'viewer'
  const canManageEmailAndHolder = role === 'owner' || role === 'admin'

  const queryClient = useQueryClient()
  const [revealOpen, setRevealOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [bmId, setBmId] = useState('')
  const [bmRole, setBmRole] = useState<IdentityBusinessRole>('admin')
  const [bmNote, setBmNote] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emailSavedNotice, setEmailSavedNotice] = useState(false)

  const record = useQuery({
    queryKey: ['personal-account-references', identityId],
    queryFn: () => api.get<ReferenceRecord>(`/api/v1/personal-account-references/${identityId}`),
  })
  const profile = useQuery({
    queryKey: ['facebook-identities', identityId, 'profile'],
    queryFn: () => api.get<FacebookIdentityProfile>(`/api/v1/personal-account-references/${identityId}/profile`),
  })
  const bms = useQuery({
    queryKey: ['business-managers', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
  })
  const members = useQuery({
    queryKey: ['team-members', 'options'],
    queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'),
    retry: false,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
    void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
  }

  const link = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/personal-account-references/${identityId}/business-links`, {
        business_manager_id: bmId,
        role: bmRole,
        note: bmNote.trim(),
      }),
    onSuccess: () => {
      setBmId('')
      setBmNote('')
      refresh()
    },
  })
  const unlink = useMutation({
    mutationFn: (linkId: string) =>
      api.post(`/api/v1/personal-account-references/${identityId}/business-links/${linkId}/unlink`),
    onSuccess: refresh,
  })
  const saveEmail = useMutation({
    mutationFn: (nextEmail: string | null) =>
      api.put(`/api/v1/personal-account-references/${identityId}/email`, { email: nextEmail }),
    onSuccess: (_res, nextEmail) => {
      setEmailInput('')
      setEmailSavedNotice(Boolean(nextEmail))
      refresh()
    },
  })

  if (record.isLoading || profile.isLoading)
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </LoadingRegion>
    )
  if (record.isError || profile.isError || !record.data || !profile.data)
    return (
      <ErrorState
        error={record.error ?? profile.error}
        title={t('fb.error.title')}
        onRetry={() => {
          void record.refetch()
          void profile.refetch()
        }}
      />
    )

  const r = record.data
  const p = profile.data
  const vault = String(r.vault_reference ?? '')

  return (
    <div className="space-y-4">
      <PageHeader
        title={String(r.label)}
        description={t('fb.detail.title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t('fb.form.editBtn')}
              </Button>
            )}
            <Link className="text-sm font-medium text-brand-text hover:underline" to="/facebook-accounts">
              {t('fb.back')}
            </Link>
          </div>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('fb.detail.title')}>
          <dl className={DL_CLASS}>
            <Row label={t('fb.owner')}>{p.owner_member_name ?? '—'}</Row>
            <Row label={t('fb.twoFactor')}>
              <Badge tone={twoFactorTone(String(r.two_factor_method))}>
                {t(`twoFactor.${String(r.two_factor_method)}` as never)}
              </Badge>
            </Row>
            <Row label={t('fb.detail.email')}>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{String(r.email_hint ?? t('fb.detail.emailNone'))}</span>
                  {p.has_full_email && p.can_reveal_email && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setRevealOpen(true)}>
                      {t('fb.detail.reveal')}
                    </Button>
                  )}
                  {canManageEmailAndHolder && Boolean(r.email_hint) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saveEmail.isPending}
                      onClick={() => saveEmail.mutate(null)}
                    >
                      {t('fb.form.clearEmail')}
                    </Button>
                  )}
                </div>
                {canManageEmailAndHolder && (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (emailInput.trim()) saveEmail.mutate(emailInput.trim())
                    }}
                  >
                    <input
                      type="email"
                      className="input max-w-xs text-xs"
                      placeholder={t('fb.form.emailPlaceholder')}
                      value={emailInput}
                      onChange={(e) => {
                        setEmailInput(e.target.value)
                        setEmailSavedNotice(false)
                      }}
                    />
                    <Button type="submit" size="sm" variant="secondary" disabled={!emailInput.trim() || saveEmail.isPending}>
                      {t('fb.form.saveEmail')}
                    </Button>
                  </form>
                )}
                {emailSavedNotice && <p className="text-xs text-ink-muted">{t('fb.form.emailSaved')}</p>}
                {saveEmail.isError && <ErrorState compact error={saveEmail.error} />}
              </div>
            </Row>
            <Row label={t('fb.detail.vault')}>
              {vault ? (
                isHttpsLink(vault) ? (
                  <a className="text-brand-text hover:underline" href={vault} target="_blank" rel="noreferrer noopener">
                    {t('fb.detail.vault')}
                  </a>
                ) : (
                  <span>{vault}</span>
                )
              ) : (
                t('fb.detail.vaultNone')
              )}
            </Row>
            <Row label={t('fb.detail.recovery')}>{String(r.recovery_note || '—')}</Row>
          </dl>
        </Panel>
        <Panel title={t('fb.detail.bm')}>
          {p.business_links.length ? (
            <ul className="space-y-2">
              {p.business_links.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{item.business_manager_name}</span>
                    <Badge tone="neutral" className="ml-2">
                      {t(`fb.role.${item.role}` as never)}
                    </Badge>
                    {item.note && <span className="ml-2 text-xs text-ink-muted">({item.note})</span>}
                  </div>
                  {canWrite && (
                    <Button type="button" size="sm" variant="secondary" disabled={unlink.isPending} onClick={() => unlink.mutate(item.id)}>
                      {t('fb.form.unlink')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>
          )}
          {canWrite && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (bmId) link.mutate()
              }}
            >
              <div>
                <label className="label" htmlFor="fb-bm">
                  {t('fb.businessManagers')}
                </label>
                <select id="fb-bm" className="input" value={bmId} onChange={(e) => setBmId(e.target.value)}>
                  <option value="">—</option>
                  {(bms.data?.items ?? []).map((bm) => (
                    <option key={bm.id} value={bm.id}>
                      {String(bm.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fb-bm-role">
                  {t('fb.form.bmRole')}
                </label>
                <select
                  id="fb-bm-role"
                  className="input"
                  value={bmRole}
                  onChange={(e) => setBmRole(e.target.value as IdentityBusinessRole)}
                >
                  {BM_ROLES.map((roleOpt) => (
                    <option key={roleOpt} value={roleOpt}>
                      {t(`fb.role.${roleOpt}` as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fb-bm-note">
                  {t('fb.form.bmNote')}
                </label>
                <input
                  id="fb-bm-note"
                  className="input"
                  maxLength={1000}
                  value={bmNote}
                  onChange={(e) => setBmNote(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!bmId || link.isPending}>
                {t('ref.add', { name: t('fb.businessManagers') })}
              </Button>
            </form>
          )}
          {(link.isError || unlink.isError) && <ErrorState compact error={link.error ?? unlink.error} />}
        </Panel>
        <Panel title={t('fb.detail.accounts')}>
          {p.ad_accounts.length ? (
            <ul className="space-y-1">
              {p.ad_accounts.map((a) => (
                <li key={a.id}>
                  <Link to={`/accounts/${a.id}`} className="text-brand-text hover:underline">
                    {a.display_name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>
          )}
        </Panel>
        <Panel title={t('fb.detail.readers')}>
          {p.readers.length ? (
            <ul>
              {p.readers.map((x) => (
                <li key={x.id}>{x.label}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t('fb.detail.none')}</p>
          )}
          <Note>{t('fb.pin.desc')}</Note>
        </Panel>
      </div>
      <RevealEmailDialog identityId={identityId} open={revealOpen} onOpenChange={setRevealOpen} />
      <FacebookAccountFormSheet
        open={editing}
        onClose={() => setEditing(false)}
        record={r}
        members={members.data ?? []}
        canAssignOwner={canManageEmailAndHolder}
      />
    </div>
  )
}
