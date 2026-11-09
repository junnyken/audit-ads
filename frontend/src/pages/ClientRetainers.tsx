import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calculator,
  Check,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Plus,
  Printer,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import type { AdAccount, Paged } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'

export interface RetainerLinkedAccount {
  id: string
  display_name: string
  external_account_id: string | null
  bm_name: string | null
  status: string
  currency: string
  payment_card_display: string | null
  today_vnd: number
  last_7d_vnd: number
  mtd_vnd: number
  lifetime_vnd: number
  balance_vnd: number
}

export interface ClientRetainerItem {
  id: string
  contract_code: string
  client_name: string
  project_name: string
  contact_email: string
  tax_id: string
  billing_cycle: string
  committed_budget_vnd: number
  agency_fee_percent: number
  meta_tax_percent: number
  usd_to_vnd_rate: number
  notes: string
  ad_account_ids: string[]
  linked_accounts: RetainerLinkedAccount[]
  account_count: number
  spend_today_vnd: number
  spend_7d_vnd: number
  spend_mtd_vnd: number
  spend_lifetime_vnd: number
  unpaid_balance_vnd: number
  agency_fee_mtd_vnd: number
  meta_tax_mtd_vnd: number
  total_billable_mtd_vnd: number
  agency_fee_lifetime_vnd: number
  meta_tax_lifetime_vnd: number
  total_billable_lifetime_vnd: number
  pacing_percent: number
  pacing_status: 'ON_TRACK' | 'NEAR_CAP' | 'OVER_BUDGET' | 'NO_MTD_SPEND' | 'NO_CAP'
  remaining_budget_vnd: number
  recommended_daily_vnd: number
  updated_at: string | null
}

export interface ClientRetainersResponse {
  items: ClientRetainerItem[]
  summary: {
    total_contracts: number
    total_committed_vnd: number
    total_mtd_spend_vnd: number
    total_lifetime_spend_vnd: number
    total_unpaid_balance_vnd: number
    total_settlement_mtd_vnd: number
    total_settlement_lifetime_vnd: number
    days_remaining_in_month: number
  }
}

function fmtVnd(amount: number): string {
  return `${Math.round(amount || 0).toLocaleString('vi-VN')} ₫`
}

export default function ClientRetainers() {
  const { language } = useI18n()
  const isEn = language === 'en'
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [periodMode, setPeriodMode] = useState<'MTD' | 'LIFETIME'>('MTD')
  const [bannerMsg, setBannerMsg] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Modal state for Create / Edit Contract
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formCode, setFormCode] = useState('')
  const [formClient, setFormClient] = useState('')
  const [formProject, setFormProject] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formTaxId, setFormTaxId] = useState('')
  const [formCycle, setFormCycle] = useState('Tháng 11/2026')
  const [formBudget, setFormBudget] = useState('30000000')
  const [formFeePct, setFormFeePct] = useState('10')
  const [formTaxPct, setFormTaxPct] = useState('5')
  const [formUsdRate, setFormUsdRate] = useState('25400')
  const [formAccIds, setFormAccIds] = useState<string[]>([])
  const [formNotes, setFormNotes] = useState('')

  // Statement Preview Modal for Client
  const [statementItem, setStatementItem] = useState<ClientRetainerItem | null>(null)

  const retainersQ = useQuery({
    queryKey: ['client-retainers-overview'],
    queryFn: () => api.get<ClientRetainersResponse>('/api/v1/client-retainers'),
  })

  const accountsQ = useQuery({
    queryKey: ['ad-accounts-all-for-retainers'],
    queryFn: () => api.get<Paged<AdAccount>>('/api/v1/ad-accounts?page_size=200'),
  })

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<ClientRetainersResponse>('/api/v1/client-retainers', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client-retainers-overview'] })
      setModalOpen(false)
      setBannerMsg(
        isEn
          ? '✅ Saved Client Retainer Contract, fee/tax structure, and linked Ad Accounts.'
          : '✅ Đã lưu Hợp đồng Ngân sách Khách hàng, cấu hình % Phí Agency / Thuế Meta và danh sách TKQC.',
      )
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete<ClientRetainersResponse>(`/api/v1/client-retainers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client-retainers-overview'] })
      setBannerMsg(
        isEn ? '🗑️ Removed Client Retainer Contract.' : '🗑️ Đã xóa Hợp đồng Ngân sách khỏi sổ theo dõi.',
      )
    },
  })

  const items = retainersQ.data?.items ?? []
  const summary = retainersQ.data?.summary ?? {
    total_contracts: 0,
    total_committed_vnd: 0,
    total_mtd_spend_vnd: 0,
    total_lifetime_spend_vnd: 0,
    total_unpaid_balance_vnd: 0,
    total_settlement_mtd_vnd: 0,
    total_settlement_lifetime_vnd: 0,
    days_remaining_in_month: 20,
  }
  const allAccounts = accountsQ.data?.items ?? []

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.client_name.toLowerCase().includes(q) ||
        i.contract_code.toLowerCase().includes(q) ||
        i.project_name.toLowerCase().includes(q) ||
        i.linked_accounts.some(
          (a) =>
            a.display_name.toLowerCase().includes(q) ||
            (a.external_account_id ?? '').toLowerCase().includes(q),
        ),
    )
  }, [items, search])

  const openCreateModal = () => {
    setEditingId(null)
    setFormCode(`HD-2026-0${items.length + 1}`)
    setFormClient('')
    setFormProject('')
    setFormEmail('')
    setFormTaxId('')
    setFormCycle(isEn ? 'Nov 2026' : 'Tháng 11/2026')
    setFormBudget('30000000')
    setFormFeePct('10')
    setFormTaxPct('5')
    setFormUsdRate('25400')
    setFormAccIds([])
    setFormNotes('')
    setModalOpen(true)
  }

  const openEditModal = (item: ClientRetainerItem) => {
    setEditingId(item.id)
    setFormCode(item.contract_code)
    setFormClient(item.client_name)
    setFormProject(item.project_name)
    setFormEmail(item.contact_email)
    setFormTaxId(item.tax_id)
    setFormCycle(item.billing_cycle)
    setFormBudget(String(item.committed_budget_vnd))
    setFormFeePct(String(item.agency_fee_percent))
    setFormTaxPct(String(item.meta_tax_percent))
    setFormUsdRate(String(item.usd_to_vnd_rate))
    setFormAccIds(item.ad_account_ids)
    setFormNotes(item.notes)
    setModalOpen(true)
  }

  const toggleFormAcc = (id: string) => {
    setFormAccIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const exportSingleClientCsv = (item: ClientRetainerItem) => {
    const isMtd = periodMode === 'MTD'
    const baseSpend = isMtd ? item.spend_mtd_vnd : item.spend_lifetime_vnd
    const feeVnd = isMtd ? item.agency_fee_mtd_vnd : item.agency_fee_lifetime_vnd
    const taxVnd = isMtd ? item.meta_tax_mtd_vnd : item.meta_tax_lifetime_vnd
    const totalBill = isMtd ? item.total_billable_mtd_vnd : item.total_billable_lifetime_vnd

    const rows: string[][] = [
      ['BANG QUYET TOAN CHI PHI QUANG CAO META (CLIENT SETTLEMENT STATEMENT)'],
      ['Ma Hop Dong / Contract Code', item.contract_code],
      ['Khach Hang / Client Name', item.client_name],
      ['Du An / Project', item.project_name],
      ['Ky Quyet Toan / Billing Cycle', `${item.billing_cycle} (${isMtd ? 'Chi tieu Thang MTD' : 'Luy ke / Lifetime'})`],
      ['Ngan Sach Cam Ket / Committed Budget (VND)', String(item.committed_budget_vnd)],
      ['Ty Gia Quy Doi USD / Exchange Rate', String(item.usd_to_vnd_rate)],
      [],
      [
        'STT',
        'Ten TKQC (Ad Account)',
        'ID TKQC (External ID)',
        'Business Manager',
        'Tien Te Goc',
        'The Thanh Toan',
        'Chi Tieu Hom Nay (VND)',
        'Chi Tieu Thang MTD (VND)',
        'Chi Tieu Luy Ke (VND)',
        'Du No Chua Thanh Toan (VND)',
      ],
    ]

    item.linked_accounts.forEach((acc, idx) => {
      rows.push([
        String(idx + 1),
        acc.display_name,
        acc.external_account_id ?? '',
        acc.bm_name ?? 'Personal',
        acc.currency,
        acc.payment_card_display ?? 'Chua gan',
        String(acc.today_vnd),
        String(acc.mtd_vnd),
        String(acc.lifetime_vnd),
        String(acc.balance_vnd),
      ])
    })

    rows.push([])
    rows.push(['TONG CONG CHI TIEU META THUC TE (1)', '', '', '', '', '', '', String(item.spend_mtd_vnd), String(item.spend_lifetime_vnd), String(item.unpaid_balance_vnd)])
    rows.push([`PHI QUAN LY AGENCY (${item.agency_fee_percent}%) (2)`, '', '', '', '', '', '', String(item.agency_fee_mtd_vnd), String(item.agency_fee_lifetime_vnd), ''])
    rows.push([`THUE NHA THAU META (${item.meta_tax_percent}%) (3)`, '', '', '', '', '', '', String(item.meta_tax_mtd_vnd), String(item.meta_tax_lifetime_vnd), ''])
    rows.push([
      `TONG SO TIEN QUYET TOAN THANH TOAN = (1) + (2) + (3) [${isMtd ? 'THEO THANG MTD' : 'THEO LUY KE'}]`,
      String(totalBill),
      `Chi tieu goc: ${baseSpend}`,
      `Phi Agency: ${feeVnd}`,
      `Thue Meta: ${taxVnd}`,
    ])

    const csvContent =
      '\uFEFF' +
      rows
        .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Quyet-Toan-Ads-${item.contract_code}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setBannerMsg(
      isEn
        ? `📥 Exported Settlement Excel/CSV for "${item.client_name}" (${item.contract_code}).`
        : `📥 Đã xuất file Excel/CSV Bảng Quyết Toán Chi Phí cho «${item.client_name}» (${item.contract_code}).`,
    )
  }

  const exportAllRetainersCsv = () => {
    const rows: string[][] = [
      [
        'Ma Hop Dong',
        'Khach Hang / Du An',
        'Ky Quyet Toan',
        'So TKQC Gom Nhom',
        'Ngan Sach Cam Ket (VND)',
        'Chi Tieu Thang MTD (VND)',
        'Ti Le Can Ngan Sach (%)',
        'Phi Agency (%)',
        'Tien Phi Agency MTD (VND)',
        'Thue Nha Thau Meta (%)',
        'Tien Thue Meta MTD (VND)',
        'TONG QUYET TOAN THANG MTD (VND)',
        'Chi Tieu Luy Ke (VND)',
        'TONG QUYET TOAN LUY KE (VND)',
        'Du No The Chua Thanh Toan (VND)',
      ],
    ]
    for (const item of items) {
      rows.push([
        item.contract_code,
        `${item.client_name} — ${item.project_name}`,
        item.billing_cycle,
        String(item.account_count),
        String(item.committed_budget_vnd),
        String(item.spend_mtd_vnd),
        `${item.pacing_percent}%`,
        `${item.agency_fee_percent}%`,
        String(item.agency_fee_mtd_vnd),
        `${item.meta_tax_percent}%`,
        String(item.meta_tax_mtd_vnd),
        String(item.total_billable_mtd_vnd),
        String(item.spend_lifetime_vnd),
        String(item.total_billable_lifetime_vnd),
        String(item.unpaid_balance_vnd),
      ])
    }
    const csvContent =
      '\uFEFF' +
      rows
        .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Tong-Hop-Quyet-Toan-Khach-Hang-Agency-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyStatementSummary = (item: ClientRetainerItem) => {
    const isMtd = periodMode === 'MTD'
    const baseSpend = isMtd ? item.spend_mtd_vnd : item.spend_lifetime_vnd
    const feeVnd = isMtd ? item.agency_fee_mtd_vnd : item.agency_fee_lifetime_vnd
    const taxVnd = isMtd ? item.meta_tax_mtd_vnd : item.meta_tax_lifetime_vnd
    const totalBill = isMtd ? item.total_billable_mtd_vnd : item.total_billable_lifetime_vnd

    const lines = [
      `📊 BẢNG QUYẾT TOÁN NGÂN SÁCH QUẢNG CÁO META — ${item.client_name.toUpperCase()}`,
      `• Mã hợp đồng: ${item.contract_code} (${item.billing_cycle})`,
      `• Ngân sách cam kết: ${fmtVnd(item.committed_budget_vnd)} (Đã chạy MTD: ${item.pacing_percent}%)`,
      `• Danh sách TKQC (${item.account_count} tài khoản):`,
      ...item.linked_accounts.map(
        (a, idx) =>
          `   ${idx + 1}. ${a.display_name} (${a.external_account_id}) — Chi tiêu MTD: ${fmtVnd(a.mtd_vnd)} | Lũy kế: ${fmtVnd(a.lifetime_vnd)}`,
      ),
      `--------------------------------------------`,
      `1. Chi tiêu thực tế trên Meta (${isMtd ? 'Tháng này MTD' : 'Lũy kế'}): ${fmtVnd(baseSpend)}`,
      `2. Phí quản lý & tối ưu Agency (${item.agency_fee_percent}%): ${fmtVnd(feeVnd)}`,
      `3. Thuế nhà thầu Meta (${item.meta_tax_percent}%): ${fmtVnd(taxVnd)}`,
      `👉 TỔNG CỘNG QUYẾT TOÁN THANH TOÁN: ${fmtVnd(totalBill)}`,
    ]
    void navigator.clipboard.writeText(lines.join('\n'))
    setCopiedId(item.id)
    setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 2000)
    setBannerMsg(
      isEn
        ? `📋 Copied Client Settlement Summary for "${item.client_name}" — ready to paste into Zalo / Telegram / Email!`
        : `📋 Đã sao chép Phiếu Quyết Toán Chi Phí của «${item.client_name}» — bạn có thể dán gửi ngay qua Zalo / Telegram / Email cho khách!`,
    )
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">
            {isEn
              ? 'Client Retainer, Budget Pacing & Monthly Settlement Center'
              : 'Theo dõi Ngân sách Cam kết theo Khách hàng / Dự án & Bảng Quyết Toán Cuối Tháng'}
          </h1>
          <p className="text-xs text-ink-muted">
            {isEn
              ? 'Group multiple Ad Accounts into a single Client Contract, track real-time spend pacing against committed budgets, automatically calculate Agency Management Fee (5%–15%) + Meta Withholding Tax (5%–10%), and export client settlement statements.'
              : 'Gom nhiều TKQC vào 1 Hợp đồng Khách hàng / Dự án: theo dõi tiến độ cắn ngân sách cam kết (Pacing), tự động cộng % Phí quản lý Agency (5%–15%) + Thuế nhà thầu Meta (5%–10%) và xuất Bảng quyết toán chi phí gửi thẳng cho khách.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportAllRetainersCsv} className="gap-1.5 font-semibold">
            <Download className="h-3.5 w-3.5" />
            <span>{isEn ? '📥 Export All Contracts (.CSV)' : '📥 Xuất Tổng Hợp Quyết Toán (.CSV)'}</span>
          </Button>
          <Button size="sm" onClick={openCreateModal} className="gap-1.5 font-semibold">
            <Plus className="h-3.5 w-3.5" />
            <span>{isEn ? '+ New Client Contract' : '+ Tạo Hợp Đồng Khách Hàng Mới'}</span>
          </Button>
        </div>
      </div>

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="rounded p-0.5 hover:bg-emerald-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 5 KPI CARDS */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Active Client Contracts' : 'Hợp Đồng Khách Hàng'}</span>
            <Layers className="h-4 w-4 text-brand-text" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-ink">{summary.total_contracts}</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn
              ? `${summary.days_remaining_in_month} days left in billing cycle`
              : `Còn ${summary.days_remaining_in_month} ngày trong chu kỳ tháng`}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-ink-muted">
            <span>{isEn ? 'Total Committed Budget' : 'Tổng Ngân Sách Cam Kết'}</span>
            <Wallet className="h-4 w-4 text-brand-text" />
          </div>
          <div className="mt-1.5 font-mono text-lg font-extrabold text-ink">
            {fmtVnd(summary.total_committed_vnd)}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Monthly target across all clients' : 'Tổng hạn mức cam kết tháng của các HĐ'}
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span>
              {periodMode === 'MTD'
                ? isEn
                  ? 'Live Meta Spend (MTD)'
                  : 'Chi Tiêu Thật Tháng Này (MTD)'
                : isEn
                  ? 'Live Meta Spend (Lifetime)'
                  : 'Tổng Chi Tiêu Lũy Kế (Meta)'}
            </span>
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
            {fmtVnd(periodMode === 'MTD' ? summary.total_mtd_spend_vnd : summary.total_lifetime_spend_vnd)}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn
              ? '100% live from Meta Insights API (USD converted)'
              : '100% từ Meta API (đã quy đổi TKQC tiền USD)'}
          </div>
        </div>

        <div className="rounded-xl border border-brand/40 bg-brand-light/20 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-brand-text">
            <span>
              {periodMode === 'MTD'
                ? isEn
                  ? 'Total Billable Settlement (MTD)'
                  : 'Tổng Quyết Toán Thu Khách (MTD)'
                : isEn
                  ? 'Total Billable Settlement (Lifetime)'
                  : 'Tổng Quyết Toán Lũy Kế (Gồm Phí & Thuế)'}
            </span>
            <Calculator className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-lg font-extrabold text-brand-text">
            {fmtVnd(
              periodMode === 'MTD'
                ? summary.total_settlement_mtd_vnd
                : summary.total_settlement_lifetime_vnd,
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn
              ? 'Includes Agency Fee (8%–12%) + Meta Tax (5%–8%)'
              : 'Đã cộng Phí quản lý Agency + Thuế nhà thầu Meta'}
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400">
            <span>{isEn ? 'Unpaid Meta Card Balance' : 'Dư Nợ Thẻ Chưa Thanh Toán'}</span>
            <CreditCard className="h-4 w-4" />
          </div>
          <div className="mt-1.5 font-mono text-lg font-extrabold text-amber-600 dark:text-amber-400">
            {fmtVnd(summary.total_unpaid_balance_vnd)}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {isEn ? 'Live balance across grouped Ad Accounts' : 'Dư nợ thực tế đang chờ cắn thẻ trên Meta'}
          </div>
        </div>
      </div>

      {/* TOOLBAR: SEARCH & SETTLEMENT MODE TOGGLE */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isEn
                    ? 'Search by Client name, Contract code, Project, or Ad Account...'
                    : 'Tìm theo tên Khách hàng, Mã hợp đồng, Dự án hoặc tên TKQC...'
                }
                className="input pl-9 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink-muted">
                {isEn ? 'Settlement Calculation Mode:' : 'Chế độ tính Bảng quyết toán:'}
              </span>
              <div className="flex items-center rounded-lg border border-line bg-surface-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPeriodMode('MTD')}
                  className={`rounded-md px-3 py-1 font-bold transition ${
                    periodMode === 'MTD' ? 'bg-brand text-brand-fg shadow-xs' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? '📅 This Month (MTD Pacing)' : '📅 Theo Tháng Này (MTD)'}
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode('LIFETIME')}
                  className={`rounded-md px-3 py-1 font-bold transition ${
                    periodMode === 'LIFETIME' ? 'bg-brand text-brand-fg shadow-xs' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isEn ? '📊 Cumulative (Lifetime Spend)' : '📊 Theo Tổng Lũy Kế Toàn Dự Án'}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CONTRACT CARDS & PACING MATRIX */}
      <div className="space-y-4">
        {retainersQ.isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-xs text-ink-muted">
              {isEn ? 'Loading Client Retainer Contracts...' : 'Đang tải danh sách Hợp đồng Ngân sách Khách hàng...'}
            </CardContent>
          </Card>
        ) : filteredItems.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-xs text-ink-muted">
              {isEn
                ? 'No Client Contracts matched your filter.'
                : 'Chưa có Hợp đồng Khách hàng nào khớp bộ lọc.'}
            </CardContent>
          </Card>
        ) : (
          filteredItems.map((item) => {
            const isMtd = periodMode === 'MTD'
            const activeSpend = isMtd ? item.spend_mtd_vnd : item.spend_lifetime_vnd
            const activeFee = isMtd ? item.agency_fee_mtd_vnd : item.agency_fee_lifetime_vnd
            const activeTax = isMtd ? item.meta_tax_mtd_vnd : item.meta_tax_lifetime_vnd
            const activeTotalBill = isMtd ? item.total_billable_mtd_vnd : item.total_billable_lifetime_vnd
            const barWidth = Math.min(100, Math.max(2, item.pacing_percent))

            return (
              <Card key={item.id} className="overflow-hidden border-line">
                <CardHeader className="border-b border-line bg-surface-muted/40 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-brand/40 bg-brand-light px-2 py-0.5 font-mono text-xs font-extrabold text-brand-text">
                          {item.contract_code}
                        </span>
                        <CardTitle className="text-base font-extrabold text-ink">
                          {item.client_name}
                        </CardTitle>
                        <Badge
                          tone={
                            item.pacing_status === 'OVER_BUDGET'
                              ? 'attention'
                              : item.pacing_status === 'NEAR_CAP'
                                ? 'caution'
                                : 'positive'
                          }
                        >
                          {item.pacing_status === 'OVER_BUDGET'
                            ? isEn
                              ? `🔴 Over Budget (${item.pacing_percent}%)`
                              : `🔴 Vượt ngân sách (${item.pacing_percent}%)`
                            : item.pacing_status === 'NEAR_CAP'
                              ? isEn
                                ? `🟡 Near Cap (${item.pacing_percent}%)`
                                : `🟡 Sắp chạm trần (${item.pacing_percent}%)`
                              : isEn
                                ? `🟢 Pacing Safe (${item.pacing_percent}% MTD)`
                                : `🟢 Trong ngân sách (${item.pacing_percent}% MTD)`}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                        {item.project_name && <span>🎯 {item.project_name}</span>}
                        <span>📅 {item.billing_cycle}</span>
                        {item.tax_id && (
                          <span className="font-mono">
                            🧾 {isEn ? 'Tax ID:' : 'MST:'} {item.tax_id}
                          </span>
                        )}
                        <span className="font-mono">
                          💱 1 USD = {item.usd_to_vnd_rate.toLocaleString('vi-VN')} ₫
                        </span>
                      </div>
                    </div>

                    {/* ACTION BUTTONS PER CONTRACT */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setStatementItem(item)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg hover:bg-brand-hover transition"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>
                          {isEn ? '🧾 View & Print Settlement Invoice' : '🧾 Xem & In Phiếu Quyết Toán'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => exportSingleClientCsv(item)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span>{isEn ? 'Export Excel/CSV' : 'Xuất Excel/CSV'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => copyStatementSummary(item)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-brand"
                      >
                        {copiedId === item.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-brand-text" />
                        )}
                        <span>
                          {copiedId === item.id
                            ? isEn
                              ? 'Copied!'
                              : 'Đã chép!'
                            : isEn
                              ? 'Copy for Zalo/Email'
                              : 'Chép gửi Zalo/ Khách'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-brand"
                      >
                        <Settings2 className="h-3.5 w-3.5 text-brand-text" />
                        <span>{isEn ? 'Edit Contract' : 'Sửa HĐ / Gắn TKQC'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteMut.mutate(item.id)}
                        className="inline-flex items-center rounded-md border border-line bg-surface p-1.5 text-ink-muted hover:border-rose-500 hover:text-rose-600"
                        title={isEn ? 'Delete Contract' : 'Xóa hợp đồng'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {/* PACING PROGRESS BAR & FINANCIAL BREAKDOWN */}
                  <div className="grid gap-4 lg:grid-cols-12">
                    {/* LEFT: PACING BAR */}
                    <div className="lg:col-span-5 rounded-lg border border-line bg-surface-muted/30 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-ink">
                          {isEn
                            ? '📈 Monthly Budget Pacing (MTD vs Committed)'
                            : '📈 Tiến độ giải ngân Ngân sách Tháng (MTD / Cam kết)'}
                        </span>
                        <span className="font-mono text-brand-text">{item.pacing_percent}%</span>
                      </div>

                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.pacing_status === 'OVER_BUDGET'
                              ? 'bg-rose-500'
                              : item.pacing_status === 'NEAR_CAP'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                        <div>
                          <div className="text-ink-muted">
                            {isEn ? 'Committed Budget:' : 'Ngân sách cam kết:'}
                          </div>
                          <div className="font-mono font-bold text-ink">
                            {fmtVnd(item.committed_budget_vnd)}
                          </div>
                        </div>
                        <div>
                          <div className="text-ink-muted">
                            {isEn ? 'Remaining (MTD):' : 'Ngân sách còn lại:'}
                          </div>
                          <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {fmtVnd(item.remaining_budget_vnd)}
                          </div>
                        </div>
                        <div>
                          <div className="text-ink-muted">
                            {isEn ? 'Target Daily Pacing:' : 'Khuyến nghị chạy/ngày:'}
                          </div>
                          <div className="font-mono font-bold text-brand-text">
                            {fmtVnd(item.recommended_daily_vnd)}/{isEn ? 'day' : 'ngày'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: SETTLEMENT FORMULA BREAKDOWN */}
                    <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="rounded-lg border border-line bg-surface p-3">
                        <div className="text-[11px] font-semibold text-ink-muted">
                          {isEn ? '1. Net Meta Ad Spend' : '1. Chi tiêu gốc Meta'}
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-ink">
                          {fmtVnd(activeSpend)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          {isMtd
                            ? isEn
                              ? `Today: ${fmtVnd(item.spend_today_vnd)}`
                              : `Hôm nay: ${fmtVnd(item.spend_today_vnd)}`
                            : isEn
                              ? `MTD: ${fmtVnd(item.spend_mtd_vnd)}`
                              : `Tháng này: ${fmtVnd(item.spend_mtd_vnd)}`}
                        </div>
                      </div>

                      <div className="rounded-lg border border-line bg-surface p-3">
                        <div className="text-[11px] font-semibold text-ink-muted">
                          {isEn
                            ? `2. Agency Fee (${item.agency_fee_percent}%)`
                            : `2. Phí Agency (${item.agency_fee_percent}%)`}
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-ink">
                          + {fmtVnd(activeFee)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          {isEn ? 'Management & optimization' : 'Phí quản lý & tối ưu camp'}
                        </div>
                      </div>

                      <div className="rounded-lg border border-line bg-surface p-3">
                        <div className="text-[11px] font-semibold text-ink-muted">
                          {isEn
                            ? `3. Meta Tax (${item.meta_tax_percent}%)`
                            : `3. Thuế nhà thầu (${item.meta_tax_percent}%)`}
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-ink">
                          + {fmtVnd(activeTax)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          {isEn ? 'Meta contractor tax (VAT/FCT)' : 'Thuế nhà thầu Meta (5%–10%)'}
                        </div>
                      </div>

                      <div className="rounded-lg border border-brand/40 bg-brand-light/30 p-3">
                        <div className="text-[11px] font-extrabold text-brand-text">
                          {isEn ? '4. TOTAL SETTLEMENT' : '4. TỔNG QUYẾT TOÁN'}
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-brand-text">
                          {fmtVnd(activeTotalBill)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          {isEn ? '(1) + (2) + (3) Billable to Client' : 'Tổng thu khách = (1) + (2) + (3)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* GROUPED AD ACCOUNTS TABLE INSIDE CONTRACT */}
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-line bg-surface-muted/60 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                          <th className="px-3 py-2">
                            {isEn
                              ? `Grouped Ad Accounts (${item.account_count})`
                              : `Danh sách TKQC thuộc Hợp đồng (${item.account_count})`}
                          </th>
                          <th className="px-3 py-2">{isEn ? 'Owning BM' : 'BM Chủ Quản'}</th>
                          <th className="px-3 py-2">{isEn ? 'Card & Currency' : 'Thẻ & Tiền Tệ'}</th>
                          <th className="px-3 py-2 text-right">{isEn ? 'Spend Today' : 'Chi Tiêu Hôm Nay'}</th>
                          <th className="px-3 py-2 text-right">{isEn ? 'Spend MTD' : 'Chi Tiêu Tháng (MTD)'}</th>
                          <th className="px-3 py-2 text-right">{isEn ? 'Lifetime Spend' : 'Chi Tiêu Lũy Kế'}</th>
                          <th className="px-3 py-2 text-right">{isEn ? 'Unpaid Card Balance' : 'Dư Nợ Trên Thẻ'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {item.linked_accounts.map((acc) => (
                          <tr key={acc.id} className="hover:bg-surface-muted/30">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <span>
                                  {acc.status === 'active' ? '🟢' : acc.status === 'restricted' ? '🟡' : '🔴'}
                                </span>
                                <Link
                                  to={`/accounts/${acc.id}`}
                                  className="font-bold text-ink hover:text-brand-text hover:underline"
                                >
                                  {acc.display_name}
                                </Link>
                                <span className="font-mono text-[11px] text-ink-muted">
                                  ({acc.external_account_id})
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-ink-muted">
                              {acc.bm_name || (isEn ? 'Personal Account' : 'TK Cá nhân')}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px]">
                              <span className="rounded bg-surface-muted px-1.5 py-0.5 font-bold text-ink">
                                {acc.currency}
                              </span>{' '}
                              <span className="text-ink-muted">
                                {acc.payment_card_display || (isEn ? 'No card' : 'Chưa gắn thẻ')}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{fmtVnd(acc.today_vnd)}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {fmtVnd(acc.mtd_vnd)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{fmtVnd(acc.lifetime_vnd)}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                              {fmtVnd(acc.balance_vnd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* MODAL 1: CREATE / EDIT CLIENT RETAINER CONTRACT */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-base font-bold text-ink">
                {editingId
                  ? isEn
                    ? 'Edit Client Retainer Contract & Linked Ad Accounts'
                    : 'Cập nhật Hợp đồng Ngân sách Khách hàng & Gắn TKQC'
                  : isEn
                    ? 'Create New Client Retainer Contract'
                    : 'Tạo Hợp đồng Ngân sách Khách hàng / Dự án Mới'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-ink-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">{isEn ? 'Contract Code *' : 'Mã Hợp đồng *'}</label>
                <input
                  type="text"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="input font-mono text-xs"
                  placeholder="HD-MB-2026-01"
                />
              </div>
              <div>
                <label className="label text-xs">{isEn ? 'Billing Cycle *' : 'Kỳ quyết toán *'}</label>
                <input
                  type="text"
                  value={formCycle}
                  onChange={(e) => setFormCycle(e.target.value)}
                  className="input text-xs"
                  placeholder="Tháng 11/2026"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label text-xs">{isEn ? 'Client / Company Name *' : 'Tên Khách hàng / Doanh nghiệp *'}</label>
                <input
                  type="text"
                  value={formClient}
                  onChange={(e) => setFormClient(e.target.value)}
                  className="input text-xs font-bold"
                  placeholder="VD: Công Ty Cổ Phần Mắt Bão"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label text-xs">{isEn ? 'Project / Campaign Scope' : 'Tên Dự án / Chiến dịch'}</label>
                <input
                  type="text"
                  value={formProject}
                  onChange={(e) => setFormProject(e.target.value)}
                  className="input text-xs"
                  placeholder="VD: Chiến dịch Chuyển đổi Website & Remarketing"
                />
              </div>
              <div>
                <label className="label text-xs">
                  {isEn ? 'Committed Monthly Budget (VND) *' : 'Ngân sách Cam kết Tháng (VNĐ) *'}
                </label>
                <input
                  type="number"
                  value={formBudget}
                  onChange={(e) => setFormBudget(e.target.value)}
                  className="input font-mono text-xs font-bold"
                />
              </div>
              <div>
                <label className="label text-xs">
                  {isEn ? 'USD → VND Exchange Rate' : 'Tỷ giá quy đổi TKQC USD → VNĐ'}
                </label>
                <input
                  type="number"
                  value={formUsdRate}
                  onChange={(e) => setFormUsdRate(e.target.value)}
                  className="input font-mono text-xs"
                />
              </div>
              <div>
                <label className="label text-xs">
                  {isEn ? 'Agency Management Fee (%) [5%–15%]' : '% Phí Quản lý Agency (5%–15%)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={formFeePct}
                  onChange={(e) => setFormFeePct(e.target.value)}
                  className="input font-mono text-xs font-bold text-brand-text"
                />
              </div>
              <div>
                <label className="label text-xs">
                  {isEn ? 'Meta Withholding Tax (%) [5%–10%]' : '% Thuế Nhà thầu Meta (5%–10%)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={formTaxPct}
                  onChange={(e) => setFormTaxPct(e.target.value)}
                  className="input font-mono text-xs font-bold"
                />
              </div>
              <div>
                <label className="label text-xs">{isEn ? 'Client Email' : 'Email Khách hàng'}</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="input text-xs"
                />
              </div>
              <div>
                <label className="label text-xs">{isEn ? 'Client Tax ID (MST)' : 'Mã số thuế (MST) Khách hàng'}</label>
                <input
                  type="text"
                  value={formTaxId}
                  onChange={(e) => setFormTaxId(e.target.value)}
                  className="input font-mono text-xs"
                />
              </div>
            </div>

            {/* SELECT AD ACCOUNTS TO GROUP INTO THIS CONTRACT */}
            <div className="space-y-1.5">
              <label className="label text-xs">
                {isEn
                  ? `Select Ad Accounts to group into this Contract (${formAccIds.length} selected):`
                  : `Chọn các Tài khoản Quảng cáo (TKQC) gom vào Hợp đồng này (Đã chọn ${formAccIds.length} TKQC):`}
              </label>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-muted/40 p-2 space-y-1">
                {allAccounts.map((acc) => {
                  const checked = formAccIds.includes(acc.id)
                  return (
                    <label
                      key={acc.id}
                      className={`flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-xs transition ${
                        checked ? 'bg-brand-light font-bold text-brand-text' : 'hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFormAcc(acc.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span>{acc.display_name}</span>
                        <span className="font-mono text-[11px] text-ink-muted">
                          ({acc.external_account_id})
                        </span>
                      </div>
                      <span className="text-[11px] text-ink-muted">
                        {acc.business_manager_name || 'Personal'} · {acc.currency}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="label text-xs">{isEn ? 'Contract Notes' : 'Ghi chú điều khoản quyết toán'}</label>
              <textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="input text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              <Button
                size="sm"
                disabled={saveMut.isPending || !formClient.trim()}
                onClick={() =>
                  saveMut.mutate({
                    id: editingId,
                    contract_code: formCode,
                    client_name: formClient,
                    project_name: formProject,
                    contact_email: formEmail,
                    tax_id: formTaxId,
                    billing_cycle: formCycle,
                    committed_budget_vnd: Number(formBudget) || 0,
                    agency_fee_percent: Number(formFeePct) || 0,
                    meta_tax_percent: Number(formTaxPct) || 0,
                    usd_to_vnd_rate: Number(formUsdRate) || 25400,
                    ad_account_ids: formAccIds,
                    notes: formNotes,
                  })
                }
              >
                {saveMut.isPending
                  ? isEn
                    ? 'Saving...'
                    : 'Đang lưu...'
                  : isEn
                    ? '💾 Save Client Contract'
                    : '💾 Lưu Hợp Đồng & Gắn TKQC'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: PRINTABLE CLIENT SETTLEMENT STATEMENT */}
      {statementItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-2xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-brand-text">
                  {isEn ? 'OFFICIAL AGENCY AD SPEND SETTLEMENT STATEMENT' : 'BẢNG QUYẾT TOÁN CHI PHÍ QUẢNG CÁO META (GỬI KHÁCH HÀNG)'}
                </div>
                <h2 className="mt-0.5 text-lg font-extrabold text-ink">
                  {statementItem.client_name} — {statementItem.contract_code}
                </h2>
                <p className="text-xs text-ink-muted">
                  {statementItem.project_name} · {isEn ? 'Cycle:' : 'Kỳ quyết toán:'} {statementItem.billing_cycle}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => exportSingleClientCsv(statementItem)}
                  className="gap-1.5"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>{isEn ? 'Download Excel/CSV' : 'Tải Excel/CSV'}</span>
                </Button>
                <Button size="sm" onClick={() => window.print()} className="gap-1.5">
                  <Printer className="h-3.5 w-3.5" />
                  <span>{isEn ? 'Print / Save PDF' : 'In / Xuất PDF gửi khách'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setStatementItem(null)}
                  className="rounded p-1 text-ink-muted hover:bg-surface-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-line bg-surface-muted/40 p-3.5 text-xs">
              <div>
                <div className="text-ink-muted">{isEn ? 'Committed Budget:' : 'Ngân sách cam kết:'}</div>
                <div className="font-mono font-bold text-ink">{fmtVnd(statementItem.committed_budget_vnd)}</div>
              </div>
              <div>
                <div className="text-ink-muted">{isEn ? 'Client Tax ID:' : 'Mã số thuế:'}</div>
                <div className="font-mono font-bold text-ink">{statementItem.tax_id || '—'}</div>
              </div>
              <div>
                <div className="text-ink-muted">{isEn ? 'USD Exchange Rate:' : 'Tỷ giá USD quy đổi:'}</div>
                <div className="font-mono font-bold text-ink">
                  {statementItem.usd_to_vnd_rate.toLocaleString('vi-VN')} ₫
                </div>
              </div>
              <div>
                <div className="text-ink-muted">{isEn ? 'Fee & Tax Terms:' : 'Phí Agency & Thuế Meta:'}</div>
                <div className="font-mono font-bold text-brand-text">
                  +{statementItem.agency_fee_percent}% Fee · +{statementItem.meta_tax_percent}% Tax
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[11px] font-bold uppercase text-ink-muted">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">{isEn ? 'Ad Account Name & ID' : 'Tên TKQC & Mã ID'}</th>
                    <th className="px-3 py-2">{isEn ? 'Currency' : 'Tiền Tệ'}</th>
                    <th className="px-3 py-2 text-right">{isEn ? 'Spend MTD (VND)' : 'Chi Tiêu Tháng MTD'}</th>
                    <th className="px-3 py-2 text-right">{isEn ? 'Lifetime Spend (VND)' : 'Chi Tiêu Lũy Kế'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {statementItem.linked_accounts.map((acc, i) => (
                    <tr key={acc.id}>
                      <td className="px-3 py-2 font-mono">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-ink">{acc.display_name}</div>
                        <div className="font-mono text-[11px] text-ink-muted">ID: {acc.external_account_id}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{acc.currency}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{fmtVnd(acc.mtd_vnd)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtVnd(acc.lifetime_vnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* SUMMARY TOTALS BOX */}
            <div className="rounded-xl border border-brand/40 bg-brand-light/20 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">
                  {isEn
                    ? `1. Total Net Meta Ad Spend (${periodMode === 'MTD' ? 'This Month MTD' : 'Cumulative Lifetime'}):`
                    : `1. Tổng chi tiêu quảng cáo thực tế trên Meta (${periodMode === 'MTD' ? 'Tháng này MTD' : 'Lũy kế'}):`}
                </span>
                <span className="font-mono text-sm font-bold text-ink">
                  {fmtVnd(periodMode === 'MTD' ? statementItem.spend_mtd_vnd : statementItem.spend_lifetime_vnd)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">
                  {isEn
                    ? `2. Agency Management & Optimization Fee (${statementItem.agency_fee_percent}%):`
                    : `2. Phí quản lý & tối ưu tài khoản Agency (${statementItem.agency_fee_percent}%):`}
                </span>
                <span className="font-mono text-sm font-bold text-ink">
                  + {fmtVnd(periodMode === 'MTD' ? statementItem.agency_fee_mtd_vnd : statementItem.agency_fee_lifetime_vnd)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-line pb-2">
                <span className="font-semibold text-ink">
                  {isEn
                    ? `3. Meta Foreign Contractor Withholding Tax (${statementItem.meta_tax_percent}%):`
                    : `3. Thuế nhà thầu Meta (${statementItem.meta_tax_percent}%):`}
                </span>
                <span className="font-mono text-sm font-bold text-ink">
                  + {fmtVnd(periodMode === 'MTD' ? statementItem.meta_tax_mtd_vnd : statementItem.meta_tax_lifetime_vnd)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="font-extrabold text-brand-text">
                  {isEn
                    ? 'TOTAL AMOUNT PAYABLE BY CLIENT (1 + 2 + 3):'
                    : 'TỔNG SỐ TIỀN QUYẾT TOÁN KHÁCH HÀNG THANH TOÁN (1 + 2 + 3):'}
                </span>
                <span className="font-mono text-lg font-extrabold text-brand-text">
                  {fmtVnd(
                    periodMode === 'MTD'
                      ? statementItem.total_billable_mtd_vnd
                      : statementItem.total_billable_lifetime_vnd,
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
