import { useMemo, useState } from 'react'
import {
  Activity,
  Bell,
  Eye,
  FileSpreadsheet,
  KeyRound,
  Play,
  RefreshCw,
  Rocket,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InspectorDrawer, InspectorSection } from '@/components/ui/inspector-drawer'
import { SegmentedTabs, StatusDot, type StudioTone } from '@/components/ui/studio-primitives'
import { sendDesktopCommand } from '@/lib/bridge'
import type { AppShellWebStateDto, WebAccountHealthRowDto } from '@/types'

function resolveHealthTone(status: string): StudioTone {
  const s = (status || '').trim().toLowerCase()
  if (s === 'critical' || s === 'blocked' || s === 'fail' || s === 'failed' || s === 'not_ready') return 'critical'
  if (s === 'warning' || s === 'attention' || s === 'attention_needed' || s === 'ready_with_warnings') return 'warning'
  if (s === 'healthy' || s === 'clear' || s === 'ready' || s === 'operationally_ready' || s === 'ok') return 'live'
  return 'muted'
}

function resolveHealthVariant(status: string): 'destructive' | 'warning' | 'success' | 'secondary' {
  const t = resolveHealthTone(status)
  if (t === 'critical') return 'destructive'
  if (t === 'warning') return 'warning'
  if (t === 'live') return 'success'
  return 'secondary'
}

export function HealthTokensTab({ state }: { state: AppShellWebStateDto }) {
  const [activeTab, setActiveTab] = useState<'health' | 'tokens' | 'readiness' | 'drafts' | 'audit'>('health')
  const [healthSearch, setHealthSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState('all')
  const [auditSearch, setAuditSearch] = useState('')
  const [inspectedRow, setInspectedRow] = useState<WebAccountHealthRowDto | null>(null)
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
    <div className="space-y-5">
      {/* Unified 4-Metric Telemetry Strip */}
      <section className="studio-panel grid grid-cols-1 divide-y divide-border/75 sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Nguy kịch (Critical)
            </span>
            <StatusDot tone={hk.critical > 0 ? 'critical' : 'live'} />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{hk.critical}</div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {hk.warning} Warning · {hk.attentionNeeded} cần chú ý
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              TKQC Sạch Tín hiệu
            </span>
            <StatusDot tone="live" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{hk.clearSignals}</div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            Tổng {hk.totalActive} TKQC đang theo dõi
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Meta Token Kết nối
            </span>
            <StatusDot tone={hk.tokenConfiguredCount > 0 ? 'info' : 'warning'} />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {hk.tokenConfiguredCount}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {hk.metaConnectionCount} kết nối · {hk.staleData} dữ liệu cũ
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Pre-flight Drafts
            </span>
            <StatusDot tone={hk.draftBlockingCount > 0 ? 'warning' : 'muted'} />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{hk.draftCount}</div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {hk.draftBlockingCount} nháp bị chặn
          </div>
        </div>
      </section>

      {/* Horizontal Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { value: 'health', label: 'Sức khỏe TKQC', count: state.accountHealthRows.length },
            { value: 'tokens', label: 'Meta Token', count: state.metaConnections.length },
            { value: 'readiness', label: 'Readiness', count: state.readinessRows.length },
            { value: 'drafts', label: 'Pre-flight Drafts', count: state.campaignDrafts.length },
            { value: 'audit', label: 'Nhật ký Audit', count: state.auditLogs.length },
          ]}
        />
      </div>

      {/* TAB A: Account Health */}
      {activeTab === 'health' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SegmentedTabs
              value={healthFilter}
              onChange={setHealthFilter}
              items={[
                { value: 'all', label: 'Tất cả', count: state.accountHealthRows.length },
                {
                  value: 'critical',
                  label: 'Critical',
                  count: state.accountHealthRows.filter(
                    (x) => x.healthStatus.toLowerCase() === 'critical' || x.openCriticalCount > 0,
                  ).length,
                },
                {
                  value: 'warning',
                  label: 'Warning',
                  count: state.accountHealthRows.filter(
                    (x) =>
                      x.healthStatus.toLowerCase() === 'warning' ||
                      x.healthStatus.toLowerCase() === 'attention_needed' ||
                      x.openWarningCount > 0 ||
                      x.openAttentionCount > 0,
                  ).length,
                },
                {
                  value: 'healthy',
                  label: 'Sạch',
                  count: state.accountHealthRows.filter((x) => ['healthy', 'clear'].includes(x.healthStatus.toLowerCase()))
                    .length,
                },
              ]}
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56 sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={healthSearch}
                  onChange={(e) => setHealthSearch(e.target.value)}
                  placeholder="Tìm TKQC, act_ID, BM, lý do..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('export_health_csv')}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
              </Button>
            </div>
          </div>

          <div className="studio-panel overflow-hidden">
            {filteredHealth.length === 0 ? (
              <p className="p-8 text-center text-xs text-muted-foreground">
                Không có báo cáo sức khỏe TKQC khớp bộ lọc.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {filteredHealth.map((r) => (
                  <div
                    key={r.adAccountId}
                    className="group grid grid-cols-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30 lg:grid-cols-[1.45fr_115px_130px_1.4fr_auto]"
                  >
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setInspectedRow(r)}
                        className="truncate text-left text-xs font-semibold text-foreground hover:text-primary"
                      >
                        {r.displayName}
                      </button>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        act_{r.externalAccountId} · BM: {r.businessManagerName} · Via: {r.viaLabel}
                      </div>
                    </div>

                    <StatusDot
                      tone={resolveHealthTone(r.healthStatus)}
                      label={r.healthStatus}
                      labelClassName="font-mono text-[11px]"
                    />
                    <StatusDot
                      tone={resolveHealthTone(r.readinessStatus)}
                      label={r.readinessStatus}
                      labelClassName="font-mono text-[11px]"
                    />

                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">{r.topReasonText}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                        Crit {r.openCriticalCount} · Warn {r.openWarningCount} · Attn {r.openAttentionCount}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                        title="Xem chi tiết"
                        onClick={() => setInspectedRow(r)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => sendDesktopCommand('open_health_signals', { adAccountId: r.adAccountId })}
                      >
                        <Bell className="h-3 w-3" /> Tín hiệu
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => sendDesktopCommand('recalc_account_health', { adAccountId: r.adAccountId })}
                      >
                        <RefreshCw className="h-3 w-3" /> Tính lại
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-border/80 bg-transparent px-2.5 text-xs hover:border-primary hover:bg-primary hover:text-primary-foreground transition-colors"
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB B: Meta Connections */}
      {activeTab === 'tokens' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Kết nối Meta Graph API &amp; Token Hệ thống</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Kiểm tra khả năng đọc của Meta Token và kích hoạt Quick Sync lấy số liệu mới nhất.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('open_auto_connect_token')}>
                <KeyRound className="h-3.5 w-3.5" /> Gắn Token EAAB
              </Button>
              <Button size="sm" className="h-8 text-xs font-semibold" onClick={() => sendDesktopCommand('quick_sync_meta')}>
                <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ nhanh Meta
              </Button>
            </div>
          </div>

          {state.metaConnections.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Chưa có Meta Connection hoặc tài khoản hiện tại chưa có quyền xem cấu hình Token.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {state.metaConnections.map((conn) => (
                <div key={conn.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/30">
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-xs font-semibold text-foreground">{conn.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Môi trường: {conn.environment} · Nguồn: {conn.readerSource} · BM: {conn.bmReference}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusDot
                      tone={conn.tokenConfigured ? 'live' : 'warning'}
                      label={conn.badgeLabel}
                      labelClassName="text-[11px]"
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{conn.lastCheckedLocal}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => sendDesktopCommand('check_meta_token', { connectionId: conn.id })}
                    >
                      <Activity className="h-3 w-3" /> Kiểm tra Token
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB C: Readiness Board */}
      {activeTab === 'readiness' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">Readiness Board (Mức độ sẵn sàng)</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <StatusDot tone="live" label={`Sẵn sàng: ${state.readinessSummary.operationallyReady}`} labelClassName="font-mono" />
              <StatusDot tone="warning" label={`Cảnh báo: ${state.readinessSummary.readyWithWarnings}`} labelClassName="font-mono" />
              <StatusDot tone="critical" label={`Chưa đạt: ${state.readinessSummary.notReady}`} labelClassName="font-mono" />
              <StatusDot tone="muted" label={`Chưa rõ: ${state.readinessSummary.unknown}`} labelClassName="font-mono" />
            </div>
          </div>

          {state.readinessGroups.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-border/65 bg-muted/20 px-5 py-2.5">
              {state.readinessGroups.map((g, i) => (
                <StatusDot
                  key={i}
                  tone={g.severity === 'critical' ? 'critical' : 'warning'}
                  label={`${g.message} (${g.accountCount})`}
                  labelClassName="text-[11px]"
                />
              ))}
            </div>
          )}

          {state.readinessRows.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">Chưa có dữ liệu Readiness Board.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {state.readinessRows.map((r) => (
                <div
                  key={r.adAccountId}
                  className="grid grid-cols-1 items-center gap-2.5 px-5 py-3 transition-colors hover:bg-muted/30 lg:grid-cols-[1.3fr_140px_80px_1.5fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{r.displayName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      act_{r.externalAccountId} · {r.status}
                    </div>
                  </div>
                  <StatusDot
                    tone={resolveHealthTone(r.readinessStatus)}
                    label={r.readinessStatus}
                    labelClassName="font-mono text-[11px]"
                  />
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {r.completedItemCount}/{r.requiredItemCount} mục
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{r.reasonText}</span>
                  <Button
                    variant="ghost"
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
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB D: Pre-flight Campaign Drafts */}
      {activeTab === 'drafts' && (
        <section className="studio-panel overflow-hidden">
          <div className="border-b border-border/70 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">Kiểm tra Pre-flight Chiến dịch Nháp</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Đánh giá rủi ro chặn hoặc cảnh báo trước khi chạy chiến dịch thực tế.
            </p>
          </div>
          {state.campaignDrafts.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Chưa có chiến dịch nháp (Campaign Draft) nào được tạo trong Workspace.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {state.campaignDrafts.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/30">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">{d.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      TKQC: {d.accountName} · Mục tiêu: {d.objective}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusDot
                      tone={d.openBlockingCount > 0 ? 'critical' : d.openWarningCount > 0 ? 'warning' : 'live'}
                      label={d.draftStatus}
                      labelClassName="font-mono text-[11px]"
                    />
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      Chặn: {d.openBlockingCount} · Cảnh báo: {d.openWarningCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => sendDesktopCommand('evaluate_campaign_draft', { draftId: d.id })}
                    >
                      <Play className="h-3 w-3" /> Chấm điểm lại
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB E: Live Audit Logs */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Lọc theo action, entity hoặc email người thực hiện..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('export_audit_csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV Audit
            </Button>
          </div>

          <section className="studio-panel overflow-hidden">
            {filteredAudits.length === 0 ? (
              <p className="p-8 text-center text-xs text-muted-foreground">
                {state.auditLogs.length === 0
                  ? 'Không có nhật ký Audit (hoặc tài khoản hiện tại chưa được cấp quyền Owner).'
                  : 'Không có dòng nhật ký nào khớp từ khóa.'}
              </p>
            ) : (
              <div className="divide-y divide-border/55">
                {filteredAudits.map((a) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-1 items-center gap-2 px-4 py-2.5 text-xs transition-colors hover:bg-muted/30 lg:grid-cols-[150px_1.2fr_1fr_1.2fr]"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{a.createdAtLocal}</span>
                    <span className="truncate font-mono font-medium text-primary">{a.action}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {a.entityType}: {a.entityId}
                    </span>
                    <span className="truncate text-right text-[11px] text-muted-foreground">{a.actorEmail}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Health Row Slide-Over Inspector */}
      <InspectorDrawer
        open={Boolean(inspectedRow)}
        onOpenChange={(o) => !o && setInspectedRow(null)}
        title={inspectedRow?.displayName || ''}
        subtitle={inspectedRow ? `act_${inspectedRow.externalAccountId} · ${inspectedRow.businessManagerName}` : ''}
        badge={
          inspectedRow && (
            <Badge variant={resolveHealthVariant(inspectedRow.healthStatus)}>
              {inspectedRow.healthStatus}
            </Badge>
          )
        }
        footer={
          inspectedRow && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('open_health_signals', { adAccountId: inspectedRow.adAccountId })}
              >
                <Bell className="h-3.5 w-3.5" /> Tín hiệu
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('recalc_account_health', { adAccountId: inspectedRow.adAccountId })}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Tính lại
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  sendDesktopCommand('open_ads_manager', {
                    externalAccountId: inspectedRow.externalAccountId,
                    viaHint: inspectedRow.viaLabel,
                  })
                }
              >
                <Rocket className="h-3.5 w-3.5" /> Ads Manager
              </Button>
            </div>
          )
        }
      >
        {inspectedRow && (
          <div className="space-y-3 text-xs">
            <InspectorSection title="Phân tích Sức khỏe">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Trạng thái Health:</dt>
                  <dd className="font-medium">{inspectedRow.healthStatus}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Mức sẵn sàng:</dt>
                  <dd className="font-medium">{inspectedRow.readinessStatus}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Via liên kết:</dt>
                  <dd className="font-medium">{inspectedRow.viaLabel || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Lỗi mở:</dt>
                  <dd className="font-mono">
                    Crit {inspectedRow.openCriticalCount} · Warn {inspectedRow.openWarningCount} · Attn{' '}
                    {inspectedRow.openAttentionCount}
                  </dd>
                </div>
              </dl>
            </InspectorSection>
            <InspectorSection title="Lý do chính">
              <p className="leading-relaxed text-foreground">
                {inspectedRow.topReasonText || 'Không có ghi chú bất thường.'}
              </p>
            </InspectorSection>
          </div>
        )}
      </InspectorDrawer>
    </div>
  )
}
