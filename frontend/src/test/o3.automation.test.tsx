import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AutomationBadge,
  AutomationControls,
  automationOf,
  ineligibleText,
} from '../components/meta/AutomationControls'
import { DiscoveryHistoryList, TriggerBadge } from '../pages/meta-connection/HistoryTab'
import { provenanceText } from '../pages/account/OverviewTab'
import { SKIP_REASON_LABEL } from '../lib/alerts'
import type { DiscoveryRunSummary, ImportProvenance, MetaConnection, MetaConnectionAutomation } from '../lib/types'

function automation(over: Partial<MetaConnectionAutomation> = {}): MetaConnectionAutomation {
  return {
    auto_discovery_enabled: false,
    auto_import_enabled: false,
    enabled_by: null,
    enabled_at: null,
    eligible: true,
    ineligible_reason: null,
    ...over,
  }
}

function connection(over: Partial<MetaConnection> = {}): MetaConnection {
  return {
    id: 'c1',
    label: 'Hub',
    environment: 'production',
    status: 'unknown',
    capabilities: null,
    last_capability_check_at: null,
    business_managers: null,
    token_configured: true,
    reader_source: 'server_default',
    business_manager_reference: '1993884657458857',
    business_manager_source: 'connection',
    notes: '',
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    archived_at: null,
    automation: automation(),
    ...over,
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe('the Auto badge on a connection card', () => {
  it('is absent while scheduled discovery is off', () => {
    const { container } = render(<AutomationBadge automation={automation()} />)
    expect(container.textContent).toBe('')
  })

  it('says Auto, and Auto + import when import is on too — never with success styling', () => {
    const { rerender } = render(<AutomationBadge automation={automation({ auto_discovery_enabled: true })} />)
    expect(screen.getByText('Auto')).toBeTruthy()
    rerender(<AutomationBadge automation={automation({ auto_discovery_enabled: true, auto_import_enabled: true })} />)
    const badge = screen.getByText('Auto + import')
    expect(badge.className).not.toMatch(/emerald|green/)
  })

  it('reads an older response without the block as both switches off', () => {
    const value = automationOf(connection({ automation: undefined }))
    expect(value.auto_discovery_enabled).toBe(false)
    expect(value.auto_import_enabled).toBe(false)
  })
})

describe('the automation switches', () => {
  it('cannot be switched on for a fake connection, and says why', () => {
    wrap(
      <AutomationControls
        connection={connection({
          environment: 'fake',
          automation: automation({ eligible: false, ineligible_reason: 'not_production' }),
        })}
      />,
    )
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.every((box) => box.disabled)).toBe(true)
    expect(screen.getByText(/Only a Production connection can run automatically/)).toBeTruthy()
  })

  it('keeps import disabled until discovery is on', () => {
    wrap(<AutomationControls connection={connection()} />)
    const [discovery, imports] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(imports.disabled).toBe(true)
    fireEvent.click(discovery)
    expect(imports.disabled).toBe(false)
  })

  it('asks for a deliberate confirmation and says a registry record cannot be deleted', () => {
    wrap(<AutomationControls connection={connection()} />)
    const [discovery, imports] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(discovery)
    fireEvent.click(imports)
    expect(screen.getByText('Confirm')).toBeTruthy()
    expect(screen.getByText(/cannot be deleted from the registry afterwards/)).toBeTruthy()
    expect(screen.getByText(/Nothing\s+in Meta is created, shared or changed/)).toBeTruthy()
  })

  it('names a missing reader as configuration, not as a refusal', () => {
    expect(ineligibleText('reader_not_configured')).toMatch(/nothing will be read until one is configured/)
    expect(ineligibleText(null)).toBeNull()
  })
})

function runSummary(over: Partial<DiscoveryRunSummary> = {}): DiscoveryRunSummary {
  return {
    id: 'run-1',
    status: 'succeeded',
    trigger: 'manual',
    environment: 'production',
    business_manager: { reference: '1993884657458857', name: 'Hub BM' },
    read_as: { external_id: '615', name: 'adsops-readonly' },
    business_authority: 'not_checked',
    started_at: '2026-10-27T01:00:00Z',
    completed_at: '2026-10-27T01:00:05Z',
    freshness: 'current',
    failure_code: null,
    failure_summary: null,
    ad_accounts: { coverage_status: 'complete', complete: true, required_edges: [], coverage: { edges: {}, total_unique_assets: 2 } },
    pixels: { coverage_status: 'complete', complete: true, required_edges: [], coverage: { edges: {}, total_unique_assets: 0 } },
    auto_import: null,
    ...over,
  }
}

describe('Manual / Scheduled in the discovery history', () => {
  it('shows a badge instead of the raw trigger value', () => {
    const { container } = render(
      <DiscoveryHistoryList
        runs={[
          runSummary({ id: 'a', trigger: 'scheduled_sweep', auto_import: { imported: 3, already_in_registry: 1, archived_returned: 1, conflicts: 0, awaiting_import: 0 } }),
          runSummary({ id: 'b' }),
        ]}
      />,
    )
    expect(screen.getByText('Scheduled')).toBeTruthy()
    expect(screen.getByText('Manual')).toBeTruthy()
    expect(container.textContent).not.toContain('scheduled_sweep')
    expect(container.textContent).not.toContain('· manual')
    expect(screen.getByText(/Imported automatically: 3/)).toBeTruthy()
    expect(screen.getByText(/archived here but still returned: 1 \(not restored\)/)).toBeTruthy()
  })

  it('shows an unknown trigger as it is rather than guessing', () => {
    render(<TriggerBadge trigger="something_new" />)
    expect(screen.getByText('something_new')).toBeTruthy()
  })
})

describe('where an imported account came from', () => {
  const base: ImportProvenance = {
    discovery_run_id: 'r1',
    business_manager_reference: '1993884657458857',
    source_edge: 'client_ad_accounts',
    imported_at: null,
  }

  it('says the sweep imported it and which Business Manager shared it', () => {
    const text = provenanceText({
      ...base,
      trigger: 'scheduled_sweep',
      automatic: true,
      owner_business_reference: '7770001',
      owner_business_name: 'Partner Shop',
    }, 'en')
    expect(text).toContain('Imported automatically by the discovery sweep')
    expect(text).toContain('Shared from Business Manager 7770001 (Partner Shop)')
    expect(text).toContain('Nothing in Meta was created or changed')
  })

  it('says the owner was not returned instead of guessing it', () => {
    const text = provenanceText({ ...base, automatic: true, owner_business_reference: null }, 'en')
    expect(text).toContain('Owning Business Manager not returned by Meta')
  })

  it('keeps the manual wording for a person\'s import and says nothing about owners of owned accounts', () => {
    const text = provenanceText({ ...base, source_edge: 'owned_ad_accounts' }, 'en')
    expect(text).toContain('Added to the registry from a read-only discovery')
    expect(text).not.toContain('Shared from')
    expect(text).not.toContain('not returned')
  })
})

describe('the grace skip reason', () => {
  it('explains itself and says critical is never held back', () => {
    expect(SKIP_REASON_LABEL.auto_import_grace).toMatch(/Critical alerts are never held back/)
  })
})
