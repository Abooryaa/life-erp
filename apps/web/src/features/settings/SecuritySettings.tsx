import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, Spinner, useToast } from '../../components/ui/feedback';
import { FormError, TextField } from '../../components/ui/form';
import { Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useAuthStatus, useFormState } from '../../lib/hooks';

export function SecuritySettings() {
  return (
    <div className="space-y-5">
      <TwoFactorPanel />
      <PasswordPanel />
      <SessionsPanel />
    </div>
  );
}

function PasswordPanel() {
  const { t } = useI18n();
  const form = useFormState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const save = useAction(() => api.post('/api/auth/password', form.values), {
    success: t('security.passwordChanged'),
    silentFieldErrors: true,
    invalidate: [['sessions']],
    onSuccess: () => form.reset(),
  });
  return (
    <Panel title={t('security.password')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onError: form.fail });
        }}
      >
        <FormError message={form.formError} />
        <TextField label={t('security.currentPassword')} type="password" dir="ltr" autoComplete="current-password" value={form.values.currentPassword} onChange={(e) => form.set('currentPassword', e.target.value)} error={form.errors.currentPassword} />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('security.newPassword')} type="password" dir="ltr" autoComplete="new-password" hint={t('setup.passwordHint')} value={form.values.newPassword} onChange={(e) => form.set('newPassword', e.target.value)} error={form.errors.newPassword} />
          <TextField label={t('security.confirmPassword')} type="password" dir="ltr" autoComplete="new-password" value={form.values.confirmPassword} onChange={(e) => form.set('confirmPassword', e.target.value)} error={form.errors.confirmPassword} />
        </div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Panel>
  );
}

function TwoFactorPanel() {
  const { t, te } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const user = useAuthStatus().data?.user;
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disableForm = useFormState({ password: '', code: '' });

  const begin = async () => {
    try {
      setSetup(await api.post('/api/auth/totp/setup'));
      setCode('');
      setError(null);
    } catch (err) {
      toast.error(te((err as Error).message));
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { code });
      setSetup(null);
      setCodes(r.recoveryCodes);
      await qc.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disable = useAction(() => api.post('/api/auth/totp/disable', disableForm.values), {
    invalidate: [['auth']],
    silentFieldErrors: true,
    onSuccess: () => {
      setDisabling(false);
      disableForm.reset();
    },
  });

  return (
    <Panel title={t('security.twoFactor')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {user?.totpEnabled ? <ShieldCheck className="size-6 shrink-0 text-pos" /> : <ShieldOff className="size-6 shrink-0 text-warn" />}
          <p className="max-w-md text-ink-2">{user?.totpEnabled ? t('security.twoFactorOn') : t('security.twoFactorOff')}</p>
        </div>
        {user?.totpEnabled ? (
          <Button onClick={() => setDisabling(true)}>{t('security.disable2fa')}</Button>
        ) : (
          <Button variant="primary" onClick={begin}>
            {t('security.enable2fa')}
          </Button>
        )}
      </div>

      <Modal
        open={!!setup}
        onOpenChange={(o) => !o && setSetup(null)}
        title={t('security.twoFactor')}
        footer={
          <Button variant="primary" loading={busy} onClick={confirm} disabled={code.trim().length !== 6}>
            {t('auth.verify')}
          </Button>
        }
      >
        {setup && (
          <div className="space-y-4">
            <p className="text-ink-2">{t('security.scanQr')}</p>
            <div className="flex justify-center">
              <img src={setup.qr} alt="QR" className="size-56 rounded-lg bg-white p-2" />
            </div>
            <div>
              <p className="text-[12.5px] text-ink-3">{t('security.manualKey')}</p>
              <code className="mt-1 block rounded-lg bg-surface-2 p-2 text-center text-[13px] break-all" dir="ltr">
                {setup.secret}
              </code>
            </div>
            <FormError message={error} />
            <TextField label={t('auth.code')} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" dir="ltr" />
          </div>
        )}
      </Modal>

      <Modal
        open={!!codes}
        onOpenChange={() => {}}
        title={t('security.recoveryTitle')}
        footer={
          <Button variant="primary" onClick={() => setCodes(null)}>
            {t('security.recoverySaved')}
          </Button>
        }
      >
        <p className="mb-3 text-ink-2">{t('security.recoveryBody')}</p>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-[14px]" dir="ltr">
          {codes?.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button size="sm" className="mt-3" onClick={() => navigator.clipboard?.writeText(codes?.join('\n') ?? '').then(() => toast.success(t('common.copied')))}>
          {t('common.copy')}
        </Button>
      </Modal>

      <Modal
        open={disabling}
        onOpenChange={setDisabling}
        title={t('security.disable2fa')}
        footer={
          <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate(undefined, { onError: disableForm.fail })}>
            {t('security.disable2fa')}
          </Button>
        }
      >
        <div className="space-y-4">
          <FormError message={disableForm.formError} />
          <TextField label={t('auth.password')} type="password" dir="ltr" value={disableForm.values.password} onChange={(e) => disableForm.set('password', e.target.value)} error={disableForm.errors.password} />
          <TextField label={t('auth.code')} dir="ltr" value={disableForm.values.code} onChange={(e) => disableForm.set('code', e.target.value)} error={disableForm.errors.code} />
        </div>
      </Modal>
    </Panel>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
}

function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return [br, os].filter(Boolean).join(' · ');
}

function SessionsPanel() {
  const { t, fmt } = useI18n();
  const { data = [], isLoading } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRow[]>('/api/auth/sessions') });
  const revoke = useAction((id: string) => api.del(`/api/auth/sessions/${id}`), { invalidate: [['sessions']] });
  return (
    <Panel title={t('security.sessions')} padded={false}>
      {isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((s) => {
            const mobile = /Android|iPhone/.test(s.userAgent ?? '');
            const Icon = mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {describeAgent(s.userAgent)}
                    {s.current && <Badge tone="pos">{t('security.thisDevice')}</Badge>}
                  </p>
                  <p className="text-[12.5px] text-ink-3">
                    {t('security.lastSeen', { time: fmt.relative(s.lastSeenAt) })}
                    {s.ip ? <span dir="ltr"> · {s.ip}</span> : null}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" onClick={() => revoke.mutate(s.id)}>
                    {t('security.signOutDevice')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
