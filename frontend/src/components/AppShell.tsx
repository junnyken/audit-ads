import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { READINESS_DISCLAIMER } from '../lib/readiness'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/accounts', label: 'Accounts' },
  { to: '/business-managers', label: 'Business Managers' },
  { to: '/assets', label: 'Assets' },
  { to: '/readiness', label: 'Readiness' },
  { to: '/account-health', label: 'Account Health' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/audit-log', label: 'Audit Log' },
  { to: '/system', label: 'System Status' },
  { to: '/settings', label: 'Settings' },
]

export default function AppShell() {
  const { user, signOut } = useAuth()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`${navOpen ? 'block' : 'hidden'} border-b border-line bg-surface lg:block lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r`}
      >
        <div className="hidden items-center gap-2 px-4 py-4 lg:flex">
          <span className="grid h-7 w-7 place-items-center rounded bg-brand text-[12px] font-bold text-white">
            AO
          </span>
          <span className="text-[13px] font-semibold leading-tight">
            AdsOps
            <span className="block text-[11px] font-normal text-ink-faint">Control Center</span>
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 pb-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive ? 'bg-brand-light text-brand-dark' : 'text-ink-muted hover:bg-surface-muted'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
          <button
            type="button"
            className="btn-secondary lg:hidden"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
          >
            Menu
          </button>
          <div className="min-w-0 truncate text-[12.5px] text-ink-muted">
            {user?.workspace.name}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[12px] text-ink-muted sm:inline">
              {user?.email} · {user?.role}
            </span>
            <button type="button" className="btn-secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5">
          <Outlet />
        </main>

        <footer className="border-t border-line bg-surface px-4 py-2.5 text-[11.5px] text-ink-faint">
          {READINESS_DISCLAIMER}
        </footer>
      </div>
    </div>
  )
}
