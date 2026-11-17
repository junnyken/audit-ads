import { useState } from 'react'
import ReferenceManager from '../components/ReferenceManager'
import { PageHeader } from '../components/page/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { useI18n } from '../i18n'
import {
  BROWSER_REFERENCES,
  PAGES,
  PAYMENT_REFERENCES,
  PIXELS,
  PROXY_REFERENCES,
} from '../lib/resources'

const SPECS = [PAGES, PIXELS, PAYMENT_REFERENCES, BROWSER_REFERENCES, PROXY_REFERENCES]

export default function Assets() {
  const { t } = useI18n()
  const [tab, setTab] = useState(SPECS[0].key)
  return (
    <div className="space-y-4">
      <PageHeader title={t('assets.title')} description={t('assets.desc')} />
      <Tabs value={tab} onValueChange={setTab}>
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
