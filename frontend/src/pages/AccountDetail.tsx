import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import type { AccountStatus, AdAccount, AccountHealth, Readiness } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/primitives/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/primitives/dropdown-menu'
import { ErrorState, LoadingRegion } from '../components/states'
import { ChecklistProgress } from '../components/dashboard/ChecklistProgress'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { HEALTH_META } from '../lib/health'
import { formatDateTime } from '../lib/format'
import { useEnumLabel } from '../i18n/labels'
import { useI18n } from '../i18n'
import AccountFormDrawer from '../components/AccountFormDrawer'
import PlatformStatusBadge from '../components/PlatformStatusBadge'
import { Note } from './account/parts'
import OverviewTab from './account/OverviewTab'
import AssetsTab from './account/AssetsTab'
import ReadinessTab from './account/ReadinessTab'
import HealthTab from './account/HealthTab'
import SpendTab from './account/SpendTab'
import EventsTab from './account/EventsTab'
import AuditTab from './account/AuditTab'

/** Tab keys are part of the URL (`?tab=`) and so of every bookmark: do not rename them. */
const TAB_KEYS = ['overview', 'assets', 'readiness', 'health', 'spend', 'events', 'audit'] as const
type TabKey = (typeof TAB_KEYS)[number]

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value)
}

type Confirm = 'archive' | 'restore' | null

/** What the server said after a write, read back from the server (skill 6.4) — not "success". */
interface ReadBack {
  kind: 'archived' | 'restored' | 'saved'
  /** The re-read agrees with what was asked for. */
  ok: boolean
  name: string
  status: string
  at: string | null
}

export default function AccountDetail() {
  const { accountId = '' } = useParams()
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-linkable so the health list can send the operator straight to the Health tab.
  const requested = searchParams.get('tab')
  const tab: TabKey = isTabKey(requested) ? requested : 'overview'
  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }
  const [editing, setEditing] = useState(false)
  // S2: set only when the sheet is opened from "Record Meta status in the registry".
  const [statusPrefill, setStatusPrefill] = useState<{ status: AccountStatus | null; note: string } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  // The confirm dialog is opened from a menu item that disappears with the menu, so Radix has no
  // trigger to return focus to. Remember the opener; if it is gone (Archive turns the page into
  // its archived form) land on the page heading instead of dropping to <body>.
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const closeDrawer = () => {
    setEditing(false)
    setStatusPrefill(null)
  }

  const account = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => api.get<AdAccount>(`/api/v1/ad-accounts/${accountId}`),
  })
  const readiness = useQuery({
    queryKey: ['readiness', accountId],
    queryFn: () => api.get<Readiness>(`/api/v1/ad-accounts/${accountId}/readiness`),
  })
  // Same key and function as the Health tab, so the header and the tab share one request.
  const health = useQuery({
    queryKey: ['health', accountId],
    queryFn: () => api.get<AccountHealth>(`/api/v1/ad-accounts/${accountId}/health`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['account', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['readiness', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['checklist', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['events', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['asset-links', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['account-audit', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['health', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['health-signals', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['health-runs', accountId] })
    void queryClient.invalidateQueries({ queryKey: ['account-health'] })
    void queryClient.invalidateQueries({ queryKey: ['health-summary'] })
  }

  /** Re-reads the account and reports what the server now holds. */
  async function readBackFrom(kind: ReadBack['kind']) {
    const result = await account.refetch()
    const fresh = result.data
    if (!fresh) return
    const archived = fresh.archived_at !== null
    setReadBack({
      kind,
      ok: kind === 'archived' ? archived : kind === 'restored' ? !archived : true,
      name: fresh.display_name,
      status: archived ? 'archived' : fresh.status,
      at: kind === 'saved' ? fresh.updated_at : archived ? fresh.archived_at : fresh.updated_at,
    })
  }

  const archive = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/archive`),
    onSuccess: async () => {
      refresh()
      await readBackFrom('archived')
      setConfirm(null)
    },
  })
  const restore = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/restore`),
    onSuccess: async () => {
      refresh()
      await readBackFrom('restored')
      setConfirm(null)
    },
  })
  const recalculate = useMutation({
    mutationFn: () => api.post(`/api/v1/ad-accounts/${accountId}/readiness/recalculate`),
    onSuccess: refresh,
  })

  if (account.isLoading) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </LoadingRegion>
    )
  }
  if (account.isError) {
    return (
      <div className="space-y-3">
        <ErrorState title={t('acct.error.title')} error={account.error} onRetry={() => account.refetch()} />
        <Link to="/accounts" className="text-sm font-medium text-brand-text hover:underline">
          {t('acct.backToList')}
        </Link>
      </div>
    )
  }

  const record = account.data!
  const readinessMeta = READINESS_META[record.readiness_status]
  const archived = record.archived_at !== null
  const pending = confirm === 'archive' ? archive : restore

  const tabLabel: Record<TabKey, string> = {
    overview: t('acct.tab.overview'),
    assets: t('acct.tab.assets'),
    readiness: t('acct.tab.readiness'),
    health: t('acct.tab.health'),
    spend: t('acct.tab.spend'),
    events: t('acct.tab.events'),
    audit: t('acct.tab.audit'),
  }

  return (
    <div className="space-y-4">
      <nav aria-label={t('acct.breadcrumb')} className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to="/accounts" className="hover:underline">
          {t('accounts.title')}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span aria-current="page" className="text-ink">
          {record.display_name}
        </span>
      </nav>

      <Card className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold leading-7 outline-none">{record.display_name}</h1>
            <Badge tone={accountStatusTone(archived ? 'archived' : record.status)} title={t('acct.header.recordedHint')}>
              {enumLabel('accountStatus', archived ? 'archived' : record.status)}
            </Badge>
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label={t('acct.header.statuses')}>
            <li className="inline-flex items-center gap-1.5">
              <span className="text-ink-muted">{t('acct.header.readiness')}:</span>
              <Badge tone={readinessMeta.tone} dot title={t(`readinessHint.${record.readiness_status}`)}>
                {enumLabel('readiness', record.readiness_status)}
              </Badge>
            </li>
            <li className="inline-flex items-center gap-1.5" data-testid="header-health">
              <span className="text-ink-muted">{t('acct.header.health')}:</span>
              {health.isLoading ? (
                <Skeleton className="h-5 w-24" />
              ) : health.isError || !health.data ? (
                <span title={t('acct.header.healthFailed')}>
                  <span aria-hidden="true" className="text-ink-faint">
                    —
                  </span>
                  <span className="sr-only">{t('acct.header.healthFailed')}</span>
                </span>
              ) : (
                <Badge
                  tone={HEALTH_META[health.data.health_status].tone}
                  dot
                  title={t(`healthHint.${health.data.health_status}`)}
                >
                  {enumLabel('health', health.data.health_status)}
                </Badge>
              )}
            </li>
            {record.platform_status !== undefined && (
              <li className="inline-flex items-center gap-1.5" data-testid="header-meta-status">
                <span className="text-ink-muted">{t('acct.header.meta')}:</span>
                <PlatformStatusBadge value={record.platform_status} inline />
              </li>
            )}
          </ul>
          <p className="font-mono text-xs text-ink-muted">
            {record.external_account_id ?? t('acct.header.noExternalId')}
            <span className="font-sans">
              {' · '}
              {record.business_manager_name ?? t('acct.bmNone')}
            </span>
          </p>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span>{t('acct.header.checklist')}:</span>
            {readiness.isLoading ? (
              <Skeleton className="h-4 w-20" />
            ) : readiness.data ? (
              <ChecklistProgress
                done={readiness.data.completed_item_count}
                total={readiness.data.required_item_count}
              />
            ) : (
              <span title={t('acct.header.checklistFailed')}>—</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => recalculate.mutate()}
            disabled={recalculate.isPending}
          >
            {recalculate.isPending ? t('acct.action.recalculating') : t('acct.action.recalculate')}
          </Button>
          {archived ? (
            <Button onClick={() => setConfirm('restore')}>{t('acct.action.restore')}</Button>
          ) : (
            <>
              <Button onClick={() => setEditing(true)}>{t('acct.action.edit')}</Button>
              {/* modal={false}: a modal menu that opens a modal dialog leaves the page with
                  pointer-events: none after the dialog closes (a known Radix interaction). */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label={t('acct.action.more')}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setConfirm('archive')}>
                    {t('acct.action.archive')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </Card>

      {recalculate.isError && <ErrorState error={recalculate.error} title={t('acct.error.recalculate')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}

      {readBack && (
        <Note role="status" tone={readBack.ok ? 'info' : 'caution'}>
          {readBack.ok
            ? t(`acct.readback.${readBack.kind}`, {
                name: readBack.name,
                status: enumLabel('accountStatus', readBack.status),
                time: formatDateTime(readBack.at),
              })
            : t('acct.readback.mismatch', { name: readBack.name })}
        </Note>
      )}

      {archived && <Note role="note">{t('acct.archivedNote')}</Note>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('acct.tabs.label')}>
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {tabLabel[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            account={record}
            readiness={readiness}
            onChanged={refresh}
            onRecordMetaStatus={(status, note) => {
              setStatusPrefill({ status, note })
              setEditing(true)
            }}
            onOpenSpend={() => setTab('spend')}
          />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsTab account={record} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="readiness">
          <ReadinessTab account={record} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="health">
          <HealthTab account={record} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="spend">
          <SpendTab account={record} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab account={record} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab account={record} />
        </TabsContent>
      </Tabs>

      <AccountFormDrawer
        open={editing}
        account={record}
        onClose={closeDrawer}
        onSaved={() => {
          refresh()
          void readBackFrom('saved')
        }}
        statusSuggestion={statusPrefill?.status ?? null}
        statusNote={statusPrefill?.note ?? null}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending.isPending) setConfirm(null)
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={() => {
            returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = returnFocusTo.current
            if (target?.isConnected && target !== document.body) target.focus()
            else headingRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'restore' ? t('acct.restore.title') : t('acct.archive.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('acct.confirm.object', {
                name: record.display_name,
                id: record.external_account_id ?? t('acct.header.noExternalId'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {(confirm === 'restore'
              ? (['acct.restore.effect', 'acct.restore.reversible', 'acct.restore.scope'] as const)
              : (['acct.archive.effect', 'acct.archive.reversible', 'acct.archive.scope'] as const)
            ).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          {pending.isError && <ErrorState error={pending.error} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === 'restore' ? 'default' : 'destructive'}
              disabled={pending.isPending}
              onClick={(event) => {
                // Keep the dialog open while the request runs and until the read-back lands.
                event.preventDefault()
                pending.mutate()
              }}
            >
              {pending.isPending
                ? t('common.working')
                : confirm === 'restore'
                  ? t('acct.restore.confirm')
                  : t('acct.archive.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
