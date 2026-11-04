import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react'
import ReferenceManager from '../components/ReferenceManager'
import { QuickMetaSyncBanner } from '../components/meta/QuickMetaSyncBanner'
import { PageHeader } from '../components/page/PageHeader'
import { Badge } from '../components/primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { BUSINESS_MANAGERS, PERSONAL_REFERENCES } from '../lib/resources'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'

export default function BusinessManagers() {
  const { t } = useI18n()
  const [tab, setTab] = useState('bm')

  const bmQuery = useQuery({
    queryKey: ['business-managers', 'matrix'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
  })

  const accountsQuery = useQuery({
    queryKey: ['ad-accounts', 'bm-matrix'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const bmMatrix = useMemo(() => {
    const bms = bmQuery.data?.items ?? []
    const accs = accountsQuery.data?.items ?? []

    return bms.map((bm) => {
      const bmId = String(bm.external_id ?? '').trim()
      const bmName = String(bm.label ?? '').trim()
      const linked = accs.filter(
        (a) =>
          (bmId && a.business_manager_id === bmId) ||
          (bmName && a.business_manager_name?.toLowerCase() === bmName.toLowerCase()),
      )

      const activeCount = linked.filter((a) => a.status === 'active').length
      const restrictedCount = linked.filter((a) => a.status === 'restricted').length
      const disabledCount = linked.filter((a) => a.status === 'disabled').length

      let totalDebtVnd = 0
      let legalEntity = ''
      const viaSet = new Set<string>()

      for (const a of linked) {
        const bal = Number(a.billing_meta?.balance_raw ?? a.spend_periods?.balance_raw ?? 0) || 0
        if ((a.currency || 'VND') !== 'USD') {
          totalDebtVnd += bal
        }
        if (!legalEntity && a.billing_meta?.business_legal_name) {
          legalEntity = a.billing_meta.business_legal_name
        }
        for (const fid of a.facebook_identities ?? []) {
          if (fid.label) viaSet.add(fid.label)
        }
      }

      const isVerified =
        linked.length > 5 ||
        Boolean(legalEntity && /công ty|tnhh|cổ phần|llc|inc|ltd/i.test(legalEntity)) ||
        /công ty|tnhh|xmdn|top/i.test(bmName)

      const quotaMax = linked.length > 10 ? 30 : isVerified ? 10 : linked.length > 1 ? 5 : 5
      const tierLabel =
        quotaMax >= 30 ? 'BM30 (Đã XMDN)' : isVerified ? 'BM10 (Đã XMDN)' : linked.length >= 2 ? 'BM5 (Chưa XMDN)' : 'BM1→BM5'

      return {
        id: bm.id,
        label: bmName,
        externalId: bmId || 'Chưa có ID',
        totalAccounts: linked.length,
        activeCount,
        restrictedCount,
        disabledCount,
        totalDebtVnd,
        legalEntity,
        isVerified,
        quotaMax,
        tierLabel,
        vias: Array.from(viaSet),
      }
    })
  }, [bmQuery.data, accountsQuery.data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title={t('bm.title')} />
        <Link
          to="/operations-guide"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-light px-3 py-1.5 text-xs font-bold text-brand-text hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>📖 Xem Checklist Hồ sơ XMDN &amp; Công thức Vận hành →</span>
        </Link>
      </div>

      <QuickMetaSyncBanner />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            1. Hạn mức Via → BM
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            Tự tạo tối đa <span className="text-brand-text">2 BM / Via</span> (Via cổ: 4 BM)
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            An toàn: Mỗi Via gốc chỉ cầm <strong>1–2 BM</strong>. Nick chính nhận quyền qua <strong>BM Đối tác (Partner)</strong> không giới hạn.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            2. Hạn mức BM → Tài khoản QC
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            Chưa XMDN: <span className="text-warning-text">1 → 3 → 5 TKQC</span> · Đã XMDN: <span className="text-success-text">5 → 10 → 30 → 250+ TKQC</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            BM mới tạo được 1 TKQC; sau bill đầu tiên lên 3–5 TKQC; Xác minh doanh nghiệp (XMDN) mở 10–30+ TKQC.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            3. Hạn mức 1 Thẻ → Tài khoản QC
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            An toàn: <span className="text-success-text">1–3 TKQC / Thẻ</span> · Trần Meta: <span className="text-danger-text">9–10 TKQC / Thẻ</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            Không gắn quá 3 TKQC chung 1 thẻ trực tiếp để tránh chết liên đới (bão thẻ) khi 1 TKQC bị khoá hoặc hụt tiền.
          </div>
        </div>
      </div>

      {/* LIVE BM QUOTA & XMDN MATRIX */}
      {bmMatrix.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <Building2 className="h-4 w-4 text-brand-text" />
                <span>Bảng Kiểm Soát Hạn Mức BM Thực Tế (BM1 → BM5 → BM10+ XMDN) &amp; Dư Nợ Theo BM</span>
              </span>
              <Badge tone="info">{bmMatrix.length} Business Manager đang quản lý</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bmMatrix.map((bm) => {
                const pct = Math.min(100, Math.round((bm.totalAccounts / bm.quotaMax) * 100))
                return (
                  <div
                    key={bm.id}
                    className="rounded-lg border border-line bg-surface-muted/30 p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-ink truncate" title={bm.label}>
                          {bm.label}
                        </div>
                        <div className="font-mono text-[11px] text-ink-muted">ID: {bm.externalId}</div>
                      </div>
                      <Badge tone={bm.isVerified ? 'positive' : 'caution'}>
                        {bm.isVerified ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> {bm.tierLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ShieldAlert className="h-3 w-3" /> {bm.tierLabel}
                          </span>
                        )}
                      </Badge>
                    </div>

                    {/* Progress bar of Ad Accounts vs Quota */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ink-muted">Sử dụng hạn mức TKQC:</span>
                        <span className="font-mono font-bold text-ink">
                          {bm.totalAccounts} / {bm.quotaMax} TKQC ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 90 ? 'bg-amber-500' : 'bg-brand'
                          }`}
                          style={{ width: `${Math.max(8, pct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line pt-2 text-[11px]">
                      <span>
                        🟢 <strong>{bm.activeCount}</strong> chạy · 🟡 <strong>{bm.restrictedCount}</strong> nợ · 🔴{' '}
                        <strong>{bm.disabledCount}</strong> tắt
                      </span>
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        Nợ: {bm.totalDebtVnd.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>

                    <div className="text-[11px] text-ink-muted truncate">
                      👤 Via cầm BM:{' '}
                      <strong className="text-ink">
                        {bm.vias.length > 0 ? bm.vias.slice(0, 3).join(', ') : 'Tài Khoản Chính'}
                      </strong>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('bm.title')}>
          <TabsTrigger value="bm">{t('bm.tab.bm')}</TabsTrigger>
          <TabsTrigger value="personal">{t('bm.tab.personal')}</TabsTrigger>
        </TabsList>
        <TabsContent value="bm">
          <ReferenceManager spec={BUSINESS_MANAGERS} />
        </TabsContent>
        <TabsContent value="personal">
          <ReferenceManager spec={PERSONAL_REFERENCES} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
