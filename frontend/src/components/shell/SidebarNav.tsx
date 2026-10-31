import { NavLink } from 'react-router-dom'
import { Puzzle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { cn } from '../../lib/cn'
import { NAV_GROUPS } from './nav'

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  return (
    <nav aria-label={t('shell.mainNavLabel')} className="flex flex-col gap-4 px-3 pb-4">
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => !item.hiddenInSidebar)
        if (visibleItems.length === 0) return null
        const headingId = `nav-group-${group.id}`
        const redundantHeading =
          visibleItems.length === 1 && t(visibleItems[0].labelKey) === t(group.labelKey)
        return (
          <section key={group.id} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className={cn(
                'px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.04em] text-ink-faint',
                redundantHeading && 'sr-only',
              )}
            >
              {t(group.labelKey)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {visibleItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand-light text-brand-text'
                          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                      )
                    }
                  >
                    <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{t(item.labelKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
          <section aria-label="Tiện ích Google Chrome">
        <h2 className="px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.04em] text-ink-faint">
          TIỆN ÍCH TRÌNH DUYỆT
        </h2>
        <ul className="flex flex-col gap-0.5">
          <li>
            <NavLink
              to="/chrome-extension"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-bold transition-colors',
                  isActive
                    ? 'bg-brand-light text-brand-text'
                    : 'text-brand-text hover:bg-surface-sunken',
                )
              }
            >
              <Puzzle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">Tiện ích Chrome (Via)</span>
            </NavLink>
          </li>
        </ul>
      </section>
    </nav>
  )
}
