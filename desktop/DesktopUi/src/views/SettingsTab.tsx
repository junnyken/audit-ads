import { useEffect, useState } from 'react'
import {
  Activity,
  Bell,
  Bot,
  Cloud,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  HardDriveUpload,
  KeyRound,
  LogOut,
  MonitorCog,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusDot } from '@/components/ui/studio-primitives'
import { Switch } from '@/components/ui/switch'
import { sendDesktopCommand } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto } from '@/types'

type SettingsCategory = 'cloud' | 'vault' | 'browser' | 'proxy' | 'telegram'

const CATEGORIES: Array<{ key: SettingsCategory; label: string; icon: typeof Cloud; desc: string }> = [
  { key: 'cloud', label: 'Cloud & Bản quyền', icon: Cloud, desc: 'Tài khoản, hạn mức & thiết bị' },
  { key: 'vault', label: 'Két khóa & Sao lưu', icon: KeyRound, desc: 'DPAPI & Portable Vault' },
  { key: 'browser', label: 'Trình duyệt & Cập nhật', icon: MonitorCog, desc: 'URI, 5-Engine & Chữ ký số' },
  { key: 'proxy', label: 'Proxy & Chống Liên đới', icon: ShieldCheck, desc: 'Hạn mức cụm Proxy' },
  { key: 'telegram', label: 'Telegram & Cảnh báo', icon: Bot, desc: 'Bot nhận tin thời gian thực' },
]

export function SettingsTab({ state }: { state: AppShellWebStateDto }) {
  const s = state.settings
  const [category, setCategory] = useState<SettingsCategory>('cloud')

  const [backendUrl, setBackendUrl] = useState(s.backendBaseUrl)
  const [email, setEmail] = useState(s.userEmail)
  const [password, setPassword] = useState('')
  const [replaceOldestDevice, setReplaceOldestDevice] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [portablePassphrase, setPortablePassphrase] = useState('')
  const [customBackupFolder, setCustomBackupFolder] = useState(s.customAutoBackupFolder || '')

  const [isolatedProfiles, setIsolatedProfiles] = useState(s.useIsolatedProfiles)

  const [engine, setEngine] = useState(s.defaultBrowserEngine || 'chrome_native')
  const [antidetectApiUrl, setAntidetectApiUrl] = useState(s.antidetectApiBaseUrl)
  const [antidetectApiKey, setAntidetectApiKey] = useState('')
  const [maxConcurrent, setMaxConcurrent] = useState(String(s.maxConcurrentBrowsers))
  const [antidetectShield, setAntidetectShield] = useState(s.enableChromeAntidetectShield)
  const [lowRamFarm, setLowRamFarm] = useState(s.lowRamFarmMode)
  const [autoScaleRam, setAutoScaleRam] = useState(s.autoScaleConcurrentByRam)
  const [autoFailover, setAutoFailover] = useState(s.autoFailoverToChromeNative)

  const [maxViasProxy, setMaxViasProxy] = useState(String(s.maxViasPerProxyInBatch))
  const [maxPagesProxy, setMaxPagesProxy] = useState(String(s.maxPagesPerProxyInBatch))
  const [staggerSec, setStaggerSec] = useState(String(s.sameProxyMinStaggerSeconds))
  const [autoKeepAlive, setAutoKeepAlive] = useState(s.autoKeepAliveScheduler)
  const [preCheckProxy, setPreCheckProxy] = useState(s.preCheckProxyBeforeLaunch)

  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [selectedChatId, setSelectedChatId] = useState('__none__')
  const [telegramEnabled, setTelegramEnabled] = useState(s.telegramEnabled)
  const [notifyDisabled, setNotifyDisabled] = useState(s.notifyAdAccountDisabled)
  const [notifyBilling, setNotifyBilling] = useState(s.notifyBillingFailed)
  const [notifyPage, setNotifyPage] = useState(s.notifyPageRestricted)
  const [notifyRetainer, setNotifyRetainer] = useState(s.notifyRetainerOverspend)
  const [notifyThreshold80, setNotifyThreshold80] = useState(s.notifyThreshold80 ?? true)
  const [notifySpendSpike, setNotifySpendSpike] = useState(s.notifySpendSpike ?? true)
  const [quietHours, setQuietHours] = useState(s.quietHoursRespect)

  useEffect(() => {
    setBackendUrl(s.backendBaseUrl)
    setEmail(s.userEmail)
    setCustomBackupFolder(s.customAutoBackupFolder || '')
    setIsolatedProfiles(s.useIsolatedProfiles)
    setEngine(s.defaultBrowserEngine || 'chrome_native')
    setAntidetectApiUrl(s.antidetectApiBaseUrl)
    setMaxConcurrent(String(s.maxConcurrentBrowsers))
    setAntidetectShield(s.enableChromeAntidetectShield)
    setLowRamFarm(s.lowRamFarmMode)
    setAutoScaleRam(s.autoScaleConcurrentByRam)
    setAutoFailover(s.autoFailoverToChromeNative)
    setMaxViasProxy(String(s.maxViasPerProxyInBatch))
    setMaxPagesProxy(String(s.maxPagesPerProxyInBatch))
    setStaggerSec(String(s.sameProxyMinStaggerSeconds))
    setAutoKeepAlive(s.autoKeepAliveScheduler)
    setPreCheckProxy(s.preCheckProxyBeforeLaunch)
    setTelegramEnabled(s.telegramEnabled)
    setNotifyDisabled(s.notifyAdAccountDisabled)
    setNotifyBilling(s.notifyBillingFailed)
    setNotifyPage(s.notifyPageRestricted)
    setNotifyRetainer(s.notifyRetainerOverspend)
    setNotifyThreshold80(s.notifyThreshold80 ?? true)
    setNotifySpendSpike(s.notifySpendSpike ?? true)
    setQuietHours(s.quietHoursRespect)
  }, [state.configRev])

  useEffect(() => {
    const validChats = s.detectedTelegramChats.filter((c) => Boolean(c.chatId))
    if (validChats.length > 0 && selectedChatId === '__none__') {
      const firstId = validChats[0].chatId
      setSelectedChatId(firstId)
      if (!chatId.trim()) setChatId(firstId)
    }
  }, [s.detectedTelegramChats, selectedChatId, chatId])

  const viaQuotaPct = s.maxVias > 0 ? Math.min(100, Math.round((s.viasUsed / s.maxVias) * 100)) : 0
  const adQuotaPct =
    s.maxAdAccounts > 0 ? Math.min(100, Math.round((s.adAccountsUsed / s.maxAdAccounts) * 100)) : 0

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[228px_1fr]">
      {/* LEFT STICKY CATEGORY RAIL (macOS / Linear Settings) */}
      <aside className="studio-panel self-start p-1.5 lg:sticky lg:top-0">
        <div className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const active = category === cat.key
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat.key)}
                className={cn(
                  'group relative flex shrink-0 items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                  active
                    ? 'bg-accent/80 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground',
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="hidden lg:block absolute left-0 top-2 bottom-2 w-[2.5px] rounded-full bg-primary"
                  />
                )}
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground',
                  )}
                />
                <div className="min-w-0">
                  <div className="truncate text-xs">{cat.label}</div>
                  <div className="hidden truncate text-[10.5px] text-muted-foreground/75 lg:block">
                    {cat.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* RIGHT CONTENT PANE (Clean Hairline Divided Sections, Zero Cards-in-Cards) */}
      <div className="space-y-5">
        {/* 1. CLOUD & LICENSE */}
        {category === 'cloud' && (
          <div className="studio-panel divide-y divide-border/70">
            <section className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Kết nối Cloud &amp; Tài khoản</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Đăng nhập JWT mã hóa DPAPI 24/7 &amp; đồng bộ Asset từ AdsOps Cloud
                  </p>
                </div>
                <StatusDot
                  tone={state.isLoggedIn ? 'live' : 'muted'}
                  label={state.isLoggedIn ? 'Đã kết nối' : 'Chưa đăng nhập'}
                  labelClassName="text-xs"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Backend API URL</Label>
                  <Input
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="https://audit-ads-backend.vibe1.tinhgon.xyz"
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Email đăng nhập</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@domain.com"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Mật khẩu Cloud</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>
              </div>

              {s.authErrorMessage && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {s.authErrorMessage}
                </div>
              )}
              {s.authSuccessMessage && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {s.authSuccessMessage}
                </div>
              )}

              <label className="flex items-center gap-2 text-[11px] text-muted-foreground select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceOldestDevice}
                  onChange={(e) => setReplaceOldestDevice(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span>Tự đăng xuất máy Desktop cũ nhất nếu đã đầy giới hạn thiết bị</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  disabled={state.isBusy}
                  onClick={() =>
                    sendDesktopCommand('cloud_login', {
                      backendUrl,
                      email,
                      password,
                      replaceOldestDevice,
                    })
                  }
                >
                  <Cloud className="h-3.5 w-3.5" /> Đăng nhập Cloud
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => sendDesktopCommand('open_forgot_password_web')}
                >
                  Quên mật khẩu?
                </Button>
                {state.isLoggedIn && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs ml-auto"
                    onClick={() => sendDesktopCommand('cloud_logout')}
                  >
                    <LogOut className="h-3.5 w-3.5" /> Đăng xuất Cloud
                  </Button>
                )}
              </div>
            </section>

            {/* Quota & Invite Code */}
            <section className="p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Hạn mức Gói Cộng đồng &amp; Bản quyền</h3>
                  <p className="text-[11px] text-muted-foreground">Gói: {s.communityTier || 'AGENCY'}</p>
                </div>
                <StatusDot
                  tone={s.licenseIsReadOnly ? 'critical' : s.licenseStatus === 'grace' ? 'warning' : 'live'}
                  label={
                    s.licenseIsReadOnly
                      ? 'CHỈ-ĐỌC'
                      : s.licenseStatus === 'grace'
                        ? 'ÂN HẠN 3N'
                        : s.licenseStatus === 'expiring' || s.licenseStatus === 'active'
                          ? `CÒN ${Math.max(0, s.licenseDaysRemaining ?? 0)} NGÀY`
                          : 'HOẠT ĐỘNG'
                  }
                  labelClassName="font-mono text-[11px]"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                <div>
                  <div className="mb-1.5 flex justify-between text-muted-foreground">
                    <span>Via</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {s.viasUsed}/{s.maxVias}
                    </span>
                  </div>
                  <Progress value={viaQuotaPct} className="h-1.5" />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-muted-foreground">
                    <span>TKQC</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {s.adAccountsUsed}/{s.maxAdAccounts}
                    </span>
                  </div>
                  <Progress value={adQuotaPct} className="h-1.5" />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-muted-foreground">
                    <span>Máy Desktop</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {s.activeDesktopDevices ?? 0}/{s.maxDesktopDevices ?? 10}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(
                      100,
                      Math.round(((s.activeDesktopDevices ?? 0) / Math.max(1, s.maxDesktopDevices ?? 10)) * 100),
                    )}
                    className="h-1.5"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Nhập Mã Cộng Đồng / Invite Code..."
                  className="h-8 max-w-sm text-xs uppercase font-mono"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => sendDesktopCommand('redeem_community_code', { code: inviteCode })}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Kích hoạt Mã
                </Button>
              </div>
            </section>

            {/* Device Sessions */}
            <section className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    Phiên Thiết bị Cloud ({s.deviceSessions.length})
                  </h3>
                  <p className="text-[11px] text-muted-foreground">Giám sát &amp; thu hồi phiên đăng nhập trên các máy khác</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                  onClick={() => sendDesktopCommand('logout_other_devices')}
                >
                  <LogOut className="h-3.5 w-3.5" /> Thu hồi máy khác
                </Button>
              </div>

              {s.deviceSessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Chưa có danh sách phiên thiết bị từ Cloud.</p>
              ) : (
                <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                  {s.deviceSessions.map((ds) => (
                    <div key={ds.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-foreground">{ds.title}</span>
                          {ds.isCurrent && <StatusDot tone="live" label="HIỆN TẠI" labelClassName="font-mono text-[10px]" />}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{ds.subtitle}</div>
                      </div>
                      {!ds.isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => sendDesktopCommand('revoke_device_session', { sessionId: ds.id })}
                        >
                          Thu hồi
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* 2. VAULT & PORTABLE BACKUP */}
        {category === 'vault' && (
          <div className="studio-panel divide-y divide-border/70">
            <section className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Két Sao Lưu Di Chuyển Máy (.adsopsvault AES-256-GCM)
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Đóng gói Cookie, 2FA TOTP, Via, cấu hình Proxy &amp; Hồ sơ Ngâm 72h
                  </p>
                </div>
                <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
                  <span>
                    Secret DPAPI: <strong className="text-foreground">{s.vaultSecretCount}</strong>
                  </span>
                  <span>
                    Ngâm / Cooldown: <strong className="text-foreground">{s.stewardshipRecordCount}</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-8 text-xs font-semibold" onClick={() => sendDesktopCommand('export_full_vault')}>
                  <Upload className="h-3.5 w-3.5" /> Xuất Full Backup (.adsopsvault)
                </Button>
                <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('import_full_vault')}>
                  <HardDriveUpload className="h-3.5 w-3.5" /> Khôi phục từ File
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('preview_vault_backup')}>
                  <Search className="h-3.5 w-3.5" /> Xem trước File
                </Button>
              </div>
            </section>

            <section className="p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    Sao lưu Tự động Portable (Mở trên mọi máy Windows / sau cài lại Win)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Kết hợp đồng bộ thư mục OneDrive / Google Drive để không bao giờ mất Két 2FA
                  </p>
                </div>
                <StatusDot
                  tone={s.hasPortableBackupPassphrase ? 'live' : 'warning'}
                  label={s.hasPortableBackupPassphrase ? 'Đã bật Portable' : 'Chỉ DPAPI máy này'}
                  labelClassName="text-[11px]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Mật khẩu Khôi phục Két Portable (≥ 6 ký tự)
                  </Label>
                  <Input
                    type="password"
                    value={portablePassphrase}
                    onChange={(e) => setPortablePassphrase(e.target.value)}
                    placeholder={
                      s.hasPortableBackupPassphrase
                        ? 'Để trống nếu giữ nguyên mật khẩu cũ'
                        : 'Nhập mật khẩu nhớ được khi chuyển máy'
                    }
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Thư mục Auto-Backup (OneDrive / GDrive)</Label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      value={customBackupFolder}
                      onChange={(e) => setCustomBackupFolder(e.target.value)}
                      placeholder={s.effectiveAutoBackupFolder || 'Mặc định AppData/AutoBackups'}
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 px-2.5"
                      aria-label="Chọn thư mục Auto-Backup"
                      title="Chọn thư mục Auto-Backup"
                      onClick={() => sendDesktopCommand('pick_backup_folder')}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    sendDesktopCommand('save_portable_backup_config', {
                      passphrase: portablePassphrase,
                      customFolder: customBackupFolder,
                    })
                  }
                >
                  <Save className="h-3.5 w-3.5" /> Lưu &amp; Sao lưu Portable ngay
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => sendDesktopCommand('open_auto_backup_folder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Mở thư mục Backup
                </Button>
              </div>

              {s.portableBackupStatusMessage && (
                <div className="rounded-lg border border-border/75 bg-muted/30 px-3 py-2 text-[11px] text-foreground">
                  {s.portableBackupStatusMessage}
                </div>
              )}

              {s.autoBackupFiles && s.autoBackupFiles.length > 0 && (
                <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                  {s.autoBackupFiles.slice(0, 6).map((bf) => (
                    <div key={bf.fullPath} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono font-medium text-foreground">{bf.fileName}</span>
                          <StatusDot tone={bf.portable ? 'live' : 'muted'} label={bf.portable ? 'Portable' : 'DPAPI'} labelClassName="text-[10px]" />
                        </div>
                        <div className="text-[10.5px] text-muted-foreground">
                          {bf.lastWriteLocal} · {Math.max(1, Math.round(bf.sizeBytes / 1024))} KB
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => sendDesktopCommand('preview_vault_backup', { filePath: bf.fullPath })}
                        >
                          Xem trước
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => sendDesktopCommand('restore_vault_backup_file', { filePath: bf.fullPath })}
                        >
                          Khôi phục
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* 3. BROWSER, BRIDGE, ANTIDETECT & UPDATER */}
        {category === 'browser' && (
          <div className="studio-panel divide-y divide-border/70">
            <section className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Tích hợp Windows, Chrome &amp; Bridge :17890
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.chromeProfileSummary || 'URI Protocol, Cô lập Chrome Profile & Zero-Trust Token'}
                  </p>
                </div>
                <StatusDot
                  tone={state.kpi.bridgeOnline ? 'live' : 'warning'}
                  label={`Bridge :${state.kpi.bridgePort}`}
                  labelClassName="font-mono text-xs"
                />
              </div>

              <div className="divide-y divide-border/60 rounded-lg border border-border/75">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      Cô lập Chrome Profile riêng (--user-data-dir)
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Tách riêng phiên đăng nhập từng Via, tránh xung đột Cookie khi chạy song song
                    </div>
                  </div>
                  <Switch
                    checked={isolatedProfiles}
                    onCheckedChange={(checked) => {
                      setIsolatedProfiles(checked)
                      sendDesktopCommand('set_isolated_profiles', { enabled: checked })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">URI Protocol adsops-chrome://</div>
                    <StatusDot
                      tone={s.uriProtocolRegistered ? 'live' : 'warning'}
                      label={s.uriProtocolRegistered ? 'Đã đăng ký' : 'Chưa đăng ký'}
                      labelClassName="text-[11px]"
                    />
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('register_uri_protocol')}>
                    Đăng ký URI
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">Khởi động cùng Windows</div>
                    <StatusDot
                      tone={s.autoStartEnabled ? 'live' : 'muted'}
                      label={s.autoStartEnabled ? 'Đang bật' : 'Đang tắt'}
                      labelClassName="text-[11px]"
                    />
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('toggle_autostart')}>
                    {s.autoStartEnabled ? 'Tắt Auto-Start' : 'Bật Auto-Start'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">X-AdsOps-Bridge-Token (DPAPI)</div>
                    <div className="truncate font-mono text-[11px] text-primary">{s.maskedBridgeToken || '••••••••'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('copy_bridge_token')}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('rotate_bridge_token')}>
                      <RotateCcw className="h-3 w-3" /> Xoay vòng
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => sendDesktopCommand('open_appdata_folder')}>
                      <FolderOpen className="h-3 w-3" /> AppData
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {/* 5-Engine Antidetect & RAM Tuning */}
            <section className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Cpu className="h-3.5 w-3.5 text-primary" />
                    Đa Engine Antidetect &amp; Tối ưu RAM
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Hỗ trợ Chrome Native, GPM, AdsPower, MoreLogin, Dolphin ({s.antidetectProfilesCount} Profile)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Engine mặc định</Label>
                  <Select value={engine} onValueChange={setEngine}>
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue placeholder="Chọn Browser Engine" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.supportedEngines
                        .filter((opt) => Boolean(opt.value))
                        .map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Giới hạn trình duyệt mở cùng lúc (1–30)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(e.target.value)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Local API Base URL</Label>
                  <Input
                    value={antidetectApiUrl}
                    onChange={(e) => setAntidetectApiUrl(e.target.value)}
                    placeholder="http://127.0.0.1:19995"
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Antidetect API Key</Label>
                  <Input
                    type="password"
                    value={antidetectApiKey}
                    onChange={(e) => setAntidetectApiKey(e.target.value)}
                    placeholder="Để trống nếu giữ API Key cũ"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs">
                  <span>Khiên Antidetect Shield</span>
                  <Switch checked={antidetectShield} onCheckedChange={setAntidetectShield} />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs">
                  <span>Chế độ Farm RAM thấp</span>
                  <Switch checked={lowRamFarm} onCheckedChange={setLowRamFarm} />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs">
                  <span>Tự điều chỉnh luồng theo RAM</span>
                  <Switch checked={autoScaleRam} onCheckedChange={setAutoScaleRam} />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs">
                  <span>Auto-Failover sang Chrome Gốc</span>
                  <Switch checked={autoFailover} onCheckedChange={setAutoFailover} />
                </label>
              </div>

              {s.antidetectStatusMessage && (
                <div className="rounded-lg border border-border/75 bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
                  {s.antidetectStatusMessage}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  onClick={() =>
                    sendDesktopCommand('save_antidetect_config', {
                      defaultBrowserEngine: engine,
                      antidetectApiBaseUrl: antidetectApiUrl,
                      antidetectApiKey,
                      maxConcurrentBrowsers: Number(maxConcurrent) || 4,
                      enableChromeAntidetectShield: antidetectShield,
                      lowRamFarmMode: lowRamFarm,
                      autoScaleConcurrentByRam: autoScaleRam,
                      autoFailoverToChromeNative: autoFailover,
                    })
                  }
                >
                  <Save className="h-3.5 w-3.5" /> Lưu Engine
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    sendDesktopCommand('scan_antidetect_profiles', {
                      defaultBrowserEngine: engine,
                      antidetectApiBaseUrl: antidetectApiUrl,
                      antidetectApiKey,
                    })
                  }
                >
                  <Search className="h-3.5 w-3.5" /> Quét Profile
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    sendDesktopCommand('auto_match_antidetect', {
                      defaultBrowserEngine: engine,
                      antidetectApiBaseUrl: antidetectApiUrl,
                      antidetectApiKey,
                    })
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" /> Tự ghép Via
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('benchmark_engines')}>
                  <Activity className="h-3.5 w-3.5" /> Benchmark
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('clean_ram')}>
                  <Trash2 className="h-3.5 w-3.5" /> Dọn RAM
                </Button>
              </div>
            </section>

            {/* Authenticode Signature & Updater */}
            <section className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Chữ ký Số &amp; Cập nhật Phiên bản</h3>
                  <p className="text-[11px] text-muted-foreground">
                    AdsOps Desktop Pro v{state.appVersion} · Extension v{state.extVersion}
                  </p>
                </div>
                <StatusDot
                  tone={s.hasEmbeddedSignature ? 'live' : 'warning'}
                  label={s.hasEmbeddedSignature ? 'Authenticode Valid' : 'Chưa ký'}
                  labelClassName="font-mono text-[11px]"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/75 bg-muted/20 p-3 text-xs sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Trạng thái:</span>{' '}
                  <span className="font-medium text-foreground">{s.signatureStatus || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">SHA-256:</span>{' '}
                  <span className="font-mono text-[11px] text-primary">{s.shaShort || 'N/A'}</span>
                </div>
                <div className="sm:col-span-2 text-[11px] text-muted-foreground">
                  {s.updateStatusText || 'Sẵn sàng kiểm tra bản phát hành mới từ Server.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => sendDesktopCommand('check_app_updates')}>
                  <RefreshCw className="h-3.5 w-3.5" /> Kiểm tra bản mới
                </Button>
                {s.hasUpdateManifest && (
                  <Button
                    variant={s.isNewerUpdate ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => sendDesktopCommand('apply_self_update')}
                  >
                    <Download className="h-3.5 w-3.5" /> Cập nhật {s.latestAvailableVersion ? `v${s.latestAvailableVersion}` : ''}
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}

        {/* 4. PROXY CLUSTER LIMITS */}
        {category === 'proxy' && (
          <section className="studio-panel p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Hạn mức Cụm Proxy &amp; Giãn Nhịp An Toàn
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Giới hạn số Via / Tạo Page trên cùng dải IP &amp; tự động dò Proxy Live trước khi mở
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Max Via / 1 Proxy / Lô</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxViasProxy}
                  onChange={(e) => setMaxViasProxy(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Max Tạo Page / IP</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={maxPagesProxy}
                  onChange={(e) => setMaxPagesProxy(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Nghỉ trùng IP (15–300s)</Label>
                <Input
                  type="number"
                  min={15}
                  max={300}
                  value={staggerSec}
                  onChange={(e) => setStaggerSec(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
            </div>

            <div className="divide-y divide-border/60 rounded-lg border border-border/75">
              <label className="flex items-center justify-between px-4 py-3 text-xs cursor-pointer">
                <span>Bật lịch Đảo Ấm tự động (Keep-Alive Scheduler)</span>
                <Switch checked={autoKeepAlive} onCheckedChange={setAutoKeepAlive} />
              </label>
              <label className="flex items-center justify-between px-4 py-3 text-xs cursor-pointer">
                <span>Pre-check Proxy Live &amp; Timezone trước khi mở trình duyệt</span>
                <Switch checked={preCheckProxy} onCheckedChange={setPreCheckProxy} />
              </label>
            </div>

            <Button
              size="sm"
              className="h-8 text-xs font-semibold"
              onClick={() =>
                sendDesktopCommand('save_proxy_cluster_config', {
                  maxViasPerProxyInBatch: Number(maxViasProxy) || 4,
                  maxPagesPerProxyInBatch: Number(maxPagesProxy) || 2,
                  sameProxyMinStaggerSeconds: Number(staggerSec) || 55,
                  autoKeepAliveScheduler: autoKeepAlive,
                  preCheckProxyBeforeLaunch: preCheckProxy,
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Lưu Hạn mức Cụm Proxy
            </Button>
          </section>
        )}

        {/* 5. TELEGRAM REAL-TIME ALERTS */}
        {category === 'telegram' && (
          <section className="studio-panel p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Cảnh báo Telegram Bot Thời gian thực</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.telegramDesc || 'Gửi cảnh báo TKQC chết, chạm ngưỡng thẻ 80% & hạn chế Fanpage'}
                </p>
              </div>
              <StatusDot
                tone={s.telegramActive ? 'live' : s.botConfigured ? 'info' : 'muted'}
                label={
                  s.telegramActive ? 'Đang hoạt động' : s.botConfigured ? 'Đã có Bot Token' : 'Chưa cấu hình'
                }
                labelClassName="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Telegram Bot Token</Label>
                <Input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Nhập Token mới nếu muốn thay đổi"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Chat ID / Nhóm nhận tin</Label>
                <Input
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="-100xxxxxxxxxx"
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
            </div>

            {s.detectedTelegramChats.length > 0 && (
              <div>
                <Label className="text-[11px] text-muted-foreground">
                  Nhóm Telegram vừa dò được ({s.detectedTelegramChats.length})
                </Label>
                <Select
                  value={selectedChatId}
                  onValueChange={(val) => {
                    setSelectedChatId(val)
                    if (val !== '__none__') setChatId(val)
                  }}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue placeholder="-- Chọn nhóm Telegram vừa dò --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-- Chọn nhóm Telegram vừa dò --</SelectItem>
                    {s.detectedTelegramChats
                      .filter((c) => Boolean(c.chatId))
                      .map((c) => (
                        <SelectItem key={c.chatId} value={c.chatId}>
                          {c.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-primary" /> Bật cảnh báo Telegram
                </span>
                <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Tôn trọng Giờ yên tĩnh</span>
                <Switch checked={quietHours} onCheckedChange={setQuietHours} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>TKQC Vô hiệu hóa / Die</span>
                <Switch checked={notifyDisabled} onCheckedChange={setNotifyDisabled} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Lỗi Thanh toán / Thẻ</span>
                <Switch checked={notifyBilling} onCheckedChange={setNotifyBilling} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Fanpage bị Hạn chế</span>
                <Switch checked={notifyPage} onCheckedChange={setNotifyPage} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Cảnh báo Vượt ngân sách</span>
                <Switch checked={notifyRetainer} onCheckedChange={setNotifyRetainer} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Chạm ≥ 80% Ngưỡng thẻ / Spend Cap</span>
                <Switch checked={notifyThreshold80} onCheckedChange={setNotifyThreshold80} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/75 bg-muted/20 px-3 py-2 text-xs cursor-pointer">
                <span>Chi tiêu ngày tăng đột biến (Meta/GG)</span>
                <Switch checked={notifySpendSpike} onCheckedChange={setNotifySpendSpike} />
              </label>
            </div>

            {s.telegramStatusMessage && (
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-[11px]',
                  s.telegramStatusOk
                    ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
                )}
              >
                {s.telegramStatusMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                onClick={() => sendDesktopCommand('detect_telegram_chats', { botToken })}
              >
                <Search className="h-3.5 w-3.5" /> Dò Nhóm Tự Động
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs font-semibold"
                onClick={() =>
                  sendDesktopCommand('save_telegram_config', {
                    botToken,
                    chatId: chatId === '__none__' ? '' : chatId,
                    enabled: telegramEnabled,
                    notifyAdAccountDisabled: notifyDisabled,
                    notifyBillingFailed: notifyBilling,
                    notifyPageRestricted: notifyPage,
                    notifyRetainerOverspend: notifyRetainer,
                    notifyThreshold80,
                    notifySpendSpike,
                    quietHoursRespect: quietHours,
                  })
                }
              >
                <Save className="h-3.5 w-3.5" /> Lưu Telegram
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  sendDesktopCommand('test_telegram_override', {
                    botToken,
                    chatId: chatId === '__none__' ? '' : chatId,
                  })
                }
              >
                <Send className="h-3.5 w-3.5" /> Gửi Tin Test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-8 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                onClick={() => sendDesktopCommand('clear_telegram_token')}
              >
                <Trash2 className="h-3.5 w-3.5" /> Xóa Bot Token
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
