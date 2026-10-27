import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { MetaConnection, MetaConnectionAutomation } from '../../lib/types'
import { Badge, ErrorState } from '../ui'

/** O3. Absent on an older response: both switches off, which is what the server stores by default. */
export function automationOf(connection: MetaConnection): MetaConnectionAutomation {
  return (
    connection.automation ?? {
      auto_discovery_enabled: false,
      auto_import_enabled: false,
      enabled_by: null,
      enabled_at: null,
      eligible: false,
      ineligible_reason: null,
    }
  )
}

/** Why the sweep could not read this connection, in a sentence. `null` when it could. */
export function ineligibleText(reason: MetaConnectionAutomation['ineligible_reason']): string | null {
  if (reason === 'not_production')
    return 'Only a Production connection can run automatically. Fake and sandbox connections never reach Meta, so automating them would import made-up data.'
  if (reason === 'business_manager_not_configured')
    return 'No Business Manager is set for this connection or on the server, so there is nothing to read.'
  if (reason === 'reader_not_configured')
    return 'The server has no reader credential for this Business Manager. The switch can be set now, but nothing will be read until one is configured.'
  if (reason === 'archived') return 'This connection is archived.'
  return null
}

/** The card-title badge. Neutral/info only: "automatic" is a mode, never a good or safe state. */
export function AutomationBadge({ automation }: { automation: MetaConnectionAutomation }) {
  if (!automation.auto_discovery_enabled) return null
  return (
    <Badge tone="info" title="The discovery sweep reads this connection on a schedule">
      {automation.auto_import_enabled ? 'Auto + import' : 'Auto'}
    </Badge>
  )
}

export function AutomationControls({ connection }: { connection: MetaConnection }) {
  const queryClient = useQueryClient()
  const current = automationOf(connection)
  const [draft, setDraft] = useState<{ discovery: boolean; imports: boolean } | null>(null)
  const save = useMutation({
    mutationFn: (next: { discovery: boolean; imports: boolean }) =>
      api.patch<MetaConnection>(`/api/v1/meta-connections/${connection.id}/automation`, {
        auto_discovery_enabled: next.discovery,
        auto_import_enabled: next.imports,
      }),
    onSuccess: () => {
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
    },
  })

  const state = draft ?? { discovery: current.auto_discovery_enabled, imports: current.auto_import_enabled }
  // Turning anything on needs Production; turning things off is always allowed.
  const locked = current.ineligible_reason === 'not_production' || current.ineligible_reason === 'archived'
  const reason = ineligibleText(current.ineligible_reason)
  const turningImportOn = state.imports && !current.auto_import_enabled

  return (
    <div className="rounded-md border border-line p-2.5">
      <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">Scheduled discovery</p>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.discovery}
          disabled={save.isPending || (locked && !state.discovery)}
          onChange={(event) =>
            setDraft({ discovery: event.target.checked, imports: event.target.checked ? state.imports : false })
          }
        />
        <span>
          Discover automatically
          <span className="block text-[11px] text-ink-faint">
            About once a day, read this Business Manager&apos;s ad accounts and Pixels — read-only,
            the same discovery as the button. Only runs when the server&apos;s release has the
            sweep switched on.
          </span>
        </span>
      </label>
      <label className="mt-1.5 flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.imports}
          disabled={save.isPending || !state.discovery || (locked && !state.imports)}
          onChange={(event) => setDraft({ discovery: state.discovery, imports: event.target.checked })}
        />
        <span>
          Also add new ad accounts to the registry
          <span className="block text-[11px] text-ink-faint">
            Each account a scheduled run returns and the registry does not hold is added, one audit
            record each. Archived accounts are never re-added or restored, and nothing is ever
            archived automatically.
          </span>
        </span>
      </label>

      {reason && <p className="mt-1.5 text-[11px] text-amber-700">{reason}</p>}
      {current.auto_discovery_enabled && current.enabled_at && (
        <p className="mt-1.5 text-[11px] text-ink-faint">Switched on {formatDateTime(current.enabled_at)}.</p>
      )}

      {draft && (
        <div className="mt-2 space-y-1.5">
          {turningImportOn && (
            <p className="text-[11px] text-amber-700">
              Added accounts cannot be deleted from the registry afterwards — only archived. Nothing
              in Meta is created, shared or changed.
            </p>
          )}
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate(state)}
            >
              {save.isPending ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {save.isError && <ErrorState error={save.error} />}
    </div>
  )
}
