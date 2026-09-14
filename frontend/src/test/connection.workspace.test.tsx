import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AssetInventory, filterRows } from '../components/meta/AssetInventory'
import { DiscoveryHistoryList } from '../pages/meta-connection/HistoryTab'
import type { DiscoveryAssetResult, DiscoveryRunSummary, ReconciliationRow } from '../lib/types'

function row(overrides: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    external_id: '111',
    internal_entity_id: null,
    display_name: 'An account',
    status: 'missing_in_registry',
    detail: null,
    source_edge: 'owned_ad_accounts',
    ...overrides,
  }
}

function result(overrides: Partial<DiscoveryAssetResult> = {}): DiscoveryAssetResult {
  return {
    coverage_status: 'complete',
    complete: true,
    required_edges: ['owned_ad_accounts', 'client_ad_accounts'],
    coverage: {
      edges: {
        owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 1, error_code: null },
        client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 1, error_code: null },
      },
      total_unique_assets: 2,
    },
    reconciliation: [
      row({ external_id: '111', display_name: 'Owned one', source_edge: 'owned_ad_accounts' }),
      row({ external_id: '222', display_name: 'Client one', source_edge: 'client_ad_accounts' }),
    ],
    ...overrides,
  }
}

function noop() {}

describe('filtering by the edge that returned a row', () => {
  it('keeps only the rows that edge actually returned', () => {
    const rows = [
      row({ external_id: '111', source_edge: 'owned_ad_accounts' }),
      row({ external_id: '222', source_edge: 'client_ad_accounts' }),
    ]

    expect(filterRows(rows, 'client_ad_accounts', 'all').map((r) => r.external_id)).toEqual(['222'])
  })

  it('drops a row with no edge instead of assigning it to the selected one', () => {
    // A registry record no observation matched was not returned by any edge. Showing it under one
    // would assert a reading that never happened — the same class of error as calling an
    // unverified thing verified.
    const rows = [
      row({ external_id: '111', source_edge: 'owned_ad_accounts' }),
      row({
        external_id: '999',
        internal_entity_id: 'local-1',
        status: 'missing_from_latest_discovery',
        source_edge: null,
      }),
    ]

    expect(filterRows(rows, 'owned_ad_accounts', 'all').map((r) => r.external_id)).toEqual(['111'])
    expect(filterRows(rows, 'all', 'all')).toHaveLength(2)
  })

  it('combines the edge and the status filter', () => {
    const rows = [
      row({ external_id: '111', source_edge: 'owned_ad_accounts', status: 'matched' }),
      row({ external_id: '222', source_edge: 'owned_ad_accounts', status: 'missing_in_registry' }),
      row({ external_id: '333', source_edge: 'client_ad_accounts', status: 'matched' }),
    ]

    expect(filterRows(rows, 'owned_ad_accounts', 'matched').map((r) => r.external_id)).toEqual(['111'])
  })
})

describe('the inventory of one asset type', () => {
  it('states the edge for every row, in words the operator can read', () => {
    render(
      <AssetInventory
        result={result()}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(screen.getByText(/Returned by Owned accounts/)).toBeTruthy()
    expect(screen.getByText(/Returned by Client accounts/)).toBeTruthy()
  })

  it('says plainly when a row came from no observation rather than leaving it blank', () => {
    render(
      <AssetInventory
        result={result({
          reconciliation: [
            row({
              external_id: '999',
              internal_entity_id: 'local-1',
              display_name: 'Only in the registry',
              status: 'missing_from_latest_discovery',
              source_edge: null,
            }),
          ],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(
      screen.getByText(/No observation from this run matched this internal record/),
    ).toBeTruthy()
  })

  it('never lets an incomplete read look like an empty Business Manager', () => {
    render(
      <AssetInventory
        result={result({
          coverage_status: 'incomplete',
          complete: false,
          reconciliation: [],
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
              client_ad_accounts: {
                required: true,
                status: 'failed',
                pages: 0,
                items: 0,
                error_code: 'permission_missing',
              },
            },
            total_unique_assets: 0,
          },
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(screen.getByText('Incomplete')).toBeTruthy()
    expect(screen.getByText(/permission_missing/)).toBeTruthy()
    expect(
      screen.getByText(/No internal record is classified as missing from this run/),
    ).toBeTruthy()
  })

  it('says an empty filter result is about the filter, not about the Business Manager', () => {
    render(
      <AssetInventory
        result={result()}
        edge="adspixels"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(screen.getByText(/statement about the filter, not about the Business Manager/)).toBeTruthy()
  })

  it('offers Add to registry only on a row that is actually absent from the registry', () => {
    const onImport = vi.fn()
    render(
      <AssetInventory
        result={result({
          reconciliation: [
            row({ external_id: '111', display_name: 'Not here yet', status: 'missing_in_registry' }),
            row({
              external_id: '222',
              internal_entity_id: 'local-2',
              display_name: 'Already here',
              status: 'matched',
            }),
          ],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
        onImport={onImport}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: 'Add to registry' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onImport).toHaveBeenCalledWith('111')
  })

  it('offers no import at all when the caller supplies none — Pixels have nothing to import into', () => {
    render(
      <AssetInventory
        result={result({
          reconciliation: [row({ external_id: '555', display_name: 'A pixel', source_edge: 'adspixels' })],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Add to registry' })).toBeNull()
  })

  it('reports how many rows the filter is hiding', () => {
    render(
      <AssetInventory
        result={result()}
        edge="owned_ad_accounts"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(screen.getByText('Showing 1 of 2')).toBeTruthy()
  })
})

// --------------------------------------------------------------------- discovery history

function runSummary(overrides: Partial<DiscoveryRunSummary> = {}): DiscoveryRunSummary {
  return {
    id: 'run-1',
    status: 'succeeded',
    trigger: 'manual',
    environment: 'production',
    business_manager: { reference: '1993884657458857', name: 'Quảng Cáo Top' },
    read_as: { external_id: '61580000000000', name: 'adsops-admin' },
    business_authority: 'established',
    started_at: '2026-09-13T03:00:00+00:00',
    completed_at: '2026-09-13T03:00:04+00:00',
    freshness: 'current',
    failure_code: null,
    failure_summary: null,
    ad_accounts: {
      coverage_status: 'complete',
      complete: true,
      required_edges: ['owned_ad_accounts', 'client_ad_accounts'],
      coverage: {
        edges: {
          owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 5, error_code: null },
          client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 3, error_code: null },
        },
        total_unique_assets: 8,
      },
    },
    pixels: {
      coverage_status: 'complete',
      complete: true,
      required_edges: ['adspixels'],
      coverage: {
        edges: { adspixels: { required: true, status: 'completed', pages: 1, items: 7, error_code: null } },
        total_unique_assets: 7,
      },
    },
    ...overrides,
  }
}

describe('the discovery history of one connection', () => {
  it('shows each run with what it was able to see, not just its counts', () => {
    render(<DiscoveryHistoryList runs={[runSummary()]} />)

    expect(screen.getByText(/Ad accounts: 8/)).toBeTruthy()
    expect(screen.getByText(/Pixels: 7/)).toBeTruthy()
    expect(screen.getAllByText('Complete')).toHaveLength(2)
    expect(screen.getByText(/read as adsops-admin/)).toBeTruthy()
  })

  it('keeps each run on its own coverage — an older complete run must not vouch for a newer one', () => {
    render(
      <DiscoveryHistoryList
        runs={[
          runSummary({
            id: 'run-2',
            ad_accounts: {
              coverage_status: 'incomplete',
              complete: false,
              required_edges: ['owned_ad_accounts', 'client_ad_accounts'],
              coverage: {
                edges: {
                  owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 5, error_code: null },
                  client_ad_accounts: { required: true, status: 'not_attempted', pages: 0, items: 0, error_code: null },
                },
                total_unique_assets: 5,
              },
            },
          }),
          runSummary({ id: 'run-1' }),
        ]}
      />,
    )

    expect(screen.getByText('Incomplete')).toBeTruthy()
    expect(screen.getByText(/Client accounts \(not attempted\)/)).toBeTruthy()
    // The older run keeps its own two Complete badges; nothing was flattened into one verdict.
    expect(screen.getAllByText('Complete')).toHaveLength(3)
  })

  it('marks a run that could not prove access, so its empty result is never read as an empty BM', () => {
    render(
      <DiscoveryHistoryList
        runs={[runSummary({ business_authority: 'not_established' })]}
      />,
    )

    expect(screen.getByText('Access to the Business Manager not established')).toBeTruthy()
  })

  it('marks fake data as fake so it is never mistaken for a real reading', () => {
    render(<DiscoveryHistoryList runs={[runSummary({ environment: 'fake' })]} />)

    expect(screen.getByText('Fake data')).toBeTruthy()
  })

  it('states the failure of a failed run instead of showing it as an ordinary empty one', () => {
    render(
      <DiscoveryHistoryList
        runs={[
          runSummary({
            status: 'failed',
            failure_code: 'permission_missing',
            failure_summary: 'The identity is not allowed to read this Business Manager.',
          }),
        ]}
      />,
    )

    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText(/permission_missing/)).toBeTruthy()
  })

  it('says the time was not recorded rather than inventing one', () => {
    render(
      <DiscoveryHistoryList runs={[runSummary({ completed_at: null, started_at: null })]} />,
    )

    expect(screen.getByText('Time not recorded')).toBeTruthy()
  })

  it('carries no reconciliation — today\'s registry never stands beside an old reading', () => {
    const { container } = render(<DiscoveryHistoryList runs={[runSummary()]} />)

    expect(container.textContent).not.toContain('Not in registry')
    expect(container.textContent).not.toContain('Add to registry')
    expect(container.textContent).toContain('recomputed')
  })
})
