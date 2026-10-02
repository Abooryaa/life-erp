import { EVENT_KINDS, FREQUENCIES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Spinner } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { LinksPanel } from '../shared/LinksPanel';
import { LIFE_KEYS, usePeople } from './life-lib';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  kind: string;
  date: string;
  endDate: string | null;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  workspaceId: string | null;
  personId: string | null;
  recurrence: string | null;
  recurrenceInterval: number;
  recurrenceUntil: string | null;
  reminderMinutes: number | null;
}

const REMINDERS = [null, 0, 10, 30, 60, 120, 1440];

export function EventFormModal({ open, onOpenChange, eventId, defaultDate }: { open: boolean; onOpenChange: (o: boolean) => void; eventId?: string | null; defaultDate?: string }) {
  const { t } = useI18n();
  const { workspaces, currentId } = useWorkspace();
  const { data: people = [] } = usePeople();
  const [del, setDel] = useState(false);
  const existing = useQuery({ queryKey: ['calendar', 'event', eventId], queryFn: () => api.get<EventRow>(`/api/events/${eventId}`), enabled: open && !!eventId });
  const blank = () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const nextHour = `${String(Math.min(23, d.getHours() + 1)).padStart(2, '0')}:00`;
    return {
      title: '',
      description: '',
      location: '',
      kind: 'meeting',
      date: defaultDate ?? today,
      endDate: '',
      allDay: false,
      startTime: nextHour,
      endTime: '',
      workspaceId: currentId ?? '',
      personId: '',
      recurrence: '',
      recurrenceInterval: '1',
      recurrenceUntil: '',
      reminderMinutes: '30',
    };
  };
  const form = useFormState(blank());
  useEffect(() => {
    if (!open) return;
    form.setErrors({});
    form.setFormError(null);
    const e = existing.data;
    if (eventId && e) {
      form.setValues({
        title: e.title,
        description: e.description ?? '',
        location: e.location ?? '',
        kind: e.kind,
        date: e.date,
        endDate: e.endDate ?? '',
        allDay: e.allDay,
        startTime: e.startTime ?? '',
        endTime: e.endTime ?? '',
        workspaceId: e.workspaceId ?? '',
        personId: e.personId ?? '',
        recurrence: e.recurrence ?? '',
        recurrenceInterval: String(e.recurrenceInterval),
        recurrenceUntil: e.recurrenceUntil ?? '',
        reminderMinutes: e.reminderMinutes == null ? '' : String(e.reminderMinutes),
      });
    } else if (!eventId) form.setValues(blank());
  }, [open, eventId, existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const body = () => ({
    ...v,
    endDate: v.endDate || null,
    startTime: v.allDay ? null : v.startTime || null,
    endTime: v.allDay ? null : v.endTime || null,
    workspaceId: v.workspaceId || null,
    personId: v.personId || null,
    recurrence: v.recurrence || null,
    recurrenceInterval: Number(v.recurrenceInterval),
    recurrenceUntil: v.recurrenceUntil || null,
    reminderMinutes: v.reminderMinutes === '' ? null : Number(v.reminderMinutes),
    description: v.description || null,
    location: v.location || null,
  });
  const save = useAction(() => (eventId ? api.put(`/api/events/${eventId}`, body()) : api.post('/api/events', body())), {
    invalidate: LIFE_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: () => onOpenChange(false),
  });
  const remove = useAction(() => api.del(`/api/events/${eventId}`), {
    invalidate: LIFE_KEYS,
    onSuccess: () => {
      setDel(false);
      onOpenChange(false);
    },
  });
  const reminderLabel = (m: number | null) => (m == null ? t('cal.noReminder') : m === 1440 ? t('cal.dayBefore') : m >= 60 ? t('cal.hoursBefore', { n: m / 60 }) : t('cal.minBefore', { n: m }));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={eventId ? t('cal.editEvent') : t('cal.newEvent')}
      size="lg"
      footer={
        <>
          {eventId && (
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
      {eventId && existing.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus={!eventId} />
          <Switch checked={v.allDay} onChange={(x) => form.set('allDay', x)} label={t('cal.allDay')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('common.date')} error={form.errors.date}>
              <Input type="date" value={v.date} onChange={(e) => form.set('date', e.target.value)} />
            </Field>
            {!v.allDay && (
              <>
                <Field label={t('cal.start')} error={form.errors.startTime}>
                  <Input type="time" value={v.startTime} onChange={(e) => form.set('startTime', e.target.value)} />
                </Field>
                <Field label={t('cal.end')} optional error={form.errors.endTime}>
                  <Input type="time" value={v.endTime} onChange={(e) => form.set('endTime', e.target.value)} />
                </Field>
              </>
            )}
            <Field label={t('cal.endDate')} optional error={form.errors.endDate}>
              <Input type="date" value={v.endDate} onChange={(e) => form.set('endDate', e.target.value)} />
            </Field>
            <Field label={t('cal.kind')}>
              <Select value={v.kind} onChange={(e) => form.set('kind', e.target.value)}>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`cal.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('cal.reminder')}>
              <Select value={v.reminderMinutes} onChange={(e) => form.set('reminderMinutes', e.target.value)}>
                {REMINDERS.map((m) => (
                  <option key={String(m)} value={m == null ? '' : m}>
                    {reminderLabel(m)}
                  </option>
                ))}
              </Select>
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
            {v.recurrence && (
              <Field label={t('cal.repeatUntil')} optional error={form.errors.recurrenceUntil}>
                <Input type="date" value={v.recurrenceUntil} onChange={(e) => form.set('recurrenceUntil', e.target.value)} />
              </Field>
            )}
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
            <Field label={t('task.person')} optional>
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
          {eventId && existing.data?.recurrence && <p className="text-[12.5px] text-ink-3">{t('cal.recurringNote')}</p>}
          <TextField label={t('cal.location')} optional value={v.location} onChange={(e) => form.set('location', e.target.value)} />
          <Field label={t('common.description')} optional>
            <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={3} />
          </Field>
          {eventId && <LinksPanel type="event" id={eventId} />}
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
