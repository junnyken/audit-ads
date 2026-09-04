import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AccountEvent, AdAccount } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, Field, Skeleton } from '../../components/ui'
import { severityTone } from '../../lib/readiness'
import { formatDateTime, humanise } from '../../lib/format'

export default function EventsTab({ account, onChanged }: { account: AdAccount; onChanged: () => void }) {
  const events = useQuery({
    queryKey: ['events', account.id],
    queryFn: () => api.get<AccountEvent[]>(`/api/v1/ad-accounts/${account.id}/events`),
  })

  const [form, setForm] = useState({ event_type: '', severity: 'info', summary: '' })
  const create = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${account.id}/events`, form),
    onSuccess: () => {
      setForm({ event_type: '', severity: 'info', summary: '' })
      onChanged()
      void events.refetch()
    },
  })

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card title="Event timeline">
        {events.isLoading ? (
          <Skeleton rows={4} />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} />
        ) : events.data!.length === 0 ? (
          <EmptyState
            title="No events recorded"
            description="Record what you observed — a restriction notice, a billing problem, a policy warning. Unresolved warning and critical events change readiness."
          />
        ) : (
          <ul className="space-y-3">
            {events.data!.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                readOnly={account.archived_at !== null}
                onChanged={() => {
                  onChanged()
                  void events.refetch()
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {account.archived_at === null && (
        <Card title="Record an event">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <Field label="Event type" required>
              <input
                className="input"
                placeholder="billing_issue, policy_notice, …"
                value={form.event_type}
                onChange={(event) => setForm({ ...form, event_type: event.target.value })}
                required
                maxLength={120}
              />
            </Field>
            <Field label="Severity" required hint="Unresolved warnings downgrade to ready with warnings; unresolved critical events make an account not ready.">
              <select
                className="input"
                value={form.severity}
                onChange={(event) => setForm({ ...form, severity: event.target.value })}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="What did you observe?" required>
              <textarea
                className="input min-h-[80px]"
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                required
                maxLength={5000}
              />
            </Field>
            {create.isError && <ErrorState error={create.error} />}
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={create.isPending || !form.event_type.trim() || !form.summary.trim()}
            >
              {create.isPending ? 'Recording…' : 'Record event'}
            </button>
          </form>
        </Card>
      )}
    </div>
  )
}

function EventRow({
  event,
  readOnly,
  onChanged,
}: {
  event: AccountEvent
  readOnly: boolean
  onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/v1/account-events/${event.id}/resolve`, { resolution_note: note }),
    onSuccess: () => {
      setResolving(false)
      setNote('')
      onChanged()
    },
  })

  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(event.severity)}>{event.severity}</Badge>
        <span className="font-medium">{event.event_type}</span>
        <Badge tone={event.status === 'resolved' ? 'positive' : 'neutral'}>
          {humanise(event.status)}
        </Badge>
        <span className="text-[11.5px] text-ink-faint">
          {formatDateTime(event.occurred_at)} · source: {event.source}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px]">{event.summary}</p>
      {event.status === 'resolved' && (
        <p className="mt-1 text-[11.5px] text-ink-faint">
          Resolved {formatDateTime(event.resolved_at)} — {event.resolution_note}
        </p>
      )}
      {!readOnly && event.status !== 'resolved' && (
        <div className="mt-2">
          {resolving ? (
            <form
              className="space-y-2"
              onSubmit={(formEvent) => {
                formEvent.preventDefault()
                resolve.mutate()
              }}
            >
              <textarea
                className="input min-h-[56px]"
                placeholder="Why is this event closed?"
                value={note}
                onChange={(changeEvent) => setNote(changeEvent.target.value)}
                required
                maxLength={2000}
              />
              {resolve.isError && <ErrorState error={resolve.error} />}
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={!note.trim() || resolve.isPending}>
                  {resolve.isPending ? 'Resolving…' : 'Confirm resolution'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setResolving(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setResolving(true)}>
              Resolve with a reason
            </button>
          )}
        </div>
      )}
    </li>
  )
}
