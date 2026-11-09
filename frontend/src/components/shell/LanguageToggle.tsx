import { Languages } from 'lucide-react'
import { isLanguage, useI18n } from '../../i18n'
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
            <button
              type="button"
              aria-label={t('language.label')}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface-muted/70 px-1.5 text-xs font-bold transition hover:border-brand"
            >
              <Languages className="h-3.5 w-3.5 text-brand-text" aria-hidden="true" />
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                  language === 'vi' ? 'bg-brand text-brand-fg shadow-xs' : 'text-ink-muted'
                }`}
              >
                VI
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                  language === 'en' ? 'bg-brand text-brand-fg shadow-xs' : 'text-ink-muted'
                }`}
              >
                EN
              </span>
            </button>
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
          <DropdownMenuRadioItem value="vi">{t('language.vi')} (VI)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t('language.en')} (EN)</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
