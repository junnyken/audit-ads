import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Operations from '../pages/Operations'
import { safeStoredNetworkLabel, TwoFactorMethodCell, computeWarmupStatus } from '../pages/FacebookAccounts'
import { honestOperationsVi } from '../i18n/honestOperations'
import type { ReferenceRecord } from '../lib/types'

const launcher = vi.hoisted(() => vi.fn())
vi.mock('../lib/chromeProfileLauncher', async (original) => ({
  ...await original<typeof import('../lib/chromeProfileLauncher')>(),
  launchInAssignedChromeProfile: launcher,
}))
vi.mock('../i18n', () => ({
  useI18n: () => ({ language: 'vi', t: (key: string) => honestOperationsVi[key as keyof typeof honestOperationsVi] ?? key }),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('honest Operations retirement contract', () => {
  it('renders seven existing navigations with no execution controls or heuristic launcher', () => {
    const { container } = render(<MemoryRouter><Operations /></MemoryRouter>)
    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(screen.getByText(honestOperationsVi['honest.operations.retiredTitle'])).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/100%|anti-checkpoint|chống checkpoint|Via Tổng giữ BM|Default|đã mở tác vụ/i)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(launcher).not.toHaveBeenCalled()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/meta-connections', '/chrome-extension', '/operations-guide',
      '/operations/create-accounts', '/operations/share-access', '/operations/pixel-share', '/team',
    ])
  })
  it('shows only the stored 2FA method and manual instruction, never a seed or input', () => {
    const { container } = render(<TwoFactorMethodCell row={{ id: 'fb1', status: 'unknown', notes: '', created_at: '', updated_at: '', archived_at: null, two_factor_method: 'app', vault_reference: '2fa://JBSWY3DPEHPK3PXP' } satisfies ReferenceRecord} badgeLabel="Ứng dụng xác thực" />)
    expect(screen.getByText('Ứng dụng xác thực')).toBeInTheDocument()
    expect(screen.getByText(honestOperationsVi['honest.facebook.twoFactorManual'])).toBeInTheDocument()
    expect(container.querySelector('input,button')).toBeNull()
    expect(container.textContent).not.toContain('JBSWY3DPEHPK3PXP')
  })
  it('preserves legacy metadata and redacts credential-shaped references', () => {
    expect(safeStoredNetworkLabel('VNPT Static IP — Line #12')).toBe('VNPT Static IP — Line #12')
    expect(safeStoredNetworkLabel('Office Direct Line')).toBe('Office Direct Line')
    expect(safeStoredNetworkLabel('http://alice:password@127.0.0.1:8080')).toBe('[redacted]')
    expect(safeStoredNetworkLabel('127.0.0.1:8080:alice:password')).toBe('[redacted]')
    expect(safeStoredNetworkLabel(null)).toBe('')
  })
})


it.each(['', 'invalid', '2020-01-01T00:00:00Z'])('never infers trusted provider status from stored date %s', value => {
  const result = computeWarmupStatus(value)
  expect(result.tone).toBe('neutral')
  expect(result.label).not.toMatch(/trusted|đã trust|an toàn|72h vàng/i)
  expect(result.hint).toContain('không xác minh')
})
