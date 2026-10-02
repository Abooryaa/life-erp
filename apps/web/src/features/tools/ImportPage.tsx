import { DATE_FORMATS, IMPORT_TARGETS, type ImportOptions, type ImportTarget } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, FileUp, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Badge, Spinner } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Switch } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useAccounts, useCategories } from '../finance/fin-lib';

interface Analysis {
  headers: string[];
  rowCount: number;
  sample: string[][];
  delimiter: string | null;
  fields: { key: string; kind: string; required: boolean }[];
  suggested: { mapping: Record<string, string>; dateFormat: (typeof DATE_FORMATS)[number] | null; decimal: '.' | ','; amountMode: 'signed' | 'split' };
}

interface RunResult {
  importId: string | null;
  committed: boolean;
  total: number;
  ok: number;
  duplicates: number;
  errors: number;
  warnings: number;
  results: { row: number; status: 'ok' | 'duplicate' | 'error'; summary?: string; message?: string; field?: string; warnings?: string[] }[];
}

interface Preset {
  id: string;
  name: string;
  target: string;
  mapping: Record<string, string>;
  options: Partial<ImportOptions>;
}

interface ImportRecord {
  id: string;
  target: ImportTarget;
  fileName: string | null;
  rowCount: number;
  createdCount: number;
  skippedCount: number;
  undoneAt: string | null;
  createdAt: string;
}

const KEYS = [['imports'], ['finance'], ['people'], ['organizations'], ['tasks'], ['insights'], ['career'], ['notifications'], ['audit']];

const DEFAULT_OPTIONS: ImportOptions = {
  dateFormat: 'yyyy-MM-dd',
  decimal: '.',
  accountId: null,
  amountMode: 'signed',
  defaultExpenseCategoryId: null,
  defaultIncomeCategoryId: null,
  workspaceId: null,
  includeDuplicates: false,
  runAutomations: false,
};

export function ImportPage() {
  const { t, fmt, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const { workspaces } = useWorkspace();
  const { data: accounts = [] } = useAccounts();
  const { data: cats = [] } = useCategories();
  const [target, setTarget] = useState<ImportTarget>('transactions');
  const [file, setFile] = useState<{ name: string; content: string; format: 'csv' | 'json' } | null>(null);
  const [encoding, setEncoding] = useState<'utf-8' | 'windows-1256'>('utf-8');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [presetName, setPresetName] = useState('');
  const [undo, setUndo] = useState<ImportRecord | null>(null);
  const presets = useQuery({ queryKey: ['imports', 'presets', target], queryFn: () => api.get<Preset[]>(`/api/import/presets?target=${target}`) });
  const history = useQuery({ queryKey: ['imports', 'history'], queryFn: () => api.get<ImportRecord[]>('/api/imports') });

  const reset = () => {
    setAnalysis(null);
    setResult(null);
    setError(null);
    setFieldErrors({});
  };
  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.fields.length) {
      setFieldErrors(err.fieldMap());
      setError(err.message);
    } else setError(err instanceof Error ? err.message : String(err));
  };
  const request = () => ({ target, fileName: file?.name ?? null, content: file?.content ?? '', format: file?.format ?? 'csv', mapping, options });

  const analyze = useAction(
    (f: { name: string; content: string; format: 'csv' | 'json' }) => api.post<Analysis>('/api/import/analyze', { target, fileName: f.name, content: f.content, format: f.format }),
    {
      onSuccess: (a) => {
        setAnalysis(a);
        setMapping(a.suggested.mapping);
        setOptions((o) => ({ ...o, decimal: a.suggested.decimal, amountMode: a.suggested.amountMode, dateFormat: a.suggested.dateFormat ?? o.dateFormat }));
      },
    },
  );
  const preview = useAction(() => api.post<RunResult>('/api/import/preview', request()), { onSuccess: setResult });
  const commit = useAction(() => api.post<RunResult>('/api/import/commit', request()), {
    invalidate: KEYS,
    success: (r) => t('imp.done', { n: r.ok }),
    onSuccess: (r) => {
      setResult(r);
    },
  });
  const savePreset = useAction(() => api.post('/api/import/presets', { name: presetName, target, mapping, options }), { invalidate: [['imports']], success: t('common.saved') });
  const deletePreset = useAction((id: string) => api.del(`/api/import/presets/${id}`), { invalidate: [['imports']] });
  const undoImport = useAction((id: string) => api.post<{ removed: number; skipped: number }>(`/api/imports/${id}/undo`), {
    invalidate: KEYS,
    success: (r) => t('imp.undone', { n: r.removed }),
    onSuccess: () => setUndo(null),
  });

  const readFile = (f: File, enc = encoding) => {
    reset();
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      // Excel in Arabic Windows often saves CSV as Windows-1256; let the user choose if letters look wrong.
      const content = new TextDecoder(enc).decode(buf);
      const format = /\.json$/i.test(f.name) || content.trim().startsWith('[') ? 'json' : 'csv';
      const nf = { name: f.name, content, format } as const;
      setFile(nf);
      analyze.mutate(nf, { onError: fail });
    };
    reader.readAsArrayBuffer(f);
  };
  const applyPreset = (p: Preset) => {
    setMapping(p.mapping);
    setOptions((o) => ({ ...o, ...p.options }));
    setPresetName(p.name);
    setResult(null);
  };
  const setOpt = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) => {
    setOptions((o) => ({ ...o, [k]: v }));
    setResult(null);
  };
  const catName = (c: { name: string; nameAr: string | null }) => (locale === 'ar' && c.nameAr ? c.nameAr : c.name);
  const colSample = (h: string) => {
    const i = analysis?.headers.indexOf(h) ?? -1;
    return i >= 0 ? analysis!.sample.map((r) => r[i]).filter(Boolean)[0] : undefined;
  };
  const isTx = target === 'transactions';
  const visibleFields = (analysis?.fields ?? []).filter((f) => !isTx || (options.amountMode === 'split' ? f.key !== 'amount' : f.key !== 'moneyIn' && f.key !== 'moneyOut'));

  return (
    <div className="space-y-5">
      <PageHeader title={t('imp.title')} subtitle={t('imp.subtitle')} />

      <Panel title={t('imp.step1')}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('imp.target')}>
            <Select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as ImportTarget);
                setFile(null);
                reset();
              }}
            >
              {IMPORT_TARGETS.map((x) => (
                <option key={x} value={x}>
                  {t(`imp.t.${x}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('imp.encoding')} hint={t('imp.encodingHint')}>
            <Select
              value={encoding}
              onChange={(e) => {
                const enc = e.target.value as typeof encoding;
                setEncoding(enc);
                const f = fileRef.current?.files?.[0];
                if (f) readFile(f, enc);
              }}
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1256">Windows-1256 (Arabic Excel)</option>
            </Select>
          </Field>
          <Field label={t('imp.file')}>
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt,.json,text/csv,application/json" className="sr-only" id="import-file" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              <label htmlFor="import-file" className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-[13.5px] text-ink-2 hover:bg-surface-2">
                <FileUp className="size-4 shrink-0" />
                <span className="truncate">{file?.name ?? t('imp.choose')}</span>
              </label>
            </div>
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">{t('imp.formats')}</p>
        {analyze.isPending && <Spinner className="mt-3" />}
        {error && !analysis && <FormError message={error} />}
      </Panel>

      {analysis && (
        <Panel title={t('imp.step2', { n: analysis.rowCount })}>
          <div className="space-y-5">
            {(presets.data?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-ink-3">{t('imp.savedMappings')}</span>
                {presets.data!.map((p) => (
                  <span key={p.id} className="inline-flex items-center rounded-full bg-surface-2">
                    <button type="button" className="px-3 py-1 text-[12.5px] font-medium" onClick={() => applyPreset(p)}>
                      {p.name}
                    </button>
                    <button type="button" className="pe-2 text-ink-3 hover:text-neg" onClick={() => deletePreset.mutate(p.id)} aria-label={t('common.delete')}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {isTx && (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={t('imp.account')} error={fieldErrors.accountId}>
                  <Select value={options.accountId ?? ''} onChange={(e) => setOpt('accountId', e.target.value || null)} invalid={!!fieldErrors.accountId}>
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('imp.amountMode')}>
                  <Select value={options.amountMode} onChange={(e) => setOpt('amountMode', e.target.value as 'signed')}>
                    <option value="signed">{t('imp.signed')}</option>
                    <option value="split">{t('imp.split')}</option>
                  </Select>
                </Field>
                <div />
                <Field label={t('imp.defaultExpense')} hint={t('imp.defaultCatHint')}>
                  <Select value={options.defaultExpenseCategoryId ?? ''} onChange={(e) => setOpt('defaultExpenseCategoryId', e.target.value || null)}>
                    <option value="">—</option>
                    {cats
                      .filter((c) => c.kind === 'expense')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {catName(c)}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={t('imp.defaultIncome')}>
                  <Select value={options.defaultIncomeCategoryId ?? ''} onChange={(e) => setOpt('defaultIncomeCategoryId', e.target.value || null)}>
                    <option value="">—</option>
                    {cats
                      .filter((c) => c.kind === 'income')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {catName(c)}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            )}

            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-2">{t('imp.columns')}</p>
              <NoFieldId>
                <div className="grid gap-3 md:grid-cols-2">
                  {visibleFields.map((f) => (
                    <div key={f.key} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] items-center gap-2">
                      <label htmlFor={`map-${f.key}`} className="truncate text-[13px] text-ink-2">
                        {t(`imp.f.${f.key}` as MessageKey)}
                        {f.required && <span className="ms-0.5 text-neg">*</span>}
                      </label>
                      <div>
                        <Select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(e) => (setMapping((m) => ({ ...m, [f.key]: e.target.value })), setResult(null))} invalid={!!fieldErrors[`mapping.${f.key}`]}>
                          <option value="">{t('imp.skip')}</option>
                          {analysis.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </Select>
                        {mapping[f.key] && colSample(mapping[f.key]) && (
                          <p className="mt-0.5 truncate text-[11.5px] text-ink-3" dir="auto">
                            {t('imp.eg')} {colSample(mapping[f.key])}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </NoFieldId>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('imp.dateFormat')} hint={analysis.suggested.dateFormat ? t('imp.detected') : t('imp.notDetected')}>
                <Select value={options.dateFormat} onChange={(e) => setOpt('dateFormat', e.target.value as ImportOptions['dateFormat'])}>
                  {DATE_FORMATS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('imp.decimal')}>
                <Select value={options.decimal} onChange={(e) => setOpt('decimal', e.target.value as '.')}>
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </Select>
              </Field>
              {target !== 'organizations' && target !== 'applications' && (
                <Field label={t('common.workspace')} optional hint={isTx ? t('imp.wsHint') : undefined}>
                  <Select value={options.workspaceId ?? ''} onChange={(e) => setOpt('workspaceId', e.target.value || null)}>
                    <option value="">{isTx ? t('imp.accountWs') : t('common.noWorkspace')}</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <div className="space-y-3">
              {isTx && <Switch checked={options.includeDuplicates} onChange={(x) => setOpt('includeDuplicates', x)} label={t('imp.includeDup')} description={t('imp.includeDupHint')} />}
              <Switch checked={options.runAutomations} onChange={(x) => setOpt('runAutomations', x)} label={t('imp.runAuto')} description={t('imp.runAutoHint')} />
            </div>

            {error && <FormError message={error} />}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-end gap-2">
                <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t('imp.presetPh')} aria-label={t('imp.presetName')} className="w-48" />
                <Button icon={<Save className="size-4" />} disabled={!presetName.trim()} loading={savePreset.isPending} onClick={() => savePreset.mutate(undefined)}>
                  {t('imp.savePreset')}
                </Button>
              </div>
              <Button
                variant="primary"
                loading={preview.isPending}
                onClick={() => {
                  setError(null);
                  setFieldErrors({});
                  preview.mutate(undefined, { onError: fail });
                }}
              >
                {t('imp.check')}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {result && (
        <Panel title={result.committed ? t('imp.resultDone') : t('imp.step3')}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="pos">{t(result.committed ? 'imp.importedCount' : 'imp.okCount', { n: result.ok })}</Badge>
              {result.duplicates > 0 && <Badge tone="warn">{t('imp.dupCount', { n: result.duplicates })}</Badge>}
              {result.errors > 0 && <Badge tone="neg">{t('imp.errCount', { n: result.errors })}</Badge>}
              {result.warnings > 0 && <Badge>{t('imp.warnCount', { n: result.warnings })}</Badge>}
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-line scrollbar-thin">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface text-ink-3">
                  <tr className="border-b border-line">
                    <th className="w-14 px-2 py-1.5 text-start font-medium">{t('imp.row')}</th>
                    <th className="w-24 px-2 py-1.5 text-start font-medium">{t('common.status')}</th>
                    <th className="px-2 py-1.5 text-start font-medium">{t('common.details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.results.map((r) => (
                    <tr key={r.row} className={clsx(r.status === 'error' && 'bg-neg-soft/40', r.status === 'duplicate' && 'bg-warn-soft/40')}>
                      <td className="num px-2 py-1.5 text-ink-3">{r.row}</td>
                      <td className="px-2 py-1.5">{t(`imp.s.${r.status}` as MessageKey)}</td>
                      <td className="px-2 py-1.5" dir="auto">
                        {r.summary ?? r.message}
                        {r.summary && r.message && <span className="text-ink-3"> · {r.message}</span>}
                        {r.warnings?.map((w) => (
                          <span key={w} className="block text-[11.5px] text-warn">
                            {w}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.committed ? (
              <p className="flex items-center gap-2 text-[13.5px] text-pos">
                <CheckCircle2 className="size-4" />
                {t('imp.doneBody', { n: result.ok })}
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <p className="text-[12.5px] text-ink-3">{t('imp.previewNote')}</p>
                <Button variant="primary" icon={<Upload className="size-4" />} disabled={!result.ok} loading={commit.isPending} onClick={() => commit.mutate(undefined, { onError: fail })}>
                  {t('imp.importN', { n: result.ok })}
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title={t('imp.history')} padded={false}>
        {!history.data?.length ? (
          <p className="p-4 text-[13px] text-ink-3">{t('imp.noHistory')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.data.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {t(`imp.t.${h.target}` as MessageKey)}
                    {h.fileName && <span className="text-ink-3"> · {h.fileName}</span>}
                  </p>
                  <p className="text-[12px] text-ink-3">
                    {fmt.dateTime(h.createdAt)} · {t('imp.histLine', { created: h.createdCount, total: h.rowCount })}
                  </p>
                </div>
                {h.undoneAt ? (
                  <Badge>{t('imp.undoneBadge')}</Badge>
                ) : (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setUndo(h)}>
                    {t('imp.undo')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog
        open={!!undo}
        onOpenChange={(o) => !o && setUndo(null)}
        title={t('imp.undoTitle', { n: undo?.createdCount ?? 0 })}
        body={t('imp.undoBody')}
        confirmLabel={t('imp.undo')}
        loading={undoImport.isPending}
        onConfirm={() => undo && undoImport.mutate(undo.id)}
      />
    </div>
  );
}
