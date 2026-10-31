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
            1. H???n m???c Via ??? BM
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            T??? t???o t???i ??a <span className="text-brand-text">2 BM / Via</span> (Via c???: 4 BM)
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            An to??n: M???i Via g???c ch??? c???m <strong>1???2 BM</strong>. Nick ch??nh nh???n quy???n qua <strong>BM ?????i t??c (Partner)</strong> kh??ng gi???i h???n.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            2. H???n m???c BM ??? T??i kho???n QC
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            Ch??a XMDN: <span className="text-warning-text">1 ??? 3 ??? 5 TKQC</span> ?? ???? XMDN: <span className="text-success-text">5 ??? 10 ??? 30 ??? 250+ TKQC</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            BM m???i t???o ???????c 1 TKQC; sau bill ?????u ti??n l??n 3???5 TKQC; X??c minh doanh nghi???p (XMDN) m??? 10???30+ TKQC.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            3. H???n m???c 1 Th??? ??? T??i kho???n QC
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            An to??n: <span className="text-success-text">1???3 TKQC / Th???</span> ?? Tr???n Meta: <span className="text-danger-text">9???10 TKQC / Th???</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            Kh??ng g???n qu?? 3 TKQC chung 1 th??? tr???c ti???p ????? tr??nh ch???t li??n ?????i (b??o th???) khi 1 TKQC b??? kho?? ho???c h???t ti???n.
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
