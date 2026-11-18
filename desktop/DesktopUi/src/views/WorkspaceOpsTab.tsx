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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { sendDesktopCommand } from '@/lib/bridge'
import type { AppShellWebStateDto } from '@/types'

function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')} ₫`
}

export function WorkspaceOpsTab({ state }: { state: AppShellWebStateDto }) {
  const rs = state.retainersSummary

  return (
    <div className="space-y-4">
      {/* CLIENT RETAINERS */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Briefcase className="h-4 w-4 text-primary" />
              Hợp đồng Ngân sách Khách hàng (Client Retainers • Còn {rs.daysRemainingInMonth} ngày trong tháng)
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('export_retainers_csv')}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV Retainer
              </Button>
              <Button size="sm" onClick={() => sendDesktopCommand('open_retainer_dialog')}>
                <Plus className="h-3.5 w-3.5" /> Hợp đồng mới
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground">Tổng Hợp đồng</div>
              <div className="mt-1 font-mono text-xl font-bold">{rs.totalContracts}</div>
              <div className="text-[11px] text-muted-foreground">Đang kích hoạt trong kỳ</div>
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground">Cam kết Tháng</div>
              <div className="mt-1 font-mono text-xl font-bold">{formatVnd(rs.totalCommittedVnd)}</div>
              <div className="text-[11px] text-muted-foreground">Ngân sách cam kết cộng gộp</div>
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground">Chi tiêu MTD</div>
              <div className="mt-1 font-mono text-xl font-bold text-amber-300">{formatVnd(rs.totalMtdSpendVnd)}</div>
              <div className="text-[11px] text-muted-foreground">Dư nợ: {formatVnd(rs.totalUnpaidBalanceVnd)}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground">Quyết toán MTD</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-300">
                {formatVnd(rs.totalSettlementMtdVnd)}
              </div>
              <div className="text-[11px] text-muted-foreground">Gồm phí Agency + Thuế Meta</div>
            </div>
          </div>

          {state.retainers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
              <div className="text-sm font-semibold">Chưa có Hợp đồng Client Retainer nào</div>
              <p className="max-w-md text-xs text-muted-foreground">
                Tạo hợp đồng phí quản lý (%) &amp; thuế để tự động tính quyết toán theo chi tiêu TKQC thực tế.
              </p>
              <Button size="sm" onClick={() => sendDesktopCommand('open_retainer_dialog')}>
                <Plus className="h-3.5 w-3.5" /> Hợp đồng mới
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {state.retainers.map((c) => {
                const [badgeVar, statusVi] =
                  c.pacingStatus === 'OVER_BUDGET'
                    ? (['destructive', 'VƯỢT NGÂN SÁCH'] as const)
                    : c.pacingStatus === 'NEAR_CAP'
                    ? (['warning', 'SẮP CHẠM TRẦN'] as const)
                    : c.pacingStatus === 'ON_TRACK'
                    ? (['success', 'ĐÚNG TIẾN ĐỘ'] as const)
                    : c.pacingStatus === 'NO_MTD_SPEND'
                    ? (['info', 'CHƯA CHI TIÊU'] as const)
                    : (['info', c.pacingStatus] as const)

                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-1 items-center gap-3 rounded-lg border border-border bg-background/50 p-3 lg:grid-cols-[1.5fr_auto_1.4fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-foreground">
                        [{c.contractCode}] {c.clientName}
                        {c.projectName ? ` • ${c.projectName}` : ''}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {c.billingCycle} • {c.accountCount} TKQC • Phí {c.agencyFeePercent}% + Thuế {c.metaTaxPercent}%
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Badge variant={badgeVar} className="text-[10px]">
                        {statusVi} ({c.pacingPercent.toFixed(1)}%)
                      </Badge>
                      <Progress value={Math.min(100, Math.max(0, c.pacingPercent))} className="h-1.5 w-36" />
                    </div>

                    <div className="min-w-0 font-mono text-[11px]">
                      <div className="truncate text-foreground">
                        MTD: {formatVnd(c.spendMtdVnd)} / {formatVnd(c.committedBudgetVnd)}
                      </div>
                      <div className="truncate text-muted-foreground">
                        Quyết toán: {formatVnd(c.totalBillableMtdVnd)} • Gợi ý/ngày: {formatVnd(c.recommendedDailyVnd)}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => sendDesktopCommand('open_retainer_dialog', { retainerId: c.id })}
                      >
                        <Edit3 className="h-3 w-3" /> Sửa
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
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
        </CardContent>
      </Card>

      {/* TEAM & SEATS */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Users className="h-4 w-4 text-primary" />
              Nhân sự Team &amp; Chỗ ngồi (Seats)
            </CardTitle>
            {!state.teamLocked && (
              <Button size="sm" onClick={() => sendDesktopCommand('open_invite_member')}>
                <UserPlus className="h-3.5 w-3.5" /> Mời thành viên
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.teamLocked || !state.teamSummary ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" />
              Chỉ Chủ sở hữu Workspace (Owner) mới xem &amp; quản lý thành viên Team / Seats.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">
                  Ghế đang dùng:{' '}
                  {state.teamSummary.seatLimit != null
                    ? `${state.teamSummary.activeMembers} / ${state.teamSummary.seatLimit} ghế`
                    : `${state.teamSummary.activeMembers} thành viên (Không giới hạn)`}
                </Badge>
                <Badge variant="warning">Lời mời chờ: {state.teamSummary.pendingInvitations}</Badge>
                {state.teamSummary.planReference && (
                  <Badge variant="success">Gói: {state.teamSummary.planReference}</Badge>
                )}
              </div>

              <div className="space-y-2">
                {state.teamMembers.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">
                        {m.fullName ? `${m.fullName} (${m.email})` : m.email}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{m.scopeDetail}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="info" className="text-[10px]">
                        {m.role.toUpperCase()}
                      </Badge>
                      <Badge variant={m.isSuspended ? 'destructive' : 'success'} className="text-[10px]">
                        {m.status.toUpperCase()}
                      </Badge>
                      {m.canManage && (
                        <>
                          <Button
                            variant="secondary"
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
                  <div className="text-xs font-bold text-foreground">
                    Lời mời đã phát hành ({state.teamInvitations.length})
                  </div>
                  {state.teamInvitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground">
                          {inv.emailNormalized} ({inv.invitedRole})
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          Token: ***{inv.tokenLastFour} • Hết hạn: {inv.expiresAt}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="warning" className="text-[10px]">
                          {inv.status.toUpperCase()}
                        </Badge>
                        {inv.status.toLowerCase() === 'pending' && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => sendDesktopCommand('resend_invitation', { invitationId: inv.id })}
                            >
                              <RefreshCw className="h-3 w-3" /> Gửi lại
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
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
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
