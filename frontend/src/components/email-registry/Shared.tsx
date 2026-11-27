import type { ReactNode } from 'react'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Button } from '../primitives/button'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '../primitives/alert-dialog'
import { errorKey } from '../../lib/emailRegistry'
export function Modal({ title, children, onClose, description = 'er.safeText' }: { title: TranslationKey; description?: TranslationKey; children: ReactNode; onClose: () => void }) {
 const { t } = useI18n()
 return <AlertDialog open onOpenChange={open => { if (!open) onClose() }}><AlertDialogContent className="max-h-[90dvh] overflow-y-auto"><AlertDialogTitle>{t(title)}</AlertDialogTitle><AlertDialogDescription>{t(description)}</AlertDialogDescription>{children}<AlertDialogCancel onClick={onClose}>{t('er.close')}</AlertDialogCancel></AlertDialogContent></AlertDialog>
}
export function Field({ label, children }: { label: TranslationKey; children: ReactNode }) {
 const { t } = useI18n()
 return <label className="flex min-w-0 flex-col gap-1 text-sm">{t(label)}{children}</label>
}
export function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
 const { t } = useI18n()
 return <div role="alert" className="rounded border border-tone-attention-border p-3 text-tone-attention-fg">{t(errorKey(error))}{retry && <Button variant="secondary" onClick={retry}>{t('er.retry')}</Button>}</div>
}
export function Pager({ page, total, change }: { page: number; total: number; change: (p: number) => void }) {
 const { t } = useI18n()
 return <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={page <= 1} onClick={() => change(page - 1)}>{t('er.previous')}</Button><span>{t('er.page', { page, total: Math.max(1,total) })}</span><Button variant="secondary" disabled={page >= total} onClick={() => change(page + 1)}>{t('er.nextPage')}</Button></div>
}
