import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Colour is decided in src/lib/readiness.ts (tones) and painted by src/tokens.css. A raw
 * palette class (`bg-emerald-50`, `text-rose-800`) in a page is a second place that decides, and
 * it ignores dark mode.
 *
 * U1a freezes the debt: the files below already used raw palette classes before the redesign.
 * U1b-U1d restyle them and REMOVE entries; the second test fails when an entry is stale, so the
 * list can only shrink. A new file can never be added.
 */
const ALLOWLIST = new Set([
  'components/AlertDrawer.tsx',
  'components/AuditDiff.tsx',
  'components/meta/AssetInventory.tsx',
  'components/meta/DiscoveryOverview.tsx',
  'components/meta/DiscoverySection.tsx',
  'pages/AccountHealth.tsx',
  'pages/Alerts.tsx',
  'pages/MetaConnectionWorkspace.tsx',
  'pages/MetaConnections.tsx',
  'pages/Preflight.tsx',
  'pages/PreflightDetail.tsx',
  'pages/SystemStatus.tsx',
  'pages/meta-connection/HistoryTab.tsx',
  'pages/operations/CreateAccountWizard.tsx',
  'pages/operations/PixelShareWizard.tsx',
  'pages/operations/ShareAccessWizard.tsx',
  'pages/preflight/EvidenceTab.tsx',
  'pages/preflight/RunsTab.tsx',
])

const RAW_PALETTE =
  /\b(bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret|placeholder)-(emerald|rose|amber|sky|slate|green|red|yellow|blue|gray|zinc|neutral|stone|orange|teal|cyan|indigo|violet|purple|pink|lime|fuchsia)-\d{2,3}\b/

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const offenders = sourceFiles(SRC)
  .filter((file) => RAW_PALETTE.test(readFileSync(file, 'utf8')))
  .map((file) => relative(SRC, file))
  .sort()

describe('no raw palette classes outside the frozen allowlist', () => {
  it('has no new offender', () => {
    expect(offenders.filter((file) => !ALLOWLIST.has(file))).toEqual([])
  })

  it('has no stale allowlist entry (remove entries as pages are restyled)', () => {
    expect([...ALLOWLIST].filter((file) => !offenders.includes(file)).sort()).toEqual([])
  })

  it('keeps the tone decision file free of raw palette', () => {
    expect(readFileSync(join(SRC, 'lib/readiness.ts'), 'utf8')).not.toMatch(RAW_PALETTE)
  })
})
