import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { MetaConnection, MetaEnvironment } from '../lib/types'
import { Badge, Card, EmptyState, ErrorState, Field, Skeleton } from '../components/ui'
import { DiscoverySection } from '../components/meta/DiscoverySection'
import { formatDateTime } from '../lib/format'

function EnvironmentBadge({ environment }: { environment: string }) {
  if (environment === 'fake') return <Badge tone="neutral">Fake (local testing)</Badge>
  if (environment === 'sandbox') return <Badge tone="info">Sandbox</Badge>
  return <Badge tone="caution">Production</Badge>
}

function CapabilityRow({ label, allowed }: { label: string; allowed: boolean | undefined }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      {allowed === undefined ? (
        <span className="text-ink-faint">Not checked yet</span>
      ) : allowed ? (
        <Badge tone="positive">Allowed</Badge>
      ) : (
        <Badge tone="attention">Not allowed</Badge>
      )}
    </div>
  )
}

function ConnectionCard({ connection }: { connection: MetaConnection }) {
  const queryClient = useQueryClient()
  const check = useMutation({
    mutationFn: () => api.post<MetaConnection>(`/api/v1/meta-connections/${connection.id}/check-capability`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meta-connections'] }),
  })

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {connection.label}
          <EnvironmentBadge environment={connection.environment} />
          {connection.business_manager_source === 'server' && (
            // Inheriting is legitimate, but it means this card is not about a business of its
            // own: every inheriting connection reads the one configured Business Manager.
            <Badge tone="neutral">Uses the server&apos;s Business Manager</Badge>
          )}
        </span>
      }
      action={
        <button type="button" className="btn-secondary" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? 'Checking…' : 'Check capability'}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-ink-muted">Token configured</span>
          <Badge tone={connection.token_configured ? 'positive' : 'attention'}>
            {connection.token_configured ? 'Yes' : 'No'}
          </Badge>
        </div>
        <CapabilityRow label="List Business Managers" allowed={connection.capabilities?.list_business_managers} />
        <CapabilityRow label="Create ad account" allowed={connection.capabilities?.create_ad_account} />
        <CapabilityRow label="Share ad-account access" allowed={connection.capabilities?.share_ad_account_access} />
        {connection.capabilities?.reason && (
          <p className="text-[11.5px] text-rose-700">Reason: {connection.capabilities.reason}</p>
        )}
        <p className="text-[11.5px] text-ink-faint">
          Last checked: {connection.last_capability_check_at ? formatDateTime(connection.last_capability_check_at) : 'never'}
        </p>
        {connection.business_managers && connection.business_managers.length > 0 && (
          <div>
            <p className="mb-1 text-[11.5px] font-medium text-ink-muted">Business Managers visible to this connection</p>
            <ul className="space-y-0.5 text-[12px]">
              {connection.business_managers.map((bm) => (
                <li key={bm.external_id} className="font-mono text-[11.5px]">
                  {bm.name} ({bm.external_id})
                </li>
              ))}
            </ul>
          </div>
        )}
        <DiscoverySection connectionId={connection.id} connectionLabel={connection.label} />
      </div>
    </Card>
  )
}

export default function MetaConnections() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const connections = useQuery({
    queryKey: ['meta-connections'],
    queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
  })

  const [environment, setEnvironment] = useState<MetaEnvironment>('fake')
  const [businessManager, setBusinessManager] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api.post<MetaConnection>('/api/v1/meta-connections', {
        label,
        environment,
        business_manager_reference: businessManager.trim(),
      }),
    onSuccess: () => {
      setLabel('')
      setBusinessManager('')
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
    },
  })

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Meta Connection</h1>
        <p className="text-[12.5px] text-ink-muted">
          What this workspace can do against the Meta API right now — never the credential
          itself, only whether one is configured and what it is allowed to do.
        </p>
      </header>

      <Card title="Add a connection">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <div className="min-w-[220px] flex-1">
            <Field label="Label" htmlFor="connection-label">
              <input
                id="connection-label"
                className="input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. Agency BM — fake"
                maxLength={200}
                required
              />
            </Field>
          </div>
          <div className="min-w-[180px]">
            <Field label="Environment" htmlFor="connection-environment">
              <select
                id="connection-environment"
                className="input"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as MetaEnvironment)}
              >
                <option value="fake">Fake (local testing)</option>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </Field>
          </div>
          <div className="min-w-[220px]">
            <Field label="Business Manager ID" htmlFor="connection-bm">
              <input
                id="connection-bm"
                className="input"
                value={businessManager}
                onChange={(event) => setBusinessManager(event.target.value)}
                placeholder="Leave empty to use the server's"
                maxLength={120}
              />
            </Field>
          </div>
          <button type="submit" className="btn-primary" disabled={create.isPending || !label.trim()}>
            {create.isPending ? 'Adding…' : 'Add connection'}
          </button>
        </form>
        {create.isError && <ErrorState error={create.error} />}
        <p className="mt-2 text-[11.5px] text-ink-faint">
          Only <strong>Production</strong> can reach Meta, and only when the server also has a
          token configured — either condition missing and the connection quietly uses the fake
          provider rather than making a surprise call. Everything this build does against Meta is
          read-only: it cannot create, share or change anything.
        </p>
      </Card>

      {connections.isLoading ? (
        <Skeleton rows={4} />
      ) : connections.isError ? (
        <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
      ) : connections.data!.length === 0 ? (
        <EmptyState title="No Meta connection yet" description="Add one above to check capability and run batches." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {connections.data!.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} />
          ))}
        </div>
      )}
    </div>
  )
}
