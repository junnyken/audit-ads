import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { cn } from '../../lib/cn'
import { NAV_GROUPS } from './nav'

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { t } = useI18n()
  const { user } = useAuth()
  return (
    <nav aria-label={t('shell.mainNavLabel')} className={cn('flex flex-col gap-3.5 pb-4', collapsed ? 'px-2' : 'px-3')}>
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => !item.hiddenInSidebar && (!item.roles || item.roles.includes(user?.role ?? '')))
        if (visibleItems.length === 0) return null
        const headingId = `nav-group-${group.id}`
        return (
          <section key={group.id} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className={cn(
                'px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.05em] text-ink-faint',
                collapsed && 'sr-only',
              )}
            >
              {t(group.labelKey)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {visibleItems.map((item) => {
                const label = t(item.labelKey)
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'relative flex items-center rounded-md py-1.5 text-sm transition-colors',
                          collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
                          isActive
                            ? 'bg-surface-sunken/85 font-semibold text-ink before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-full before:bg-brand'
                            : 'font-medium text-ink-muted hover:bg-surface-sunken/55 hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-text' : '')}
                            aria-hidden="true"
                          />
                          <span className={cn('min-w-0 truncate', collapsed && 'sr-only')}>{label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
