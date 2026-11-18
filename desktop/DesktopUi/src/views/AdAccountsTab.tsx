import { useEffect, useMemo, useState } from 'react'
import { BarChart3, FileSpreadsheet, RefreshCw, Rocket, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { sendDesktopCommand } from '@/lib/bridge'
import type { AppShellWebStateDto } from '@/types'

export function AdAccountsTab({
  state,
  initialSearch = '',
  initialFilter = 'all',
}: {
  state: AppShellWebStateDto
  initialSearch?: string
  initialFilter?: string
}) {
  const [search, setSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState(initialFilter || 'all')

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
      if (!q) return true
      return (
        a.displayName.toLowerCase().includes(q) ||
        a.externalAccountId.toLowerCase().includes(q) ||
        a.bmName.toLowerCase().includes(q)
      )
    })
  }, [state.adAccounts, search, statusFilter])

  const activeCount = state.adAccounts.filter((a) => a.isActive).length
  const restrictedCount = state.adAccounts.length - activeCount

  return (
    <div className="space-y-3.5">
      {/* Spend Summary Multi-Currency Strip */}
      {state.spendCurrencies.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {state.spendCurrencies.map((b) => (
            <Card key={b.currency} className="border-primary/40 bg-primary/5">
              <CardContent className="p-3">
                <div className="text-[11px] font-bold text-primary">
                  Tổng chi tiêu {b.currency} ({b.accountsIncluded} TKQC)
                </div>
                <div className="mt-1 font-mono text-xs tabular-nums text-foreground">
                  Hôm nay: {b.todayText} • 7 ngày: {b.last7dText} • Tháng này: {b.mtdText}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search & Action Header */}
      <Card>
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên TKQC, act_ID, tên BM..."
                className="pl-8"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_ad_accounts_csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
            </Button>
            <Button size="sm" onClick={() => sendDesktopCommand('quick_sync_meta')}>
              <RefreshCw className="h-3.5 w-3.5" /> Quick Sync Meta
            </Button>
          </div>

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
        </CardContent>
      </Card>

      {/* Ad Accounts Tabular View */}
      {state.adAccounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <BarChart3 className="h-9 w-9 text-muted-foreground" />
            <div>
              <div className="text-sm font-bold text-foreground">Chưa có Tài khoản Quảng cáo nào</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Kết nối Meta Token trên Web hoặc nhấn Quick Sync Meta để nạp danh sách TKQC.
              </p>
            </div>
            <Button onClick={() => sendDesktopCommand('quick_sync_meta')}>
              <RefreshCw className="h-4 w-4" /> Quick Sync Meta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>TÀI KHOẢN &amp; ID</TableHead>
                  <TableHead>TRẠNG THÁI</TableHead>
                  <TableHead className="text-right">SỐ DƯ</TableHead>
                  <TableHead className="text-right">NGƯỠNG</TableHead>
                  <TableHead className="text-right">GIỚI HẠN NGÀY</TableHead>
                  <TableHead className="text-right">CHI TIÊU (HN / 7D)</TableHead>
                  <TableHead>BM &amp; VIA CẦM</TableHead>
                  <TableHead className="text-right">THAO TÁC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell>
                      <div className="max-w-[200px] truncate text-xs font-semibold text-foreground">
                        {acc.displayName}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        act_{acc.externalAccountId} • {acc.currency}
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
                          title="Làm mới Chi tiêu TKQC từ Meta"
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
                          <Rocket className="h-3 w-3" /> Ads Manager
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
