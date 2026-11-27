import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = readFileSync(resolve(process.cwd(), 'default.conf.template'), 'utf8')
describe('nginx SPA pages inside static assets namespace', () => {
  it.each(['/assets', '/assets/emails', '/assets/emails/'])('has an exact noncached SPA response for %s', path => {
    const start = config.indexOf(`location = ${path} {`)
    expect(start).toBeGreaterThan(-1)
    const block = config.slice(start, config.indexOf('}', start))
    expect(block).toContain('try_files /index.html =404;')
    expect(block).toContain('expires -1;')
  })
  it('keeps missing JS/CSS assets as 404 rather than HTML', () => {
    const start = config.indexOf('location /assets/ {')
    const block = config.slice(start, config.indexOf('}', start))
    expect(block).toContain('try_files $uri =404;')
    expect(block).not.toContain('/index.html')
  })
})
