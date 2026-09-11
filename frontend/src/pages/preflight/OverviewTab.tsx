import type { ReactNode } from 'react'
import type { CampaignDraft } from '../../lib/types'
import { Card } from '../../components/ui'

export default function OverviewTab({ draft }: { draft: CampaignDraft }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Identity">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Title">{draft.title}</Row>
          <Row label="Account">{draft.account_display_name ?? '—'}</Row>
          <Row label="Objective">{draft.objective ?? '—'}</Row>
        </dl>
      </Card>

      <Card title="Copy">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Primary copy">
            <span className="whitespace-pre-wrap">{draft.primary_copy || '—'}</span>
          </Row>
          <Row label="Headline">{draft.headline ?? '—'}</Row>
          <Row label="Description">{draft.description ?? '—'}</Row>
          <Row label="Call to action">{draft.call_to_action ?? '—'}</Row>
        </dl>
      </Card>

      <Card title="Landing page & creative">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Landing page URL">
            {draft.landing_page_url ? (
              <a href={draft.landing_page_url} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
                {draft.landing_page_url}
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Creative reference">{draft.creative_reference ?? '—'}</Row>
        </dl>
      </Card>

      <Card title="Budget & targeting">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Budget">
            {draft.budget_amount ? `${draft.budget_amount} ${draft.budget_currency ?? ''}` : '—'}
          </Row>
          <Row label="% change vs. current">
            {draft.budget_change_percent !== null ? `${draft.budget_change_percent}%` : '—'}
          </Row>
          <Row label="Targeting summary">
            <span className="whitespace-pre-wrap">{draft.targeting_summary ?? '—'}</span>
          </Row>
        </dl>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}
