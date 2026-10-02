import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Select, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { WORKSPACE_COLORS } from '../workspaces/WorkspaceFormModal';
import { FIN_KEYS, useCategories, useCategoryName, type Category } from './fin-lib';

export function CategoriesPage() {
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const { data = [], isLoading } = useCategories(showArchived);
  const [editing, setEditing] = useState<{ cat?: Category; kind: 'income' | 'expense'; parentId?: string } | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const name = useCategoryName();
  const archive = useAction((v: { id: string; archived: boolean }) => api.post(`/api/finance/categories/${v.id}/archive`, { archived: v.archived }), { invalidate: FIN_KEYS });
  const del = useAction((id: string) => api.del(`/api/finance/categories/${id}`), { invalidate: FIN_KEYS, onSuccess: () => setDeleting(null) });

  if (isLoading) return <LoadingBlock />;

  const row = (c: Category, child = false) => (
    <li key={c.id} className={`flex items-center gap-3 py-2 pe-3 ${child ? 'ps-10' : 'ps-4'}`}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? '#94a3b8' }} />
      <span className={`min-w-0 flex-1 truncate ${child ? 'text-ink-2' : 'font-medium'}`}>
        {name(c)}
        {c.archivedAt && (
          <Badge tone="warn" className="ms-2">
            {t('common.archived')}
          </Badge>
        )}
      </span>
      {!child && !c.archivedAt && (
        <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ kind: c.kind, parentId: c.id })} aria-label={t('cat.addSub')} title={t('cat.addSub')}>
          <Plus className="size-4" />
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ cat: c, kind: c.kind })} aria-label={t('common.edit')}>
        <Pencil className="size-4" />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => archive.mutate({ id: c.id, archived: !c.archivedAt })} aria-label={c.archivedAt ? t('common.unarchive') : t('common.archive')} title={c.archivedAt ? t('common.unarchive') : t('common.archive')}>
        {c.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(c)} aria-label={t('common.delete')}>
        <Trash2 className="size-4 text-neg" />
      </Button>
    </li>
  );

  return (
    <div>
      <PageHeader
        title={t('cat.title')}
        actions={
          <Button variant="ghost" onClick={() => setShowArchived((s) => !s)}>
            {t('common.showArchived')}
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {(['expense', 'income'] as const).map((kind) => (
          <Panel
            key={kind}
            title={kind === 'expense' ? t('cat.expense') : t('cat.income')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind })}>
                {t('cat.new')}
              </Button>
            }
          >
            <ul className="divide-y divide-line">
              {data
                .filter((c) => c.kind === kind && !c.parentId)
                .map((c) => (
                  <li key={c.id}>
                    <ul>
                      {row(c)}
                      {data.filter((s) => s.parentId === c.id).map((s) => row(s, true))}
                    </ul>
                  </li>
                ))}
            </ul>
          </Panel>
        ))}
      </div>
      <CategoryFormModal state={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('common.deleteConfirm', { name: deleting ? name(deleting) : '' })}
        body={t('common.cannotUndo')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        error={del.error ? (del.error as Error).message : null}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}

function CategoryFormModal({ state, onClose }: { state: { cat?: Category; kind: 'income' | 'expense'; parentId?: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  const name = useCategoryName();
  const { data = [] } = useCategories();
  const cat = state?.cat;
  const init = () => ({ name: cat?.name ?? '', nameAr: cat?.nameAr ?? '', parentId: cat?.parentId ?? state?.parentId ?? '', color: cat?.color ?? WORKSPACE_COLORS[0] });
  const form = useFormState(init());
  useEffect(() => {
    if (state) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    () => {
      const body = { ...form.values, kind: state!.kind, parentId: form.values.parentId || null, nameAr: form.values.nameAr || null };
      return cat ? api.put(`/api/finance/categories/${cat.id}`, body) : api.post('/api/finance/categories', body);
    },
    { invalidate: FIN_KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: onClose },
  );
  const parents = data.filter((c) => !c.parentId && c.kind === state?.kind && c.id !== cat?.id);
  return (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={cat ? t('cat.edit') : t('cat.new')}
      size="sm"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={form.values.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
        <TextField label={t('cat.nameAr')} optional dir="rtl" value={form.values.nameAr} onChange={(e) => form.set('nameAr', e.target.value)} />
        <Field label={t('cat.parent')}>
          <Select value={form.values.parentId} onChange={(e) => form.set('parentId', e.target.value)}>
            <option value="">{t('cat.noParent')}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {name(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.color')}>
          <div className="flex flex-wrap gap-2">
            {WORKSPACE_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => form.set('color', c)} className={`size-7 rounded-full ring-offset-2 ring-offset-surface ${form.values.color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
