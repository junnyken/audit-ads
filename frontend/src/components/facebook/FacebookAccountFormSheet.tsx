import { useEffect, useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type {
  FacebookIdentityProfile,
  IdentityBusinessRole,
  IdentityOwnershipType,
  Paged,
  ReferenceRecord,
  TeamMember,
} from '../../lib/types'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'
import { FormSheet } from '../page/FormSheet'
import {
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadSwitchyOmegaConfig,
  fetchRealLocalChromeProfiles,
  launchInAssignedChromeProfile,
  parseProxyString,
} from '../../lib/chromeProfileLauncher'

const TWO_FACTOR_OPTIONS = ['unknown', 'app', 'sms', 'security_key', 'none'] as const
const STATUS_OPTIONS = ['unknown', 'active', 'inactive', 'restricted'] as const
const OWNERSHIP_OPTIONS: IdentityOwnershipType[] = ['agency_owned', 'client_provided']
const BM_ROLES: IdentityBusinessRole[] = ['admin', 'employee', 'unknown']

export function FacebookAccountFormSheet({
  open,
  onClose,
  record,
  members = [],
  canAssignOwner = false,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  record?: ReferenceRecord | null
  members?: TeamMember[]
  canAssignOwner?: boolean
  onSaved?: (saved: ReferenceRecord) => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const formId = useId()

  const [autoToken, setAutoToken] = useState('')
  const [autoConnectMsg, setAutoConnectMsg] = useState<string | null>(null)

  const [label, setLabel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [externalId, setExternalId] = useState('')
  const [status, setStatus] = useState('active')
  const [ownerMemberId, setOwnerMemberId] = useState('')
  const [twoFactor, setTwoFactor] = useState('app')
  const [vaultReference, setVaultReference] = useState('')
  const [recoveryNote, setRecoveryNote] = useState('')
  const [notes, setNotes] = useState('')
  const [ownershipType, setOwnershipType] = useState<IdentityOwnershipType>('agency_owned')
  const [clientName, setClientName] = useState('')
  const [deviceLabel, setDeviceLabel] = useState('')
  const [browserProfileLabel, setBrowserProfileLabel] = useState('')
  const [networkLabel, setNetworkLabel] = useState('')
  const [selectedBmId, setSelectedBmId] = useState('')
  const [selectedBmRole, setSelectedBmRole] = useState<IdentityBusinessRole>('admin')

  const bms = useQuery({
    queryKey: ['business-managers', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
    enabled: open,
    retry: false,
  })

  const localChromeProfiles = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    initialData: WORKSTATION_REAL_CHROME_PROFILES,
    enabled: open,
    retry: false,
  })

  const profile = useQuery({
    queryKey: ['facebook-identities', record?.id ?? '', 'profile'],
    queryFn: () => api.get<FacebookIdentityProfile>(`/api/v1/personal-account-references/${record!.id}/profile`),
    enabled: open && Boolean(record?.id),
    retry: false,
  })

  const unlinkBm = useMutation({
    mutationFn: (linkId: string) =>
      api.post(`/api/v1/personal-account-references/${record!.id}/business-links/${linkId}/unlink`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  useEffect(() => {
    if (!open) return
    setAutoToken('')
    setAutoConnectMsg(null)
    setLabel(String(record?.label ?? ''))
    setDisplayName(String(record?.display_name ?? ''))
    setExternalId(String(record?.external_reference_id ?? ''))
    setStatus(String(record?.status ?? 'active'))
    setOwnerMemberId(String(record?.owner_member_id ?? ''))
    setTwoFactor(String(record?.two_factor_method ?? 'app'))
    setVaultReference(String(record?.vault_reference ?? ''))
    setRecoveryNote(String(record?.recovery_note ?? ''))
    setNotes(String(record?.notes ?? ''))
    setOwnershipType((record?.ownership_type as IdentityOwnershipType) ?? 'agency_owned')
    setClientName(String(record?.client_name ?? ''))
    setDeviceLabel(String(record?.device_label ?? ''))
    setBrowserProfileLabel(String(record?.browser_profile_label ?? ''))
    const rawNet = String(record?.network_label ?? '')
    setNetworkLabel(
      rawNet.toLowerCase().startsWith('vnpt static ip — line #') ||
        rawNet.toLowerCase().startsWith('fpt static ip — line #') ||
        rawNet.toLowerCase().startsWith('viettel residential — line #')
        ? ''
        : rawNet,
    )
    setSelectedBmId('')
    setSelectedBmRole('admin')
  }, [open, record])

  const autoConnect = useMutation({
    mutationFn: () =>
      api.post<{
        id: string
        label: string
        external_reference_id: string
        email_hint: string | null
        linked_business_managers: string[]
      }>('/api/v1/facebook-identities/auto-connect-token', {
        access_token: autoToken.trim(),
        browser_profile_label: browserProfileLabel.trim(),
        network_label: networkLabel.trim(),
      }),
    onSuccess: (res) => {
      setLabel(res.label)
      setDisplayName(res.label)
      setExternalId(res.external_reference_id || '')
      setAutoConnectMsg(
        `Đã kết nối tự động: ${res.label} (ID: ${res.external_reference_id})${
          res.linked_business_managers.length > 0 ? ` · BM: ${res.linked_business_managers.join(', ')}` : ''
        }`,
      )
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      if (!record) {
        setTimeout(() => onClose(), 900)
      }
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const cleanLabel = label.trim()
      const payload: Record<string, unknown> = {
        label: cleanLabel,
        display_name: (displayName.trim() || cleanLabel),
        external_reference_id: externalId.trim() || null,
        status,
        two_factor_method: twoFactor,
        vault_reference: vaultReference.trim(),
        recovery_note: recoveryNote.trim(),
        notes: notes.trim(),
        ownership_type: ownershipType,
        client_name: clientName.trim(),
        device_label: deviceLabel.trim(),
        browser_profile_label: browserProfileLabel.trim(),
        network_label: networkLabel.trim(),
      }
      if (canAssignOwner) {
        payload.owner_member_id = ownerMemberId || null
      }
      const saved = record
        ? await api.patch<ReferenceRecord>(`/api/v1/personal-account-references/${record.id}`, payload)
        : await api.post<ReferenceRecord>('/api/v1/personal-account-references', payload)

      if (selectedBmId) {
        const alreadyLinked = (profile.data?.business_links ?? []).some(
          (l) => l.business_manager_id === selectedBmId,
        )
        if (!alreadyLinked) {
          try {
            await api.post(`/api/v1/personal-account-references/${saved.id}/business-links`, {
              business_manager_id: selectedBmId,
              role: selectedBmRole,
              note: '',
            })
          } catch {
            // Ignore duplicate link errors
          }
        }
      }
      return saved
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      onSaved?.(saved)
      onClose()
    },
  })

  const bmList = Array.isArray(bms.data?.items) ? bms.data.items : []
  const existingLinks = Array.isArray(profile.data?.business_links) ? profile.data.business_links : []
  const chromeList = localChromeProfiles.data ?? WORKSTATION_REAL_CHROME_PROFILES

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={record ? t('fb.form.editTitle') : t('fb.form.addTitle')}
      description="Chỉ cần chọn Hồ sơ Chrome thật (và Proxy nếu có), hoặc dán Token để tự động điền toàn bộ thông tin từ Meta."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={!label.trim() || save.isPending}>
            {t('fb.pin.setup.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (label.trim()) save.mutate()
        }}
      >
        {/* KHỐI 1: TỰ ĐỘNG LẤY THÔNG TIN BẰNG TOKEN (KHÔNG CẦN NHẬP TAY) */}
        <div className="rounded-md border border-brand/40 bg-brand-soft/15 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-brand-text">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Kết nối tự động bằng Token Facebook (Tự động lấy Tên, ID, Email & BM)</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="input flex-1 font-mono text-xs"
              placeholder="Dán Token EAAB... của Via vào đây để tự động tạo & điền hết thông tin"
              value={autoToken}
              onChange={(e) => setAutoToken(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={!autoToken.trim() || autoConnect.isPending}
              onClick={() => autoConnect.mutate()}
            >
              {autoConnect.isPending ? 'Đang lấy...' : '⚡ Tự động lấy'}
            </Button>
          </div>
          {autoConnectMsg && (
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓ {autoConnectMsg}</p>
          )}
          {autoConnect.isError && <ErrorState error={autoConnect.error} compact />}
        </div>

        {/* KHỐI 2: 3 TRƯỜNG CỐT LÕI (TÊN VIA · HỒ SƠ CHROME THẬT · PROXY THẬT) */}
        <Field htmlFor={`${formId}-label`} label="1. Tên Via / Tài khoản Facebook" required>
          <input
            id={`${formId}-label`}
            className="input"
            required
            maxLength={200}
            placeholder="VD: Thiên Triều Mới, Via 2..."
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              if (!displayName) setDisplayName(e.target.value)
            }}
          />
        </Field>

        <Field htmlFor={`${formId}-browser`} label="2. Hồ sơ Google Chrome thật trên máy tính (Mở 1 chạm)">
          <div className="space-y-1.5">
            <select
              id={`${formId}-browser`}
              aria-label="Chọn môi trường trình duyệt"
              className="input text-xs"
              value={browserProfileLabel}
              onChange={(e) => {
                const chosen = e.target.value
                setBrowserProfileLabel(chosen)
                if (!label.trim() && chosen) {
                  const shortName = chosen.replace(/^Chrome\s*—\s*/i, '').split(' (')[0]
                  setLabel(shortName)
                }
              }}
              data-testid="fb-browser-input"
            >
              <option value="">— Chọn Hồ sơ Google Chrome thật trên máy tính ({chromeList.length} hồ sơ) —</option>
              {chromeList.map((cp) => (
                <option key={cp.folder} value={cp.label}>
                  {cp.label}
                </option>
              ))}
              {browserProfileLabel && !chromeList.some((c) => c.label === browserProfileLabel) && (
                <option value={browserProfileLabel}>{browserProfileLabel}</option>
              )}
            </select>
            {browserProfileLabel.trim() && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-muted">
                  Hồ sơ đã chọn: <strong className="text-ink">{browserProfileLabel}</strong>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    launchInAssignedChromeProfile(
                      'https://business.facebook.com/overview',
                      browserProfileLabel,
                      label,
                      networkLabel,
                    )
                  }
                >
                  🚀 Mở thử Chrome
                </Button>
              </div>
            )}
          </div>
        </Field>

        <Field htmlFor={`${formId}-network`} label="3. Proxy riêng (Tùy chọn — Bỏ trống nếu dùng Mạng gốc)">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                id={`${formId}-network`}
                className="input flex-1 font-mono text-xs"
                maxLength={160}
                placeholder="Dán IP:Port:User:Pass (VD: 103.145.67.89:8080:user:pass) hoặc để trống"
                value={networkLabel}
                onChange={(e) => setNetworkLabel(e.target.value)}
                data-testid="fb-network-input"
              />
              {parseProxyString(networkLabel) && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadSwitchyOmegaConfig(networkLabel, label)}
                >
                  🔌 SwitchyOmega (.bak)
                </Button>
              )}
            </div>
            <p className="text-[11px] text-ink-muted">
              Để trống nếu chạy trực tiếp trên Wifi/Mạng gốc. Chỉ dán khi bạn có Proxy thật muốn bọc riêng cho Via này.
            </p>
          </div>
        </Field>

        {/* Liên kết BM (hiện gọn nếu đã có hoặc muốn gắn thêm) */}
        <div className="rounded-md border border-line bg-surface-muted p-3 space-y-2">
          <p className="text-xs font-semibold text-ink">Business Manager đang cầm ({existingLinks.length})</p>
          {existingLinks.length > 0 && (
            <ul className="space-y-1">
              {existingLinks.map((lnk) => (
                <li
                  key={lnk.id}
                  className="flex items-center justify-between gap-2 rounded border border-line bg-surface px-2.5 py-1 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{lnk.business_manager_name}</span>
                    <Badge tone="neutral">{t(`fb.role.${lnk.role}` as never)}</Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={unlinkBm.isPending}
                    onClick={() => unlinkBm.mutate(lnk.id)}
                  >
                    {t('fb.form.unlink')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field htmlFor={`${formId}-bm`} label="Gắn thêm vào BM">
              <select
                id={`${formId}-bm`}
                className="input text-xs"
                value={selectedBmId}
                onChange={(e) => setSelectedBmId(e.target.value)}
              >
                <option value="">— Không gắn thêm —</option>
                {bmList.map((bm) => (
                  <option key={bm.id} value={bm.id}>
                    {String(bm.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor={`${formId}-bm-role`} label={t('fb.form.bmRole')}>
              <select
                id={`${formId}-bm-role`}
                className="input text-xs"
                value={selectedBmRole}
                onChange={(e) => setSelectedBmRole(e.target.value as IdentityBusinessRole)}
              >
                {BM_ROLES.map((roleOpt) => (
                  <option key={roleOpt} value={roleOpt}>
                    {t(`fb.role.${roleOpt}` as never)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        {/* KHỐI 3: TÙY CHỌN NÂNG CAO (THU GỌN ĐỂ KHÔNG PHẢI NHẬP NHIỀU) */}
        <details className="rounded-md border border-line bg-surface-muted/50 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink-muted hover:text-ink">
            ⚙️ Tùy chọn nâng cao (ID Meta, 2FA, Người giữ, Ghi chú — Không bắt buộc)
          </summary>
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field htmlFor={`${formId}-ext`} label={t('res.f.externalReferenceId')}>
                <input
                  id={`${formId}-ext`}
                  className="input font-mono text-xs"
                  maxLength={120}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </Field>
              <Field htmlFor={`${formId}-2fa`} label={t('fb.twoFactor')}>
                <select
                  id={`${formId}-2fa`}
                  className="input text-xs"
                  value={twoFactor}
                  onChange={(e) => setTwoFactor(e.target.value)}
                >
                  {TWO_FACTOR_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(`twoFactor.${opt}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field htmlFor={`${formId}-ownership`} label={t('fb.ownership')}>
                <select
                  id={`${formId}-ownership`}
                  className="input text-xs"
                  value={ownershipType}
                  onChange={(e) => setOwnershipType(e.target.value as IdentityOwnershipType)}
                  data-testid="fb-ownership-select"
                >
                  {OWNERSHIP_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(`fb.ownership.${opt}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field htmlFor={`${formId}-status`} label={t('res.f.status')}>
                <select
                  id={`${formId}-status`}
                  className="input text-xs"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {enumLabel('refStatus', opt)}
                    </option>
                  ))}
                </select>
              </Field>
              {canAssignOwner && (
                <Field htmlFor={`${formId}-owner`} label={t('fb.owner')}>
                  <select
                    id={`${formId}-owner`}
                    className="input text-xs"
                    value={ownerMemberId}
                    onChange={(e) => setOwnerMemberId(e.target.value)}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name || m.email}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <Field htmlFor={`${formId}-notes`} label={t('res.f.notes')}>
              <textarea
                id={`${formId}-notes`}
                className="input min-h-[3.5rem] text-xs"
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
        </details>

        {save.isError && <ErrorState error={save.error} compact />}
      </form>
    </FormSheet>
  )
}
