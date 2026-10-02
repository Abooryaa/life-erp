import { CURRENCIES, type Settings, type SettingsPatch } from '@life-erp/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, Database, HardDriveDownload, Info, ListPlus, Settings2, Shield, Smartphone, Tag, User } from 'lucide-react';
import { CustomFieldSettings } from '../tools/CustomFields';
import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Button } from '../../components/ui/button';
import { useToast, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Select, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useAuthStatus, useFormState, useSettings } from '../../lib/hooks';
import { BackupSettings } from './BackupSettings';
import { AboutSettings, DataSettings, RemoteSettings, TagSettings, WorkspaceSettings } from './OtherSettings';
import { SecuritySettings } from './SecuritySettings';

const SECTIONS: { to: string; label: MessageKey; icon: typeof User; element: React.ReactNode }[] = [
  { to: '', label: 'settings.general', icon: Settings2, element: <GeneralSettings /> },
  { to: 'profile', label: 'settings.profile', icon: User, element: <ProfileSettings /> },
  { to: 'security', label: 'settings.security', icon: Shield, element: <SecuritySettings /> },
  { to: 'workspaces', label: 'settings.workspaces', icon: Building2, element: <WorkspaceSettings /> },
  { to: 'tags', label: 'settings.tags', icon: Tag, element: <TagSettings /> },
  { to: 'fields', label: 'settings.customFields', icon: ListPlus, element: <CustomFieldSettings /> },
  { to: 'backups', label: 'settings.backups', icon: HardDriveDownload, element: <BackupSettings /> },
  { to: 'data', label: 'settings.data', icon: Database, element: <DataSettings /> },
  { to: 'remote', label: 'settings.remote', icon: Smartphone, element: <RemoteSettings /> },
  { to: 'about', label: 'settings.about', icon: Info, element: <AboutSettings /> },
];

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 scrollbar-thin md:mx-0 md:w-52 md:shrink-0 md:flex-col md:px-0">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <NavLink
                key={s.to}
                to={s.to ? `/settings/${s.to}` : '/settings'}
                end
                className={({ isActive }) =>
                  clsx(
                    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] whitespace-nowrap',
                    isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2',
                  )
                }
              >
                <Icon className="size-4" />
                {t(s.label)}
              </NavLink>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 md:max-w-3xl">
          <Routes>
            {SECTIONS.map((s) => (
              <Route key={s.to} index={!s.to} path={s.to || undefined} element={s.element} />
            ))}
          </Routes>
        </div>
      </div>
    </div>
  );
}

/** Save a settings patch and refresh everything that depends on settings (language, formats…). */
export function useSaveSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, te } = useI18n();
  return async (patch: SettingsPatch) => {
    try {
      const s = await api.patch<Settings>('/api/settings', patch);
      qc.setQueryData(['settings'], s);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(te((err as Error).message));
    }
  };
}

const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'Europe/Istanbul', 'America/New_York', 'UTC'];

function GeneralSettings() {
  const { t, locale, fmt } = useI18n();
  const { data: s } = useSettings();
  const save = useSaveSettings();
  if (!s) return <LoadingBlock />;
  const days = Array.from({ length: 7 }, (_, i) => {
    // 2026-10-04 is a Sunday.
    const iso = `2026-10-${String(4 + i).padStart(2, '0')}`;
    return { value: i, label: fmt.weekday(iso) };
  });
  return (
    <Panel title={t('settings.general')}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('settings.language')}>
          <Select value={s.locale} onChange={(e) => save({ locale: e.target.value as Settings['locale'] })}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </Select>
        </Field>
        <Field label={t('settings.digits')}>
          <Select value={s.digits} onChange={(e) => save({ digits: e.target.value as Settings['digits'] })}>
            <option value="latn">{t('settings.digitsLatn')}</option>
            <option value="arab">{t('settings.digitsArab')}</option>
          </Select>
        </Field>
        <Field label={t('settings.theme')}>
          <Select value={s.theme} onChange={(e) => save({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </Select>
        </Field>
        <Field label={t('settings.baseCurrency')} hint={t('settings.baseCurrencyHint')}>
          <Select value={s.baseCurrency} onChange={(e) => save({ baseCurrency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name[locale]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.timezone')}>
          <Select value={s.timezone} onChange={(e) => save({ timezone: e.target.value })} dir="ltr">
            {[...new Set([s.timezone, ...TIMEZONES])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.dateFormat')}>
          <Select value={s.dateFormat} onChange={(e) => save({ dateFormat: e.target.value as Settings['dateFormat'] })} dir="ltr">
            <option value="dd/MM/yyyy">31/12/2026</option>
            <option value="yyyy-MM-dd">2026-12-31</option>
            <option value="MM/dd/yyyy">12/31/2026</option>
          </Select>
        </Field>
        <Field label={t('settings.weekStart')}>
          <Select value={s.weekStart} onChange={(e) => save({ weekStart: Number(e.target.value) })}>
            {days.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.reviewDay')}>
          <Select value={s.weeklyReviewDay} onChange={(e) => save({ weeklyReviewDay: Number(e.target.value) })}>
            {days.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Panel>
  );
}

function ProfileSettings() {
  const { t } = useI18n();
  const user = useAuthStatus().data?.user;
  const form = useFormState({ fullName: user?.fullName ?? '', email: user?.email ?? '' });
  useEffect(() => {
    if (user) form.setValues({ fullName: user.fullName, email: user.email });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => api.put('/api/auth/profile', form.values), { invalidate: [['auth']], success: t('common.saved'), silentFieldErrors: true });
  return (
    <Panel title={t('settings.profile')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onError: form.fail });
        }}
      >
        <FormError message={form.formError} />
        <TextField label={t('setup.fullName')} value={form.values.fullName} onChange={(e) => form.set('fullName', e.target.value)} error={form.errors.fullName} />
        <TextField label={t('setup.email')} type="email" dir="ltr" value={form.values.email} onChange={(e) => form.set('email', e.target.value)} error={form.errors.email} />
        <TextField label={t('setup.username')} value={user?.username ?? ''} disabled dir="ltr" />
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Panel>
  );
}
