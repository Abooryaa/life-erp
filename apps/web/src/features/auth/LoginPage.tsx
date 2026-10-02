import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FormError, TextField } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useFormState } from '../../lib/hooks';
import { AuthLayout } from './AuthLayout';

export function LoginPage({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const form = useFormState({ identifier: '', password: '' });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const done = () => qc.invalidateQueries({ queryKey: ['auth'] });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    form.setFormError(null);
    try {
      const r = await api.post<{ mfaRequired?: boolean; challenge?: string }>('/api/auth/login', form.values);
      if (r.mfaRequired && r.challenge) setChallenge(r.challenge);
      else await done();
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    form.setFormError(null);
    try {
      await api.post('/api/auth/login/totp', { challenge, code });
      await done();
    } catch (err) {
      form.fail(err);
      if ((err as { code?: string }).code === 'unauthorized') setChallenge(null);
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <AuthLayout title={t('auth.totpTitle')} subtitle={t('auth.totpHint')}>
        <form onSubmit={submitCode} className="space-y-4">
          <FormError message={form.formError} />
          <TextField
            label={t('auth.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            className="[&_input]:text-center [&_input]:tracking-[0.3em]"
          />
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
            {t('auth.verify')}
          </Button>
          <Button variant="ghost" className="w-full justify-center" onClick={() => setChallenge(null)}>
            {t('common.back')}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.welcomeBack')} subtitle={t('auth.signInHint')}>
      <form onSubmit={submit} className="space-y-4">
        {demo && <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">{t('auth.demoCreds')}</div>}
        <FormError message={form.formError} />
        <TextField
          label={t('auth.identifier')}
          value={form.values.identifier}
          onChange={(e) => form.set('identifier', e.target.value)}
          error={form.errors.identifier}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          dir="ltr"
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={form.values.password}
          onChange={(e) => form.set('password', e.target.value)}
          error={form.errors.password}
          autoComplete="current-password"
          dir="ltr"
        />
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
        <p className="text-[12.5px] leading-relaxed text-ink-3">{t('auth.forgot')}</p>
      </form>
    </AuthLayout>
  );
}
