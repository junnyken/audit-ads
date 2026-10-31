import { useState } from 'react'
import ReferenceManager from '../components/ReferenceManager'
import { QuickMetaSyncBanner } from '../components/meta/QuickMetaSyncBanner'
import { PageHeader } from '../components/page/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { useI18n } from '../i18n'
import { BUSINESS_MANAGERS, PERSONAL_REFERENCES } from '../lib/resources'

export default function BusinessManagers() {
  const { t } = useI18n()
  const [tab, setTab] = useState('bm')
  return (
    <div className="space-y-4">
      <PageHeader title={t('bm.title')} />
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
