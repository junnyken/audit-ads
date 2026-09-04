import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CurrentUser } from '../lib/types'
import { Card, InlineNote, Skeleton } from '../components/ui'
import { useAuth } from '../hooks/useAuth'

export default function Settings() {
  const { user } = useAuth()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<CurrentUser>('/api/v1/auth/me'),
    initialData: user ?? undefined,
  })

  if (!me.data) return <Skeleton rows={4} />

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Settings</h1>
        <p className="text-[12.5px] text-ink-muted">Workspace and account information.</p>
      </header>

      <Card title="Signed in as">
        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,200px)_1fr]">
          <dt className="text-ink-faint">Email</dt>
          <dd>{me.data.email}</dd>
          <dt className="text-ink-faint">Name</dt>
          <dd>{me.data.full_name || '—'}</dd>
          <dt className="text-ink-faint">Role</dt>
          <dd>{me.data.role}</dd>
          <dt className="text-ink-faint">Workspace</dt>
          <dd>
            {me.data.workspace.name}{' '}
            <span className="font-mono text-[11.5px] text-ink-faint">({me.data.workspace.slug})</span>
          </dd>
        </dl>
      </Card>

      <Card title="What this release does not do">
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-muted">
          <li>It never stores passwords, cookies, session data, tokens or proxy credentials.</li>
          <li>It does not connect to, or change anything on, an advertising platform.</li>
          <li>It runs no browser automation and rotates no proxies.</li>
          <li>It never claims an account cannot be restricted, or that an ad will be approved.</li>
          <li>It hard-deletes nothing: archive is reversible and audit history is permanent.</li>
        </ul>
        <InlineNote>
          Role management is not editable yet. The data model already carries workspace roles, so
          a later MINI-SPEC can add team assignment without a migration of intent.
        </InlineNote>
      </Card>
    </div>
  )
}
