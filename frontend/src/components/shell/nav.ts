import {
  Activity,
  Bell,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  Link2,
  ListChecks,
  Package,
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
}

export interface NavGroup {
  id: string
  labelKey: TranslationKey
  items: NavItem[]
}

/**
 * The seven navigation groups (U1 §9a). Routes are unchanged from App.tsx; U1a only groups them
 * and brings the five routes A7 had hidden (Readiness, Account health, Preflight, Audit log,
 * System status) into the menu (owner decision Q6). Detail routes (`/accounts/:id`, the
 * wizards, `/meta-connections/:id`, `/preflight/:id`) are children of an entry here and keep
 * that entry highlighted through NavLink's prefix matching.
 */
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
    ],
  },
  {
    id: 'monitoring',
    labelKey: 'nav.group.monitoring',
    items: [
      { to: '/account-health', labelKey: 'nav.item.accountHealth', icon: Activity },
      { to: '/readiness', labelKey: 'nav.item.readiness', icon: ListChecks },
      { to: '/alerts', labelKey: 'nav.item.alerts', icon: Bell },
      { to: '/preflight', labelKey: 'nav.item.preflight', icon: ClipboardCheck },
    ],
  },
  {
    id: 'operations',
    labelKey: 'nav.group.operations',
    items: [{ to: '/operations', labelKey: 'nav.item.operations', icon: Wrench }],
  },
  {
    id: 'meta',
    labelKey: 'nav.group.meta',
    items: [{ to: '/meta-connections', labelKey: 'nav.item.metaConnections', icon: Link2 }],
  },
  {
    id: 'team-security',
    labelKey: 'nav.group.teamSecurity',
    items: [
      { to: '/team', labelKey: 'nav.item.team', icon: Users },
      { to: '/security-devices', labelKey: 'nav.item.securityDevices', icon: Smartphone },
      { to: '/audit-log', labelKey: 'nav.item.auditLog', icon: ScrollText },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { to: '/settings', labelKey: 'nav.item.settings', icon: Settings },
      { to: '/system', labelKey: 'nav.item.systemStatus', icon: Server },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)
