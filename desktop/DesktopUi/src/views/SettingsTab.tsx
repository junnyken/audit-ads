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
  Laptop,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sendDesktopCommand } from '@/lib/bridge'
import type { AppShellWebStateDto } from '@/types'

export function SettingsTab({ state }: { state: AppShellWebStateDto }) {
  const s = state.settings

  const [backendUrl, setBackendUrl] = useState(s.backendBaseUrl)
  const [email, setEmail] = useState(s.userEmail)
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')

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
  const [quietHours, setQuietHours] = useState(s.quietHoursRespect)

  useEffect(() => {
    setBackendUrl(s.backendBaseUrl)
    setEmail(s.userEmail)
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
    <Tabs defaultValue="cloud_vault" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="cloud_vault">Tài khoản Cloud &amp; Két DPAPI</TabsTrigger>
        <TabsTrigger value="browser_antidetect">Trình duyệt &amp; Antidetect</TabsTrigger>
        <TabsTrigger value="proxy_schedule">Cụm Proxy &amp; Nhịp chạy</TabsTrigger>
        <TabsTrigger value="telegram">Cảnh báo Telegram</TabsTrigger>
      </TabsList>

      {/* SUB-TAB 1: CLOUD AUTH, QUOTA, PORTABLE VAULT & DEVICE SESSIONS */}
      <TabsContent value="cloud_vault" className="mt-0 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Cloud className="h-4 w-4 text-primary" />
                  Kết nối Cloud &amp; Hạn mức Cộng đồng
                </CardTitle>
                <CardDescription className="text-xs">
                  Đăng nhập JWT mã hóa DPAPI 24/7 &amp; kích hoạt gói Thành viên
                </CardDescription>
              </div>
              <Badge variant={state.isLoggedIn ? 'success' : 'secondary'}>
                {state.isLoggedIn ? 'ĐÃ KẾT NỐI' : 'CHƯA ĐĂNG NHẬP'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Backend API URL</Label>
                <Input
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="https://audit-ads-backend.vibe1.tinhgon.xyz"
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Email đăng nhập</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@domain.com"
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Mật khẩu Cloud</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1 text-xs"
                  />
                </div>
              </div>
            </div>

            {s.authErrorMessage && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {s.authErrorMessage}
              </div>
            )}
            {s.authSuccessMessage && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                {s.authSuccessMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={state.isBusy}
                onClick={() => sendDesktopCommand('cloud_login', { backendUrl, email, password })}
              >
                <Cloud className="h-3.5 w-3.5" /> Đăng nhập Cloud
              </Button>
              {state.isLoggedIn && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => sendDesktopCommand('cloud_logout')}
                >
                  <LogOut className="h-3.5 w-3.5" /> Đăng xuất Cloud
                </Button>
              )}
            </div>

            <div className="space-y-2.5 rounded-lg border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Hạn mức Gói Cộng đồng</span>
                <Badge variant="info">{s.communityTier || 'AGENCY'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground">
                    <span>Via quản lý</span>
                    <span className="font-mono font-semibold text-foreground">
                      {s.viasUsed}/{s.maxVias}
                    </span>
                  </div>
                  <Progress value={viaQuotaPct} className="h-1.5" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground">
                    <span>TKQC liên kết</span>
                    <span className="font-mono font-semibold text-foreground">
                      {s.adAccountsUsed}/{s.maxAdAccounts}
                    </span>
                  </div>
                  <Progress value={adQuotaPct} className="h-1.5" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Nhập Mã Cộng Đồng / Invite Code..."
                  className="h-8 text-xs uppercase"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => sendDesktopCommand('redeem_community_code', { code: inviteCode })}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Kích hoạt Mã
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4 text-primary" />
                Két Sao Lưu Di Chuyển Máy (.adsopsvault AES-256-GCM)
              </CardTitle>
              <CardDescription className="text-xs">
                Đóng gói Cookie, 2FA TOTP, Via, cấu hình Proxy &amp; Hồ sơ Ngâm 72h
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="text-[11px] font-medium text-muted-foreground">Cookie / 2FA DPAPI</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums">{s.vaultSecretCount}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="text-[11px] font-medium text-muted-foreground">Hồ sơ Ngâm / Cooldown</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums">{s.stewardshipRecordCount}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => sendDesktopCommand('export_full_vault')}>
                  <Upload className="h-3.5 w-3.5" /> Xuất Full Backup (.adsopsvault)
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('import_full_vault')}>
                  <HardDriveUpload className="h-3.5 w-3.5" /> Khôi phục từ File
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Laptop className="h-4 w-4 text-primary" />
                    Phiên Thiết bị Cloud ({s.deviceSessions.length})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Giám sát &amp; thu hồi phiên đăng nhập trên các máy khác
                  </CardDescription>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => sendDesktopCommand('logout_other_devices')}
                >
                  <LogOut className="h-3.5 w-3.5" /> Thu hồi máy khác
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {s.deviceSessions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Chưa có danh sách phiên thiết bị từ Cloud.
                </div>
              ) : (
                <div className="max-h-[210px] space-y-2 overflow-y-auto pr-1">
                  {s.deviceSessions.map((ds) => (
                    <div
                      key={ds.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold text-foreground">{ds.title}</span>
                          {ds.isCurrent && (
                            <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                              HIỆN TẠI
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{ds.subtitle}</div>
                      </div>
                      {!ds.isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => sendDesktopCommand('revoke_device_session', { sessionId: ds.id })}
                        >
                          Thu hồi
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* SUB-TAB 2: WINDOWS, BRIDGE, 5-ENGINE ANTIDETECT & UPDATER */}
      <TabsContent value="browser_antidetect" className="mt-0 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <MonitorCog className="h-4 w-4 text-primary" />
                    Tích hợp Windows, Chrome &amp; Bridge :17890
                  </CardTitle>
                  <CardDescription className="text-xs">
                    URI Protocol, Cô lập Chrome Profile &amp; Xác thực Zero-Trust Local
                  </CardDescription>
                </div>
                <Badge variant={state.kpi.bridgeOnline ? 'success' : 'warning'}>
                  Bridge :{state.kpi.bridgePort}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
                <div>
                  <div className="text-xs font-semibold text-foreground">
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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2">
                  <div>
                    <div className="text-[11px] font-semibold">URI adsops-chrome://</div>
                    <Badge
                      variant={s.uriProtocolRegistered ? 'success' : 'warning'}
                      className="mt-1 text-[10px]"
                    >
                      {s.uriProtocolRegistered ? 'ĐÃ ĐĂNG KÝ' : 'CHƯA ĐĂNG KÝ'}
                    </Badge>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => sendDesktopCommand('register_uri_protocol')}
                  >
                    Đăng ký URI
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2">
                  <div>
                    <div className="text-[11px] font-semibold">Khởi động cùng Windows</div>
                    <Badge
                      variant={s.autoStartEnabled ? 'success' : 'secondary'}
                      className="mt-1 text-[10px]"
                    >
                      {s.autoStartEnabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}
                    </Badge>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('toggle_autostart')}>
                    {s.autoStartEnabled ? 'Tắt Auto-Start' : 'Bật Auto-Start'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/50 px-3 py-2 text-[11px] text-muted-foreground">
                {s.chromeProfileSummary || 'Chưa quét Chrome Profile hệ thống.'}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-foreground">X-AdsOps-Bridge-Token (DPAPI)</div>
                  <div className="truncate font-mono text-xs text-primary">{s.maskedBridgeToken || '••••••••'}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('copy_bridge_token')}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => sendDesktopCommand('rotate_bridge_token')}>
                    <RotateCcw className="h-3.5 w-3.5" /> Xoay vòng
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('open_appdata_folder')}>
                    <FolderOpen className="h-3.5 w-3.5" /> AppData
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Chữ ký Số &amp; Cập nhật Phiên bản
                  </CardTitle>
                  <CardDescription className="text-xs">
                    AdsOps Desktop Pro v{state.appVersion} • Extension v{state.extVersion}
                  </CardDescription>
                </div>
                <Badge variant={s.hasEmbeddedSignature ? 'success' : 'warning'}>
                  {s.hasEmbeddedSignature ? 'AUTHENTICODE VALID' : 'CHƯA KÝ'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 rounded-lg border border-border bg-background/60 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trạng thái chữ ký:</span>
                  <span className="font-medium text-foreground">{s.signatureStatus || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">SHA-256 EXE:</span>
                  <span className="font-mono text-[11px] text-primary">{s.shaShort || 'N/A'}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {s.updateStatusText || 'Sẵn sàng kiểm tra bản phát hành mới từ Server.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('check_app_updates')}>
                  <RefreshCw className="h-3.5 w-3.5" /> Kiểm tra bản mới
                </Button>
                {s.hasUpdateManifest && (
                  <Button
                    variant={s.isNewerUpdate ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => sendDesktopCommand('apply_self_update')}
                  >
                    <Download className="h-3.5 w-3.5" /> Cập nhật{' '}
                    {s.latestAvailableVersion ? `v${s.latestAvailableVersion}` : ''}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu className="h-4 w-4 text-primary" />
                  Đa Engine Antidetect &amp; Tối ưu RAM
                </CardTitle>
                <CardDescription className="text-xs">
                  Hỗ trợ 5 Engine (Chrome Native, GPM, AdsPower, MoreLogin, Dolphin)
                </CardDescription>
              </div>
              <Badge variant="info">{s.antidetectProfilesCount} Profile Antidetect</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                <Label className="text-[11px] text-muted-foreground">
                  Giới hạn trình duyệt mở cùng lúc (1–30)
                </Label>
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
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-2 text-xs">
                <span>Khiên Antidetect Shield</span>
                <Switch checked={antidetectShield} onCheckedChange={setAntidetectShield} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-2 text-xs">
                <span>Chế độ Farm RAM thấp</span>
                <Switch checked={lowRamFarm} onCheckedChange={setLowRamFarm} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-2 text-xs">
                <span>Tự điều chỉnh luồng theo RAM</span>
                <Switch checked={autoScaleRam} onCheckedChange={setAutoScaleRam} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-2 text-xs">
                <span>Auto-Failover sang Chrome Gốc</span>
                <Switch checked={autoFailover} onCheckedChange={setAutoFailover} />
              </label>
            </div>

            {s.antidetectStatusMessage && (
              <div className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                {s.antidetectStatusMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
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
              <Button variant="outline" size="sm" onClick={() => sendDesktopCommand('benchmark_engines')}>
                <Activity className="h-3.5 w-3.5" /> Benchmark
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendDesktopCommand('clean_ram')}>
                <Trash2 className="h-3.5 w-3.5" /> Dọn RAM
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* SUB-TAB 3: PROXY CLUSTER LIMITS */}
      <TabsContent value="proxy_schedule" className="mt-0">
        <Card className="max-w-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Hạn mức Cụm Proxy &amp; Giãn Nhịp An Toàn
            </CardTitle>
            <CardDescription className="text-xs">
              Giới hạn số Via / Tạo Page trên cùng dải IP &amp; tự động dò Proxy Live trước khi mở
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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

            <div className="space-y-2">
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
                <span>Bật lịch Đảo Ấm tự động (Keep-Alive Scheduler)</span>
                <Switch checked={autoKeepAlive} onCheckedChange={setAutoKeepAlive} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
                <span>Pre-check Proxy Live &amp; Timezone trước khi mở trình duyệt</span>
                <Switch checked={preCheckProxy} onCheckedChange={setPreCheckProxy} />
              </label>
            </div>

            <Button
              size="sm"
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
          </CardContent>
        </Card>
      </TabsContent>

      {/* SUB-TAB 4: TELEGRAM BOT */}
      <TabsContent value="telegram" className="mt-0">
        <Card className="max-w-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4 text-primary" />
                  Cảnh báo Telegram Bot Thời gian thực
                </CardTitle>
                <CardDescription className="text-xs">
                  {s.telegramDesc || 'Gửi cảnh báo TKQC chết, lỗi thanh toán & hạn chế Fanpage'}
                </CardDescription>
              </div>
              <Badge variant={s.telegramActive ? 'success' : s.botConfigured ? 'info' : 'secondary'}>
                {s.telegramActive
                  ? 'ĐANG HOẠT ĐỘNG'
                  : s.botConfigured
                  ? 'ĐÃ CÓ BOT TOKEN'
                  : 'CHƯA CẤU HÌNH'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span className="flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-primary" /> Bật cảnh báo Telegram
                </span>
                <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span>Tôn trọng Giờ yên tĩnh</span>
                <Switch checked={quietHours} onCheckedChange={setQuietHours} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span>TKQC Vô hiệu hóa / Die</span>
                <Switch checked={notifyDisabled} onCheckedChange={setNotifyDisabled} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span>Lỗi Thanh toán / Thẻ</span>
                <Switch checked={notifyBilling} onCheckedChange={setNotifyBilling} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span>Fanpage bị Hạn chế</span>
                <Switch checked={notifyPage} onCheckedChange={setNotifyPage} />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs">
                <span>Cảnh báo Vượt ngân sách</span>
                <Switch checked={notifyRetainer} onCheckedChange={setNotifyRetainer} />
              </label>
            </div>

            {s.telegramStatusMessage && (
              <div
                className={`rounded-lg border px-3 py-1.5 text-[11px] ${
                  s.telegramStatusOk
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                {s.telegramStatusMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('detect_telegram_chats', { botToken })}
              >
                <Search className="h-3.5 w-3.5" /> Dò Nhóm Tự Động
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  sendDesktopCommand('save_telegram_config', {
                    botToken,
                    chatId: chatId === '__none__' ? '' : chatId,
                    enabled: telegramEnabled,
                    notifyAdAccountDisabled: notifyDisabled,
                    notifyBillingFailed: notifyBilling,
                    notifyPageRestricted: notifyPage,
                    notifyRetainerOverspend: notifyRetainer,
                    quietHoursRespect: quietHours,
                  })
                }
              >
                <Save className="h-3.5 w-3.5" /> Lưu Telegram
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  sendDesktopCommand('test_telegram_override', {
                    botToken,
                    chatId: chatId === '__none__' ? '' : chatId,
                  })
                }
              >
                <Send className="h-3.5 w-3.5" /> Gửi Tin Test
              </Button>
              <Button variant="destructive" size="sm" onClick={() => sendDesktopCommand('clear_telegram_token')}>
                <Trash2 className="h-3.5 w-3.5" /> Xóa Bot Token
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
