import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { FacebookAccountFormSheet } from '../components/facebook/FacebookAccountFormSheet'
import { wrap, paged } from './u1d-helpers'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), api: apiMock }))
beforeEach(() => apiMock.get.mockResolvedValue(paged([])))
afterEach(() => vi.clearAllMocks())

it('never offers manual token capture in the Facebook identity form', async () => {
  const { container } = wrap(<FacebookAccountFormSheet open onClose={() => undefined} />)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(container.ownerDocument.body.textContent).not.toMatch(/EAAB|dán Token|bằng Token/i)
  expect(container.ownerDocument.querySelector('input[type="password"]')).toBeNull()
  expect(screen.getByText(/tuyệt đối không nhập mật khẩu hay mã 2FA/)).toBeInTheDocument()
  expect(apiMock.post).not.toHaveBeenCalled()
})
