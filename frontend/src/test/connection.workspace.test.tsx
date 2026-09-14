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

  it('states the edge exactly once — found on a real screen, not by a test', () => {
    // Shipped defect, seen 2026-09-14 in the first browser use of this tab: every row read
    // "Returned by Owned accounts · Returned by owned_ad_accounts." The server's `detail` repeated
    // in prose what `source_edge` now carries as data, and this component rendered both — the same
    // fact twice, once translated and once raw. `detail` is empty for these rows now.
    const { container } = render(
      <AssetInventory
        result={result({
          reconciliation: [row({ external_id: '111', source_edge: 'owned_ad_accounts', detail: null })],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(container.textContent!.match(/Returned by Owned accounts/g)).toHaveLength(1)
    expect(container.textContent).not.toContain('owned_ad_accounts')
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

    // Only the absent row is offered the action; the matched one has nothing to import.
    const buttons = screen.getAllByRole('button', { name: 'Add to registry' })
    expect(buttons).toHaveLength(1)

    // Two steps since the confirmation was added — the offer, then the decision.
    fireEvent.click(buttons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onImport).toHaveBeenCalledWith('111')
  })

  it('asks once before importing, and says what cannot be taken back', () => {
    const onImport = vi.fn()
    render(
      <AssetInventory
        result={result({
          reconciliation: [row({ external_id: '111', display_name: 'Not here yet' })],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
        onImport={onImport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add to registry' }))

    // Nothing has been imported yet — the first click only asks.
    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByText(/Nothing in Meta is created, shared or changed/)).toBeTruthy()
    expect(screen.getByText(/cannot be deleted afterwards — only archived/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onImport).toHaveBeenCalledWith('111')
  })

  it('imports nothing when the operator cancels', () => {
    const onImport = vi.fn()
    render(
      <AssetInventory
        result={result({ reconciliation: [row({ external_id: '111' })] })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
        onImport={onImport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add to registry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add to registry' })).toBeTruthy()
    expect(screen.queryByText(/cannot be deleted afterwards/)).toBeNull()
  })

  it('asks about one row at a time', () => {
    const onImport = vi.fn()
    render(
      <AssetInventory
        result={result({
          reconciliation: [row({ external_id: '111' }), row({ external_id: '222' })],
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
        onImport={onImport}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Add to registry' })[0])

    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Add to registry' })).toHaveLength(1)
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

// ------------------------------------------------------- O2.1 B3: every coverage state on screen

describe('every coverage state is distinguishable on screen', () => {
  // Audited 2026-09-14: "Partial", "Not attempted" and "Unknown" were rendered by CoverageBadge
  // but no test had ever asserted that they reach the screen. A label can be deleted, renamed or
  // silently lost to a colourless class (this project has had exactly that bug with
  // `text-attention`) and every suite would still pass.
  function withCoverage(status: DiscoveryAssetResult['coverage_status'], complete: boolean) {
    return result({ coverage_status: status, complete, reconciliation: [] })
  }

  const CASES: [DiscoveryAssetResult['coverage_status'], string][] = [
    ['complete', 'Complete'],
    ['partial', 'Partial'],
    ['incomplete', 'Incomplete'],
    ['unknown', 'Unknown'],
    ['stale', 'Stale'],
    ['not_attempted', 'Not attempted'],
  ]

  /** The status filter is a <select>, and "Unknown" is both a coverage status and a reconciliation
   * status — so the word legitimately appears twice on this screen, once as a badge and once as a
   * dropdown option. Asserting the badge means excluding the option rather than loosening the
   * assertion to "appears somewhere". */
  function badgeText(label: string): HTMLElement[] {
    return screen.getAllByText(label).filter((el) => el.tagName !== 'OPTION')
  }

  it.each(CASES)('renders %s as "%s"', (status, label) => {
    render(
      <AssetInventory
        result={withCoverage(status, status === 'complete')}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    expect(badgeText(label)).toHaveLength(1)
  })

  it('withholds the missing conclusion for every state except complete and not_attempted', () => {
    // `not_attempted` is excluded deliberately: nothing was read, so there is no shortfall to
    // explain — the badge alone says it. Every other non-complete state must say why no record is
    // being called missing.
    for (const status of ['partial', 'incomplete', 'unknown', 'stale'] as const) {
      const { unmount } = render(
        <AssetInventory
          result={withCoverage(status, false)}
          edge="all"
          status="all"
          onEdgeChange={noop}
          onStatusChange={noop}
        />,
      )
      expect(
        screen.getByText(/No internal record is classified as missing from this run/),
      ).toBeTruthy()
      unmount()
    }
  })

  it('never renders a not-attempted edge as a bare zero', () => {
    render(
      <AssetInventory
        result={result({
          coverage_status: 'incomplete',
          complete: false,
          reconciliation: [],
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 5, error_code: null },
              client_ad_accounts: { required: true, status: 'not_attempted', pages: 0, items: 0, error_code: null },
            },
            total_unique_assets: 5,
          },
        })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
      />,
    )

    // The edge that was never read says so in words; it must not be shown as "0 items", which
    // reads as "this edge returned nothing" — a different and much stronger claim.
    expect(screen.getByText(/not attempted/)).toBeTruthy()
    expect(screen.queryByText(/Client accounts[\s\S]*0 items/)).toBeNull()
  })
})

// ----------------------------------------------------------------- O2.1 B4: authority on screen

describe('an empty inventory never speaks for the Business Manager', () => {
  it('shows the caveat and claims no coverage when authority was not established', () => {
    // The exact defect A10.3 exists to prevent, asserted at the screen rather than in the engine:
    // measured on real Meta, a token with no role in a BM still reads its node and every asset
    // edge answers 200 with an empty list.
    render(
      <AssetInventory
        result={result({
          coverage_status: 'unknown',
          complete: false,
          reconciliation: [],
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
              client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
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

    expect(screen.getAllByText('Unknown').filter((el) => el.tagName !== 'OPTION')).toHaveLength(1)
    expect(screen.queryByText('Complete')).toBeNull()
    expect(
      screen.getByText(/No internal record is classified as missing from this run/),
    ).toBeTruthy()
    expect(screen.getByText(/could not be established/)).toBeTruthy()
  })
})

// ------------------------------------------------------------- O2.1 B6: the Pixel asymmetry text

describe('the Pixel limitation is still stated after O1.1 refactored this surface', () => {
  it('says a registry Pixel cannot be evaluated for absence from one Business Manager', () => {
    // Zero test references before 2026-09-14. A `Pixel` has no Business Manager relationship in
    // the A1 schema, so its absence from one BM's discovery is not evidence about that BM. If this
    // sentence disappears, the product starts implying a conclusion the schema cannot support.
    render(
      <AssetInventory
        result={result({ reconciliation: [] })}
        edge="all"
        status="all"
        onEdgeChange={noop}
        onStatusChange={noop}
        emptyNote="Pixel Business Manager mapping is not recorded yet, so a registry Pixel cannot be evaluated for absence from this Business Manager."
      />,
    )

    expect(
      screen.getByText(/cannot be evaluated for absence from this Business Manager/),
    ).toBeTruthy()
  })
})
