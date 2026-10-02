import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Activity, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { EmptyState, ErrorBlock, LoadingBlock, Spinner } from '../../components/ui/feedback';
import { PageHeader } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import type { AuditItem } from '../../lib/types';

const PAGE = 100;

export function ActivityPage() {
  const { t, fmt } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get<AuditItem[]>(`/api/audit${qs({ limit: PAGE, before: pageParam })}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].at : undefined),
  });
  const items = q.data?.pages.flat() ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('activity.title')} subtitle={t('activity.subtitle')} />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorBlock error={q.error} onRetry={q.refetch} />
      ) : !items.length ? (
        <EmptyState icon={<Activity className="size-5" />} title={t('activity.empty')} />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {items.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{a.summary ?? a.action}</p>
                    <p className="text-[12px] text-ink-3" dir="ltr">
                      {a.action} · {fmt.dateTime(a.at)}
                      {a.ip ? ` · ${a.ip}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-3 rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
      <AuditDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function AuditDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api.get<AuditItem & { before: unknown; after: unknown }>(`/api/audit/${id}`),
    enabled: !!id,
  });
  return (
    <Modal open={!!id} onOpenChange={(o) => !o && onClose()} title={data?.summary ?? t('common.details')} size="lg">
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-3" dir="ltr">
            {data.action} · {fmt.dateTime(data.at)}
          </p>
          {data.before != null && <JsonBlock label={t('activity.before')} value={data.before} />}
          {data.after != null && <JsonBlock label={t('activity.after')} value={data.after} />}
        </div>
      )}
    </Modal>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-semibold text-ink-3 uppercase">{label}</p>
      <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed scrollbar-thin" dir="ltr">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
