import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReaderSourceBadge, readerSourceNote } from '../components/meta/ReaderSource'

describe('which credential reads this Business Manager', () => {
  it('says a Business Manager has its own reader', () => {
    render(<ReaderSourceBadge source="business_specific" />)
    expect(screen.getByText('Own reader for this Business Manager')).toBeTruthy()
  })

  it('never dresses the fallback up as proof of access', () => {
    // The old UI said "Token configured: Yes" for every connection, because the server held one
    // token. Measured on real Meta: a token with no role in a Business Manager still reads its
    // node and every asset edge answers 200 with an empty list. "Yes" was answering a question
    // nobody asked, in a way that made an unreadable business look configured.
    render(<ReaderSourceBadge source="server_default" />)

    expect(screen.getByText('Server default reader')).toBeTruthy()
    expect(screen.queryByText('Yes')).toBeNull()
    expect(readerSourceNote('server_default')).toContain('may have no role in this business')
    expect(readerSourceNote('server_default')).toContain('not evidence the business is empty')
  })

  it('states plainly when nothing can read the Business Manager', () => {
    render(<ReaderSourceBadge source="none" />)

    expect(screen.getByText('No reader configured')).toBeTruthy()
    expect(readerSourceNote('none')).toContain('no result should be interpreted as absence')
  })

  it('claims no credential at all for a fake connection', () => {
    const { container } = render(<ReaderSourceBadge source="fake" />)

    expect(container.textContent).toBe('')
    expect(readerSourceNote('fake')).toBeNull()
  })
})
