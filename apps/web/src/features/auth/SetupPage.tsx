import { CURRENCIES, setupSchema } from '@life-erp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldAlert, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Field, FormError, Input, NoFieldId, Select, TextField } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useFormState } from '../../lib/hooks';
import { AuthLayout } from './AuthLayout';

export function SetupPage({ allowed }: { allowed: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useFormState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    locale: locale as 'en' | 'ar',
    baseCurrency: 'EGP',
    businesses: ['MMA Spaces', 'Basira'] as string[],
  });
  const v = form.values;

  if (!allowed) {
    return (
      <AuthLayout title={t('setup.title')}>
        <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft p-4 text-warn">
          <ShieldAlert className="size-5 shrink-0" />
          <p className="text-[13.5px]">{t('setup.onlyLocal')}</p>
        </div>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...v, businesses: v.businesses.map((b) => b.trim()).filter(Boolean) };
    const check = setupSchema.safeParse(payload);
    if (!check.success) {
      const errs: Record<string, string> = {};
      for (const i of check.error.issues) errs[i.path.join('.')] ??= i.message;
      form.setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/setup', payload);
      await qc.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <TextField label={t('setup.fullName')} value={v.fullName} onChange={(e) => form.set('fullName', e.target.value)} error={form.errors.fullName} autoComplete="name" autoFocus />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('setup.username')} value={v.username} onChange={(e) => form.set('username', e.target.value)} error={form.errors.username} autoComplete="username" autoCapitalize="none" dir="ltr" />
          <TextField label={t('setup.email')} type="email" value={v.email} onChange={(e) => form.set('email', e.target.value)} error={form.errors.email} autoComplete="email" dir="ltr" />
          <TextField label={t('setup.password')} type="password" value={v.password} onChange={(e) => form.set('password', e.target.value)} error={form.errors.password} hint={t('setup.passwordHint')} autoComplete="new-password" dir="ltr" />
          <TextField label={t('setup.confirmPassword')} type="password" value={v.confirmPassword} onChange={(e) => form.set('confirmPassword', e.target.value)} error={form.errors.confirmPassword} autoComplete="new-password" dir="ltr" />
          <Field label={t('setup.language')}>
            <Select value={v.locale} onChange={(e) => form.set('locale', e.target.value as 'en' | 'ar')}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>
          <Field label={t('setup.currency')}>
            <Select value={v.baseCurrency} onChange={(e) => form.set('baseCurrency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name[locale]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('setup.businesses')} hint={t('setup.businessesHint')}>
          <NoFieldId>
          <div className="space-y-2">
            {v.businesses.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={b}
                  onChange={(e) => form.set('businesses', v.businesses.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={`${t('setup.businesses')} ${i + 1}`}
                />
                <Button variant="ghost" size="icon" aria-label={t('common.remove')} onClick={() => form.set('businesses', v.businesses.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => form.set('businesses', [...v.businesses, ''])}>
              {t('setup.addBusiness')}
            </Button>
          </div>
          </NoFieldId>
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
          {t('setup.create')}
        </Button>
      </form>
    </AuthLayout>
  );
}
