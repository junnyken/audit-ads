import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { Badge, Drawer, ErrorState, Field, InlineNote, Skeleton } from '../ui'
import { formatRelative } from '../../lib/format'
import {
  ASSIGNABLE_ROLES,
  ASSIGNMENT_STATUS_TONE,
  MEMBER_STATUS_LABEL,
  MEMBER_STATUS_TONE,
  ROLE_LABEL,
} from '../../lib/team'

/** A9 §G.4-6. Every destructive action here takes a typed reason and says out loud what it
 * does — deactivating is not called "delete", and the confirmation states the seat and session
 * consequences before it happens. */
export default function MemberDrawer({
  member,
  onClose,
  onChanged,
}: {
  member: TeamMember | null
  onClose: () => void
  onChanged: () => void
}) {
  const [reason, setReason] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

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

  const refresh = () => {
    void assignments.refetch()
    void preview.refetch()
    void sessions.refetch()
    onChanged()
  }

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/api/v1/team/members/${member!.id}/${path}`, body),
    onSuccess: () => {
      setReason('')
      setPendingAction(null)
      refresh()
    },
  })
  const changeRole = useMutation({
    mutationFn: (role: string) => api.patch(`/api/v1/team/members/${member!.id}/role`, { role }),
    onSuccess: refresh,
  })

  if (!member) return null

  const activeSessions = (sessions.data ?? []).filter((row) => row.revoked_at === null)

  return (
    <Drawer open title={member.full_name || member.email} onClose={onClose}>
      <div className="space-y-4">
        <section className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={MEMBER_STATUS_TONE[member.status]}>
              {MEMBER_STATUS_LABEL[member.status]}
            </Badge>
            <span className="text-[12.5px] text-ink-muted">{member.email}</span>
          </div>
          <p className="text-[11.5px] text-ink-faint">
            Joined {formatRelative(member.created_at)} · {activeSessions.length} active session(s)
          </p>
        </section>

        {member.role === 'owner' ? (
          <InlineNote>
            This is the workspace owner: global access, no assignments needed, and the last
            active owner cannot be downgraded, suspended, deactivated or archived.
          </InlineNote>
        ) : (
          <section>
            <Field label="Role" hint="Owner is not offered here — ownership transfer is a separate flow.">
              <select
                className="input"
                value={ASSIGNABLE_ROLES.includes(member.role as never) ? member.role : 'viewer'}
                onChange={(event) => changeRole.mutate(event.target.value)}
                disabled={changeRole.isPending}
              >
                {ASSIGNABLE_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </Field>
            {changeRole.isError && <ErrorState error={changeRole.error} />}
          </section>
        )}

        <ScopeSection
          memberId={member.id}
          assignments={assignments.data}
          isLoading={assignments.isLoading}
          onChanged={refresh}
        />

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Effective access
          </h3>
          {preview.isLoading ? (
            <Skeleton rows={2} />
          ) : preview.data?.is_owner ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Owner — sees every resource in this workspace.
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {preview.data?.business_manager_ids.length ?? 0} Business Manager(s) ·{' '}
              {preview.data?.ad_account_ids.length ?? 0} ad account(s), including accounts reached
              through an assigned Business Manager.
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Devices
          </h3>
          {sessions.isLoading ? (
            <Skeleton rows={2} />
          ) : activeSessions.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">No active sessions.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {activeSessions.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <span>
                    {row.label}
                    <span className="ml-1.5 text-[11.5px] text-ink-faint">
                      last seen {formatRelative(row.last_seen_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {member.role !== 'owner' && (
          <section className="space-y-2 border-t border-line pt-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Access actions
            </h3>

            {pendingAction && (
              <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[12px]">
                <p className="font-medium">
                  {pendingAction === 'suspend' && 'Suspend this member'}
                  {pendingAction === 'deactivate' && 'Deactivate this member'}
                  {pendingAction === 'archive' && 'Archive this member'}
                  {pendingAction === 'sessions/revoke-all' && 'Sign this member out everywhere'}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                  <li>{activeSessions.length} active session(s) will be revoked immediately.</li>
                  {pendingAction === 'deactivate' && <li>Their seat is released.</li>}
                  {pendingAction === 'suspend' && <li>Their seat stays used until you deactivate them.</li>}
                  {pendingAction !== 'sessions/revoke-all' && (
                    <li>History, assignments and audit records are kept — nothing is deleted.</li>
                  )}
                </ul>
                <input
                  className="input mt-2"
                  placeholder="Reason (required)"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!reason.trim() || act.isPending}
                    onClick={() => act.mutate({ path: pendingAction, body: { reason } })}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setPendingAction(null)
                      setReason('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {member.status === 'active' && (
                <button type="button" className="btn-secondary" onClick={() => setPendingAction('suspend')}>
                  Suspend
                </button>
              )}
              {member.status === 'suspended' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => act.mutate({ path: 'unsuspend' })}
                >
                  Unsuspend
                </button>
              )}
              {member.status !== 'deactivated' && (
                <button type="button" className="btn-secondary" onClick={() => setPendingAction('deactivate')}>
                  Deactivate
                </button>
              )}
              {member.status === 'deactivated' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => act.mutate({ path: 'reactivate' })}
                >
                  Reactivate
                </button>
              )}
              {activeSessions.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPendingAction('sessions/revoke-all')}
                >
                  Sign out all devices
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => setPendingAction('archive')}>
                Archive
              </button>
            </div>
            {act.isError && <ErrorState error={act.error} />}
          </section>
        )}
      </div>
    </Drawer>
  )
}

function ScopeSection({
  memberId,
  assignments,
  isLoading,
  onChanged,
}: {
  memberId: string
  assignments: MemberAssignments | undefined
  isLoading: boolean
  onChanged: () => void
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const businessManagers = useQuery({
    queryKey: ['business-managers-for-assignment'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=100'),
  })
  const accounts = useQuery({
    queryKey: ['accounts-for-assignment'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=100'),
  })

  const assignBm = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/team/members/${memberId}/business-manager-assignments`, {
        business_manager_id: id,
      }),
    onSuccess: onChanged,
  })
  const assignAccount = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/team/members/${memberId}/ad-account-assignments`, { ad_account_id: id }),
    onSuccess: onChanged,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/team/assignments/${id}/revoke`, { reason }),
    onSuccess: () => {
      setRevokingId(null)
      setReason('')
      onChanged()
    },
  })

  if (isLoading) return <Skeleton rows={3} />

  const rows: { label: string; items: Assignment[]; nameOf: (a: Assignment) => string }[] = [
    {
      label: 'Business Managers',
      items: assignments?.business_managers ?? [],
      nameOf: (a) =>
        String(
          businessManagers.data?.items.find((bm) => bm.id === a.business_manager_id)?.name ??
            a.business_manager_id ??
            '—',
        ),
    },
    {
      label: 'Ad accounts',
      items: assignments?.ad_accounts ?? [],
      nameOf: (a) =>
        accounts.data?.items.find((account) => account.id === a.ad_account_id)?.display_name ??
        a.ad_account_id ??
        '—',
    },
  ]

  return (
    <section className="space-y-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Scope</h3>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Add Business Manager">
          <select
            className="input"
            value=""
            disabled={assignBm.isPending}
            onChange={(event) => event.target.value && assignBm.mutate(event.target.value)}
          >
            <option value="">— Choose —</option>
            {(businessManagers.data?.items ?? []).map((bm) => (
              <option key={bm.id} value={bm.id}>
                {String(bm.name ?? bm.id)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Add ad account">
          <select
            className="input"
            value=""
            disabled={assignAccount.isPending}
            onChange={(event) => event.target.value && assignAccount.mutate(event.target.value)}
          >
            <option value="">— Choose —</option>
            {(accounts.data?.items ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.display_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {assignBm.isError && <ErrorState error={assignBm.error} />}
      {assignAccount.isError && <ErrorState error={assignAccount.error} />}

      {rows.map((group) => (
        <div key={group.label}>
          <p className="text-[11.5px] font-medium text-ink-faint">{group.label}</p>
          {group.items.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">None assigned.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {group.items.map((item) => (
                <li key={item.id} className="text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{group.nameOf(item)}</span>
                    <Badge tone={ASSIGNMENT_STATUS_TONE[item.status]}>{item.status}</Badge>
                    {item.status === 'active' && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setRevokingId(revokingId === item.id ? null : item.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                  {revokingId === item.id && (
                    <div className="mt-1 space-y-1.5">
                      <input
                        className="input"
                        placeholder="Reason (required)"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!reason.trim() || revoke.isPending}
                        onClick={() => revoke.mutate(item.id)}
                      >
                        Confirm revoke
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {revoke.isError && <ErrorState error={revoke.error} />}
    </section>
  )
}
