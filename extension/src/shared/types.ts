/** Types shared by the service worker, the content script and the extension pages. */

export type ContextStatus = 'confirmed' | 'ambiguous' | 'unknown' | 'unsupported_page'

export type PageType =
  | 'unknown'
  | 'account'
  | 'campaign'
  | 'adset'
  | 'ad'
  | 'billing'
  | 'settings'

export type ExtensionEventType =
  | 'extension_context_confirmed'
  | 'extension_context_ambiguous'
  | 'extension_context_unknown'
  | 'manual_review_started'
  | 'manual_review_completed'
  | 'campaign_change_intent'
  | 'campaign_change_completed'
  | 'account_note_added'
  | 'policy_issue_reported'
  | 'payment_issue_reported'

/** What the content script observed. Note what is absent: no full URL, no query string. */
export interface PageObservation {
  externalAccountId: string | null
  safePath: string | null
  pageType: PageType
  /** Display only. It is never sent for matching, and the backend never compares it. */
  displayName: string | null
}

export interface AccountContext {
  id: string
  display_name: string
  external_account_id: string | null
  business_manager_name: string | null
  owner_label: string | null
  status: string
  archived: boolean
}

export interface ReadinessBlock {
  status: string
  evaluated_at: string
  reasons: { code: string; message: string }[]
  reason_count: number
}

export interface HealthBlock {
  status: string
  freshness_status: string
  evaluated_at: string | null
  top_reasons: { severity: string; message: string }[]
  counts: Record<string, number>
}

export interface AlertCounts {
  open_count: number
  critical_count: number
  warning_count: number
  info_count: number
}

export interface ContextResolution {
  context_status: ContextStatus
  reason_code: string | null
  message: string | null
  page_type: PageType
  safe_path: string | null
  account?: AccountContext | null
  readiness?: ReadinessBlock | null
  health?: HealthBlock | null
  alerts?: AlertCounts | null
  dashboard_paths?: Record<string, string> | null
  disclaimer?: string | null
  generated_at?: string | null
}

export interface ConnectionState {
  connected: boolean
  dashboardUrl: string
  workspaceName: string | null
  userEmail: string | null
  expiresAt: string | null
  error: string | null
}

export type WorkerRequest =
  | { kind: 'observation'; observation: PageObservation }
  | { kind: 'getContext'; tabId?: number }
  | { kind: 'getConnection' }
  | { kind: 'connect'; email: string; password: string; dashboardUrl: string; label: string }
  | { kind: 'disconnect'; reason: string }
  | { kind: 'recordEvent'; adAccountId: string; eventType: ExtensionEventType; note: string }
  | { kind: 'setDashboardUrl'; dashboardUrl: string }

export interface WorkerResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
