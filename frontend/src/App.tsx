import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
const Overview = lazy(() => import('./pages/Overview'))
const Accounts = lazy(() => import('./pages/Accounts'))
const AccountDetail = lazy(() => import('./pages/AccountDetail'))
const BusinessManagers = lazy(() => import('./pages/BusinessManagers'))
const Assets = lazy(() => import('./pages/Assets'))
const ReadinessPage = lazy(() => import('./pages/Readiness'))
const AccountHealth = lazy(() => import('./pages/AccountHealth'))
const Alerts = lazy(() => import('./pages/Alerts'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const SystemStatus = lazy(() => import('./pages/SystemStatus'))
const Settings = lazy(() => import('./pages/Settings'))
const Preflight = lazy(() => import('./pages/Preflight'))
const PreflightDetail = lazy(() => import('./pages/PreflightDetail'))
const Operations = lazy(() => import('./pages/Operations'))
const MetaConnections = lazy(() => import('./pages/MetaConnections'))
const MetaConnectionWorkspace = lazy(() => import('./pages/MetaConnectionWorkspace'))
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
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <LoadingRegion className="mx-auto max-w-md space-y-2 p-8">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </LoadingRegion>
    )
  }
  if (!user) return <Login />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:accountId" element={<AccountDetail />} />
        <Route path="business-managers" element={<BusinessManagers />} />
        <Route path="assets" element={<Assets />} />
        <Route path="facebook-accounts" element={<FacebookAccounts />} />
        <Route path="chrome-extension" element={<ChromeExtension />} />
        <Route path="facebook-accounts/:identityId" element={<FacebookAccountDetail />} />
        <Route path="readiness" element={<ReadinessPage />} />
        <Route path="account-health" element={<AccountHealth />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="preflight" element={<Preflight />} />
        <Route path="preflight/:draftId" element={<PreflightDetail />} />
        <Route path="operations" element={<Operations />} />
        <Route path="operations/create-accounts" element={<CreateAccountWizard />} />
        <Route path="operations/share-access" element={<ShareAccessWizard />} />
        <Route path="operations/pixel-share" element={<PixelShareWizard />} />
        <Route path="meta-connections" element={<MetaConnections />} />
        <Route path="meta-connections/:connectionId" element={<MetaConnectionWorkspace />} />
        <Route path="team" element={<TeamSeats />} />
        <Route path="security-devices" element={<SecurityDevices />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="system" element={<SystemStatus />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
