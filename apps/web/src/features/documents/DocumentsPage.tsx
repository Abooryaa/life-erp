import { DOCUMENT_TYPES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Dot, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { PageHeader } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import type { DocumentItem } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { TagList } from '../shared/TagEditor';
import { DocIcon, ExpiryBadge, useDocTypeLabel } from './doc-ui';

export function DocumentsPage() {
  const { t, fmt } = useI18n();
  const ui = useUI();
  const typeLabel = useDocTypeLabel();
  const { currentId, byId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 250);
  const docType = params.get('type') ?? '';
  const tag = params.get('tag') ?? '';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['documents', { currentId, dq, docType, tag }],
    queryFn: () => api.get<DocumentItem[]>(`/api/documents${qs({ workspaceId: currentId, q: dq, docType, tag })}`),
  });

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('docs.title')}
        actions={
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => ui.openUpload()}>
            {t('docs.upload')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs flex-1" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-44" value={docType} onChange={(e) => setParam('type', e.target.value)} aria-label={t('docs.docType')}>
          <option value="">{t('docs.filterType')}</option>
          {DOCUMENT_TYPES.map((d) => (
            <option key={d} value={d}>
              {typeLabel(d)}
            </option>
          ))}
        </Select>
        {tag && (
          <Button size="md" variant="subtle" onClick={() => setParam('tag', '')}>
            #{tag} ✕
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data?.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={<FileText className="size-5" />}
            title={t('docs.empty')}
            body={t('docs.emptyBody')}
            action={
              <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => ui.openUpload()}>
                {t('docs.upload')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="hidden grid-cols-[minmax(0,1fr)_140px_160px_100px_110px] gap-4 border-b border-line bg-surface-2 px-4 py-2 text-[12px] font-semibold text-ink-3 uppercase md:grid">
            <span>{t('common.name')}</span>
            <span>{t('common.type')}</span>
            <span>{t('common.workspace')}</span>
            <span className="text-end">{t('common.size')}</span>
            <span className="text-end">{t('common.created')}</span>
          </div>
          <ul className="divide-y divide-line">
            {data.map((d) => {
              const ws = byId(d.workspaceId);
              return (
                <li key={d.id}>
                  <Link
                    to={`/documents/${d.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2 md:grid-cols-[minmax(0,1fr)_140px_160px_100px_110px]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <DocIcon mime={d.mime} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium">
                          <span className="truncate">{d.title}</span>
                          <ExpiryBadge expiresOn={d.expiresOn} />
                        </p>
                        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                          <span className="truncate">{d.originalName}</span>
                          <TagList tags={d.tags} />
                        </p>
                      </div>
                    </div>
                    <span className="text-[12.5px] text-ink-3 md:hidden">{fmt.date(d.createdAt)}</span>
                    <span className="hidden text-[13px] text-ink-2 md:block">{typeLabel(d.docType)}</span>
                    <span className="hidden min-w-0 items-center gap-2 text-[13px] text-ink-2 md:flex">
                      {ws && (
                        <>
                          <Dot color={ws.color} />
                          <span className="truncate">{ws.name}</span>
                        </>
                      )}
                    </span>
                    <span className="num hidden text-end text-[13px] text-ink-2 md:block">{fmt.bytes(d.size)}</span>
                    <span className="num hidden text-end text-[13px] text-ink-2 md:block">{fmt.date(d.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
