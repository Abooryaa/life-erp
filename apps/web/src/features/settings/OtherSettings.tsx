import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Download, Hash, Pencil, Plus, RefreshCw, Trash2, Wifi, Globe } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Dot, LoadingBlock, Spinner } from '../../components/ui/feedback';
import { TextField } from '../../components/ui/form';
import { DataRow, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useWorkspaces } from '../../lib/hooks';
import type { TagItem, Workspace } from '../../lib/types';
import { useUI } from '../../layout/ui-context';

interface SystemInfo {
  version: string;
  demo: boolean;
  port: number;
  lan: boolean;
  dataDir: string;
  backupDir: string;
  node: string;
  sqlite: string;
  uptimeSec: number;
  counts: Record<string, number>;
  addresses: { iface: string; address: string; tailscale: boolean }[];
}

function useSystem() {
  return useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/api/system') });
}

export function WorkspaceSettings() {
  const { t } = useI18n();
  const ui = useUI();
  const { data = [], isLoading } = useWorkspaces(true);
  const [confirm, setConfirm] = useState<{ ws: Workspace; action: 'archive' | 'delete' } | null>(null);
  const archive = useAction((v: { id: string; archived: boolean }) => api.post(`/api/workspaces/${v.id}/archive`, { archived: v.archived }), {
    invalidate: [['workspaces']],
    onSuccess: () => setConfirm(null),
  });
  const del = useAction((id: string) => api.del(`/api/workspaces/${id}`), { invalidate: [['workspaces']], onSuccess: () => setConfirm(null) });
  return (
    <Panel
      title={t('ws.manage')}
      padded={false}
      actions={
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openWorkspaceForm()}>
          {t('ws.newBusiness')}
        </Button>
      }
    >
      {isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <Dot color={w.color} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {w.name}
                  {w.kind === 'personal' && <Badge tone="accent">{t('ws.personal')}</Badge>}
                  {w.archivedAt && <Badge tone="warn">{t('common.archived')}</Badge>}
                </p>
                {w.industry && <p className="text-[12.5px] text-ink-3">{w.industry}</p>}
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => ui.openWorkspaceForm(w)} aria-label={t('common.edit')}>
                <Pencil className="size-4" />
              </Button>
              {w.kind !== 'personal' && (
                <>
                  {w.archivedAt ? (
                    <Button size="icon-sm" variant="ghost" onClick={() => archive.mutate({ id: w.id, archived: false })} aria-label={t('common.unarchive')} title={t('common.unarchive')}>
                      <ArchiveRestore className="size-4" />
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" onClick={() => setConfirm({ ws: w, action: 'archive' })} aria-label={t('common.archive')} title={t('common.archive')}>
                      <Archive className="size-4" />
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" onClick={() => setConfirm({ ws: w, action: 'delete' })} aria-label={t('common.delete')}>
                    <Trash2 className="size-4 text-neg" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === 'delete' ? t('common.deleteConfirm', { name: confirm.ws.name }) : t('common.archive')}
        body={confirm ? t(confirm.action === 'delete' ? 'ws.deleteConfirm' : 'ws.archiveConfirm', { name: confirm.ws.name }) : null}
        confirmLabel={confirm?.action === 'delete' ? t('common.delete') : t('common.archive')}
        danger={confirm?.action === 'delete'}
        requireWord={confirm?.action === 'delete' ? confirm.ws.name : undefined}
        loading={archive.isPending || del.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === 'delete') del.mutate(confirm.ws.id);
          else archive.mutate({ id: confirm.ws.id, archived: true });
        }}
      />
    </Panel>
  );
}

export function TagSettings() {
  const { t } = useI18n();
  const { data = [], isLoading } = useQuery({ queryKey: ['tags'], queryFn: () => api.get<TagItem[]>('/api/tags') });
  const [editing, setEditing] = useState<TagItem | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<TagItem | null>(null);
  const rename = useAction(() => api.put(`/api/tags/${editing!.id}`, { name }), {
    invalidate: [['tags'], ['documents']],
    success: t('common.saved'),
    onSuccess: () => setEditing(null),
  });
  const del = useAction((id: string) => api.del(`/api/tags/${id}`), { invalidate: [['tags'], ['documents']], onSuccess: () => setDeleting(null) });
  return (
    <Panel title={t('tags.manage')} padded={false}>
      {isLoading ? (
        <LoadingBlock />
      ) : !data.length ? (
        <p className="p-4 text-ink-3">{t('tags.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3 px-4 py-2.5">
              <Hash className="size-4 text-ink-3" />
              <span className="flex-1 font-medium">{tag.name}</span>
              <span className="text-[12.5px] text-ink-3">{t('tags.usage', { n: tag.usage })}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setEditing(tag);
                  setName(tag.name);
                }}
                aria-label={t('tags.rename')}
              >
                <Pencil className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(tag)} aria-label={t('common.delete')}>
                <Trash2 className="size-4 text-neg" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={t('tags.rename')}
        size="sm"
        footer={
          <Button variant="primary" loading={rename.isPending} onClick={() => rename.mutate(undefined)}>
            {t('common.save')}
          </Button>
        }
      >
        <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('common.deleteConfirm', { name: `#${deleting?.name ?? ''}` })}
        body={deleting ? t('tags.usage', { n: deleting.usage }) : null}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Panel>
  );
}

export function DataSettings() {
  const { t } = useI18n();
  const sys = useSystem();
  const rebuild = useAction(() => api.post<{ count: number }>('/api/search/rebuild'), { success: (r) => t('data.rebuilt', { n: r.count }) });
  return (
    <div className="space-y-5">
      <Panel title={t('data.location')}>
        <code className="block rounded-lg bg-surface-2 p-3 text-[13px] break-all" dir="ltr">
          {sys.data?.dataDir ?? '…'}
        </code>
        <p className="mt-2 text-[13px] text-ink-3">{t('data.locationHint')}</p>
      </Panel>
      <Panel title={t('data.exportJson')}>
        <p className="mb-3 text-ink-2">{t('data.exportJsonHint')}</p>
        <a href="/api/export/json">
          <Button icon={<Download className="size-4" />}>{t('data.exportJson')}</Button>
        </a>
      </Panel>
      <Panel title={t('data.rebuildSearch')}>
        <p className="mb-3 text-ink-2">{t('data.rebuildSearchHint')}</p>
        <Button icon={<RefreshCw className="size-4" />} loading={rebuild.isPending} onClick={() => rebuild.mutate(undefined)}>
          {t('data.rebuildSearch')}
        </Button>
      </Panel>
    </div>
  );
}

export function RemoteSettings() {
  const { t } = useI18n();
  const sys = useSystem();
  if (sys.isLoading || !sys.data) return <LoadingBlock />;
  const lanAddrs = sys.data.addresses.filter((a) => !a.tailscale && !a.address.startsWith('100.'));
  const ts = sys.data.addresses.find((a) => a.tailscale);
  return (
    <div className="space-y-5">
      <Panel title={t('remote.lan')}>
        <div className="flex items-start gap-3">
          <Wifi className="mt-0.5 size-5 shrink-0 text-ink-3" />
          <div className="space-y-1.5">
            <p className="text-ink-2">{t('remote.lanHint')}</p>
            {lanAddrs.length ? (
              lanAddrs.map((a) => (
                <code key={a.address} className="block rounded bg-surface-2 px-2 py-1 text-[13px]" dir="ltr">
                  http://{a.address}:{sys.data!.port}
                </code>
              ))
            ) : (
              <p className="text-ink-3">{t('remote.noAddresses')}</p>
            )}
          </div>
        </div>
      </Panel>
      <Panel title={t('remote.tailscale')}>
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 size-5 shrink-0 text-ink-3" />
          <div className="space-y-3">
            {ts ? <Badge tone="pos">{t('remote.tailscaleOn')}</Badge> : <Badge tone="warn">{t('remote.tailscaleOff')}</Badge>}
            <p className="text-ink-2">{t('remote.tailscaleHint')}</p>
            <ol className="list-decimal space-y-1.5 ps-5 text-[13.5px]">
              <li>{t('remote.step1')}</li>
              <li>{t('remote.step2')}</li>
              <li>
                <span dir="ltr">{t('remote.step3').replace('4600', String(sys.data.port))}</span>
              </li>
              <li>{t('remote.step4')}</li>
            </ol>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function AboutSettings() {
  const { t, fmt } = useI18n();
  const sys = useSystem();
  if (sys.isLoading || !sys.data) return <LoadingBlock />;
  const d = sys.data;
  const records = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const hours = Math.floor(d.uptimeSec / 3600);
  const mins = Math.floor((d.uptimeSec % 3600) / 60);
  return (
    <Panel title={t('settings.about')}>
      <dl>
        <DataRow label={t('about.version')}>
          <span dir="ltr">LIFE ERP {d.version}</span>
          {d.demo && <Badge tone="warn" className="ms-2">{t('app.demo')}</Badge>}
        </DataRow>
        <DataRow label={t('about.data')}>
          <code className="text-[12.5px] break-all" dir="ltr">
            {d.dataDir}
          </code>
        </DataRow>
        <DataRow label={t('backup.folder')}>
          <code className="text-[12.5px] break-all" dir="ltr">
            {d.backupDir}
          </code>
        </DataRow>
        <DataRow label={t('about.records')}>{fmt.number(records)}</DataRow>
        <DataRow label={t('about.uptime')}>
          <span dir="ltr">
            {hours}h {mins}m
          </span>
        </DataRow>
        <DataRow label="Runtime">
          <span dir="ltr">
            Node {d.node} · SQLite {d.sqlite}
          </span>
        </DataRow>
      </dl>
    </Panel>
  );
}
