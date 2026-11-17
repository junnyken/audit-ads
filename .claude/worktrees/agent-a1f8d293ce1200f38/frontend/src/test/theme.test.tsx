import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Badge } from '../components/ui'
import { TooltipProvider } from '../components/primitives/tooltip'
import { ThemeToggle } from '../components/shell/ThemeToggle'
import { I18nProvider } from '../i18n'
import { TONE_CLASS } from '../lib/readiness'
import { THEME_STORAGE_KEY, ThemeProvider, readStoredTheme, resolveTheme } from '../theme/ThemeProvider'

function mockSystemDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }),
  })
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <ThemeToggle />
          <Badge tone="neutral">Unknown</Badge>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  mockSystemDark(false)
})

afterEach(() => vi.restoreAllMocks())

describe('theme', () => {
  it('resolves system to the OS preference and explicit modes to themselves', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the OS when nothing was chosen', () => {
    mockSystemDark(true)
    renderToggle()
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('honours a stored choice over the OS', () => {
    mockSystemDark(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderToggle()
    expect(document.documentElement).toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('toggle is a labelled icon button, changes the theme and persists it per viewer', async () => {
    renderToggle()
    const button = screen.getByRole('button', { name: 'Giao diện sáng/tối' })
    await userEvent.click(button)
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Tối' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('ignores a garbage stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(readStoredTheme()).toBe('system')
  })

  it('does not throw when storage is unavailable (read or write)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredTheme()).toBe('system')
    renderToggle()
    await userEvent.click(screen.getByRole('button', { name: 'Giao diện sáng/tối' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Tối' }))
    expect(document.documentElement).toHaveClass('dark')
  })

  it('does not change the tone of a badge when the theme changes', async () => {
    renderToggle()
    const before = screen.getByText('Unknown').closest('span')!.className
    expect(before).toContain(TONE_CLASS.neutral)
    await userEvent.click(screen.getByRole('button', { name: 'Giao diện sáng/tối' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Tối' }))
    expect(screen.getByText('Unknown').closest('span')!.className).toBe(before)
  })
})
