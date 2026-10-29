import {
  Activity,
  Bell,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  Link2,
  ListChecks,
  Package,
  UserRoundCog,
  ScrollText,
  Server,
  Settings,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '../../i18n'

export interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: LucideIcon
  end?: boolean
  hiddenInSidebar?: boolean
}

export interface NavGroup {
  id: string
  labelKey: TranslationKey
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'nav.group.overview',
    items: [{ to: '/', labelKey: 'nav.item.overview', icon: LayoutDashboard, end: true }],
  },
  {
    id: 'accounts',
    labelKey: 'nav.group.accounts',
    items: [
      { to: '/accounts', labelKey: 'nav.item.accounts', icon: Wallet },
      { to: '/business-managers', labelKey: 'nav.item.businessManagers', icon: Building2 },
      { to: '/assets', labelKey: 'nav.item.assets', icon: Package },
      { to: '/facebook-accounts', labelKey: 'nav.item.facebookAccounts', icon: UserRoundCog },
    ],
  },
  {
    id: 'monitoring',
    labelKey: 'nav.group.monitoring',
    items: [
      { to: '/alerts', labelKey: 'nav.item.alerts', icon: Bell },
      { to: '/operations', labelKey: 'nav.item.operations', icon: Wrench },
      { to: '/account-health', labelKey: 'nav.item.accountHealth', icon: Activity, hiddenInSidebar: true },
      { to: '/readiness', labelKey: 'nav.item.readiness', icon: ListChecks, hiddenInSidebar: true },
      { to: '/preflight', labelKey: 'nav.item.preflight', icon: ClipboardCheck, hiddenInSidebar: true },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { to: '/team', labelKey: 'nav.item.team', icon: Users },
      { to: '/settings', labelKey: 'nav.item.settings', icon: Settings },
      { to: '/meta-connections', labelKey: 'nav.item.metaConnections', icon: Link2, hiddenInSidebar: true },
      { to: '/security-devices', labelKey: 'nav.item.securityDevices', icon: Smartphone, hiddenInSidebar: true },
      { to: '/audit-log', labelKey: 'nav.item.auditLog', icon: ScrollText, hiddenInSidebar: true },
      { to: '/system', labelKey: 'nav.item.systemStatus', icon: Server, hiddenInSidebar: true },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)
