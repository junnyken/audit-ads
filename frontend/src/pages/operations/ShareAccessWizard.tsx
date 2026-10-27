import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AccessShareBatchDetail, MetaConnection } from '../../lib/types'
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
  sourceExternalAccountId: string
  recipientReference: string
  role: string
}

const EMPTY_ROW: DraftRow = { sourceExternalAccountId: '', recipientReference: '', role: 'advertiser' }
const ROLES = ['advertiser', 'analyst', 'admin']

export default function ShareAccessWizard() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [step, setStep] = useState(0)
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [rows, setRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }])
  const [batch, setBatch] = useState<AccessShareBatchDetail | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const connectionId = connection?.id ?? ''

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
      setConfirmRun(false)
      setStep(4)
    },
  })

  const update = (index: number, patch: Partial<DraftRow>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const stepLabels = [t('op.share.s1'), t('op.share.s2'), t('op.create.s3'), t('op.create.s4'), t('op.create.s5')]
  const queued = batch?.items.some((item) => item.status === 'queued') ?? false

  return (
    <div className="space-y-4">
      <WizardHeader crumb={t('op.share.crumb')} steps={stepLabels} current={step} />

      {step === 0 && (
        <StepCard title={t('op.share.t1')}>
          <ConnectionPicker connectionId={connectionId} capability="share_ad_account_access" onChange={(_, next) => setConnection(next)}>
            {(_current, allowed) => (
              <Button type="button" disabled={!connectionId || !allowed} onClick={() => setStep(1)}>
                {t('op.next')}
              </Button>
            )}
          </ConnectionPicker>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard title={t('op.share.t2')}>
          {rows.map((row, index) => (
            <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_160px_auto]">
              <Field label={t('op.share.source')} htmlFor={`source-${index}`}>
                <input
                  id={`source-${index}`}
                  className="input font-mono"
                  value={row.sourceExternalAccountId}
                  placeholder={t('op.share.source.placeholder')}
                  onChange={(event) => update(index, { sourceExternalAccountId: event.target.value })}
                />
              </Field>
              <Field label={t('op.share.recipient')} htmlFor={`recipient-${index}`}>
                <input
                  id={`recipient-${index}`}
                  className="input"
                  value={row.recipientReference}
                  placeholder={t('op.share.recipient.placeholder')}
                  onChange={(event) => update(index, { recipientReference: event.target.value })}
                />
              </Field>
              <Field label={t('op.share.role')} htmlFor={`role-${index}`}>
                <select id={`role-${index}`} className="input" value={row.role} onChange={(event) => update(index, { role: event.target.value })}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {enumLabel('shareRole', role)}
                    </option>
                  ))}
                </select>
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
            {t('op.share.add')}
          </Button>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              {t('op.back')}
            </Button>
            <Button type="button" disabled={rows.every((row) => !row.sourceExternalAccountId.trim()) || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? t('op.preparing') : t('op.validate')}
            </Button>
          </div>
          {draft.isError && <ErrorState error={draft.error} title={t('op.error.draft')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
        </StepCard>
      )}

      {step === 2 && batch && (
        <StepCard title={t('op.share.t3')}>
          <Table cards aria-label={t('op.share.t3')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('op.share.col.source')}</TableHead>
                <TableHead>{t('op.share.col.recipient')}</TableHead>
                <TableHead>{t('op.share.col.role')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell label={t('op.share.col.source')} className="cell-title font-mono">{item.source_external_account_id}</TableCell>
                  <TableCell label={t('op.share.col.recipient')}>{item.recipient_reference}</TableCell>
                  <TableCell label={t('op.share.col.role')}>{enumLabel('shareRole', item.role)}</TableCell>
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
          <p className="text-sm text-ink-muted">{t('op.share.confirm.body', { count: batch.items.length })}</p>
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
          <Table cards aria-label={t('op.create.t5')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('op.share.col.source')}</TableHead>
                <TableHead>{t('op.share.col.recipient')}</TableHead>
                <TableHead>{t('op.share.col.status')}</TableHead>
                <TableHead>{t('op.share.col.result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell label={t('op.share.col.source')} className="cell-title font-mono">{item.source_external_account_id}</TableCell>
                  <TableCell label={t('op.share.col.recipient')}>{item.recipient_reference}</TableCell>
                  <TableCell label={t('op.share.col.status')}>
                    <Badge tone={batchItemStatusTone(item.status)}>{enumLabel('batchItemStatus', item.status)}</Badge>
                  </TableCell>
                  <TableCell label={t('op.share.col.result')} className="text-xs">
                    {item.access_grant_reference ?? item.failure_summary ?? '—'}
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
        title={t('op.share.dialog.title', { count: batch?.items.length ?? 0 })}
        object={t('op.share.dialog.object', {
          connection: connection?.label ?? '—',
          env: connection ? enumLabel('metaEnv', connection.environment) : '—',
        })}
        effects={[t('op.share.dialog.effect'), t('op.dialog.scope'), t('op.dialog.reversible')]}
        confirmLabel={t('op.dialog.confirm')}
        typedPhrase={t('op.phrase')}
        pending={run.isPending}
        error={run.isError ? run.error : undefined}
        onConfirm={() => run.mutate()}
      />
    </div>
  )
}
