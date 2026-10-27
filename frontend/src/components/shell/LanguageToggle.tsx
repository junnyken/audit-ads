import { Languages } from 'lucide-react'
import { isLanguage, useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

export function LanguageToggle() {
  const { t, language, setLanguage } = useI18n()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2" aria-label={t('language.label')}>
              <Languages className="h-[18px] w-[18px]" aria-hidden="true" />
              <span aria-hidden="true" className="text-xs font-semibold">
                {language === 'vi' ? t('language.shortVi') : t('language.shortEn')}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('language.label')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => {
            if (isLanguage(value)) setLanguage(value)
          }}
        >
          <DropdownMenuRadioItem value="vi">{t('language.vi')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t('language.en')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
