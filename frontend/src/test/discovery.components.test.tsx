import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
