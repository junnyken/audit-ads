import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Invitation, InvitationCreated, SeatPlan, TeamMember, TeamSummary } from '../lib/types'
import { Badge, Card, EmptyState, ErrorState, Field, InlineNote, Skeleton, StatTile } from '../components/ui'
import { formatRelative } from '../lib/format'
import {
  ASSIGNABLE_ROLES,
  INVITATION_STATUS_LABEL,
  INVITATION_STATUS_TONE,
  MEMBER_STATUS_LABEL,
  MEMBER_STATUS_TONE,
  ONE_TIME_TOKEN_WARNING,
  ROLE_LABEL,
  seatCaption,
} from '../lib/team'
import InviteMemberDrawer from '../components/team/InviteMemberDrawer'
import MemberDrawer from '../components/team/MemberDrawer'

export default function TeamSeats() {
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [issuedInvite, setIssuedInvite] = useState<InvitationCreated | null>(null)

  const summary = useQuery({
    queryKey: ['team-summary'],
    queryFn: () => api.get<TeamSummary>('/api/v1/team/summary'),
  })
  const members = useQuery({
    queryKey: ['team-members'],
    queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'),
  })
  const invitations = useQuery({
    queryKey: ['team-invitations'],
    queryFn: () => api.get<Invitation[]>('/api/v1/team/invitations'),
  })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['team-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['team-members'] })
    void queryClient.invalidateQueries({ queryKey: ['team-invitations'] })
  }

  if (summary.isLoading || members.isLoading) return <Skeleton rows={6} />
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => members.refetch()} />

  const stats = summary.data!
  const rows = members.data ?? []
  const selected = rows.find((row) => row.id === selectedMemberId) ?? null

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Team &amp; Seats</h1>
          <p className="text-[12.5px] text-ink-muted">
            {seatCaption(stats.seat_limit, stats.active_members)}. Access to this product only —
            it grants nothing on Meta itself.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setInviteOpen(true)}>
          Invite member
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Seat limit"
          value={stats.seat_limit ?? '—'}
          tone={stats.seat_limit === null ? 'neutral' : 'info'}
          hint={stats.seat_limit === null ? 'No seat plan configured yet' : undefined}
        />
        <StatTile label="Active members" value={stats.active_members} tone="info" />
        <StatTile
          label="Available seats"
          value={stats.available_seats ?? '—'}
          tone={stats.available_seats === 0 ? 'caution' : 'neutral'}
          hint={stats.available_seats === null ? 'Unknown until a seat plan exists' : undefined}
        />
        <StatTile label="Pending invitations" value={stats.pending_invitations} tone="neutral" />
      </div>

      {stats.seat_limit === null && (
        <InlineNote>
          No seat plan is configured, so nobody can accept an invitation yet. Set a seat limit
          below — the number is capacity only, this product does not bill for seats.
        </InlineNote>
      )}

      <SeatPlanCard onSaved={refreshAll} />

      <Card title="Members">
        {rows.length === 0 ? (
          <EmptyState title="No members yet" description="Invite someone to get started." />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Member</th>
                  <th className="th">Role</th>
                  <th className="th">Status</th>
                  <th className="th">Assigned BMs</th>
                  <th className="th">Assigned accounts</th>
                  <th className="th">Sessions</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="td">
                      <div className="font-medium">{row.full_name || row.email}</div>
                      <div className="text-[11.5px] text-ink-faint">{row.email}</div>
                    </td>
                    <td className="td">{ROLE_LABEL[row.role] ?? row.role}</td>
                    <td className="td">
                      <Badge tone={MEMBER_STATUS_TONE[row.status]}>
                        {MEMBER_STATUS_LABEL[row.status]}
                      </Badge>
                    </td>
                    <td className="td tabular-nums">{row.assigned_business_manager_count}</td>
                    <td className="td tabular-nums">{row.assigned_ad_account_count}</td>
                    <td className="td tabular-nums">{row.active_session_count}</td>
                    <td className="td">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setSelectedMemberId(row.id)}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvitationsCard
        invitations={invitations.data ?? []}
        isLoading={invitations.isLoading}
        onChanged={refreshAll}
        onIssued={setIssuedInvite}
      />

      {issuedInvite && (
        <Card title="Invitation link">
          <InlineNote>{ONE_TIME_TOKEN_WARNING}</InlineNote>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 break-all rounded-md border border-line bg-surface-muted px-2 py-1.5 text-[12px]">
              {issuedInvite.invite_link_token}
            </code>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void navigator.clipboard?.writeText(issuedInvite.invite_link_token)}
            >
              Copy
            </button>
            <button type="button" className="btn-ghost" onClick={() => setIssuedInvite(null)}>
              Done
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Send it to {issuedInvite.invitation.email_normalized} through a channel you trust.
            This product has no email provider configured, so nothing was sent automatically.
          </p>
        </Card>
      )}

      <InviteMemberDrawer
        open={inviteOpen}
        availableSeats={stats.available_seats}
        onClose={() => setInviteOpen(false)}
        onCreated={(created) => {
          setIssuedInvite(created)
          setInviteOpen(false)
          refreshAll()
        }}
      />

      <MemberDrawer
        member={selected}
        onClose={() => setSelectedMemberId(null)}
        onChanged={refreshAll}
      />
    </div>
  )
}

function SeatPlanCard({ onSaved }: { onSaved: () => void }) {
  const plan = useQuery({
    queryKey: ['team-seat-plan'],
    queryFn: () => api.get<SeatPlan | null>('/api/v1/team/seat-plan'),
  })
  const [limit, setLimit] = useState<string>('')
  const [reference, setReference] = useState('')
  const [touched, setTouched] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      api.patch<SeatPlan>('/api/v1/team/seat-plan', {
        seat_limit: Number(limit),
        plan_reference: reference.trim() || null,
      }),
    onSuccess: () => {
      setTouched(false)
      void plan.refetch()
      onSaved()
    },
  })

  const current = plan.data ?? null
  if (!touched && current && limit === '') {
    setLimit(String(current.seat_limit))
    setReference(current.plan_reference ?? '')
  }

  return (
    <Card title="Seat plan">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <Field label="Seat limit" required>
          <input
            className="input"
            type="number"
            min={0}
            value={limit}
            onChange={(event) => {
              setTouched(true)
              setLimit(event.target.value)
            }}
          />
        </Field>
        <Field label="Plan reference" hint="Descriptive only — this product never bills for seats.">
          <input
            className="input"
            value={reference}
            onChange={(event) => {
              setTouched(true)
              setReference(event.target.value)
            }}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={limit === '' || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {save.isError && <ErrorState error={save.error} />}
    </Card>
  )
}

function InvitationsCard({
  invitations,
  isLoading,
  onChanged,
  onIssued,
}: {
  invitations: Invitation[]
  isLoading: boolean
  onChanged: () => void
  onIssued: (created: InvitationCreated) => void
}) {
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/team/invitations/${id}/revoke`, { reason }),
    onSuccess: () => {
      setReasonFor(null)
      setReason('')
      onChanged()
    },
  })
  const resend = useMutation({
    mutationFn: (id: string) => api.post<InvitationCreated>(`/api/v1/team/invitations/${id}/resend`),
    onSuccess: (created) => {
      onIssued(created)
      onChanged()
    },
  })

  if (isLoading) return <Skeleton rows={3} />

  return (
    <Card title="Invitations">
      {invitations.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">No invitations have been created yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Email</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Expires</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((row) => (
                <tr key={row.id}>
                  <td className="td">{row.email_normalized}</td>
                  <td className="td">{ROLE_LABEL[row.invited_role] ?? row.invited_role}</td>
                  <td className="td">
                    <Badge tone={INVITATION_STATUS_TONE[row.status]}>
                      {INVITATION_STATUS_LABEL[row.status]}
                    </Badge>
                    {row.revoke_reason && (
                      <p className="mt-0.5 text-[11px] text-ink-faint">{row.revoke_reason}</p>
                    )}
                  </td>
                  <td className="td text-[12px] text-ink-muted">{formatRelative(row.expires_at)}</td>
                  <td className="td">
                    {row.status === 'pending' || row.status === 'expired' ? (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(row.id)}
                        >
                          Resend
                        </button>
                        {row.status === 'pending' && (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => setReasonFor(reasonFor === row.id ? null : row.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                    {reasonFor === row.id && (
                      <div className="mt-2 space-y-1.5">
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
                          onClick={() => revoke.mutate(row.id)}
                        >
                          Confirm revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoke.isError && <ErrorState error={revoke.error} />}
      {resend.isError && <ErrorState error={resend.error} />}
    </Card>
  )
}

export { ASSIGNABLE_ROLES }
