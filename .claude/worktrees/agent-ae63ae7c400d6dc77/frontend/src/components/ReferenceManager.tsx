import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { Paged, ReferenceRecord } from '../lib/types'
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
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ReferenceRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)

  const list = useQuery({
    queryKey: [spec.key, 'list', { archived, search }],
    queryFn: () =>
      api.get<Paged<ReferenceRecord>>(`${spec.path}${query({ archived, search, page_size: 200 })}`),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [spec.key] })
    void queryClient.invalidateQueries({ queryKey: ['asset-options'] })
    void queryClient.invalidateQueries({ queryKey: ['business-managers', 'options'] })
  }

  // Archive / restore: ask, write, then read the list back and say what the server now holds
  // (skill 6.4). "Sent" is not "done".
  const change = useMutation({
    mutationFn: async ({ kind, record }: { kind: 'archive' | 'restore'; record: ReferenceRecord }) => {
      await api.post(`${spec.path}/${record.id}/${kind}`)
      const fresh = await queryClient.fetchQuery({
        queryKey: [spec.key, 'list', { archived, search }],
        queryFn: () =>
          api.get<Paged<ReferenceRecord>>(`${spec.path}${query({ archived, search, page_size: 200 })}`),
        staleTime: 0,
      })
      // Archiving from the active list (or restoring from the archived list) must make the row leave it.
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

  const columns = [...visibleFields.map((field) => t(field.label)), t('ref.col.updated'), t('pg.actions')]

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
                <TableHead>{t('ref.col.updated')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('pg.actions')}</span>
                </TableHead>
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
                      ) : (
                        <span className={field.name.includes('reference') ? 'font-mono text-xs' : undefined}>
                          {record[field.name] ? String(record[field.name]) : '—'}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell label={t('ref.col.updated')} className="whitespace-nowrap text-xs text-ink-muted">
                    {formatDateTime(record.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      {record.archived_at ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ kind: 'restore', record })}>
                          {t('pg.restore')}
                        </Button>
                      ) : (
                        <>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(record)}>
                            {t('pg.edit')}
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ kind: 'archive', record })}>
                            {t('pg.archive')}
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
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of spec.fields) {
      const current = record?.[field.name]
      next[field.name] = current === null || current === undefined ? '' : String(current)
    }
    setValues(next)
    setTouched({})
  }, [record, spec, open])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {}
      for (const field of spec.fields) {
        const raw = (values[field.name] ?? '').trim()
        payload[field.name] = raw === '' ? (field.required ? raw : null) : field.uppercase ? raw.toUpperCase() : raw
      }
      // Text columns are non-nullable on the server; only optional identifiers may be null.
      if (payload.notes === null) payload.notes = ''
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
        {spec.fields.map((field) => {
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
      </form>
    </FormSheet>
  )
}
