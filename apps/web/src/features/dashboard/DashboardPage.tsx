import { DASHBOARD_WIDGETS, type DashboardWidget } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, CalendarCheck, CalendarClock, CheckCircle2, FileText, HardDriveDownload, LayoutGrid, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, Dot, Spinner } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useAuthStatus, useSettings } from '../../lib/hooks';
import type { AuditItem, DocumentItem, NotificationItem } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { DocIcon, ExpiryBadge } from '../documents/doc-ui';
import { Money } from '../finance/fin-lib';
import { useGoals } from '../life/life-lib';
import { NotificationRow } from '../notifications/NotificationsPage';
import { useSaveSettings } from '../settings/SettingsPage';

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
  const settings = useSettings();
  const [customizing, setCustomizing] = useState(false);
  const order = (settings.data?.dashboard ?? DEFAULT_WIDGETS).filter((w) => (DASHBOARD_WIDGETS as readonly string[]).includes(w));

  const widgets: Record<DashboardWidget, { span: 1 | 2 | 3; el: ReactNode }> = {
    attention: {
      span: 2,
      el: (
        <Panel title={t('dash.attention')} padded={false} className="h-full">
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
      ),
    },
    backup: { span: 1, el: <BackupStatus /> },
    today: { span: 3, el: <TodaySnapshot /> },
    money: { span: 3, el: <MoneySummary /> },
    networth: { span: 1, el: <NetWorthWidget /> },
    review: { span: 1, el: <ReviewWidget /> },
    goals: { span: 1, el: <GoalsWidget /> },
    business: { span: 1, el: <BusinessWidget /> },
    career: { span: 1, el: <CareerWidget /> },
    documents: { span: 2, el: <RecentDocuments docs={docs} /> },
    workspaces: {
      span: 1,
      el: (
        <Panel title={t('dash.workspaces')} padded={false} className="h-full">
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
      ),
    },
    activity: {
      span: 3,
      el: (
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
      ),
    },
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink-3">{fmt.longDate(new Date().toISOString())}</p>
          <h1 className="mt-0.5 text-[24px] font-semibold tracking-tight">{t(greeting, { name: first })}</h1>
        </div>
        <Button size="sm" variant="ghost" icon={<LayoutGrid className="size-4" />} onClick={() => setCustomizing(true)}>
          {t('dash.customize')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {order.map((id) => (
          <div key={id} className={clsx('empty:hidden', widgets[id].span === 3 ? 'lg:col-span-3' : widgets[id].span === 2 ? 'lg:col-span-2' : '')}>
            {widgets[id].el}
          </div>
        ))}
      </div>
      {customizing && <CustomizeModal current={order} onClose={() => setCustomizing(false)} />}
    </div>
  );
}

const DEFAULT_WIDGETS: DashboardWidget[] = ['attention', 'backup', 'today', 'money', 'networth', 'review', 'goals', 'business', 'career', 'documents', 'workspaces', 'activity'];

function CustomizeModal({ current, onClose }: { current: DashboardWidget[]; onClose: () => void }) {
  const { t } = useI18n();
  const saveSettings = useSaveSettings();
  const [list, setList] = useState<{ id: DashboardWidget; on: boolean }[]>(() => [
    ...current.map((id) => ({ id, on: true })),
    ...DASHBOARD_WIDGETS.filter((w) => !current.includes(w)).map((id) => ({ id, on: false })),
  ]);
  const [saving, setSaving] = useState(false);
  const swap = (i: number, j: number) =>
    setList((s) => {
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const save = async (value: DashboardWidget[] | null) => {
    setSaving(true);
    await saveSettings({ dashboard: value });
    setSaving(false);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('dash.customize')}
      description={t('dash.customizeHint')}
      footer={
        <>
          <Button variant="ghost" className="me-auto" onClick={() => save(null)} disabled={saving}>
            {t('dash.resetLayout')}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => save(list.filter((x) => x.on).map((x) => x.id))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-line">
        {list.map((w, i) => (
          <li key={w.id} className="flex items-center gap-3 py-2">
            <label className="flex min-w-0 flex-1 items-center gap-2.5">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={w.on} onChange={(e) => setList((s) => s.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <span className={clsx('truncate', !w.on && 'text-ink-3')}>{t(`dash.w.${w.id}` as MessageKey)}</span>
            </label>
            <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i - 1)} aria-label={t('car.moveUp')}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i + 1)} aria-label={t('car.moveDown')}>
              <ArrowDown className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function RecentDocuments({ docs }: { docs: { isLoading: boolean; data?: DocumentItem[] } }) {
  const { t, fmt } = useI18n();
  return (
    <Panel
      title={t('dash.recentDocuments')}
      padded={false}
      className="h-full"
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
  );
}

const openLink = (to: string, label: string) => (
  <Link to={to} className="text-[13px] font-medium text-accent hover:underline">
    {label}
  </Link>
);

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 truncate text-ink-3">{label}</dt>
      <dd className="num shrink-0 font-semibold">{value}</dd>
    </div>
  );
}

function NetWorthWidget() {
  const { t } = useI18n();
  const { data } = useQuery({ queryKey: ['insights', 'net-worth'], queryFn: () => api.get<{ now: { base: string; netWorth: number; assets: number; liabilities: number; liquid: number } }>('/api/net-worth') });
  if (!data) return null;
  const n = data.now;
  return (
    <Panel title={t('nw.netWorth')} actions={openLink('/finance/net-worth', t('common.open'))} className="h-full">
      <p className={clsx('num text-[22px] font-semibold', n.netWorth < 0 && 'text-neg')}>
        <Money minor={n.netWorth} currency={n.base} />
      </p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <StatRow label={t('fin.cash')} value={<Money minor={n.liquid} currency={n.base} compact />} />
        <StatRow label={t('nw.assets')} value={<Money minor={n.assets} currency={n.base} compact className="text-pos" />} />
        <StatRow label={t('nw.liabilities')} value={<Money minor={n.liabilities} currency={n.base} compact className="text-neg" />} />
      </dl>
    </Panel>
  );
}

function ReviewWidget() {
  const { t, fmt } = useI18n();
  const { data } = useQuery({ queryKey: ['insights', 'review-status'], queryFn: () => api.get<Record<'weekly' | 'monthly', { periodStart: string; periodEnd: string; done: boolean }>>('/api/reviews/status') });
  if (!data) return null;
  return (
    <Panel title={t('rev.title')} actions={openLink('/reviews', t('common.open'))} className="h-full" padded={false}>
      <ul className="divide-y divide-line">
        {(['weekly', 'monthly'] as const).map((type) => (
          <li key={type}>
            <Link to={`/reviews/${type}/${data[type].periodStart}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <CalendarCheck className={clsx('size-4 shrink-0', data[type].done ? 'text-pos' : 'text-warn')} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`rev.${type}` as MessageKey)}</p>
                <p className="text-[12px] text-ink-3">
                  {fmt.date(data[type].periodStart)} – {fmt.date(data[type].periodEnd)}
                </p>
              </div>
              <Badge tone={data[type].done ? 'pos' : 'warn'}>{data[type].done ? t('rev.done') : t('rev.due')}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function GoalsWidget() {
  const { t } = useI18n();
  const { data } = useGoals();
  if (!data) return null;
  const active = data.filter((g) => g.status === 'active' && g.level !== 'milestone');
  const attention = active.filter((g) => g.health === 'behind' || g.health === 'at_risk' || g.health === 'overdue').slice(0, 4);
  const onTrack = active.filter((g) => g.health === 'on_track').length;
  return (
    <Panel title={t('nav.goalsOkr')} actions={openLink('/goals', t('common.open'))} className="h-full" padded={false}>
      <p className="px-4 pt-3 text-[13px] text-ink-2">{t('dash.goalsSummary', { n: active.length, ok: onTrack })}</p>
      {attention.length ? (
        <ul className="mt-2 divide-y divide-line border-t border-line">
          {attention.map((g) => (
            <li key={g.id}>
              <Link to={`/goals/${g.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{g.title}</span>
                <Badge tone={g.health === 'at_risk' ? 'warn' : 'neg'}>{t(`an.health.${g.health}` as MessageKey)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-1 pb-3 text-[13px] text-ink-3">{active.length ? t('dash.goalsAllGood') : t('an.noGoals')}</p>
      )}
    </Panel>
  );
}

function BusinessWidget() {
  const { t } = useI18n();
  const { workspaces } = useWorkspace();
  const opps = useQuery({ queryKey: ['opportunities', 'dash'], queryFn: () => api.get<{ workspaceId: string; kind: string; nextActionDate: string | null }[]>('/api/opportunities?status=open') });
  const projects = useQuery({ queryKey: ['projects', 'dash'], queryFn: () => api.get<{ workspaceId: string | null; health: string }[]>('/api/projects?status=open') });
  const businesses = workspaces.filter((w) => w.kind === 'business');
  if (!businesses.length || !opps.data || !projects.data) return null;
  const d = new Date().toISOString().slice(0, 10);
  return (
    <Panel title={t('nav.sectionBusiness')} actions={openLink('/pipeline', t('nav.pipeline'))} className="h-full" padded={false}>
      <ul className="divide-y divide-line">
        {businesses.map((w) => {
          const o = opps.data.filter((x) => x.workspaceId === w.id);
          const p = projects.data.filter((x) => x.workspaceId === w.id);
          const due = o.filter((x) => x.nextActionDate && x.nextActionDate <= d).length;
          const late = p.filter((x) => x.health === 'delayed' || x.health === 'over_budget').length;
          return (
            <li key={w.id}>
              <Link to={`/workspaces/${w.id}`} className="block px-4 py-2.5 hover:bg-surface-2">
                <p className="flex items-center gap-2 font-medium">
                  <Dot color={w.color} />
                  {w.name}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {t('dash.bizLine', { deals: o.length, projects: p.length })}
                  {due > 0 && <span className="text-warn"> · {t('dash.actionsDue', { n: due })}</span>}
                  {late > 0 && <span className="text-neg"> · {t('biz.delayed', { n: late })}</span>}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CareerWidget() {
  const { t, fmt } = useI18n();
  const { data } = useQuery({
    queryKey: ['career', 'overview'],
    queryFn: () =>
      api.get<{ openApplications: number; interviews: { id: string; company: string; date: string; time: string | null; applicationId: string }[]; learning: { id: string; title: string; progress: number }[]; skillGaps: unknown[] }>(
        '/api/career/overview',
      ),
  });
  if (!data) return null;
  const next = data.interviews[0];
  return (
    <Panel title={t('car.title')} actions={openLink('/career', t('common.open'))} className="h-full">
      <dl className="space-y-1.5 text-[13px]">
        <StatRow label={t('car.openApplications')} value={data.openApplications} />
        <StatRow label={t('car.learningNow')} value={data.learning.length} />
        <StatRow label={t('car.skillGaps')} value={data.skillGaps.length} />
      </dl>
      {next && (
        <Link to={`/career/applications?open=${next.applicationId}`} className="mt-3 flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-[13px] text-info">
          <CalendarClock className="size-4 shrink-0" />
          <span className="truncate">
            {t('dash.nextInterview', { company: next.company })} · {fmt.date(next.date)} {next.time ?? ''}
          </span>
        </Link>
      )}
    </Panel>
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
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4 [&_p]:whitespace-nowrap">
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
      <Panel title={t('dash.next7')} padded={false}>
        {soon.length === 0 ? (
          <p className="p-4 text-[13px] text-ink-3">{t('fin.noUpcoming')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {soon.slice(0, 5).map((u) => (
              <li key={`${u.kind}:${u.id}`}>
                <Link to={u.link} className="block px-4 py-2 text-[13px] hover:bg-surface-2">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{u.name}</span>
                    <span className="num shrink-0 font-medium whitespace-nowrap" dir="ltr">
                      {fmt.money(u.amount, u.currency, { compact: true })}
                    </span>
                  </span>
                  <span className={`num text-[12px] ${u.overdue ? 'text-neg' : 'text-ink-3'}`}>{fmt.date(u.date)}</span>
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
            <ButtonLink to="/settings/backups" size="sm" variant="ghost">
              {t('settings.backups')}
            </ButtonLink>
          </div>
        </div>
      )}
    </Panel>
  );
}
