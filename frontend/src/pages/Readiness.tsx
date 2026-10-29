import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { ReadinessStatus } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion } from '../components/states'
import { ChecklistProgress } from '../components/dashboard/ChecklistProgress'
import { PageHeader } from '../components/page/PageHeader'
import { Note } from './account/parts'
import { READINESS_META, severityTone } from '../lib/readiness'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { formatCount } from '../lib/format'

interface BoardRow {
  ad_account_id: string
  display_name: string
  external_account_id: string | null
  readiness_status: ReadinessStatus
  status: string
  required_item_count: number
  completed_item_count: number
  reasons: { code: string; severity: string; message: string }[]
}

interface Board {
  rows: BoardRow[]
  groups: {
    code: string
    message: string
    severity: string
    accounts: { ad_account_id: string; display_name: string }[]
  }[]
}

const FILTERS = ['', 'not_ready', 'unknown', 'ready_with_warnings', 'operationally_ready']

const VI_REASON_MESSAGES: Record<string, string> = {
  ownership_confirmed_incomplete: 'Xác nhận chủ sở hữu: Mục này chưa được rà soát.',
  ownership_confirmed_blocked: 'Xác nhận chủ sở hữu: Đang có vấn đề cần xử lý.',
  business_manager_confirmed_incomplete: 'Xác nhận Business Manager: Chưa gắn hoặc chưa xác nhận BM.',
  business_manager_confirmed_blocked: 'Xác nhận Business Manager: BM đang gặp sự cố hoặc bị hạn chế.',
  admin_access_reviewed_incomplete: 'Rà soát quyền Quản trị viên (Admin): Mục này chưa được kiểm tra.',
  admin_access_reviewed_blocked: 'Rà soát quyền Quản trị viên (Admin): Phát hiện rủi ro phân quyền.',
  two_factor_checked_incomplete: 'Bảo mật 2 lớp (2FA): Chưa xác nhận bật 2FA cho VIA quản lý.',
  two_factor_checked_blocked: 'Bảo mật 2 lớp (2FA): Tài khoản VIA chưa bật 2FA.',
  payment_method_reviewed_incomplete: 'Phương thức thanh toán (PTTT): Chưa rà soát thẻ/PTTT.',
  payment_method_reviewed_blocked: 'Phương thức thanh toán (PTTT): PTTT đang lỗi hoặc bị từ chối.',
  billing_issue_checked_incomplete: 'Kiểm tra nợ cước / hóa đơn: Mục này chưa được rà soát.',
  billing_issue_checked_blocked: 'Kiểm tra nợ cước / hóa đơn: Tài khoản đang có nợ cước chưa thanh toán.',
  page_linked_incomplete: 'Liên kết Trang Fanpage: Chưa gắn Fanpage hoạt động cho tài khoản.',
  page_linked_blocked: 'Liên kết Trang Fanpage: Fanpage liên kết đang bị hạn chế.',
  pixel_linked_incomplete: 'Liên kết Pixel: Chưa gắn Pixel theo dõi cho tài khoản.',
  pixel_linked_blocked: 'Liên kết Pixel: Pixel liên kết đang gặp sự cố.',
  browser_reference_assigned_incomplete: 'Hồ sơ trình duyệt (Profile): Chưa gán Profile trình duyệt cố định.',
  browser_reference_assigned_blocked: 'Hồ sơ trình duyệt (Profile): Profile trình duyệt đang lỗi.',
  proxy_reference_assigned_incomplete: 'Cấu hình Proxy / IP: Chưa gán Proxy cố định.',
  last_manual_review_completed_incomplete: 'Rà soát thủ công định kỳ: Tài khoản này chưa từng được rà soát thủ công.',
  last_manual_review_completed_blocked: 'Rà soát thủ công định kỳ: Đã quá hạn rà soát thủ công.',
  account_status_restricted: 'Trạng thái tài khoản đang bị Hạn chế / Nợ cước trên Meta — cần kiểm tra ngay.',
  account_status_disabled: 'Trạng thái tài khoản đã bị Vô hiệu hóa / Đóng trên Meta.',
  account_status_unknown: 'Chưa ghi nhận trạng thái tài khoản nên chưa thể xác nhận mức sẵn sàng.',
}

function localizeReason(code: string, message: string, language: string): string {
  if (language === 'vi' && VI_REASON_MESSAGES[code]) {
    return VI_REASON_MESSAGES[code]
  }
  return message
}

export default function ReadinessPage() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const [filter, setFilter] = useState('')
  const board = useQuery({
    queryKey: ['readiness-board', filter],
    queryFn: () =>
      api.get<Board>(`/api/v1/ad-accounts/readiness/board${query({ readiness_status: filter })}`),
  })

  return (
    <div className="space-y-4">
      <PageHeader title={t('rdb.title')} description={t('rdb.desc')} />

      <div role="group" aria-label={t('rdb.filter.label')} className="flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? 'default' : 'secondary'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === '' ? t('rdb.filter.all') : enumLabel('readiness', value)}
          </Button>
        ))}
      </div>

      <Note>{t('rdb.readonly')}</Note>

      {board.isLoading ? (
        <LoadingRegion className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          {[0, 1].map((key) => (
            <Card key={key} className="space-y-3 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </LoadingRegion>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} title={t('rdb.error.title')} />
      ) : board.data!.rows.length === 0 ? (
        <EmptyState
          title={t('rdb.empty.title')}
          description={t('rdb.empty.body')}
          action={
            filter !== '' && (
              <Button type="button" variant="secondary" onClick={() => setFilter('')}>
                {t('rdb.empty.reset')}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('rdb.groups.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {board.data!.groups.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('rdb.groups.empty')}</p>
              ) : (
                <ul className="space-y-3">
                  {board.data!.groups.map((group) => (
                    <li key={group.code}>
                      <div className="flex items-center gap-2">
                        <Badge tone={severityTone(group.severity)} title={t('rdb.groups.count', { count: group.accounts.length })}>
                          {formatCount(group.accounts.length)}
                        </Badge>
                        <span className="font-mono text-xs text-ink-muted">{group.code}</span>
                      </div>
                      <p className="mt-0.5 text-sm">{localizeReason(group.code, group.message, language)}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {group.accounts.map((account) => (
                          <Link
                            key={account.ad_account_id}
                            to={`/accounts/${account.ad_account_id}`}
                            className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-brand-text hover:underline"
                          >
                            {account.display_name}
                          </Link>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('rdb.accounts.title', { count: formatCount(board.data!.rows.length) })}</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <ul className="divide-y divide-line">
                {board.data!.rows.map((row) => {
                  const meta = READINESS_META[row.readiness_status]
                  return (
                    <li key={row.ad_account_id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/accounts/${row.ad_account_id}`} className="font-medium text-brand-text hover:underline">
                          {row.display_name}
                        </Link>
                        <div className="flex items-center gap-2">
                          <Badge tone={meta?.tone ?? 'neutral'} dot>
                            {enumLabel('readiness', row.readiness_status)}
                          </Badge>
                          <ChecklistProgress done={row.completed_item_count} total={row.required_item_count} />
                        </div>
                      </div>
                      {row.reasons.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {row.reasons.slice(0, 4).map((reason, index) => (
                            <li key={`${reason.code}-${index}`} className="text-xs text-ink-muted">
                              · {localizeReason(reason.code, reason.message, language)}
                            </li>
                          ))}
                          {row.reasons.length > 4 && (
                            <li className="text-xs text-ink-faint">{t('rdb.more', { count: row.reasons.length - 4 })}</li>
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
