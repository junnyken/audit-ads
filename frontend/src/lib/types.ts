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

// ---------------------------------------------------------------------------------------
// MINI-SPEC A2 — account health. Separate vocabulary from readiness, on purpose.
// ---------------------------------------------------------------------------------------

export type HealthStatus =
  | 'unknown'
  | 'attention_needed'
  | 'warning'
  | 'critical'
  | 'clear_signals'

export type FreshnessStatus = 'current' | 'stale' | 'unknown' | 'not_applicable'
export type SignalSeverity = 'unknown' | 'attention' | 'warning' | 'critical'
export type SignalStatus = 'open' | 'acknowledged' | 'resolved' | 'expired' | 'superseded'
export type HealthCategory = 'account_status' | 'operations' | 'readiness' | 'data_quality'

export interface HealthReason {
  code: string
  severity: string
  signal_id: string | null
  message: string
  observed_at: string
  rule_key: string
  rule_version: number
  status: string
}

export interface HealthCounts {
  critical: number
  warning: number
  attention: number
  unknown: number
}

export interface AccountHealth {
  ad_account_id: string
  health_status: HealthStatus
  status_description: string
  freshness_status: FreshnessStatus
  evaluated_at: string | null
  engine_version: string
  counts: HealthCounts
  summary_reasons: HealthReason[]
  readiness: { status: string; evaluated_at: string | null }
  disclaimer: string
  last_run_status?: string
}

export interface HealthSignal {
  id: string
  ad_account_id: string
  rule_key: string
  rule_version: number
  signal_key: string
  category: HealthCategory
  severity: SignalSeverity
  status: SignalStatus
  source_type: string
  source_entity_type: string | null
  source_entity_id: string | null
  evidence_json: Record<string, unknown>
  observed_at: string
  last_evaluated_at: string
  expires_at: string | null
  acknowledged_at: string | null
  acknowledgement_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_reason: string | null
  resolution_evidence_reference: string | null
  superseded_at: string | null
  superseded_by_signal_id: string | null
  created_at: string
  rule_name: string | null
  why_it_matters: string | null
  recommended_next_step: string | null
  resolution_guidance: string | null
}

export interface AccountHealthRow {
  ad_account_id: string
  display_name: string
  external_account_id: string | null
  business_manager_name: string | null
  personal_account_reference_label: string | null
  owner_label: string
  account_status: string
  account_type: string
  readiness_status: ReadinessStatus
  health_status: HealthStatus
  freshness_status: FreshnessStatus
  open_critical_count: number
  open_warning_count: number
  open_attention_count: number
  open_unknown_count: number
  last_evaluated_at: string | null
  top_reason: HealthReason | null
  archived: boolean
}

export interface HealthSummary {
  total_active: number
  critical: number
  warning: number
  attention_needed: number
  unknown: number
  clear_signals: number
  stale_data: number
  never_evaluated: number
  last_evaluation_at: string | null
  failed_runs_recent: number
  disclaimer: string
}

export interface HealthRule {
  id: string
  rule_key: string
  version: number
  name: string
  description: string
  category: HealthCategory
  enabled: boolean
  severity: SignalSeverity
  resolution_guidance: string
  why_it_matters: string | null
  recommended_next_step: string | null
  applicability: string | null
}

export interface EvaluationRun {
  id: string
  ad_account_id: string | null
  trigger_type: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped'
  engine_version: string
  started_at: string
  completed_at: string | null
  error_code: string | null
  error_summary: string | null
  result_summary_json: Record<string, unknown> | null
  request_id: string | null
}
