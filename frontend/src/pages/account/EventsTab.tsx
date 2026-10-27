import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AccountEvent, AdAccount } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Field } from '../../components/primitives/field'
import { EmptyState, ErrorState } from '../../components/states'
import { severityTone } from '../../lib/readiness'
import { formatDateTime } from '../../lib/format'
import { useEnumLabel } from '../../i18n/labels'
import { useI18n } from '../../i18n'
import { Panel, TabSkeleton } from './parts'

export default function EventsTab({ account, onChanged }: { account: AdAccount; onChanged: () => void }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const typeId = useId()
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
  const editable = account.archived_at === null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
      <Panel title={t('ev.timeline.title')}>
        {events.isLoading ? (
          <TabSkeleton cards={1} />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} title={t('ev.error.title')} compact />
        ) : events.data!.length === 0 ? (
          <EmptyState
            className="py-8"
            title={t('ev.empty.title')}
            description={editable ? t('ev.empty.body') : t('ev.empty.archived')}
            action={
              editable ? (
                <Button variant="secondary" size="sm" onClick={() => document.getElementById(typeId)?.focus()}>
                  {t('ev.empty.action')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {events.data!.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                readOnly={!editable}
                onChanged={() => {
                  onChanged()
                  void events.refetch()
                }}
              />
            ))}
          </ul>
        )}
      </Panel>

      {editable && (
        <Panel title={t('ev.form.title')}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <Field label={t('ev.type')} required htmlFor={typeId}>
              <input
                id={typeId}
                className="input"
                placeholder="billing_issue, policy_notice, …"
                value={form.event_type}
                onChange={(event) => setForm({ ...form, event_type: event.target.value })}
                required
                maxLength={120}
              />
            </Field>
            <Field label={t('ev.severity')} required hint={t('ev.severityHint')}>
              <select
                className="input"
                value={form.severity}
                onChange={(event) => setForm({ ...form, severity: event.target.value })}
              >
                <option value="info">{enumLabel('severity', 'info')}</option>
                <option value="warning">{enumLabel('severity', 'warning')}</option>
                <option value="critical">{enumLabel('severity', 'critical')}</option>
              </select>
            </Field>
            <Field label={t('ev.summary')} required>
              <textarea
                className="input min-h-[80px]"
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                required
                maxLength={5000}
              />
            </Field>
            {create.isError && <ErrorState error={create.error} compact />}
            <Button
              type="submit"
              className="w-full"
              disabled={create.isPending || !form.event_type.trim() || !form.summary.trim()}
            >
              {create.isPending ? t('ev.submitting') : t('ev.submit')}
            </Button>
          </form>
        </Panel>
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
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const noteId = useId()
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
        <Badge tone={severityTone(event.severity)}>{enumLabel('severity', event.severity)}</Badge>
        {/* The event type is a free label typed by the person who recorded it: shown as typed. */}
        <span className="font-medium">{event.event_type}</span>
        <Badge tone={event.status === 'resolved' ? 'positive' : 'neutral'}>{enumLabel('eventStatus', event.status)}</Badge>
        <span className="text-xs text-ink-muted tabular-nums">
          {t('ev.meta', { time: formatDateTime(event.occurred_at), source: enumLabel('eventSource', event.source) })}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm">{event.summary}</p>
      {event.status === 'resolved' && (
        <p className="mt-1 text-xs text-ink-muted tabular-nums">
          {t('ev.resolvedAt', { time: formatDateTime(event.resolved_at), note: event.resolution_note ?? '—' })}
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
              <label className="sr-only" htmlFor={noteId}>
                {t('ev.resolve.placeholder')}
              </label>
              <textarea
                id={noteId}
                className="input min-h-[56px]"
                placeholder={t('ev.resolve.placeholder')}
                value={note}
                onChange={(changeEvent) => setNote(changeEvent.target.value)}
                required
                maxLength={2000}
              />
              {resolve.isError && <ErrorState error={resolve.error} compact />}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!note.trim() || resolve.isPending}>
                  {resolve.isPending ? t('ev.resolve.working') : t('ev.resolve.confirm')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setResolving(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setResolving(true)}>
              {t('ev.resolve.start')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
