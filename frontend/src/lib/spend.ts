import { ApiError } from './api'

/** Raw Meta money string with its currency. Never parsed, divided or reformatted. */
export function rawMoney(raw: string | null | undefined, currency: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  return currency ? `${raw} ${currency}` : raw
}

/** What a failed refresh call tells the operator. Distinguishes the documented refusals. */
export function refreshErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Only a workspace owner can refresh spend.'
    if (error.status === 409 && error.code === 'entity_archived')
      return 'This account is archived, so spend cannot be refreshed. Restore it first.'
    if (error.status === 409)
      return `This account cannot be read: no connection can observe it. ${error.message}`
    return error.message
  }
  return 'The refresh could not be completed.'
}
