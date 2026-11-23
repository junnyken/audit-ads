import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Layers,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Field } from '../components/ui'
import { TooltipProvider } from '../components/primitives/tooltip'
import { BrandMark } from '../components/shell/BrandMark'
import { LanguageToggle } from '../components/shell/LanguageToggle'
import { ThemeToggle } from '../components/shell/ThemeToggle'
import { useI18n } from '../i18n'
import { api, ApiError } from '../lib/api'

export function normalizeCanonicalEmail(raw: string): string {
  const clean = (raw || '').trim().toLowerCase()
  const atIdx = clean.lastIndexOf('@')
  if (atIdx <= 0) return clean
  let localPart = clean.slice(0, atIdx)
  let domain = clean.slice(atIdx + 1).replace(/\.+$/, '')
  if ((domain === 'gmail.com' || domain === 'googlemail.com') && !localPart.includes('+')) {
    localPart = localPart.replace(/\./g, '')
    domain = 'gmail.com'
  }
  return `${localPart}@${domain}`
}

export default function Login() {
  const { signIn, registerAccount } = useAuth()
  const { t, language } = useI18n()
  const isEn = language === 'en'
  const initialResetToken =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('reset_token') ?? '' : ''
  const initialVerifyToken =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('verify_token') ?? '' : ''
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(
    initialResetToken.trim().length > 0 ? 'reset' : 'login',
  )
  const [resetToken, setResetToken] = useState(initialResetToken)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [infoNotice, setInfoNotice] = useState<string | null>(null)
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null)
  const [resendBusy, setResendBusy] = useState(false)
  const verifyAttemptedRef = useRef(false)
  const [email, setEmail] = useState('')
  const [precheckResult, setPrecheckResult] = useState<{
    ok: boolean
    reason?: string | null
    message?: string | null
  } | null>(null)
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [captchaCode, setCaptchaCode] = useState('')
  const [mathAnswer, setMathAnswer] = useState('')
  const [humanConfirmed, setHumanConfirmed] = useState(false)
  const [websiteHoneypot, setWebsiteHoneypot] = useState('')
  const [challenge, setChallenge] = useState<{
    challenge_token: string
    captcha_svg: string
    math_question: string
    turnstile_enabled?: boolean
    turnstile_site_key?: string
  } | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null)
  const [loadingChallenge, setLoadingChallenge] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadBotChallenge = useCallback(async () => {
    setLoadingChallenge(true)
    try {
      const res = await api.get<{
        challenge_token: string
        captcha_svg: string
        math_question: string
        turnstile_enabled?: boolean
        turnstile_site_key?: string
      }>('/api/v1/auth/bot-challenge')
      setChallenge(res)
      setCaptchaCode('')
      setMathAnswer('')
    } catch {
      /* ignore network hiccup until retry */
    } finally {
      setLoadingChallenge(false)
    }
  }, [])

  useEffect(() => {
    if (authMode === 'register' && !challenge) {
      void loadBotChallenge()
    }
  }, [authMode, challenge, loadBotChallenge])

  useEffect(() => {
    const token = initialVerifyToken.trim()
    if (!token || verifyAttemptedRef.current) return
    verifyAttemptedRef.current = true
    void (async () => {
      try {
        await api.post('/api/v1/auth/verify-email', { token })
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, '', window.location.pathname)
        }
        setAuthMode('login')
        setInfoNotice(
          isEn
            ? 'Email verified successfully. You can sign in to your Workspace now.'
            : 'Xác nhận địa chỉ email thành công. Bạn có thể đăng nhập vào Workspace ngay.',
        )
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : isEn
              ? 'Email verification link is invalid or expired.'
              : 'Liên kết xác nhận email không hợp lệ hoặc đã hết hạn.',
        )
      }
    })()
  }, [initialVerifyToken, isEn])

  const effectiveTurnstileKey = (
    ((import.meta.env as Record<string, string | undefined>).VITE_TURNSTILE_SITE_KEY ?? '').trim() ||
    (challenge?.turnstile_enabled ? challenge.turnstile_site_key?.trim() ?? '' : '')
  )

  useEffect(() => {
    if (!effectiveTurnstileKey || authMode === 'reset') {
      setTurnstileToken('')
      return
    }
    let widgetId: string | null = null
    let cancelled = false
    const w = window as unknown as {
      turnstile?: {
        render: (el: HTMLElement, opts: Record<string, unknown>) => string
        remove?: (id: string) => void
      }
    }
    const mountWidget = () => {
      if (cancelled || !turnstileContainerRef.current || !w.turnstile) return
      turnstileContainerRef.current.innerHTML = ''
      widgetId = w.turnstile.render(turnstileContainerRef.current, {
        sitekey: effectiveTurnstileKey,
        callback: (tok: string) => setTurnstileToken(tok),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      })
    }
    if (w.turnstile) {
      mountWidget()
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-adsops-turnstile="1"]')
      if (existing) {
        existing.addEventListener('load', mountWidget, { once: true })
      } else {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.dataset.adsopsTurnstile = '1'
        script.onload = mountWidget
        document.head.appendChild(script)
      }
    }
    return () => {
      cancelled = true
      if (widgetId && w.turnstile?.remove) {
        w.turnstile.remove(widgetId)
      }
    }
  }, [effectiveTurnstileKey, authMode])

  const precheckEmailOnBlur = useCallback(async () => {
    if (authMode !== 'register') return
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@')) return
    const domainPart = trimmed.split('@').pop() ?? ''
    if (!domainPart.includes('.')) return
    try {
      const res = await api.post<{ ok: boolean; reason?: string | null; message?: string | null }>(
        '/api/v1/auth/precheck-signup',
        { email: normalizeCanonicalEmail(trimmed) },
      )
      setPrecheckResult(res)
    } catch {
      /* fail-open if transient precheck network error */
      setPrecheckResult(null)
    }
  }, [authMode, email])

  const handleResendVerification = useCallback(async () => {
    if (!pendingVerifyEmail) return
    setResendBusy(true)
    setError(null)
    try {
      const res = await api.post<{ status: string; message?: string }>('/api/v1/auth/resend-verification', {
        email: pendingVerifyEmail,
      })
      setInfoNotice(
        res?.message ||
          (isEn
            ? 'A new verification email has been dispatched (valid 24h).'
            : 'Liên kết xác nhận email mới đã được gửi lại (hiệu lực 24 giờ).'),
      )
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : isEn
            ? 'Could not resend verification email right now.'
            : 'Chưa thể gửi lại email xác nhận lúc này.',
      )
    } finally {
      setResendBusy(false)
    }
  }, [pendingVerifyEmail, isEn])

  const emailCheckStatus = useMemo(() => {
    const raw = email.trim().toLowerCase()
    if (!raw || !raw.includes('@')) return null
    const atIdx = raw.lastIndexOf('@')
    const localPart = raw.slice(0, atIdx)
    const domain = raw.slice(atIdx + 1).replace(/\.+$/, '')
    if (!localPart || !domain) return null
    if (localPart.includes('+')) {
      return {
        ok: false,
        msg: isEn
          ? 'Plus (+) email aliases are blocked to prevent multi-account spam.'
          : 'Chặn email phụ chứa dấu "+" (alias) để chống tạo tài khoản ảo hàng loạt.',
      }
    }
    const canonical = normalizeCanonicalEmail(raw)
    const canonLocal = canonical.slice(0, canonical.lastIndexOf('@'))
    if (localPart.length < 3 || /^\d+$/.test(localPart) || canonLocal.length < 3 || /^\d+$/.test(canonLocal)) {
      return {
        ok: false,
        msg: isEn
          ? 'Email username must be at least 3 characters (excluding Gmail dots) and not pure digits.'
          : 'Tên email trước dấu @ phải từ 3 ký tự hợp lệ (không tính dấu chấm Gmail) và không được chỉ gồm chữ số.',
      }
    }
    const disposableKeywords = [
      'tempmail',
      'temp-mail',
      '10minutemail',
      'guerrillamail',
      'mailinator',
      'yopmail',
      'trashmail',
      'throwaway',
      'fakeinbox',
      'fakemail',
      'burnermail',
      'sharklasers',
      'getnada',
      'mohmal',
      'maildrop',
      'dispostable',
      'mailnesia',
      'qq.com',
      '163.com',
      'mail.ru',
    ]
    if (disposableKeywords.some((kw) => domain.includes(kw))) {
      return {
        ok: false,
        msg: isEn
          ? `Blocked disposable/temporary email domain (@${domain}). Use Gmail, Outlook, iCloud, Yahoo, Proton, or a verified .vn corporate email.`
          : `Chặn tên miền email ảo / tạm thời (@${domain}). Vui lòng dùng Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton hoặc email doanh nghiệp .vn.`,
      }
    }
    const trustedExact = new Set([
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'msn.com',
      'outlook.com.vn',
      'hotmail.com.vn',
      'live.com.vn',
      'icloud.com',
      'me.com',
      'mac.com',
      'yahoo.com',
      'yahoo.com.vn',
      'ymail.com',
      'proton.me',
      'protonmail.com',
      'pm.me',
      'zoho.com',
      'zohomail.com',
      'yandex.com',
      'gmx.com',
      'aol.com',
      'matbao.com',
      'matbao.net',
      'tbsupellex.com',
      'fpt.com',
      'fpt.com.vn',
      'viettel.com.vn',
      'vnpt.vn',
      'vng.com.vn',
      'cmc.com.vn',
    ])
    const vnSuffixes = ['.com.vn', '.net.vn', '.org.vn', '.edu.vn', '.gov.vn', '.vn']
    const isTrusted =
      trustedExact.has(domain) ||
      vnSuffixes.some((s) => domain.endsWith(s) && domain.length > s.length + 2)
    if (!isTrusted) {
      return {
        ok: false,
        msg: isEn
          ? `Untrusted domain (@${domain}). Only reputable providers (Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton, Zoho) or verified .vn corporate domains are allowed.`
          : `Tên miền (@${domain}) không nằm trong danh sách nhà cung cấp uy tín. Chỉ chấp nhận Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton, Zoho hoặc tên miền doanh nghiệp .vn.`,
      }
    }
    return {
      ok: true,
      msg: isEn
        ? `✓ Verified reputable email provider (@${domain}) — eligible for isolated Workspace registration.`
        : `✓ Email chính thống uy tín (@${domain}) — đủ điều kiện khởi tạo Không gian làm việc (Workspace) độc lập.`,
    }
  }, [email, isEn])

  const effectiveEmailStatus = useMemo(() => {
    if (precheckResult) {
      if (!precheckResult.ok) {
        return { ok: false, msg: precheckResult.message ?? (emailCheckStatus?.msg || '') }
      }
      return {
        ok: true,
        msg:
          precheckResult.message ||
          (emailCheckStatus?.ok
            ? emailCheckStatus.msg
            : isEn
              ? '✓ Verified / allowlisted email — eligible for Workspace registration.'
              : '✓ Email hợp lệ / nằm trong Allowlist — đủ điều kiện khởi tạo Workspace.'),
      }
    }
    return emailCheckStatus
  }, [emailCheckStatus, isEn, precheckResult])

  const currentHost =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'adsops-app.vibe.tinhgon.xyz'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setInfoNotice(null)
    try {
      if (authMode === 'login') {
        await signIn(normalizeCanonicalEmail(email), password, turnstileToken || undefined)
      } else if (authMode === 'forgot') {
        const canonical = normalizeCanonicalEmail(email)
        const res = await api.post<{ status: string; message?: string }>('/api/v1/auth/forgot-password', {
          email: canonical,
          ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
        })
        setInfoNotice(
          res?.message ||
            (isEn
              ? 'If this email is registered, password reset instructions have been sent (valid 30m). If SMTP is not configured on this workspace, ask your Super-Admin for a 1-time reset link.'
              : 'Nếu email đã đăng ký trên hệ thống, hướng dẫn đặt lại mật khẩu đã được tạo (hiệu lực 30 phút). Nếu máy chủ chưa bật SMTP, vui lòng liên hệ Quản trị viên để nhận link reset 1 lần.'),
        )
      } else if (authMode === 'reset') {
        if (!resetToken.trim()) {
          throw new Error(
            isEn
              ? 'Missing or invalid password reset token in URL.'
              : 'Liên kết đặt lại mật khẩu thiếu mã xác thực.',
          )
        }
        if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
          throw new Error(
            isEn
              ? 'New password must be at least 8 characters and include uppercase, lowercase, and a digit.'
              : 'Mật khẩu mới phải từ 8 ký tự, gồm chữ Hoa, chữ thường và chữ số.',
          )
        }
        if (password !== confirmPassword) {
          throw new Error(
            isEn ? 'Confirmation password does not match.' : 'Mật khẩu xác nhận chưa trùng khớp.',
          )
        }
        await api.post('/api/v1/auth/reset-password', {
          token: resetToken.trim(),
          new_password: password,
        })
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, '', window.location.pathname)
        }
        setResetToken('')
        setPassword('')
        setConfirmPassword('')
        setAuthMode('login')
        setInfoNotice(
          isEn
            ? 'Password updated cleanly. All older device sessions were signed out — please sign in with your new password.'
            : 'Đổi mật khẩu thành công. Toàn bộ phiên đăng nhập cũ đã được đăng xuất — vui lòng đăng nhập lại bằng mật khẩu mới.',
        )
      } else {
        if (!challenge?.challenge_token) {
          await loadBotChallenge()
          throw new Error(
            isEn
              ? 'Please complete the anti-bot security challenge.'
              : 'Vui lòng nhập mã xác thực chống Bot.',
          )
        }
        const canonicalEmail = normalizeCanonicalEmail(email)
        const regRes = await registerAccount({
          full_name: fullName.trim(),
          workspace_name: workspaceName.trim(),
          email: canonicalEmail,
          password,
          challenge_token: challenge.challenge_token,
          captcha_code: captchaCode.trim(),
          math_answer: mathAnswer.trim(),
          human_confirmed: humanConfirmed,
          website_honeypot: websiteHoneypot,
          invite_code: inviteCode.trim() ? inviteCode.trim().toUpperCase() : undefined,
          ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
        })
        if (regRes && regRes.verificationRequired) {
          setPendingVerifyEmail(canonicalEmail)
          setPassword('')
          setCaptchaCode('')
          setMathAnswer('')
          setHumanConfirmed(false)
          setAuthMode('login')
          setInfoNotice(
            isEn
              ? `Account created! Please check ${canonicalEmail} and click the verification link (valid 24h) before signing in.`
              : `Tài khoản đã được tạo! Vui lòng kiểm tra hộp thư ${canonicalEmail} và nhấn vào liên kết xác nhận (hiệu lực 24 giờ) trước khi đăng nhập.`,
          )
        }
      }
    } catch (caught) {
      if (authMode === 'register') {
        void loadBotChallenge()
      }
      const msg =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : t('login.failed')
      if (authMode === 'login' && msg.includes('xác nhận địa chỉ email')) {
        setPendingVerifyEmail(normalizeCanonicalEmail(email))
      }
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const stealthPillars = [
    {
      icon: Layers,
      title: isEn ? 'Unified Multi-Workspace Governance' : 'Điều phối Đa Không gian Làm việc',
      desc: isEn
        ? 'Strictly partitioned tenant boundaries with structured asset directories, cross-team billing workflows, and central ledger exports.'
        : 'Cô lập ranh giới dữ liệu giữa các đơn vị vận hành với danh mục tài sản thống nhất và báo cáo đối soát tập trung.',
    },
    {
      icon: ShieldCheck,
      title: isEn ? 'Role-Scoped Operational Controls' : 'Kiểm soát Thao tác theo Vai trò',
      desc: isEn
        ? 'Least-privilege RBAC seats across Owner, Admin, Operator, and Viewer roles with real-time execution audit logs.'
        : 'Phân quyền chi tiết theo vai trò Quản trị, Vận hành và Giám sát kèm nhật ký kiểm toán thao tác thời gian thực.',
    },
    {
      icon: Lock,
      title: isEn ? 'Zero-Trust Vault & Audit Compliance' : 'Kho Khóa Zero-Trust & Tuân thủ',
      desc: isEn
        ? 'Hardware-grade encryption at rest, per-device revocable sessions, and signed access tickets for internal operator tools.'
        : 'Mã hóa lưu trữ chuẩn doanh nghiệp, quản lý thu hồi phiên theo thiết bị và cấp quyền tải công cụ nội bộ có chữ ký số.',
    },
  ]

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-surface-muted text-ink">
        {/* STICKY STEALTH GATE HEADER */}
        <header className="sticky top-0 z-30 border-b border-line/85 bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <a href="#top" className="focus:outline-none">
                <BrandMark />
              </a>
              <nav
                aria-label={isEn ? 'Primary website navigation' : 'Điều hướng trang chủ'}
                className="hidden sm:flex items-center gap-5 text-xs font-semibold text-ink-muted"
              >
                <a href="#overview" className="hover:text-ink transition-colors">
                  {isEn ? 'Overview' : 'Tổng quan'}
                </a>
                <a href="#security" className="hover:text-ink transition-colors">
                  {isEn ? 'Security & Compliance' : 'Bảo mật & Tuân thủ'}
                </a>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle />
            </div>
          </div>
        </header>

        <main id="top" className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* SECTION 1: STEALTH EXECUTIVE GATE & LOGIN PORTAL */}
          <section
            id="overview"
            className="grid items-center gap-10 py-10 lg:grid-cols-12 lg:py-14 border-b border-line"
          >
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-brand/35 bg-brand-light/45 px-3.5 py-1 text-xs font-semibold text-brand-text">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'Private Enterprise Governance Portal · Invite-Only Provisioning'
                    : 'Cổng Điều hành Doanh nghiệp Độc quyền · Cấp quyền qua Mã mời'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.18]">
                {isEn
                  ? 'Unified governance, audit readiness, and financial settlement for multi-team media operations'
                  : 'Kiểm soát vận hành tập trung, tuân thủ kiểm toán và đối soát tài chính cho đội ngũ quảng cáo chuyên nghiệp'}
              </h1>

              <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
                {isEn ? (
                  <>
                    <strong className="font-semibold text-ink">AdsOps Control Center</strong> provides authorized agency teams with a private multi-tenant workspace for portfolio oversight, policy governance, and encrypted credential management.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-ink">AdsOps Control Center</strong> cung cấp không gian làm việc cô lập cho các đội ngũ được cấp phép nhằm điều phối danh mục tài khoản, kiểm soát tuân thủ chính sách và bảo vệ thông tin xác thực nội bộ.
                  </>
                )}
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                {stealthPillars.map((pillar, idx) => {
                  const Icon = pillar.icon
                  return (
                    <article
                      key={idx}
                      className="rounded-xl border border-line bg-surface p-4 space-y-2"
                    >
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light text-brand-text">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <h2 className="text-xs font-bold text-ink leading-snug">{pillar.title}</h2>
                      <p className="text-xs text-ink-muted leading-relaxed">{pillar.desc}</p>
                    </article>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-muted">
                <span>
                  {isEn
                    ? 'Access restricted to verified enterprise workspaces. Companion software and runtime tools are provisioned inside authenticated sessions only.'
                    : 'Quyền truy cập chỉ mở cho các không gian làm việc được phê duyệt. Gói phần mềm và công cụ nội bộ chỉ được cấp phát sau khi đăng nhập hợp lệ.'}
                </span>
                <a
                  href="#security"
                  className="btn-secondary shrink-0 px-3.5 py-2 text-xs"
                >
                  <span>{isEn ? 'Security Architecture' : 'Kiến trúc Bảo mật'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* LOGIN & REGISTRATION PORTAL CARD */}
            <aside className="lg:col-span-5" aria-label={isEn ? 'Operator sign in & registration' : 'Đăng nhập & Đăng ký quản trị'}>
              <div className="card border-line-strong/85 p-6 sm:p-7">
                <div className="mb-4 flex items-center justify-between border-b border-line pb-3.5">
                  <BrandMark />
                  <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tone-positive">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {isEn ? 'Multi-Tenant Isolated' : 'Tách bạch Dữ liệu 100%'}
                  </span>
                </div>

                {/* DUAL TAB SWITCHER: LOGIN vs REGISTER */}
                <div className="mb-4 grid grid-cols-2 rounded-lg border border-line bg-surface-sunken p-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login')
                      setError(null)
                      setInfoNotice(null)
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md py-2 transition-all ${
                      authMode === 'login' || authMode === 'forgot' || authMode === 'reset'
                        ? 'bg-surface text-ink shadow-xs border border-line/80'
                        : 'text-ink-muted hover:text-ink border border-transparent'
                    }`}
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isEn ? 'Sign In' : 'Đăng nhập Quản trị'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register')
                      setError(null)
                      setInfoNotice(null)
                      void loadBotChallenge()
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md py-2 transition-all ${
                      authMode === 'register'
                        ? 'bg-surface text-ink shadow-xs border border-line/80'
                        : 'text-ink-muted hover:text-ink border border-transparent'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isEn ? 'Create Agency Account' : 'Đăng ký Tài khoản'}</span>
                  </button>
                </div>

                {authMode === 'login' ? (
                  <>
                    <h2 className="text-base font-bold text-ink">
                      {isEn ? 'Sign in to Agency Control Center' : 'Đăng nhập Bảng điều khiển Quản trị'}
                    </h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {isEn
                        ? 'Protected by PBKDF2-SHA256, Fernet AES-128 Vault & Device Session Registry.'
                        : 'Bảo vệ bởi mã hóa Fernet AES-128, PBKDF2-SHA256 & Kiểm soát phiên theo thiết bị.'}
                    </p>
                  </>
                ) : authMode === 'forgot' ? (
                  <>
                    <h2 className="text-base font-bold text-ink">
                      {isEn ? 'Recover Account Password' : 'Khôi phục Mật khẩu Đăng nhập'}
                    </h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {isEn
                        ? 'Enter your registered email to receive a 30-minute one-time password reset link.'
                        : 'Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu 1 lần (hiệu lực 30 phút).'}
                    </p>
                  </>
                ) : authMode === 'reset' ? (
                  <>
                    <h2 className="text-base font-bold text-ink">
                      {isEn ? 'Set a New Strong Password' : 'Đặt Lại Mật khẩu Mới'}
                    </h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {isEn
                        ? 'All existing device sessions will be signed out immediately once you update your password.'
                        : 'Mọi phiên đăng nhập trên các thiết bị cũ sẽ bị thu hồi ngay sau khi bạn đổi mật khẩu.'}
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg border border-brand/30 bg-brand-light/20 p-3 space-y-1">
                    <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-brand-text shrink-0" />
                      <span>
                        {isEn
                          ? 'Isolated Workspace & Verified Email Policy'
                          : 'Chính sách Tách bạch Workspace & Chặn Email Ảo'}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-muted leading-relaxed">
                      {isEn
                        ? 'Only reputable email providers (Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton, Zoho, or verified .vn corporate domains) are accepted. Disposable/temp emails are blocked. Each account gets a 100% isolated Workspace.'
                        : 'Chỉ chấp nhận email chính thống uy tín (Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton, Zoho hoặc tên miền doanh nghiệp .vn). Chặn 100% mail ảo / temp mail. Mỗi tài khoản được tạo 1 Không gian làm việc (Workspace) riêng biệt tuyệt đối.'}
                    </p>
                  </div>
                )}

                <form onSubmit={submit} className="mt-4 space-y-3.5">
                  {infoNotice && (
                    <div
                      role="status"
                      className="rounded-md border px-3 py-2 text-xs font-medium tone-positive"
                    >
                      {infoNotice}
                    </div>
                  )}
                  {error && (
                    <div
                      role="alert"
                      className="rounded-md border px-3 py-2 text-xs tone-attention space-y-2"
                    >
                      <div>{error}</div>
                      {pendingVerifyEmail && (
                        <button
                          type="button"
                          disabled={resendBusy}
                          onClick={() => void handleResendVerification()}
                          className="font-semibold text-brand-text underline disabled:opacity-60"
                        >
                          {resendBusy
                            ? isEn
                              ? 'Resending...'
                              : 'Đang gửi lại...'
                            : isEn
                              ? 'Resend verification email'
                              : 'Gửi lại email xác nhận'}
                        </button>
                      )}
                    </div>
                  )}
                  {!error && pendingVerifyEmail && authMode === 'login' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={resendBusy}
                        onClick={() => void handleResendVerification()}
                        className="text-[11px] font-semibold text-brand-text hover:underline disabled:opacity-60"
                      >
                        {resendBusy
                          ? isEn
                            ? 'Resending...'
                            : 'Đang gửi lại...'
                          : isEn
                            ? 'Did not get email? Resend verification link'
                            : 'Chưa nhận được thư? Gửi lại liên kết xác nhận'}
                      </button>
                    </div>
                  )}

                  {authMode === 'register' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label={isEn ? 'Full Name' : 'Họ và tên Quản trị viên'}
                        htmlFor="reg-fullname"
                        required
                      >
                        <input
                          id="reg-fullname"
                          type="text"
                          required
                          minLength={2}
                          maxLength={120}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder={isEn ? 'e.g. Nguyen Van A' : 'VD: Nguyễn Văn A'}
                          className="input text-xs sm:text-sm"
                        />
                      </Field>

                      <Field
                        label={isEn ? 'Agency / Workspace Name' : 'Tên Agency / Workspace riêng'}
                        htmlFor="reg-workspace"
                        required
                      >
                        <input
                          id="reg-workspace"
                          type="text"
                          required
                          minLength={2}
                          maxLength={120}
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          placeholder={isEn ? 'e.g. Alpha Media Agency' : 'VD: Alpha Ads Agency'}
                          className="input text-xs sm:text-sm"
                        />
                      </Field>
                    </div>
                  )}

                  {authMode !== 'reset' && (
                    <Field
                      label={
                        authMode === 'register'
                          ? isEn
                            ? 'Official Email (Gmail, Outlook, iCloud, Yahoo, .vn)'
                            : 'Email chính thống (Gmail, Outlook, iCloud, Yahoo, .vn)'
                          : t('login.email')
                      }
                      htmlFor="login-email"
                      required
                    >
                      <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (precheckResult) setPrecheckResult(null)
                        }}
                        onBlur={() => void precheckEmailOnBlur()}
                        placeholder={
                          authMode === 'register'
                            ? 'tenban@gmail.com / outlook.com / icloud.com'
                            : 'name@company.com'
                        }
                        className="input text-sm"
                      />
                      {authMode === 'register' && effectiveEmailStatus && (
                        <div
                          className={`mt-1.5 rounded border px-2.5 py-1 text-[11px] font-medium ${
                            effectiveEmailStatus.ok ? 'tone-positive' : 'tone-attention'
                          }`}
                        >
                          {effectiveEmailStatus.msg}
                        </div>
                      )}
                    </Field>
                  )}

                  {authMode !== 'forgot' && (
                    <Field
                      label={
                        authMode === 'register' || authMode === 'reset'
                          ? isEn
                            ? 'Strong Password (≥ 8 chars, Uppercase, Lowercase & Number)'
                            : 'Mật khẩu bảo mật (≥ 8 ký tự, có chữ Hoa, chữ thường & số)'
                          : t('login.password')
                      }
                      htmlFor="login-password"
                      required
                    >
                      <input
                        id="login-password"
                        type="password"
                        autoComplete={
                          authMode === 'register' || authMode === 'reset' ? 'new-password' : 'current-password'
                        }
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input text-sm"
                      />
                      {authMode === 'login' && (
                        <div className="mt-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setAuthMode('forgot')
                              setError(null)
                              setInfoNotice(null)
                            }}
                            className="text-[11px] font-semibold text-brand-text hover:underline"
                          >
                            {isEn ? 'Forgot password?' : 'Quên mật khẩu?'}
                          </button>
                        </div>
                      )}
                    </Field>
                  )}

                  {authMode === 'reset' && (
                    <Field
                      label={isEn ? 'Confirm New Password' : 'Xác nhận Mật khẩu Mới'}
                      htmlFor="login-confirm-password"
                      required
                    >
                      <input
                        id="login-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input text-sm"
                      />
                    </Field>
                  )}

                  {authMode === 'register' && (
                    <Field
                      label={
                        isEn
                          ? 'Community Invite Code / Pro Upgrade (Optional)'
                          : 'Mã Mời Cộng Đồng / Nâng Cấp Pro (Tùy chọn)'
                      }
                      htmlFor="reg-invite-code"
                    >
                      <input
                        id="reg-invite-code"
                        type="text"
                        maxLength={64}
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder={isEn ? 'e.g. ADSOPS-PRO-XXXXXX (leave blank for Free Community tier)' : 'VD: ADSOPS-PRO-XXXXXX (để trống = Gói Cộng đồng Free)'}
                        className="input font-mono text-xs uppercase"
                      />
                    </Field>
                  )}

                  {/* 4-LAYER ANTI-BOT VERIFICATION FOR REGISTRATION */}
                  {authMode === 'register' && (
                    <div className="rounded-lg border border-line-strong bg-surface-sunken/70 p-3 space-y-2.5">
                      {/* Honeypot trap field (invisible to humans) */}
                      <div className="sr-only" aria-hidden="true">
                        <label htmlFor="website-hp">Website URL</label>
                        <input
                          id="website-hp"
                          type="text"
                          tabIndex={-1}
                          autoComplete="off"
                          value={websiteHoneypot}
                          onChange={(e) => setWebsiteHoneypot(e.target.value)}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                          <ShieldCheck className="h-3.5 w-3.5 text-brand-text" aria-hidden="true" />
                          {isEn
                            ? 'Anti-Bot & Anti-Spam Security Check'
                            : 'Xác thực Chống Bot & Chống Spam Tự động'}
                        </span>
                        <button
                          type="button"
                          onClick={() => void loadBotChallenge()}
                          disabled={loadingChallenge}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-text hover:underline"
                        >
                          <RefreshCw className={`h-3 w-3 ${loadingChallenge ? 'animate-spin' : ''}`} />
                          <span>{isEn ? 'Refresh Code' : 'Đổi mã khác'}</span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        {challenge?.captcha_svg ? (
                          <img
                            src={challenge.captcha_svg}
                            alt="Anti-bot security captcha"
                            className="h-12 w-44 rounded border border-line object-cover select-none"
                          />
                        ) : (
                          <div className="h-12 w-44 rounded border border-line bg-surface flex items-center justify-center text-xs text-ink-muted">
                            {isEn ? 'Loading captcha...' : 'Đang tạo mã...'}
                          </div>
                        )}
                        <div className="rounded-md border px-3 py-2 text-xs font-mono font-bold tone-caution">
                          {challenge?.math_question ?? '... + ... = ?'}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="reg-captcha" className="block text-[11px] font-semibold text-ink-muted mb-1">
                            {isEn ? '5-Char Image Code *' : 'Nhập 5 ký tự trong ảnh *'}
                          </label>
                          <input
                            id="reg-captcha"
                            type="text"
                            required
                            maxLength={8}
                            value={captchaCode}
                            onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                            placeholder={isEn ? 'e.g. K7M9P' : 'VD: K7M9P'}
                            className="input font-mono text-xs uppercase"
                          />
                        </div>

                        <div>
                          <label htmlFor="reg-math" className="block text-[11px] font-semibold text-ink-muted mb-1">
                            {isEn ? 'Math Answer *' : 'Kết quả phép tính *'}
                          </label>
                          <input
                            id="reg-math"
                            type="text"
                            inputMode="numeric"
                            required
                            maxLength={5}
                            value={mathAnswer}
                            onChange={(e) => setMathAnswer(e.target.value)}
                            placeholder={isEn ? 'Sum = ?' : 'Tổng = ?'}
                            className="input font-mono text-xs"
                          />
                        </div>
                      </div>

                      <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-xs text-ink">
                        <input
                          type="checkbox"
                          required
                          checked={humanConfirmed}
                          onChange={(e) => setHumanConfirmed(e.target.checked)}
                          className="h-4 w-4 rounded border-line-strong text-brand focus:ring-brand"
                        />
                        <span>
                          {isEn
                            ? 'I confirm I am a real human operator (not an automated bot/script).'
                            : 'Tôi xác nhận là người dùng thật (không phải Bot / Script spam tự động).'}
                        </span>
                      </label>
                    </div>
                  )}

                  {effectiveTurnstileKey && authMode !== 'reset' && (
                    <div className="rounded-lg border border-line bg-surface-sunken/50 p-2.5">
                      <div ref={turnstileContainerRef} data-testid="turnstile-widget" />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || (authMode === 'register' && effectiveEmailStatus?.ok === false)}
                    className="btn-primary w-full py-2.5 text-sm"
                  >
                    {busy
                      ? authMode === 'register'
                        ? isEn
                          ? 'Verifying & Creating Isolated Workspace...'
                          : 'Đang xác thực & Khởi tạo Workspace riêng...'
                        : authMode === 'forgot'
                          ? isEn
                            ? 'Sending Reset Instructions...'
                            : 'Đang gửi yêu cầu khôi phục...'
                          : authMode === 'reset'
                            ? isEn
                              ? 'Updating Password...'
                              : 'Đang cập nhật mật khẩu...'
                            : t('login.submitting')
                      : authMode === 'register'
                        ? isEn
                          ? 'Verify & Create Isolated Agency Account'
                          : 'Xác thực & Tạo Tài khoản Workspace Riêng'
                        : authMode === 'forgot'
                          ? isEn
                            ? 'Send Password Reset Link'
                            : 'Gửi Liên Kết Đặt Lại Mật Khẩu'
                          : authMode === 'reset'
                            ? isEn
                              ? 'Confirm New Password'
                              : 'Xác Nhận Đổi Mật Khẩu'
                            : t('login.submit')}
                  </button>

                  {(authMode === 'forgot' || authMode === 'reset') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('login')
                        setError(null)
                        setInfoNotice(null)
                      }}
                      className="w-full text-center text-xs font-semibold text-ink-muted hover:text-ink"
                    >
                      {isEn ? '← Back to Sign In' : '← Quay lại Đăng nhập'}
                    </button>
                  )}
                </form>
              </div>
            </aside>
          </section>

          {/* SECTION 2: ENTERPRISE SECURITY & COMPLIANCE */}
          <section id="security" className="py-12 space-y-6">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tone-positive">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'OWASP ASVS Security Architecture & Tenant Isolation'
                    : 'Kiến trúc Bảo mật Chuẩn OWASP ASVS & Cô lập Dữ liệu'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-ink">
                {isEn
                  ? 'Zero-Trust Access Control & Encrypted Workspace Ledger'
                  : 'Kiểm soát Truy cập Zero-Trust & Sổ cái Không gian Làm việc Mã hóa'}
              </h2>
              <p className="text-sm text-ink-muted max-w-3xl">
                {isEn
                  ? 'Every session, credential vault, and API surface enforces strict cryptographic integrity, rate limits, and multi-tenant isolation.'
                  : 'Mọi phiên đăng nhập, kho bí mật và cổng giao tiếp API đều áp dụng kiểm chứng mật mã, giới hạn tần suất và cô lập dữ liệu nghiêm ngặt.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="card p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-tone-positive-fg" aria-hidden="true" />
                  <span>
                    {isEn
                      ? '1. Fernet AES-128-CBC + HMAC-SHA256 Vault'
                      : '1. Kho khóa Fernet AES-128-CBC + HMAC-SHA256'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Sensitive credentials and OTP secrets are encrypted at rest and automatically redacted from application logs and error responses.'
                    : 'Thông tin xác thực và khóa OTP được mã hóa lưu trữ chuyên dụng, tự động che giấu tuyệt đối khỏi nhật ký và phản hồi lỗi.'}
                </p>
              </div>

              <div className="card p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-tone-positive-fg" aria-hidden="true" />
                  <span>
                    {isEn
                      ? '2. PBKDF2-SHA256 (260k) & Session Registry'
                      : '2. Mật khẩu PBKDF2-SHA256 (260k vòng) & Quản lý Phiên'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Tokens are bound to server-side session records with separated scopes, allowing instant per-device revocation.'
                    : 'Token xác thực gắn với sổ phiên phía máy chủ theo từng phạm vi quyền, cho phép thu hồi truy cập theo thiết bị tức thì.'}
                </p>
              </div>

              <div className="card p-4 space-y-1.5">
                <div className="text-xs font-bold text-ink flex items-center gap-2">
                  <Layers className="h-4 w-4 text-tone-positive-fg" aria-hidden="true" />
                  <span>
                    {isEn
                      ? '3. Multi-Tenant RBAC & Anti-Scraping Shield'
                      : '3. Phân quyền RBAC & Khiên Chống Thu thập Tự động'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {isEn
                    ? 'Workspace isolation, server-signed release tickets, and automated anti-harvesting rate limits safeguard internal operational workflows.'
                    : 'Cô lập ranh giới không gian làm việc, cấp phát vé tải tài nguyên có chữ ký ngắn hạn và giới hạn tốc độ chống khai thác tự động.'}
                </p>
              </div>
            </div>
          </section>
        </main>

        {/* STEALTH ENTERPRISE FOOTER */}
        <footer className="border-t border-line bg-surface py-8">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="space-y-1.5">
                <BrandMark />
                <p className="text-ink-muted">
                  {isEn ? 'Active Gateway:' : 'Cổng truy cập:'}{' '}
                  <span className="font-mono font-semibold text-ink">{currentHost}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-ink-muted">
                <a href="#overview" className="hover:text-ink">
                  {isEn ? 'Overview' : 'Tổng quan'}
                </a>
                <a href="#security" className="hover:text-ink">
                  {isEn ? 'Security' : 'Bảo mật'}
                </a>
                <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="hover:text-ink">
                  {isEn ? 'XML Sitemap' : 'Sitemap XML'}
                </a>
                <a href="/robots.txt" target="_blank" rel="noreferrer" className="hover:text-ink">
                  {isEn ? 'Robots Policy' : 'Cấu hình Robots'}
                </a>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-tone-positive-fg" aria-hidden="true" />
                <span>
                  {isEn
                    ? 'AdsOps Control Center · Private Enterprise Governance Portal'
                    : 'AdsOps Control Center · Cổng Điều hành Doanh nghiệp Độc quyền'}
                </span>
              </div>
              <span>{isEn ? 'Zero-Trust Access Control' : 'Kiểm soát Truy cập Zero-Trust'}</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  )
}
