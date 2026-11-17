import { useId } from 'react'
import { Search, X } from 'lucide-react'
import { useI18n } from '../../i18n'

/** A labelled native select. The label is bound with `htmlFor`, so it is announced. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: [string, string][]
  className?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input min-w-[130px]" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Search box that applies on Enter or blur (the URL is the state, so no per-keystroke refetch). */
export function SearchField({
  label,
  placeholder,
  value,
  onApply,
}: {
  label: string
  placeholder?: string
  value: string
  onApply: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="min-w-[200px] flex-1">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          id={id}
          key={value}
          type="search"
          className="input pl-8"
          placeholder={placeholder}
          defaultValue={value}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply((event.target as HTMLInputElement).value)
          }}
          onBlur={(event) => {
            if (event.target.value !== value) onApply(event.target.value)
          }}
        />
      </div>
    </div>
  )
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 pb-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-brand" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

export interface FilterChip {
  key: string
  text: string
  clear: Record<string, null>
}

/** The active filters as removable chips plus a "clear all". */
export function FilterChips({
  chips,
  onClear,
  onClearAll,
}: {
  chips: FilterChip[]
  onClear: (patch: Record<string, null>) => void
  onClearAll: () => void
}) {
  const { t } = useI18n()
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>{t('filter.active')}</span>
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface py-0.5 pl-2.5 pr-1 text-ink">
          {chip.text}
          <button
            type="button"
            aria-label={t('filter.remove', { name: chip.text })}
            className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink"
            onClick={() => onClear(chip.clear)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="font-medium text-brand-text hover:underline" onClick={onClearAll}>
        {t('filter.clear')}
      </button>
    </div>
  )
}
