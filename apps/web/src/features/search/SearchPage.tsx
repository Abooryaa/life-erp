import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, Spinner } from '../../components/ui/feedback';
import { PageHeader } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import type { SearchHit } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { EntityIcon, entityLabel, Snippet } from './search-ui';

export function SearchPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 200);
  const { currentId } = useWorkspace();
  const { data = [], isFetching } = useQuery({
    queryKey: ['search', 'page', dq, currentId],
    queryFn: () => api.get<SearchHit[]>(`/api/search${qs({ q: dq, workspaceId: currentId, limit: 60 })}`),
    enabled: dq.length > 0,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('nav.search')} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
          placeholder={t('search.placeholder')}
          className="h-12 w-full rounded-xl border border-line-strong bg-surface ps-10 pe-10 shadow-card outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        {isFetching && <Spinner className="absolute end-3 top-3.5 size-4" />}
      </div>
      {!dq ? (
        <p className="py-8 text-center text-[13.5px] text-ink-3">{t('search.hint')}</p>
      ) : !isFetching && data.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title={t('common.noResults')} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.map((h) => (
            <li key={`${h.type}:${h.id}`}>
              <Link to={h.url} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <EntityIcon type={h.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{h.title}</p>
                  <p className="text-[12.5px] text-ink-3">{entityLabel(t, h.type)}</p>
                  {h.snippet && (
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">
                      <Snippet text={h.snippet} />
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
