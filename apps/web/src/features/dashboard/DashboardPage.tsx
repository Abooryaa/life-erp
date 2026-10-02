import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, HardDriveDownload, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Dot, Spinner } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useAuthStatus } from '../../lib/hooks';
import type { AuditItem, DocumentItem, NotificationItem } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { DocIcon, ExpiryBadge } from '../documents/doc-ui';
import { NotificationRow } from '../notifications/NotificationsPage';

interface BackupList {
  dir: string;
  items: { name: string | null; kind: string; status: string; createdAt: string; size: number | null }[];
}

export function DashboardPage() {
  const { t, fmt } = useI18n();
  const user = useAuthStatus().data?.user;
  const { currentId, workspaces } = useWorkspace();
  const hour = new Date().getHours();
  const first = user?.fullName.split(/\s+/)[0] ?? '';
  const greeting = hour < 12 ? 'dash.greetingMorning' : hour < 18 ? 'dash.greetingAfternoon' : 'dash.greetingEvening';

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; counts: { unread: number } }>('/api/notifications'),
  });
  const docs = useQuery({
    queryKey: ['documents', { currentId, recent: true }],
    queryFn: () => api.get<DocumentItem[]>(`/api/documents${qs({ workspaceId: currentId, limit: 6 })}`),
  });
  const activity = useQuery({ queryKey: ['audit', 'recent'], queryFn: () => api.get<AuditItem[]>('/api/audit?limit=8') });

  const attention = (notifications.data?.items ?? []).filter((n) => !n.readAt).slice(0, 6);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-ink-3">{fmt.longDate(new Date().toISOString())}</p>
        <h1 className="mt-0.5 text-[24px] font-semibold tracking-tight">{t(greeting, { name: first })}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t('dash.attention')} className="lg:col-span-2" padded={false}>
          {notifications.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : attention.length === 0 ? (
            <div className="flex items-center gap-3 p-4 text-ink-2">
              <CheckCircle2 className="size-5 text-pos" />
              {t('dash.allClear')}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((n) => (
                <NotificationRow key={n.id} n={n} compact />
              ))}
            </ul>
          )}
        </Panel>
        <BackupStatus />
      </div>

      <TodaySnapshot />
      <MoneySummary />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title={t('dash.recentDocuments')}
          className="lg:col-span-2"
          padded={false}
          actions={
            <Link to="/documents" className="text-[13px] font-medium text-accent hover:underline">
              {t('nav.documents')}
            </Link>
          }
        >
          {docs.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : !docs.data?.length ? (
            <div className="flex items-center gap-3 p-4 text-[13.5px] text-ink-3">
              <FileText className="size-5" />
              {t('docs.empty')}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {docs.data.map((d) => (
                <li key={d.id}>
                  <Link to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <DocIcon mime={d.mime} />
                    <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                    <ExpiryBadge expiresOn={d.expiresOn} />
                    <span className="num text-[12.5px] text-ink-3">{fmt.date(d.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('dash.workspaces')} padded={false}>
          <ul className="divide-y divide-line">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link to={`/workspaces/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <Dot color={w.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                  <span className="text-[12.5px] text-ink-3">{w.kind === 'personal' ? t('ws.personal') : w.industry || t('ws.business')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title={t('dash.recentActivity')}
        padded={false}
        actions={
          <Link to="/activity" className="text-[13px] font-medium text-accent hover:underline">
            {t('nav.activity')}
          </Link>
        }
      >
        <ul className="divide-y divide-line">
          {(activity.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate text-[13.5px]">{a.summary ?? a.action}</span>
              <span className="shrink-0 text-[12.5px] text-ink-3">{fmt.relative(a.at)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

interface TodaySummary {
  counts: { inbox: number; today: number; overdue: number; upcoming: number; waiting: number };
  events: { id: string; title: string; startTime: string | null; allDay: boolean }[];
  followUps: { id: string }[];
  focusGoals: { id: string }[];
}

/** Tasks, schedule, follow-ups and goals needing attention — links into the Today screen. */
function TodaySnapshot() {
  const { t } = useI18n();
  const { currentId } = useWorkspace();
  const { data } = useQuery({ queryKey: ['today', currentId], queryFn: () => api.get<TodaySummary>(`/api/today${qs({ workspaceId: currentId })}`) });
  if (!data) return null;
  const cell = (label: string, value: number, to: string, tone?: string) => (
    <Link to={to} className="rounded-lg p-2 hover:bg-surface-2">
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <p className={`num text-[20px] font-semibold ${value && tone ? tone : ''}`}>{value}</p>
    </Link>
  );
  return (
    <Panel
      title={t('today.title')}
      actions={
        <Link to="/today" className="text-[13px] font-medium text-accent hover:underline">
          {t('common.open')}
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {cell(t('today.overdue'), data.counts.overdue, '/tasks?view=today', 'text-neg')}
        {cell(t('today.dueToday'), data.counts.today, '/tasks?view=today')}
        {cell(t('task.view.inbox'), data.counts.inbox, '/tasks?view=inbox')}
        {cell(t('today.events'), data.events.length, '/calendar')}
        {cell(t('today.followUps'), data.followUps.length, '/people?followUp=1', 'text-warn')}
        {cell(t('today.focus'), data.focusGoals.length, '/goals', 'text-warn')}
      </div>
    </Panel>
  );
}

interface MoneyOverview {
  today: string;
  base: string;
  current: { income: number; expenses: number; net: number; savingsRate: number | null };
  net: { liquid: number; netWorth: number };
  upcoming: { id: string; kind: string; date: string; name: string; amount: number; currency: string; direction: 'in' | 'out'; overdue: boolean; link: string }[];
  accounts: unknown[];
}

/** This month's money at a glance + what is due in the next 7 days. */
function MoneySummary() {
  const { t, fmt } = useI18n();
  const { currentId } = useWorkspace();
  const { data } = useQuery({
    queryKey: ['finance', 'overview', 'dashboard', currentId],
    queryFn: () => api.get<MoneyOverview>(`/api/finance/overview${qs({ workspaceId: currentId })}`),
  });
  if (!data || data.accounts.length === 0) return null;
  const week = new Date(Date.parse(`${data.today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const soon = data.upcoming.filter((u) => u.date <= week);
  const money = (m: number, cur = data.base) => (
    <span className="num" dir="ltr">
      {fmt.money(m, cur)}
    </span>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title={t('fin.thisMonth')}
        className="lg:col-span-2"
        actions={
          <Link to="/finance" className="text-[13px] font-medium text-accent hover:underline">
            {t('nav.money')}
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-[12.5px] text-ink-3">{t('fin.income')}</p>
            <p className="font-semibold text-pos">{money(data.current.income)}</p>
          </div>
          <div>
            <p className="text-[12.5px] text-ink-3">{t('fin.expenses')}</p>
            <p className="font-semibold text-neg">{money(data.current.expenses)}</p>
          </div>
          <div>
            <p className="text-[12.5px] text-ink-3">{t('fin.savingsRate')}</p>
            <p className="font-semibold">{data.current.savingsRate == null ? '—' : fmt.percent(data.current.savingsRate)}</p>
          </div>
          <div>
            <p className="text-[12.5px] text-ink-3">{t('fin.cash')}</p>
            <p className="font-semibold">{money(data.net.liquid)}</p>
          </div>
        </div>
      </Panel>
      <Panel title={t('fin.upcoming')} padded={false}>
        {soon.length === 0 ? (
          <p className="p-4 text-[13px] text-ink-3">{t('fin.noUpcoming')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {soon.slice(0, 5).map((u) => (
              <li key={`${u.kind}:${u.id}`}>
                <Link to={u.link} className="flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2">
                  <span className={`num w-16 shrink-0 ${u.overdue ? 'text-neg' : 'text-ink-3'}`}>{fmt.date(u.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  {money(u.amount, u.currency)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function BackupStatus() {
  const { t, fmt } = useI18n();
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupList>('/api/backups') });
  const create = useAction(() => api.post<{ name: string }>('/api/backups'), {
    invalidate: [['backups'], ['audit']],
    success: (r) => t('backup.created', { name: r.name }),
  });
  const last = backups.data?.items.find((b) => b.status === 'ok');
  const stale = !last || Date.now() - Date.parse(last.createdAt) > 2 * 86_400_000;
  return (
    <Panel title={t('dash.dataSafety')}>
      {backups.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {stale ? <ShieldAlert className="size-6 shrink-0 text-warn" /> : <ShieldCheck className="size-6 shrink-0 text-pos" />}
            <div>
              <p className="text-[12.5px] font-medium text-ink-3">{t('dash.lastBackup')}</p>
              <p className="font-semibold">{last ? fmt.relative(last.createdAt) : t('dash.noBackup')}</p>
              {last && stale && <p className="text-[12.5px] text-warn">{t('dash.backupOld')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={stale ? 'primary' : 'secondary'} icon={<HardDriveDownload className="size-4" />} loading={create.isPending} onClick={() => create.mutate(undefined)}>
              {t('dash.backupNow')}
            </Button>
            <Link to="/settings/backups">
              <Button size="sm" variant="ghost">
                {t('settings.backups')}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Panel>
  );
}
