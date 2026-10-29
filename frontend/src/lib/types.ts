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

/** How an account came to exist, when it came from a read-only discovery rather than from someone
 * typing it in. Derived from the audit row the import wrote in the same transaction (rule 3), not
 * from a column — `ad_accounts` has no origin field. Present on the detail response only. */
export interface ImportProvenance {
  discovery_run_id: string | null
  business_manager_reference: string | null
  source_edge: string | null
  imported_at: string | null
  /** O3. `scheduled_sweep` when the discovery sweep imported it on its own; `manual` when a
   * person pressed "Add to registry". Absent on responses from before O3. */
  trigger?: 'manual' | 'scheduled_sweep'
  automatic?: boolean
  /** O3. Provenance only: the Business Manager Meta said owns this (client) account. `null` means
   * Meta did not return one — never a guess. The account itself stays under the hub. */
  owner_business_reference?: string | null
  owner_business_name?: string | null
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
  client_name?: string
  planned_daily_budget_raw?: string | null
  planned_monthly_budget_raw?: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  required_item_count?: number
  completed_item_count?: number
  has_browser_reference?: boolean
  has_proxy_reference?: boolean
  payment_profile_labels?: string[]
  /** List responses only (S1 follow-up). Compact; the full view is `GET …/spend`. */
  spend?: AccountSpendCompact
  spend_periods?: AccountSpendPeriods | null
  /** S2. List and detail responses. Meta's latest account status, compact; `null` when no read
   * has carried a status code. The full block is `SpendView.platform_status`. */
  platform_status?: PlatformStatusCompact | null
  /** Detail responses only; the list endpoint omits it. */
  imported_from_discovery?: ImportProvenance | null
  /** F1: detail gives full operational profiles; list gives each id and label. */
  facebook_identities?: FacebookIdentity[]
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

export interface AssetInventoryCounts {
  total: number
  active: number
  restricted: number
  unknown: number
}

export interface AdAccountInventoryCounts {
  total: number
  active: number
  blocked: number
  unknown: number
  by_currency: Record<string, number>
  unassigned_via_count: number
  unassigned_bm_count: number
}

export interface AccountActivity7d {
  created_7d: number
  blocked_7d: number
  recovered_7d: number
}

export interface InventorySummary {
  via_counts: AssetInventoryCounts
  bm_counts: AssetInventoryCounts
  ad_account_counts: AdAccountInventoryCounts
  activity_7d: AccountActivity7d
}

export interface ReadinessSummary {
  total_active: number
  operationally_ready: number
  ready_with_warnings: number
  not_ready: number
  unknown: number
  archived: number
  inventory?: InventorySummary | null
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
export type HealthCategory =
  | 'account_status'
  | 'operations'
  | 'readiness'
  | 'data_quality'
  | 'spend'

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

// ---------------------------------------------------------------------------------------
// MINI-SPEC A3 — Alert Center and Telegram delivery. Alerts are an attention/notification
// layer over A2 health; they never recompute health and never act on a platform.
// ---------------------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'open' | 'acknowledged' | 'suppressed' | 'resolved' | 'expired' | 'archived'
export type AlertSourceType = 'health_signal' | 'health_evaluation_run' | 'discovery_sweep'

export type DeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed_transient'
  | 'failed_final'
  | 'skipped'
  | 'cancelled'

export type DeliverySkipReason =
  | 'no_recipient_configured'
  | 'policy_disabled'
  | 'severity_delivery_disabled'
  | 'alert_suppressed'
  | 'alert_not_active'
  | 'timezone_not_configured'
  | 'duplicate_suppressed_by_dedupe'
  | 'reminders_disabled'
  | 'auto_import_grace'

export interface AlertRow {
  id: string
  severity: AlertSeverity
  status: AlertStatus
  title: string
  summary: string
  source_type: AlertSourceType
  source_label: string
  category: string
  ad_account_id: string | null
  account_display_name: string | null
  account_reference: string | null
  business_manager_name: string | null
  health_status: HealthStatus
  readiness_status: ReadinessStatus
  first_observed_at: string
  last_observed_at: string
  last_notified_at: string | null
  delivery_status: DeliveryStatus | null
  delivery_skip_reason: DeliverySkipReason | null
  delivery_scheduled_for: string | null
  quiet_hours_deferred: boolean
  suppressed_until: string | null
  archived: boolean
  facebook_identities?: FacebookIdentity[]
  remediation_checklist?: string[]
}

export interface AlertRecord {
  id: string
  ad_account_id: string | null
  source_type: AlertSourceType
  source_entity_type: string
  source_entity_id: string | null
  alert_key: string
  category: string
  severity: AlertSeverity
  status: AlertStatus
  title: string
  summary: string
  source_snapshot_json: Record<string, unknown>
  first_observed_at: string
  last_observed_at: string
  last_notified_at: string | null
  acknowledged_at: string | null
  acknowledgement_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_reason: string | null
  suppressed_at: string | null
  suppression_reason: string | null
  suppression_expires_at: string | null
  created_at: string
}

export interface NotificationDelivery {
  id: string
  alert_id: string
  channel: string
  reason: 'initial' | 'escalation' | 'reminder'
  status: DeliveryStatus
  message_template_version: string
  scheduled_for: string
  quiet_hours_decision: Record<string, unknown> | null
  sent_at: string | null
  last_attempt_at: string | null
  attempt_count: number
  next_retry_at: string | null
  skip_reason: DeliverySkipReason | null
  failure_code: string | null
  failure_summary: string | null
  telegram_message_id: string | null
  created_at: string
  payload_snapshot_json: Record<string, unknown>
  recipient_masked: string | null
}

export interface DeliveryAttempt {
  id: string
  attempt_number: number
  status: DeliveryStatus
  started_at: string
  completed_at: string | null
  provider_response_code: number | null
  provider_message_id: string | null
  failure_code: string | null
  failure_summary: string | null
  retry_scheduled_for: string | null
}

export interface AlertDetail {
  alert: AlertRecord
  source_label: string
  account: {
    id: string
    display_name: string
    external_account_id: string | null
    status: string
    readiness_status: ReadinessStatus
    health_status: HealthStatus
  } | null
  notifications: NotificationDelivery[]
  policy_decision: {
    timezone: string | null
    quiet_hours_enabled: boolean | null
    critical_bypasses_quiet_hours: boolean | null
    recipient_configured: boolean
    latest_delivery: NotificationDelivery | null
  }
  disclaimer: string
  facebook_identities?: FacebookIdentity[]
  remediation_checklist?: string[]
}

export interface AlertSummary {
  open_critical: number
  open_warning: number
  open_info: number
  acknowledged: number
  suppressed: number
  failed_final_notifications: number
  deferred_by_quiet_hours: number
  total_active: number
  last_successful_notification_at: string | null
  telegram_transport_configured: boolean
  recipient_configured: boolean
  disclaimer: string
}

export interface NotificationPolicy {
  id: string
  name: string
  enabled: boolean
  timezone: string
  quiet_hours_enabled: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  critical_bypasses_quiet_hours: boolean
  warning_telegram_enabled: boolean
  attention_telegram_enabled: boolean
  reminder_enabled: boolean
  reminder_interval_hours: number | null
  max_reminders_per_alert: number | null
  telegram_transport_configured: boolean
  recipient_configured: boolean
  telegram_chat_id_masked: string | null
  updated_at: string
}

// ---- A4: operations and deployment observability ------------------------------------

export interface OperationalRun {
  id: string
  kind: string
  status: 'succeeded' | 'partial' | 'failed'
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  summary: Record<string, string | number>
  error_code: string | null
  release_version: string | null
}

export interface HostMetrics {
  cpu_count: number | null
  load_average_1m: number | null
  load_percent: number | null
  memory_total_mb: number | null
  memory_available_mb: number | null
  memory_used_percent: number | null
  disk_total_gb: number | null
  disk_free_gb: number | null
  disk_used_percent: number | null
  swap_total_mb: number | null
}

export interface OperationsOverview {
  release_version: string
  application_version: string
  environment: string
  server_time: string
  database_status: string
  migration_revision: string | null
  api_status: string
  notification_transport: string
  telegram_transport_configured: boolean
  test_send_enabled: boolean
  dispatcher_state: 'current' | 'stale' | 'never'
  dispatcher_last_run: OperationalRun | null
  dispatcher_last_success_at: string | null
  due_delivery_count: number
  failed_final_delivery_count: number
  oldest_due_delivery_at: string | null
  oldest_due_delivery_minutes: number | null
  backup_state: 'current' | 'stale' | 'never'
  backup_last_success_at: string | null
  backup_last_run: OperationalRun | null
  restore_drill_last_run: OperationalRun | null
  migration_last_run: OperationalRun | null
  host: HostMetrics
  host_bands: { cpu: string; memory: string; disk: string }
  thresholds: Record<string, number>
  /** O4. Optional so older fixtures still type-check. */
  credential_check_state?: 'current' | 'stale' | 'never'
  credential_check_last_run?: OperationalRun | null
  reader_credentials?: Partial<Record<ReaderCredentialState, number>>
  meta_login_configured?: boolean
  credential_vault_configured?: boolean
}

export interface ConfigurationFinding {
  code: string
  severity: 'error' | 'warning'
  message: string
}

export interface ConfigurationReport {
  environment: string
  production_mode: boolean
  release_version: string
  api_docs_enabled: boolean
  cors_origin_count: number
  public_app_url_configured: boolean
  public_app_url_is_https: boolean
  notification_transport: string
  telegram_transport_configured: boolean
  test_send_enabled: boolean
  error_count: number
  warning_count: number
  findings: ConfigurationFinding[]
}

export interface PreSendCheck {
  code: string
  passed: boolean
  detail: string
}

export interface TestSendPreview {
  message: string
  recipient_masked: string | null
  environment: string
  timezone: string
  template_version: string
  approval_code: string
  transport_mode: string
  already_sent: boolean
  ready_to_send: boolean
  checks: PreSendCheck[]
}

// ---- A5: connected browser extensions --------------------------------------------------

export interface ExtensionInstallation {
  id: string
  label: string
  extension_version: string
  last_seen_at: string | null
  revoked_at: string | null
  revoked_reason: string | null
  created_at: string
  is_active: boolean
}

// ---- A6: Preflight Compliance Gate ------------------------------------------------------

export type DraftStatus =
  | 'draft'
  | 'submitted_for_review'
  | 'needs_changes'
  | 'ready_for_manual_review'
  | 'blocked_by_internal_policy'
  | 'unknown_missing_evidence'
  | 'archived'

export type FindingCategory =
  | 'copy_language'
  | 'landing_page'
  | 'account_readiness'
  | 'account_health'
  | 'budget_change'
  | 'targeting_completeness'
  | 'data_quality'

export type FindingSeverity = 'info' | 'warning' | 'blocking'
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'superseded'
export type PreflightRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface CampaignDraft {
  id: string
  workspace_id: string
  ad_account_id: string | null
  account_display_name: string | null
  title: string
  objective: string | null
  primary_copy: string
  headline: string | null
  description: string | null
  call_to_action: string | null
  landing_page_url: string | null
  creative_reference: string | null
  budget_amount: string | null
  budget_currency: string | null
  budget_change_percent: string | null
  targeting_summary: string | null
  draft_status: DraftStatus
  last_evaluated_at: string | null
  open_blocking_count: number
  open_warning_count: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface PreflightFinding {
  id: string
  draft_id: string
  evaluation_run_id: string
  category: FindingCategory
  severity: FindingSeverity
  rule_key: string
  rule_version: number
  message: string
  field_reference: string | null
  evidence_reference: string | null
  recommended_action: string
  status: FindingStatus
  resolved_at: string | null
  resolved_by: string | null
  resolution_reason: string | null
  created_at: string
  updated_at: string
}

export interface PreflightEvaluationRun {
  id: string
  draft_id: string
  status: PreflightRunStatus
  engine_version: string
  started_at: string
  completed_at: string | null
  error_code: string | null
  error_summary: string | null
  result_summary_json: Record<string, unknown> | null
  created_at: string
}

export interface LandingPageEvidence {
  id: string
  draft_id: string
  url: string
  final_url: string | null
  http_status: number | null
  is_https: boolean
  redirect_count: number | null
  response_time_ms: number | null
  mobile_viewport_meta_present: boolean | null
  contact_or_policy_link_detected: boolean | null
  fetch_error: string | null
  checked_at: string
  expires_at: string | null
}

// -------------------------------------------------------------------- A7: Meta operations
export type MetaEnvironment = 'fake' | 'sandbox' | 'production'

export type BusinessAuthority = 'not_checked' | 'established' | 'not_established'
export type MetaBatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown'

export interface MetaCapabilities {
  list_business_managers: boolean
  create_ad_account: boolean
  share_ad_account_access: boolean
  share_pixel_access: boolean
  reason: string | null
}

export interface MetaConnection {
  id: string
  label: string
  environment: MetaEnvironment
  status: string
  capabilities: MetaCapabilities | null
  last_capability_check_at: string | null
  business_managers: { external_id: string; name: string }[] | null
  token_configured: boolean
  /** Which configured credential answers for this connection's Business Manager — a name, never
   * a value. `business_specific`: this BM has its own reader. `server_default`: it falls back to
   * the single server token, which may or may not have a role in that business.
   * `none`: nothing is configured that could read it. `fake`: no real credential is involved. */
  reader_source: ReaderSource
  /** The Business Manager this connection actually reads, and where that id came from. A
   * connection that inherits the server setting reads the same BM as every other inheriting
   * connection — which is why the source has to be visible, not just the id. */
  business_manager_reference: string | null
  business_manager_source: 'connection' | 'server'
  notes: string
  created_at: string
  updated_at: string
  archived_at: string | null
  /** O3. The owner's switches for the scheduled discovery sweep. Optional so older fixtures and
   * responses still type-check; absent reads as "both off". */
  automation?: MetaConnectionAutomation
  /** O4. The vault credential this connection reads with — name and state, never a token.
   * Optional so older fixtures still type-check; absent reads as "not bound". */
  reader_credential?: ConnectionReaderCredential | null
  /** O4. Other active vault credentials that also saw this Business Manager. Offered to the owner
   * as an explicit switch; the system never switches by itself. */
  other_readers?: { id: string; label: string; kind: ReaderCredentialKind }[]
}

/** O4. `vault`: an active Facebook Login for Business credential. `vault_reconnect_required`: bound
 * to one that cannot be used — nothing is read, and it never falls back to a server token. */
export type ReaderSource =
  | 'vault'
  | 'vault_reconnect_required'
  | 'business_specific'
  | 'server_default'
  | 'none'
  | 'fake'

export type ReaderCredentialKind = 'system_user' | 'user'
export type ReaderCredentialStatus = 'pending_verification' | 'active' | 'reconnect_required' | 'revoked'
/** `expiring` is derived on the server from `expires_at`, never stored. */
export type ReaderCredentialState = ReaderCredentialStatus | 'expiring'

export interface ConnectionReaderCredential {
  id: string
  label: string
  kind: ReaderCredentialKind
  status: ReaderCredentialStatus
  derived_state: ReaderCredentialState
  expires_at: string | null
  reconnect_reason: string | null
}

/** O4. Everything that may be disclosed about a vault credential (rule 40) — never the token. */
export interface MetaReaderCredential {
  id: string
  label: string
  kind: ReaderCredentialKind
  status: ReaderCredentialStatus
  derived_state: ReaderCredentialState
  provider_user_external_id: string | null
  provider_user_name: string | null
  personal_account_reference_id?: string | null
  scopes: string[]
  issued_at: string | null
  expires_at: string | null
  data_access_expires_at: string | null
  last_verified_at: string | null
  last_verify_outcome: string | null
  reconnect_reason: string | null
  businesses_seen: {
    external_id: string
    name: string | null
    permitted_roles: string[] | null
    bound_here: boolean
  }[]
  connections: { id: string; label: string; business_manager_reference: string | null }[]
  connected_at: string | null
  secret_last_rotated_at: string | null
  revoked_at: string | null
  check_result?: string
}

export interface MetaReaderCredentialList {
  configured: boolean
  unavailable_reason: 'not_configured' | 'vault_unavailable' | null
  config_kind: ReaderCredentialKind
  business_manager_required: boolean
  items: MetaReaderCredential[]
}

/** O4. Why the product cannot read an account; `null` when it can. */
export type NotObservableReason =
  | 'account_archived'
  | 'no_external_account_id'
  | 'no_business_manager'
  | 'no_production_connection'
  | 'no_reader'
  | 'reader_reconnect_required'

/** O3. `eligible` is whether the sweep could read this connection at all — production, a
 * Business Manager id, and a configured reader. Computed on the server, never stored. */
export interface MetaConnectionAutomation {
  auto_discovery_enabled: boolean
  auto_import_enabled: boolean
  enabled_by: string | null
  enabled_at: string | null
  eligible: boolean
  ineligible_reason:
    | 'not_production'
    | 'business_manager_not_configured'
    | 'reader_not_configured'
    | 'reader_reconnect_required'
    | 'archived'
    | null
}

/** A10.1. One edge's outcome. `not_attempted` is the value a boolean cannot express, and the
 * one that matters most when reviewing why an asset was — or was not — called missing. */
export interface DiscoveryEdgeCoverage {
  required: boolean
  status: 'completed' | 'truncated' | 'failed' | 'not_attempted'
  pages: number
  items: number
  error_code: string | null
}

export type CoverageStatus =
  | 'complete'
  | 'partial'
  | 'incomplete'
  | 'unknown'
  | 'stale'
  | 'not_attempted'

export type ReconciliationStatus =
  | 'matched'
  | 'missing_in_registry'
  | 'missing_from_latest_discovery'
  | 'metadata_mismatch'
  | 'out_of_scope'
  | 'unknown'
  | 'not_evaluated'

export interface ReconciliationRow {
  external_id: string | null
  internal_entity_id: string | null
  display_name: string
  status: ReconciliationStatus
  detail: string | null
  /** Which Graph edge returned this asset. Null for a row that came from the registry rather
   * than from an observation — an internal record no observation matched has no edge, and
   * inventing one would claim a reading that never happened. */
  source_edge: string | null
}

export interface DiscoveryAssetResult {
  coverage_status: CoverageStatus
  complete: boolean
  required_edges: string[]
  coverage: { edges?: Record<string, DiscoveryEdgeCoverage>; total_unique_assets?: number }
  reconciliation: ReconciliationRow[]
  /** Pixels only, and always false today: a registry Pixel has no Business Manager mapping, so
   * its absence from one BM's discovery is not evidence about that BM. */
  registry_absence_evaluable?: boolean
}

export interface DiscoveryRun {
  id: string
  status: 'running' | 'succeeded' | 'succeeded_with_warnings' | 'failed'
  trigger: string
  environment: MetaEnvironment
  business_manager: { reference: string | null; name: string | null }
  /** Which Meta identity produced this run. The same BM returns different assets to different
   * system users, so a count means little without knowing who was asking. */
  read_as: { external_id: string | null; name: string | null }
  /** Whether the reader could prove it may read this Business Manager at all. Asked only of an
   * empty inventory: a token with no role in a BM still reads the BM node, and its asset edges
   * answer 200 with an empty list and no error. */
  business_authority: BusinessAuthority
  started_at: string | null
  completed_at: string | null
  freshness: 'current' | 'stale' | 'unknown'
  failure_code: string | null
  failure_summary: string | null
  ad_accounts: DiscoveryAssetResult
  pixels: DiscoveryAssetResult
  business_users?: DiscoveryBusinessUsersResult
}
export interface DiscoveredBusinessUserRow {
  external_user_id: string
  display_name: string
  role: string
  status: 'linked' | 'unlinked' | 'missing_from_latest_discovery' | 'admin_demoted'
  is_admin_drift: boolean
  source_edge: string | null
  detail: string | null
  linked_identity: {
    id: string
    label: string
    owner_member_name: string | null
    two_factor_method: string
    link_id: string
    recorded_role: string
  } | null
  suggested_identity: {
    id: string
    label: string
    owner_member_name: string | null
    match_reason: string
  } | null
}

export interface DiscoveryBusinessUsersResult {
  coverage_status: CoverageStatus
  complete: boolean
  required_edges: string[]
  coverage: {
    edges?: Record<string, DiscoveryEdgeCoverage>
    total_unique_assets?: number
  }
  reconciliation: DiscoveredBusinessUserRow[]
}


/** One historical run, exactly as it was recorded — coverage, authority and reader identity, and
 * deliberately no reconciliation. Reconciliation is recomputed against the registry as it is
 * *now*, so showing it beside a week-old observation would put today's registry and an old
 * reading side by side and invite reading one as evidence about the other. */
/** O3. How a run started. Anything else is shown as-is rather than guessed into one of these. */
export type DiscoveryTrigger = 'manual' | 'scheduled_sweep' | 'internal_test'

/** O3. What the sweep did with a scheduled run's results; `null` for a manual run. */
export interface DiscoveryAutoImport {
  imported: number
  already_in_registry: number
  archived_returned: number
  conflicts: number
  awaiting_import: number
}

export interface DiscoveryRunSummary {
  id: string
  status: DiscoveryRun['status']
  trigger: DiscoveryTrigger | string
  auto_import?: DiscoveryAutoImport | null
  environment: MetaEnvironment
  business_manager: { reference: string | null; name: string | null }
  read_as: { external_id: string | null; name: string | null }
  business_authority: BusinessAuthority
  started_at: string | null
  completed_at: string | null
  freshness: DiscoveryRun['freshness']
  failure_code: string | null
  failure_summary: string | null
  ad_accounts: Omit<DiscoveryAssetResult, 'reconciliation'>
  pixels: Omit<DiscoveryAssetResult, 'reconciliation'>
  business_users?: Omit<DiscoveryBusinessUsersResult, 'reconciliation'>
}

/** One row of the Overview discovery table: the latest run per connection, no reconciliation. */
export interface DiscoverySummaryRow {
  connection_id: string
  connection_label: string
  environment: MetaEnvironment
  run: {
    id: string
    status: DiscoveryRun['status']
    business_manager: { reference: string | null; name: string | null }
    read_as: { external_id: string | null; name: string | null }
    business_authority: BusinessAuthority
    completed_at: string | null
    freshness: DiscoveryRun['freshness']
    ad_accounts: {
      coverage_status: CoverageStatus
      count: number | null
      edges: Record<string, DiscoveryEdgeCoverage>
    }
    pixels: {
      coverage_status: CoverageStatus
      count: number | null
      edges: Record<string, DiscoveryEdgeCoverage>
    }
  } | null
}

export interface AccountCreationBatch {
  id: string
  meta_connection_id: string
  business_manager_external_id: string
  preview_hash: string
  confirmed_at: string | null
  created_at: string
}

export interface AccountCreationItem {
  id: string
  batch_id: string
  name: string
  currency: string
  country: string | null
  timezone: string | null
  status: MetaBatchItemStatus
  external_account_id: string | null
  synced_ad_account_id: string | null
  failure_code: string | null
  failure_summary: string | null
  retry_count: number
  last_attempted_at: string | null
}

export interface AccountCreationBatchDetail {
  batch: AccountCreationBatch
  items: AccountCreationItem[]
  current_preview_hash: string
}

export interface AccessShareBatch {
  id: string
  meta_connection_id: string
  preview_hash: string
  confirmed_at: string | null
  created_at: string
}

export interface AccessShareItem {
  id: string
  batch_id: string
  source_ad_account_id: string | null
  source_external_account_id: string
  recipient_reference: string
  role: string
  status: MetaBatchItemStatus
  access_grant_reference: string | null
  failure_code: string | null
  failure_summary: string | null
  retry_count: number
  last_attempted_at: string | null
}

export interface AccessShareBatchDetail {
  batch: AccessShareBatch
  items: AccessShareItem[]
  current_preview_hash: string
}

// -------------------------------------------------------------------- A8: Bulk Pixel share
export interface PixelShareBatch {
  id: string
  meta_connection_id: string
  preview_hash: string
  confirmed_at: string | null
  created_at: string
}

export interface PixelShareItem {
  id: string
  batch_id: string
  source_pixel_id: string | null
  source_external_pixel_id: string
  target_ad_account_id: string | null
  target_ad_account_external_id: string
  status: MetaBatchItemStatus
  access_grant_reference: string | null
  failure_code: string | null
  failure_summary: string | null
  retry_count: number
  last_attempted_at: string | null
}

export interface PixelShareBatchDetail {
  batch: PixelShareBatch
  items: PixelShareItem[]
  current_preview_hash: string
}

// ------------------------------------------------------------------- A9: team seats & devices
export type WorkspaceMemberStatus = 'invited' | 'active' | 'suspended' | 'deactivated'
export type AssignmentStatus = 'active' | 'revoked' | 'expired'
export type InvitationStatus =
  | 'draft'
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'cancelled'
  | 'archived'
export type A9Role = 'admin' | 'operator' | 'viewer'

export interface DeviceSession {
  id: string
  session_type: 'web'
  label: string
  browser_family: string | null
  os_family: string | null
  last_seen_at: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  revoked_reason: string | null
  is_current: boolean
}

export interface TeamSummary {
  seat_limit: number | null
  active_members: number
  available_seats: number | null
  pending_invitations: number
  plan_reference: string | null
}

export interface SeatPlan {
  id: string
  seat_limit: number
  plan_reference: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  user_id: string
  email: string
  full_name: string
  role: string
  status: WorkspaceMemberStatus
  is_archived: boolean
  assigned_business_manager_count: number
  assigned_ad_account_count: number
  active_session_count: number
  created_at: string
}

export interface Invitation {
  id: string
  email_normalized: string
  invited_role: string
  status: InvitationStatus
  token_last_four: string | null
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  revoked_at: string | null
  revoke_reason: string | null
  created_at: string
}

export interface InvitationCreated {
  invitation: Invitation
  invite_link_token: string
}

export interface Assignment {
  id: string
  member_id: string
  business_manager_id: string | null
  ad_account_id: string | null
  status: AssignmentStatus
  assigned_at: string
  revoked_at: string | null
  revoke_reason: string | null
}

export interface MemberAssignments {
  business_managers: Assignment[]
  ad_accounts: Assignment[]
}

export interface AccessPreview {
  is_owner: boolean
  business_manager_ids: string[]
  ad_account_ids: string[]
}

// ---- S1 spend tracking -------------------------------------------------------------------
// Money is always the string Meta returned. The units of amount_spent / spend_cap / balance are
// unverified, so nothing in the UI parses, divides, rounds or adds these values.

export type SpendFreshness = 'current' | 'stale' | 'never_observed' | 'not_observable'

export interface AccountSpendCompact {
  freshness: SpendFreshness
  observed_currency: string | null
  /** `spend_raw` is null when Meta returned no row for that day — never "0". */
  latest_complete_day: { date: string; spend_raw: string | null } | null
  /** O4. Optional: absent in responses older than O4. */
  not_observable_reason?: NotObservableReason | null
}

export interface AccountSpendPeriods {
  today_partial_raw: string | null
  last_7d_raw: string | null
  mtd_raw: string | null
}

export interface SpendDailyRaw {
  date_start: string
  date_stop: string
  spend: string
  account_currency: string | null
}

export interface SpendObservation {
  id: string
  observed_at: string
  status: 'succeeded' | 'failed'
  trigger: string
  failure_code: string | null
  failure_summary: string | null
  meta_connection_id: string | null
  reader_source: string | null
  read_as: { external_id: string | null; name: string | null } | null
  currency: string | null
  timezone_name: string | null
  account_status_raw: string | null
  disable_reason_raw: string | null
  amount_spent_raw: string | null
  spend_cap_raw: string | null
  balance_raw: string | null
  window_since: string | null
  window_until: string | null
  daily: SpendDailyRaw[]
}

export interface SpendDay {
  date: string
  spend_raw: string
  currency: string | null
  observation_id: string
  observed_at: string
}

export interface SpendView {
  ad_account_id: string
  freshness: SpendFreshness
  observable: boolean
  /** O4. The first missing link when the account cannot be read. */
  not_observable_reason?: NotObservableReason | null
  reader_source: string | null
  meta_connection_id: string | null
  stale_after_hours: number
  registry_currency: string | null
  observed_currency: string | null
  currency_mismatch: boolean | null
  insights_currency_conflict: boolean
  missing_input: string | null
  latest_observation: SpendObservation | null
  latest_attempt: {
    id: string
    observed_at: string
    status: 'succeeded' | 'failed'
    failure_code: string | null
    failure_summary: string | null
  } | null
  latest_complete_day: string | null
  daily: SpendDay[]
  days_without_row: string[]
  today_partial: (SpendDay & { label: string }) | null
  baseline: {
    median_raw: string
    currency: string | null
    days_used: string[]
    min_days_required: number
  } | null
  baseline_days_available: number
  /** S2. `null` when no observation carries an `account_status` code; absent on older backends. */
  platform_status?: PlatformStatusView | null
  /** C1/C2. Client budget and pacing evaluation. */
  budget_pacing?: BudgetPacingView | null
  disclaimer: string
}

export type BudgetPacingStatus =
  | 'unconfigured'
  | 'insufficient_data'
  | 'on_track'
  | 'overspending'
  | 'approaching_monthly_budget'
  | 'underspending'

export interface BudgetPacingView {
  client_name: string
  planned_daily_budget_raw: string | null
  planned_monthly_budget_raw: string | null
  currency: string | null
  latest_complete_day: string | null
  latest_day_spend_raw: string | null
  daily_utilization_pct: number | null
  month_prefix?: string | null
  mtd_spend_raw: string | null
  mtd_days_counted: number
  monthly_utilization_pct: number | null
  pacing_status: BudgetPacingStatus
}

export interface SpendCurrencyGroup {
  currency: string
  total_raw: string | null
  today_partial_raw?: string | null
  last_7d_raw?: string | null
  mtd_raw?: string | null
  days: string[]
  accounts_included: number
  accounts_without_row: number
  accounts_not_current: number
  accounts_currency_conflict: number
  complete: boolean
}

export interface SpendSummary {
  generated_at: string
  total_accounts: number
  freshness_counts: Record<SpendFreshness, number>
  /** S2. Counts per status class — never a score. `none`: no status code observed. */
  platform_status_counts?: Record<PlatformStatusClass, number>
  budget_pacing_counts?: Record<BudgetPacingStatus, number>
  accounts_unattributed: number
  currencies: SpendCurrencyGroup[]
  complete: boolean
  disclaimer: string
}

// ---- S2 Meta account status ---------------------------------------------------------------
// Meta's `account_status`, interpreted server-side through an allowlist. The raw code always
// travels with it. Nothing here is a verdict about the account.

export type PlatformAccountStatus =
  | 'active'
  | 'disabled'
  | 'unsettled'
  | 'pending_risk_review'
  | 'pending_settlement'
  | 'in_grace_period'
  | 'pending_closure'
  | 'closed'
  | 'unknown'

export type PlatformStatusClass = 'active' | 'blocking' | 'pending' | 'unknown' | 'none'

export interface PlatformStatusCompact {
  status: PlatformAccountStatus
  account_status_raw: string
  freshness: SpendFreshness
  observed_at: string
}

export interface PlatformStatusView extends PlatformStatusCompact {
  status_class: PlatformStatusClass
  disable_reason: string | null
  disable_reason_raw: string | null
  observation_id: string
  observation_status: 'succeeded' | 'failed'
  failure_code: string | null
  reader_source: string | null
  previous: {
    account_status_raw: string | null
    status: PlatformAccountStatus | null
    observed_at: string | null
  } | null
  since_observed_at: string | null
  disclaimer: string
}

export type TwoFactorMethod = 'app' | 'sms' | 'security_key' | 'none' | 'unknown'
export type IdentityBusinessRole = 'admin' | 'employee' | 'unknown'
export type IdentityOwnershipType = 'agency_owned' | 'client_provided'

export interface FacebookIdentity {
  id: string
  label: string
  status: ReferenceStatus
  two_factor_method: TwoFactorMethod
  vault_reference: string
  email_hint: string | null
  owner_member_id: string | null
  owner_member_name: string | null
  via: 'direct' | 'business_manager'
  role: IdentityBusinessRole | null
  ownership_type?: IdentityOwnershipType
  client_name?: string
  device_label?: string
  browser_profile_label?: string
  network_label?: string
}

export interface FacebookIdentitySummary {
  id: string
  business_manager_count: number
  ad_account_count: number
  owner_member_name: string | null
  shared_browser_profile_with?: string[]
  shared_network_with?: string[]
}

export interface FacebookBusinessLink {
  id: string
  business_manager_id: string
  business_manager_name: string
  business_manager_external_id: string | null
  role: IdentityBusinessRole
  note: string
  linked_at: string
  unlinked_at: string | null
}

export interface FacebookIdentityProfile {
  business_links: FacebookBusinessLink[]
  ad_accounts: Pick<AdAccount, 'id' | 'display_name' | 'external_account_id' | 'business_manager_id' | 'status'>[]
  readers: { id: string; label: string; status: string }[]
  owner_member_name: string | null
  has_full_email: boolean
  can_reveal_email: boolean
  shared_browser_profile_with?: string[]
  shared_network_with?: string[]
}

export interface RevealPinStatus { is_set: boolean; locked_until: string | null }
