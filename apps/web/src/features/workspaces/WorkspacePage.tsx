import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Badge, Dot, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import type { Workspace } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';

/**
 * Workspace home. Each phase adds its module panels here
 * (P&L, pipeline, projects, tasks, KPIs) scoped to this workspace.
 */
export function WorkspacePage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const ui = useUI();
  const { setCurrentId, currentId } = useWorkspace();
  const { data: ws, isLoading, error, refetch } = useQuery({ queryKey: ['workspaces', id], queryFn: () => api.get<Workspace>(`/api/workspaces/${id}`) });

  if (isLoading) return <LoadingBlock />;
  if (error || !ws) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <Dot color={ws.color} />
            {ws.name}
          </span>
        }
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={ws.kind === 'personal' ? 'accent' : 'neutral'}>{ws.kind === 'personal' ? t('ws.personal') : t('ws.business')}</Badge>
            {ws.industry}
            {ws.archivedAt && <Badge tone="warn">{t('common.archived')}</Badge>}
          </span>
        }
        actions={
          <>
            {currentId !== ws.id && (
              <Button variant="secondary" onClick={() => setCurrentId(ws.id)}>
                {t('ws.switch')}
              </Button>
            )}
            <Button icon={<Pencil className="size-4" />} onClick={() => ui.openWorkspaceForm(ws)}>
              {t('common.edit')}
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title={t('ws.profile')}>
            <dl>
              <DataRow label={t('ws.industry')}>{ws.industry || '—'}</DataRow>
              <DataRow label={t('common.currency')}>{ws.currency}</DataRow>
              <DataRow label={t('ws.website')}>
                {ws.website ? (
                  <a href={/^https?:\/\//.test(ws.website) ? ws.website : `https://${ws.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline" dir="ltr">
                    {ws.website}
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  '—'
                )}
              </DataRow>
            </dl>
            {ws.description && <p className="mt-3 whitespace-pre-wrap text-ink-2">{ws.description}</p>}
            {ws.notes && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3">
                <p className="mb-1 text-[12px] font-semibold text-ink-3 uppercase">{t('common.notes')}</p>
                <p className="text-[13.5px] whitespace-pre-wrap">{ws.notes}</p>
              </div>
            )}
          </Panel>
          <AttachmentsPanel type="workspace" id={ws.id} workspaceId={ws.id} />
        </div>
        <LinksPanel type="workspace" id={ws.id} />
      </div>
    </div>
  );
}
