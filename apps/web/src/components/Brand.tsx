import clsx from 'clsx';

/** LIFE ERP mark: four modules on a grid, one highlighted — "everything connected". */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <rect x="7" y="7" width="8" height="8" rx="2" fill="var(--accent)" />
      <rect x="17" y="7" width="8" height="8" rx="2" fill="var(--canvas)" opacity=".9" />
      <rect x="7" y="17" width="8" height="8" rx="2" fill="var(--canvas)" opacity=".9" />
      <rect x="17" y="17" width="8" height="8" rx="2" fill="var(--canvas)" opacity=".55" />
    </svg>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={clsx('font-semibold tracking-tight', className)} dir="ltr">
      LIFE <span className="text-ink-3">ERP</span>
    </span>
  );
}
