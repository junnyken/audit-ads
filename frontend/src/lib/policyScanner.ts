import { api } from './api'

export type PolicyMode = 'ad_copy' | 'page_warmup'
export type PolicyVerdict = 'safe' | 'warning' | 'high_risk'

export interface PolicyFinding {
  id: string
  category: string
  category_label: string
  severity: 'high' | 'medium'
  matched_text: string
  reason: string
  safe_replacement: string
}

export interface PolicyScanResult {
  score: number
  verdict: PolicyVerdict
  mode: PolicyMode
  findings_count: number
  findings: PolicyFinding[]
  sanitized_text: string
  sanitized_headline: string
}

export interface WorkspaceAiConfig {
  enabled: boolean
  provider: 'gemini' | 'openai' | 'claude'
  model: string
  key_configured: boolean
  key_mask: string
  available_models: Record<string, string>
  updated_at: string | null
}

export interface AiGenerateResult {
  ok: boolean
  task: 'rewrite_safe' | 'page_warmup'
  engine: 'workspace_ai' | 'deterministic_rules'
  provider?: string
  model?: string
  ai_fallback_reason?: string
  rewritten_text: string
  rewritten_headline?: string
  variants: string[]
  before_score?: number
  after_score: number
  after_scan: PolicyScanResult
}

export interface GuardrailOverrideResult {
  ok: boolean
  via_id: string
  via_label: string
  via_tier: string
  target_scope: string
  override_grant: string
  expires_in_seconds: number
  expires_at: string
}

export function emptyPolicyScanResult(
  mode: PolicyMode = 'ad_copy',
  text = '',
  headline = '',
): PolicyScanResult {
  return {
    score: 100,
    verdict: 'safe',
    mode,
    findings_count: 0,
    findings: [],
    sanitized_text: text,
    sanitized_headline: headline,
  }
}

const _SCAN_CACHE_MAX = 100
const _scanCache = new Map<string, PolicyScanResult>()

export function clearPolicyScanCache(): void {
  _scanCache.clear()
}

export const aiStudioApi = {
  getConfig: () => api.get<WorkspaceAiConfig>('/api/v1/ai-studio/config'),
  saveConfig: (body: {
    provider?: 'gemini' | 'openai' | 'claude'
    model?: string
    enabled?: boolean
    provider_key?: string
    clear_key?: boolean
  }) => api.post<WorkspaceAiConfig>('/api/v1/ai-studio/config', body),
  testConnection: (body?: { provider?: string; model?: string; provider_key?: string }) =>
    api.post<{ ok: boolean; provider: string; model: string; reply_preview: string }>(
      '/api/v1/ai-studio/test',
      body ?? {},
    ),
  checkPolicyServer: async (body: {
    text: string
    headline?: string
    mode?: PolicyMode
    is_new_page?: boolean
  }): Promise<PolicyScanResult> => {
    const mode = body.mode ?? 'ad_copy'
    const headline = body.headline ?? ''
    const text = body.text ?? ''
    if (!text.trim() && !headline.trim()) {
      return emptyPolicyScanResult(mode, text, headline)
    }
    const key = `${mode}|${Boolean(body.is_new_page)}|${headline}|${text}`
    const cached = _scanCache.get(key)
    if (cached) return cached
    const res = await api.post<PolicyScanResult>('/api/v1/ai-studio/policy-check', {
      text,
      headline,
      mode,
      is_new_page: Boolean(body.is_new_page),
    })
    if (_scanCache.size >= _SCAN_CACHE_MAX) {
      const oldestKey = _scanCache.keys().next().value
      if (oldestKey !== undefined) _scanCache.delete(oldestKey)
    }
    _scanCache.set(key, res)
    return res
  },
  generate: (body: {
    task: 'rewrite_safe' | 'page_warmup'
    text?: string
    headline?: string
    page_name?: string
    category?: string
    mode?: PolicyMode
    tone?: string
  }) => api.post<AiGenerateResult>('/api/v1/ai-studio/generate', body),
  requestOwnerOverride: (body: {
    via_id: string
    via_label: string
    via_tier: 'vault' | '72h_lock'
    target_scope: string
    reason: string
  }) => api.post<GuardrailOverrideResult>('/api/v1/via-guardrail/override', body),
}
