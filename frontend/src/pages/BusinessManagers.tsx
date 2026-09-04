import { useState } from 'react'
import ReferenceManager from '../components/ReferenceManager'
import { Tabs } from '../components/ui'
import { BUSINESS_MANAGERS, PERSONAL_REFERENCES } from '../lib/resources'

const TABS = [
  { key: 'bm', label: 'Business Managers' },
  { key: 'personal', label: 'Personal account references' },
]

export default function BusinessManagers() {
  const [tab, setTab] = useState('bm')
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Ownership references</h1>
        <p className="text-[12.5px] text-ink-muted">
          Who an ad account belongs to. Every account maps to a Business Manager or a personal
          account reference — or is explicitly recorded as unknown.
        </p>
      </header>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'bm' ? (
        <ReferenceManager spec={BUSINESS_MANAGERS} />
      ) : (
        <ReferenceManager spec={PERSONAL_REFERENCES} />
      )}
    </div>
  )
}
