import { useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../primitives/alert-dialog'
import { ErrorState } from '../states'
import { Note } from '../../pages/account/parts'
import type { Tone } from '../../lib/readiness'

/**
 * A write that matters, asked for once, in words (skill 6.4): what the object is, what will
 * happen, whether it can be undone — then a read-back of what the server now holds.
 *
 * Why this is a component and not four copies:
 *  - The dialog stays open while the request AND the read-back run, so "done" is never shown
 *    before the server has been asked again. A refusal stays inside the dialog.
 *  - It opens from an ordinary button, which Radix does not know about, so it cannot return
 *    focus by itself. The opener is remembered when the dialog opens; if it is gone by the time
 *    the dialog closes (the row it sat on turned into something else) focus lands on the
 *    fallback instead of dropping to <body> — the same fix as the archive dialog in U1c.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  object,
  effects,
  irreversible,
  confirmLabel,
  destructive = false,
  disabled = false,
  onConfirm,
  fallbackFocus,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What the action is about: the connection label, the credential label, the account. */
  object?: string
  /** Plain sentences: what happens, what does not, what stays for the person to do. */
  effects: string[]
  /** `true` is stated as "Cannot be undone"; `false` as "Can be undone"; `null` states nothing
   * (the caller's own sentences carry it, for a write that is reversible in one part only). */
  irreversible: boolean | null
  confirmLabel: string
  destructive?: boolean
  /** Extra condition (e.g. a required reason is empty). */
  disabled?: boolean
  /** Runs the write and the read-back. Resolve to close; reject to stay open with the error. */
  onConfirm: () => Promise<unknown>
  fallbackFocus?: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (caught) {
      setError(caught ?? new Error('failed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        if (!next) setError(null)
        onOpenChange(next)
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
          else fallbackFocus?.()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{object ?? title}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {effects.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {irreversible !== null && (
            <li className="font-medium">{irreversible ? t('confirm.irreversible') : t('confirm.reversible')}</li>
          )}
        </ul>
        {children}
        {pending && (
          <p role="status" className="text-xs text-ink-muted">
            {t('confirm.readbackPending')}
          </p>
        )}
        {error !== null && <ErrorState error={error} noPermissionText={t('confirm.noPermission')} compact />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending || disabled}
            onClick={(event) => {
              // Keep the dialog open until the write and its read-back are both done.
              event.preventDefault()
              void run()
            }}
          >
            {pending ? t('common.working') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** What the server said after a write, read back from the server — not "success". `ok` false is
 * a caution, never a success tone: the request went out and the re-read does not agree. */
export interface ReadBack {
  ok: boolean
  text: string
  /** Overrides the default (info when the re-read agrees, caution when it does not). Never `positive`. */
  tone?: Tone
}

export function ReadBackNote({ readBack, onDismiss }: { readBack: ReadBack | null; onDismiss?: () => void }) {
  const { t } = useI18n()
  if (!readBack) return null
  return (
    <div className="flex items-start gap-2">
      <Note role="status" tone={readBack.tone ?? (readBack.ok ? 'info' : 'caution')} className="flex-1">
        {readBack.text}
      </Note>
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('common.close')}
        </Button>
      )}
    </div>
  )
}
