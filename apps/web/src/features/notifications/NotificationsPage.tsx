import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Bell, BellRing, CheckCheck, Info, X } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import type { NotificationItem } from '../../lib/types';

export const SEVERITY = {
  critical: { icon: AlertOctagon, tone: 'text-neg bg-neg-soft', label: 'notif.critical' },
  warning: { icon: AlertTriangle, tone: 'text-warn bg-warn-soft', label: 'notif.warning' },
  reminder: { icon: BellRing, tone: 'text-accent bg-accent-soft', label: 'notif.reminder' },
  info: { icon: Info, tone: 'text-info bg-info-soft', label: 'notif.info' },
} as const;

export function NotificationRow({ n, compact }: { n: NotificationItem; compact?: boolean }) {
  const { t, fmt } = useI18n();
  const s = SEVERITY[n.severity];
  const Icon = s.icon;
  const read = useAction(() => api.post(`/api/notifications/${n.id}/read`), { invalidate: [['notifications']] });
  const dismiss = useAction(() => api.post(`/api/notifications/${n.id}/dismiss`), { invalidate: [['notifications']] });
  const body = (
    <>
      <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', s.tone)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate', n.readAt ? 'text-ink-2' : 'font-semibold')}>{n.title}</p>
        {n.body && !compact && <p className="text-[13px] text-ink-3">{n.body}</p>}
        <p className="text-[12px] text-ink-3">
          {t(s.label as MessageKey)} · {fmt.relative(n.createdAt)}
        </p>
      </div>
    </>
  );
  return (
    <li className="flex items-start gap-1 px-3 py-2.5 hover:bg-surface-2">
      {n.link ? (
        <Link to={n.link} onClick={() => !n.readAt && read.mutate(undefined)} className="flex min-w-0 flex-1 items-start gap-3">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3" onClick={() => !n.readAt && read.mutate(undefined)}>
          {body}
        </div>
      )}
      <Button variant="ghost" size="icon-sm" onClick={() => dismiss.mutate(undefined)} aria-label={t('notif.dismiss')} title={t('notif.dismiss')}>
        <X className="size-4" />
      </Button>
    </li>
  );
}

export function NotificationsPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; counts: { unread: number } }>('/api/notifications'),
  });
  const readAll = useAction(() => api.post('/api/notifications/read-all'), { invalidate: [['notifications']] });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('notif.title')}
        actions={
          data?.counts.unread ? (
            <Button icon={<CheckCheck className="size-4" />} onClick={() => readAll.mutate(undefined)}>
              {t('notif.markAllRead')}
            </Button>
          ) : null
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Bell className="size-5" />} title={t('notif.empty')} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.items.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}
