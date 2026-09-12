import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiscoveryOverviewTable } from '../components/meta/DiscoveryOverview'
import type { DiscoverySummaryRow } from '../lib/types'

function row(overrides: Partial<DiscoverySummaryRow> = {}): DiscoverySummaryRow {
  return {
    connection_id: 'conn-1',
    connection_label: 'Production connection',
    environment: 'production',
    run: {
      id: 'run-1',
      status: 'succeeded',
      business_manager: { reference: '1993884657458857', name: 'Quảng Cáo Top' },
      read_as: { external_id: '61580000000000', name: 'adsops-admin' },
      business_authority: 'established',
      completed_at: new Date().toISOString(),
      freshness: 'current',
      ad_accounts: {
        coverage_status: 'complete',
        count: 8,
        edges: {
          owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 5, error_code: null },
          client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 3, error_code: null },
        },
      },
      pixels: {
        coverage_status: 'complete',
        count: 7,
        edges: {
          adspixels: { required: true, status: 'completed', pages: 1, items: 7, error_code: null },
        },
      },
    },
    ...overrides,
  }
}

describe('Business Manager discovery on the Overview', () => {
  it('shows each count with its coverage and the identity that read it', () => {
    render(<DiscoveryOverviewTable rows={[row()]} />)

    expect(screen.getByText('Quảng Cáo Top')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    // The reader travels with the number: the same BM returns fewer assets to a narrower
    // system user, so a count on its own would invite a false "assets disappeared".
    expect(screen.getByText('adsops-admin')).toBeTruthy()
    expect(screen.getAllByText('Complete').length).toBe(2)
    expect(screen.getByText(/5 owned · 3 client/)).toBeTruthy()
  })

  it('never dresses incomplete coverage as success', () => {
    render(
      <DiscoveryOverviewTable
        rows={[
          row({
            run: {
              ...row().run!,
              ad_accounts: {
                coverage_status: 'incomplete',
                count: 5,
                edges: {
                  owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 5, error_code: null },
                  client_ad_accounts: { required: true, status: 'failed', pages: 0, items: 0, error_code: 'permission_missing' },
                },
              },
            },
          }),
        ]}
      />,
    )

    expect(screen.getByText('Incomplete')).toBeTruthy()
    // Pixels were complete in this run; ad accounts were not. One Complete badge, not two.
    expect(screen.getAllByText('Complete').length).toBe(1)
  })

  it('keeps a connection that has never run instead of dropping it from the table', () => {
    render(<DiscoveryOverviewTable rows={[row({ run: null })]} />)

    // Falls back to the connection label, since no run has named the Business Manager yet.
    expect(screen.getByText('Production connection')).toBeTruthy()
    expect(screen.getByText('No discovery has been run yet.')).toBeTruthy()
    expect(screen.getByText('not configured')).toBeTruthy()
  })

  it('marks a stale run as stale next to its timestamp', () => {
    const base = row().run!
    render(
      <DiscoveryOverviewTable
        rows={[row({ run: { ...base, freshness: 'stale' } })]}
      />,
    )

    expect(screen.getByText('Stale')).toBeTruthy()
  })

  it('reads down a column with several Business Managers', () => {
    const base = row().run!
    render(
      <DiscoveryOverviewTable
        rows={[
          row(),
          row({
            connection_id: 'conn-2',
            connection_label: 'Client BM',
            run: {
              ...base,
              id: 'run-2',
              business_manager: { reference: '222', name: 'Agency Two' },
              read_as: { external_id: null, name: null },
              ad_accounts: { coverage_status: 'complete', count: 2, edges: {} },
            },
          }),
        ]}
      />,
    )

    expect(screen.getByText('Quảng Cáo Top')).toBeTruthy()
    expect(screen.getByText('Agency Two')).toBeTruthy()
    // An unnamed reader is stated, never left blank — a blank cell reads as "same as above".
    expect(screen.getByText('unknown identity')).toBeTruthy()
  })

  it('labels a fake connection so its invented numbers cannot read as an observation of Meta', () => {
    // Found in the browser: a `fake` row rendered identically to a real one — same Complete
    // badge, same column — and the local seed reuses the configured BM id, so two rows showed
    // one id under two names with nothing saying which was real.
    render(
      <DiscoveryOverviewTable
        rows={[
          row(),
          row({
            connection_id: 'conn-fake',
            environment: 'fake',
            run: { ...row().run!, business_manager: { reference: '1993884657458857', name: 'Fake Business Manager (local testing)' } },
          }),
        ]}
      />,
    )

    expect(screen.getByText('Fake data')).toBeTruthy()
    // Exactly one: the real production row must not be labelled fake.
    expect(screen.getAllByText('Fake data').length).toBe(1)
  })

  it('labels a sandbox connection distinctly from a fake one', () => {
    render(<DiscoveryOverviewTable rows={[row({ environment: 'sandbox' })]} />)

    expect(screen.getByText('Sandbox')).toBeTruthy()
    expect(screen.queryByText('Fake data')).toBeNull()
  })

  it('says an empty result came from a Business Manager it could not prove access to', () => {
    // Otherwise "0 · Unknown" reads as "this Business Manager is empty" — the false conclusion
    // the authority gate exists to prevent.
    render(
      <DiscoveryOverviewTable
        rows={[
          row({
            run: {
              ...row().run!,
              business_authority: 'not_established',
              ad_accounts: { coverage_status: 'unknown', count: 0, edges: {} },
              pixels: { coverage_status: 'unknown', count: 0, edges: {} },
            },
          }),
        ]}
      />,
    )

    expect(screen.getByText(/could not prove access to this Business Manager/)).toBeTruthy()
    expect(screen.queryByText('Complete')).toBeNull()
    expect(screen.queryByText(/a narrower identity would see less/)).toBeNull()
  })

  it('names two rows that carry the same Business Manager instead of letting them read as two', () => {
    // Live on 2026-09-11: two connections, labelled "Triều Shop" and "Quảng Cáo Top", both read
    // the one configured BM and both returned the same 8 accounts. Each row was true; together
    // they invited adding 8 and 8.
    render(
      <DiscoveryOverviewTable
        rows={[
          row({ connection_label: 'Quảng Cáo Top' }),
          row({ connection_id: 'conn-2', connection_label: 'Triều Shop' }),
        ]}
      />,
    )

    expect(screen.getAllByText('Same Business Manager as another row').length).toBe(2)
    // The label that differs is shown so the two rows can be told apart — but never in place of
    // the Business Manager that was actually read.
    expect(screen.getByText(/connection: Triều Shop/)).toBeTruthy()
    expect(screen.getAllByText('Quảng Cáo Top').length).toBe(2)
  })

  it('does not cry duplicate when each row carries its own Business Manager', () => {
    render(
      <DiscoveryOverviewTable
        rows={[
          row(),
          row({
            connection_id: 'conn-2',
            connection_label: 'Agency Two',
            run: { ...row().run!, business_manager: { reference: '222', name: 'Agency Two' } },
          }),
        ]}
      />,
    )

    expect(screen.queryByText('Same Business Manager as another row')).toBeNull()
  })

  it('says that discovery does not create records here', () => {
    render(<DiscoveryOverviewTable rows={[row()]} />)

    // Otherwise an empty Business Managers page next to "8 ad accounts" reads as a bug.
    expect(screen.getByText(/does not create records here/)).toBeTruthy()
  })
})
