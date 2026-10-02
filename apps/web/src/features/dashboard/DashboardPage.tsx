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
