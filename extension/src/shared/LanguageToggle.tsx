import { useLanguage } from './i18n'

/** A small VI/EN switch, shared by popup, side panel and options — each mounts its own provider. */
export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage()
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        className={language === 'vi' ? 'lang-toggle__option lang-toggle__option--active' : 'lang-toggle__option'}
        aria-pressed={language === 'vi'}
        onClick={() => setLanguage('vi')}
      >
        {t('languageToggle.vi')}
      </button>
      <button
        type="button"
        className={language === 'en' ? 'lang-toggle__option lang-toggle__option--active' : 'lang-toggle__option'}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        {t('languageToggle.en')}
      </button>
    </div>
  )
}
