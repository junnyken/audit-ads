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
      <PageHeader title={t('bm.title')} description={t('bm.desc')} />
      <QuickMetaSyncBanner />
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
