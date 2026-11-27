import type { AdAccount, Paged } from './types'

export function csvCell(value: string | null | undefined, numeric = false): string {
  let text = value ?? '—'
  // Control characters before formula prefixes must also be ignored by the safety check.
  // eslint-disable-next-line no-control-regex
  if (!(numeric && /^-?\d+(?:\.\d+)?$/.test(text)) && /^[\s\x00-\x1f\x7f-\x9f]*[=+@-]/.test(text)) text = "'" + text
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function collectAccounts(fetchPage: (page: number) => Promise<Paged<AdAccount>>, valid: () => boolean) {
  const rows: AdAccount[] = []
  const ids = new Set<string>()
  let total: number | undefined
  for (let page = 1; ; page++) {
    if (!valid()) throw new Error('cancelled')
    const result = await fetchPage(page)
    if (!valid()) throw new Error('cancelled')
    if (!Number.isInteger(result.total) || result.total < 0 || result.total > 10000) throw new Error('limit')
    total ??= result.total
    const pages = Math.ceil(total / 25)
    if (result.total !== total || result.page !== page || result.page_size !== 25 || result.total_pages !== pages ||
        result.items.length !== Math.min(25, total - rows.length)) throw new Error('inconsistent')
    for (const row of result.items) {
      if (!row.id || ids.has(row.id)) throw new Error('duplicate')
      ids.add(row.id)
      rows.push(row)
    }
    if (page >= pages) return rows
  }
}

export function accountsCsv(rows: AdAccount[], statusLabel: (status: string) => string) {
    const headers = [
      'Tên TKQC',
      'ID TKQC (External ID)',
      'Business Manager',
      'XMDN BM',
      'Pháp nhân Doanh nghiệp',
      'Mã số thuế (MST)',
      'Via & Hồ sơ Chrome',
      'Tiền tệ',
      'Dư nợ hiện tại',
      'Số dư đạt (Ngưỡng TT)',
      'Ngày thanh toán tiếp theo',
      'Giới hạn chi tiêu ngày (Meta đặt)',
      'Phương thức thanh toán (Thẻ)',
      'Chi tiêu Hôm nay',
      'Chi tiêu Hôm qua',
      'Chi tiêu 7 ngày',
      'Chi tiêu Tháng này (MTD)',
      'Chi tiêu Lũy kế',
      'Trạng thái Meta',
    ]
    const csvRows = [
      headers.map((value) => csvCell(value)).join(','),
      ...rows.map((a) => {
        const bm = a.billing_meta ?? {}
        const curr = a.spend?.observed_currency || a.currency || '—'
        const vias =
          a.facebook_identities
            ?.map((i) => `${i.label}${i.browser_profile_label ? ` (${i.browser_profile_label})` : ''}`)
            .join('; ') || '—'
        const validLabels = (a.payment_profile_labels ?? []).filter((lbl) => !lbl.startsWith('VISA-QCT-'))
        const cardTxt = bm.payment_card_display || validLabels.join('; ') || 'Chưa gắn thẻ'
        return [
          a.display_name,
          a.external_account_id || '—',
          a.business_manager_name || a.personal_account_reference_label || '—',
          bm.bm_verified ? 'Đã XMDN' : 'Chưa XMDN',
          bm.business_legal_name || '—',
          bm.tax_id ? `${bm.tax_id}${bm.tax_id_verified ? ' (Đã xác minh)' : ''}` : '—',
          vias,
          curr,
          bm.balance_raw ?? a.spend_periods?.balance_raw ?? '—',
          bm.billing_threshold_raw ?? '—',
          bm.next_bill_date ?? '—',
          bm.meta_daily_limit_raw ?? '—',
          cardTxt,
          a.spend_periods?.today_partial_raw ?? '—',
          a.spend?.latest_complete_day?.spend_raw ?? '—',
          a.spend_periods?.last_7d_raw ?? '—',
          a.spend_periods?.mtd_raw ?? '—',
          a.spend_periods?.amount_spent_raw ?? '—',
          a.platform_status?.status ?? statusLabel(a.status),
        ]
          .map((value, index) => csvCell(value, [8, 9, 11, 13, 14, 15, 16, 17].includes(index)))
          .join(',')
      }),
    ]
  return '\uFEFF' + csvRows.join('\r\n')
}
