import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Code2, Eye, FileSpreadsheet, RefreshCw, Rocket, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InspectorDrawer, InspectorSection } from '@/components/ui/inspector-drawer'
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
    <div className="space-y-3.5">
      {/* Multi-Currency Spend Strip */}
      {state.spendCurrencies.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {state.spendCurrencies.map((b) => (
            <Card key={b.currency} className="border-primary/25 bg-primary/5">
              <CardContent className="p-3">
                <div className="text-[11px] font-semibold text-primary">
                  Chi tiêu {b.currency} ({b.accountsIncluded} TKQC)
                </div>
                <div className="mt-1 font-mono text-xs tabular-nums text-foreground">
                  Hôm nay: {b.todayText} • 7D: {b.last7dText} • Tháng: {b.mtdText}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <Card>
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên TKQC, act_ID, Google CID, tên BM..."
                className="pl-8"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sendDesktopCommand('open_google_ads_script_wizard')}
              title="Lấy mã Google Ads Script cho MCC & Gmail khách độc lập (0% rủi ro)"
            >
              <Code2 className="h-3.5 w-3.5 text-emerald-500" /> Kết nối Google Ads Script
            </Button>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_ad_accounts_csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
            </Button>
            <Button size="sm" onClick={() => sendDesktopCommand('quick_sync_meta')}>
              <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ nhanh Meta
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: `Tất cả (${state.adAccounts.length})` },
                { key: 'active', label: `Active (${activeCount})` },
                { key: 'disabled', label: `Hạn chế / Khác (${restrictedCount})` },
              ].map((ch) => (
                <Button
                  key={ch.key}
                  type="button"
                  size="sm"
                  variant={statusFilter === ch.key ? 'default' : 'secondary'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setStatusFilter(ch.key)}
                >
                  {ch.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all' as const, label: 'Mọi nền tảng' },
                { key: 'meta' as const, label: `Meta (${metaCount})` },
                { key: 'google_ads' as const, label: `Google Ads (${googleCount})` },
              ].map((pf) => (
                <Button
                  key={pf.key}
                  type="button"
                  size="sm"
                  variant={platformFilter === pf.key ? 'default' : 'secondary'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPlatformFilter(pf.key)}
                >
                  {pf.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Table */}
      {state.adAccounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <BarChart3 className="h-9 w-9 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold text-foreground">Chưa có Tài khoản Quảng cáo</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Kết nối Meta Token hoặc Google Ads Script để nạp danh sách tài khoản.
              </p>
            </div>
            <Button onClick={() => sendDesktopCommand('quick_sync_meta')}>
              <RefreshCw className="h-4 w-4" /> Đồng bộ nhanh Meta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
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
                  return (
                    <TableRow key={acc.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setInspected(acc)}
                          className="group flex max-w-[230px] items-center gap-1.5 text-left"
                        >
                          <Badge
                            variant={isGads ? 'success' : 'info'}
                            className="shrink-0 px-1.5 py-0 text-[9px]"
                          >
                            {isGads ? 'GOOGLE' : 'META'}
                          </Badge>
                          <span className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                            {acc.displayName}
                          </span>
                        </button>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {isGads
                            ? `CID ${formatGoogleCid(acc.externalAccountId)}`
                            : `act_${acc.externalAccountId}`}{' '}
                          • {acc.currency}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={acc.isActive ? 'success' : 'destructive'} className="text-[10px]">
                          {acc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {acc.balanceText}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {acc.thresholdText}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {acc.dailyLimitText}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums">
                        <div className="text-foreground">HN: {acc.spendTodayText}</div>
                        <div className="text-muted-foreground">7D: {acc.spend7dText}</div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[190px] truncate text-xs text-foreground">{acc.bmName}</div>
                        <div className="max-w-[190px] truncate text-[11px] text-muted-foreground">
                          {acc.paymentCard ? `Via: ${acc.viaLabels} • ${acc.paymentCard}` : `Via: ${acc.viaLabels}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 px-0"
                            title="Xem chi tiết tài khoản"
                            onClick={() => setInspected(acc)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 px-0"
                            title="Làm mới Chi tiêu TKQC"
                            onClick={() => sendDesktopCommand('refresh_ad_spend', { accountId: acc.id })}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
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
          </CardContent>
        </Card>
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
                <div className="rounded-md border border-border bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Chi tiêu hôm nay</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                    {inspected.spendTodayText}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Chi tiêu 7 ngày</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                    {inspected.spend7dText}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Số dư hiện tại</div>
                  <div className="mt-0.5 font-mono text-xs font-medium tabular-nums">
                    {inspected.balanceText}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card p-2.5">
                  <div className="text-[11px] text-muted-foreground">Ngưỡng / Giới hạn</div>
                  <div className="mt-0.5 font-mono text-xs font-medium tabular-nums">
                    {inspected.thresholdText} • {inspected.dailyLimitText}
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
