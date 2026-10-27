import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n, type TranslationKey } from '../../i18n'
import { Button } from '../primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'

const ROLE_KEYS: Record<string, TranslationKey> = {
  owner: 'role.owner',
  operator: 'role.operator',
  viewer: 'role.viewer',
  auditor: 'role.auditor',
}

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { t } = useI18n()
  if (!user) return null
  // An unknown role is shown as the server sent it rather than hidden or guessed.
  const roleKey = ROLE_KEYS[user.role]
  const roleLabel = roleKey ? t(roleKey) : user.role
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-1.5 px-2" aria-label={t('user.menuLabel')}>
          <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{user.email}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>
          <span className="block">{t('user.signedInAs')}</span>
          <span className="block break-all text-sm font-medium text-ink">{user.email}</span>
          <span className="block font-normal">{roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('user.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
