import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { DiscoveryRun } from '../../lib/types'
import { useI18n, type TranslationKey } from '../../i18n'
import type { ReadBack } from './confirm'

/**
 * The registry import of one discovered ad account, with the read-back that skill 6.4 asks for.
 *
 * The run id is in the path, not "latest": the operator is acting on the result in front of them,
 * and a run that completed between rendering and clicking must not silently become the evidence
 * for a write. After the write the discovery is re-read (reconciliation is recomputed against the
 * registry as it is now) and the row is reported as the server now says — `matched` is the only
 * answer that counts as added.
 */
export function useImportAccount(connectionId: string, run: DiscoveryRun | null | undefined, latestKey: unknown[]) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const post = useMutation({
    mutationFn: (externalId: string) =>
      api.post(`/api/v1/meta-connections/${connectionId}/discoveries/${run?.id}/imports`, {
        external_account_id: externalId,
      }),
  })

  async function importAccount(externalId: string, name: string): Promise<void> {
    setImportingId(externalId)
    try {
      await post.mutateAsync(externalId)
      // The record now exists on these pages; leaving them stale would show an empty registry
      // seconds after an import said it succeeded.
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery-summary'] })
      // Awaited: the dialog stays open until the discovery has been read again.
      await queryClient.invalidateQueries({ queryKey: latestKey })
      const fresh = queryClient.getQueryData<DiscoveryRun | null>(latestKey)
      const row = fresh?.ad_accounts.reconciliation.find((candidate) => candidate.external_id === externalId)
      const status = row?.status ?? 'unknown'
      const label = t(`recon.${status}` as TranslationKey)
      setReadBack({
        ok: status === 'matched',
        text:
          status === 'matched'
            ? t('import.readback.ok', { name, id: externalId, status: label })
            : t('import.readback.mismatch', { name, id: externalId, status: label }),
      })
    } finally {
      setImportingId(null)
    }
  }

  return { importAccount, importingId, readBack, clearReadBack: () => setReadBack(null) }
}
