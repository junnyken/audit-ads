import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { en } from '../i18n/en'
import { vi as viDict } from '../i18n/vi'
import { I18nProvider, useI18n } from '../i18n'
import { loadDictionary, registerDictionary, translate, unregisterDictionary } from '../i18n/translate'
import {
  ALERT_SEVERITY_META,
  ALERT_STATUS_META,
  DELIVERY_STATUS_META,
  SKIP_REASON_LABEL,
} from '../lib/alerts'
import { FRESHNESS_META, HEALTH_META, SEVERITY_META, SIGNAL_STATUS_META } from '../lib/health'
import { DRAFT_STATUS_META, FINDING_SEVERITY_META, FINDING_STATUS_META } from '../lib/preflight'
import { BAND_META, RUN_KIND_LABEL, RUN_STATUS_META, STATE_META, TRANSPORT_LABEL } from '../lib/operations'
import {
  ASSIGNMENT_STATUS_TONE,
  INVITATION_STATUS_TONE,
  MEMBER_STATUS_TONE,
} from '../lib/team'
import { BATCH_ITEM_STATUS_LABEL } from '../lib/meta'
import {
  BROWSER_REFERENCES,
  BUSINESS_MANAGERS,
  PAGES,
  PAYMENT_REFERENCES,
  PERSONAL_REFERENCES,
  PIXELS,
  PROXY_REFERENCES,
} from '../lib/resources'

const SRC = join(process.cwd(), 'src')

/** Every U1d page, sheet, dialog and shared part. The two Meta-connection pages, their tabs and
 * components/meta are O4's and are deliberately not in this list. */
const U1D_FILES = [
  'pages/BusinessManagers.tsx',
  'pages/Assets.tsx',
  'pages/Readiness.tsx',
  'pages/AccountHealth.tsx',
  'pages/Alerts.tsx',
  'pages/Preflight.tsx',
  'pages/PreflightDetail.tsx',
  'pages/preflight/OverviewTab.tsx',
  'pages/preflight/FindingsTab.tsx',
  'pages/preflight/EvidenceTab.tsx',
  'pages/preflight/RunsTab.tsx',
  'pages/preflight/AuditTab.tsx',
  'pages/Operations.tsx',
  'pages/operations/CreateAccountWizard.tsx',
  'pages/operations/ShareAccessWizard.tsx',
  'pages/operations/PixelShareWizard.tsx',
  'pages/TeamSeats.tsx',
  'pages/SecurityDevices.tsx',
  'pages/AuditLog.tsx',
  'pages/SystemStatus.tsx',
  'components/HealthSignalDrawer.tsx',
  'components/AlertDrawer.tsx',
  'components/AuditDiff.tsx',
  'components/ReferenceManager.tsx',
  'components/PreflightFindingDrawer.tsx',
  'components/PreflightDraftFormDrawer.tsx',
  'components/team/InviteMemberDrawer.tsx',
  'components/team/MemberDrawer.tsx',
  'components/operations/WizardParts.tsx',
  'components/page/ConfirmDialog.tsx',
  'components/page/FormSheet.tsx',
  'components/page/Filters.tsx',
  'components/page/ListToolbar.tsx',
  'components/page/Pager.tsx',
  'components/page/PageHeader.tsx',
  'components/page/Stat.tsx',
  'components/page/TableSkeleton.tsx',
  'lib/resources.ts',
]

const source = (file: string) => readFileSync(join(SRC, file), 'utf8')

describe('U1d source rules', () => {
  it('no U1d file calls window.confirm, humanise()/titleCase(), or imports the old components/ui', () => {
    for (const file of U1D_FILES) {
      const text = source(file)
      expect(text, file).not.toMatch(/window\.confirm|[^.\w]confirm\(/)
      expect(text, file).not.toMatch(/humanise\(|titleCase\(/)
      expect(text, file).not.toMatch(/from '(\.\.\/)+components\/ui'|from '\.\.?\/ui'|from '\.\/ui'/)
    }
  })

  it('humanise and titleCase no longer exist anywhere in src (they printed raw enums)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) return name === 'test' ? [] : walk(full)
        return /\.(ts|tsx)$/.test(name) ? [full] : []
      })
    for (const file of walk(SRC)) {
      expect(readFileSync(file, 'utf8'), relative(SRC, file)).not.toMatch(/\b(humanise|titleCase)\(|import[^;]*\b(humanise|titleCase)\b/)
    }
  })

  it('every literal translation key a U1d file uses exists in the dictionary', () => {
    const missing: string[] = []
    for (const file of U1D_FILES) {
      const text = source(file)
      for (const match of text.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
        if (!(match[1] in viDict)) missing.push(`${file}: ${match[1]}`)
      }
      // Keys held in data (the resource specs, the page tables) are quoted strings with a dotted prefix.
      for (const match of text.matchAll(/'((?:res|ref|pf|op|tm|mb|inv|al|ah|rdb|hs|sd|aud|sys|bm|assets|diff|pg|confirm)\.[A-Za-z0-9_.]+)'/g)) {
        if (!(match[1] in viDict)) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('every server state the U1d pages show has a Vietnamese and an English label', () => {
  const groups: [string, string[]][] = [
    ['alertSeverity', Object.keys(ALERT_SEVERITY_META)],
    ['alertSeverityHint', Object.keys(ALERT_SEVERITY_META)],
    ['alertStatus', Object.keys(ALERT_STATUS_META)],
    ['alertStatusHint', Object.keys(ALERT_STATUS_META)],
    ['delivery', Object.keys(DELIVERY_STATUS_META)],
    ['deliveryHint', Object.keys(DELIVERY_STATUS_META)],
    ['skipReason', Object.keys(SKIP_REASON_LABEL)],
    ['health', Object.keys(HEALTH_META)],
    ['healthHint', Object.keys(HEALTH_META)],
    ['healthFreshness', Object.keys(FRESHNESS_META)],
    ['severity', Object.keys(SEVERITY_META)],
    ['signalStatus', Object.keys(SIGNAL_STATUS_META)],
    ['draftStatus', Object.keys(DRAFT_STATUS_META)],
    ['draftStatusHint', Object.keys(DRAFT_STATUS_META)],
    ['findingSeverity', Object.keys(FINDING_SEVERITY_META)],
    ['findingStatus', Object.keys(FINDING_STATUS_META)],
    ['findingStatusHint', Object.keys(FINDING_STATUS_META)],
    ['opsState', Object.keys(STATE_META)],
    ['opsStateHint', Object.keys(STATE_META)],
    ['band', Object.keys(BAND_META)],
    ['opsRunStatus', Object.keys(RUN_STATUS_META)],
    ['runKind', Object.keys(RUN_KIND_LABEL)],
    ['transport', Object.keys(TRANSPORT_LABEL)],
    ['memberStatus', Object.keys(MEMBER_STATUS_TONE)],
    ['invStatus', Object.keys(INVITATION_STATUS_TONE)],
    ['assignStatus', Object.keys(ASSIGNMENT_STATUS_TONE)],
    ['batchItemStatus', Object.keys(BATCH_ITEM_STATUS_LABEL)],
  ]

  it.each(groups)('%s', (prefix, codes) => {
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      expect(viDict, `${prefix}.${code}`).toHaveProperty(`${prefix}.${code}`)
      expect(en, `${prefix}.${code}`).toHaveProperty(`${prefix}.${code}`)
    }
  })

  it('every field, option and note of the seven registry resources is a real key', () => {
    for (const spec of [BUSINESS_MANAGERS, PERSONAL_REFERENCES, PAGES, PIXELS, PAYMENT_REFERENCES, BROWSER_REFERENCES, PROXY_REFERENCES]) {
      for (const key of [spec.singular, spec.plural, spec.description, spec.note].filter(Boolean) as string[]) expect(viDict, key).toHaveProperty(key)
      for (const field of spec.fields) {
        expect(viDict, field.label).toHaveProperty(field.label)
        if (field.hint) expect(viDict, field.hint).toHaveProperty(field.hint)
        for (const [, label] of field.options ?? []) expect(viDict, label).toHaveProperty(label)
      }
    }
  })
})

describe('wording guardrails for the copy U1d added (rule 6)', () => {
  const U1D_PREFIXES = /^(res|ref|pf|op|tm|mb|inv|al|ah|rdb|hs|sd|aud|sys|bm|assets|diff|pg|confirm|draftStatus|findingStatus|alert|delivery|skipReason|opsState|apiStatus|workerStatus)/

  it('never says an account is safe, protected or will be approved (the one negation is the disclaimer)', () => {
    for (const [key, value] of Object.entries(viDict)) {
      if (!U1D_PREFIXES.test(key)) continue
      expect(value, key).not.toMatch(/an toàn|được bảo vệ|không thể bị hạn chế/)
      if (/sẽ được duyệt/.test(value)) expect(value, key).toMatch(/không bảo đảm[^.]*sẽ được duyệt/)
    }
  })

  it('has no numeric score wording on the new health, alert or readiness copy (rules 9, 11)', () => {
    for (const [key, value] of Object.entries(viDict)) {
      if (!U1D_PREFIXES.test(key)) continue
      expect(value, key).not.toMatch(/điểm (rủi ro|an toàn|tin cậy|sức khoẻ)|risk score|health score/i)
    }
  })

  it('the three Meta write wizards state that running the queue cannot be undone from the product', () => {
    expect(viDict['op.dialog.reversible']).toMatch(/Không hoàn tác được/)
    expect(en['op.dialog.reversible']).toMatch(/Not undoable/)
  })
})

describe('the English dictionary is loaded on demand', () => {
  afterEach(() => {
    registerDictionary('en', en)
    localStorage.removeItem('adsops.language')
  })

  it('answers in Vietnamese until English is registered, then in English', async () => {
    unregisterDictionary('en')
    expect(translate('en', 'nav.item.overview')).toBe(viDict['nav.item.overview'])
    await loadDictionary('en')
    expect(translate('en', 'nav.item.overview')).toBe(en['nav.item.overview'])
  })

  it('the provider holds back the first render for a stored English choice until the dictionary arrives', async () => {
    unregisterDictionary('en')
    localStorage.setItem('adsops.language', 'en')
    function Probe() {
      const { t, language } = useI18n()
      return <p data-testid="probe">{`${language}:${t('nav.item.overview')}`}</p>
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    // Never a flash of Vietnamese for an English reader: either nothing yet, or English.
    expect(screen.queryByText(/^vi:/)).toBeNull()
    expect(await screen.findByTestId('probe')).toHaveTextContent(`en:${en['nav.item.overview']}`)
  })

  it('a Vietnamese reader never waits for the English chunk', () => {
    unregisterDictionary('en')
    localStorage.setItem('adsops.language', 'vi')
    function Probe() {
      const { t } = useI18n()
      return <p data-testid="probe">{t('nav.item.overview')}</p>
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent(viDict['nav.item.overview'])
  })

  it('the build keeps English in its own chunk (src/i18n/en.ts is only imported dynamically)', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== 'test') walk(full)
        } else if (/\.(ts|tsx)$/.test(name) && /from '(\.\.?\/)+(i18n\/)?en'/.test(readFileSync(full, 'utf8')) && !full.endsWith('i18n/en.ts')) {
          offenders.push(relative(SRC, full))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
