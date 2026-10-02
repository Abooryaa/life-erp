import { CURRENCIES } from '@life-erp/shared';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Field, FormError, Select, Textarea, TextField } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import type { Workspace } from '../../lib/types';

export const WORKSPACE_COLORS = ['#4f46e5', '#0f766e', '#b45309', '#be185d', '#0369a1', '#15803d', '#7c3aed', '#c2410c', '#475569'];

export function WorkspaceFormModal({ open, onOpenChange, workspace }: { open: boolean; onOpenChange: (o: boolean) => void; workspace?: Workspace }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const init = () => ({
    name: workspace?.name ?? '',
    industry: workspace?.industry ?? '',
    description: workspace?.description ?? '',
    website: workspace?.website ?? '',
    color: workspace?.color ?? WORKSPACE_COLORS[0],
    currency: workspace?.currency ?? 'EGP',
    notes: workspace?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [open, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(
    () =>
      workspace
        ? api.put<Workspace>(`/api/workspaces/${workspace.id}`, form.values)
        : api.post<Workspace>('/api/workspaces', { ...form.values, kind: 'business' }),
    {
      invalidate: [['workspaces']],
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (ws) => {
        onOpenChange(false);
        if (!workspace) navigate(`/workspaces/${ws.id}`);
      },
    },
  );
  const v = form.values;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={workspace ? t('ws.edit') : t('ws.newBusiness')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {workspace ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onError: form.fail });
        }}
      >
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('ws.industry')} optional value={v.industry} onChange={(e) => form.set('industry', e.target.value)} />
          <Field label={t('common.currency')}>
            <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name[locale]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('common.color')}>
          <div className="flex flex-wrap gap-2">
            {WORKSPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => form.set('color', c)}
                className={`size-8 rounded-full ring-offset-2 ring-offset-surface ${v.color === c ? 'ring-2 ring-ink' : ''}`}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={v.color === c}
              />
            ))}
          </div>
        </Field>
        <TextField label={t('ws.website')} optional value={v.website} onChange={(e) => form.set('website', e.target.value)} dir="ltr" />
        <Field label={t('common.description')} optional>
          <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={2} />
        </Field>
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
        </Field>
      </form>
    </Modal>
  );
}
