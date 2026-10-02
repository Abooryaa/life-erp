import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, HardDriveDownload, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, LoadingBlock, Spinner, useToast } from '../../components/ui/feedback';
import { Field, Input, Select, Switch } from '../../components/ui/form';
import { Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, uploadWithProgress } from '../../lib/api';
import { useAction, useSettings } from '../../lib/hooks';
import { useSaveSettings } from './SettingsPage';

interface BackupItem {
  id: string;
  name: string | null;
  kind: 'manual' | 'auto' | 'safety';
  status: 'ok' | 'failed';
  createdAt: string;
  size: number | null;
  error: string | null;
  exists: boolean;
}

interface Inspect {
  valid: boolean;
  problems: string[];
  size: number;
  manifest: { createdAt: string; appVersion: string; demo: boolean; tableCounts: Record<string, number>; fileCount: number } | null;
}

export function BackupSettings() {
  const { t, fmt } = useI18n();
  const { data: s } = useSettings();
  const saveSettings = useSaveSettings();
  const [folder, setFolder] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { te } = useI18n();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ dir: string; items: BackupItem[] }>('/api/backups') });
  const create = useAction(() => api.post<{ name: string }>('/api/backups'), {
    invalidate: [['backups'], ['audit']],
    success: (r) => t('backup.created', { name: r.name }),
  });
  const del = useAction((name: string) => api.del(`/api/backups/${encodeURIComponent(name)}`), {
    invalidate: [['backups']],
    onSuccess: () => setDeleteName(null),
  });

  if (!s) return <LoadingBlock />;

  const uploadBackup = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file, file.name);
    setUploading(0);
    try {
      const r = await uploadWithProgress<{ name: string }>('/api/backups/upload', fd, setUploading);
      await qc.invalidateQueries({ queryKey: ['backups'] });
      setRestoreName(r.name);
    } catch (err) {
      toast.error(te((err as Error).message));
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <Panel title={t('backup.title')}>
        <p className="mb-4 text-ink-2">{t('backup.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<HardDriveDownload className="size-4" />} loading={create.isPending} onClick={() => create.mutate(undefined)}>
            {create.isPending ? t('backup.creating') : t('backup.create')}
          </Button>
          <Button icon={<Upload className="size-4" />} loading={uploading !== null} onClick={() => fileRef.current?.click()}>
            {uploading !== null ? `${Math.round(uploading * 100)}%` : t('backup.uploadRestore')}
          </Button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => uploadBackup(e.target.files?.[0])} />
        </div>
      </Panel>

      <Panel title={t('backup.auto')}>
        <div className="space-y-4">
          <Switch checked={s.backup.auto} onChange={(v) => saveSettings({ backup: { ...s.backup, auto: v } })} label={t('backup.auto')} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('backup.time')}>
              <Input type="time" value={s.backup.time} onChange={(e) => e.target.value && saveSettings({ backup: { ...s.backup, time: e.target.value } })} />
            </Field>
            <Field label={t('backup.retention')}>
              <Select value={s.backup.retention} onChange={(e) => saveSettings({ backup: { ...s.backup, retention: Number(e.target.value) } })}>
                {[3, 7, 14, 30, 60, 90].map((n) => (
                  <option key={n} value={n}>
                    {t('backup.retentionDays', { n })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('backup.folder')} hint={t('backup.folderHint')}>
            <div className="flex gap-2">
              <Input dir="ltr" value={folder ?? s.backup.dir ?? ''} placeholder={list.data?.dir} onChange={(e) => setFolder(e.target.value)} />
              <Button
                disabled={folder === null}
                onClick={async () => {
                  await saveSettings({ backup: { ...s.backup, dir: folder?.trim() || null } });
                  setFolder(null);
                  qc.invalidateQueries({ queryKey: ['backups'] });
                }}
              >
                {t('common.save')}
              </Button>
            </div>
          </Field>
        </div>
      </Panel>

      <Panel title={t('backup.list')} padded={false}>
        {list.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : !list.data?.items.length ? (
          <p className="p-4 text-ink-3">{t('backup.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium" dir="ltr">
                    {b.name ?? '—'}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                    {fmt.dateTime(b.createdAt)}
                    {b.size ? ` · ${fmt.bytes(b.size)}` : ''}
                    <Badge tone={b.kind === 'safety' ? 'warn' : b.kind === 'auto' ? 'info' : 'neutral'}>{t(`backup.kind.${b.kind}` as MessageKey)}</Badge>
                    {b.status === 'failed' && <Badge tone="neg">{t('backup.failed')}</Badge>}
                    {b.status === 'ok' && !b.exists && <Badge tone="warn">{t('backup.missing')}</Badge>}
                  </p>
                  {b.error && <p className="text-[12.5px] text-neg">{b.error}</p>}
                </div>
                {b.status === 'ok' && b.exists && b.name && (
                  <div className="flex gap-1">
                    <a href={`/api/backups/${encodeURIComponent(b.name)}/download`}>
                      <Button size="icon-sm" variant="ghost" aria-label={t('common.download')} title={t('common.download')}>
                        <Download className="size-4" />
                      </Button>
                    </a>
                    <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setRestoreName(b.name)}>
                      {t('backup.restore')}
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setDeleteName(b.name)} aria-label={t('common.delete')}>
                      <Trash2 className="size-4 text-neg" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <RestoreDialog name={restoreName} onClose={() => setRestoreName(null)} />
      <ConfirmDialog
        open={!!deleteName}
        onOpenChange={(o) => !o && setDeleteName(null)}
        title={t('common.deleteConfirm', { name: deleteName ?? '' })}
        body={t('common.cannotUndo')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleteName && del.mutate(deleteName)}
      />
    </div>
  );
}

function RestoreDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
  const { t, fmt, te } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = useQuery({
    queryKey: ['backups', 'inspect', name],
    queryFn: () => api.get<Inspect>(`/api/backups/${encodeURIComponent(name!)}/inspect`),
    enabled: !!name,
    staleTime: 0,
  });
  const close = () => {
    setTyped('');
    setError(null);
    onClose();
  };
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ safetyBackup: string }>(`/api/backups/${encodeURIComponent(name!)}/restore`, { confirm: typed.trim() });
      toast.success(t('backup.restored', { name: r.safetyBackup }));
      close();
      // Everything changed: reload all data (the session may also be different now).
      qc.clear();
      await qc.invalidateQueries();
      window.location.assign('/');
    } catch (err) {
      setError(te((err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const m = info.data?.manifest;
  const records = m ? Object.values(m.tableCounts).reduce((a, b) => a + b, 0) : 0;
  return (
    <Modal
      open={!!name}
      onOpenChange={(o) => !o && close()}
      title={t('backup.restoreTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={busy} disabled={!info.data?.valid || typed.trim() !== 'RESTORE'} onClick={restore}>
            {busy ? t('backup.restoring') : t('backup.restore')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] break-all text-ink-3" dir="ltr">
          {name}
        </p>
        {info.isLoading ? (
          <div className="flex items-center gap-2 text-ink-3">
            <Spinner className="size-4" />
            {t('backup.verifying')}
          </div>
        ) : info.data?.valid ? (
          <>
            <div className="flex items-center gap-2 text-pos">
              <CheckCircle2 className="size-4" />
              {t('backup.valid')}
            </div>
            {m && (
              <div className="rounded-lg bg-surface-2 p-3 text-[13px]">
                <p>{t('backup.madeOn', { date: fmt.dateTime(m.createdAt) })}</p>
                <p className="text-ink-3">
                  {t('backup.records', { n: records })} · {t('backup.files', { n: m.fileCount })} · {fmt.bytes(info.data.size)} · v{m.appVersion}
                </p>
              </div>
            )}
            <div className="flex gap-2 rounded-lg border border-neg/30 bg-neg-soft p-3 text-[13px] text-neg">
              <AlertTriangle className="size-4 shrink-0" />
              {t('backup.restoreWarning')}
            </div>
            <Field label={t('common.typeToConfirm', { word: 'RESTORE' })}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" autoComplete="off" />
            </Field>
          </>
        ) : (
          <div className="space-y-2 text-neg">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              {t('backup.invalid')}
            </p>
            <ul className="list-disc ps-5 text-[13px]">
              {(info.data?.problems ?? [info.error ? (info.error as Error).message : '']).slice(0, 5).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-[13px] text-neg">{error}</p>}
      </div>
    </Modal>
  );
}
