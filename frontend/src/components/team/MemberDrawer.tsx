import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type {
  AccessPreview,
  AdAccount,
  Assignment,
  DeviceSession,
  MemberAssignments,
  Paged,
  ReferenceRecord,
  TeamMember,
} from '../../lib/types'
import { formatCount, formatRelative } from '../../lib/format'
import { ASSIGNABLE_ROLES, ASSIGNMENT_STATUS_TONE, MEMBER_STATUS_TONE } from '../../lib/team'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { Skeleton } from '../primitives/skeleton'
import { ErrorState, LoadingRegion, PartialDataNote } from '../states'
import { ConfirmDialog } from '../page/ConfirmDialog'
import { FormSheet } from '../page/FormSheet'
import { Note } from '../../pages/account/parts'

export interface MemberNotice {
  ok: boolean
  text: string
}

type StatusAction = 'suspend' | 'deactivate' | 'archive' | 'sessions/revoke-all'
type Pending =
  | { type: 'status'; action: StatusAction }
  | { type: 'role'; role: string }
  | { type: 'revoke'; assignment: Assignment; kind: string; name: string }
  | null

const EXPECTED_STATUS: Record<string, string | undefined> = {
  suspend: 'suspended',
  unsuspend: 'active',
  deactivate: 'deactivated',
  reactivate: 'active',
}

/** A9 §G.4-6. Every destructive action here is confirmed in an AlertDialog that names the member,
 * says what it does (seat, sessions, history kept, whether it can be undone) and takes a typed
 * reason. Deactivating is not called "delete". After each write the member list is read back and
 * the sheet reports what the server now holds. */
export default function MemberDrawer({
  member,
  onClose,
  onChanged,
}: {
  member: TeamMember | null
  onClose: () => void
  onChanged: (notice?: MemberNotice) => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<MemberNotice | null>(null)

  const assignments = useQuery({
    queryKey: ['member-assignments', member?.id],
    queryFn: () => api.get<MemberAssignments>(`/api/v1/team/members/${member!.id}/assignments`),
    enabled: Boolean(member),
  })
  const preview = useQuery({
    queryKey: ['member-access-preview', member?.id],
    queryFn: () => api.get<AccessPreview>(`/api/v1/team/members/${member!.id}/access-preview`),
    enabled: Boolean(member),
  })
  const sessions = useQuery({
    queryKey: ['member-sessions', member?.id],
    queryFn: () => api.get<DeviceSession[]>(`/api/v1/team/members/${member!.id}/sessions`),
    enabled: Boolean(member),
  })
  const businessManagers = useQuery({
    queryKey: ['business-managers-for-assignment'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=100'),
    enabled: Boolean(member),
  })
  const accounts = useQuery({
    queryKey: ['accounts-for-assignment'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=100'),
    enabled: Boolean(member),
  })

  const refresh = (next?: MemberNotice) => {
    void assignments.refetch()
    void preview.refetch()
    void sessions.refetch()
    if (next) setNotice(next)
    onChanged(next)
  }

  const readMember = async (): Promise<TeamMember | undefined> => {
    const list = await queryClient.fetchQuery({
      queryKey: ['team-members'],
      queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'),
      staleTime: 0,
    })
    return list.find((row) => row.id === member!.id)
  }

  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => {
      await api.post(`/api/v1/team/members/${member!.id}/${path}`, body)
      const fresh = await readMember()
      return { path, fresh }
    },
    onSuccess: ({ path, fresh }) => {
      const name = member!.full_name || member!.email
      setReason('')
      setPending(null)
      if (path === 'archive') {
        // An archived member drops out of the list: gone is the expected answer.
        refresh(
          !fresh || fresh.is_archived
            ? { ok: true, text: t('mb.act.readback.archived', { name }) }
            : { ok: false, text: t('mb.act.mismatch', { name }) },
        )
        return
      }
      if (path === 'sessions/revoke-all') {
        const left = fresh?.active_session_count
        refresh(
          left === 0
            ? { ok: true, text: t('mb.act.readback.sessions', { count: 0, name }) }
            : { ok: false, text: t('mb.act.mismatch', { name }) },
        )
        return
      }
      const expected = EXPECTED_STATUS[path]
      refresh(
        fresh && expected && fresh.status === expected
          ? { ok: true, text: t('mb.act.readback', { name, status: enumLabel('memberStatus', fresh.status) }) }
          : { ok: false, text: t('mb.act.mismatch', { name }) },
      )
    },
  })

  const changeRole = useMutation({
    mutationFn: async (role: string) => {
      await api.patch(`/api/v1/team/members/${member!.id}/role`, { role })
      const fresh = await readMember()
      return { role, fresh }
    },
    onSuccess: ({ role, fresh }) => {
      const name = member!.full_name || member!.email
      setPending(null)
      refresh(
        fresh?.role === role
          ? { ok: true, text: t('mb.role.readback', { name, role: enumLabel('role', role) }) }
          : { ok: false, text: t('mb.role.mismatch', { name }) },
      )
    },
  })

  const assignBm = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/team/members/${member!.id}/business-manager-assignments`, { business_manager_id: id }),
    onSuccess: () => refresh(),
  })
  const assignAccount = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/team/members/${member!.id}/ad-account-assignments`, { ad_account_id: id }),
    onSuccess: () => refresh(),
  })
  const revoke = useMutation({
    mutationFn: async ({ id, name: scopeName }: { id: string; name: string }) => {
      await api.post(`/api/v1/team/assignments/${id}/revoke`, { reason })
      const fresh = await queryClient.fetchQuery({
        queryKey: ['member-assignments', member!.id],
        queryFn: () => api.get<MemberAssignments>(`/api/v1/team/members/${member!.id}/assignments`),
        staleTime: 0,
      })
      const all = [...fresh.business_managers, ...fresh.ad_accounts]
      return { row: all.find((row) => row.id === id), scopeName }
    },
    onSuccess: ({ row, scopeName }) => {
      setReason('')
      setPending(null)
      refresh(
        row?.status === 'revoked'
          ? { ok: true, text: t('mb.scope.revoke.readback', { name: scopeName, member: member!.full_name || member!.email }) }
          : { ok: false, text: t('mb.act.mismatch', { name: member!.full_name || member!.email }) },
      )
    },
  })

  if (!member) return null

  const name = member.full_name || member.email
  const activeSessions = (sessions.data ?? []).filter((row) => row.revoked_at === null)
  const closeDialog = () => {
    setPending(null)
    setReason('')
    act.reset()
    changeRole.reset()
    revoke.reset()
  }

  const bmName = (a: Assignment) =>
    String(businessManagers.data?.items.find((bm) => bm.id === a.business_manager_id)?.name ?? a.business_manager_id ?? '—')
  const accountName = (a: Assignment) =>
    accounts.data?.items.find((account) => account.id === a.ad_account_id)?.display_name ?? a.ad_account_id ?? '—'
  const groups = [
    { kind: t('mb.scope.bms'), items: assignments.data?.business_managers ?? [], nameOf: bmName },
    { kind: t('mb.scope.accounts'), items: assignments.data?.ad_accounts ?? [], nameOf: accountName },
  ]

  const dialog = (() => {
    if (!pending) return null
    if (pending.type === 'role') {
      return {
        title: t('mb.role.title', { name }),
        object: t('mb.role.object', { name, email: member.email, from: enumLabel('role', member.role), to: enumLabel('role', pending.role) }),
        effects: [t('mb.role.effect'), t('mb.role.scope'), t('mb.role.reversible')],
        confirmLabel: t('mb.role.confirm'),
        tone: 'default' as const,
        isPending: changeRole.isPending,
        error: changeRole.isError ? changeRole.error : undefined,
        reason: undefined,
        onConfirm: () => changeRole.mutate(pending.role),
      }
    }
    if (pending.type === 'revoke') {
      return {
        title: t('mb.scope.revoke.title'),
        object: t('mb.scope.revoke.object', { kind: pending.kind, name: pending.name, member: name }),
        effects: [t('mb.scope.revoke.effect'), t('mb.scope.revoke.keeps'), t('mb.scope.revoke.reversible')],
        confirmLabel: t('mb.scope.revoke.confirm'),
        tone: 'destructive' as const,
        isPending: revoke.isPending,
        error: revoke.isError ? revoke.error : undefined,
        reason: { label: t('mb.scope.revoke.reason'), value: reason, onChange: setReason },
        onConfirm: () => revoke.mutate({ id: pending.assignment.id, name: pending.name }),
      }
    }
    const action = pending.action
    const key = action === 'sessions/revoke-all' ? 'revokeAll' : action
    const effects = [t('mb.act.sessions', { count: activeSessions.length })]
    if (action === 'deactivate') effects.push(t('mb.act.seatReleased'))
    if (action === 'suspend') effects.push(t('mb.act.seatKept'))
    if (action !== 'sessions/revoke-all') effects.push(t('mb.act.keeps'))
    effects.push(t(`mb.act.reversible.${key}` as 'mb.act.reversible.suspend'))
    return {
      title: t(`mb.act.${key}.title` as 'mb.act.suspend.title'),
      object: t('mb.act.object', { name, email: member.email, status: enumLabel('memberStatus', member.status) }),
      effects,
      confirmLabel: t(`mb.act.confirm.${key}` as 'mb.act.confirm.suspend'),
      tone: 'destructive' as const,
      isPending: act.isPending,
      error: act.isError ? act.error : undefined,
      reason: { label: t('mb.act.reason'), value: reason, onChange: setReason },
      onConfirm: () => act.mutate({ path: action, body: { reason } }),
    }
  })()

  const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-ink-faint'

  return (
    <FormSheet open onClose={onClose} title={name} description={t('mb.desc')} wide>
      <div className="space-y-4">
        <section className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={MEMBER_STATUS_TONE[member.status] ?? 'neutral'}>{enumLabel('memberStatus', member.status)}</Badge>
            <span className="text-sm text-ink-muted">{member.email}</span>
          </div>
          <p className="text-xs text-ink-muted">{t('mb.joined', { time: formatRelative(member.created_at), count: sessions.data ? activeSessions.length : '—' })}</p>
        </section>

        {notice && (
          <Note role="status" tone={notice.ok ? 'info' : 'caution'}>
            {notice.text}
          </Note>
        )}

        {member.role === 'owner' ? (
          <Note>{t('mb.owner')}</Note>
        ) : (
          <section>
            <Field label={t('mb.role')} hint={t('mb.role.hint')} htmlFor="member-role">
              <select
                id="member-role"
                className="input"
                value={ASSIGNABLE_ROLES.includes(member.role as never) ? member.role : 'viewer'}
                onChange={(event) => {
                  if (event.target.value !== member.role) setPending({ type: 'role', role: event.target.value })
                }}
                disabled={changeRole.isPending}
              >
                {ASSIGNABLE_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {enumLabel('role', value)}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        )}

        <section className="space-y-3">
          <h3 className={sectionTitle}>{t('mb.scope.title')}</h3>
          {(businessManagers.isError || accounts.isError) && <PartialDataNote>{t('mb.scope.optionsError')}</PartialDataNote>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('mb.scope.addBm')} htmlFor="add-bm">
              <select
                id="add-bm"
                className="input"
                value=""
                disabled={assignBm.isPending}
                onChange={(event) => event.target.value && assignBm.mutate(event.target.value)}
              >
                <option value="">{t('mb.scope.choose')}</option>
                {(businessManagers.data?.items ?? []).map((bm) => (
                  <option key={bm.id} value={bm.id}>
                    {String(bm.name ?? bm.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('mb.scope.addAccount')} htmlFor="add-account">
              <select
                id="add-account"
                className="input"
                value=""
                disabled={assignAccount.isPending}
                onChange={(event) => event.target.value && assignAccount.mutate(event.target.value)}
              >
                <option value="">{t('mb.scope.choose')}</option>
                {(accounts.data?.items ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {assignBm.isError && <ErrorState error={assignBm.error} title={t('mb.act.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
          {assignAccount.isError && <ErrorState error={assignAccount.error} title={t('mb.act.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}

          {assignments.isLoading ? (
            <LoadingRegion>
              <Skeleton className="h-16 w-full" />
            </LoadingRegion>
          ) : assignments.isError ? (
            <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} title={t('mb.scope.error')} compact />
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <p className="text-xs font-medium text-ink-faint">{group.kind}</p>
                {group.items.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('mb.scope.none')}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{group.nameOf(item)}</span>
                        <Badge tone={ASSIGNMENT_STATUS_TONE[item.status] ?? 'neutral'}>{enumLabel('assignStatus', item.status)}</Badge>
                        {item.status === 'active' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('mb.scope.revokeNamed', { name: group.nameOf(item) })}
                            onClick={() => setPending({ type: 'revoke', assignment: item, kind: group.kind, name: group.nameOf(item) })}
                          >
                            {t('mb.scope.revoke')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </section>

        <section>
          <h3 className={sectionTitle}>{t('mb.access.title')}</h3>
          {preview.isLoading ? (
            <Skeleton className="mt-1 h-5 w-2/3" />
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => preview.refetch()} title={t('mb.access.error')} compact />
          ) : preview.data?.is_owner ? (
            <p className="mt-1 text-sm text-ink-muted">{t('mb.access.owner')}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">
              {t('mb.access.count', {
                bms: formatCount(preview.data?.business_manager_ids.length ?? 0),
                accounts: formatCount(preview.data?.ad_account_ids.length ?? 0),
              })}
            </p>
          )}
        </section>

        <section>
          <h3 className={sectionTitle}>{t('mb.devices.title')}</h3>
          {sessions.isLoading ? (
            <Skeleton className="mt-1 h-5 w-2/3" />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} title={t('mb.devices.error')} compact />
          ) : activeSessions.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">{t('mb.devices.none')}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {activeSessions.map((row) => (
                <li key={row.id}>
                  {row.label}
                  <span className="ml-1.5 text-xs text-ink-muted">{t('mb.devices.lastSeen', { time: formatRelative(row.last_seen_at) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {member.role !== 'owner' && (
          <section className="space-y-2 border-t border-line pt-3">
            <h3 className={sectionTitle}>{t('mb.actions.title')}</h3>
            <div className="flex flex-wrap gap-2">
              {member.status === 'active' && (
                <Button type="button" variant="secondary" onClick={() => setPending({ type: 'status', action: 'suspend' })}>
                  {t('mb.act.suspend')}
                </Button>
              )}
              {member.status === 'suspended' && (
                <Button type="button" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ path: 'unsuspend' })}>
                  {t('mb.act.unsuspend')}
                </Button>
              )}
              {member.status !== 'deactivated' && (
                <Button type="button" variant="secondary" onClick={() => setPending({ type: 'status', action: 'deactivate' })}>
                  {t('mb.act.deactivate')}
                </Button>
              )}
              {member.status === 'deactivated' && (
                <Button type="button" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ path: 'reactivate' })}>
                  {t('mb.act.reactivate')}
                </Button>
              )}
              {activeSessions.length > 0 && (
                <Button type="button" variant="secondary" onClick={() => setPending({ type: 'status', action: 'sessions/revoke-all' })}>
                  {t('mb.act.revokeAll')}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setPending({ type: 'status', action: 'archive' })}>
                {t('mb.act.archive')}
              </Button>
            </div>
            {act.isError && !pending && <ErrorState error={act.error} title={t('mb.act.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onCancel={closeDialog}
        title={dialog?.title ?? ''}
        object={dialog?.object ?? ''}
        effects={dialog?.effects ?? []}
        confirmLabel={dialog?.confirmLabel ?? ''}
        tone={dialog?.tone}
        pending={dialog?.isPending}
        error={dialog?.error}
        reason={dialog?.reason}
        onConfirm={() => dialog?.onConfirm()}
      />
    </FormSheet>
  )
}
