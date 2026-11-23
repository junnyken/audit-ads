import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Code2, Eye, FileSpreadsheet, RefreshCw, Rocket, Search, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InspectorDrawer, InspectorSection } from '@/components/ui/inspector-drawer'
import { PolicyPreCheckPanel } from '@/components/ui/policy-precheck-panel'
import { FinancialValue, SegmentedTabs, StatusDot } from '@/components/ui/studio-primitives'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleAdAccountId, useShellUi } from '@/lib/shell-context'
import type { AppShellWebStateDto, WebAdAccountDto } from '@/types'

function formatGoogleCid(extId: string): string {
  const raw = (extId || '').replace(/^gads_/i, '')
  return raw.length === 10 ? `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}` : raw
}

export function AdAccountsTab({
  state,
  initialSearch = '',
  initialFilter = 'all',
}: {
  state: AppShellWebStateDto
  initialSearch?: string
  initialFilter?: string
}) {
  const { platformScope } = useShellUi()
  const [search, setSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState(initialFilter || 'all')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'meta' | 'google_ads'>(platformScope)
  const [inspected, setInspected] = useState<WebAdAccountDto | null>(null)
  const [showPolicyPanel, setShowPolicyPanel] = useState(false)

  useEffect(() => {
    setPlatformFilter(platformScope)
  }, [platformScope])

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    if (initialFilter) setStatusFilter(initialFilter)
  }, [initialFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.adAccounts.filter((a) => {
      const okTab =
        statusFilter === 'active'
          ? a.isActive
          : statusFilter === 'disabled' || statusFilter === 'restricted'
          ? !a.isActive
          : true
      if (!okTab) return false
      const gads = isGoogleAdAccountId(a.externalAccountId)
      if (platformFilter === 'meta' && gads) return false
      if (platformFilter === 'google_ads' && !gads) return false
      if (!q) return true
      return (
        a.displayName.toLowerCase().includes(q) ||
        a.externalAccountId.toLowerCase().includes(q) ||
        a.bmName.toLowerCase().includes(q)
      )
    })
  }, [state.adAccounts, search, statusFilter, platformFilter])

  const activeCount = state.adAccounts.filter((a) => a.isActive).length
  const restrictedCount = state.adAccounts.length - activeCount
  const googleCount = state.adAccounts.filter((a) => isGoogleAdAccountId(a.externalAccountId)).length
  const metaCount = state.adAccounts.length - googleCount

  return (
    <div className="space-y-4">
      {/* Multi-Currency Executive Summary Strip (Zero nested boxes) */}
      {state.spendCurrencies.length > 0 && (
        <div className="studio-panel grid grid-cols-1 divide-y divide-border/75 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
          {state.spendCurrencies.map((b) => (
            <div key={b.currency} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Chi tiêu {b.currency}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {b.accountsIncluded} TKQC
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-3 font-mono text-xs tabular-nums">
                <span>
                  <span className="text-muted-foreground">HN:</span>{' '}
                  <strong className="font-semibold text-foreground">{b.todayText}</strong>
                </span>
                <span className="text-border">·</span>
                <span>
                  <span className="text-muted-foreground">7D:</span>{' '}
                  <strong className="font-semibold text-foreground">{b.last7dText}</strong>
                </span>
                <span className="text-border">·</span>
                <span>
                  <span className="text-muted-foreground">Tháng:</span>{' '}
                  <strong className="font-semibold text-foreground">{b.mtdText}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Single-Line Progressive Disclosure Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              { value: 'all', label: 'Tất cả', count: state.adAccounts.length },
              { value: 'active', label: 'Active', count: activeCount },
              { value: 'disabled', label: 'Hạn chế / Khác', count: restrictedCount },
            ]}
          />

          <SegmentedTabs
            value={platformFilter}
            onChange={setPlatformFilter}
            items={[
              { value: 'all', label: 'Mọi nền tảng' },
              { value: 'meta', label: 'Meta', count: metaCount },
              { value: 'google_ads', label: 'Google Ads', count: googleCount },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên TKQC, act_ID, CID, BM..."
              className="h-8 pl-8 text-xs"
            />
          </div>

          <Button
            variant={showPolicyPanel ? 'default' : 'secondary'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowPolicyPanel((prev) => !prev)}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Kiểm duyệt Chính sách
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => sendDesktopCommand('open_google_ads_script_wizard')}
            title="Lấy mã Google Ads Script cho MCC & Gmail khách độc lập (0% rủi ro)"
          >
            <Code2 className="h-3.5 w-3.5 text-emerald-500" /> Google Script
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => sendDesktopCommand('export_ad_accounts_csv')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs font-semibold" onClick={() => sendDesktopCommand('quick_sync_meta')}>
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ Meta
          </Button>
        </div>
      </div>

      {showPolicyPanel && (
        <PolicyPreCheckPanel
          mode="ad_copy"
          onClose={() => setShowPolicyPanel(false)}
        />
      )}

      {/* Financial Table (Bloomberg / Stripe precision) */}
      {state.adAccounts.length === 0 ? (
        <div className="studio-panel flex flex-col items-center justify-center gap-3 py-12 text-center">
          <BarChart3 className="h-9 w-9 text-muted-foreground/60" />
          <div>
            <div className="text-sm font-semibold text-foreground">Chưa có Tài khoản Quảng cáo</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Kết nối Meta Token hoặc Google Ads Script để nạp danh sách tài khoản.
            </p>
          </div>
          <Button size="sm" onClick={() => sendDesktopCommand('quick_sync_meta')}>
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ nhanh Meta
          </Button>
        </div>
      ) : (
        <div className="studio-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tài khoản &amp; ID</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Số dư</TableHead>
                <TableHead className="text-right">Ngưỡng</TableHead>
                <TableHead className="text-right">Giới hạn ngày</TableHead>
                <TableHead className="text-right">Chi tiêu (HN / 7D)</TableHead>
                <TableHead>BM &amp; Via cầm</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((acc) => {
                const isGads = isGoogleAdAccountId(acc.externalAccountId)
                const isRestricted = !acc.isActive && acc.status.toUpperCase().includes('RESTRICT')
                return (
                  <TableRow key={acc.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setInspected(acc)}
                        className="group flex max-w-[230px] items-center gap-1.5 text-left"
                      >
                        <span className="shrink-0 rounded bg-muted/85 px-1.5 py-[1px] font-mono text-[9.5px] font-medium uppercase text-muted-foreground">
                          {isGads ? 'GADS' : 'META'}
                        </span>
                        <span className="truncate text-[13px] font-semibold text-foreground transition-colors group-hover:text-primary">
                          {acc.displayName}
                        </span>
                      </button>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/85">
                        {isGads
                          ? `CID ${formatGoogleCid(acc.externalAccountId)}`
                          : `act_${acc.externalAccountId}`}{' '}
                        · {acc.currency}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusDot
                        tone={acc.isActive ? 'live' : isRestricted ? 'warning' : 'critical'}
                        label={acc.status}
                        labelClassName="font-mono text-[11px]"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <FinancialValue value={acc.balanceText} />
                    </TableCell>
                    <TableCell className="text-right">
                      <FinancialValue value={acc.thresholdText} />
                    </TableCell>
                    <TableCell className="text-right">
                      <FinancialValue value={acc.dailyLimitText} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="inline-flex items-baseline gap-1 font-mono text-[11px] tabular-nums">
                          <span className="text-muted-foreground/65">HN:</span>
                          <FinancialValue value={acc.spendTodayText} className="text-[11px]" />
                        </div>
                        <div className="inline-flex items-baseline gap-1 font-mono text-[11px] tabular-nums">
                          <span className="text-muted-foreground/65">7D:</span>
                          <FinancialValue value={acc.spend7dText} className="text-[11px]" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[190px] truncate text-xs font-medium text-foreground">
                        {acc.bmName}
                      </div>
                      <div className="max-w-[190px] truncate text-[11px] text-muted-foreground">
                        {acc.paymentCard ? `Via: ${acc.viaLabels} · ${acc.paymentCard}` : `Via: ${acc.viaLabels}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                          title="Xem chi tiết tài khoản"
                          onClick={() => setInspected(acc)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                          title="Làm mới Chi tiêu TKQC"
                          onClick={() => sendDesktopCommand('refresh_ad_spend', { accountId: acc.id })}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-border/80 bg-transparent px-2.5 text-xs hover:border-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                          onClick={() => sendDesktopCommand('open_ads_manager', { accountId: acc.id })}
                        >
                          <Rocket className="h-3 w-3" /> {isGads ? 'Google Ads' : 'Ads Manager'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Slide-Over Account Inspector Drawer */}
      <InspectorDrawer
        open={Boolean(inspected)}
        onOpenChange={(o) => !o && setInspected(null)}
        title={inspected?.displayName || ''}
        subtitle={
          inspected
            ? isGoogleAdAccountId(inspected.externalAccountId)
              ? `Google Ads CID ${formatGoogleCid(inspected.externalAccountId)}`
              : `Meta act_${inspected.externalAccountId}`
            : ''
        }
        badge={
          inspected && (
            <Badge variant={inspected.isActive ? 'success' : 'destructive'}>{inspected.status}</Badge>
          )
        }
        footer={
          inspected && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('refresh_ad_spend', { accountId: inspected.id })}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Cập nhật chi tiêu
              </Button>
              <Button
                size="sm"
                onClick={() => sendDesktopCommand('open_ads_manager', { accountId: inspected.id })}
              >
                <Rocket className="h-3.5 w-3.5" />
                {isGoogleAdAccountId(inspected.externalAccountId) ? 'Mở Google Ads' : 'Mở Ads Manager'}
              </Button>
            </div>
          )
        }
      >
        {inspected && (
          <div className="space-y-3 text-xs">
            <InspectorSection title="Số liệu Chi tiêu & Giới hạn">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-lg border border-border/75 bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Chi tiêu hôm nay</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                    {inspected.spendTodayText}
                  </div>
                </div>
                <div className="rounded-lg border border-border/75 bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Chi tiêu 7 ngày</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                    {inspected.spend7dText}
                  </div>
                </div>
                <div className="rounded-lg border border-border/75 bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Số dư hiện tại</div>
                  <div className="mt-0.5 font-mono text-xs font-medium tabular-nums">
                    {inspected.balanceText}
                  </div>
                </div>
                <div className="rounded-lg border border-border/75 bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Ngưỡng / Giới hạn</div>
                  <div className="mt-0.5 font-mono text-xs font-medium tabular-nums">
                    {inspected.thresholdText} · {inspected.dailyLimitText}
                  </div>
                </div>
              </div>
            </InspectorSection>

            <InspectorSection title="Liên kết Quản trị & Thanh toán">
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Tiền tệ:</dt>
                  <dd className="font-mono font-medium">{inspected.currency}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">BM / MCC sở hữu:</dt>
                  <dd className="font-medium text-right">{inspected.bmName || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Hồ sơ / Via cầm:</dt>
                  <dd className="font-medium text-right">{inspected.viaLabels || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Phương thức thanh toán:</dt>
                  <dd className="font-mono text-right">{inspected.paymentCard || 'Chưa gắn'}</dd>
                </div>
              </dl>
            </InspectorSection>
          </div>
        )}
      </InspectorDrawer>
    </div>
  )
}
