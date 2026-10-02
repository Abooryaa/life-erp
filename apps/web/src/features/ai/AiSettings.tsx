import { AI_SCOPES, type Settings } from '@life-erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Cloud, KeyRound, Laptop, PlugZap, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Badge, Spinner } from '../../components/ui/feedback';
import { Field, Input, Select, Switch } from '../../components/ui/form';
import { Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useSettings } from '../../lib/hooks';
import { useSaveSettings } from '../settings/SettingsPage';
import { AI_KEYS, useAiStatus } from './ai-lib';

interface AiCall {
  id: string;
  at: string;
  purpose: string;
  provider: string;
  model: string;
  question: string;
  tools: { name: string; ok: boolean }[];
  dataChars: number;
  durationMs: number;
  status: 'ok' | 'error';
  error: string | null;
}

export function AiSettings() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const settings = useSettings();
  const status = useAiStatus();
  const save = useSaveSettings();
  const [consent, setConsent] = useState(false);
  const [clear, setClear] = useState(false);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const log = useQuery({ queryKey: ['ai', 'log'], queryFn: () => api.get<AiCall[]>('/api/ai/log?limit=50') });
  const ai = settings.data?.ai;
  useEffect(() => {
    if (ai) setUrl(ai.ollamaUrl);
  }, [ai?.ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (patch: Partial<Settings['ai']>) => {
    await save({ ai: { ...ai!, ...patch } });
    await qc.invalidateQueries({ queryKey: ['ai'] });
    setTestResult(null);
  };
  const saveKey = useAction(() => api.put('/api/ai/key', { key }), { invalidate: AI_KEYS, success: t('common.saved'), onSuccess: () => setKey('') });
  const removeKey = useAction(() => api.del('/api/ai/key'), { invalidate: AI_KEYS });
  const test = useAction(() => api.post<{ reply: string; durationMs: number; model: string }>('/api/ai/test'), {
    invalidate: [['ai', 'log']],
    onSuccess: (r) => setTestResult(t('ai.testOk', { model: r.model, s: (r.durationMs / 1000).toFixed(1) })),
  });
  const clearLog = useAction(() => api.del('/api/ai/log'), { invalidate: [['ai', 'log']], onSuccess: () => setClear(false) });

  if (!ai || status.isLoading) return <Spinner />;
  const s = status.data;
  const problemText = s?.problem && s.problem !== 'disabled' ? t(`ai.problem.${s.problem}` as MessageKey) : null;

  return (
    <div className="space-y-5">
      <Panel title={t('ai.title')}>
        <div className="space-y-4">
          <p className="text-[13px] text-ink-3">{t('ai.intro')}</p>
          <Switch checked={ai.enabled} onChange={(v) => update({ enabled: v })} label={t('ai.enable')} description={t('ai.enableHint')} />
          {ai.enabled && (
            <>
              <Field label={t('ai.provider')}>
                <div className="grid gap-2 md:grid-cols-2">
                  {(['ollama', 'anthropic'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={ai.provider === p}
                      onClick={() => (p === 'anthropic' && !ai.cloudConsentAt ? setConsent(true) : update({ provider: p }))}
                      className={clsx('flex items-start gap-3 rounded-lg border p-3 text-start', ai.provider === p ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
                    >
                      {p === 'ollama' ? <Laptop className="mt-0.5 size-5 shrink-0" /> : <Cloud className="mt-0.5 size-5 shrink-0" />}
                      <span>
                        <span className="block font-medium">{t(`ai.p.${p}` as MessageKey)}</span>
                        <span className="block text-[12.5px] text-ink-3">{t(`ai.p.${p}.hint` as MessageKey)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Field>

              {ai.provider === 'ollama' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t('ai.ollamaUrl')} hint={s?.leavesDevice ? t('ai.remoteOllama') : t('ai.localOllama')}>
                    <div className="flex gap-2">
                      <Input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" />
                      <Button disabled={url === ai.ollamaUrl} onClick={() => update({ ollamaUrl: url.trim() })}>
                        {t('common.save')}
                      </Button>
                    </div>
                  </Field>
                  <Field label={t('ai.model')} hint={s?.ollama?.error ?? t('ai.modelHint')}>
                    <Select value={ai.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })} disabled={!s?.ollama?.models.length}>
                      <option value="">{t('ai.chooseModel')}</option>
                      {s?.ollama?.models.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} · {fmt.bytes(m.size)}
                          {m.tools ? '' : ` (${t('ai.noTools')})`}
                        </option>
                      ))}
                      {ai.ollamaModel && !s?.ollama?.models.some((m) => m.name === ai.ollamaModel) && <option value={ai.ollamaModel}>{ai.ollamaModel}</option>}
                    </Select>
                  </Field>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {t('ai.cloudWarning')}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={t('ai.apiKey')} hint={s?.key.set ? t('ai.keyStored', { hint: s.key.hint ?? '' }) : s?.key.fromEnvironment ? t('ai.keyEnv') : t('ai.keyHint')}>
                      <div className="flex gap-2">
                        <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s?.key.set ? `••••${s.key.hint}` : 'sk-ant-…'} dir="ltr" />
                        <Button icon={<KeyRound className="size-4" />} disabled={!key.trim()} loading={saveKey.isPending} onClick={() => saveKey.mutate(undefined)}>
                          {t('common.save')}
                        </Button>
                        {s?.key.set && (
                          <Button variant="ghost" size="icon" onClick={() => removeKey.mutate(undefined)} aria-label={t('ai.removeKey')}>
                            <Trash2 className="size-4 text-neg" />
                          </Button>
                        )}
                      </div>
                    </Field>
                    <Field label={t('ai.model')}>
                      <Select value={ai.anthropicModel} onChange={(e) => update({ anthropicModel: e.target.value })}>
                        {['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  {ai.cloudConsentAt && (
                    <p className="text-[12.5px] text-ink-3">
                      {t('ai.consentGiven', { date: fmt.date(ai.cloudConsentAt) })}{' '}
                      <button type="button" className="text-accent hover:underline" onClick={() => update({ cloudConsentAt: null, provider: 'ollama' })}>
                        {t('ai.withdraw')}
                      </button>
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {s?.ready ? (
                  <Badge tone="pos">
                    <CheckCircle2 className="size-3.5" />
                    {t('ai.ready')}
                  </Badge>
                ) : (
                  problemText && <Badge tone="warn">{problemText}</Badge>
                )}
                <Button icon={<PlugZap className="size-4" />} disabled={!s?.ready} loading={test.isPending} onClick={() => test.mutate(undefined)}>
                  {t('ai.test')}
                </Button>
                {testResult && <span className="text-[13px] text-pos">{testResult}</span>}
              </div>
            </>
          )}
        </div>
      </Panel>

      {ai.enabled && (
        <Panel title={t('ai.access')}>
          <p className="mb-3 text-[13px] text-ink-3">{t('ai.accessIntro')}</p>
          <div className="space-y-3">
            {AI_SCOPES.map((sc) => (
              <Switch key={sc} checked={ai.allow[sc]} onChange={(v) => update({ allow: { ...ai.allow, [sc]: v } })} label={t(`ai.scope.${sc}` as MessageKey)} description={t(`ai.scope.${sc}.hint` as MessageKey)} />
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title={t('ai.log')}
        padded={false}
        actions={
          log.data?.length ? (
            <Button size="sm" variant="ghost" onClick={() => setClear(true)}>
              {t('ai.clearLog')}
            </Button>
          ) : null
        }
      >
        {!log.data?.length ? (
          <p className="p-4 text-[13px] text-ink-3">{t('ai.logEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {log.data.map((c) => (
              <li key={c.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate font-medium" dir="auto">
                    {c.question}
                  </p>
                  <Badge tone={c.status === 'ok' ? 'neutral' : 'neg'}>{c.status === 'ok' ? `${(c.durationMs / 1000).toFixed(1)} s` : t('auto.failed')}</Badge>
                </div>
                <p className="text-[12px] text-ink-3">
                  {fmt.dateTime(c.at)} · {c.provider} {c.model}
                  {c.tools.length > 0 && ` · ${t('ai.read')}: ${c.tools.map((x) => x.name).join(', ')}`}
                  {c.dataChars > 0 && ` · ${t('ai.chars', { n: c.dataChars })}`}
                </p>
                {c.error && <p className="text-[12px] text-neg">{c.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog
        open={consent}
        onOpenChange={setConsent}
        title={t('ai.consentTitle')}
        body={<p className="text-[13.5px]">{t('ai.consentBody')}</p>}
        danger={false}
        confirmLabel={t('ai.consentConfirm')}
        onConfirm={() => {
          setConsent(false);
          void update({ provider: 'anthropic', cloudConsentAt: new Date().toISOString() });
        }}
      />
      <ConfirmDialog open={clear} onOpenChange={setClear} title={t('ai.clearLog')} body={t('ai.clearLogBody')} confirmLabel={t('ai.clearLog')} loading={clearLog.isPending} onConfirm={() => clearLog.mutate(undefined)} />
    </div>
  );
}
