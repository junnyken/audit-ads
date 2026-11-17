import { describe, expect, it, vi } from 'vitest'
import { observationsDiffer, observe } from '../src/content/context-detector'
import { POLL_INTERVAL_MS, watchUrl } from '../src/content/dom-observer'

describe('context detector', () => {
  it('reads only the account id, the route and the title', () => {
    const observation = observe(
      {
        href:
          'https://adsmanager.facebook.com/adsmanager/manage/campaigns' +
          '?act=123456789&business_id=999&session_id=abc&access_token=SECRET',
      },
      'BM USA - Account 03 | Meta Ads Manager',
    )
    expect(observation).toEqual({
      externalAccountId: '123456789',
      safePath: '/adsmanager/manage/campaigns',
      pageType: 'campaign',
      displayName: 'BM USA - Account 03',
    })
    const serialised = JSON.stringify(observation)
    for (const leak of ['SECRET', 'access_token', 'session_id', 'business_id', '?', '999']) {
      expect(serialised).not.toContain(leak)
    }
  })

  it('reports an unsupported page without an account id', () => {
    const observation = observe({ href: 'https://www.facebook.com/messages/t/1' }, 'Messenger')
    expect(observation.safePath).toBeNull()
    expect(observation.pageType).toBe('unknown')
    expect(observation.externalAccountId).toBeNull()
  })

  it('keeps the account id when the route is recognised but the title is not', () => {
    const observation = observe(
      { href: 'https://business.facebook.com/adsmanager/manage/adsets?act=act_5550001' },
      null,
    )
    expect(observation.externalAccountId).toBe('5550001')
    expect(observation.displayName).toBeNull()
  })

  it('only reports again when something meaningful changed', () => {
    const first = observe({ href: 'https://x/adsmanager/manage/campaigns?act=1' }, 'A')
    const sameRoute = observe({ href: 'https://x/adsmanager/manage/campaigns?act=1&sort=z' }, 'B')
    const differentAccount = observe({ href: 'https://x/adsmanager/manage/campaigns?act=2' }, 'A')
    expect(observationsDiffer(null, first)).toBe(true)
    expect(observationsDiffer(first, sameRoute)).toBe(false)
    expect(observationsDiffer(first, differentAccount)).toBe(true)
  })
})

describe('url watcher', () => {
  it('fires only when the URL actually changes, and can be stopped', () => {
    let tick: (() => void) | null = null
    const target = {
      location: { href: 'https://x/adsmanager/manage/campaigns?act=1' },
      setInterval: ((fn: () => void) => {
        tick = fn
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    }
    const seen: string[] = []
    const watcher = watchUrl(target, (href) => seen.push(href))

    tick!()
    expect(seen).toEqual([])

    target.location.href = 'https://x/adsmanager/manage/adsets?act=1'
    tick!()
    tick!()
    expect(seen).toEqual(['https://x/adsmanager/manage/adsets?act=1'])

    watcher.stop()
    expect(target.clearInterval).toHaveBeenCalled()
  })

  it('polls at a rate that costs the operator nothing measurable', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(1000)
  })
})
