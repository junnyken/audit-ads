import {
  Activity,
  Bell,
  BookOpen,
  Building2,
  Calculator,
  ClipboardCheck,
  Code2,
  Flag,
  LayoutDashboard,
  Link2,
  ListChecks,
  Package,
  Puzzle,
  ScrollText,
  Server,
  Settings,
  Smartphone,
  UserRoundCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { TranslationKey } from '../../i18n'

/**
 * Synchronized 4-group navigation covering all 21 top-level destinations across Web & Desktop.
 */
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
      { to: '/facebook-accounts', labelKey: 'nav.item.facebookAccounts', icon: UserRoundCog },
      { to: '/accounts', labelKey: 'nav.item.accounts', icon: Wallet },
      { to: '/business-managers', labelKey: 'nav.item.businessManagers', icon: Building2 },
      { to: '/pages', labelKey: 'nav.item.pages', icon: Flag },
      { to: '/assets', labelKey: 'nav.item.assets', icon: Package },
      { to: '/retainers', labelKey: 'nav.item.retainers', icon: Calculator },
    ],
  },
  {
    id: 'monitoring',
    labelKey: 'nav.group.monitoring',
    items: [
      { to: '/operations', labelKey: 'nav.item.operations', icon: Wrench },
      { to: '/operations-guide', labelKey: 'nav.item.operationsGuide', icon: BookOpen },
      { to: '/alerts', labelKey: 'nav.item.alerts', icon: Bell },
      { to: '/account-health', labelKey: 'nav.item.accountHealth', icon: Activity },
      { to: '/readiness', labelKey: 'nav.item.readiness', icon: ListChecks },
      { to: '/preflight', labelKey: 'nav.item.preflight', icon: ClipboardCheck },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { to: '/chrome-extension', labelKey: 'nav.item.chromeExtension', icon: Puzzle },
      { to: '/meta-connections', labelKey: 'nav.item.metaConnections', icon: Link2 },
      { to: '/google-ads', labelKey: 'nav.item.googleAds', icon: Code2 },
      { to: '/team', labelKey: 'nav.item.team', icon: Users },
      { to: '/security-devices', labelKey: 'nav.item.securityDevices', icon: Smartphone },
      { to: '/audit-log', labelKey: 'nav.item.auditLog', icon: ScrollText },
      { to: '/system', labelKey: 'nav.item.systemStatus', icon: Server },
      { to: '/settings', labelKey: 'nav.item.settings', icon: Settings },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)
