import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { CreditCard, Globe, Layers, Monitor, Sparkles } from 'lucide-react'
import ReferenceManager from '../components/ReferenceManager'
import { PageHeader } from '../components/page/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import {
  BROWSER_REFERENCES,
  PAGES,
  PAYMENT_REFERENCES,
  PIXELS,
  PROXY_REFERENCES,
} from '../lib/resources'
import type { Paged, ReferenceRecord } from '../lib/types'

const SPECS = [PAGES, PIXELS, PAYMENT_REFERENCES, BROWSER_REFERENCES, PROXY_REFERENCES]

export default function Assets() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab = SPECS.some((s) => s.key === requestedTab) ? requestedTab! : SPECS[0].key
  const [tab, setTab] = useState(initialTab)

  const pagesQ = useQuery({
    queryKey: ['pages', 'count'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/pages?page_size=1'),
  })
  const pixelsQ = useQuery({
    queryKey: ['pixels', 'count'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/pixels?page_size=1'),
  })
  const cardsQ = useQuery({
    queryKey: ['payment-references', 'count'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/payment-method-references?page_size=1'),
  })
  const browsersQ = useQuery({
    queryKey: ['browser-references', 'count'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/browser-profile-references?page_size=1'),
  })
  const proxiesQ = useQuery({
    queryKey: ['proxy-references', 'count'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/proxy-references?page_size=1'),
  })

  useEffect(() => {
    if (requestedTab && SPECS.some((s) => s.key === requestedTab) && requestedTab !== tab) {
      setTab(requestedTab)
    }
  }, [requestedTab, tab])

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab)
    setSearchParams({ tab: nextTab }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title={t('assets.title')} description={t('assets.desc')} />
        <Link
          to="/operations-guide"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-light px-3 py-1.5 text-xs font-bold text-brand-text hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>📖 Quy chuẩn Cách ly Tài sản &amp; Chống Chết Liên Đới →</span>
        </Link>
      </div>

      {/* ASSET HEALTH & ISOLATION SUMMARY BAR */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => handleTabChange(PAGES.key)}
          className="rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Trang Fanpage</span>
            <Layers className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{pagesQ.data?.total ?? 0}</div>
          <div className="text-[11px] text-ink-muted">Giữ bởi Via Tổng (Lớp 1), share quyền cho TKQC</div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PIXELS.key)}
          className="rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Datasets / Pixel</span>
            <Layers className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{pixelsQ.data?.total ?? 0}</div>
          <div className="text-[11px] text-ink-muted">Share Partner qua BM để bảo toàn dữ liệu</div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PAYMENT_REFERENCES.key)}
          className="rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Thẻ Thanh Toán</span>
            <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{cardsQ.data?.total ?? 0}</div>
          <div className="text-[11px] text-ink-muted">Quy tắc an toàn: 1 Thẻ ≤ 3 TKQC</div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(BROWSER_REFERENCES.key)}
          className="rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Hồ sơ Chrome</span>
            <Monitor className="h-3.5 w-3.5 text-brand-text" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{browsersQ.data?.total ?? 0}</div>
          <div className="text-[11px] text-ink-muted">Cách ly 1 Hồ sơ Chrome = 1 Via cố định</div>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange(PROXY_REFERENCES.key)}
          className="rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>Proxy IPv4 Tĩnh</span>
            <Globe className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold text-ink">{proxiesQ.data?.total ?? 0}</div>
          <div className="text-[11px] text-ink-muted">Chuẩn dân cư tĩnh VN: 1 Proxy ≤ 2 Via</div>
        </button>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList aria-label={t('assets.title')}>
          {SPECS.map((spec) => (
            <TabsTrigger key={spec.key} value={spec.key}>
              {t(spec.plural)}
            </TabsTrigger>
          ))}
        </TabsList>
        {SPECS.map((spec) => (
          <TabsContent key={spec.key} value={spec.key}>
            <ReferenceManager spec={spec} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
