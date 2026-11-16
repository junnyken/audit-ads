import { useEffect, useState } from 'react'

export const DEFAULT_MAX_VIAS_PER_PROXY = 4
const STORAGE_KEY = 'adsops_max_vias_per_proxy'
const CHANGE_EVENT = 'adsops:proxy-prefs-changed'

export function clampMaxViasPerProxy(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_VIAS_PER_PROXY
  return Math.min(50, Math.max(1, Math.round(n)))
}

export function getMaxViasPerProxy(): number {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_MAX_VIAS_PER_PROXY
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? clampMaxViasPerProxy(parsed) : DEFAULT_MAX_VIAS_PER_PROXY
  } catch {
    return DEFAULT_MAX_VIAS_PER_PROXY
  }
}

export function setMaxViasPerProxy(n: number): number {
  const clamped = clampMaxViasPerProxy(n)
  try {
    window.localStorage?.setItem(STORAGE_KEY, String(clamped))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { maxViasPerProxy: clamped } }))
  } catch {
    // Ignore storage unavailability in restricted contexts
  }
  return clamped
}

export function useMaxViasPerProxy(): [number, (n: number) => number] {
  const [limit, setLimit] = useState<number>(() => getMaxViasPerProxy())

  useEffect(() => {
    const refresh = () => setLimit(getMaxViasPerProxy())
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const update = (next: number): number => {
    const saved = setMaxViasPerProxy(next)
    setLimit(saved)
    return saved
  }

  return [limit, update]
}
