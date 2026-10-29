import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab = SPECS.some((s) => s.key === requestedTab) ? requestedTab! : SPECS[0].key
  const [tab, setTab] = useState(initialTab)

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
      <PageHeader title={t('assets.title')} description={t('assets.desc')} />
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
