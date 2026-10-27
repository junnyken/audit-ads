import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '../../i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../primitives/alert-dialog'
import { ErrorState } from '../states'

/**
 * Confirmation for an action that changes something (skill 6.4). It names the OBJECT, lists the
 * EFFECTS (including whether it can be undone), keeps focus on Cancel, stays open while the
 * request runs and when the server refuses, and never closes on an outside click. It replaces the
 * browser's native confirm box, which names nothing and cannot be styled, tested or translated.
 *
 * `typedPhrase` adds a typed confirmation for the heaviest writes: the confirm button stays
 * disabled until the person has typed that exact text.
 */
export function ConfirmDialog({
  open,
  onCancel,
  title,
  object,
  effects,
  confirmLabel,
  tone = 'destructive',
  pending = false,
  error,
  onConfirm,
  typedPhrase,
  reason,
  noPermissionText,
}: {
  open: boolean
  onCancel: () => void
  title: string
  object: ReactNode
  effects: string[]
  confirmLabel: string
  tone?: 'default' | 'destructive'
  pending?: boolean
  error?: unknown
  onConfirm: () => void
  typedPhrase?: string
  /** A required free-text reason (membership and access changes need one). The confirm button
   * stays disabled until it is filled in. */
  reason?: { label: string; value: string; onChange: (value: string) => void }
  noPermissionText?: string
}) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const typedId = useId()
  const reasonId = useId()
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const needsPhrase = Boolean(typedPhrase) && typed.trim() !== typedPhrase
  const needsReason = Boolean(reason) && !reason!.value.trim()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setTyped('')
          onCancel()
        }
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={() => {
          returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = returnFocusTo.current
          if (target?.isConnected && target !== document.body) target.focus()
          else document.querySelector<HTMLElement>('h1')?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{object}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
        {reason && (
          <div>
            <label className="label" htmlFor={reasonId}>
              {reason.label} <span aria-hidden="true" className="text-tone-attention-fg">*</span>
            </label>
            <input
              id={reasonId}
              className="input"
              required
              maxLength={2000}
              value={reason.value}
              onChange={(event) => reason.onChange(event.target.value)}
            />
          </div>
        )}
        {typedPhrase && (
          <div>
            <label className="label" htmlFor={typedId}>
              {t('confirm.typePrompt', { phrase: typedPhrase })}
            </label>
            <input
              id={typedId}
              className="input font-mono"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        {Boolean(error) && <ErrorState error={error} noPermissionText={noPermissionText ?? t('acct.error.noPermissionWrite')} compact />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={() => setTyped('')}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={tone}
            disabled={pending || needsPhrase || needsReason}
            onClick={(event) => {
              // Keep the dialog open while the request runs; the caller closes it after read-back.
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? t('common.working') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
