export type ReadinessStatus =
  | 'unknown'
  | 'not_ready'
  | 'ready_with_warnings'
  | 'operationally_ready'

export type AccountStatus =
  | 'unknown'
  | 'active'
  | 'warning'
  | 'restricted'
  | 'disabled'
  | 'archived'

export type AccountType = 'business_manager' | 'personal_reference' | 'unknown'
export type ReferenceStatus = 'unknown' | 'active' | 'inactive' | 'restricted'
export type EvidenceStatus = 'missing' | 'provided' | 'verified' | 'expired' | 'rejected'
export type ReviewStatus = 'not_reviewed' | 'in_review' | 'completed' | 'needs_update' | 'waived'
export type EventSeverity = 'info' | 'warning' | 'critical'
export type EventStatus = 'open' | 'acknowledged' | 'resolved'
export type AssetType = 'page' | 'pixel' | 'payment_profile' | 'browser_profile' | 'proxy'

export interface Paged<T> {
  items: T[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface AdAccount {
  id: string
  display_name: string
  external_account_id: string | null
  account_type: AccountType
  business_manager_id: string | null
  personal_account_reference_id: string | null
  business_manager_name: string | null
  personal_account_reference_label: string | null
  owner_label: string
  country: string | null
  currency: string | null
  timezone: string | null
  status: AccountStatus
  readiness_status: ReadinessStatus
  readiness_evaluated_at: string | null
  last_manual_review_at: string | null
  last_synced_at: string | null
  last_activity_at: string | null
  requires_page: boolean
  requires_pixel: boolean
  landing_page_url: string | null
  tags: string[]
  notes: string
  created_at: string
  updated_at: string
  archived_at: string | null
  required_item_count?: number
  completed_item_count?: number
  has_browser_reference?: boolean
  has_proxy_reference?: boolean
}

export interface ReadinessReason {
  code: string
  severity: 'info' | 'warning' | 'critical'
  source_type: string
  source_id: string | null
  message: string
}

export interface ReadinessItem {
  item_key: string
  label: string
  category: string
  state: 'satisfied' | 'unknown' | 'problem' | 'not_required'
  required: boolean
  is_mandatory: boolean
  requirement_reason: string
  derived_from: string | null
  requires_evidence: boolean
  evidence_status: EvidenceStatus
  review_status: ReviewStatus
  expires_at: string | null
  message: string
  checklist_item_id: string | null
}

export interface Readiness {
  ad_account_id: string
  readiness_status: ReadinessStatus
  evaluated_at: string
  required_item_count: number
  completed_item_count: number
  reasons: ReadinessReason[]
  items: ReadinessItem[]
  data_freshness: { status: 'current' | 'stale' | 'unknown'; last_synced_at: string | null }
  disclaimer: string
}

export interface ReadinessSummary {
  total_active: number
  operationally_ready: number
  ready_with_warnings: number
  not_ready: number
  unknown: number
  archived: number
}

export interface ChecklistItem {
  id: string
  ad_account_id: string
  item_key: string
  label: string
  category: string
  is_mandatory: boolean
  evidence_status: EvidenceStatus
  review_status: ReviewStatus
  reviewed_at: string | null
  expires_at: string | null
  waiver_reason: string
  notes: string
}

export interface Evidence {
  id: string
  checklist_item_id: string
  evidence_type: string
  storage_reference: string | null
  external_url: string | null
  summary: string
  provided_at: string
  verified_at: string | null
  expires_at: string | null
  status: EvidenceStatus
  archived_at: string | null
}

export interface ChecklistEntry {
  item: ChecklistItem
  evidence: Evidence[]
  evaluation: ReadinessItem | null
}

export interface AccountEvent {
  id: string
  ad_account_id: string
  event_type: string
  severity: EventSeverity
  source: string
  occurred_at: string
  summary: string
  evidence_reference: string | null
  status: EventStatus
  resolved_at: string | null
  resolution_note: string
  archived_at: string | null
}

export interface AssetLink {
  id: string
  ad_account_id: string
  asset_type: AssetType
  asset_id: string
  asset_label: string | null
  linked_at: string
  unlinked_at: string | null
  note: string
  is_active: boolean
}

export interface AuditEntry {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  metadata_json: Record<string, unknown> | null
  request_id: string | null
  created_at: string
}

export interface ReferenceRecord {
  id: string
  status: ReferenceStatus
  notes: string
  created_at: string
  updated_at: string
  archived_at: string | null
  [key: string]: unknown
}

export interface SystemStatus {
  application: string
  version: string
  environment: string
  api_status: string
  database_status: string
  database_migration_revision: string | null
  worker_status: string
  redis_status: string
  last_readiness_recalculation_at: string | null
  account_count: number
  server_time: string
}

export interface CurrentUser {
  id: string
  email: string
  full_name: string
  role: string
  workspace: { id: string; name: string; slug: string }
}
