import { Link } from 'react-router-dom'
import { Badge } from './primitives/badge'
import { platformStatusBadge } from '../lib/platformStatus'
import { useI18n } from '../i18n'
import type { PlatformStatusCompact } from '../lib/types'

function cleanActId(raw?: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  const digits = trimmed.startsWith('act_') || trimmed.startsWith('act-') ? trimmed.slice(4).trim() : trimmed
  return digits || null
}

/**
 * Meta's latest account status (S2, restyled in U1b), plus actionable remediation shortcuts
 * when Meta reports a billing (`unsettled`) or policy/closure (`disabled`, `closed`, etc.) state.
 */
export default function PlatformStatusBadge({
  value,
  inline = false,
  accountId,
  externalAccountId,
}: {
  value?: PlatformStatusCompact | null
  inline?: boolean
  accountId?: string
  externalAccountId?: string | null
}) {
  const { language } = useI18n()
  const badge = platformStatusBadge(value, language)
  if (!value) {
    return (
      <span title={badge.title} data-testid="platform-status-none">
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
        <span className="sr-only">{badge.title}</span>
      </span>
    )
  }

  const st = (value.status || '').toLowerCase()
  const isBillingIssue = st === 'unsettled' || st === 'in_grace_period'
  const isDisabledOrClosed =
    st === 'disabled' ||
    st === 'closed' ||
    st === 'any_closed' ||
    st === 'pending_closure' ||
    st === 'pending_risk_review' ||
    st === 'temporarily_unavailable'
  const actDigits = cleanActId(externalAccountId)

  return (
    <span className={inline ? 'inline-flex flex-wrap items-center gap-1.5' : 'flex flex-col items-start gap-1'}>
      {accountId && (isBillingIssue || isDisabledOrClosed) ? (
        <Link to={`/accounts/${accountId}`} className="hover:opacity-90" title="Bấm để xem chi tiết và hướng dẫn khắc phục">
          <Badge tone={badge.tone} title={badge.title}>
            {badge.label}
          </Badge>
        </Link>
      ) : (
        <Badge tone={badge.tone} title={badge.title}>
          {badge.label}
        </Badge>
      )}
      {badge.context && <span className="text-xs text-ink-muted">{badge.context}</span>}
      {!inline && (isBillingIssue || isDisabledOrClosed) && (
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px]">
          {isBillingIssue && actDigits && (
            <a
              href={`https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/?act=${encodeURIComponent(actDigits)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 hover:underline dark:text-amber-300"
              title="Mở trang Cài đặt thanh toán của tài khoản này trên Meta để thanh toán dư nợ"
            >
              Thanh toán dư nợ Meta ↗
            </a>
          )}
          {isDisabledOrClosed && actDigits && (
            <a
              href={`https://business.facebook.com/accountquality/?landing_page=overview&act=${encodeURIComponent(actDigits)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-medium text-rose-600 hover:underline dark:text-rose-300"
              title="Mở trang Chất lượng tài khoản (Account Quality) trên Meta để kiểm tra hoặc kháng nghị"
            >
              Kiểm tra & Kháng nghị Meta ↗
            </a>
          )}
          {accountId && (
            <Link
              to={`/accounts/${accountId}`}
              className="inline-flex items-center rounded border border-brand/40 bg-brand-soft/15 px-1.5 py-0.5 font-medium text-brand-text hover:underline"
              title="Mở checklist và hướng dẫn xử lý nội bộ"
            >
              Hướng dẫn khắc phục →
            </Link>
          )}
        </span>
      )}
    </span>
  )
}
