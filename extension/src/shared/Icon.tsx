/**
 * Four inline icons, no icon package: Lucide (ISC licence, https://lucide.dev) path data for
 * refresh-cw, external-link, triangle-alert and info. Decorative by default (aria-hidden); pass
 * `label` for an icon that stands alone, and the caller supplies the translated text.
 */
const PATHS = {
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  info: ['M12 16v-4', 'M12 8h.01'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="ic"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {name === 'info' && <circle cx="12" cy="12" r="10" />}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
