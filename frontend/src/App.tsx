import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Accounts from './pages/Accounts'
import AccountDetail from './pages/AccountDetail'
import BusinessManagers from './pages/BusinessManagers'
import Assets from './pages/Assets'
import ReadinessPage from './pages/Readiness'
import AccountHealth from './pages/AccountHealth'
import Alerts from './pages/Alerts'
import AuditLog from './pages/AuditLog'
import SystemStatus from './pages/SystemStatus'
import Settings from './pages/Settings'
import Preflight from './pages/Preflight'
import PreflightDetail from './pages/PreflightDetail'
import Operations from './pages/Operations'
import MetaConnections from './pages/MetaConnections'
import CreateAccountWizard from './pages/operations/CreateAccountWizard'
import ShareAccessWizard from './pages/operations/ShareAccessWizard'
import PixelShareWizard from './pages/operations/PixelShareWizard'
import TeamSeats from './pages/TeamSeats'
import SecurityDevices from './pages/SecurityDevices'
import { Skeleton } from './components/ui'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Skeleton rows={5} />
      </div>
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
