import type { FacebookIdentity } from './types'

export interface RealChromeProfile {
  folder: string
  name: string
  email: string
  gaia_name: string
  label: string
}

export const WORKSTATION_REAL_CHROME_PROFILES: RealChromeProfile[] = [
  {
    folder: 'Default',
    name: 'trieu',
    email: 'thientrieu753@gmail.com',
    gaia_name: 'trieu nguyen thien',
    label: 'Chrome — Default · trieu (thientrieu753@gmail.com)',
  },
  {
    folder: 'Profile 1',
    name: 'tt',
    email: 'duchungducvb@gmail.com',
    gaia_name: 'Hung Duc',
    label: 'Chrome — Profile 1 · tt (duchungducvb@gmail.com)',
  },
  {
    folder: 'Profile 3',
    name: 'Thiên Triều',
    email: 'trieunguyen.home9x@gmail.com',
    gaia_name: 'Triều Thiên',
    label: 'Chrome — Profile 3 · Thiên Triều (trieunguyen.home9x@gmail.com)',
  },
  {
    folder: 'Profile 4',
    name: 'MATBAO',
    email: 'marcommatbao@gmail.com',
    gaia_name: 'MATBAO MARCOM',
    label: 'Chrome — Profile 4 · MATBAO (marcommatbao@gmail.com)',
  },
  {
    folder: 'Profile 5',
    name: 'Matbao-invoice',
    email: 'mifihoadondientuantoan@gmail.com',
    gaia_name: 'Matbao-invoice Hóa đơn điện tử an toàn',
    label: 'Chrome — Profile 5 · Matbao-invoice (mifihoadondientuantoan@gmail.com)',
  },
  {
    folder: 'Profile 6',
    name: 'Test',
    email: 'quangtrkk7344@noigame.dpdns.org',
    gaia_name: 'tai ngo',
    label: 'Chrome — Profile 6 · Test (quangtrkk7344@noigame.dpdns.org)',
  },
  {
    folder: 'Profile 7',
    name: 'Utra Google',
    email: 'thientrieuadmin@tbsupellex.com',
    gaia_name: 'Triều Thiên',
    label: 'Chrome — Profile 7 · Utra Google (thientrieuadmin@tbsupellex.com)',
  },
  {
    folder: 'Profile 8',
    name: 'Test Utraviw',
    email: 'tranngoc123@tbsupellex.com',
    gaia_name: 'Trần Ngọc',
    label: 'Chrome — Profile 8 · Test Utraviw (tranngoc123@tbsupellex.com)',
  },
  {
    folder: 'Profile 9',
    name: 'matbao.com',
    email: 'thinhlq@matbao.com',
    gaia_name: 'Thinh Lam Quang',
    label: 'Chrome — Profile 9 · matbao.com (thinhlq@matbao.com)',
  },
  {
    folder: 'Profile 10',
    name: 'Lâm Quang',
    email: 'lamquangthinh3006@gmail.com',
    gaia_name: 'Lâm Quang Thịnh',
    label: 'Chrome — Profile 10 · Lâm Quang (lamquangthinh3006@gmail.com)',
  },
  {
    folder: 'Profile 11',
    name: 'thu',
    email: 'thientrieu.gr1@gmail.com',
    gaia_name: 'Vũ ngọc Triều',
    label: 'Chrome — Profile 11 · thu (thientrieu.gr1@gmail.com)',
  },
  {
    folder: 'Profile 12',
    name: 'trtr',
    email: '',
    gaia_name: '',
    label: 'Chrome — Profile 12 · trtr',
  },
  {
    folder: 'Profile 13',
    name: 'VPN',
    email: 'shopheiyo@gmail.com',
    gaia_name: 'Trung Trần Đức',
    label: 'Chrome — Profile 13 · VPN (shopheiyo@gmail.com)',
  },
  {
    folder: 'Profile 14',
    name: 'Test video',
    email: '',
    gaia_name: '',
    label: 'Chrome — Profile 14 · Test video',
  },
]

export async function fetchRealLocalChromeProfiles(): Promise<RealChromeProfile[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const resp = await fetch('http://127.0.0.1:17890/chrome-profiles', {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (resp.ok) {
      const data = (await resp.json()) as { ok?: boolean; profiles?: RealChromeProfile[] }
      if (Array.isArray(data.profiles) && data.profiles.length > 0) {
        return data.profiles
      }
    }
  } catch {
    // Fallback to workstation profile snapshot
  }
  return WORKSTATION_REAL_CHROME_PROFILES
}

export function resolveChromeProfileDirectory(
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
): string {
  const raw = (browserProfileLabel || '').trim()
  if (!raw) return 'Default'

  if (/\bdefault\b/i.test(raw) || /#0\b/.test(raw)) {
    return 'Default'
  }

  const profileMatch = raw.match(/profile\s*#?\s*(\d+)/i)
  if (profileMatch && profileMatch[1]) {
    return `Profile ${profileMatch[1]}`
  }

  const lower = raw.toLowerCase()
  for (const p of WORKSTATION_REAL_CHROME_PROFILES) {
    if (p.email && lower.includes(p.email.toLowerCase())) {
      return p.folder
    }
    if (p.name && p.name.length >= 2 && lower.includes(p.name.toLowerCase())) {
      return p.folder
    }
  }

  const hashMatch = raw.match(/#\s*(\d+)/)
  if (hashMatch && hashMatch[1]) {
    return `Profile ${hashMatch[1]}`
  }

  if (viaLabel && viaLabel.trim()) {
    return viaLabel.trim()
  }
  return 'Default'
}

export function formatShortProfileBadge(identity?: FacebookIdentity | null): string | null {
  if (!identity) return null
  const browser = (identity.browser_profile_label || '').trim()
  const via = (identity.label || '').trim()
  if (browser) {
    const clean = browser.replace(/^Chrome\s*—\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '')
    return clean.length > 26 ? `${clean.slice(0, 24)}…` : clean
  }
  return via || null
}

export interface ParsedProxyInfo {
  scheme: string
  host: string
  port: number
  user: string
  pass: string
}

export function parseProxyString(raw?: string | null): ParsedProxyInfo | null {
  if (!raw) return null
  const s = raw.trim()
  const mAt = s.match(/(?:(http|https|socks5):\/\/)?([^:\s]+):([^@\s]+)@(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/i)
  if (mAt) {
    return {
      scheme: (mAt[1] || 'http').toLowerCase(),
      user: mAt[2],
      pass: mAt[3],
      host: mAt[4],
      port: Number(mAt[5]),
    }
  }
  const mColon4 = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5}):([^:\s]+):([^\s]+)/)
  if (mColon4) {
    return {
      scheme: 'http',
      host: mColon4[1],
      port: Number(mColon4[2]),
      user: mColon4[3],
      pass: mColon4[4],
    }
  }
  const mColon2 = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/)
  if (mColon2) {
    return {
      scheme: 'http',
      host: mColon2[1],
      port: Number(mColon2[2]),
      user: '',
      pass: '',
    }
  }
  return null
}

/**
 * Generates and downloads a ready-to-import Proxy SwitchyOmega `.bak` configuration file
 * for the specified proxy string (`IP:Port:User:Pass` or `IP:Port`).
 */
export function downloadSwitchyOmegaConfig(rawProxy: string, viaLabel?: string): boolean {
  const parsed = parseProxyString(rawProxy)
  if (!parsed) return false
  const profileKey = `+Via_${(viaLabel || 'AdsOps').replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const omegaConfig: Record<string, unknown> = {
    '-addConditionsToBottom': false,
    '-confirmDeletion': true,
    '-downloadInterval': 1440,
    '-enableQuickSwitch': false,
    '-MonitorWebRequests': true,
    '-quickSwitchProfiles': [],
    '-refreshOnProfileChange': true,
    '-revertProxyChanges': false,
    '-showExternalProfile': true,
    '-showInspectMenu': true,
    '-startupProfileName': profileKey.slice(1),
    schemaVersion: 2,
    [profileKey]: {
      bypassList: [
        { conditionType: 'BypassCondition', pattern: '127.0.0.1' },
        { conditionType: 'BypassCondition', pattern: '[::1]' },
        { conditionType: 'BypassCondition', pattern: 'localhost' },
      ],
      color: '#1d4ed8',
      fallbackProxy: {
        host: parsed.host,
        port: parsed.port,
        scheme: parsed.scheme,
      },
      ...(parsed.user && parsed.pass
        ? {
            auth: {
              fallbackProxy: {
                username: parsed.user,
                password: parsed.pass,
              },
            },
          }
        : {}),
      name: profileKey.slice(1),
      profileType: 'FixedProfile',
      revision: '1',
    },
  }
  const blob = new Blob([JSON.stringify(omegaConfig, null, 2)], {
    type: 'application/json;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `SwitchyOmega-${profileKey.slice(1)}-${parsed.host}.bak`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}

export function buildAdsOpsChromeProtocolUrl(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
  proxyLabel?: string | null,
): string {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const params = new URLSearchParams({
    profile: profileDir,
    name: (browserProfileLabel || viaLabel || '').trim(),
    proxy: (proxyLabel || '').trim(),
    url: targetUrl,
  })
  return `adsops-chrome://open?${params.toString()}`
}

export function launchInAssignedChromeProfile(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
  proxyLabel?: string | null,
): void {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const nameHint = (browserProfileLabel || viaLabel || '').trim()
  const cleanProxy = (proxyLabel || '').trim()

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(targetUrl).catch(() => {})
  }

  void (async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const resp = await fetch('http://127.0.0.1:17890/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileDir,
          name: nameHint,
          proxy: cleanProxy,
          url: targetUrl,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (resp.ok) {
        return
      }
    } catch {
      // Fallback to adsops-chrome:// protocol
    }

    const protocolUrl = buildAdsOpsChromeProtocolUrl(targetUrl, browserProfileLabel, viaLabel, cleanProxy)
    const anchor = document.createElement('a')
    anchor.href = protocolUrl
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    setTimeout(() => {
      anchor.remove()
    }, 300)
  })()
}

export function downloadWindowsChromeLauncherBat(): void {
  const psScriptLines = [
    'param([string]$RawUri)',
    'if (-not $RawUri) { exit 0 }',
    'try {',
    '  $u = [System.Uri]$RawUri',
    '  $q = $u.Query.TrimStart("?")',
    '  $profileDir = "Default"',
    '  $targetUrl = ""',
    '  foreach ($pair in ($q -split "&")) {',
    '    if (-not $pair) { continue }',
    '    $kv = $pair -split "=", 2',
    '    $k = [System.Uri]::UnescapeDataString($kv[0].Replace("+", " "))',
    '    $v = if ($kv.Length -gt 1) { [System.Uri]::UnescapeDataString($kv[1].Replace("+", " ")) } else { "" }',
    '    if ($k -eq "profile" -and $v) { $profileDir = $v }',
    '    elseif ($k -eq "url" -and $v) { $targetUrl = $v }',
    '  }',
    '  if (-not ($targetUrl -match "^https://")) { exit 0 }',
    '  $chromePaths = @(',
    '    (Join-Path $env:ProgramFiles "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path ${env:ProgramFiles(x86)} "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path $env:LOCALAPPDATA "Google\\Chrome\\Application\\chrome.exe")',
    '  )',
    '  $chromeExe = $chromePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1',
    '  if ($chromeExe) {',
    '    Start-Process -FilePath $chromeExe -ArgumentList @("--profile-directory=$profileDir", $targetUrl)',
    '  } else {',
    '    Start-Process "chrome.exe" -ArgumentList @("--profile-directory=$profileDir", $targetUrl)',
    '  }',
    '} catch {}',
  ]

  const encodedPs = btoa(unescape(encodeURIComponent(psScriptLines.join('\r\n'))))

  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'set "ADSOPS_DIR=%LOCALAPPDATA%\\AdsOps"',
    'if not exist "%ADSOPS_DIR%" mkdir "%ADSOPS_DIR%"',
    'set "PS_FILE=%ADSOPS_DIR%\\open_chrome_profile.ps1"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%PS_FILE%', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPs}')))"`,
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /ve /d "URL:AdsOps Chrome Profile Launcher" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /v "URL Protocol" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"%PS_FILE%\\" \\"%%1\\"" /f >nul',
    'echo [THANH CONG] Da cai dat xong!',
    'pause',
  ].join('\r\n')

  const blob = new Blob([batContent], { type: 'application/bat;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'Cai-Dat-Mo-Chrome-Profile-AdsOps.bat'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function launchChromeWithExtensionPreview(
  targetUrl: string,
  browserProfileLabel?: string | null,
  identityLabel?: string | null,
  networkLabel?: string | null,
): void {
  const dir = resolveChromeProfileDirectory(browserProfileLabel, identityLabel)
  const nameParam = identityLabel ? `&name=${encodeURIComponent(identityLabel)}` : ''
  const proxyParam = networkLabel ? `&proxy=${encodeURIComponent(networkLabel)}` : ''
  const localBridgeUrl = `http://127.0.0.1:17890/open?profile=${encodeURIComponent(dir)}${nameParam}${proxyParam}&show_ext=1&url=${encodeURIComponent(targetUrl)}`

  fetch(localBridgeUrl, { method: 'GET', mode: 'cors' })
    .then((res) => {
      if (!res.ok) throw new Error('Bridge HTTP error')
    })
    .catch(() => {
      window.open(targetUrl, '_blank', 'noopener,noreferrer')
    })
}

export function downloadChromeExtensionPackageBat(
  viaName = 'Via Chính (AdsOps)',
  profileDir = 'Default',
  rawProxy = '',
): void {
  const parsed = parseProxyString(rawProxy)
  const host = parsed?.host ?? ''
  const port = parsed?.port ?? 8080
  const user = parsed?.user ?? ''
  const pass = parsed?.pass ?? ''
  const scheme = parsed?.scheme ?? 'http'
  const hasProxy = Boolean(host)

  const manifestObj = {
    version: '2.0.0',
    manifest_version: 3,
    name: hasProxy
      ? `AdsOps Companion · ${profileDir} · Proxy ${host}:${port}`
      : `AdsOps Companion · ${profileDir} (${viaName})`,
    description: 'Tiện ích hộ chiếu Via, tự động gắn Proxy & phím tắt kháng nghị/thanh toán Meta của AdsOps Control Center.',
    permissions: ['proxy', 'tabs', 'storage', 'webRequest', 'webRequestAuthProvider'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    action: {
      default_title: `AdsOps Hộ Chiếu Via (${viaName})`,
      default_popup: 'popup.html',
    },
  }

  let bgJs = `chrome.action.setBadgeText({ text: "${hasProxy ? 'PRX' : 'VIA'}" });
chrome.action.setBadgeBackgroundColor({ color: "${hasProxy ? '#16a34a' : '#2563eb'}" });
`
  if (hasProxy) {
    bgJs += `const proxyConfig = { mode: "fixed_servers", rules: { singleProxy: { scheme: "${scheme}", host: "${host}", port: ${port} }, bypassList: ["localhost", "127.0.0.1"] } };
chrome.proxy.settings.set({ value: proxyConfig, scope: "regular" }, () => {});
`
    if (user && pass) {
      bgJs += `chrome.webRequest.onAuthRequired.addListener(() => ({ authCredentials: { username: ${JSON.stringify(user)}, password: ${JSON.stringify(pass)} } }), { urls: ["<all_urls>"] }, ["blocking"]);
`
    }
  }

  const proxyDisplay = hasProxy
    ? `${scheme.toUpperCase()}://${host}:${port}${user ? ' (Tự động nạp User/Pass)' : ''}`
    : (rawProxy || 'Mạng trực tiếp (Chưa gắn Proxy)')

  const popupHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { width: 340px; background: #f8fafc; color: #0f172a; padding: 14px; }
  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #cbd5e1; padding-bottom: 10px; margin-bottom: 10px; }
  .brand { font-size: 13px; font-weight: 800; color: #0f172a; }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: #dcfce7; color: #166534; border: 1px solid #86efac; }
  .card { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
  .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #475569; }
  .val { font-size: 13px; font-weight: 700; color: #090d16; margin-top: 2px; }
  .sub { font-size: 11px; color: #334155; margin-top: 3px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 6px; margin-top: 6px; }
  .btn { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; font-size: 12px; font-weight: 600; text-decoration: none; }
  .btn:hover { background: #f1f5f9; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">🛡️ AdsOps Hộ Chiếu Via</div>
    <span class="badge">${hasProxy ? '🟢 ĐÃ BỌC PROXY' : '🔵 CHROME CỐ ĐỊNH'}</span>
  </div>
  <div class="card">
    <div class="label">Tài khoản Via & Hồ sơ Chrome</div>
    <div class="val">${viaName}</div>
    <div class="sub">📁 Thư mục Chrome: <strong>${profileDir}</strong></div>
  </div>
  <div class="card">
    <div class="label">Kết nối Mạng / Proxy</div>
    <div class="val" style="font-size:12px;">${proxyDisplay}</div>
  </div>
  <div class="label">Lối tắt xử lý nhanh Meta</div>
  <div class="grid">
    <a class="btn" href="https://business.facebook.com/accountquality" target="_blank"><span>🛡️ Chất lượng TK & Kháng nghị Meta</span><span>↗</span></a>
    <a class="btn" href="https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/" target="_blank"><span>💳 Thanh toán & Dư nợ (Billing)</span><span>↗</span></a>
    <a class="btn" href="https://business.facebook.com/settings" target="_blank"><span>🏢 Cài đặt Business Manager (BM)</span><span>↗</span></a>
    <a class="btn" href="https://adsmanager.facebook.com/adsmanager/manage/campaigns" target="_blank"><span>📊 Trình quản lý Quảng cáo</span><span>↗</span></a>
    <a class="btn" href="https://iphey.com/" target="_blank"><span>🔍 Kiểm tra độ sạch IP (Iphey)</span><span>↗</span></a>
  </div>
</body>
</html>`

  const b64Manifest = btoa(unescape(encodeURIComponent(JSON.stringify(manifestObj, null, 2))))
  const b64Bg = btoa(unescape(encodeURIComponent(bgJs)))
  const b64Popup = btoa(unescape(encodeURIComponent(popupHtml)))

  const batLines = [
    '@echo off',
    'chcp 65001 >nul',
    'set "EXT_DIR=%USERPROFILE%\Desktop\AdsOps_Tien_Ich_Chrome"',
    'if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%EXT_DIR%\manifest.json', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Manifest}')))"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%EXT_DIR%\background.js', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Bg}')))"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%EXT_DIR%\popup.html', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Popup}')))"`,
    'echo ==========================================================',
    'echo [THANH CONG] Da tao thu muc Tien ich Google Chrome tai:',
    'echo   %EXT_DIR%',
    'echo.',
    'echo Cach gan co dinh len Chrome (neu muon cai thu cong):',
    'echo   1. Mo Chrome -> nhap: chrome://extensions',
    'echo   2. Bat "Che do nha phat trien" (Developer mode) o goc phai',
    'echo   3. Bam "Tai tien ich da giai nen" (Load unpacked) -> Chon thu muc AdsOps_Tien_Ich_Chrome tren Desktop',
    'echo ==========================================================',
    'explorer "%EXT_DIR%"',
    'pause',
  ]

  const blob = new Blob([batLines.join('\r\n')], { type: 'application/bat;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'Cai-Dat-Tien-Ich-Chrome-AdsOps.bat'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
