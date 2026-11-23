import { useState } from 'react'
import {
  Briefcase,
  Edit3,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedTabs, StatusDot } from '@/components/ui/studio-primitives'
import { sendDesktopCommand } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto } from '@/types'

function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')} ₫`
}

export function WorkspaceOpsTab({ state }: { state: AppShellWebStateDto }) {
  const [activeTab, setActiveTab] = useState<'retainers' | 'standby_pool' | 'team'>('retainers')
  const rs = state.retainersSummary
  const standbyMatrix = state.standbyPoolMatrix ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { value: 'retainers', label: 'Hợp đồng & Ngân sách', count: state.retainers.length },
            { value: 'standby_pool', label: 'Kho phôi dự phòng', count: standbyMatrix.length },
            { value: 'team', label: 'Thành viên & Seats', count: state.teamMembers.length },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('export_retainers_csv')}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV Retainer
          </Button>
          <Button size="sm" className="h-8 text-xs font-semibold" onClick={() => sendDesktopCommand('open_retainer_dialog')}>
            <Plus className="h-3.5 w-3.5" /> Hợp đồng mới
          </Button>
        </div>
      </div>

      {/* SUB-TAB 1: CLIENT RETAINERS */}
      {activeTab === 'retainers' && (
        <div className="space-y-4">
          <section className="studio-panel grid grid-cols-1 divide-y divide-border/75 sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
            <div className="p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Tổng hợp đồng
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {rs.totalContracts}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Còn {rs.daysRemainingInMonth} ngày trong tháng
              </div>
            </div>

            <div className="p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Cam kết Tháng
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {formatVnd(rs.totalCommittedVnd)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">Ngân sách cam kết cộng gộp</div>
            </div>

            <div className="p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Chi tiêu MTD
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {formatVnd(rs.totalMtdSpendVnd)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                Dư nợ: {formatVnd(rs.totalUnpaidBalanceVnd)}
              </div>
            </div>

            <div className="p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Quyết toán MTD
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatVnd(rs.totalSettlementMtdVnd)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">Gồm phí Agency + Thuế Meta</div>
            </div>
          </section>

          <section className="studio-panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3.5">
              <Briefcase className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Danh sách Hợp đồng Khách hàng (Client Retainers)
              </h2>
            </div>

            {state.retainers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
                <div className="text-sm font-semibold">Chưa có Hợp đồng Client Retainer nào</div>
                <p className="max-w-md text-xs text-muted-foreground">
                  Tạo hợp đồng phí quản lý (%) &amp; thuế để tự động tính quyết toán theo chi tiêu thực tế.
                </p>
                <Button size="sm" onClick={() => sendDesktopCommand('open_retainer_dialog')}>
                  <Plus className="h-3.5 w-3.5" /> Tạo hợp đồng mới
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {state.retainers.map((c) => {
                  const [tone, statusVi] =
                    c.pacingStatus === 'OVER_BUDGET'
                      ? (['critical', 'Vượt ngân sách'] as const)
                      : c.pacingStatus === 'NEAR_CAP'
                      ? (['warning', 'Sắp chạm trần'] as const)
                      : c.pacingStatus === 'ON_TRACK'
                      ? (['live', 'Đúng tiến độ'] as const)
                      : c.pacingStatus === 'NO_MTD_SPEND'
                      ? (['info', 'Chưa chi tiêu'] as const)
                      : (['info', c.pacingStatus] as const)

                  const pct = Math.min(100, Math.max(0, c.pacingPercent))

                  return (
                    <div
                      key={c.id}
                      className="grid grid-cols-1 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/30 lg:grid-cols-[1.5fr_160px_1.4fr_auto]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">
                          <span className="font-mono text-muted-foreground">[{c.contractCode}]</span> {c.clientName}
                          {c.projectName ? ` · ${c.projectName}` : ''}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {c.billingCycle} · {c.accountCount} TKQC · Phí {c.agencyFeePercent}% + Thuế {c.metaTaxPercent}%
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <StatusDot
                          tone={tone}
                          label={`${statusVi} (${c.pacingPercent.toFixed(1)}%)`}
                          labelClassName="font-mono text-[11px]"
                        />
                        <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              tone === 'critical'
                                ? 'bg-rose-500'
                                : tone === 'warning'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500',
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      <div className="min-w-0 font-mono text-[11px] tabular-nums">
                        <div className="truncate text-foreground">
                          MTD: {formatVnd(c.spendMtdVnd)} / {formatVnd(c.committedBudgetVnd)}
                        </div>
                        <div className="truncate text-muted-foreground">
                          Quyết toán: {formatVnd(c.totalBillableMtdVnd)} · Gợi ý/ngày: {formatVnd(c.recommendedDailyVnd)}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => sendDesktopCommand('open_retainer_dialog', { retainerId: c.id })}
                        >
                          <Edit3 className="h-3 w-3" /> Sửa
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2.5 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                          onClick={() => sendDesktopCommand('delete_retainer', { retainerId: c.id })}
                        >
                          <Trash2 className="h-3 w-3" /> Xóa
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-TAB 2: AGENCY STANDBY POOL */}
      {activeTab === 'standby_pool' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="h-4 w-4 text-emerald-500" />
              Ma trận Kho Dự phòng theo Nhóm Khách hàng (Standby Pool)
            </h2>
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => sendDesktopCommand('add_via')}>
              <Plus className="h-3.5 w-3.5" /> Thêm Phôi Dự phòng
            </Button>
          </div>
          {standbyMatrix.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Chưa có Via trong hệ thống để thống kê kho dự phòng.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {standbyMatrix.map((row) => (
                <div key={row.clientGroup} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{row.clientGroup}</div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      Via Chính: {row.activePrimaryCount} · Standby sẵn sàng: {row.standbyReadyCount} · Đang ấp:{' '}
                      {row.incubatingCount} · Thiếu Két Mail: {row.missingRecoveryMailCount}
                    </div>
                  </div>
                  <StatusDot
                    tone={row.hasStandbyDeficit ? 'warning' : 'live'}
                    label={row.hasStandbyDeficit ? 'Thiếu dự phòng (<2)' : 'Đủ dự phòng'}
                    labelClassName="text-xs"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3: TEAM & SEATS */}
      {activeTab === 'team' && (
        <section className="studio-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-primary" />
              Nhân sự Team &amp; Chỗ ngồi (Seats)
            </h2>
            {!state.teamLocked && (
              <Button size="sm" className="h-8 text-xs font-semibold" onClick={() => sendDesktopCommand('open_invite_member')}>
                <UserPlus className="h-3.5 w-3.5" /> Mời thành viên
              </Button>
            )}
          </div>

          <div className="p-5 space-y-4">
            {state.teamLocked || !state.teamSummary ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/75 bg-muted/25 p-3.5 text-xs text-muted-foreground">
                <Lock className="h-4 w-4 shrink-0" />
                Chỉ Chủ sở hữu Workspace (Owner) mới xem &amp; quản lý thành viên Team / Seats.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <StatusDot
                    tone="info"
                    label={
                      state.teamSummary.seatLimit != null
                        ? `Ghế đang dùng: ${state.teamSummary.activeMembers}/${state.teamSummary.seatLimit}`
                        : `Thành viên: ${state.teamSummary.activeMembers}`
                    }
                    labelClassName="font-mono"
                  />
                  <StatusDot
                    tone="warning"
                    label={`Lời mời chờ: ${state.teamSummary.pendingInvitations}`}
                    labelClassName="font-mono"
                  />
                  {state.teamSummary.planReference && (
                    <StatusDot tone="live" label={`Gói: ${state.teamSummary.planReference}`} labelClassName="font-mono" />
                  )}
                </div>

                <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                  {state.teamMembers.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {m.fullName ? `${m.fullName} (${m.email})` : m.email}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{m.scopeDetail}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase text-foreground">
                          {m.role}
                        </span>
                        <StatusDot
                          tone={m.isSuspended ? 'critical' : 'live'}
                          label={m.status.toUpperCase()}
                          labelClassName="font-mono text-[10.5px]"
                        />
                        {m.canManage && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() =>
                                sendDesktopCommand('change_member_role', { memberId: m.id, nextRole: m.nextRole })
                              }
                            >
                              Đổi → {m.nextRole}
                            </Button>
                            <Button
                              variant={m.isSuspended ? 'secondary' : 'destructive'}
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => sendDesktopCommand('toggle_member_suspend', { memberId: m.id })}
                            >
                              {m.isSuspended ? 'Mở khóa' : 'Tạm khóa'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {state.teamInvitations.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold text-foreground">
                      Lời mời đã phát hành ({state.teamInvitations.length})
                    </div>
                    <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                      {state.teamInvitations.map((inv) => (
                        <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-foreground">
                              {inv.emailNormalized} ({inv.invitedRole})
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              Token: ***{inv.tokenLastFour} · Hết hạn: {inv.expiresAt}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusDot tone="warning" label={inv.status.toUpperCase()} labelClassName="font-mono text-[10.5px]" />
                            {inv.status.toLowerCase() === 'pending' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => sendDesktopCommand('resend_invitation', { invitationId: inv.id })}
                                >
                                  <RefreshCw className="h-3 w-3" /> Gửi lại
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                                  onClick={() => sendDesktopCommand('revoke_invitation', { invitationId: inv.id })}
                                >
                                  <ShieldAlert className="h-3 w-3" /> Thu hồi
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
