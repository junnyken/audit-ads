import { describe, expect, it } from 'vitest'
import { freshnessText } from '../pages/account/OverviewTab'
import type { ImportProvenance } from '../lib/types'

const IMPORTED: ImportProvenance = {
  discovery_run_id: '8d153a28-4d3b-4a2e-a2f3-4e2414653127',
  business_manager_reference: '1993884657458857',
  source_edge: 'owned_ad_accounts',
  imported_at: '2026-09-14T06:15:51Z',
}

describe('what a never-synced account is told about itself', () => {
  it('still says nothing was fetched when nobody imported it', () => {
    // True, and unchanged: this is what A1 has always said about a record someone typed in.
    const text = freshnessText('unknown', null)

    expect(text).toContain('operator-entered records only')
    expect(text).toContain('nothing here was fetched from a platform')
  })

  it('stops claiming nothing was fetched for an imported account', () => {
    // The defect. An imported account's name and external ID came from Meta's owned_ad_accounts
    // edge; saying nothing was fetched is false. "Never synced" stays true, which is why the
    // wrong half survived — the sentence was half right.
    const text = freshnessText('unknown', IMPORTED)

    expect(text).not.toContain('nothing here was fetched from a platform')
    expect(text).not.toContain('operator-entered records only')
    expect(text).toContain('never been synced')
    expect(text).toContain('read-only discovery')
  })

  it('leaves the synced and stale sentences alone', () => {
    expect(freshnessText('current', IMPORTED)).toContain('synced recently')
    expect(freshnessText('stale', IMPORTED)).toContain('historical')
  })

  it('says nothing at all for a status it does not know', () => {
    expect(freshnessText('something-new', null)).toBe('')
  })
})
