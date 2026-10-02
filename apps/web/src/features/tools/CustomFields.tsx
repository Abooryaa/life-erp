import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, Spinner } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';

export interface FieldDef {
  id: string;
  entityType: string;
  label: string;
  type: (typeof CUSTOM_FIELD_TYPES)[number];
  options: string[];
  required: boolean;
  sortOrder: number;
}
type FieldValue = FieldDef & { value: string | null };

const CF_KEYS = [['custom-fields'], ['search'], ['audit']];

// ---------- settings: define fields ----------

export function CustomFieldSettings() {
  const { t } = useI18n();
  const [entity, setEntity] = useState<string>('person');
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null);
  const [del, setDel] = useState<FieldDef | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['custom-fields', 'defs', entity], queryFn: () => api.get<FieldDef[]>(`/api/custom-fields?entityType=${entity}`) });
  const reorder = useAction((ids: string[]) => api.put('/api/custom-fields/order', ids), { invalidate: CF_KEYS });
  const remove = useAction((id: string) => api.del(`/api/custom-fields/${id}`), { invalidate: CF_KEYS, success: t('common.saved'), onSuccess: () => setDel(null) });
  const move = (i: number, j: number) => {
    if (j < 0 || j >= data.length) return;
    const ids = data.map((d) => d.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };
  return (
    <Panel
      title={t('cf.title')}
      actions={
        <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          {t('cf.add')}
        </Button>
      }
    >
      <p className="mb-3 text-[13px] text-ink-3">{t('cf.intro')}</p>
      <Field label={t('cf.recordType')}>
        <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
          {CUSTOM_FIELD_ENTITIES.map((e) => (
            <option key={e} value={e}>
              {t(`entity.${e}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="mt-4">
        {isLoading ? (
          <Spinner />
        ) : !data.length ? (
          <EmptyState icon={<ListPlus className="size-5" />} title={t('cf.empty')} body={t('cf.emptyBody')} />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data.map((d, i) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.label}
                    {d.required && <span className="ms-1 text-neg">*</span>}
                  </p>
                  <p className="truncate text-[12px] text-ink-3">
                    {t(`cf.type.${d.type}` as MessageKey)}
                    {d.type === 'select' && ` · ${d.options.join(', ')}`}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" onClick={() => move(i, i - 1)} aria-label={t('car.moveUp')}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => move(i, i + 1)} aria-label={t('car.moveDown')}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(d)} aria-label={t('common.edit')}>
                  <Pencil className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setDel(d)} aria-label={t('common.delete')}>
                  <Trash2 className="size-4 text-neg" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <FieldDefModal def={editing === 'new' ? undefined : editing} entityType={entity} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={t('common.deleteConfirm', { name: del?.label ?? '' })}
        body={t('cf.deleteBody')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => del && remove.mutate(del.id)}
      />
    </Panel>
  );
}

function FieldDefModal({ def, entityType, onClose }: { def?: FieldDef; entityType: string; onClose: () => void }) {
  const { t } = useI18n();
  const form = useFormState({ label: def?.label ?? '', type: def?.type ?? 'text', options: def?.options.join('\n') ?? '', required: def?.required ?? false });
  const v = form.values;
  const body = () => ({ entityType, label: v.label, type: v.type, required: v.required, options: v.options.split('\n').map((s) => s.trim()).filter(Boolean) });
  const save = useAction(() => (def ? api.put(`/api/custom-fields/${def.id}`, body()) : api.post('/api/custom-fields', body())), {
    invalidate: CF_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={def ? t('cf.edit') : t('cf.add')}
      size="sm"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('cf.label')} value={v.label} onChange={(e) => form.set('label', e.target.value)} error={form.errors.label} autoFocus />
        <Field label={t('common.type')} hint={def ? t('cf.typeLocked') : undefined}>
          <Select value={v.type} onChange={(e) => form.set('type', e.target.value as FieldDef['type'])}>
            {CUSTOM_FIELD_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`cf.type.${x}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        {v.type === 'select' && (
          <Field label={t('cf.options')} hint={t('cf.optionsHint')} error={form.errors.options}>
            <Textarea value={v.options} onChange={(e) => form.set('options', e.target.value)} rows={4} />
          </Field>
        )}
        <Switch checked={v.required} onChange={(x) => form.set('required', x)} label={t('cf.required')} />
      </div>
    </Modal>
  );
}

// ---------- on a record: show & edit values ----------

/** Custom fields of one record. Renders nothing when that record type has no custom fields. */
export function CustomFieldsPanel({ type, id }: { type: string; id: string }) {
  const { t, fmt } = useI18n();
  const [editing, setEditing] = useState(false);
  const { data } = useQuery({ queryKey: ['custom-fields', 'values', type, id], queryFn: () => api.get<FieldValue[]>(`/api/custom-fields/values/${type}/${id}`) });
  if (!data?.length) return null;
  const show = (f: FieldValue) => {
    if (f.value == null) return <span className="text-ink-3">—</span>;
    if (f.type === 'checkbox') return t('common.yes');
    if (f.type === 'date') return fmt.date(f.value);
    if (f.type === 'number') return <span className="num">{fmt.number(Number(f.value))}</span>;
    if (f.type === 'url')
      return (
        <a href={f.value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline" dir="ltr">
          {f.value.replace(/^https?:\/\//, '').slice(0, 40)}
          <ExternalLink className="size-3" />
        </a>
      );
    return <span className="whitespace-pre-wrap">{f.value}</span>;
  };
  return (
    <Panel
      title={t('cf.panel')}
      actions={
        <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
          {t('common.edit')}
        </Button>
      }
    >
      <dl className="space-y-2 text-[13.5px]">
        {data.map((f) => (
          <div key={f.id} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-ink-3">
              {f.label}
              {f.required && f.value == null && <Badge tone="warn" className="ms-1">{t('common.required')}</Badge>}
            </dt>
            <dd className="min-w-0 text-end break-words">{show(f)}</dd>
          </div>
        ))}
      </dl>
      {editing && <ValuesModal type={type} id={id} fields={data} onClose={() => setEditing(false)} />}
    </Panel>
  );
}

function ValuesModal({ type, id, fields, onClose }: { type: string; id: string; fields: FieldValue[]; onClose: () => void }) {
  const { t } = useI18n();
  const form = useFormState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.id, f.value ?? ''])));
  useEffect(() => form.setValues(Object.fromEntries(fields.map((f) => [f.id, f.value ?? '']))), [fields]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => api.put(`/api/custom-fields/values/${type}/${id}`, Object.fromEntries(Object.entries(form.values).map(([k, x]) => [k, x === '' ? null : x]))), {
    invalidate: CF_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('cf.panel')}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        {fields.map((f) => {
          const v = form.values[f.id] ?? '';
          const set = (x: string) => form.set(f.id, x);
          const error = form.errors[f.id];
          if (f.type === 'checkbox') return <Switch key={f.id} checked={v === 'true'} onChange={(x) => set(x ? 'true' : '')} label={f.label} />;
          return (
            <Field key={f.id} label={f.label} optional={!f.required} error={error}>
              {f.type === 'select' ? (
                <Select value={v} onChange={(e) => set(e.target.value)} invalid={!!error}>
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : f.type === 'text' ? (
                <Textarea value={v} onChange={(e) => set(e.target.value)} rows={2} invalid={!!error} />
              ) : (
                <Input
                  type={f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  dir={f.type === 'url' || f.type === 'number' ? 'ltr' : undefined}
                  value={v}
                  onChange={(e) => set(e.target.value)}
                  invalid={!!error}
                />
              )}
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}
