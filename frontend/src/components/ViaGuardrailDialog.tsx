import { useState } from 'react'
import { KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './primitives/alert-dialog'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { aiStudioApi } from '../lib/policyScanner'
import { storeOwnerOverrideGrant, type GuardrailBlockedDecision } from '../lib/chromeProfileLauncher'

export interface ViaGuardrailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  decision: GuardrailBlockedDecision | null
  isOwner: boolean
  onOverrideGranted: (grant: string) => void
}

export function ViaGuardrailDialog({
  open,
  onOpenChange,
  decision,
  isOwner,
  onOverrideGranted,
}: ViaGuardrailDialogProps) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!decision) return null

  const tierBadgeLabel =
    decision.viaTier === '72h_lock' ? 'Via đang Ngâm 72h Vàng' : 'Via Lớp 1: Via Tổng Giữ BM'

  const handleOwnerOverride = async () => {
    const clean = reason.trim()
    if (clean.length < 4) {
      setErrorMsg('Owner vui lòng nhập lý do mở khóa ngoại lệ (tối thiểu 4 ký tự).')
      return
    }
    setPending(true)
    setErrorMsg(null)
    try {
      const res = await aiStudioApi.requestOwnerOverride({
        via_id: decision.viaId || decision.viaLabel,
        via_label: decision.viaLabel,
        via_tier: decision.viaTier,
        target_scope: decision.targetScope,
        reason: clean,
      })
      storeOwnerOverrideGrant(decision.viaId || decision.viaLabel, res.override_grant, res.expires_in_seconds)
      setReason('')
      onOpenChange(false)
      onOverrideGranted(res.override_grant)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể cấp quyền mở khóa ngoại lệ.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        if (!next) {
          setErrorMsg(null)
          setReason('')
        }
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 shrink-0 text-tone-attention-fg" aria-hidden="true" />
            <AlertDialogTitle className="text-base">
              Khiên Bảo Vệ Vai Trò Via Đã Chặn Thao Tác Rủi Ro
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-2.5 pt-1 text-xs text-ink-muted">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="attention">{tierBadgeLabel}</Badge>
                <span className="font-semibold text-ink">{decision.viaLabel}</span>
              </div>
              <p className="leading-relaxed text-ink">{decision.reason}</p>
              <div className="rounded-lg border border-tone-info-border bg-tone-info-bg p-2.5 text-tone-info-fg">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Khuyến nghị an toàn:</span>
                </div>
                <p className="mt-0.5 text-[11px]">
                  {decision.recommendedAlternative ||
                    'Hãy chọn một Via Lớp 2 (Lên Camp) đã qua ngâm Trust để thao tác trên Trình quản lý quảng cáo, tránh chết liên đới cả BM & dàn Fanpage gốc.'}
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isOwner ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <KeyRound className="h-3.5 w-3.5 text-brand-text" aria-hidden="true" />
              <span>Chốt Ngoại Lệ Dành Riêng Cho Owner (Mở khóa 15 phút &amp; Ghi Audit Log)</span>
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do bắt buộc (VD: Rà soát hóa đơn BM / xử lý khẩn cấp)..."
              maxLength={240}
              className="input text-xs"
            />
            {errorMsg && (
              <p className="text-[11px] font-medium text-tone-attention-fg">{errorMsg}</p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-tone-caution-border bg-tone-caution-bg px-3 py-2 text-xs text-tone-caution-fg">
            Tài khoản nhân sự không có quyền mở khóa vượt rào bảo vệ Via Tổng / Via Ngâm 72h. Vui lòng liên hệ Owner Workspace nếu cần ngoại lệ.
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Đóng (Giữ an toàn)</AlertDialogCancel>
          {isOwner && (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={handleOwnerOverride}
            >
              {pending ? 'Đang ghi Audit & mở khóa...' : 'Mở khóa ngoại lệ 15 phút'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
