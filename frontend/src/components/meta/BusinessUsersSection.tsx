import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type {
  DiscoveredBusinessUserRow,
  DiscoveryBusinessUsersResult,
  Paged,
} from '../../lib/types'
import { useI18n } from '../../i18n'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { ErrorState } from '../states'
import { CoverageBadge } from './DiscoverySection'

function StatusBadge({ row }: { row: DiscoveredBusinessUserRow }) {
  const { t } = useI18n()
  if (row.status === 'linked') {
    return <Badge tone="positive">{t('fb.bu.status.linked')}</Badge>
  }
  if (row.status === 'missing_from_latest_discovery') {
    return <Badge tone="attention">{t('fb.bu.status.missing_from_latest_discovery')}</Badge>
  }
  if (row.status === 'admin_demoted') {
    return <Badge tone="attention">{t('fb.bu.status.admin_demoted')}</Badge>
  }
  return (
    <Badge tone={row.is_admin_drift ? 'attention' : 'caution'}>
      {t('fb.bu.status.unlinked')}
    </Badge>
  )
}

export function BusinessUsersSection({
  connectionId,
  runId,
  result,
}: {
  connectionId: string
  runId: string
  result: DiscoveryBusinessUsersResult
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [selectedByExtId, setSelectedByExtId] = useState<Record<string, string>>({})

  const profiles = useQuery({
    queryKey: ['facebook-accounts', 'picker'],
    queryFn: () =>
      api.get<Paged<{ id: string; label: string }>>('/api/v1/personal-account-references?page_size=100'),
  })

  const confirmLink = useMutation({
    mutationFn: (vars: { external_user_id: string; personal_account_reference_id: string }) =>
      api.post(
        `/api/v1/meta-connections/${connectionId}/discoveries/${runId}/business-user-links`,
        vars,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery', connectionId] })
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-accounts'] })
    },
  })

  const rows = result.reconciliation ?? []
  const count = result.coverage?.total_unique_assets ?? rows.length
  const hasDrift = rows.some((r) => r.status !== 'linked')
  const availableProfiles = profiles.data?.items ?? []

  return (
    <div
      className="space-y-3 rounded-md border border-line p-3"
      data-testid="business-users-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('fb.bu.title', { n: count })}</span>
        <CoverageBadge status={result.coverage_status} />
      </div>

      {hasDrift && (
        <div
          role="status"
          className="rounded border border-tone-caution-line bg-tone-caution-bg px-3 py-2 text-xs text-tone-caution-fg"
        >
          {t('fb.bu.driftBanner')}
        </div>
      )}

      {confirmLink.isError && (
        <ErrorState error={confirmLink.error} title={t('disc.startFailed')} compact />
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-ink-faint">{t('fb.bu.empty')}</p>
      ) : (
        <ul className="divide-y divide-line text-xs">
          {rows.map((row) => {
            const chosenId = selectedByExtId[row.external_user_id] ?? ''
            const busy =
              confirmLink.isPending &&
              confirmLink.variables?.external_user_id === row.external_user_id
            return (
              <li
                key={`${row.external_user_id}-${row.status}`}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {row.display_name || t('meta.noName')}
                    </span>
                    <span className="font-mono text-2xs text-ink-faint">
                      {row.external_user_id}
                    </span>
                    <Badge tone={row.role === 'ADMIN' ? 'info' : 'neutral'}>{row.role}</Badge>
                    <StatusBadge row={row} />
                  </div>
                  {row.detail && <p className="text-2xs text-ink-muted">{row.detail}</p>}
                  {row.linked_identity && (
                    <p className="text-2xs text-ink-muted">
                      <Link
                        to={`/facebook-accounts/${row.linked_identity.id}`}
                        className="font-medium text-brand-text hover:underline"
                      >
                        {row.linked_identity.label}
                      </Link>
                      {row.linked_identity.owner_member_name
                        ? ` · ${t('fb.login.holder', { name: row.linked_identity.owner_member_name })}`
                        : ''}
                    </p>
                  )}
                </div>

                {row.status === 'unlinked' && (
                  <div className="flex flex-wrap items-center gap-2">
                    {row.suggested_identity && (
                      <div className="flex flex-wrap items-center gap-1.5 rounded border border-line bg-surface-muted px-2 py-1">
                        <span className="text-2xs text-ink-muted">
                          {t('fb.bu.suggested', { label: row.suggested_identity.label })}
                        </span>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            confirmLink.mutate({
                              external_user_id: row.external_user_id,
                              personal_account_reference_id: row.suggested_identity!.id,
                            })
                          }
                        >
                          {busy ? t('fb.bu.confirming') : t('fb.bu.confirmSuggested')}
                        </Button>
                      </div>
                    )}

                    {availableProfiles.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label={t('fb.bu.selectProfile')}
                          className="h-7 rounded border border-line bg-surface px-2 text-xs text-ink"
                          value={chosenId}
                          onChange={(e) =>
                            setSelectedByExtId((prev) => ({
                              ...prev,
                              [row.external_user_id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">{t('fb.bu.selectProfile')}</option>
                          {availableProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        {chosenId && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              confirmLink.mutate({
                                external_user_id: row.external_user_id,
                                personal_account_reference_id: chosenId,
                              })
                            }
                          >
                            {busy ? t('fb.bu.confirming') : t('fb.bu.confirmSelected')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
