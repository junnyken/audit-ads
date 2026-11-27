import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
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
      <PageHeader title={t('op.title')} description={t('honest.operations.description')} />
      <Card>
        <CardHeader><CardTitle>{t('honest.operations.retiredTitle')}</CardTitle></CardHeader>
        <CardContent><p>{t('honest.operations.retiredBody')}</p></CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['/meta-connections', 'honest.setup.connections'],
          ['/chrome-extension', 'honest.setup.extension'],
          ['/operations-guide', 'honest.setup.guide'],
        ].map(([to, key]) => (
          <Card key={to}><CardContent className="p-4">
            <Button asChild variant="secondary"><Link to={to}>{t(key as TranslationKey)}</Link></Button>
          </CardContent></Card>
        ))}
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

      <Note>{t('op.desc')}</Note>
      <Note>{t('honest.operations.workflow')}</Note>
    </div>
  )
}
