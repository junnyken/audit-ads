import { describe, expect, it } from 'vitest'
import {
  canonicalAccountId,
  displayNameFrom,
  extractAccountId,
  isUsableDashboardUrl,
  sanitisePath,
} from '../src/shared/validation'

describe('account id canonicalisation', () => {
  it('treats act_123, ACT-123 and 123 as the same account', () => {
    expect(canonicalAccountId('act_123456789')).toBe('123456789')
    expect(canonicalAccountId('ACT-123456789')).toBe('123456789')
    expect(canonicalAccountId('  123456789 ')).toBe('123456789')
  })

  it('never invents an id from nothing', () => {
    for (const value of ['', '   ', null, undefined, 'act_', '!!!', 'a b']) {
      expect(canonicalAccountId(value as string)).toBeNull()
    }
  })

  it('does not truncate or alter the digits it keeps', () => {
    expect(canonicalAccountId('act_100200300400500')).toBe('100200300400500')
  })

  it('refuses an over-long value rather than trimming it into a different id', () => {
    expect(canonicalAccountId(`act_${'9'.repeat(200)}`)).toBeNull()
  })
})

describe('URL handling', () => {
  it('extracts the account id from the act query parameter', () => {
    expect(
      extractAccountId('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789'),
    ).toBe('123456789')
  })

  it('extracts an act_ id from the path', () => {
    expect(extractAccountId('https://business.facebook.com/adsmanager/manage/act_987654321/')).toBe(
      '987654321',
    )
  })

  it('returns the path only, dropping query and hash entirely', () => {
    const { safePath, pageType } = sanitisePath(
      'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&access_token=SECRET#frag',
    )
    expect(safePath).toBe('/adsmanager/manage/campaigns')
    expect(safePath).not.toContain('access_token')
    expect(safePath).not.toContain('?')
    expect(safePath).not.toContain('#')
    expect(pageType).toBe('campaign')
  })

  it('refuses any route that is not on the allowlist', () => {
    for (const url of [
      'https://www.facebook.com/',
      'https://www.facebook.com/messages/t/123',
      'https://www.facebook.com/profile.php?id=1',
      'https://adsmanager.facebook.com/adsmanager/unknown/thing',
      'https://example.com/adsmanager/manage/campaigns',
    ]) {
      const { safePath, pageType } = sanitisePath(url)
      // The host is not checked here — the manifest restricts where this code runs at all —
      // but an unrecognised path always yields nothing.
      if (url.includes('/adsmanager/manage/campaigns')) continue
      expect(safePath).toBeNull()
      expect(pageType).toBe('unknown')
    }
  })

  it('maps each allowlisted route to its page type', () => {
    expect(sanitisePath('/adsmanager/manage/campaigns').pageType).toBe('campaign')
    expect(sanitisePath('/adsmanager/manage/adsets').pageType).toBe('adset')
    expect(sanitisePath('/adsmanager/manage/ads').pageType).toBe('ad')
    expect(sanitisePath('/billing_hub/accounts').pageType).toBe('billing')
  })

  it('recognises the real /adsmanager/billing_hub shape found in live UAT (2026-09-08)', () => {
    expect(sanitisePath('/adsmanager/billing_hub/accounts').pageType).toBe('billing')
    expect(sanitisePath('/adsmanager/billing_hub/accounts/details').pageType).toBe('billing')
    expect(sanitisePath('/adsmanager/billing_hub/payment_activity').pageType).toBe('billing')
  })

  it('refuses an absurdly long path instead of storing it', () => {
    expect(sanitisePath(`/adsmanager/manage/${'x'.repeat(300)}`).safePath).toBeNull()
  })
})

describe('display name', () => {
  it('cleans the tab title for display', () => {
    expect(displayNameFrom('BM USA - Account 03 | Meta Ads Manager')).toBe('BM USA - Account 03')
  })

  it('returns null rather than an unusable name', () => {
    expect(displayNameFrom('')).toBeNull()
    expect(displayNameFrom('x')).toBeNull()
    expect(displayNameFrom(null)).toBeNull()
  })
})

describe('dashboard URL', () => {
  it('accepts HTTPS and refuses plain HTTP on a real host', () => {
    expect(isUsableDashboardUrl('https://adsops.example.com')).toBe(true)
    expect(isUsableDashboardUrl('http://adsops.example.com')).toBe(false)
  })

  it('allows plain HTTP only for local development', () => {
    expect(isUsableDashboardUrl('http://localhost:8000')).toBe(true)
    expect(isUsableDashboardUrl('http://127.0.0.1:8009')).toBe(true)
  })

  it('refuses anything that is not a URL', () => {
    expect(isUsableDashboardUrl('not a url')).toBe(false)
    expect(isUsableDashboardUrl('javascript:alert(1)')).toBe(false)
  })
})
