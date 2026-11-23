import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import * as policyScanner from '../lib/policyScanner'
import { aiStudioApi, clearPolicyScanCache } from '../lib/policyScanner'
import {
  evaluateViaActionGuardrail,
  getValidOwnerOverrideGrant,
  type GuardrailBlockedDecision,
} from '../lib/chromeProfileLauncher'
import { PolicyPreCheckStudio } from '../components/PolicyPreCheckStudio'
import { ViaGuardrailDialog } from '../components/ViaGuardrailDialog'
import { axeOptions, wrap } from './u1d-helpers'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
}))

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))

beforeEach(() => {
  sessionStorage.clear()
  clearPolicyScanCache()
  apiMock.get.mockImplementation((path: string) => {
    if (path.includes('/ai-studio/config')) {
      return Promise.resolve({
        enabled: false,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        key_configured: false,
        key_mask: '',
        available_models: {
          gemini: 'gemini-2.0-flash',
          openai: 'gpt-4o-mini',
          claude: 'claude-3-5-haiku-latest',
        },
        updated_at: null,
      })
    }
    return Promise.resolve({})
  })
  apiMock.post.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('v5.1 Hybrid AI Policy & Role Guardrail', () => {
  it('strips local regex rules from client bundle and delegates policy scans to server API with caching', async () => {
    const exported = policyScanner as Record<string, unknown>
    expect(exported.LOCAL_RULES).toBeUndefined()
    expect(exported.scanAdPolicyLocal).toBeUndefined()

    apiMock.post.mockResolvedValue({
      score: 38,
      verdict: 'high_risk',
      mode: 'ad_copy',
      findings_count: 2,
      findings: [
        {
          id: 'medical_1',
          category: 'medical_exaggeration',
          category_label: 'Cam kết y khoa quá mức',
          severity: 'high',
          matched_text: 'Cam kết 100%',
          reason: 'Khẳng định tuyệt đối dễ vi phạm chính sách Meta.',
          safe_replacement: 'Hỗ trợ cải thiện',
        },
        {
          id: 'personal_1',
          category: 'personal_attributes',
          category_label: 'Thuộc tính cá nhân',
          severity: 'high',
          matched_text: 'bạn đang béo',
          reason: 'Nhắm trực tiếp khuyết điểm ngoại hình.',
          safe_replacement: 'vóc dáng cân đối',
        },
      ],
      sanitized_text: 'Hỗ trợ cải thiện vóc dáng cân đối an toàn',
      sanitized_headline: '',
    })

    const first = await aiStudioApi.checkPolicyServer({
      text: 'Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!!',
      mode: 'ad_copy',
    })
    const second = await aiStudioApi.checkPolicyServer({
      text: 'Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!!',
      mode: 'ad_copy',
    })

    expect(apiMock.post).toHaveBeenCalledTimes(1)
    expect(apiMock.post).toHaveBeenCalledWith('/api/v1/ai-studio/policy-check', {
      text: 'Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!!',
      headline: '',
      mode: 'ad_copy',
      is_new_page: false,
    })
    expect(first.verdict).toBe('high_risk')
    expect(second.score).toBe(38)
  })

  it('renders PolicyPreCheckStudio, cleans text via server scan on 1-click, and passes axe accessibility', async () => {
    apiMock.post.mockImplementation((path: string, payload: { text?: string }) => {
      if (path === '/api/v1/ai-studio/policy-check') {
        const text = payload?.text ?? ''
        if (text.includes('Cam kết 100%')) {
          return Promise.resolve({
            score: 42,
            verdict: 'high_risk',
            mode: 'ad_copy',
            findings_count: 1,
            findings: [
              {
                id: 'medical_exaggeration',
                category: 'medical_exaggeration',
                category_label: 'Cam kết y khoa quá mức',
                severity: 'high',
                matched_text: 'Cam kết 100%',
                reason: 'Vi phạm khẳng định tuyệt đối.',
                safe_replacement: 'Hỗ trợ cải thiện',
              },
            ],
            sanitized_text: 'Hỗ trợ cải thiện vóc dáng an toàn',
            sanitized_headline: '',
          })
        }
        return Promise.resolve({
          score: 100,
          verdict: 'safe',
          mode: 'ad_copy',
          findings_count: 0,
          findings: [],
          sanitized_text: text,
          sanitized_headline: '',
        })
      }
      return Promise.resolve({})
    })

    const onApplyText = vi.fn()
    const { container } = wrap(
      <PolicyPreCheckStudio
        mode="ad_copy"
        initialText="Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!!"
        onApplyText={onApplyText}
      />,
    )

    expect(await screen.findByText(/Phát hiện 1 điểm có nguy cơ vi phạm chính sách Meta/)).toBeInTheDocument()
    expect(screen.getByText(/Nguy cơ cao khóa TKQC \/ Page/)).toBeInTheDocument()

    const cleanBtn = screen.getByRole('button', { name: /Làm sạch nhanh \(Luật 0đ\)/ })
    fireEvent.click(cleanBtn)

    await waitFor(() => {
      expect(onApplyText).toHaveBeenCalledWith('Hỗ trợ cải thiện vóc dáng an toàn', '')
    })
    await waitFor(() => {
      expect(screen.getByText(/Điểm An toàn: 100\/100/)).toBeInTheDocument()
    })
    expect((await axe(container, axeOptions)).violations).toEqual([])
  })

  it('enforces multi-layer role guardrail for vault Vias and 72h soak Vias', () => {
    const vaultAds = evaluateViaActionGuardrail({
      viaId: 'via-vault-1',
      viaLabel: 'Via Tổng BM #1',
      viaTier: 'vault',
      isSoaking72h: false,
      targetUrl: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123',
    })
    expect(vaultAds.allowed).toBe(false)
    if (!vaultAds.allowed) {
      expect(vaultAds.code).toBe('vault_ads_blocked')
    }

    const vaultBm = evaluateViaActionGuardrail({
      viaId: 'via-vault-1',
      viaLabel: 'Via Tổng BM #1',
      viaTier: 'vault',
      isSoaking72h: false,
      targetUrl: 'https://business.facebook.com/settings',
    })
    expect(vaultBm.allowed).toBe(true)

    const soakBm = evaluateViaActionGuardrail({
      viaId: 'via-soak-1',
      viaLabel: 'Via Mới 72h',
      viaTier: 'standby',
      isSoaking72h: true,
      targetUrl: 'https://business.facebook.com/overview',
    })
    expect(soakBm.allowed).toBe(false)
    if (!soakBm.allowed) {
      expect(soakBm.code).toBe('soak_72h_blocked')
    }

    const soakKeepAlive = evaluateViaActionGuardrail({
      viaId: 'via-soak-1',
      viaLabel: 'Via Mới 72h',
      viaTier: 'standby',
      isSoaking72h: true,
      targetUrl: 'https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0',
    })
    expect(soakKeepAlive.allowed).toBe(true)
  })

  it('blocks non-owners in ViaGuardrailDialog and grants 15m audited override for owners', async () => {
    const decision: GuardrailBlockedDecision = {
      allowed: false,
      code: 'vault_ads_blocked',
      viaId: 'via-vault-99',
      viaLabel: 'Via Tổng Giữ BM #99',
      viaTier: 'vault',
      targetUrl: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
      targetScope: 'ads_manager_campaign',
      reason: 'Via Lớp 1 được khóa truy cập Trình quản lý Quảng cáo.',
      recommendedAlternative: 'Chuyển sang Via Lớp 2 Lên Camp.',
    }

    const nonOwnerView = wrap(
      <ViaGuardrailDialog
        open
        onOpenChange={() => undefined}
        decision={decision}
        isOwner={false}
        onOverrideGranted={vi.fn()}
      />,
    )
    expect(screen.getByText(/Tài khoản nhân sự không có quyền mở khóa/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mở khóa ngoại lệ 15 phút/ })).not.toBeInTheDocument()
    expect((await axe(nonOwnerView.baseElement, axeOptions)).violations).toEqual([])
    nonOwnerView.unmount()

    const onOverrideGranted = vi.fn()
    apiMock.post.mockResolvedValueOnce({
      ok: true,
      via_id: 'via-vault-99',
      via_label: 'Via Tổng Giữ BM #99',
      via_tier: 'vault',
      target_scope: 'ads_manager_campaign',
      override_grant: 'vgo1.signed.token.payload',
      expires_in_seconds: 900,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    })

    const ownerView = wrap(
      <ViaGuardrailDialog
        open
        onOpenChange={() => undefined}
        decision={decision}
        isOwner
        onOverrideGranted={onOverrideGranted}
      />,
    )

    const reasonInput = screen.getByPlaceholderText(/Nhập lý do bắt buộc/)
    fireEvent.change(reasonInput, { target: { value: 'Rà soát hóa đơn BM khẩn' } })
    fireEvent.click(screen.getByRole('button', { name: /Mở khóa ngoại lệ 15 phút/ }))

    await waitFor(() => {
      expect(onOverrideGranted).toHaveBeenCalledWith('vgo1.signed.token.payload')
    })
    expect(apiMock.post).toHaveBeenCalledWith('/api/v1/via-guardrail/override', {
      via_id: 'via-vault-99',
      via_label: 'Via Tổng Giữ BM #99',
      via_tier: 'vault',
      target_scope: 'ads_manager_campaign',
      reason: 'Rà soát hóa đơn BM khẩn',
    })
    expect(getValidOwnerOverrideGrant('via-vault-99')).toBe('vgo1.signed.token.payload')
    const afterOverride = evaluateViaActionGuardrail({
      viaId: 'via-vault-99',
      viaLabel: 'Via Tổng Giữ BM #99',
      viaTier: 'vault',
      targetUrl: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
    })
    expect(afterOverride.allowed).toBe(true)
    expect((await axe(ownerView.baseElement, axeOptions)).violations).toEqual([])
  })
})
