import { Link } from 'react-router-dom'
import { Card } from '../components/ui'

/** Deliberately four cards, three live (A7 create/share + A8 pixel share). The remaining
 * placeholder never gets an execute button until it's actually built — so this page never
 * grows past what is actually built, and never dresses up a placeholder as a working feature. */
export default function Operations() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Operations</h1>
        <p className="text-[12.5px] text-ink-muted">
          Batch actions against the official Meta API — nothing here ever runs without an
          explicit preview and confirm.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Create ad accounts">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Create one or more ad accounts under a Business Manager, through the official Meta
            API — draft, preview, confirm, then a sequential queue with per-item results.
          </p>
          <Link to="/operations/create-accounts" className="btn-primary">
            Start
          </Link>
        </Card>

        <Card title="Share ad-account access">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Grant access on an existing ad account to a person, BM or system user, using a role
            the official API actually permits.
          </p>
          <Link to="/operations/share-access" className="btn-primary">
            Start
          </Link>
        </Card>

        <Card title="Bulk Pixel share">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Share a Pixel across many ad accounts in one batch, reusing this same preview →
            confirm → queue engine.
          </p>
          <Link to="/operations/pixel-share" className="btn-primary">
            Start
          </Link>
        </Card>

        <Card title="Team seats">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Invite staff, assign roles, and scope which BMs and ad accounts each person can see.
          </p>
          <Link to="/team" className="btn-primary">
            Start
          </Link>
        </Card>
      </div>

      <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[11.5px] text-ink-muted">
        Unlimited internal records. Meta creation, sharing, rate, billing, and permission limits
        still apply.
      </p>
    </div>
  )
}
