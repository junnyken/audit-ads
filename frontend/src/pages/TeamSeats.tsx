import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Invitation, InvitationCreated, SeatPlan, TeamMember, TeamSummary } from '../lib/types'
import { formatCount, formatRelative } from '../lib/format'
import { INVITATION_STATUS_TONE, MEMBER_STATUS_TONE, ASSIGNABLE_ROLES } from '../lib/team'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Field } from '../components/primitives/field'
import { Skeleton } from '../components/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, LoadingRegion } from '../components/states'
import { ConfirmDialog } from '../components/page/ConfirmDialog'
import { PageHeader } from '../components/page/PageHeader'
import { Stat } from '../components/page/Stat'
import { TableSkeleton } from '../components/page/TableSkeleton'
import InviteMemberDrawer from '../components/team/InviteMemberDrawer'
import MemberDrawer from '../components/team/MemberDrawer'
import type { MemberNotice } from '../components/team/MemberDrawer'
import { Note } from './account/parts'

export default function TeamSeats() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [issuedInvite, setIssuedInvite] = useState<InvitationCreated | null>(null)
  const [notice, setNotice] = useState<MemberNotice | null>(null)
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

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

  if (summary.isLoading || members.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('tm.title')} />
        <LoadingRegion className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Card key={key} className="space-y-2 p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-8 w-1/3" />
            </Card>
          ))}
        </LoadingRegion>
        <TableSkeleton columns={[t('tm.col.member'), t('tm.col.role'), t('tm.col.status'), t('tm.col.bms'), t('tm.col.accounts'), t('tm.col.sessions'), t('pg.actions')]} rows={4} />
      </div>
    )
  }
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} title={t('tm.error.title')} />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => members.refetch()} title={t('tm.error.title')} />

  const stats = summary.data!
  const rows = members.data ?? []
  const selected = rows.find((row) => row.id === selectedMemberId) ?? null
  const caption =
    stats.seat_limit === null
      ? t('tm.seatCaptionNone', { used: formatCount(stats.active_members) })
      : t('tm.seatCaption', { used: formatCount(stats.active_members), limit: formatCount(stats.seat_limit) })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('tm.title')}
        description={`${caption}. ${t('tm.desc')}`}
        actions={
          <Button type="button" onClick={() => setInviteOpen(true)}>
            {t('tm.invite')}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('tm.stat.limit')} value={stats.seat_limit} tone={stats.seat_limit === null ? 'neutral' : 'info'} hint={stats.seat_limit === null ? t('tm.stat.limit.none') : undefined} />
        <Stat label={t('tm.stat.active')} value={stats.active_members} tone="info" />
        <Stat
          label={t('tm.stat.available')}
          value={stats.available_seats}
          tone={stats.available_seats === 0 ? 'caution' : 'neutral'}
          hint={stats.available_seats === null ? t('tm.stat.available.none') : undefined}
        />
        <Stat label={t('tm.stat.pending')} value={stats.pending_invitations} tone="neutral" />
      </div>

      {stats.seat_limit === null && <Note tone="caution">{t('tm.noPlan')}</Note>}
      {notice && (
        <Note role="status" tone={notice.ok ? 'info' : 'caution'}>
          {notice.text}
        </Note>
      )}

      <SeatPlanCard onSaved={refreshAll} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('tm.members.title')}</CardTitle>
        </CardHeader>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('tm.members.empty.title')} description={t('tm.members.empty.body')} action={<Button onClick={() => setInviteOpen(true)}>{t('tm.invite')}</Button>} />
          </div>
        ) : (
          <Table cards aria-label={t('tm.members.title')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('tm.col.member')}</TableHead>
                <TableHead>{t('tm.col.role')}</TableHead>
                <TableHead>{t('tm.col.status')}</TableHead>
                <TableHead numeric>{t('tm.col.bms')}</TableHead>
                <TableHead numeric>{t('tm.col.accounts')}</TableHead>
                <TableHead numeric>{t('tm.col.sessions')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('pg.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="cell-title">
                    <span className="block font-medium">{row.full_name || row.email}</span>
                    <span className="block text-xs text-ink-muted">{row.email}</span>
                  </TableCell>
                  <TableCell label={t('tm.col.role')}>{enumLabel('role', row.role)}</TableCell>
                  <TableCell label={t('tm.col.status')}>
                    <Badge tone={MEMBER_STATUS_TONE[row.status] ?? 'neutral'}>{enumLabel('memberStatus', row.status)}</Badge>
                  </TableCell>
                  <TableCell label={t('tm.col.bms')} numeric className="font-mono">
                    {formatCount(row.assigned_business_manager_count)}
                  </TableCell>
                  <TableCell label={t('tm.col.accounts')} numeric className="font-mono">
                    {formatCount(row.assigned_ad_account_count)}
                  </TableCell>
                  <TableCell label={t('tm.col.sessions')} numeric className="font-mono">
                    {formatCount(row.active_session_count)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={t('tm.manageNamed', { name: row.full_name || row.email })}
                      onClick={() => {
                        setNotice(null)
                        setSelectedMemberId(row.id)
                      }}
                    >
                      {t('tm.manage')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <InvitationsCard
        invitations={invitations.data ?? []}
        isLoading={invitations.isLoading}
        error={invitations.isError ? invitations.error : null}
        onRetry={() => invitations.refetch()}
        onChanged={refreshAll}
        onNotice={setNotice}
        onIssued={(created) => {
          setCopied(null)
          setIssuedInvite(created)
        }}
      />

      {issuedInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('tm.link.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Note tone="caution" role="note">{t('tm.link.warning')}</Note>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-line bg-surface-muted px-2 py-1.5 text-xs">{issuedInvite.invite_link_token}</code>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issuedInvite.invite_link_token)
                    setCopied('ok')
                  } catch {
                    setCopied('failed')
                  }
                }}
              >
                {t('tm.link.copy')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIssuedInvite(null)}>
                {t('tm.link.done')}
              </Button>
            </div>
            <p role="status" className="min-h-4 text-xs text-ink-muted">
              {copied === 'ok' ? t('tm.link.copied') : copied === 'failed' ? t('tm.link.copyFailed') : ''}
            </p>
            <p className="text-xs text-ink-muted">{t('tm.link.note', { email: issuedInvite.invitation.email_normalized })}</p>
          </CardContent>
        </Card>
      )}

      <InviteMemberDrawer
        open={inviteOpen}
        availableSeats={stats.available_seats}
        onClose={() => setInviteOpen(false)}
        onCreated={(created) => {
          setCopied(null)
          setIssuedInvite(created)
          setInviteOpen(false)
          refreshAll()
        }}
      />

      <MemberDrawer
        member={selected}
        onClose={() => setSelectedMemberId(null)}
        onChanged={(next) => {
          if (next) setNotice(next)
          refreshAll()
        }}
      />
    </div>
  )
}

function SeatPlanCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const plan = useQuery({
    queryKey: ['team-seat-plan'],
    queryFn: () => api.get<SeatPlan | null>('/api/v1/team/seat-plan'),
  })
  const [limit, setLimit] = useState<string>('')
  const [reference, setReference] = useState('')
  const [touched, setTouched] = useState(false)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      await api.patch<SeatPlan>('/api/v1/team/seat-plan', {
        seat_limit: Number(limit),
        plan_reference: reference.trim() || null,
      })
      const fresh = await queryClient.fetchQuery({
        queryKey: ['team-seat-plan'],
        queryFn: () => api.get<SeatPlan | null>('/api/v1/team/seat-plan'),
        staleTime: 0,
      })
      return fresh
    },
    onSuccess: (fresh) => {
      setTouched(false)
      setReadBack(
        fresh && fresh.seat_limit === Number(limit)
          ? { ok: true, text: t('tm.plan.readback', { limit: fresh.seat_limit }) }
          : { ok: false, text: t('tm.plan.mismatch') },
      )
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('tm.plan.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.isError && <Note tone="caution" role="status">{t('tm.plan.loadError')}</Note>}
        <form
          className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            setReadBack(null)
            save.mutate()
          }}
        >
          <Field label={t('tm.plan.limit')} required htmlFor="seat-limit">
            <input
              id="seat-limit"
              className="input font-mono"
              type="number"
              min={0}
              value={limit}
              onChange={(event) => {
                setTouched(true)
                setLimit(event.target.value)
              }}
            />
          </Field>
          <Field label={t('tm.plan.reference')} hint={t('tm.plan.reference.hint')} htmlFor="seat-reference">
            <input
              id="seat-reference"
              className="input"
              value={reference}
              onChange={(event) => {
                setTouched(true)
                setReference(event.target.value)
              }}
            />
          </Field>
          <Button type="submit" disabled={limit === '' || save.isPending}>
            {save.isPending ? t('pg.saving') : t('pg.save')}
          </Button>
        </form>
        {save.isError && <ErrorState error={save.error} title={t('tm.plan.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
        {readBack && (
          <Note role="status" tone={readBack.ok ? 'info' : 'caution'}>
            {readBack.text}
          </Note>
        )}
      </CardContent>
    </Card>
  )
}

function InvitationsCard({
  invitations,
  isLoading,
  error,
  onRetry,
  onChanged,
  onNotice,
  onIssued,
}: {
  invitations: Invitation[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  onChanged: () => void
  onNotice: (notice: MemberNotice) => void
  onIssued: (created: InvitationCreated) => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState<Invitation | null>(null)
  const [reason, setReason] = useState('')

  const revoke = useMutation({
    mutationFn: async (invitation: Invitation) => {
      await api.post(`/api/v1/team/invitations/${invitation.id}/revoke`, { reason })
      const fresh = await queryClient.fetchQuery({
        queryKey: ['team-invitations'],
        queryFn: () => api.get<Invitation[]>('/api/v1/team/invitations'),
        staleTime: 0,
      })
      return { invitation, now: fresh.find((row) => row.id === invitation.id) }
    },
    onSuccess: ({ invitation, now }) => {
      setRevoking(null)
      setReason('')
      onNotice(
        now?.status === 'revoked'
          ? { ok: true, text: t('tm.inv.readback.revoked', { email: invitation.email_normalized }) }
          : { ok: false, text: t('tm.inv.readback.mismatch') },
      )
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

  const columns = [t('tm.inv.col.email'), t('tm.inv.col.role'), t('tm.inv.col.status'), t('tm.inv.col.expires'), t('pg.actions')]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('tm.inv.title')}</CardTitle>
      </CardHeader>
      {isLoading ? (
        <div className="p-4">
          <TableSkeleton columns={columns} rows={3} />
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorState error={error} onRetry={onRetry} title={t('tm.inv.loadError')} />
        </div>
      ) : invitations.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">{t('tm.inv.empty')}</p>
      ) : (
        <Table cards aria-label={t('tm.inv.title')}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.slice(0, 4).map((name) => (
                <TableHead key={name}>{name}</TableHead>
              ))}
              <TableHead>
                <span className="sr-only">{t('pg.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((row) => (
              <TableRow key={row.id}>
                <TableCell label={columns[0]} className="cell-title">{row.email_normalized}</TableCell>
                <TableCell label={columns[1]}>{enumLabel('role', row.invited_role)}</TableCell>
                <TableCell label={columns[2]}>
                  <Badge tone={INVITATION_STATUS_TONE[row.status] ?? 'neutral'}>{enumLabel('invStatus', row.status)}</Badge>
                  {row.revoke_reason && <span className="mt-0.5 block text-2xs text-ink-muted">{row.revoke_reason}</span>}
                </TableCell>
                <TableCell label={columns[3]} className="text-xs text-ink-muted">{formatRelative(row.expires_at)}</TableCell>
                <TableCell>
                  {row.status === 'pending' || row.status === 'expired' ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={resend.isPending}
                        aria-label={t('tm.inv.resendNamed', { email: row.email_normalized })}
                        onClick={() => resend.mutate(row.id)}
                      >
                        {t('tm.inv.resend')}
                      </Button>
                      {row.status === 'pending' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('tm.inv.revokeNamed', { email: row.email_normalized })}
                          onClick={() => setRevoking(row)}
                        >
                          {t('tm.inv.revoke')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {resend.isError && (
        <div className="p-4 pt-0">
          <ErrorState error={resend.error} title={t('tm.inv.resend.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onCancel={() => {
          setRevoking(null)
          setReason('')
          revoke.reset()
        }}
        title={t('tm.inv.revoke.title')}
        object={revoking ? t('tm.inv.revoke.object', { email: revoking.email_normalized, role: enumLabel('role', revoking.invited_role) }) : ''}
        effects={[t('tm.inv.revoke.effect'), t('tm.inv.revoke.keeps'), t('tm.inv.revoke.reversible')]}
        confirmLabel={t('tm.inv.revoke.confirm')}
        reason={{ label: t('tm.inv.revoke.reason'), value: reason, onChange: setReason }}
        pending={revoke.isPending}
        error={revoke.isError ? revoke.error : undefined}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Card>
  )
}

export { ASSIGNABLE_ROLES }
