import { describe, expect, it } from 'vitest'
import { BATCH_ITEM_STATUS_LABEL, batchItemStatusTone, UNLIMITED_RECORDS_NOTICE } from '../lib/meta'
import { TONE_CLASS } from '../lib/readiness'
import type { MetaBatchItemStatus } from '../lib/types'

describe('A7 batch item status presentation', () => {
  it('never styles unknown as positive — it needs reconciliation, not celebration', () => {
    expect(batchItemStatusTone('unknown')).not.toBe('positive')
    expect(TONE_CLASS[batchItemStatusTone('unknown')]).not.toMatch(/emerald/)
  })

  it('only succeeded is styled positive', () => {
    const statuses: MetaBatchItemStatus[] = ['queued', 'running', 'succeeded', 'failed', 'unknown']
    for (const status of statuses) {
      const tone = batchItemStatusTone(status)
      if (status === 'succeeded') expect(tone).toBe('positive')
      else expect(tone).not.toBe('positive')
    }
  })

  it('every status has a human label', () => {
    const statuses: MetaBatchItemStatus[] = ['queued', 'running', 'succeeded', 'failed', 'unknown']
    for (const status of statuses) {
      expect(BATCH_ITEM_STATUS_LABEL[status]).toBeTruthy()
    }
  })

  it('the unlimited-records notice states Meta limits still apply, never that they do not', () => {
    expect(UNLIMITED_RECORDS_NOTICE).toMatch(/still apply/i)
    expect(UNLIMITED_RECORDS_NOTICE).not.toMatch(/no limit/i)
  })
})
