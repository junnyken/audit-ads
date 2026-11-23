import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { scanAdPolicyLocal } from '../lib/policyScanner'
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
  it('scans all 7 Meta policy categories deterministically and raises score with sanitized_text', () => {
    const riskyAd =
      'THONG BAO KHAN CAP GIAM GIA Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!! Hàng rep 1:1 bao đậu nợ xấu share ngay để nhận https://bit.ly/uu-dai'
    const res = scanAdPolicyLocal(riskyAd, { mode: 'ad_copy' })
    const categories = new Set(res.findings.map((f) => f.category))

    expect(categories.has('medical_exaggeration')).toBe(true)
    expect(categories.has('personal_attributes')).toBe(true)
    expect(categories.has('before_after_rapid')).toBe(true)
    expect(categories.has('financial_claims')).toBe(true)
    expect(categories.has('restricted_products_trademark')).toBe(true)
    expect(categories.has('engagement_spam_format')).toBe(true)
    expect(res.verdict).toBe('high_risk')
    expect(res.score).toBeLessThan(60)

    const warmupRisky = scanAdPolicyLocal('Mua hàng giá chỉ 99k gọi ngay 0912345678', {
      mode: 'page_warmup',
      isNewPage: true,
    })
    expect(warmupRisky.findings.some((f) => f.category === 'new_page_hard_sell')).toBe(true)
    const cleanedWarmup = scanAdPolicyLocal(warmupRisky.sanitized_text, {
      mode: 'page_warmup',
      isNewPage: true,
    })
    expect(cleanedWarmup.score).toBeGreaterThanOrEqual(85)

    const cleanableAd = scanAdPolicyLocal(
      'Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!! Hàng rep 1:1 bao đậu nợ xấu share ngay để nhận',
      { mode: 'ad_copy' },
    )
    const rescannedClean = scanAdPolicyLocal(cleanableAd.sanitized_text, { mode: 'ad_copy' })
    expect(rescannedClean.score).toBeGreaterThanOrEqual(85)
    expect(rescannedClean.verdict).toBe('safe')
  })

  it('renders PolicyPreCheckStudio, cleans text on 1-click, and passes axe accessibility', async () => {
    const onApplyText = vi.fn()
    const { container } = wrap(
      <PolicyPreCheckStudio
        mode="ad_copy"
        initialText="Cam kết 100% bạn đang béo giảm 5kg trong 7 ngày!!!"
        onApplyText={onApplyText}
      />,
    )

    expect(await screen.findByText(/Phát hiện \d+ điểm có nguy cơ vi phạm chính sách Meta/)).toBeInTheDocument()
    expect(screen.getByText(/Nguy cơ cao khóa TKQC \/ Page/)).toBeInTheDocument()

    const cleanBtn = screen.getByRole('button', { name: /Làm sạch nhanh \(Luật 0đ\)/ })
    fireEvent.click(cleanBtn)

    await waitFor(() => {
      expect(onApplyText).toHaveBeenCalled()
    })
    expect(screen.getByText(/Điểm An toàn: 100\/100/)).toBeInTheDocument()
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
