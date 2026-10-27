import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { AccountCreationBatchDetail, MetaConnection } from '../../lib/types'
import { batchItemStatusTone } from '../../lib/meta'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Field } from '../../components/primitives/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/primitives/table'
import { ErrorState } from '../../components/states'
import { ConfirmDialog } from '../../components/page/ConfirmDialog'
import { Note } from '../account/parts'
import { ConnectionPicker, ResultSummary, StepCard, WizardHeader } from '../../components/operations/WizardParts'

interface DraftRow {
  name: string
  currency: string
  country: string
}

const EMPTY_ROW: DraftRow = { name: '', currency: 'VND', country: '' }

export default function CreateAccountWizard() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [step, setStep] = useState(0)
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [businessManagerId, setBusinessManagerId] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }])
  const [batch, setBatch] = useState<AccountCreationBatchDetail | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const connectionId = connection?.id ?? ''

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
      setConfirmRun(false)
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

  const update = (index: number, patch: Partial<DraftRow>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const stepLabels = [t('op.create.s1'), t('op.create.s2'), t('op.create.s3'), t('op.create.s4'), t('op.create.s5')]
  const queued = batch?.items.some((item) => item.status === 'queued') ?? false

  return (
    <div className="space-y-4">
      <WizardHeader crumb={t('op.create.crumb')} steps={stepLabels} current={step} />

      {step === 0 && (
        <StepCard title={t('op.create.t1')}>
          <ConnectionPicker
            connectionId={connectionId}
            capability="create_ad_account"
            onChange={(_, next) => setConnection(next)}
          >
            {(current, allowed) => (
              <>
                <Field label={t('op.create.bm')} required htmlFor="op-bm">
                  <input
                    id="op-bm"
                    className="input font-mono"
                    value={businessManagerId}
                    onChange={(event) => setBusinessManagerId(event.target.value)}
                    placeholder={t('op.create.bm.placeholder')}
                  />
                  {current?.business_managers && current.business_managers.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {current.business_managers.map((bm) => (
                        <Button key={bm.external_id} type="button" variant="secondary" size="sm" onClick={() => setBusinessManagerId(bm.external_id)}>
                          {bm.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </Field>
                <Button type="button" disabled={!connectionId || !businessManagerId.trim() || !allowed} onClick={() => setStep(1)}>
                  {t('op.next')}
                </Button>
              </>
            )}
          </ConnectionPicker>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard title={t('op.create.t2')}>
          {rows.map((row, index) => (
            <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_100px_80px_auto]">
              <Field label={t('op.create.name')} htmlFor={`name-${index}`}>
                <input id={`name-${index}`} className="input" value={row.name} onChange={(event) => update(index, { name: event.target.value })} maxLength={200} />
              </Field>
              <Field label={t('op.create.currency')} htmlFor={`currency-${index}`}>
                <input
                  id={`currency-${index}`}
                  className="input font-mono uppercase"
                  value={row.currency}
                  maxLength={3}
                  onChange={(event) => update(index, { currency: event.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('op.create.country')} htmlFor={`country-${index}`}>
                <input
                  id={`country-${index}`}
                  className="input font-mono uppercase"
                  value={row.country}
                  maxLength={2}
                  placeholder="VN"
                  onChange={(event) => update(index, { country: event.target.value.toUpperCase() })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('op.removeNamed', { n: index + 1 })}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                disabled={rows.length === 1}
              >
                {t('op.remove')}
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>
            {t('op.create.add')}
          </Button>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              {t('op.back')}
            </Button>
            <Button type="button" disabled={rows.every((row) => !row.name.trim()) || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? t('op.preparing') : t('op.validate')}
            </Button>
          </div>
          {draft.isError && <ErrorState error={draft.error} title={t('op.error.draft')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
        </StepCard>
      )}

      {step === 2 && batch && (
        <StepCard title={t('op.create.t3')}>
          <p className="text-sm text-ink-muted">
            {t('op.create.preview.summary', { count: batch.items.length, bm: batch.batch.business_manager_external_id })}
          </p>
          <Table cards aria-label={t('op.create.t3')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('op.create.col.name')}</TableHead>
                <TableHead>{t('op.create.col.currency')}</TableHead>
                <TableHead>{t('op.create.col.country')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell label={t('op.create.col.name')} className="cell-title">{item.name}</TableCell>
                  <TableCell label={t('op.create.col.currency')} className="font-mono">{item.currency}</TableCell>
                  <TableCell label={t('op.create.col.country')} className="font-mono">{item.country ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between pt-1">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              {t('op.edit')}
            </Button>
            <Button type="button" onClick={() => setStep(3)}>
              {t('op.looksRight')}
            </Button>
          </div>
        </StepCard>
      )}

      {step === 3 && batch && (
        <StepCard title={t('op.create.t4')}>
          <p className="text-sm text-ink-muted">{t('op.create.confirm.body', { count: batch.items.length })}</p>
          {confirm.isError && (
            <>
              <ErrorState error={confirm.error} title={t('op.error.confirm')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
              <Note>{t('op.error.stale')}</Note>
            </>
          )}
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep(2)}>
              {t('op.backPreview')}
            </Button>
            <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? t('op.confirming') : t('op.confirm.batch')}
            </Button>
          </div>
        </StepCard>
      )}

      {step === 4 && batch && (
        <StepCard title={t('op.create.t5')}>
          {queued && (
            <Button type="button" disabled={run.isPending} onClick={() => setConfirmRun(true)}>
              {run.isPending ? t('op.running') : t('op.run.queue')}
            </Button>
          )}
          <ResultSummary statuses={batch.items.map((item) => item.status)} />
          {batch.items.some((item) => item.status === 'unknown') && <Note>{t('op.create.reconcileHint')}</Note>}
          {reconcile.isError && <ErrorState error={reconcile.error} title={t('op.create.error.reconcile')} compact />}
          <Table cards aria-label={t('op.create.t5')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('op.create.col.name')}</TableHead>
                <TableHead>{t('op.create.col.status')}</TableHead>
                <TableHead>{t('op.create.col.result')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('pg.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell label={t('op.create.col.name')} className="cell-title">{item.name}</TableCell>
                  <TableCell label={t('op.create.col.status')}>
                    <Badge tone={batchItemStatusTone(item.status)}>{enumLabel('batchItemStatus', item.status)}</Badge>
                  </TableCell>
                  <TableCell label={t('op.create.col.result')} className="text-xs">
                    {item.external_account_id ? (
                      <span className="font-mono">{item.external_account_id}</span>
                    ) : item.failure_summary ? (
                      <span className="text-tone-attention-fg">{item.failure_summary}</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {item.status === 'unknown' && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={reconcile.isPending}
                          aria-label={t('op.create.reconcileNamed', { name: item.name })}
                          onClick={() => reconcile.mutate(item.id)}
                        >
                          {t('op.create.reconcile')}
                        </Button>
                      )}
                      {item.synced_ad_account_id && (
                        <Button asChild variant="secondary" size="sm">
                          <Link to={`/accounts/${item.synced_ad_account_id}`}>{t('op.create.openAccount')}</Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </StepCard>
      )}

      <ConfirmDialog
        open={confirmRun}
        onCancel={() => {
          setConfirmRun(false)
          run.reset()
        }}
        title={t('op.create.dialog.title', { count: batch?.items.length ?? 0 })}
        object={t('op.create.dialog.object', {
          bm: batch?.batch.business_manager_external_id ?? businessManagerId,
          connection: connection?.label ?? '—',
          env: connection ? enumLabel('metaEnv', connection.environment) : '—',
        })}
        effects={[t('op.create.dialog.effect'), t('op.dialog.scope'), t('op.dialog.reversible')]}
        confirmLabel={t('op.dialog.confirm')}
        typedPhrase={t('op.phrase')}
        pending={run.isPending}
        error={run.isError ? run.error : undefined}
        onConfirm={() => run.mutate()}
      />
    </div>
  )
}
