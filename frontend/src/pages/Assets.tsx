import { useState } from 'react'
import ReferenceManager from '../components/ReferenceManager'
import { Tabs } from '../components/ui'
import {
  BROWSER_REFERENCES,
  PAGES,
  PAYMENT_REFERENCES,
  PIXELS,
  PROXY_REFERENCES,
} from '../lib/resources'

const SPECS = [PAGES, PIXELS, PAYMENT_REFERENCES, BROWSER_REFERENCES, PROXY_REFERENCES]
const TABS = SPECS.map((spec) => ({ key: spec.key, label: spec.plural }))

export default function Assets() {
  const [tab, setTab] = useState(SPECS[0].key)
  const active = SPECS.find((spec) => spec.key === tab) ?? SPECS[0]
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Assets and operational references</h1>
        <p className="text-[12.5px] text-ink-muted">
          The things an account is linked to. Browser and proxy entries are non-secret operator
          labels: they describe how you work, not how anyone signs in.
        </p>
      </header>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <ReferenceManager key={active.key} spec={active} />
    </div>
  )
}
