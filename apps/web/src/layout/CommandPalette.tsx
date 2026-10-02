import * as D from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Spinner } from '../components/ui/feedback';
import { EntityIcon, entityLabel, Snippet } from '../features/search/search-ui';
import { useI18n } from '../i18n';
import { api, qs } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import type { SearchHit } from '../lib/types';
import { useWorkspace } from '../lib/workspace';

/** Ctrl+K global search across every module. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const { currentId } = useWorkspace();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 150);
  const { data = [], isFetching } = useQuery({
    queryKey: ['search', dq, currentId],
    queryFn: () => api.get<SearchHit[]>(`/api/search${qs({ q: dq, workspaceId: currentId, limit: 20 })}`),
    enabled: open && dq.length > 0,
  });

  useEffect(() => setActive(0), [dq]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (hit: SearchHit) => {
    onOpenChange(false);
    navigate(hit.url);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content dir={dir} className="fixed inset-x-3 top-[8vh] z-50 mx-auto max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop focus:outline-none">
          <D.Title className="sr-only">{t('nav.search')}</D.Title>
          <D.Description className="sr-only">{t('search.hint')}</D.Description>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, data.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && data[active]) {
                  e.preventDefault();
                  go(data[active]);
                }
              }}
              placeholder={t('search.placeholder')}
              className="h-12 flex-1 bg-transparent outline-none placeholder:text-ink-3"
            />
            {isFetching && <Spinner className="size-4" />}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5 scrollbar-thin">
            {!dq && <p className="px-3 py-6 text-center text-[13px] text-ink-3">{t('search.hint')}</p>}
            {dq && !isFetching && data.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-3">{t('common.noResults')}</p>}
            {data.map((hit, i) => (
              <button
                key={`${hit.type}:${hit.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start ${i === active ? 'bg-surface-2' : ''}`}
              >
                <EntityIcon type={hit.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{hit.title}</p>
                  <p className="truncate text-[12.5px] text-ink-3">
                    {entityLabel(t, hit.type)}
                    {hit.snippet && (
                      <>
                        {' · '}
                        <Snippet text={hit.snippet} />
                      </>
                    )}
                  </p>
                </div>
                {i === active && <CornerDownLeft className="mt-1 size-3.5 text-ink-3" />}
              </button>
            ))}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
