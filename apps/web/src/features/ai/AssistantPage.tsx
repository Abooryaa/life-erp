import { Bot, ChevronDown, Database, Send, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Button, ButtonLink } from '../../components/ui/button';
import { EmptyState, LoadingBlock, Spinner } from '../../components/ui/feedback';
import { Textarea } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useAiStatus, type ToolCall } from './ai-lib';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  meta?: string;
  error?: boolean;
}

const EXAMPLES = ['ai.ex.spending', 'ai.ex.netWorth', 'ai.ex.today', 'ai.ex.bills', 'ai.ex.business', 'ai.ex.career'] as const;

export function AssistantPage() {
  const { t, locale } = useI18n();
  const status = useAiStatus();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [turns, busy]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [busy]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    // Only the conversation text goes back as history — earlier tool results are fetched again if needed.
    const history = turns.filter((x) => !x.error).slice(-10).map((x) => ({ role: x.role, content: x.content.slice(0, 6000) }));
    setTurns((s) => [...s, { role: 'user', content: text }]);
    setQuestion('');
    setBusy(true);
    try {
      const r = await api.post<{ answer: string; toolCalls: ToolCall[]; provider: string; model: string; durationMs: number }>('/api/ai/ask', { question: text, history });
      setTurns((s) => [...s, { role: 'assistant', content: r.answer, toolCalls: r.toolCalls, meta: `${r.model} · ${(r.durationMs / 1000).toFixed(1)} s` }]);
    } catch (err) {
      setTurns((s) => [...s, { role: 'assistant', content: err instanceof ApiError ? err.message : String(err), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) return <LoadingBlock />;
  const s = status.data;
  if (!s?.ready) {
    return (
      <div>
        <PageHeader title={t('ai.assistant')} />
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={<Bot className="size-5" />}
            title={s?.enabled ? t('ai.notReady') : t('ai.offTitle')}
            body={s?.problem && s.problem !== 'disabled' ? t(`ai.problem.${s.problem}` as MessageKey) : t('ai.offBody')}
            action={
              <ButtonLink to="/settings/ai" variant="primary">
                {t('ai.openSettings')}
              </ButtonLink>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader
        title={t('ai.assistant')}
        subtitle={`${s.provider === 'ollama' ? t('ai.p.ollama') : t('ai.p.anthropic')} · ${s.model}`}
        actions={
          turns.length > 0 && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setTurns([])} disabled={busy}>
              {t('ai.newChat')}
            </Button>
          )
        }
      />
      <p className="mb-4 rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px] text-ink-3">{s.leavesDevice ? t('ai.noticeCloud') : t('ai.noticeLocal')}</p>

      {turns.length === 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {EXAMPLES.map((k) => (
            <button key={k} type="button" onClick={() => ask(t(k))} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 hover:border-line-strong">
              {t(k)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4" aria-live="polite">
        {turns.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-ee-sm bg-accent px-4 py-2.5 text-[14px] whitespace-pre-wrap text-accent-ink" dir="auto">
                {m.content}
              </p>
            </div>
          ) : (
            <Panel key={i} className={m.error ? 'border-neg/40' : undefined}>
              {m.error ? (
                <p className="text-[13.5px] text-neg">{m.content}</p>
              ) : (
                <>
                  <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">
                    <Sparkles className="size-3.5" />
                    {t('ai.answerLabel')}
                    {m.meta && <span className="font-normal normal-case"> · {m.meta}</span>}
                  </p>
                  <div dir="auto" className="text-[14px]">
                    <Markdown source={m.content} untrusted />
                  </div>
                  <DataUsed calls={m.toolCalls ?? []} />
                </>
              )}
            </Panel>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner className="size-4" />
            {t('ai.thinking')} {elapsed > 5 && `(${elapsed} s${s.provider === 'ollama' && elapsed > 15 ? ` — ${t('ai.localSlow')}` : ''})`}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-20 mt-5 flex items-end gap-2 rounded-card border border-line bg-surface p-2 shadow-pop md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          rows={1}
          placeholder={t('ai.placeholder')}
          aria-label={t('ai.placeholder')}
          className="max-h-40 min-h-9 flex-1 border-0 focus:ring-0"
          dir="auto"
          lang={locale}
        />
        <Button type="submit" variant="primary" size="icon" disabled={!question.trim() || busy} aria-label={t('ai.send')}>
          <Send className="size-4 rtl:-scale-x-100" />
        </Button>
      </form>
    </div>
  );
}

/** The facts behind an answer: exactly what each data tool returned, straight from your records. */
function DataUsed({ calls }: { calls: ToolCall[] }) {
  const { t } = useI18n();
  if (!calls.length) return <p className="mt-3 border-t border-line pt-2 text-[12px] text-ink-3">{t('ai.noData')}</p>;
  return (
    <details className="group mt-3 border-t border-line pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        <Database className="size-3.5" />
        {t('ai.dataUsed', { n: calls.length })}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-1 text-[12px] text-ink-3">{t('ai.dataUsedHint')}</p>
      <ul className="mt-2 space-y-2">
        {calls.map((c, i) => (
          <li key={i} className="rounded-lg bg-surface-2/60 p-2">
            <p className="text-[12.5px] font-medium">
              {t(`ai.tool.${c.name}` as MessageKey)}
              {!c.ok && <span className="ms-1 text-neg">({t('ai.toolFailed')})</span>}
              <code className="ms-2 text-[11px] text-ink-3" dir="ltr">
                {JSON.stringify(c.args)}
              </code>
            </p>
            <pre className="mt-1 max-h-60 overflow-auto text-[11.5px] whitespace-pre-wrap text-ink-2 scrollbar-thin" dir="ltr">
              {JSON.stringify(c.result, null, 1)}
            </pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
