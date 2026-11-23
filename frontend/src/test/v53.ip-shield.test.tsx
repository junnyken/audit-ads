import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { AuthProvider } from '../hooks/useAuth'
import { I18nProvider } from '../i18n'
import { api, setToken } from '../lib/api'
import { hydrateExtensionFilesLocally } from '../lib/chromeProfileLauncher'
import Login from '../pages/Login'
import Settings from '../pages/Settings'
import { ThemeProvider } from '../theme/ThemeProvider'

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <AuthProvider>{ui}</AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('v5.3 Core IP Protection & Stealth Gate Frontend', () => {
  it('renders Stealth Executive Gate on /login with zero .zip buttons, zero leaked operational ratios, and passes axe', async () => {
    const { container } = renderWithProviders(<Login />)

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    const html = container.textContent ?? ''

    // Zero .zip extension / installer triggers exposed on public landing page
    expect(screen.queryByRole('button', { name: /\.zip/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /\.zip/i })).not.toBeInTheDocument()
    expect(container.querySelectorAll('a[href*="/downloads/"]').length).toBe(0)

    // Zero leaked internal operational formulas / tactics
    for (const leaked of ['1 : 1 : 1', '1:1:1', '≤ 3 TKQC', '5%–15%', '5%–10%', '20–500+', '100–500+', 'Tier-1', 'Passkey', '72h']) {
      expect(html).not.toContain(leaked)
    }

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('renders Super-Admin Canary Leak Forensics in Settings, traces issuer via /verify-canary, and passes axe', async () => {
    setToken('jwt-super-admin-v53')
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/auth/me')) {
        return Promise.resolve({
          id: 'u-admin',
          email: 'superadmin@gmail.com',
          full_name: 'Platform Super Admin',
          role: 'owner',
          is_platform_admin: true,
          email_verified: true,
          workspace: { id: 'ws-admin', name: 'Platform HQ', slug: 'hq' },
        })
      }
      if (path.includes('/community/admin/overview')) {
        return Promise.resolve({
          require_invite_code: true,
          db_email_guard_status: 'ok',
          total_workspaces: 2,
          active_workspaces: 2,
          invite_codes_count: 1,
          workspaces: [],
        })
      }
      if (path.includes('/community/admin/invite-codes')) return Promise.resolve([])
      if (path.includes('/community/admin/email-allowlist')) {
        return Promise.resolve({ db_email_guard_status: 'ok', items: [] })
      }
      if (path.includes('/meta-reader-credentials')) {
        return Promise.resolve({ configured: false, business_managers_count: 0, items: [] })
      }
      if (path.includes('/me/reveal-pin')) {
        return Promise.resolve({ configured: false, locked: false, attempts_remaining: 5 })
      }
      if (path.includes('/notification-policies/current')) {
        return Promise.resolve({
          enabled: false,
          timezone: 'Asia/Ho_Chi_Minh',
          quiet_hours_enabled: false,
          quiet_hours_start: '23:00:00',
          quiet_hours_end: '07:00:00',
          critical_bypasses_quiet_hours: true,
          warning_telegram_enabled: false,
          attention_telegram_enabled: false,
          reminder_enabled: false,
          reminder_interval_hours: 24,
          telegram_chat_id_masked: null,
          telegram_configured: false,
        })
      }
      if (path.includes('/automation-cron/status')) {
        return Promise.resolve({
          auto_meta_sync_enabled: false,
          sync_interval_minutes: 60,
          auto_page_warmup_enabled: false,
          warmup_min_gap_hours: 8,
        })
      }
      if (path.includes('/ai-studio/config')) {
        return Promise.resolve({
          enabled: false,
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          key_configured: false,
          key_mask: '',
          available_models: { gemini: 'gemini-2.0-flash' },
          updated_at: null,
        })
      }
      if (path.includes('/domain-seo/config')) {
        return Promise.resolve({
          custom_domain: '',
          cors_trusted: false,
          effective_public_url: 'https://adsops.example.com',
          default_env_cors_count: 1,
          updated_at: null,
          seo_checklist: [],
        })
      }
      if (path.includes('/telegram-bot/config')) {
        return Promise.resolve({ enabled: false, configured: false, bot_token_masked: '', chat_id_masked: '' })
      }
      if (path.includes('/community/my-quota')) {
        return Promise.resolve({
          plan_tier: 'agency',
          vias_used: 0,
          max_vias: 500,
          ad_accounts_used: 0,
          max_ad_accounts: 500,
          members_used: 1,
          max_members: 25,
        })
      }
      return Promise.resolve([])
    })

    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      found: true,
      canary_id: 'CNRY-69a12b-fedcba9876543210',
      hmac_verified: true,
      workspace_id: 'ws-leaker',
      workspace_name: 'Agency Leaker Ltd',
      user_id: 'u-leaker',
      user_email: 'leaker@gmail.com',
      action: 'security.extension_bundle_issued',
      plan_tier: 'pro',
      message: 'Xác thực chữ ký Canary hợp lệ — đã định danh nguồn cấp phát.',
    })

    const { container } = renderWithProviders(<Settings />)
    const canaryInput = await screen.findByLabelText(/Nội dung hoặc mã Canary cần truy vết/i)
    await userEvent.type(canaryInput, 'CNRY-69a12b-fedcba9876543210')

    const lookupBtn = screen.getByRole('button', { name: /Tra cứu Thủ phạm/i })
    await userEvent.click(lookupBtn)

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/v1/community/admin/verify-canary', {
        text: 'CNRY-69a12b-fedcba9876543210',
      })
    })
    expect(await screen.findByText(/Agency Leaker Ltd/)).toBeInTheDocument()
    expect(screen.getByText(/leaker@gmail.com/)).toBeInTheDocument()

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('hydrates proxy auth, 2FA TOTP secret, and local bridge token exclusively inside client RAM', () => {
    const serverFiles = [
      {
        name: 'AdsOps-Ext/manifest.json',
        content: '{"name":"__ADSOPS_MANIFEST_NAME__","version_name":"2.11.0 (CNRY-abc)"}',
      },
      {
        name: 'AdsOps-Ext/background.js',
        content:
          '/* CNRY-abc */\nconst DEFAULT_STATE={"proxyRaw":"__ADSOPS_PROXY_RAW_JSON__","proxyEnabled":"__ADSOPS_PROXY_ENABLED_BOOL__","twoFaSecret":"__ADSOPS_TOTP_SECRET_JSON__","bridgeToken":"__ADSOPS_BRIDGE_TOKEN_JSON__"};',
      },
      {
        name: 'AdsOps-Ext/popup.js',
        content: 'const META={"twoFaSecret":"__ADSOPS_TOTP_SECRET_JSON__","bridgeToken":"__ADSOPS_BRIDGE_TOKEN_JSON__"};',
      },
    ]

    const hydrated = hydrateExtensionFilesLocally(serverFiles, {
      viaName: 'Via Camp #1',
      profileDir: 'Profile 5',
      rawProxy: '103.11.22.33:8080:proxyuser:proxypass',
      twoFaSecret: 'JBSWY3DPEHPK3PXP',
      bridgeToken: 'local-bridge-tok-99',
    })

    const byName = new Map(hydrated.map((f) => [f.name, String(f.content)]))
    expect(byName.get('AdsOps-Ext/manifest.json')).toContain('Proxy 103.11.22.33:8080')
    expect(byName.get('AdsOps-Ext/manifest.json')).toContain('Profile 5')

    const bg = byName.get('AdsOps-Ext/background.js') ?? ''
    expect(bg).toContain('103.11.22.33:8080:proxyuser:proxypass')
    expect(bg).toContain('"proxyEnabled":true')
    expect(bg).toContain('JBSWY3DPEHPK3PXP')
    expect(bg).toContain('local-bridge-tok-99')
    expect(bg).not.toContain('__ADSOPS_')

    const popup = byName.get('AdsOps-Ext/popup.js') ?? ''
    expect(popup).toContain('JBSWY3DPEHPK3PXP')
    expect(popup).toContain('local-bridge-tok-99')
  })
})
