import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button } from './button';

// ---------- toasts ----------
type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(kind: ToastKind, message: string, action?: Toast['action']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pe-6" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-pop"
            >
              <I className={clsx('mt-0.5 size-4 shrink-0', t.kind === 'success' ? 'text-pos' : t.kind === 'error' ? 'text-neg' : 'text-info')} />
              <p className="text-[13.5px]">{t.message}</p>
              {t.action && (
                <button className="ms-2 text-[13px] font-semibold text-accent" onClick={t.action.onClick}>
                  {t.action.label}
                </button>
              )}
              <button className="ms-1 text-ink-3 hover:text-ink" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string, action?: Toast['action']) => push('info', m, action),
  };
}

// ---------- states ----------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-ink-3', className)} aria-hidden />;
}

export function LoadingBlock() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-3" role="status">
      <Spinner />
      <span className="text-[13px]">{t('app.loading')}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, te } = useI18n();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-neg/25 bg-neg-soft px-6 py-8 text-center" role="alert">
      <AlertTriangle className="size-6 text-neg" />
      <div>
        <p className="font-semibold">{t('app.error')}</p>
        <p className="mt-1 text-[13px] text-ink-2">{te(message)}</p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('app.retry')}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-3">{icon}</div>}
      <div className="max-w-sm">
        <p className="font-semibold">{title}</p>
        {body && <p className="mt-1 text-[13px] text-ink-3">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}
