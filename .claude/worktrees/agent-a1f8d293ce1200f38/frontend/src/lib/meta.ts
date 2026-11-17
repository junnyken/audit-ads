import type { Tone } from './readiness'
import type { MetaBatchItemStatus } from './types'

/** Same `Tone` system as `lib/readiness.ts`/`lib/health.ts` — `unknown` is never green. */
export function batchItemStatusTone(status: MetaBatchItemStatus): Tone {
  switch (status) {
    case 'succeeded':
      return 'positive'
    case 'failed':
      return 'attention'
    case 'running':
      return 'info'
    case 'unknown':
      return 'caution'
    default:
      return 'neutral'
  }
}

export const BATCH_ITEM_STATUS_LABEL: Record<MetaBatchItemStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  unknown: 'Unknown — needs reconciliation',
}

export const UNLIMITED_RECORDS_NOTICE =
  'Unlimited internal records. Meta creation, sharing, rate, billing, and permission limits still apply.'
