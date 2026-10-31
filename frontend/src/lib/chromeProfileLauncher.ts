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

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function buildStoreZip(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder()
  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name)
    const dataBytes = encoder.encode(f.content)
    const crc = crc32(dataBytes)
    return { nameBytes, dataBytes, crc }
  })

  let offset = 0
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []

  for (const e of entries) {
    const localHeader = new Uint8Array(30 + e.nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 flag
    lv.setUint16(8, 0, true) // store
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x5421, true)
    lv.setUint32(14, e.crc, true)
    lv.setUint32(18, e.dataBytes.length, true)
    lv.setUint32(22, e.dataBytes.length, true)
    lv.setUint16(26, e.nameBytes.length, true)
    lv.setUint16(28, 0, true)
    localHeader.set(e.nameBytes, 30)
    localParts.push(localHeader, e.dataBytes)

    const centralHeader = new Uint8Array(46 + e.nameBytes.length)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x5421, true)
    cv.setUint32(16, e.crc, true)
    cv.setUint32(20, e.dataBytes.length, true)
    cv.setUint32(24, e.dataBytes.length, true)
    cv.setUint16(28, e.nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    centralHeader.set(e.nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + e.dataBytes.length
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  return new Blob([...localParts, ...centralParts, eocd] as unknown as BlobPart[], { type: 'application/zip' })
}

export function downloadChromeExtensionZip(
  viaName = 'Tài Khoản Chính (Via Tổng)',
  profileDir = 'Default',
  rawProxy = '',
): void {
  const parsed = parseProxyString(rawProxy)
  const hasProxy = Boolean(parsed?.host)

  const manifestObj = {
    manifest_version: 3,
    name: hasProxy
      ? `AdsOps Companion · ${profileDir} · Proxy ${parsed!.host}:${parsed!.port}`
      : `AdsOps Companion · ${profileDir} (${viaName})`,
    short_name: 'AdsOps Companion',
    version: '2.1.0',
    description:
      'Tiện ích chính thức của AdsOps Control Center: Định danh Hồ sơ Via, bọc Proxy IPv4 tự động đăng nhập, bắt nhanh ID BM/TKQC từ tab Facebook và mở lối tắt kháng nghị/thanh toán Meta.',
    permissions: ['proxy', 'storage', 'tabs', 'activeTab', 'webRequest', 'webRequestAuthProvider'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    action: {
      default_title: `AdsOps Companion (${viaName})`,
      default_popup: 'popup.html',
    },
  }

  const defaultStateJson = JSON.stringify({
    viaName,
    profileCode: profileDir,
    proxyRaw: parsed ? `${parsed.host}:${parsed.port}${parsed.user ? `:${parsed.user}:${parsed.pass}` : ''}` : '',
    proxyEnabled: hasProxy,
  })

  const backgroundJs = `const DEFAULT_STATE = ${defaultStateJson};
let currentAuth = { user: "", pass: "" };

function parseProxy(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const mAt = s.match(/^(?:(http|https|socks5):\/\/)?([^:\s]+):([^@\s]+)@(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/i);
  if (mAt) return { scheme: (mAt[1] || "http").toLowerCase(), user: mAt[2], pass: mAt[3], host: mAt[4], port: parseInt(mAt[5], 10) };
  const m4 = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5}):([^:\s]+):([^\s]+)/);
  if (m4) return { scheme: "http", host: m4[1], port: parseInt(m4[2], 10), user: m4[3], pass: m4[4] };
  const m2 = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/);
  if (m2) return { scheme: "http", host: m2[1], port: parseInt(m2[2], 10), user: "", pass: "" };
  return null;
}

function applyProxyState(state) {
  const enabled = Boolean(state && state.proxyEnabled);
  const parsed = enabled ? parseProxy(state.proxyRaw) : null;
  if (parsed) {
    currentAuth = { user: parsed.user || "", pass: parsed.pass || "" };
    const config = {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: parsed.scheme, host: parsed.host, port: parsed.port },
        bypassList: ["localhost", "127.0.0.1"]
      }
    };
    chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {});
    chrome.action.setBadgeText({ text: "PRX" });
    chrome.action.setBadgeBackgroundColor({ color: "#15803d" });
  } else {
    currentAuth = { user: "", pass: "" };
    chrome.proxy.settings.clear({ scope: "regular" }, () => {});
    const badge = (state && state.profileCode) ? String(state.profileCode).replace("Profile ", "P").slice(0, 4).toUpperCase() : "VIA";
    chrome.action.setBadgeText({ text: badge });
    chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["viaName", "profileCode", "proxyRaw", "proxyEnabled"], (res) => {
    const init = {
      viaName: res.viaName || DEFAULT_STATE.viaName,
      profileCode: res.profileCode || DEFAULT_STATE.profileCode,
      proxyRaw: res.proxyRaw !== undefined ? res.proxyRaw : DEFAULT_STATE.proxyRaw,
      proxyEnabled: res.proxyEnabled !== undefined ? Boolean(res.proxyEnabled) : DEFAULT_STATE.proxyEnabled
    };
    chrome.storage.local.set(init, () => applyProxyState(init));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    chrome.storage.local.get(["viaName", "profileCode", "proxyRaw", "proxyEnabled"], (res) => applyProxyState(res));
  }
});

chrome.webRequest.onAuthRequired.addListener(
  () => (currentAuth.user && currentAuth.pass ? { authCredentials: { username: currentAuth.user, password: currentAuth.pass } } : {}),
  { urls: ["<all_urls>"] },
  ["blocking"]
);
`

  const popupHtml = "<!DOCTYPE html>\n<html lang=\"vi\">\n<head>\n<meta charset=\"utf-8\" />\n<style>\n  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; }\n  body { width: 360px; background: #f8fafc; color: #090d16; padding: 14px; font-size: 12px; }\n  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid #cbd5e1; }\n  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 13px; color: #090d16; }\n  .logo { width: 22px; height: 22px; border-radius: 6px; background: #1d4ed8; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }\n  .status-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #93c5fd; background: #dbeafe; color: #1e40af; }\n  .status-pill.active { border-color: #86efac; background: #dcfce7; color: #166534; }\n  .card { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 10px; }\n  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }\n  .row { display: grid; grid-template-columns: 1fr 110px; gap: 6px; margin-bottom: 6px; }\n  input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 12px; color: #090d16; background: #fff; }\n  input:focus { outline: 2px solid #2563eb; border-color: transparent; }\n  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }\n  .btn-row { display: flex; gap: 6px; margin-top: 6px; }\n  .btn { flex: 1; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #090d16; font-weight: 600; font-size: 11px; cursor: pointer; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }\n  .btn:hover { background: #f1f5f9; }\n  .btn-primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }\n  .btn-primary:hover { background: #1e40af; }\n  .btn-success { background: #15803d; border-color: #15803d; color: #fff; }\n  .btn-danger { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }\n  .ip-bar { display: flex; align-items: center; justify-content: space-between; padding-top: 6px; margin-top: 6px; border-top: 1px dashed #e2e8f0; font-size: 11px; }\n  .ip-val { font-family: ui-monospace, Consolas, monospace; font-weight: 700; color: #0f766e; }\n  .detected-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 7px 8px; margin-bottom: 10px; font-size: 11px; display: none; }\n  .links { display: grid; grid-template-columns: 1fr; gap: 5px; }\n  .link-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 9px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #090d16; font-weight: 600; font-size: 11px; text-decoration: none; }\n  .link-item:hover { background: #f1f5f9; border-color: #94a3b8; }\n  .link-item.alert { background: #fef2f2; border-color: #fecaca; color: #991b1b; }\n  .link-item.bill { background: #eff6ff; border-color: #bfdbfe; color: #1e40af; }\n  .msg { font-size: 11px; color: #15803d; font-weight: 600; margin-top: 4px; display: none; }\n</style>\n</head>\n<body>\n  <div class=\"header\">\n    <div class=\"brand\">\n      <span class=\"logo\">AO</span>\n      <span>AdsOps Hộ Chiếu Via</span>\n    </div>\n    <span id=\"proxy-badge\" class=\"status-pill\">CHROME CỐ ĐỊNH</span>\n  </div>\n\n  <!-- Tự động nhận diện ID BM / TKQC từ tab Facebook đang mở -->\n  <div id=\"fb-detected\" class=\"detected-box\">\n    <div style=\"font-weight:700; color:#1e3a8a; margin-bottom:3px;\">Phát hiện ID Meta trên tab hiện tại:</div>\n    <div id=\"fb-detected-text\" class=\"mono\" style=\"color:#090d16; margin-bottom:5px;\"></div>\n    <div class=\"btn-row\" style=\"margin-top:0;\">\n      <button id=\"btn-copy-id\" class=\"btn btn-primary\" type=\"button\">Sao chép ID</button>\n      <a id=\"btn-open-dashboard\" class=\"btn\" href=\"https://adsops-app.vibe.tinhgon.xyz/business-managers\" target=\"_blank\">Đồng bộ trên Web ↗</a>\n    </div>\n  </div>\n\n  <!-- Khối 1: Định danh Via & Hồ sơ Chrome -->\n  <div class=\"card\">\n    <div class=\"section-title\">\n      <span>1. Định danh Via & Hồ sơ Chrome</span>\n      <span id=\"save-msg\" class=\"msg\">Đã lưu!</span>\n    </div>\n    <div class=\"row\">\n      <input id=\"via-name\" type=\"text\" placeholder=\"Tên Via (VD: Via Dự Phòng BM1)\" />\n      <input id=\"profile-code\" type=\"text\" class=\"mono\" placeholder=\"Profile 10\" />\n    </div>\n    <div class=\"section-title\" style=\"margin-top:8px;\">\n      <span>2. Cấu hình Proxy riêng (IP:Port:User:Pass)</span>\n    </div>\n    <input id=\"proxy-raw\" type=\"text\" class=\"mono\" placeholder=\"103.145.67.89:8080:user:pass (để trống nếu dùng mạng gốc)\" />\n    <div class=\"btn-row\">\n      <button id=\"btn-save-enable\" type=\"button\" class=\"btn btn-primary\">Lưu & Bật Proxy</button>\n      <button id=\"btn-disable-proxy\" type=\"button\" class=\"btn\">Tắt Proxy (Mạng gốc)</button>\n    </div>\n    <div class=\"ip-bar\">\n      <span>IP Public thực tế của Chrome này:</span>\n      <span id=\"live-ip\" class=\"ip-val\">Đang kiểm tra...</span>\n    </div>\n  </div>\n\n  <!-- Khối 2: Lối tắt xử lý sự cố Meta -->\n  <div class=\"section-title\">3. Lối tắt xử lý nhanh trên đúng Via này</div>\n  <div class=\"links\">\n    <a class=\"link-item alert\" href=\"https://business.facebook.com/accountquality\" target=\"_blank\">\n      <span>Chất lượng tài khoản & Kháng nghị Meta</span><span>↗</span>\n    </a>\n    <a class=\"link-item bill\" href=\"https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/\" target=\"_blank\">\n      <span>Thanh toán & Xử lý dư nợ (Billing)</span><span>↗</span>\n    </a>\n    <a class=\"link-item\" href=\"https://business.facebook.com/settings\" target=\"_blank\">\n      <span>Cài đặt Business Manager (BM Settings)</span><span>↗</span>\n    </a>\n    <a class=\"link-item\" href=\"https://adsmanager.facebook.com/adsmanager/manage/campaigns\" target=\"_blank\">\n      <span>Trình quản lý Quảng cáo (Ads Manager)</span><span>↗</span>\n    </a>\n    <a class=\"link-item\" href=\"https://adsops-app.vibe.tinhgon.xyz/\" target=\"_blank\">\n      <span>Mở Bảng điều khiển AdsOps Control Center</span><span>↗</span>\n    </a>\n  </div>\n\n  <script src=\"popup.js\"></script>\n</body>\n</html>"
  const popupJs = "// AdsOps Companion Extension v2.1 — Popup Controller\nconst viaInput = document.getElementById(\"via-name\");\nconst profileInput = document.getElementById(\"profile-code\");\nconst proxyInput = document.getElementById(\"proxy-raw\");\nconst badge = document.getElementById(\"proxy-badge\");\nconst saveMsg = document.getElementById(\"save-msg\");\nconst liveIp = document.getElementById(\"live-ip\");\n\nfunction refreshIp() {\n  if (!liveIp) return;\n  liveIp.textContent = \"Đang kiểm tra...\";\n  fetch(\"https://api.ipify.org?format=json\")\n    .then((r) => r.json())\n    .then((d) => {\n      if (d && d.ip) liveIp.textContent = d.ip;\n    })\n    .catch(() => {\n      liveIp.textContent = \"Không kết nối được\";\n    });\n}\n\nfunction updateBadge(enabled, raw) {\n  if (!badge) return;\n  if (enabled && raw && raw.trim()) {\n    badge.textContent = \"ĐANG BỌC PROXY\";\n    badge.className = \"status-pill active\";\n  } else {\n    badge.textContent = \"MẠNG TRỰC TIẾP\";\n    badge.className = \"status-pill\";\n  }\n}\n\nfunction flashSaved() {\n  if (!saveMsg) return;\n  saveMsg.style.display = \"inline\";\n  setTimeout(() => {\n    saveMsg.style.display = \"none\";\n  }, 1800);\n}\n\nif (typeof chrome !== \"undefined\" && chrome.storage && chrome.storage.local) {\n  chrome.storage.local.get([\"viaName\", \"profileCode\", \"proxyRaw\", \"proxyEnabled\"], (res) => {\n    if (viaInput) viaInput.value = res.viaName || \"Tài Khoản Chính (Via Tổng)\";\n    if (profileInput) profileInput.value = res.profileCode || \"Default\";\n    if (proxyInput) proxyInput.value = res.proxyRaw || \"\";\n    updateBadge(Boolean(res.proxyEnabled), res.proxyRaw || \"\");\n  });\n}\n\ndocument.getElementById(\"btn-save-enable\")?.addEventListener(\"click\", () => {\n  const raw = (proxyInput?.value || \"\").trim();\n  const state = {\n    viaName: (viaInput?.value || \"\").trim() || \"Via Facebook\",\n    profileCode: (profileInput?.value || \"\").trim() || \"Default\",\n    proxyRaw: raw,\n    proxyEnabled: Boolean(raw)\n  };\n  if (typeof chrome !== \"undefined\" && chrome.storage && chrome.storage.local) {\n    chrome.storage.local.set(state, () => {\n      updateBadge(state.proxyEnabled, state.proxyRaw);\n      flashSaved();\n      setTimeout(refreshIp, 600);\n    });\n  }\n});\n\ndocument.getElementById(\"btn-disable-proxy\")?.addEventListener(\"click\", () => {\n  const state = {\n    viaName: (viaInput?.value || \"\").trim() || \"Via Facebook\",\n    profileCode: (profileInput?.value || \"\").trim() || \"Default\",\n    proxyRaw: (proxyInput?.value || \"\").trim(),\n    proxyEnabled: false\n  };\n  if (typeof chrome !== \"undefined\" && chrome.storage && chrome.storage.local) {\n    chrome.storage.local.set(state, () => {\n      updateBadge(false, \"\");\n      flashSaved();\n      setTimeout(refreshIp, 600);\n    });\n  }\n});\n\n// Detect active Facebook / Meta tab for act_id or business_id\nif (typeof chrome !== \"undefined\" && chrome.tabs && chrome.tabs.query) {\n  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {\n    const url = tabs?.[0]?.url || \"\";\n    const actMatch = url.match(/(?:act=|act_)(\\d{6,25})/i);\n    const bmMatch = url.match(/business_id=(\\d{6,25})/i);\n    if (actMatch || bmMatch) {\n      const box = document.getElementById(\"fb-detected\");\n      const txt = document.getElementById(\"fb-detected-text\");\n      const copyBtn = document.getElementById(\"btn-copy-id\");\n      const parts = [];\n      const primaryId = actMatch ? actMatch[1] : bmMatch[1];\n      if (bmMatch) parts.push(\"BM ID: \" + bmMatch[1]);\n      if (actMatch) parts.push(\"TKQC ID: \" + actMatch[1]);\n      if (box && txt) {\n        txt.textContent = parts.join(\" · \");\n        box.style.display = \"block\";\n      }\n      copyBtn?.addEventListener(\"click\", () => {\n        navigator.clipboard.writeText(primaryId);\n        copyBtn.textContent = \"Đã chép: \" + primaryId;\n      });\n    }\n  });\n}\n\nrefreshIp();"
  const readmeTxt = [
    'HƯỚNG DẪN CÀI ĐẶT TIỆN ÍCH GOOGLE CHROME (ADSOPS COMPANION v2.1)',
    '================================================================',
    'Bước 1: Giải nén file .zip này ra một thư mục cố định (ví dụ: Desktop\AdsOps-Chrome-Extension).',
    'Bước 2: Mở trình duyệt Google Chrome của Via -> gõ vào thanh địa chỉ: chrome://extensions',
    'Bước 3: Bật công tắc "Chế độ dành cho nhà phát triển" (Developer mode) ở góc trên bên phải.',
    'Bước 4: Bấm nút "Tải tiện ích đã giải nén" (Load unpacked) ở góc trên bên trái -> Chọn thư mục vừa giải nén.',
    'Bước 5: Bấm biểu tượng mảnh ghép trên góc phải Chrome -> Bấm nút Ghim (Pin) cạnh "AdsOps Companion".',
  ].join('\r\n')

  const slug = profileDir.replace(/[^a-zA-Z0-9_-]/g, '-')
  const zipBlob = buildStoreZip([
    { name: 'AdsOps-Chrome-Extension/manifest.json', content: JSON.stringify(manifestObj, null, 2) },
    { name: 'AdsOps-Chrome-Extension/background.js', content: backgroundJs },
    { name: 'AdsOps-Chrome-Extension/popup.html', content: popupHtml },
    { name: 'AdsOps-Chrome-Extension/popup.js', content: popupJs },
    { name: 'AdsOps-Chrome-Extension/HUONG-DAN-CAI-DAT.txt', content: readmeTxt },
  ])

  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Chrome-Extension-${slug}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const downloadChromeExtensionPackageBat = downloadChromeExtensionZip
