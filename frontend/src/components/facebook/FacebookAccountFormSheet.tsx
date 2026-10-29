import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
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

const TWO_FACTOR_OPTIONS = ['unknown', 'app', 'sms', 'security_key', 'none'] as const
const STATUS_OPTIONS = ['unknown', 'active', 'inactive', 'restricted'] as const
const OWNERSHIP_OPTIONS: IdentityOwnershipType[] = ['agency_owned', 'client_provided']
const BM_ROLES: IdentityBusinessRole[] = ['admin', 'employee', 'unknown']

const DEVICE_PRESETS = [
  'Máy trạm Agency #1 (Admin)',
  'Máy trạm Agency #2 (Media Buyer)',
  'Máy trạm Agency #3 (Backup)',
  'VPS Windows Cloud #1 (AdsOps)',
  'VPS Windows Cloud #2 (AdsOps)',
  'Laptop Vận hành Ads (Từ xa)',
  'MacBook Pro Agency',
]

const BROWSER_ENV_PRESETS = [
  { provider: 'Chrome', name: 'Chrome Profile' },
  { provider: 'AdsPower', name: 'AdsPower Antidetect' },
  { provider: 'Hidemyacc', name: 'Hidemyacc Antidetect' },
  { provider: 'Genlogin', name: 'Genlogin Antidetect' },
  { provider: 'GoLogin', name: 'GoLogin Antidetect' },
  { provider: 'Dolphin{anty}', name: 'Dolphin{anty}' },
  { provider: 'MoreLogin', name: 'MoreLogin Antidetect' },
  { provider: 'Multilogin', name: 'Multilogin' },
]

const PROXY_ISP_PRESETS = [
  { provider: 'VNPT Static IP', name: 'VNPT IP Tĩnh Doanh Nghiệp (VN)', protocol: 'https', region: 'Ho Chi Minh' },
  { provider: 'Viettel Residential', name: 'Viettel IP Dân Cư Tĩnh (VN)', protocol: 'https', region: 'Ha Noi' },
  { provider: 'FPT Static IP', name: 'FPT Telecom IP Tĩnh (VN)', protocol: 'https', region: 'Ho Chi Minh' },
  { provider: 'Mobile 4G/5G VN', name: 'Proxy 4G/5G Di Động VN (Mobifone/Viettel)', protocol: 'http', region: 'Viet Nam' },
  { provider: '922Proxy VN', name: '922Proxy / BrightData Dân Cư VN', protocol: 'socks5', region: 'Ho Chi Minh' },
  { provider: 'Static IP US/SG', name: 'Proxy Tĩnh Quốc Tế (US / Singapore)', protocol: 'https', region: 'Singapore' },
]

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

  const browserProfiles = useQuery({
    queryKey: ['browser-profile-references', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/browser-profile-references?page_size=200'),
    enabled: open,
    retry: false,
  })

  const proxyReferences = useQuery({
    queryKey: ['proxy-references', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/proxy-references?page_size=200'),
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
    setNetworkLabel(String(record?.network_label ?? ''))
    setSelectedBmId('')
    setSelectedBmRole('admin')
  }, [open, record])

  const browserList = Array.isArray(browserProfiles.data?.items) ? browserProfiles.data.items : []
  const proxyList = Array.isArray(proxyReferences.data?.items) ? proxyReferences.data.items : []

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        label: label.trim(),
        display_name: displayName.trim(),
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

      // Auto-sync Browser Profile into /assets (browser-profile-references) if not already registered
      const cleanBrowser = browserProfileLabel.trim()
      if (cleanBrowser) {
        const existsBrowser = browserList.some(
          (b) => String(b.label ?? '').toLowerCase() === cleanBrowser.toLowerCase() || String(b.profile_reference ?? '').toLowerCase() === cleanBrowser.toLowerCase(),
        )
        if (!existsBrowser) {
          const matchedPreset = BROWSER_ENV_PRESETS.find((p) => cleanBrowser.toLowerCase().includes(p.provider.toLowerCase()))
          const providerName = matchedPreset?.provider ?? (cleanBrowser.split(/[?-]/)[0]?.trim() || 'Chrome')
          const refSlug = cleanBrowser.replace(/[^a-zA-Z0-9_-]+/g, '-').toUpperCase().slice(0, 60)
          try {
            await api.post('/api/v1/browser-profile-references', {
              provider: providerName,
              profile_reference: `PROF-${refSlug}`,
              label: cleanBrowser,
              local_or_remote: 'local',
              status: 'active',
              notes: `Đồng bộ tự động từ VIA ${label.trim()}`,
            })
          } catch {
            // Ignore duplicate profile reference errors
          }
        }
      }

      // Auto-sync Proxy ISP into /assets (proxy-references) if not already registered
      const cleanNetwork = networkLabel.trim()
      if (cleanNetwork) {
        const existsProxy = proxyList.some(
          (p) => String(p.label ?? '').toLowerCase() === cleanNetwork.toLowerCase() || String(p.proxy_reference ?? '').toLowerCase() === cleanNetwork.toLowerCase(),
        )
        if (!existsProxy) {
          const matchedIsp = PROXY_ISP_PRESETS.find(
            (p) => cleanNetwork.toLowerCase().includes(p.provider.toLowerCase()) || cleanNetwork.toLowerCase().includes(p.name.split(' ')[0].toLowerCase()),
          )
          const ispProvider = matchedIsp?.provider ?? (cleanNetwork.split(/[?-]/)[0]?.trim() || 'VNPT Static IP')
          const refSlug = cleanNetwork.replace(/[^a-zA-Z0-9_-]+/g, '-').toUpperCase().slice(0, 60)
          try {
            await api.post('/api/v1/proxy-references', {
              provider: ispProvider,
              proxy_reference: `PRX-${refSlug}`,
              label: cleanNetwork,
              country: 'VN',
              region: matchedIsp?.region ?? 'Ho Chi Minh',
              protocol: matchedIsp?.protocol ?? 'https',
              status: 'active',
              notes: `Đồng bộ tự động từ VIA ${label.trim()}`,
            })
          } catch {
            // Ignore duplicate proxy reference errors
          }
        }
      }

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
      void queryClient.invalidateQueries({ queryKey: ['browser-profile-references'] })
      void queryClient.invalidateQueries({ queryKey: ['proxy-references'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      onSaved?.(saved)
      onClose()
    },
  })

  const bmList = Array.isArray(bms.data?.items) ? bms.data.items : []
  const existingLinks = Array.isArray(profile.data?.business_links) ? profile.data.business_links : []
  const viaSuffix = (label.trim() || 'VIA').slice(0, 40)

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={record ? t('fb.form.editTitle') : t('fb.form.addTitle')}
      description={t('fb.form.desc')}
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
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (label.trim()) save.mutate()
        }}
      >
        <Field htmlFor={`${formId}-label`} label={t('res.f.label')} required>
          <input
            id={`${formId}-label`}
            className="input"
            required
            maxLength={200}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor={`${formId}-ownership`} label={t('fb.ownership')}>
            <select
              id={`${formId}-ownership`}
              className="input"
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
          <Field htmlFor={`${formId}-client`} label={t('fb.clientName')}>
            <input
              id={`${formId}-client`}
              className="input"
              maxLength={200}
              placeholder={t('fb.clientPlaceholder')}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              data-testid="fb-client-input"
            />
          </Field>
        </div>

        {/* Business Manager link section */}
        <div className="rounded-md border border-line bg-surface-muted p-3 space-y-2">
          <p className="text-xs font-semibold text-ink">{t('fb.detail.bm')}</p>
          {existingLinks.length > 0 && (
            <ul className="space-y-1.5">
              {existingLinks.map((lnk) => (
                <li
                  key={lnk.id}
                  className="flex items-center justify-between gap-2 rounded border border-line bg-surface px-2.5 py-1.5 text-xs"
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
            <Field htmlFor={`${formId}-bm`} label={t('fb.businessManagers')}>
              <select
                id={`${formId}-bm`}
                className="input"
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
                className="input"
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

        {/* Fixed Login Environment with Dropdown Selectors & Direct Asset Connections */}
        <div className="rounded-md border border-line bg-surface-muted p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-ink">{t('fb.env.title')}</p>
              <p className="text-xs text-ink-muted">{t('fb.env.desc')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to="/assets?tab=browser-profile-references"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-brand-text hover:bg-surface-hover"
              >
                Hồ sơ trình duyệt <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                to="/assets?tab=proxy-references"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-brand-text hover:bg-surface-hover"
              >
                Nhà mạng Proxy IP <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* 1. Device / Workstation selector */}
          <Field htmlFor={`${formId}-device`} label={t('fb.deviceLabel')}>
            <div className="space-y-1.5">
              <select
                aria-label="Chọn máy trạm cố định"
                className="input text-xs"
                value={DEVICE_PRESETS.includes(deviceLabel) ? deviceLabel : ''}
                onChange={(e) => {
                  if (e.target.value) setDeviceLabel(e.target.value)
                }}
              >
                <option value="">— Chọn nhanh Thiết bị / Máy trạm —</option>
                {DEVICE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
              <input
                id={`${formId}-device`}
                className="input"
                maxLength={160}
                placeholder={t('fb.devicePlaceholder')}
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                data-testid="fb-device-input"
              />
            </div>
          </Field>

          {/* 2. Browser / Antidetect Environment selector */}
          <Field htmlFor={`${formId}-browser`} label={t('fb.browserLabel')}>
            <div className="space-y-1.5">
              <select
                aria-label="Chọn môi trường trình duyệt"
                className="input text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) setBrowserProfileLabel(e.target.value)
                }}
              >
                <option value="">— Chọn Môi trường Trình duyệt (AdsPower, Hidemyacc, Chrome...) —</option>
                {browserList.length > 0 && (
                  <optgroup label="Hồ sơ trình duyệt ?? k?t n?i trong T?i s?n (/assets)">
                    {browserList.map((b) => {
                      const val = String(b.label || b.profile_reference)
                      return (
                        <option key={b.id} value={val}>
                          {String(b.provider || 'Browser')} — {val}
                        </option>
                      )
                    })}
                  </optgroup>
                )}
                <optgroup label="Khởi tạo nhanh theo phần mềm Antidetect / Trình duyệt">
                  {BROWSER_ENV_PRESETS.map((p) => {
                    const generated = `${p.provider} — Profile (${viaSuffix})`
                    return (
                      <option key={p.provider} value={generated}>
                        {p.name} → {generated}
                      </option>
                    )
                  })}
                </optgroup>
              </select>
              <input
                id={`${formId}-browser`}
                className="input"
                maxLength={160}
                placeholder={t('fb.browserPlaceholder')}
                value={browserProfileLabel}
                onChange={(e) => setBrowserProfileLabel(e.target.value)}
                data-testid="fb-browser-input"
              />
            </div>
          </Field>

          {/* 3. Proxy / ISP Network selector */}
          <Field htmlFor={`${formId}-network`} label={t('fb.networkLabel')}>
            <div className="space-y-1.5">
              <select
                aria-label="Chọn nhà mạng Proxy IP"
                className="input text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) setNetworkLabel(e.target.value)
                }}
              >
                <option value="">— Chọn Nhà mạng / Proxy IP (VNPT, Viettel, FPT, 4G...) —</option>
                {proxyList.length > 0 && (
                  <optgroup label="Hồ sơ Proxy đã kết nối trong Tài sản (/assets)">
                    {proxyList.map((px) => {
                      const val = String(px.label || px.proxy_reference)
                      return (
                        <option key={px.id} value={val}>
                          {String(px.provider || 'Proxy')} — {val}
                        </option>
                      )
                    })}
                  </optgroup>
                )}
                <optgroup label="Khởi tạo nhanh theo Nhà mạng / Loại Proxy IP (Tách riêng cho VIA này)">
                  {PROXY_ISP_PRESETS.map((isp) => {
                    const generated = `${isp.provider} — Line (${viaSuffix})`
                    return (
                      <option key={isp.provider} value={generated}>
                        {isp.name} → {generated}
                      </option>
                    )
                  })}
                </optgroup>
              </select>
              <input
                id={`${formId}-network`}
                className="input"
                maxLength={160}
                placeholder={t('fb.networkPlaceholder')}
                value={networkLabel}
                onChange={(e) => setNetworkLabel(e.target.value)}
                data-testid="fb-network-input"
              />
            </div>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {canAssignOwner && (
            <Field htmlFor={`${formId}-owner`} label={t('fb.owner')}>
              <select
                id={`${formId}-owner`}
                className="input"
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
          <Field htmlFor={`${formId}-2fa`} label={t('fb.twoFactor')}>
            <select
              id={`${formId}-2fa`}
              className="input"
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
          <Field htmlFor={`${formId}-status`} label={t('res.f.status')}>
            <select
              id={`${formId}-status`}
              className="input"
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
        </div>

        <Field htmlFor={`${formId}-display`} label={t('res.f.displayName')}>
          <input
            id={`${formId}-display`}
            className="input"
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-ext`} label={t('res.f.externalReferenceId')}>
          <input
            id={`${formId}-ext`}
            className="input font-mono"
            maxLength={120}
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-vault`} label={t('fb.form.vaultLabel')}>
          <input
            id={`${formId}-vault`}
            className="input"
            maxLength={2048}
            placeholder="Bitwarden → Agency/FB2"
            value={vaultReference}
            onChange={(e) => setVaultReference(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-recovery`} label={t('fb.detail.recovery')}>
          <textarea
            id={`${formId}-recovery`}
            className="input min-h-[4rem]"
            maxLength={2000}
            value={recoveryNote}
            onChange={(e) => setRecoveryNote(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-notes`} label={t('res.f.notes')}>
          <textarea
            id={`${formId}-notes`}
            className="input min-h-[4rem]"
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {save.isError && <ErrorState error={save.error} compact />}
      </form>
    </FormSheet>
  )
}
