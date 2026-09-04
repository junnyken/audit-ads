import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { Paged, ReferenceRecord } from '../lib/types'
import { Badge, Drawer, EmptyState, ErrorState, Field, InlineNote, Skeleton } from './ui'
import { formatDateTime, humanise } from '../lib/format'

export interface FieldSpec {
  name: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'url'
  required?: boolean
  hint?: string
  options?: [string, string][]
  maxLength?: number
  uppercase?: boolean
  columnWidth?: string
  hideInTable?: boolean
}

export interface ResourceSpec {
  key: string
  path: string
  singular: string
  plural: string
  description: string
  note?: string
  fields: FieldSpec[]
}

const STATUS_FIELD: FieldSpec = {
  name: 'status',
  label: 'Status',
  type: 'select',
  options: [
    ['unknown', 'Unknown'],
    ['active', 'Active'],
    ['inactive', 'Inactive'],
    ['restricted', 'Restricted'],
  ],
}

const NOTES_FIELD: FieldSpec = {
  name: 'notes',
  label: 'Notes',
  type: 'textarea',
  maxLength: 5000,
  hideInTable: true,
}

export function withCommonFields(fields: FieldSpec[]): FieldSpec[] {
  return [...fields, STATUS_FIELD, NOTES_FIELD]
}

export default function ReferenceManager({ spec }: { spec: ResourceSpec }) {
  const queryClient = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ReferenceRecord | null>(null)
  const [creating, setCreating] = useState(false)

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

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`${spec.path}/${id}/archive`),
    onSuccess: invalidate,
  })
  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`${spec.path}/${id}/restore`),
    onSuccess: invalidate,
  })

  const visibleFields = spec.fields.filter((field) => !field.hideInTable)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[12.5px] text-ink-muted">{spec.description}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor={`${spec.key}-search`}>Search</label>
            <input
              id={`${spec.key}-search`}
              className="input min-w-[180px]"
              defaultValue={search}
              onBlur={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSearch((event.target as HTMLInputElement).value)
              }}
            />
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px]">
            <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
            Archived only
          </label>
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            Add {spec.singular.toLowerCase()}
          </button>
        </div>
      </div>

      {spec.note && <InlineNote>{spec.note}</InlineNote>}

      {list.isLoading ? (
        <Skeleton rows={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.items.length === 0 ? (
        <EmptyState
          title={archived ? `No archived ${spec.plural.toLowerCase()}` : `No ${spec.plural.toLowerCase()} yet`}
          description={spec.description}
          action={
            !archived && (
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                Add {spec.singular.toLowerCase()}
              </button>
            )
          }
        />
      ) : (
        <div className="card table-scroll">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                {visibleFields.map((field) => (
                  <th key={field.name} className="th">
                    {field.label}
                  </th>
                ))}
                <th className="th">Updated</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data!.items.map((record) => (
                <tr key={record.id} className="hover:bg-surface-muted">
                  {visibleFields.map((field) => (
                    <td key={field.name} className="td">
                      {field.name === 'status' ? (
                        <Badge tone={String(record.status) === 'active' ? 'positive' : 'neutral'}>
                          {humanise(String(record.status))}
                        </Badge>
                      ) : (
                        <span className={field.name.includes('reference') ? 'font-mono text-[11.5px]' : ''}>
                          {record[field.name] ? String(record[field.name]) : '—'}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                    {formatDateTime(record.updated_at)}
                  </td>
                  <td className="td">
                    <div className="flex gap-1.5">
                      {record.archived_at ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => restoreMutation.mutate(record.id)}
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn-secondary" onClick={() => setEditing(record)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => archiveMutation.mutate(record.id)}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(archiveMutation.isError || restoreMutation.isError) && (
        <ErrorState error={archiveMutation.error ?? restoreMutation.error} />
      )}

      <ReferenceDrawer
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

function ReferenceDrawer({
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
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of spec.fields) {
      const current = record?.[field.name]
      next[field.name] = current === null || current === undefined ? '' : String(current)
    }
    setValues(next)
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

  const requiredMissing = spec.fields.some(
    (field) => field.required && !(values[field.name] ?? '').trim(),
  )

  return (
    <Drawer
      open={open}
      title={record ? `Edit ${spec.singular.toLowerCase()}` : `Add ${spec.singular.toLowerCase()}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={`${spec.key}-form`}
            className="btn-primary"
            disabled={requiredMissing || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <form
        id={`${spec.key}-form`}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {spec.note && <InlineNote>{spec.note}</InlineNote>}
        {save.isError && <ErrorState error={save.error} />}
        {spec.fields.map((field) => (
          <Field key={field.name} label={field.label} required={field.required} hint={field.hint}>
            {field.type === 'textarea' ? (
              <textarea
                className="input min-h-[72px]"
                maxLength={field.maxLength}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
            ) : field.type === 'select' ? (
              <select
                className="input"
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              >
                {(field.options ?? []).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`input ${field.uppercase ? 'uppercase' : ''}`}
                type={field.type === 'url' ? 'url' : 'text'}
                maxLength={field.maxLength}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
            )}
          </Field>
        ))}
      </form>
    </Drawer>
  )
}
