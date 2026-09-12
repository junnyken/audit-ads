import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AssetResult } from '../components/meta/DiscoverySection'
import type { DiscoveryAssetResult } from '../lib/types'

function result(overrides: Partial<DiscoveryAssetResult> = {}): DiscoveryAssetResult {
  return {
    coverage_status: 'complete',
    complete: true,
    required_edges: ['owned_ad_accounts', 'client_ad_accounts'],
    coverage: {
      edges: {
        owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
        client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
      },
      total_unique_assets: 4,
    },
    reconciliation: [],
    ...overrides,
  }
}

describe('discovery coverage wording', () => {
  it('reports the count together with its coverage, never a bare number', () => {
    render(<AssetResult title="Ad accounts" result={result()} />)

    // "returned", not "discovered": the count is what this BM's edges gave back, not everything
    // that exists in Meta.
    expect(screen.getByText(/Ad accounts returned: 4/)).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(screen.getByText(/Owned accounts \(2\), Client accounts \(2\)/)).toBeTruthy()
  })

  it('names the edge that did not complete and withholds any missing conclusion', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          coverage_status: 'incomplete',
          complete: false,
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
              client_ad_accounts: {
                required: true,
                status: 'failed',
                pages: 0,
                items: 0,
                error_code: 'permission_missing',
              },
            },
            total_unique_assets: 2,
          },
        })}
      />,
    )

    expect(screen.getByText(/Client accounts \(permission_missing\)/)).toBeTruthy()
    expect(
      screen.getByText(/No internal record is classified as missing from this run/),
    ).toBeTruthy()
    // Incomplete coverage must never be dressed as success.
    expect(screen.queryByText('Complete')).toBeNull()
  })

  it('shows an edge that was never attempted rather than omitting it', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          coverage_status: 'incomplete',
          complete: false,
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
              client_ad_accounts: {
                required: true,
                status: 'not_attempted',
                pages: 0,
                items: 0,
                error_code: null,
              },
            },
            total_unique_assets: 2,
          },
        })}
      />,
    )

    expect(screen.getByText(/Client accounts \(not attempted\)/)).toBeTruthy()
  })

  it('describes an absent asset factually and never as deleted', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          reconciliation: [
            {
              external_id: '111',
              internal_entity_id: 'row-1',
              display_name: 'Thanh Công',
              status: 'missing_from_latest_discovery',
              detail: 'Not returned by the latest completed discovery.',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Not returned by the latest completed discovery')).toBeTruthy()
    const body = document.body.textContent ?? ''
    for (const forbidden of ['deleted', 'removed by Meta', 'lost', 'dead']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('renders a completed empty scan as complete rather than as a failure', () => {
    render(
      <AssetResult
        title="Pixels"
        result={result({
          required_edges: ['adspixels'],
          coverage: {
            edges: {
              adspixels: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
            },
            total_unique_assets: 0,
          },
        })}
      />,
    )

    expect(screen.getByText(/Pixels returned: 0/)).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(screen.queryByText(/No internal record is classified as missing/)).toBeNull()
  })

  it('gives the reason that actually applies, not one sentence for every shortfall', () => {
    // Seen live on an authority-blocked run: every required source WAS read and every one
    // answered, while the product said "not every required source was read". Naming a cause that
    // did not happen is the same class of error as naming a conclusion that was not established.
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          coverage_status: 'unknown',
          complete: false,
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
              client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 0, error_code: null },
            },
            total_unique_assets: 0,
          },
        })}
      />,
    )

    expect(screen.getByText(/what this run was able to see could not be established/)).toBeTruthy()
    expect(screen.queryByText(/not every required source was read/)).toBeNull()
  })

  it('still says "not every required source was read" when that is the truth', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          coverage_status: 'incomplete',
          complete: false,
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
              client_ad_accounts: { required: true, status: 'failed', pages: 0, items: 0, error_code: 'permission_missing' },
            },
            total_unique_assets: 2,
          },
        })}
      />,
    )

    expect(screen.getByText(/not every required source was read/)).toBeTruthy()
  })

  it('says a truncated read was cut short rather than unread', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          coverage_status: 'partial',
          complete: false,
          coverage: {
            edges: {
              owned_ad_accounts: { required: true, status: 'truncated', pages: 10, items: 1000, error_code: null },
              client_ad_accounts: { required: true, status: 'completed', pages: 1, items: 2, error_code: null },
            },
            total_unique_assets: 1002,
          },
        })}
      />,
    )

    expect(screen.getByText(/cut short before the end/)).toBeTruthy()
    expect(screen.queryByText(/not every required source was read/)).toBeNull()
  })

  it('offers an import only on a row that is not in the registry', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          reconciliation: [
            {
              external_id: '111',
              internal_entity_id: null,
              display_name: 'Tbsupellex',
              status: 'missing_in_registry',
              detail: 'Returned by owned_ad_accounts.',
            },
            {
              external_id: '222',
              internal_entity_id: 'row-2',
              display_name: 'Already here',
              status: 'matched',
              detail: null,
            },
          ],
        })}
        onImport={() => {}}
      />,
    )

    // One button, on the unregistered row only — an already-matched account has nothing to import.
    expect(screen.getAllByRole('button', { name: 'Add to registry' }).length).toBe(1)
  })

  it('offers no import at all when the caller supplies no handler', () => {
    // Pixels: a registry Pixel has no Business Manager relationship in the A1 schema, so there is
    // nothing to import one into, and a button there would promise a mapping that cannot exist.
    render(
      <AssetResult
        title="Pixels"
        result={result({
          required_edges: ['adspixels'],
          reconciliation: [
            {
              external_id: '555',
              internal_entity_id: null,
              display_name: 'A pixel',
              status: 'missing_in_registry',
              detail: 'Returned by adspixels.',
            },
          ],
        })}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Add to registry' })).toBeNull()
  })

  it('passes the external id of the row that was clicked', async () => {
    const clicked: string[] = []
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          reconciliation: [
            {
              external_id: '1167063825546698',
              internal_entity_id: null,
              display_name: 'Tbsupellex',
              status: 'missing_in_registry',
              detail: null,
            },
          ],
        })}
        onImport={(id) => clicked.push(id)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add to registry' }))

    expect(clicked).toEqual(['1167063825546698'])
  })

  it('disables only the row being imported, not every row', () => {
    render(
      <AssetResult
        title="Ad accounts"
        result={result({
          reconciliation: [
            { external_id: '111', internal_entity_id: null, display_name: 'One', status: 'missing_in_registry', detail: null },
            { external_id: '222', internal_entity_id: null, display_name: 'Two', status: 'missing_in_registry', detail: null },
          ],
        })}
        onImport={() => {}}
        importingId="111"
      />,
    )

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to registry' })).toBeTruthy()
  })

  it('states plainly that a registry Pixel cannot be evaluated for absence', () => {
    render(
      <AssetResult
        title="Pixels"
        result={result({ required_edges: ['adspixels'] })}
        emptyNote="Pixel Business Manager mapping is not recorded yet, so a registry Pixel cannot be evaluated for absence from this Business Manager."
      />,
    )

    expect(screen.getByText(/mapping is not recorded yet/)).toBeTruthy()
  })
})
