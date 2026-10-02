import { useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import type { DocumentItem } from '../../lib/types';
import { useUI } from '../../layout/ui-context';
import { DocIcon } from '../documents/doc-ui';

/** Files attached to any record (stored as linked Documents). */
export function AttachmentsPanel({ type, id, workspaceId }: { type: string; id: string; workspaceId?: string | null }) {
  const { t, fmt } = useI18n();
  const ui = useUI();
  const { data = [], isLoading } = useQuery({
    queryKey: ['documents', { attachedType: type, attachedId: id }],
    queryFn: () => api.get<DocumentItem[]>(`/api/documents${qs({ attachedType: type, attachedId: id })}`),
  });
  return (
    <Panel
      title={t('docs.attachments')}
      padded={false}
      actions={
        <Button size="sm" variant="ghost" icon={<Paperclip className="size-4" />} onClick={() => ui.openUpload({ type, id, workspaceId })}>
          {t('docs.attach')}
        </Button>
      }
    >
      {isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : data.length === 0 ? (
        <p className="p-4 text-[13px] text-ink-3">{t('docs.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((d) => (
            <li key={d.id}>
              <Link to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                <DocIcon mime={d.mime} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="truncate text-[12.5px] text-ink-3">
                    {fmt.bytes(d.size)} · {fmt.date(d.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
