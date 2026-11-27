import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { SeoHead } from './components/shell/SeoHead'
import { useI18n } from './i18n'
import { useAuth } from './hooks/useAuth'
const Login = lazy(() => import('./pages/Login'))
const Overview = lazy(() => import('./pages/Overview'))
const Accounts = lazy(() => import('./pages/Accounts'))
const AccountDetail = lazy(() => import('./pages/AccountDetail'))
const BusinessManagers = lazy(() => import('./pages/BusinessManagers'))
const Emails = lazy(() => import('./pages/Emails'))
const Assets = lazy(() => import('./pages/Assets'))
const Fanpages = lazy(() => import('./pages/Fanpages'))
const ClientRetainers = lazy(() => import('./pages/ClientRetainers'))
const ReadinessPage = lazy(() => import('./pages/Readiness'))
const AccountHealth = lazy(() => import('./pages/AccountHealth'))
const Alerts = lazy(() => import('./pages/Alerts'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const SystemStatus = lazy(() => import('./pages/SystemStatus'))
const Settings = lazy(() => import('./pages/Settings'))
const Preflight = lazy(() => import('./pages/Preflight'))
const PreflightDetail = lazy(() => import('./pages/PreflightDetail'))
const Operations = lazy(() => import('./pages/Operations'))
const OperationsGuide = lazy(() => import('./pages/OperationsGuide'))
const MetaConnections = lazy(() => import('./pages/MetaConnections'))
const MetaConnectionWorkspace = lazy(() => import('./pages/MetaConnectionWorkspace'))
const GoogleAdsConnections = lazy(() => import('./pages/GoogleAdsConnections'))
const CreateAccountWizard = lazy(() => import('./pages/operations/CreateAccountWizard'))
const ShareAccessWizard = lazy(() => import('./pages/operations/ShareAccessWizard'))
const PixelShareWizard = lazy(() => import('./pages/operations/PixelShareWizard'))
const TeamSeats = lazy(() => import('./pages/TeamSeats'))
const FacebookAccounts = lazy(() => import('./pages/FacebookAccounts'))
const FacebookAccountDetail = lazy(() => import('./pages/FacebookAccountDetail'))
const SecurityDevices = lazy(() => import('./pages/SecurityDevices'))
const ChromeExtension = lazy(() => import('./pages/ChromeExtension'))
import { Skeleton } from './components/primitives/skeleton'
import { LoadingRegion } from './components/states'

export default function App() {
  const { user, loading, recovery, retry, signOut } = useAuth()
  const { t } = useI18n()

  if (loading) {
    return (
      <LoadingRegion className="mx-auto max-w-md space-y-2 p-8">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </LoadingRegion>
    )
  }
  if (recovery) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">{t('authRecovery.title')}</h1>
        <p role="alert">{t('authRecovery.message')}</p>
        <div className="flex gap-4">
          <button className="rounded border px-4 py-2" onClick={() => void retry?.()}>{t('authRecovery.retry')}</button>
          <button className="rounded border px-4 py-2" onClick={signOut}>{t('authRecovery.signOut')}</button>
        </div>
      </main>
    )
  }
  if (!user) {
    return (
      <>
        <SeoHead />
        <Suspense
          fallback={
            <LoadingRegion className="mx-auto max-w-md space-y-2 p-8">
              <Skeleton className="h-8 w-full" />
            </LoadingRegion>
          }
        >
          <Login />
        </Suspense>
      </>
    )
  }

  return (
    <>
      <SeoHead />
      <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:accountId" element={<AccountDetail />} />
        <Route path="business-managers" element={<BusinessManagers />} />
        <Route path="pages" element={<Fanpages />} />
        <Route path="retainers" element={<ClientRetainers />} />
        <Route path="assets" element={<Assets />} />
        <Route path="assets/emails" element={<Emails />} />
        <Route path="facebook-accounts" element={<FacebookAccounts />} />
        <Route path="chrome-extension" element={<ChromeExtension />} />
        <Route path="facebook-accounts/:identityId" element={<FacebookAccountDetail />} />
        <Route path="readiness" element={<ReadinessPage />} />
        <Route path="account-health" element={<AccountHealth />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="preflight" element={<Preflight />} />
        <Route path="preflight/:draftId" element={<PreflightDetail />} />
        <Route path="operations" element={<Operations />} />
        <Route path="operations-guide" element={<OperationsGuide />} />
        <Route path="operations/create-accounts" element={<CreateAccountWizard />} />
        <Route path="operations/share-access" element={<ShareAccessWizard />} />
        <Route path="operations/pixel-share" element={<PixelShareWizard />} />
        <Route path="meta-connections" element={<MetaConnections />} />
        <Route path="meta-connections/:connectionId" element={<MetaConnectionWorkspace />} />
        <Route path="google-ads" element={<GoogleAdsConnections />} />
        <Route path="team" element={<TeamSeats />} />
        <Route path="security-devices" element={<SecurityDevices />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="system" element={<SystemStatus />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </>
  )
}
