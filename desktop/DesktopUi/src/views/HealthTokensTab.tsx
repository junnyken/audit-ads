import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  FileSpreadsheet,
  KeyRound,
  Play,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sendDesktopCommand } from '@/lib/bridge'
import type { AppShellWebStateDto } from '@/types'

function resolveHealthVariant(status: string): 'destructive' | 'warning' | 'success' | 'secondary' {
  const s = (status || '').trim().toLowerCase()
  if (s === 'critical' || s === 'blocked' || s === 'fail' || s === 'failed' || s === 'not_ready') return 'destructive'
  if (s === 'warning' || s === 'attention' || s === 'attention_needed' || s === 'ready_with_warnings') return 'warning'
  if (s === 'healthy' || s === 'clear' || s === 'ready' || s === 'operationally_ready' || s === 'ok') return 'success'
  return 'secondary'
}

export function HealthTokensTab({ state }: { state: AppShellWebStateDto }) {
  const [healthSearch, setHealthSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState('all')
  const [auditSearch, setAuditSearch] = useState('')
  const hk = state.healthKpi

  const filteredHealth = useMemo(() => {
    const q = healthSearch.trim().toLowerCase()
    return state.accountHealthRows.filter((r) => {
      const hs = r.healthStatus.toLowerCase()
      const okTab =
        healthFilter === 'critical'
          ? hs === 'critical' || r.openCriticalCount > 0
          : healthFilter === 'warning'
          ? hs === 'warning' || hs === 'attention_needed' || r.openWarningCount > 0 || r.openAttentionCount > 0
          : healthFilter === 'healthy'
          ? hs === 'healthy' || hs === 'clear'
          : true
      if (!okTab) return false
      if (!q) return true
      return (
        r.displayName.toLowerCase().includes(q) ||
        r.externalAccountId.toLowerCase().includes(q) ||
        r.businessManagerName.toLowerCase().includes(q) ||
        r.viaLabel.toLowerCase().includes(q) ||
        r.topReasonText.toLowerCase().includes(q)
      )
    })
  }, [state.accountHealthRows, healthSearch, healthFilter])

  const filteredAudits = useMemo(() => {
    const q = auditSearch.trim().toLowerCase()
    return state.auditLogs
      .filter(
        (a) =>
          !q ||
          a.action.toLowerCase().includes(q) ||
          a.entityType.toLowerCase().includes(q) ||
          a.entityId.toLowerCase().includes(q) ||
          a.actorEmail.toLowerCase().includes(q),
      )
      .slice(0, 40)
  }, [state.auditLogs, auditSearch])

  return (
    <div className="space-y-4">
      {/* 4 KPI Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Nguy kịch (Critical)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-bold text-foreground">{hk.critical}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {hk.warning} Warning • {hk.attentionNeeded} cần chú ý
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">TKQC Sạch Tín hiệu</CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-bold text-foreground">{hk.clearSignals}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Tổng {hk.totalActive} TKQC đang theo dõi</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Meta Token Kết Nối</CardTitle>
            <KeyRound className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-bold text-foreground">{hk.tokenConfiguredCount}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {hk.metaConnectionCount} kết nối ({hk.staleData} dữ liệu cũ)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Pre-flight Drafts</CardTitle>
            <Stethoscope className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-bold text-foreground">{hk.draftCount}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{hk.draftBlockingCount} nháp bị chặn</p>
          </CardContent>
        </Card>
      </div>

      {/* Organized Sub-Tabs */}
      <Tabs defaultValue="health" className="space-y-3">
        <TabsList className="flex-wrap">
          <TabsTrigger value="health">Sức khỏe TKQC ({state.accountHealthRows.length})</TabsTrigger>
          <TabsTrigger value="tokens">Meta Token ({state.metaConnections.length})</TabsTrigger>
          <TabsTrigger value="readiness">Readiness Board ({state.readinessRows.length})</TabsTrigger>
          <TabsTrigger value="drafts">Pre-flight Drafts ({state.campaignDrafts.length})</TabsTrigger>
          <TabsTrigger value="audit">Live Audit Log ({state.auditLogs.length})</TabsTrigger>
        </TabsList>

        {/* TAB A: Account Health */}
        <TabsContent value="health" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={healthSearch}
                    onChange={(e) => setHealthSearch(e.target.value)}
                    placeholder="Tìm tên TKQC, act_ID, BM, Via hoặc lý do cảnh báo..."
                    className="pl-8"
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_health_csv')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV Sức khỏe
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-2">
                {[
                  { key: 'all', label: `Tất cả (${state.accountHealthRows.length})` },
                  {
                    key: 'critical',
                    label: `Critical (${
                      state.accountHealthRows.filter(
                        (x) => x.healthStatus.toLowerCase() === 'critical' || x.openCriticalCount > 0,
                      ).length
                    })`,
                  },
                  {
                    key: 'warning',
                    label: `Warning/Attn (${
                      state.accountHealthRows.filter(
                        (x) =>
                          x.healthStatus.toLowerCase() === 'warning' ||
                          x.healthStatus.toLowerCase() === 'attention_needed' ||
                          x.openWarningCount > 0 ||
                          x.openAttentionCount > 0,
                      ).length
                    })`,
                  },
                  {
                    key: 'healthy',
                    label: `Sạch (${
                      state.accountHealthRows.filter((x) => ['healthy', 'clear'].includes(x.healthStatus.toLowerCase()))
                        .length
                    })`,
                  },
                ].map((c) => (
                  <Button
                    key={c.key}
                    size="sm"
                    variant={healthFilter === c.key ? 'default' : 'secondary'}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setHealthFilter(c.key)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredHealth.length === 0 ? (
                <p className="text-xs text-muted-foreground">Không có báo cáo sức khỏe TKQC khớp bộ lọc.</p>
              ) : (
                filteredHealth.map((r) => (
                  <div
                    key={r.adAccountId}
                    className="grid grid-cols-1 items-center gap-2.5 rounded-lg border border-border bg-background/50 p-3 lg:grid-cols-[1.5fr_auto_auto_1.5fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">{r.displayName}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        act_{r.externalAccountId} • BM: {r.businessManagerName} • Via: {r.viaLabel}
                      </div>
                    </div>
                    <Badge variant={resolveHealthVariant(r.healthStatus)} className="w-fit text-[10px]">
                      {r.healthStatus}
                    </Badge>
                    <Badge variant={resolveHealthVariant(r.readinessStatus)} className="w-fit text-[10px]">
                      {r.readinessStatus}
                    </Badge>
                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">{r.topReasonText}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        Crit: {r.openCriticalCount} • Warn: {r.openWarningCount} • Attn: {r.openAttentionCount}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => sendDesktopCommand('open_health_signals', { adAccountId: r.adAccountId })}
                      >
                        <Bell className="h-3 w-3" /> Tín hiệu
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => sendDesktopCommand('recalc_account_health', { adAccountId: r.adAccountId })}
                      >
                        <RefreshCw className="h-3 w-3" /> Tính lại
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          sendDesktopCommand('open_ads_manager', {
                            externalAccountId: r.externalAccountId,
                            viaHint: r.viaLabel,
                          })
                        }
                      >
                        <Rocket className="h-3 w-3" /> Ads Manager
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB B: Meta Connections */}
        <TabsContent value="tokens" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-bold">Kết nối Meta Graph API &amp; Token Hệ thống</CardTitle>
                  <CardDescription>
                    Kiểm tra khả năng đọc của Meta Token và kích hoạt Quick Sync lấy số liệu TKQC/BM mới nhất.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('open_auto_connect_token')}>
                    <KeyRound className="h-3.5 w-3.5" /> Gắn Token EAAB
                  </Button>
                  <Button size="sm" onClick={() => sendDesktopCommand('quick_sync_meta')}>
                    <RefreshCw className="h-3.5 w-3.5" /> Quick Sync Meta
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.metaConnections.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Chưa có Meta Connection hoặc tài khoản hiện tại chưa có quyền xem cấu hình Token (Owner).
                </p>
              ) : (
                state.metaConnections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/50 p-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-bold text-foreground">{conn.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Môi trường: {conn.environment} • Nguồn: {conn.readerSource} • BM: {conn.bmReference}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Badge variant={conn.tokenConfigured ? 'success' : 'warning'} className="text-[10px]">
                        {conn.badgeLabel}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{conn.lastCheckedLocal}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => sendDesktopCommand('check_meta_token', { connectionId: conn.id })}
                      >
                        <Activity className="h-3 w-3" /> Kiểm tra Token
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB C: Readiness Board */}
        <TabsContent value="readiness" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-bold">Readiness Board (Mức độ sẵn sàng lên Camp)</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="success">Sẵn sàng: {state.readinessSummary.operationallyReady}</Badge>
                  <Badge variant="warning">Cảnh báo: {state.readinessSummary.readyWithWarnings}</Badge>
                  <Badge variant="destructive">Chưa đạt: {state.readinessSummary.notReady}</Badge>
                  <Badge variant="secondary">Chưa rõ: {state.readinessSummary.unknown}</Badge>
                </div>
              </div>
              {state.readinessGroups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {state.readinessGroups.map((g, i) => (
                    <Badge key={i} variant={g.severity === 'critical' ? 'destructive' : 'warning'} className="text-[11px]">
                      {g.message} ({g.accountCount} TKQC)
                    </Badge>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {state.readinessRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Chưa có dữ liệu Readiness Board.</p>
              ) : (
                state.readinessRows.map((r) => (
                  <div
                    key={r.adAccountId}
                    className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border bg-background/50 p-2.5 lg:grid-cols-[1.3fr_auto_80px_1.6fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">{r.displayName}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        act_{r.externalAccountId} • {r.status}
                      </div>
                    </div>
                    <Badge variant={resolveHealthVariant(r.readinessStatus)} className="w-fit text-[10px]">
                      {r.readinessStatus}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.completedItemCount}/{r.requiredItemCount} mục
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{r.reasonText}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() =>
                        sendDesktopCommand('recalc_account_readiness', {
                          adAccountId: r.adAccountId,
                          externalAccountId: r.externalAccountId,
                        })
                      }
                    >
                      <RefreshCw className="h-3 w-3" /> Tính lại
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB D: Pre-flight Campaign Drafts */}
        <TabsContent value="drafts" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold">Kiểm tra Pre-flight Chiến dịch Nháp</CardTitle>
              <CardDescription>
                Đánh giá nhanh rủi ro chặn/cảnh báo trước khi lên Camp trên Ads Manager.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.campaignDrafts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Chưa có chiến dịch nháp (Campaign Draft) nào được tạo trong Workspace.
                </p>
              ) : (
                state.campaignDrafts.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground">{d.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        TKQC: {d.accountName} • Mục tiêu: {d.objective}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Badge
                        variant={
                          d.openBlockingCount > 0 ? 'destructive' : d.openWarningCount > 0 ? 'warning' : 'success'
                        }
                        className="text-[10px]"
                      >
                        {d.draftStatus}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        Chặn: {d.openBlockingCount} • Cảnh báo: {d.openWarningCount}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => sendDesktopCommand('evaluate_campaign_draft', { draftId: d.id })}
                      >
                        <Play className="h-3 w-3" /> Chấm điểm lại
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB E: Live Audit Logs */}
        <TabsContent value="audit" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Lọc theo action, entity hoặc email người thực hiện..."
                    className="pl-8"
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_audit_csv')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV Audit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {filteredAudits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {state.auditLogs.length === 0
                    ? 'Không có nhật ký Audit (hoặc tài khoản hiện tại chưa được cấp quyền Owner/Admin).'
                    : 'Không có dòng nhật ký nào khớp từ khóa.'}
                </p>
              ) : (
                filteredAudits.map((a) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-border/70 bg-background/45 px-3 py-2 text-xs lg:grid-cols-[150px_1.2fr_1fr_1.2fr]"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{a.createdAtLocal}</span>
                    <span className="truncate font-mono font-semibold text-primary">{a.action}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {a.entityType}: {a.entityId}
                    </span>
                    <span className="truncate text-right text-[11px] text-muted-foreground">{a.actorEmail}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
