import { useEffect, useState } from 'react'
import { Eye, Layers } from 'lucide-react'
import { useI18n } from '../../i18n'

const STORAGE_KEY = 'adsops_ui_density'

export function DensityToggle() {
  const { language } = useI18n()
  const isEn = language === 'en'
  const [compact, setCompact] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      return saved ? saved === 'compact' : true
    } catch {
      return true
    }
  })

  useEffect(() => {
    const mode = compact ? 'compact' : 'detailed'
    document.documentElement.setAttribute('data-density', mode)
    try {
      window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // ignore storage errors
    }
  }, [compact])

  return (
    <button
      type="button"
      onClick={() => setCompact((prev) => !prev)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
        compact
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
      }`}
      title={
        compact
          ? isEn
            ? 'Clean/Compact View active (hides repetitive secondary details). Click to switch to Detailed View.'
            : 'Đang bật Chế độ Tinh gọn (ẩn bớt chữ phụ rối mắt). Bấm để chuyển sang Chế độ Chi tiết.'
          : isEn
            ? 'Detailed View active. Click to switch to Clean/Compact View.'
            : 'Đang bật Chế độ Chi tiết. Bấm để chuyển về Chế độ Tinh gọn dễ nhìn.'
      }
    >
      {compact ? <Eye className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">
        {compact
          ? isEn
            ? 'Clean View'
            : 'Giao diện Tinh gọn'
          : isEn
            ? 'Detailed View'
            : 'Hiển thị Chi tiết'}
      </span>
    </button>
  )
}
