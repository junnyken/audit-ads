import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { PageHeader } from '../components/page/PageHeader'

/** Manual, evidence-based guidance. No browser automation or provider promises. */
export default function OperationsGuide() {
  const { t } = useI18n()
  return <div className="space-y-4">
    <PageHeader title={t('guideSafe.title')} description={t('guideSafe.description')} />
    <p role="note" className="rounded border border-line bg-surface p-4">{t('guideSafe.retired')}</p>
    {(['access', 'review', 'changes', 'recovery'] as const).map(section => <Card key={section}>
      <CardHeader><CardTitle>{t(`guideSafe.${section}.title`)}</CardTitle></CardHeader>
      <CardContent><p>{t(`guideSafe.${section}.body`)}</p></CardContent>
    </Card>)}
    <nav aria-label={t('guideSafe.links')} className="flex flex-wrap gap-4">
      <Link className="text-brand-text underline" to="/meta-connections">{t('honest.setup.connections')}</Link>
      <Link className="text-brand-text underline" to="/operations">{t('op.title')}</Link>
      <Link className="text-brand-text underline" to="/assets/emails">{t('er.title')}</Link>
    </nav>
  </div>
}
