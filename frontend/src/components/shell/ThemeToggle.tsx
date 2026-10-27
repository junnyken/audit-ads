import { Monitor, Moon, Sun } from 'lucide-react'
import { useI18n } from '../../i18n'
import { isThemeMode, useTheme, type ThemeMode } from '../../theme/ThemeProvider'
import { Button } from '../primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

const ICON: Record<ThemeMode, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

export function ThemeToggle() {
  const { t } = useI18n()
  const { mode, setMode } = useTheme()
  const Icon = ICON[mode]
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('theme.label')}>
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('theme.label')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (isThemeMode(value)) setMode(value)
          }}
        >
          <DropdownMenuRadioItem value="system">{t('theme.system')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">{t('theme.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('theme.dark')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
