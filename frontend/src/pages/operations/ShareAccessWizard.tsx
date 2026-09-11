import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { AccessShareBatchDetail, MetaConnection } from '../../lib/types'
import { Badge, Card, ErrorState, Field } from '../../components/ui'
import { BATCH_ITEM_STATUS_LABEL, batchItemStatusTone } from '../../lib/meta'

interface DraftRow {
  sourceExternalAccountId: string
  recipientReference: string
  role: string
}

const EMPTY_ROW: DraftRow = { sourceExternalAccountId: '', recipientReference: '', role: 'advertiser' }
const STEPS = ['Connection', 'Source & recipients', 'Preview', 'Confirm', 'Result']

export default function ShareAccessWizard() {
  const [step, setStep] = useState(0)
  const [connectionId, setConnectionId] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }])
  const [batch, setBatch] = useState<AccessShareBatchDetail | null>(null)

  const connections = useQuery({
    queryKey: ['meta-connections'],
    queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
  })
  const connection = connections.data?.find((item) => item.id === connectionId) ?? null
  const canShare = connection?.capabilities?.share_ad_account_access === true

  const draft = useMutation({
    mutationFn: () =>
      api.post<AccessShareBatchDetail>('/api/v1/access-share-batches', {
        meta_connection_id: connectionId,
        items: rows
          .filter((row) => row.sourceExternalAccountId.trim() && row.recipientReference.trim())
          .map((row) => ({
            source_external_account_id: row.sourceExternalAccountId.trim(),
            recipient_reference: row.recipientReference.trim(),
            role: row.role,
          })),
      }),
    onSuccess: (result) => {
      setBatch(result)
      setStep(2)
    },
  })

  const confirm = useMutation({
    mutationFn: () =>
      api.post<AccessShareBatchDetail>(`/api/v1/access-share-batches/${batch!.batch.id}/confirm`, {
        preview_hash: batch!.current_preview_hash,
      }),
    onSuccess: (result) => {
      setBatch(result)
      setStep(4)
    },
  })

  const run = useMutation({
    mutationFn: () => api.post<AccessShareBatchDetail>(`/api/v1/access-share-batches/${batch!.batch.id}/run`),
    onSuccess: (result) => {
      setBatch(result)
      setStep(4)
    },
  })

  return (
    <div className="space-y-4">
      <nav className="text-[12px] text-ink-muted">
        <Link to="/operations" className="hover:underline">
          Operations
        </Link>
        <span className="mx-1">/</span>
        <span className="text-ink">Share ad-account access</span>
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
        <Card title="Step 1 — Choose Meta Connection">
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
            </Field>
            {connection && !canShare && (
              <p className="text-[12.5px] text-rose-700">
                This connection's last capability check says `share_ad_account_access` is not
                allowed{connection.capabilities?.reason ? ` (${connection.capabilities.reason})` : ''}.
              </p>
            )}
            <button type="button" className="btn-primary" disabled={!connectionId || !canShare} onClick={() => setStep(1)}>
              Next
            </button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="Step 2 — Source account, recipient and role">
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_140px_auto] items-end gap-2">
                <Field label="Source ad account ID">
                  <input
                    className="input"
                    value={row.sourceExternalAccountId}
                    placeholder="act_..."
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, sourceExternalAccountId: event.target.value }
                      setRows(next)
                    }}
                  />
                </Field>
                <Field label="Recipient">
                  <input
                    className="input"
                    value={row.recipientReference}
                    placeholder="system_user:... or email"
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, recipientReference: event.target.value }
                      setRows(next)
                    }}
                  />
                </Field>
                <Field label="Role">
                  <select
                    className="input"
                    value={row.role}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, role: event.target.value }
                      setRows(next)
                    }}
                  >
                    <option value="advertiser">Advertiser</option>
                    <option value="analyst">Analyst</option>
                    <option value="admin">Admin</option>
                  </select>
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
              + Add another grant
            </button>
            <div className="flex justify-between pt-2">
              <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={rows.every((row) => !row.sourceExternalAccountId.trim()) || draft.isPending}
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
        <Card title="Step 3 — Preview exactly what will be shared">
          <div className="table-scroll">
            <table className="w-full min-w-[500px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Source account</th>
                  <th className="th">Recipient</th>
                  <th className="th">Role</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td font-mono">{item.source_external_account_id}</td>
                    <td className="td">{item.recipient_reference}</td>
                    <td className="td">{item.role}</td>
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
                  <th className="th">Source account</th>
                  <th className="th">Recipient</th>
                  <th className="th">Status</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td font-mono">{item.source_external_account_id}</td>
                    <td className="td">{item.recipient_reference}</td>
                    <td className="td">
                      <Badge tone={batchItemStatusTone(item.status)}>{BATCH_ITEM_STATUS_LABEL[item.status]}</Badge>
                    </td>
                    <td className="td text-[12px]">
                      {item.access_grant_reference ?? item.failure_summary ?? '—'}
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
