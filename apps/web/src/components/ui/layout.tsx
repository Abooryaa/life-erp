import clsx from 'clsx';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-[22px] font-semibold tracking-tight md:text-[24px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13.5px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx('min-w-0 rounded-card border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
          <h2 className="min-w-0 text-[14px] font-semibold">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </section>
  );
}

/** Key → value row used in detail views. */
export function DataRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="shrink-0 text-[13px] text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end break-words">{children}</dd>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'pos' | 'neg' | 'warn' }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[12.5px] font-medium text-ink-3">{label}</p>
      <p className={clsx('num mt-0.5 truncate text-[20px] font-semibold', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg', tone === 'warn' && 'text-warn')}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{hint}</p>}
    </div>
  );
}
