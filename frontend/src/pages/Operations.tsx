import { Link } from 'react-router-dom'
import { BookOpen, Link2, Puzzle } from 'lucide-react'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
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
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <PageHeader title={t('op.title')} description={t('op.desc')} />

      {/* 1-CLICK META SYNC AT THE TOP OF OPERATIONS */}
      <QuickMetaSyncBanner />

      {/* 3 PRIMARY OPERATIONAL HUBS */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-brand/30 bg-brand-light/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-brand-text" />
                <span>Kết nối &amp; Token Meta Đa BM</span>
              </span>
              <Badge tone="info">Quan trọng</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              Quản lý danh sách kết nối Graph API, kiểm tra hạn Token 60 ngày và đồng bộ tự động toàn bộ BM, TKQC, Dư nợ &amp; Thẻ.
            </p>
            <Button asChild size="sm">
              <Link to="/meta-connections">Mở Quản lý Kết nối Meta →</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Puzzle className="h-4 w-4 text-brand-text" />
                <span>Tiện ích Chrome &amp; Bọc Proxy</span>
              </span>
              <Badge tone="positive">v2.3 Pro</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              Tải gói Tiện ích Chrome (<code>.zip</code>) tích hợp 2FA 6 số tự điền, khóa rò rỉ WebRTC, Cookie/Token và file mở Chrome tự động (<code>.bat</code>).
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link to="/chrome-extension">Mở Trung tâm Tiện ích →</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-brand-text" />
                <span>Hướng dẫn &amp; Công thức Chống Die</span>
              </span>
              <Badge tone="neutral">5 Bước</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>
              Xem Slider 5 bước phân tầng 3 lớp Via, quy trình ngâm 72h vàng, hạn mức 1 Thẻ ≤ 3 TKQC và hồ sơ chuẩn XMDN lên BM10+.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link to="/operations-guide">Xem Công thức Vận hành →</Link>
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
