import type { ReactNode } from 'react'
import { useI18n } from '../../i18n'

/**
 * A labelled form control. With `htmlFor` the label points at the control's id; without it the
 * control is wrapped in the label so the association is implicit rather than absent (an
 * unwrapped label announces nothing). The "(không bắt buộc)" marker is translated.
 */
export function Field({
  label,
  hint,
  required = false,
  children,
  htmlFor,
  error,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
  htmlFor?: string
  /** Field-level error: says which field and how to fix it. */
  error?: string
}) {
  const { t } = useI18n()
  const caption = (
    <>
      {label}
      {required ? (
        <span className="ml-1 text-tone-attention-fg" aria-hidden="true">
          *
        </span>
      ) : (
        <span className="ml-1 font-normal text-ink-faint">{t('form.optional')}</span>
      )}
    </>
  )
  const note = (
    <>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-tone-attention-fg">
          {error}
        </p>
      )}
    </>
  )
  if (htmlFor) {
    return (
      <div>
        <label className="label" htmlFor={htmlFor}>
          {caption}
        </label>
        {children}
        {note}
      </div>
    )
  }
  return (
    <label className="block">
      <span className="label">{caption}</span>
      {children}
      {note}
    </label>
  )
}
