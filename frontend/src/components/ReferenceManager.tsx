import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { Card } from './primitives/card'
import { Field } from './primitives/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './primitives/table'
import { EmptyState, ErrorState } from './states'
import { ConfirmDialog } from './page/ConfirmDialog'
import { FormSheet } from './page/FormSheet'
import { CheckField, SearchField } from './page/Filters'
import { TableSkeleton } from './page/TableSkeleton'
import { Note } from '../pages/account/parts'

export interface FieldSpec {
  name: string
  label: TranslationKey
  type?: 'text' | 'textarea' | 'select' | 'url'
  required?: boolean
  hint?: TranslationKey
  options?: [string, TranslationKey][]
  maxLength?: number
  uppercase?: boolean
  columnWidth?: string
  hideInTable?: boolean
}

export interface ResourceSpec {
  key: string
  path: string
  singular: TranslationKey
  plural: TranslationKey
  description: TranslationKey
  note?: TranslationKey
  fields: FieldSpec[]
}

const STATUS_FIELD: FieldSpec = {
  name: 'status',
  label: 'res.f.status',
  type: 'select',
  options: [
    ['unknown', 'refStatus.unknown'],
    ['active', 'refStatus.active'],
    ['inactive', 'refStatus.inactive'],
    ['restricted', 'refStatus.restricted'],
  ],
}

const NOTES_FIELD: FieldSpec = {
  name: 'notes',
  label: 'res.f.notes',
  type: 'textarea',
  maxLength: 5000,
  hideInTable: true,
}

export function withCommonFields(fields: FieldSpec[]): FieldSpec[] {
  return [...fields, STATUS_FIELD, NOTES_FIELD]
}

function parseBmLimit(notesRaw: unknown, currentCount: number): { limit: number; tierLabel: string; verified: boolean; explicit: boolean } {
  const notes = String(notesRaw ?? '')
  const match = notes.match(/\[BM_LIMIT:(\d+)\]/i)
  if (match) {
    const lim = parseInt(match[1], 10)
    const verified = lim >= 10 || /xmdn|verified/i.test(notes)
    return {
      limit: lim,
      tierLabel: lim >= 10 ? `BM${lim} · Đã XMDN` : `BM${lim} · Chưa XMDN`,
      verified,
      explicit: true,
    }
  }
  if (currentCount > 10) return { limit: 30, tierLabel: 'BM30 · Đã XMDN', verified: true, explicit: false }
  if (currentCount > 5) return { limit: 10, tierLabel: 'BM10 · Đã XMDN', verified: true, explicit: false }
  if (currentCount > 3) return { limit: 5, tierLabel: 'BM5 · Đã có bill', verified: false, explicit: false }
  if (currentCount > 1) return { limit: 3, tierLabel: 'BM3 · Đã có bill', verified: false, explicit: false }
  return { limit: 5, tierLabel: 'BM1–BM5 · Tiêu chuẩn', verified: false, explicit: false }
}

/** What the record is called in a sentence: its first required text field, else its id. */
function recordLabel(spec: ResourceSpec, record: ReferenceRecord): string {
  for (const field of spec.fields) {
    const value = record[field.name]
    if (field.required && value) return String(value)
  }
  return String(record.id)
}

type Pending = { kind: 'archive' | 'restore'; record: ReferenceRecord } | null

export default function ReferenceManager({ spec }: { spec: ResourceSpec }) {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ReferenceRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)

  const isBmResource = spec.key === 'business-managers'
  const isPaymentResource = spec.key === 'payment-profile-references'

  const list = useQuery({
    queryKey: [spec.key, 'list', { archived, search }],
    queryFn: () =>
      api.get<Paged<ReferenceRecord>>(`${spec.path}${query({ archived, search, page_size: 200 })}`),
  })

  const bmAccountsQuery = useQuery({
    queryKey: ['accounts', 'by-bm-lookup'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
    enabled: isBmResource || isPaymentResource,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [spec.key] })
    void queryClient.invalidateQueries({ queryKey: ['asset-options'] })
    void queryClient.invalidateQueries({ queryKey: ['business-managers', 'options'] })
  }

  const change = useMutation({
    mutationFn: async ({ kind, record }: { kind: 'archive' | 'restore'; record: ReferenceRecord }) => {
      await api.post(`${spec.path}/${record.id}/${kind}`)
      const fresh = await queryClient.fetchQuery({
        queryKey: [spec.key, 'list', { archived, search }],
        queryFn: () =>
          api.get<Paged<ReferenceRecord>>(`${spec.path}${query({ archived, search, page_size: 200 })}`),
        staleTime: 0,
      })
      return { kind, record, gone: !fresh.items.some((item) => item.id === record.id) }
    },
    onSuccess: ({ kind, record, gone }) => {
      invalidate()
      const label = recordLabel(spec, record)
      setReadBack(
        gone
          ? { ok: true, text: t(kind === 'archive' ? 'ref.readback.archived' : 'ref.readback.restored', { label }) }
          : { ok: false, text: t('ref.readback.mismatch') },
      )
      setPending(null)
    },
  })

  const visibleFields = spec.fields.filter((field) => !field.hideInTable)
  const name = t(spec.singular)
  const rows = list.data?.items ?? []
  const bmAccountColLabel = language === 'vi' ? 'Tài khoản QC & Hạn mức BM' : 'Ad accounts & BM limit'
  const paymentAccountColLabel = language === 'vi' ? 'TKQC đang gắn (An toàn ≤ 3/thẻ)' : 'Linked Ad Accounts (Safe ≤ 3)'

  const accountsByBmId = new Map<string, AdAccount[]>()
  const allAccounts = bmAccountsQuery.data?.items ?? []
  if (isBmResource) {
    for (const acc of allAccounts) {
      if (acc.business_manager_id) {
        const cur = accountsByBmId.get(acc.business_manager_id) ?? []
        cur.push(acc)
        accountsByBmId.set(acc.business_manager_id, cur)
      }
    }
  }

  function getAccountsForPaymentCard(record: ReferenceRecord): AdAccount[] {
    const code = String(record.reference_code ?? '').trim().toLowerCase()
    const lbl = String(record.label ?? '').trim().toLowerCase()
    if (!code && !lbl) return []
    return allAccounts.filter((acc) => {
      const pLabels = acc.payment_profile_labels ?? []
      return pLabels.some((pl) => {
        const low = pl.toLowerCase()
        return (code && low.includes(code)) || (lbl && low.includes(lbl))
      })
    })
  }

  const columns = [
    ...visibleFields.map((field) => t(field.label)),
    ...(isBmResource ? [bmAccountColLabel] : []),
    ...(isPaymentResource ? [paymentAccountColLabel] : []),
    t('ref.col.updated'),
    t('pg.actions'),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-2xl text-sm text-ink-muted">{t(spec.description)}</p>
        <div className="flex flex-wrap items-end gap-2">
          <SearchField label={t('pg.search')} value={search} onApply={setSearch} />
          <CheckField label={t('pg.archivedOnly')} checked={archived} onChange={setArchived} />
          <Button type="button" onClick={() => setCreating(true)}>
            {t('ref.add', { name })}
          </Button>
        </div>
      </div>

      {isPaymentResource && (
        <div className="rounded-md border border-line bg-surface px-3.5 py-2 text-xs text-ink">
          <strong>Quy tắc an toàn thẻ thanh toán:</strong> Meta cho phép gắn tối đa <strong>9–10 TKQC / 1 thẻ</strong>, nhưng thực chiến chỉ nên gắn tối đa <strong className="text-success-text">1 – 3 TKQC / 1 thẻ</strong> để tránh chết liên đới (bão thẻ) khi 1 TKQC bị vô hiệu hoá hoặc thẻ hụt tiền.
        </div>
      )}

      {spec.note && <Note>{t(spec.note)}</Note>}
      {readBack && (
        <Note role="status" tone={readBack.ok ? undefined : 'caution'}>
          {readBack.text}
        </Note>
      )}

      {list.isLoading ? (
        <TableSkeleton columns={columns} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} title={t('ref.error.title')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={archived ? t('ref.empty.archived', { name }) : t('ref.empty.none', { name })}
          description={archived ? t('ref.empty.archivedBody') : t(spec.description)}
          action={
            !archived && (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('ref.add', { name })}
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <Table cards aria-label={t(spec.plural)}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {visibleFields.map((field) => (
                  <TableHead key={field.name}>{t(field.label)}</TableHead>
                ))}
                {isBmResource && <TableHead>{bmAccountColLabel}</TableHead>}
                {isPaymentResource && <TableHead>{paymentAccountColLabel}</TableHead>}
                <TableHead>{t('ref.col.updated')}</TableHead>
                <TableHead className="text-right">{t('pg.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((record) => (
                <TableRow key={record.id}>
                  {visibleFields.map((field, index) => (
                    <TableCell key={field.name} label={t(field.label)} className={index === 0 ? 'cell-title' : undefined}>
                      {field.name === 'status' ? (
                        <Badge tone={String(record.status) === 'active' ? 'positive' : 'neutral'}>
                          {enumLabel('refStatus', String(record.status))}
                        </Badge>
                      ) : field.type === 'url' && record[field.name] ? (
                        <a
                          href={String(record[field.name])}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-brand-text hover:underline"
                        >
                          {String(record[field.name])}
                        </a>
                      ) : (
                        <span className={field.name.includes('reference') ? 'font-mono text-xs' : undefined}>
                          {record[field.name] ? String(record[field.name]) : '—'}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  {isBmResource && (
                    <TableCell label={bmAccountColLabel}>
                      {(() => {
                        const linkedAccs = accountsByBmId.get(String(record.id)) ?? []
                        const bmQuota = parseBmLimit(record.notes, linkedAccs.length)
                        const remaining = Math.max(0, bmQuota.limit - linkedAccs.length)
                        return (
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={linkedAccs.length >= bmQuota.limit ? 'caution' : 'positive'}>
                                {`${linkedAccs.length} / ${bmQuota.limit} TKQC`}
                              </Badge>
                              <Badge tone={bmQuota.verified ? 'info' : 'neutral'}>
                                {bmQuota.tierLabel}
                              </Badge>
                              <span className="text-[11px] font-medium text-ink-muted">
                                {remaining > 0 ? `(Còn tạo được ${remaining})` : '(Chạm trần hạn mức)'}
                              </span>
                            </div>
                            {linkedAccs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {linkedAccs.slice(0, 4).map((acc) => (
                                  <Link
                                    key={acc.id}
                                    to={`/accounts/${acc.id}`}
                                    className="inline-flex items-center rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink hover:border-brand hover:text-brand-text"
                                  >
                                    {acc.display_name}
                                  </Link>
                                ))}
                                {linkedAccs.length > 4 && (
                                  <Link
                                    to="/accounts"
                                    className="inline-flex items-center rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold text-brand-text hover:underline"
                                  >
                                    +{linkedAccs.length - 4} TKQC khác →
                                  </Link>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </TableCell>
                  )}
                  {isPaymentResource && (
                    <TableCell label={paymentAccountColLabel}>
                      {(() => {
                        const linkedAccs = getAccountsForPaymentCard(record)
                        const count = linkedAccs.length
                        const tone = count === 0 ? 'neutral' : count <= 2 ? 'positive' : count === 3 ? 'caution' : 'attention'
                        const statusText =
                          count === 0
                            ? '0 / 3 TKQC · Chưa gắn'
                            : count <= 2
                              ? `${count} / 3 TKQC · An toàn`
                              : count === 3
                                ? '3 / 3 TKQC · Tối đa khuyến nghị'
                                : `⚠️ ${count} / 10 TKQC · Vượt ngưỡng an toàn (Dễ chết liên đới)`
                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={tone}>{statusText}</Badge>
                            </div>
                            {count > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {linkedAccs.slice(0, 4).map((acc) => (
                                  <Link
                                    key={acc.id}
                                    to={`/accounts/${acc.id}`}
                                    className="inline-flex items-center rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink hover:border-brand hover:text-brand-text"
                                  >
                                    {acc.display_name}
                                  </Link>
                                ))}
                                {count > 4 && (
                                  <span className="text-[11px] font-medium text-ink-muted">
                                    +{count - 4} khác
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </TableCell>
                  )}
                  <TableCell label={t('ref.col.updated')} className="whitespace-nowrap text-xs text-ink-muted">
                    {formatDateTime(record.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      {record.archived_at ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ kind: 'restore', record })}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          {t('pg.restore')}
                        </Button>
                      ) : (
                        <>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(record)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            {t('pg.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label={t('pg.archive')}
                            className="border-danger-line text-danger-text hover:bg-danger-soft"
                            onClick={() => setPending({ kind: 'archive', record })}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            {language === 'vi' ? 'Xóa' : 'Delete'}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={pending !== null}
        onCancel={() => {
          setPending(null)
          change.reset()
        }}
        title={pending ? t(pending.kind === 'archive' ? 'ref.archive.title' : 'ref.restore.title', { name }) : ''}
        object={pending ? t(pending.kind === 'archive' ? 'ref.archive.object' : 'ref.restore.object', { label: recordLabel(spec, pending.record) }) : ''}
        effects={
          pending?.kind === 'archive'
            ? [t('ref.archive.effect'), t('ref.archive.keeps'), t('ref.archive.reversible')]
            : [t('ref.restore.effect'), t('ref.restore.reversible')]
        }
        confirmLabel={pending?.kind === 'archive' ? t('ref.archive.confirm') : t('ref.restore.confirm')}
        tone={pending?.kind === 'archive' ? 'destructive' : 'default'}
        pending={change.isPending}
        error={change.isError ? change.error : undefined}
        onConfirm={() => pending && change.mutate(pending)}
      />

      <ReferenceSheet
        spec={spec}
        record={editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={invalidate}
      />
    </div>
  )
}

function ReferenceSheet({
  spec,
  record,
  open,
  onClose,
  onSaved,
}: {
  spec: ResourceSpec
  record: ReferenceRecord | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<Record<string, string>>({})
  const [bmLimitOption, setBmLimitOption] = useState<string>('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showAdvanced, setShowAdvanced] = useState(Boolean(record))

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of spec.fields) {
      const current = record?.[field.name]
      next[field.name] = current === null || current === undefined ? '' : String(current)
    }
    const rawNotes = String(record?.notes ?? '')
    const m = rawNotes.match(/\[BM_LIMIT:(\d+)\]/i)
    setBmLimitOption(m ? m[1] : '')
    setValues(next)
    setTouched({})
    setShowAdvanced(Boolean(record))
  }, [record, spec, open])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {}
      for (const field of spec.fields) {
        const raw = (values[field.name] ?? '').trim()
        payload[field.name] = raw === '' ? (field.required ? raw : null) : field.uppercase ? raw.toUpperCase() : raw
      }
      let cleanNotes = String(payload.notes ?? '').replace(/\[BM_LIMIT:\d+\]\s*/gi, '').trim()
      if (spec.key === 'business-managers' && bmLimitOption) {
        cleanNotes = `[BM_LIMIT:${bmLimitOption}] ${cleanNotes}`.trim()
      }
      payload.notes = cleanNotes
      return record
        ? api.patch(`${spec.path}/${record.id}`, payload)
        : api.post(spec.path, payload)
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })

  const missing = spec.fields.filter((field) => field.required && !(values[field.name] ?? '').trim())
  const name = t(spec.singular)
  const formId = `${spec.key}-form`

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={record ? t('ref.edit', { name }) : t('ref.add', { name })}
      description={record ? t('ref.editDesc') : t('ref.addDesc')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={missing.length > 0 || save.isPending}>
            {save.isPending ? t('pg.saving') : t('pg.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {spec.note && <Note>{t(spec.note)}</Note>}
        {save.isError && <ErrorState error={save.error} title={t('ref.save.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
        {spec.fields
          .filter((field) => showAdvanced || spec.key !== 'business-managers' || field.name === 'name' || field.name === 'external_id')
          .map((field) => {
          const id = `${spec.key}-${field.name}`
          const error = field.required && touched[field.name] && !(values[field.name] ?? '').trim()
            ? t('ref.name.required', { name: t(field.label).toLowerCase() })
            : undefined
          const common = {
            id,
            value: values[field.name] ?? '',
            onChange: (event: { target: { value: string } }) => setValues({ ...values, [field.name]: event.target.value }),
            onBlur: () => setTouched({ ...touched, [field.name]: true }),
          }
          return (
            <Field key={field.name} htmlFor={id} label={t(field.label)} required={field.required} hint={field.hint ? t(field.hint) : undefined} error={error}>
              {field.type === 'textarea' ? (
                <textarea className="input min-h-[72px]" maxLength={field.maxLength} {...common} />
              ) : field.type === 'select' ? (
                <select className="input" {...common}>
                  {(field.options ?? []).map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`input ${field.uppercase ? 'uppercase' : ''}`}
                  type={field.type === 'url' ? 'url' : 'text'}
                  maxLength={field.maxLength}
                  aria-invalid={error ? true : undefined}
                  {...common}
                />
              )}
            </Field>
          )
        })}

        {spec.key === 'business-managers' && (
          <Field
            htmlFor="bm-limit-select"
            label="Cấp độ BM & Giới hạn tạo Tài khoản QC"
            hint="BM mới tạo được 1 TKQC (BM1). Sau khi thanh toán bill đầu tiên tăng lên 3–5 TKQC (BM3/BM5). Sau khi Xác minh doanh nghiệp (XMDN) tăng lên 10 → 30 → 250+ TKQC."
          >
            <select
              id="bm-limit-select"
              className="input"
              value={bmLimitOption}
              onChange={(e) => setBmLimitOption(e.target.value)}
            >
              <option value="">Tự động nhận diện theo số TKQC hiện tại</option>
              <option value="1">BM1 — Mới tạo / Chưa bill (Tối đa 1 TKQC)</option>
              <option value="3">BM3 — Đã có bill thanh toán (Tối đa 3 TKQC)</option>
              <option value="5">BM5 — Tiêu chuẩn (Tối đa 5 TKQC)</option>
              <option value="10">BM10 — Đã Xác minh doanh nghiệp / XMDN (Tối đa 10 TKQC)</option>
              <option value="30">BM30 — Đã XMDN Cấp cao (Tối đa 30 TKQC)</option>
              <option value="250">BM250 — Agency XMDN (Tối đa 250 TKQC)</option>
            </select>
          </Field>
        )}

        {spec.key === 'business-managers' && (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? t('form.advanced.hide') : t('form.advanced.show')}
            </Button>
          </div>
        )}
      </form>
    </FormSheet>
  )
}
