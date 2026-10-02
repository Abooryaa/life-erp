import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Input } from '../../components/ui/form';
import { Spinner, useToast } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import type { LinkItem, SearchHit } from '../../lib/types';
import { EntityIcon, entityLabel } from '../search/search-ui';

/** "Everything is connected": shows and edits the links of any record. */
export function LinksPanel({ type, id }: { type: string; id: string }) {
  const { t, te } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const key = ['links', type, id];
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<LinkItem[]>(`/api/links${qs({ type, id })}`) });

  const unlink = async (linkId: string) => {
    try {
      await api.del(`/api/links/${linkId}`);
      await qc.invalidateQueries({ queryKey: ['links'] });
    } catch (err) {
      toast.error(te((err as Error).message));
    }
  };

  return (
    <Panel
      title={t('links.title')}
      padded={false}
      actions={
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          {t('links.add')}
        </Button>
      }
    >
      {isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : data.length === 0 ? (
        <p className="p-4 text-[13px] text-ink-3">{t('links.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((l) => (
            <li key={l.linkId} className="flex items-center gap-3 px-4 py-2.5">
              <EntityIcon type={l.entity.type} />
              <Link to={l.entity.url} className="min-w-0 flex-1 hover:underline">
                <p className="truncate font-medium">{l.entity.title}</p>
                <p className="truncate text-[12.5px] text-ink-3">{entityLabel(t, l.entity.type)}</p>
              </Link>
              <Button variant="ghost" size="icon-sm" onClick={() => unlink(l.linkId)} aria-label={t('links.unlink')} title={t('links.unlink')}>
                <Unlink className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LinkPicker
        open={adding}
        onOpenChange={setAdding}
        exclude={{ type, id }}
        onPick={async (hit) => {
          try {
            await api.post('/api/links', { from: { type, id }, to: { type: hit.type, id: hit.id } });
            await qc.invalidateQueries({ queryKey: ['links'] });
            setAdding(false);
          } catch (err) {
            toast.error(te((err as Error).message));
          }
        }}
      />
    </Panel>
  );
}

export function LinkPicker({
  open,
  onOpenChange,
  onPick,
  exclude,
  types,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (hit: SearchHit) => void;
  exclude?: { type: string; id: string };
  types?: string[];
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 150);
  const { data = [], isFetching } = useQuery({
    queryKey: ['search', 'picker', dq, types],
    queryFn: () => api.get<SearchHit[]>(`/api/search${qs({ q: dq, limit: 20, types: types?.join(',') })}`),
    enabled: open && dq.length > 0,
  });
  const hits = data.filter((h) => !(exclude && h.type === exclude.type && h.id === exclude.id));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('links.add')}>
      <div className="space-y-3">
        <div className="relative">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('links.searchPlaceholder')} />
          {isFetching && <Spinner className="absolute end-2.5 top-2 size-4" />}
        </div>
        <ul className="space-y-1">
          {hits.map((h) => (
            <li key={`${h.type}:${h.id}`}>
              <button onClick={() => onPick(h)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-surface-2">
                <EntityIcon type={h.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{h.title}</p>
                  <p className="truncate text-[12.5px] text-ink-3">{entityLabel(t, h.type)}</p>
                </div>
                <Link2 className="size-4 text-ink-3" />
              </button>
            </li>
          ))}
          {dq && !isFetching && hits.length === 0 && <p className="py-4 text-center text-[13px] text-ink-3">{t('common.noResults')}</p>}
        </ul>
      </div>
    </Modal>
  );
}
