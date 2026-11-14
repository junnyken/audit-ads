import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Building2,
  Flag,
  Layers,
  Link2,
  PlusCircle,
  Puzzle,
  ShieldAlert,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
import { api } from '../lib/api'
import { launchInAssignedChromeProfile } from '../lib/chromeProfileLauncher'
import type { Paged, ReferenceRecord } from '../lib/types'
import { QuickMetaSyncBanner } from '../components/meta/QuickMetaSyncBanner'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { PageHeader } from '../components/page/PageHeader'
import { Note } from './account/parts'

const CARDS: { to: string; title: TranslationKey; body: TranslationKey }[] = [
  { to: '/operations/create-accounts', title: 'op.card.create.title', body: 'op.card.create.body' },
  { to: '/operations/share-access', title: 'op.card.share.title', body: 'op.card.share.body' },
  { to: '/operations/pixel-share', title: 'op.card.pixel.title', body: 'op.card.pixel.body' },
  { to: '/team', title: 'op.card.team.title', body: 'op.card.team.body' },
]

export default function Operations() {
  const { t, language } = useI18n()
  const isEn = language === 'en'
  const [selectedBmId, setSelectedBmId] = useState<string>('')
  const [bannerMsg, setBannerMsg] = useState<string | null>(null)

  const bmsQ = useQuery({
    queryKey: ['business-managers-for-ops'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/business-managers?page_size=200'),
  })

  const viasQ = useQuery({
    queryKey: ['vias-for-ops'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=200'),
  })

  const allBms = bmsQ.data?.items ?? []
  const allVias = viasQ.data?.items ?? []
  const activeBm = allBms.find((b) => b.id === selectedBmId) ?? allBms[0] ?? null
  const bmExtId = String(activeBm?.external_id ?? '')
  const bmName = String(activeBm?.name ?? 'BM Trung tâm')

  // Find matching Via holding this BM
  const matchedVia =
    allVias.find((v) => String(v.notes ?? '').toLowerCase().includes(bmName.toLowerCase())) ??
    allVias[0] ??
    null
  const holderLabel = String(matchedVia?.label ?? 'Tài Khoản Chính')
  const holderProfile =
    String(matchedVia?.browser_profile_label ?? '').trim() ||
    'Chrome — Default · trieu (thientrieu753@gmail.com)'
  const holderProxy = String(matchedVia?.network_label ?? '')

  const launchBmAction = (path: string, actionLabel: string) => {
    const targetUrl = bmExtId
      ? `https://business.facebook.com/${path}${path.includes('?') ? '&' : '?'}business_id=${encodeURIComponent(bmExtId)}`
      : `https://business.facebook.com/${path}`
    launchInAssignedChromeProfile(targetUrl, holderProfile, holderLabel, holderProxy)
    setBannerMsg(
      isEn
        ? `🚀 Launched "${actionLabel}" for BM "${bmName}" inside isolated Chrome (${holderProfile})`
        : `🚀 Đã mở tác vụ «${actionLabel}» của BM «${bmName}» trên đúng Hồ sơ Chrome (${holderProfile})`,
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('op.title')} description={t('op.desc')} />

      {/* 1-CLICK META SYNC AT THE TOP OF OPERATIONS */}
      <QuickMetaSyncBanner />

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="rounded p-0.5 hover:bg-emerald-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 1-CLICK CHROME EXECUTION HUB (BYPASSES GRAPH API WRITE RESTRICTIONS / CHECKPOINT 956) */}
      <Card className="border-brand/40 bg-brand-light/20">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-brand-text" />
                <span>
                  {isEn
                    ? '⚡ 1-Click Browser Execution Hub (Safe BM Operations via Isolated Chrome Profile)'
                    : '⚡ Trung tâm Thực Thi 1-Click Qua Hồ Sơ Chrome Của Via Tổng (An Toàn 100% — Không Lo Lỗi not_supported)'}
                </span>
              </CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">
                {isEn
                  ? 'When Meta restricts Cloud Server POST writes (not_supported) to prevent IP mismatch checkpoints, execute BM actions directly inside the holding Via’s isolated Chrome Profile with 1 click:'
                  : 'Khi Meta khóa lệnh Ghi (POST) từ máy chủ Cloud (báo not_supported) để chống lệch IP quản trị, bạn chỉ cần chọn BM bên dưới và bấm 1 nút để mở thẳng trang thực thi trên đúng Hồ sơ Chrome của Via Tổng:'}
                </p>
            </div>
            <Badge tone="positive">
              {isEn ? '🛡️ Anti-Checkpoint 956' : '🛡️ Chống Checkpoint 956'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Building2 className="h-4 w-4 text-brand-text" />
              <span className="text-xs font-bold text-ink">
                {isEn ? 'Select Target Business Manager:' : 'Chọn Business Manager cần thao tác:'}
              </span>
              <select
                value={activeBm?.id ?? ''}
                onChange={(e) => setSelectedBmId(e.target.value)}
                className="input h-8 w-auto text-xs font-bold"
              >
                {allBms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {String(b.name ?? b.id)} {b.external_id ? `(${String(b.external_id)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
                🛡️ {isEn ? 'Admin Via:' : 'Via Tổng giữ BM:'} {holderLabel}
              </span>
              <span className="rounded bg-surface-muted px-2 py-1 font-mono text-[11px] text-ink">
                💻 {holderProfile}
              </span>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            <button
              type="button"
              onClick={() =>
                launchBmAction(
                  'settings/ad-accounts',
                  isEn ? 'Create Ad Account in BM' : 'Tạo TKQC mới trong BM',
                )
              }
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
            >
              <div className="flex items-center justify-between text-xs font-bold text-ink">
                <span>{isEn ? '1. Create Ad Account' : '1. Tạo TKQC Mới'}</span>
                <PlusCircle className="h-4 w-4 text-brand-text" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {isEn
                  ? 'Open BM Ad Account Settings in Holder Chrome to add a new ad account.'
                  : 'Mở thẳng Cài đặt TKQC của BM trên Chrome Via Tổng để bấm thêm TKQC mới.'}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-text">
                🚀 {isEn ? 'Open in Chrome →' : 'Mở trên Chrome Via →'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                launchBmAction(
                  'settings/ad-accounts',
                  isEn ? 'Share Ad Account Access' : 'Phân quyền TKQC cho Via Lên Camp',
                )
              }
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
            >
              <div className="flex items-center justify-between text-xs font-bold text-ink">
                <span>{isEn ? '2. Share Ad Account' : '2. Share Quyền TKQC'}</span>
                <Share2 className="h-4 w-4 text-brand-text" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {isEn
                  ? 'Assign Advertiser access to Tier-2 Campaign Vias or Partner BMs.'
                  : 'Gán quyền Nhà quảng cáo (Advertiser) cho Via Lớp 2 hoặc Share Partner BM.'}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-text">
                🚀 {isEn ? 'Open in Chrome →' : 'Mở trên Chrome Via →'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                launchBmAction(
                  'settings/pixels',
                  isEn ? 'Share Dataset / Pixel' : 'Share Dataset / Pixel sang TKQC',
                )
              }
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
            >
              <div className="flex items-center justify-between text-xs font-bold text-ink">
                <span>{isEn ? '3. Share Pixel / Dataset' : '3. Share Dataset / Pixel'}</span>
                <Layers className="h-4 w-4 text-brand-text" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {isEn
                  ? 'Connect Datasets/Pixels to Ad Accounts or Partner BMs in 1 click.'
                  : 'Nối Tài sản Dữ liệu (Pixel) sang các TKQC đang chạy hoặc cấp quyền Partner.'}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-text">
                🚀 {isEn ? 'Open in Chrome →' : 'Mở trên Chrome Via →'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                launchBmAction(
                  'settings/pages',
                  isEn ? 'Share Fanpage Access' : 'Phân quyền Trang Fanpage',
                )
              }
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
            >
              <div className="flex items-center justify-between text-xs font-bold text-ink">
                <span>{isEn ? '4. Share Fanpage' : '4. Phân Quyền Fanpage'}</span>
                <Flag className="h-4 w-4 text-brand-text" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {isEn
                  ? 'Grant Page Advertiser access to Ad Accounts or Campaign Vias.'
                  : 'Cấp quyền chạy quảng cáo trên Fanpage cho Via Lên Camp hoặc Đối tác.'}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-text">
                🚀 {isEn ? 'Open in Chrome →' : 'Mở trên Chrome Via →'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                launchBmAction(
                  'accountquality/?landing_page=overview',
                  isEn ? 'Account Quality & Appeals' : 'Chất lượng Tài khoản & Kháng nghị',
                )
              }
              className="flex flex-col justify-between rounded-lg border border-line bg-surface p-3 text-left hover:border-brand transition"
            >
              <div className="flex items-center justify-between text-xs font-bold text-ink">
                <span>{isEn ? '5. Account Quality' : '5. Kháng Nghị BM / Page'}</span>
                <ShieldAlert className="h-4 w-4 text-amber-500" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {isEn
                  ? 'Inspect restricted accounts, rejected ads, or submit BM/Page appeals.'
                  : 'Kiểm tra hạn chế quảng cáo, xóa bài từ chối và gửi kháng nghị BM/Page.'}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-text">
                🚀 {isEn ? 'Open in Chrome →' : 'Mở trên Chrome Via →'}
              </span>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 3 PRIMARY OPERATIONAL HUBS */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-brand/30 bg-brand-light/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-brand-text" />
                <span>{isEn ? 'Multi-BM Meta Connections & Tokens' : 'Kết nối & Token Meta Đa BM'}</span>
              </span>
              <Badge tone="info">{isEn ? 'Essential' : 'Quan trọng'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              {isEn
                ? 'Manage Graph API connections, check 60-day token expiry, and auto-sync all BMs, Ad Accounts, Fanpages, Balances & Cards.'
                : 'Quản lý danh sách kết nối Graph API, kiểm tra hạn Token 60 ngày và đồng bộ tự động toàn bộ BM, TKQC, Fanpage, Dư nợ & Thẻ.'}
            </p>
            <Button asChild size="sm">
              <Link to="/meta-connections">
                {isEn ? 'Open Meta Connections →' : 'Mở Quản lý Kết nối Meta →'}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Puzzle className="h-4 w-4 text-brand-text" />
                <span>{isEn ? 'Chrome Extension & Proxy Shield' : 'Tiện ích Chrome & Bọc Proxy'}</span>
              </span>
              <Badge tone="positive">v2.9.1 Pro</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              {isEn
                ? 'Download Chrome Extension (.zip) with 6-digit 2FA autofill, Anti-Passkey Shield, WebRTC leak blocker, and 1-click Passkey Cleaner.'
                : 'Tải gói Tiện ích Chrome (.zip) tích hợp 2FA 6 số tự điền, Lá chắn Chống Passkey, khóa rò rỉ WebRTC và nút Xóa Passkey 1-Click.'}
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link to="/chrome-extension">
                {isEn ? 'Open Extension Hub →' : 'Mở Trung tâm Tiện ích →'}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-brand-text" />
                <span>{isEn ? 'Anti-Die Playbook & Golden Rules' : 'Hướng dẫn & Công thức Chống Die'}</span>
              </span>
              <Badge tone="neutral">{isEn ? '6 Steps' : '6 Bước'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              {isEn
                ? 'View the 6-step Playbook: 3-tier Via isolation, 72h Golden Warm-up, Passkey Removal, 1 Card ≤ 3 Ad Accounts, and BM10+ Verification.'
                : 'Xem Slider 6 bước phân tầng 3 lớp Via, quy trình ngâm 72h vàng, gỡ Passkey, hạn mức 1 Thẻ ≤ 3 TKQC và hồ sơ chuẩn XMDN lên BM10+.'}
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link to="/operations-guide">
                {isEn ? 'Open Playbook →' : 'Xem Công thức Vận hành →'}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Card key={card.to} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm">{t(card.title)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
              <p className="text-sm text-ink-muted">{t(card.body)}</p>
              <div>
                <Button asChild>
                  <Link to={card.to} aria-label={`${t('op.start')}: ${t(card.title)}`}>
                    {t('op.start')}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Note>{t('op.note')}</Note>
    </div>
  )
}
