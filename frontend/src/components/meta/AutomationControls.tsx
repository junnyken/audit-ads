import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { MetaConnection, MetaConnectionAutomation } from '../../lib/types'
import { getActiveLanguage, translate, useI18n } from '../../i18n'
import type { Language, TranslationKey } from '../../i18n'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { ConfirmDialog, ReadBackNote, type ReadBack } from './confirm'

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
export function ineligibleText(
  reason: MetaConnectionAutomation['ineligible_reason'],
  language: Language = getActiveLanguage(),
): string | null {
  if (!reason) return null
  return translate(language, `auto.ineligible.${reason}` as TranslationKey)
}

/** The card-title badge. Neutral/info only: "automatic" is a mode, never a good or safe state. */
export function AutomationBadge({ automation }: { automation: MetaConnectionAutomation }) {
  const { t } = useI18n()
  if (!automation.auto_discovery_enabled) return null
  return (
    <Badge tone="info" title={t('auto.badgeTitle')}>
      {automation.auto_import_enabled ? t('auto.badgeImport') : t('auto.badge')}
    </Badge>
  )
}

interface Switches {
  discovery: boolean
  imports: boolean
}

export function AutomationControls({ connection }: { connection: MetaConnection }) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const current = automationOf(connection)
  const [draft, setDraft] = useState<Switches | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const save = useMutation({
    mutationFn: (next: Switches) =>
      api.patch<MetaConnection>(`/api/v1/meta-connections/${connection.id}/automation`, {
        auto_discovery_enabled: next.discovery,
        auto_import_enabled: next.imports,
      }),
  })

  const state: Switches = draft ?? {
    discovery: current.auto_discovery_enabled,
    imports: current.auto_import_enabled,
  }
  // Turning anything on needs Production; turning things off is always allowed.
  const locked = current.ineligible_reason === 'not_production' || current.ineligible_reason === 'archived'
  const reason = ineligibleText(current.ineligible_reason, language)
  const turningImportOn = state.imports && !current.auto_import_enabled
  const onOff = (value: boolean) => (value ? t('auto.on') : t('auto.off'))

  /** Writes, then asks the server again and reports what it now holds. */
  async function apply() {
    const requested = state
    const saved = await save.mutateAsync(requested)
    await queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
    await queryClient.invalidateQueries({ queryKey: ['meta-connection', connection.id] })
    // The PATCH response is the server's own statement of what it stored.
    const stored = automationOf(saved)
    const ok =
      stored.auto_discovery_enabled === requested.discovery && stored.auto_import_enabled === requested.imports
    setReadBack({
      ok,
      text: t(ok ? 'auto.readback.ok' : 'auto.readback.mismatch', {
        discover: onOff(stored.auto_discovery_enabled),
        imports: onOff(stored.auto_import_enabled),
      }),
    })
    setDraft(null)
  }

  const effects: string[] = []
  if (state.discovery) effects.push(t('auto.dialog.effectOn'))
  else effects.push(t('auto.dialog.effectOff'))
  if (turningImportOn) effects.push(t('auto.dialog.importOn'))
  effects.push(t('auto.dialog.discoverLine', { from: onOff(current.auto_discovery_enabled), to: onOff(state.discovery) }))
  effects.push(t('auto.dialog.importLine', { from: onOff(current.auto_import_enabled), to: onOff(state.imports) }))

  const idPrefix = `auto-${connection.id}`

  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <p className="text-xs font-medium text-ink-muted">{t('auto.title')}</p>
      <div className="flex items-start gap-2 text-sm">
        <input
          id={`${idPrefix}-discovery`}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={state.discovery}
          disabled={save.isPending || (locked && !state.discovery)}
          onChange={(event) =>
            setDraft({ discovery: event.target.checked, imports: event.target.checked ? state.imports : false })
          }
        />
        <label htmlFor={`${idPrefix}-discovery`}>
          {t('auto.discover')}
          <span className="block text-xs text-ink-faint">{t('auto.discoverHint')}</span>
        </label>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <input
          id={`${idPrefix}-import`}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={state.imports}
          disabled={save.isPending || !state.discovery || (locked && !state.imports)}
          onChange={(event) => setDraft({ discovery: state.discovery, imports: event.target.checked })}
        />
        <label htmlFor={`${idPrefix}-import`}>
          {t('auto.import')}
          <span className="block text-xs text-ink-faint">{t('auto.importHint')}</span>
        </label>
      </div>

      {reason && <p className="text-xs text-tone-caution-fg">{reason}</p>}
      {current.auto_discovery_enabled && current.enabled_at && (
        <p className="text-xs text-ink-faint">{t('auto.switchedOn', { time: formatDateTime(current.enabled_at, language) })}</p>
      )}

      {draft && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setReviewing(true)}>
            {t('auto.review')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>
            {t('auto.cancel')}
          </Button>
        </div>
      )}

      <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />

      <ConfirmDialog
        open={reviewing}
        onOpenChange={setReviewing}
        title={t('auto.dialog.title', { label: connection.label })}
        object={connection.label}
        effects={[...effects, t('auto.dialog.reversible')]}
        irreversible={null}
        confirmLabel={t('auto.dialog.confirm')}
        onConfirm={apply}
      />
    </div>
  )
}
