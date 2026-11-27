import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

// jsdom is an existing runtime dev dependency; type the small API used here
// without adding dependencies or weakening project-wide type checking.
type TestDOM = { window: Window & typeof globalThis & { close(): void } }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => TestDOM
}

const root = resolve(process.cwd(), '../docs/mockups/p1-email')
const read = (name: string) => readFileSync(resolve(root, name), 'utf8')
let dom: TestDOM
let guards: ReturnType<typeof vi.fn>[]
function boot(hash = '') {
  dom = new JSDOM(read('index.html'), { url: pathToFileURL(resolve(root, 'index.html')).href + hash, runScripts: 'outside-only' })
  const w = dom.window
  guards = []
  const deny = () => { const fn = vi.fn(() => { throw Error('Forbidden IO') }); guards.push(fn); return fn }
  Object.defineProperty(w, 'fetch', { value: deny() })
  Object.defineProperty(w, 'XMLHttpRequest', { value: deny() })
  Object.defineProperty(w, 'WebSocket', { value: deny() })
  Object.defineProperty(w, 'localStorage', { get: deny() })
  Object.defineProperty(w, 'sessionStorage', { get: deny() })
  Object.defineProperty(w.document, 'cookie', { get: deny(), set: deny() })
  Object.defineProperty(w, 'structuredClone', { value: structuredClone })
  w.eval(read('screens.js'))
  w.eval(read('app.js'))
}
const doc = () => dom.window.document
const el = (id: string) => doc().getElementById(id) as HTMLInputElement
const text = () => doc().getElementById('main')!.textContent!
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
async function click(label: string) {
  const b = Array.from(doc().querySelectorAll('button')).find(b => b.textContent === label && !b.disabled)
  expect(b, label).toBeTruthy(); b!.click(); await tick()
}
function input(id: string, value: string) { el(id).value = value; el(id).dispatchEvent(new dom.window.Event(id === 'search' || id === 'reason' || id === 'due' ? 'input' : 'change', { bubbles: true })) }
async function route(hash: string) { dom.window.location.hash = hash; await tick() }
function submit() { el('editForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) }
afterEach(() => { guards?.forEach(g => expect(g).not.toHaveBeenCalled()); dom?.window.close() })

describe('P1-D1 actual offline templates and scripts', () => {
  it('executes committed templates matching fragments; filters, pagination and no results', async () => {
    boot()
    doc().querySelector<HTMLAnchorElement>('.ds-skip')!.click()
    expect(doc().activeElement).toBe(doc().getElementById('main'))
    expect(dom.window.location.hash).toBe('')
    const templates = (dom.window as unknown as { P1_SCREENS: Record<string,string> }).P1_SCREENS
    for (const name of ['registry','detail','edit','review']) expect(templates[name]).toBe(read(`screens/${name}.html`))
    expect(doc().querySelectorAll('tbody tr')).toHaveLength(2)
    await click('Trang sau'); expect(text()).toContain('c***@example.com')
    input('search','Microsoft'); expect(text()).toContain('b***@example.com'); expect(text()).not.toContain('a***@example.com')
    input('ownerFilter','Người phụ trách B'); input('stateFilter','unknown'); input('dueFilter','unknown')
    expect(doc().querySelectorAll('tbody tr')).toHaveLength(1)
    input('provider','Gmail cá nhân'); expect(text()).toContain('Không có kết quả')
    await click('Xóa bộ lọc'); expect(doc().querySelectorAll('tbody tr')).toHaveLength(2)
    input('search','<img src=x onerror=alert(1)>'); expect(doc().querySelector('img')).toBeNull()
  })
  it('handles all read states, preserves filters and blocks deep links without permission', async () => {
    boot(); input('search','Microsoft'); input('scenario','error'); expect(text()).toContain('Không đọc được')
    await click('Thử lại'); expect(el('search').value).toBe('Microsoft')
    input('scenario','loading'); expect(doc().querySelector('[aria-busy="true"]')).toBeTruthy()
    await click('Hoàn tất tải minh họa'); expect(el('search').value).toBe('Microsoft')
    input('scenario','empty'); expect(text()).toContain('Chưa có email minh họa')
    input('scenario','partial'); expect(text()).toContain('Dữ liệu một phần')
    await click('Chi tiết'); expect(text()).toContain('Chưa biết')
    await click('← Danh sách'); expect(el('search').value).toBe('Microsoft')
    input('scenario','no-permission'); await route('#detail/e1')
    expect(text()).toContain('Không có quyền'); expect(text()).not.toContain('example.com'); expect(text()).not.toContain('Người phụ trách A'); expect(doc().querySelector('tbody')).toBeNull()
    await route('#edit/e1'); expect(doc().querySelector('form')).toBeNull(); expect(doc().querySelector('main button:disabled')).toBeTruthy()
    input('scenario','normal'); await route('#nonsense/x'); expect(text()).toContain('Không tìm thấy')
    await route('#detail/missing'); expect(text()).toContain('Không tìm thấy')
    await route('#review/e1'); expect(text()).toContain('Không có bản nháp')
  })
  it('validates on submit, reviews literal XSS text, preserves drafts and cancels without history', async () => {
    boot('#detail/e1'); await click('Sửa metadata')
    input('owner',''); input('state','blocked'); input('reason',''); input('due','2026-02-30'); submit()
    expect(el('owner').getAttribute('aria-invalid')).toBe('true'); expect(doc().activeElement).toBe(el('owner'))
    expect(el('errors').querySelectorAll('a')).toHaveLength(3)
    el('errors').querySelector<HTMLAnchorElement>('a[href="#due"]')!.click(); expect(doc().activeElement).toBe(el('due'))
    const payload='<img src=x onerror=alert(1)>'
    input('owner','Người phụ trách B'); input('reason',payload); input('due','2026-12-01'); submit(); await tick()
    expect(text()).toContain(payload); expect(doc().querySelector('img')).toBeNull()
    await click('Quay lại sửa'); expect(el('reason').value).toBe(payload)
    await click('Hủy thay đổi'); expect(text()).not.toContain(payload); expect(doc().querySelectorAll('#history li')).toHaveLength(1)
    await click('Sửa metadata'); expect(el('owner').value).toBe('Người phụ trách A')
  })
  it('saves only memory, shows saving/readback/history, resets fixture and toggles theme', async () => {
    boot('#detail/e1'); await click('Sửa metadata'); input('owner','Người phụ trách B'); input('reason','<b>literal fixture</b>'); input('due',''); submit(); await tick()
    input('saveMode','fail'); await click('Lưu minh họa'); expect(text()).toContain('Đang lưu minh họa'); expect(doc().querySelector('button[data-action="save"]:disabled')).toBeTruthy()
    await new Promise(resolve=>setTimeout(resolve,180)); await tick()
    expect(text()).toContain('đọc lại bị lỗi'); await click('Thử đọc lại')
    expect(text()).toContain('Người phụ trách B'); expect(text()).toContain('<b>literal fixture</b>'); expect(doc().querySelector('#metadata b')).toBeNull(); expect(doc().querySelectorAll('#history li')).toHaveLength(2)
    await click('Giao diện tối'); expect(doc().documentElement.classList.contains('dark')).toBe(true)
    await click('Giao diện sáng'); expect(doc().documentElement.classList.contains('light')).toBe(true)
    await click('Khôi phục fixture'); await click('Chi tiết'); expect(text()).not.toContain('literal fixture'); expect(doc().querySelectorAll('#history li')).toHaveLength(1)
    await click('Sửa metadata'); input('reason','discard on reset'); await click('Khôi phục fixture'); await route('#review/e1'); expect(text()).toContain('Không có bản nháp')
    expect(doc().querySelectorAll('a[href^="http"],script[src^="http"],link[href^="http"]')).toHaveLength(0)
  })
})
