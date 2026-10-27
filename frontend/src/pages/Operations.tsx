import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { PageHeader } from '../components/page/PageHeader'
import { Note } from './account/parts'

/** Deliberately four cards, three live (A7 create/share + A8 pixel share). The remaining
 * placeholder never gets an execute button until it's actually built — so this page never
 * grows past what is actually built, and never dresses up a placeholder as a working feature. */
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
