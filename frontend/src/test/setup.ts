import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { en } from '../i18n/en'
import { registerDictionary } from '../i18n/translate'

// English is loaded on demand in the app (its own chunk). Tests run synchronously, so preload it.
registerDictionary('en', en)

// jsdom lacks a few browser APIs that Radix UI (dropdown, tooltip, sheet) touches.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  // axe-core probes canvas for icon ligatures; jsdom prints a not-implemented error otherwise.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
}

// Measured 2026-10-27 (U1a): with the real @floating-ui/react-dom, rendering any Radix popper
// content (DropdownMenu, Tooltip) in this jsdom never returns — the run spins until killed, and
// the same happens on a bare <Popper.Content>. jsdom has no layout, so positioning cannot be
// tested here anyway; replace it with a fixed placement. Open/close, roles, Esc and focus
// behaviour (what the tests check) are Radix's and are unaffected. Real positioning is NOT
// covered by any test: it needs a person in a browser.
vi.mock('@floating-ui/react-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('@floating-ui/react-dom')>()
  return {
    ...real,
    useFloating: () => ({
      refs: { setReference: () => undefined, setFloating: () => undefined },
      floatingStyles: {},
      placement: 'bottom',
      isPositioned: true,
      middlewareData: {},
      x: 0,
      y: 0,
    }),
  }
})
