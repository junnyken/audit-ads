import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { AccountCreationBatchDetail, MetaConnection } from '../../lib/types'
import { Badge, Card, ErrorState, Field } from '../../components/ui'
import { BATCH_ITEM_STATUS_LABEL, batchItemStatusTone } from '../../lib/meta'

interface DraftRow {
  name: string
  currency: string
  country: string
}

const EMPTY_ROW: DraftRow = { name: '', currency: 'VND', country: '' }

const STEPS = ['Connection & BM', 'Ad accounts', 'Preview', 'Confirm', 'Result']

export default function CreateAccountWizard() {
  const [step, setStep] = useState(0)
  const [connectionId, setConnectionId] = useState('')
  const [businessManagerId, setBusinessManagerId] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }])
  const [batch, setBatch] = useState<AccountCreationBatchDetail | null>(null)

  const connections = useQuery({
    queryKey: ['meta-connections'],
    queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
  })
  const connection = connections.data?.find((item) => item.id === connectionId) ?? null
  const canCreate = connection?.capabilities?.create_ad_account === true

  const draft = useMutation({
    mutationFn: () =>
      api.post<AccountCreationBatchDetail>('/api/v1/account-creation-batches', {
        meta_connection_id: connectionId,
        business_manager_external_id: businessManagerId,
        items: rows
          .filter((row) => row.name.trim())
          .map((row) => ({ name: row.name.trim(), currency: row.currency, country: row.country || null })),
      }),
    onSuccess: (result) => {
      setBatch(result)
      setStep(2)
    },
  })

  const confirm = useMutation({
    mutationFn: () =>
      api.post<AccountCreationBatchDetail>(`/api/v1/account-creation-batches/${batch!.batch.id}/confirm`, {
        preview_hash: batch!.current_preview_hash,
      }),
    onSuccess: (result) => {
      setBatch(result)
      setStep(4)
    },
  })

  const run = useMutation({
    mutationFn: () => api.post<AccountCreationBatchDetail>(`/api/v1/account-creation-batches/${batch!.batch.id}/run`),
    onSuccess: (result) => {
      setBatch(result)
      setStep(4)
    },
  })

  const reconcile = useMutation({
    mutationFn: (itemId: string) => api.post(`/api/v1/account-creation-batches/items/${itemId}/reconcile`),
    onSuccess: async () => {
      const refreshed = await api.get<AccountCreationBatchDetail>(`/api/v1/account-creation-batches/${batch!.batch.id}`)
      setBatch(refreshed)
    },
  })

  return (
    <div className="space-y-4">
      <nav className="text-[12px] text-ink-muted">
        <Link to="/operations" className="hover:underline">
          Operations
        </Link>
        <span className="mx-1">/</span>
        <span className="text-ink">Create ad accounts</span>
      </nav>

      <ol className="flex flex-wrap gap-2 text-[12px]">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full border px-2.5 py-1 ${
              index === step ? 'border-brand bg-brand-light text-brand-dark font-medium' : 'border-line text-ink-faint'
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card title="Step 1 — Choose Meta Connection + Business Manager">
          <div className="space-y-3">
            <Field label="Meta Connection" required>
              <select className="input" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                <option value="">— Choose a connection —</option>
                {(connections.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.environment})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-ink-faint">
                No connection with a checked, allowed capability?{' '}
                <Link to="/meta-connections" className="text-brand hover:underline">
                  Set one up first
                </Link>
                .
              </p>
            </Field>
            {connection && !canCreate && (
              <p className="text-[12.5px] text-rose-700">
                This connection's last capability check says `create_ad_account` is not allowed
                {connection.capabilities?.reason ? ` (${connection.capabilities.reason})` : ''}.
              </p>
            )}
            <Field label="Business Manager external ID" required>
              <input
                className="input"
                value={businessManagerId}
                onChange={(event) => setBusinessManagerId(event.target.value)}
                placeholder="bm_..."
              />
              {connection?.business_managers && connection.business_managers.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {connection.business_managers.map((bm) => (
                    <button
                      key={bm.external_id}
                      type="button"
                      className="rounded border border-line px-1.5 py-0.5 text-[11px] hover:bg-surface-muted"
                      onClick={() => setBusinessManagerId(bm.external_id)}
                    >
                      {bm.name}
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <button
              type="button"
              className="btn-primary"
              disabled={!connectionId || !businessManagerId.trim() || !canCreate}
              onClick={() => setStep(1)}
            >
              Next
            </button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="Step 2 — Enter one or more ad accounts">
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_100px_80px_auto] items-end gap-2">
                <Field label="Name" htmlFor={`name-${index}`}>
                  <input
                    id={`name-${index}`}
                    className="input"
                    value={row.name}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, name: event.target.value }
                      setRows(next)
                    }}
                    maxLength={200}
                  />
                </Field>
                <Field label="Currency">
                  <input
                    className="input uppercase"
                    value={row.currency}
                    maxLength={3}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, currency: event.target.value.toUpperCase() }
                      setRows(next)
                    }}
                  />
                </Field>
                <Field label="Country">
                  <input
                    className="input uppercase"
                    value={row.country}
                    maxLength={2}
                    placeholder="VN"
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, country: event.target.value.toUpperCase() }
                      setRows(next)
                    }}
                  />
                </Field>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  disabled={rows.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>
              + Add another account
            </button>
            <div className="flex justify-between pt-2">
              <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={rows.every((row) => !row.name.trim()) || draft.isPending}
                onClick={() => draft.mutate()}
              >
                {draft.isPending ? 'Preparing preview…' : 'Validate + Preview'}
              </button>
            </div>
            {draft.isError && <ErrorState error={draft.error} />}
          </div>
        </Card>
      )}

      {step === 2 && batch && (
        <Card title="Step 3 — Preview exactly what will be created">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            {batch.items.length} ad account{batch.items.length === 1 ? '' : 's'} under BM{' '}
            <span className="font-mono">{batch.batch.business_manager_external_id}</span>.
          </p>
          <div className="table-scroll">
            <table className="w-full min-w-[500px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Currency</th>
                  <th className="th">Country</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td">{item.name}</td>
                    <td className="td font-mono">{item.currency}</td>
                    <td className="td font-mono">{item.country ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              Back and edit
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>
              Looks right — continue
            </button>
          </div>
        </Card>
      )}

      {step === 3 && batch && (
        <Card title="Step 4 — Confirm the batch">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Confirming locks in exactly the {batch.items.length} account(s) shown in the preview.
            If anything changes before this point, confirming is refused and you preview again.
          </p>
          {confirm.isError && <ErrorState error={confirm.error} />}
          <div className="flex justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
              Back to preview
            </button>
            <button type="button" className="btn-primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? 'Confirming…' : 'Confirm batch'}
            </button>
          </div>
        </Card>
      )}

      {step === 4 && batch && (
        <Card title="Step 5 — Result">
          {batch.items.some((item) => item.status === 'queued') && (
            <button type="button" className="btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? 'Running…' : 'Run queue'}
            </button>
          )}
          {run.isError && <ErrorState error={run.error} />}
          <div className="table-scroll mt-3">
            <table className="w-full min-w-[600px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Status</th>
                  <th className="th">Result</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td">{item.name}</td>
                    <td className="td">
                      <Badge tone={batchItemStatusTone(item.status)}>{BATCH_ITEM_STATUS_LABEL[item.status]}</Badge>
                    </td>
                    <td className="td text-[12px]">
                      {item.external_account_id ? (
                        <span className="font-mono">{item.external_account_id}</span>
                      ) : item.failure_summary ? (
                        <span className="text-rose-700">{item.failure_summary}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td">
                      {item.status === 'unknown' && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={reconcile.isPending}
                          onClick={() => reconcile.mutate(item.id)}
                        >
                          Reconcile
                        </button>
                      )}
                      {item.synced_ad_account_id && (
                        <Link to={`/accounts/${item.synced_ad_account_id}`} className="btn-secondary">
                          Open account
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
