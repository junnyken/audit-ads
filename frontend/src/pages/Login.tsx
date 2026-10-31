import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Field } from '../components/ui'
import { TooltipProvider } from '../components/primitives/tooltip'
import { BrandMark } from '../components/shell/BrandMark'
import { LanguageToggle } from '../components/shell/LanguageToggle'
import { ThemeToggle } from '../components/shell/ThemeToggle'
import { useI18n } from '../i18n'
import { ApiError } from '../lib/api'
import { downloadChromeExtensionPackageBat } from '../lib/chromeProfileLauncher'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col bg-canvas px-4 sm:px-8">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between py-4 border-b border-line">
          <BrandMark />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadChromeExtensionPackageBat()}
              className="rounded-md border border-brand/40 bg-brand-soft/20 px-3 py-1.5 text-xs font-bold text-brand-text hover:bg-brand-soft/40"
            >
              🧩 Tải Tiện Ích Google Chrome (.bat)
            </button>
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </header>

        <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 py-8 lg:grid-cols-12">
          {/* CỘT TRÁI: GIỚI THIỆU WEBSITE & TIỆN ÍCH CHROME */}
          <div className="space-y-5 lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft/20 px-3 py-1 text-xs font-bold text-brand-text">
              🛡️ Hệ sinh thái Quản trị Dàn Tài khoản Quảng cáo Meta & Tiện ích Chrome
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
              Quản lý 20+ BM, Tự động Cách ly Hồ sơ Chrome & Bọc Proxy Riêng Cho Từng Via
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              <strong>AdsOps Control Center</strong> kết hợp giữa Bảng điều khiển Web và <strong>Tiện ích Google Chrome («AdsOps Hộ Chiếu Via»)</strong> giúp đội ngũ vận hành quảng cáo kiểm soát toàn bộ chi tiêu, trạng thái sống/chết của TKQC và xử lý kháng nghị/thanh toán đúng trình duyệt gốc chỉ với 1 cú nhấp chuột.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface p-3.5">
                <div className="text-xs font-extrabold text-brand-text">🧩 1. Tiện ích Chrome «Hộ Chiếu Via»</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Tự động gắn Proxy <code>IP:Port:User:Pass</code> vào đúng Profile Chrome, hiển thị tên Via, kiểm tra IP thật và tích hợp 5 nút kháng nghị/thanh toán Meta 1 chạm.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3.5">
                <div className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">🚀 2. Tự động mở đúng Hồ sơ Chrome</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Quét trực tiếp các Profile Chrome thật trên máy tính. Khi TKQC lỗi, bấm 1 chạm là mở đúng Chrome của Via dự phòng để xử lý, không bao giờ đăng nhập nhầm nick.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3.5">
                <div className="text-xs font-extrabold text-amber-700 dark:text-amber-400">📊 3. Đồng bộ Đa BM qua Partner</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Theo dõi chi tiêu Hôm nay, Hôm qua, 7 Ngày, Tháng này của tất cả các BM và TKQC theo thời gian thực thông qua Token 60 ngày của BM Trung tâm.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3.5">
                <div className="text-xs font-extrabold text-purple-700 dark:text-purple-400">🛡️ 4. Canh tự động 4 Hạn mức Meta</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Kiểm soát ngưỡng an toàn: <strong>1 Via ≤ 2 BM gốc</strong> · <strong>BM XMDN (1→30+ TKQC)</strong> · <strong>1 Thẻ ≤ 3 TKQC</strong> (chống bão thẻ) · <strong>1 Proxy ≤ 2 Via</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: KHUNG ĐĂNG NHẬP */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-md" aria-labelledby="login-title">
              <div className="mb-4">
                <BrandMark />
                <p className="mt-1.5 text-xs text-ink-muted">{t('common.appTagline')}</p>
              </div>
              <h2 id="login-title" className="mb-4 text-lg font-bold text-ink">
                {t('login.title')}
              </h2>

              <div className="space-y-3">
                <Field label={t('login.email')} required htmlFor="email">
                  <input
                    id="email"
                    className="input"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </Field>
                <Field label={t('login.password')} required htmlFor="password">
                  <input
                    id="password"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </Field>
              </div>

              {error && (
                <p role="alert" className="tone-attention mt-3 rounded-md border px-3 py-2 text-sm">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>
                {busy ? t('login.submitting') : t('login.submit')}
              </button>
            </form>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
