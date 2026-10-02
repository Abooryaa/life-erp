import { FREQUENCIES, LIFE_AREAS, parseQuickTask, TASK_STATUSES } from '@life-erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Spinner, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { postOrQueue } from '../../lib/outbox';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { TagInput } from '../shared/TagEditor';
import { LIFE_KEYS, useGoals, usePeople, type Task } from './life-lib';

export interface TaskDefaults {
  dueDate?: string;
  goalId?: string;
  personId?: string;
  workspaceId?: string;
  status?: Task['status'];
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Full task editor (create or edit). */
export function TaskFormModal({ open, onOpenChange, taskId, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; taskId?: string | null; defaults?: TaskDefaults }) {
  const { t } = useI18n();
  const { workspaces, currentId } = useWorkspace();
  const { data: people = [] } = usePeople();
  const { data: goals = [] } = useGoals();
  const [del, setDel] = useState(false);
  const existing = useQuery({ queryKey: ['tasks', 'one', taskId], queryFn: () => api.get<Task>(`/api/tasks/${taskId}`), enabled: open && !!taskId });
  const blank = () => ({
    title: '',
    description: '',
    status: (defaults?.status ?? 'inbox') as Task['status'],
    priority: '3',
    area: '',
    dueDate: defaults?.dueDate ?? '',
    dueTime: '',
    workspaceId: defaults?.workspaceId ?? currentId ?? '',
    goalId: defaults?.goalId ?? '',
    personId: defaults?.personId ?? '',
    assignee: '',
    recurrence: '',
    recurrenceInterval: '1',
    tags: [] as string[],
  });
  const form = useFormState(blank());
  useEffect(() => {
    if (!open) return;
    form.setErrors({});
    form.setFormError(null);
    const x = existing.data;
    if (taskId && x) {
      form.setValues({
        title: x.title,
        description: x.description ?? '',
        status: x.status,
        priority: String(x.priority),
        area: x.area ?? '',
        dueDate: x.dueDate ?? '',
        dueTime: x.dueTime ?? '',
        workspaceId: x.workspaceId ?? '',
        goalId: x.goalId ?? '',
        personId: x.personId ?? '',
        assignee: x.assignee ?? '',
        recurrence: x.recurrence ?? '',
        recurrenceInterval: String(x.recurrenceInterval),
        tags: x.tags,
      });
    } else if (!taskId) form.setValues(blank());
  }, [open, taskId, existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const body = () => ({
    ...v,
    priority: Number(v.priority),
    recurrenceInterval: Number(v.recurrenceInterval),
    area: v.area || null,
    dueDate: v.dueDate || null,
    dueTime: v.dueTime || null,
    workspaceId: v.workspaceId || null,
    goalId: v.goalId || null,
    personId: v.personId || null,
    recurrence: v.recurrence || null,
    description: v.description || null,
    assignee: v.assignee || null,
    // A new task given a due date is planned automatically unless a status was chosen.
    status: !taskId && v.status === 'inbox' && v.dueDate ? 'planned' : v.status,
  });
  const save = useAction(() => (taskId ? api.put(`/api/tasks/${taskId}`, body()) : api.post('/api/tasks', body())), {
    invalidate: LIFE_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: () => onOpenChange(false),
  });
  const remove = useAction(() => api.del(`/api/tasks/${taskId}`), {
    invalidate: LIFE_KEYS,
    onSuccess: () => {
      setDel(false);
      onOpenChange(false);
    },
  });
  const loading = !!taskId && existing.isLoading;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={taskId ? t('task.edit') : t('task.new')}
      size="lg"
      footer={
        <>
          {taskId && (
            <Button variant="ghost" icon={<Trash2 className="size-4 text-neg" />} onClick={() => setDel(true)} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus={!taskId} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('task.status')}>
              <Select value={v.status} onChange={(e) => form.set('status', e.target.value as Task['status'])}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`task.status.${s}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('task.priority')}>
              <Select value={v.priority} onChange={(e) => form.set('priority', e.target.value)}>
                {[1, 2, 3, 4].map((p) => (
                  <option key={p} value={p}>
                    {t(`task.priority.${p}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('task.area')} optional>
              <Select value={v.area} onChange={(e) => form.set('area', e.target.value)}>
                <option value="">—</option>
                {LIFE_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {t(`area.${a}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('task.dueDate')} optional error={form.errors.dueDate}>
              <Input type="date" value={v.dueDate} onChange={(e) => form.set('dueDate', e.target.value)} />
            </Field>
            <Field label={t('task.dueTime')} optional error={form.errors.dueTime}>
              <Input type="time" value={v.dueTime} onChange={(e) => form.set('dueTime', e.target.value)} disabled={!v.dueDate} />
            </Field>
            <Field label={t('task.repeat')}>
              <Select value={v.recurrence} onChange={(e) => form.set('recurrence', e.target.value)}>
                <option value="">{t('task.noRepeat')}</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`rec.freq.${f}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.workspace')} optional>
              <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
                <option value="">{t('common.noWorkspace')}</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('task.goal')} optional error={form.errors.goalId}>
              <Select value={v.goalId} onChange={(e) => form.set('goalId', e.target.value)}>
                <option value="">—</option>
                {goals
                  .filter((g) => g.status === 'active' || g.id === v.goalId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('task.person')} optional error={form.errors.personId}>
              <Select value={v.personId} onChange={(e) => form.set('personId', e.target.value)}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('common.tags')} optional>
            <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
          </Field>
          <Field label={t('task.description')} optional>
            <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={4} />
          </Field>
          {taskId && (
            <>
              <AttachmentsPanel type="task" id={taskId} workspaceId={v.workspaceId || null} />
              <LinksPanel type="task" id={taskId} />
            </>
          )}
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

/**
 * One-line capture: type naturally ("Call Ahmed tomorrow 3pm !high #mma") and press Enter.
 * Works offline on the phone via the outbox.
 */
export function QuickCaptureModal({ open, onOpenChange, onMore }: { open: boolean; onOpenChange: (o: boolean) => void; onMore: () => void }) {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { currentId } = useWorkspace();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const preview = useMemo(() => (text.trim() ? parseQuickTask(text, todayIso()) : null), [text]);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await postOrQueue('/api/tasks/quick', { text, workspaceId: currentId }, text);
      if (r.queued) toast.info(t('outbox.queued'));
      else {
        await Promise.all(LIFE_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
        toast.success(t('common.saved'));
      }
      setText('');
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('task.new')} size="md">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('task.quickAdd')} autoFocus className="h-12 text-[16px]" />
        <p className="text-[12.5px] text-ink-3">{t('quick.captureHint')}</p>
        {preview && (preview.dueDate || preview.priority || preview.tags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {preview.dueDate && <Badge tone="accent">{fmt.date(preview.dueDate)}{preview.dueTime ? ` ${preview.dueTime}` : ''}</Badge>}
            {preview.priority && <Badge tone={preview.priority <= 2 ? 'warn' : 'neutral'}>{t(`task.priority.${preview.priority}` as MessageKey)}</Badge>}
            {preview.tags.map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>
        )}
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onMore();
            }}
          >
            {t('tx.more')}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
            {t('common.add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
