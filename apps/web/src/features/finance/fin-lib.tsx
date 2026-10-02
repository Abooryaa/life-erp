import { addMonthsToMonth } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { Button } from '../../components/ui/button';
import { Select, useFieldId } from '../../components/ui/form';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';

// ---------- types ----------
export interface Account {
  id: string;
  workspaceId: string | null;
  name: string;
  type: string;
  currency: string;
  openingBalance: number;
  openingDate: string | null;
  institution: string | null;
  reference: string | null;
  creditLimit: number | null;
  color: string | null;
  includeInNetWorth: boolean;
  notes: string | null;
  archivedAt: string | null;
  balance: number;
  liquid?: boolean;
  liability?: boolean;
}

export interface Category {
  id: string;
  parentId: string | null;
  kind: 'income' | 'expense';
  name: string;
  nameAr: string | null;
  color: string | null;
  archivedAt: string | null;
}

export interface Tx {
  id: string;
  date: string;
  type: 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment';
  accountId: string;
  amount: number;
  currency: string;
  categoryId: string | null;
  payee: string | null;
  description: string | null;
  notes: string | null;
  workspaceId: string | null;
  transferGroup: string | null;
  recurringId: string | null;
  installmentPaymentId: string | null;
  debtPaymentId: string | null;
  accountName?: string;
  categoryName?: string | null;
  categoryNameAr?: string | null;
  categoryColor?: string | null;
  tags: string[];
  counterpart?: Tx | null;
}

export interface CurrencyInfo {
  code: string;
  name: string;
  nameAr: string;
  digits: number;
  custom: boolean;
}

// ---------- data hooks ----------
export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: ['finance', 'accounts', { includeArchived }],
    queryFn: () => api.get<Account[]>(`/api/finance/accounts${includeArchived ? '?archived=1' : ''}`),
  });
}

export function useCategories(includeArchived = false) {
  return useQuery({
    queryKey: ['finance', 'categories', { includeArchived }],
    queryFn: () => api.get<Category[]>(`/api/finance/categories${includeArchived ? '?archived=1' : ''}`),
    staleTime: 60_000,
  });
}

export function useCurrencies() {
  return useQuery({ queryKey: ['finance', 'currencies'], queryFn: () => api.get<CurrencyInfo[]>('/api/finance/currencies'), staleTime: 300_000 });
}

/** Everything that depends on finance data — invalidate this after any money change. */
export const FIN_KEYS = [['finance'], ['notifications'], ['audit'], ['links']];

// ---------- display helpers ----------
export function useCategoryName() {
  const { locale } = useI18n();
  return (c: { name?: string | null; nameAr?: string | null } | null | undefined) => (!c ? '' : locale === 'ar' && c.nameAr ? c.nameAr : (c.name ?? ''));
}

/** Money with semantic colour: positive = green, negative = red (optional). */
export function Money({
  minor,
  currency,
  colored,
  sign,
  className,
  compact,
}: {
  minor: number;
  currency?: string;
  colored?: boolean;
  sign?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const { fmt } = useI18n();
  return (
    <span className={clsx('num whitespace-nowrap', colored && (minor > 0 ? 'text-pos' : minor < 0 ? 'text-neg' : ''), className)} dir="ltr">
      {fmt.money(minor, currency, { sign, compact })}
    </span>
  );
}

/** Large, phone-friendly amount input (decimal keyboard, accepts Arabic digits). */
export const AmountInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { currency?: string; invalid?: boolean; big?: boolean }>(
  function AmountInput({ currency, invalid, big, className, id, onChange, ...rest }, ref) {
    const fid = useFieldId(id);
    return (
      <div className={clsx('relative', className)} dir="ltr">
        <input
          ref={ref}
          id={fid}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          aria-invalid={invalid || undefined}
          className={clsx(
            'num w-full rounded-lg border bg-surface text-ink placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none',
            invalid ? 'border-neg' : 'border-line-strong',
            big ? 'h-14 ps-4 pe-16 text-[26px] font-semibold' : 'h-9 ps-3 pe-14',
          )}
          onChange={(e) => {
            // Only digits (Western and Arabic-Indic), separators and a leading minus can be typed.
            const clean = e.target.value.replace(/[^0-9٠-٩۰-۹.,٫\-\s]/g, '');
            if (clean !== e.target.value) e.target.value = clean;
            onChange?.(e);
          }}
          {...rest}
        />
        {currency && <span className={clsx('pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 font-medium text-ink-3', big ? 'text-[15px]' : 'text-[12.5px]')}>{currency}</span>}
      </div>
    );
  },
);

export function CategorySelect({
  value,
  onChange,
  kind,
  invalid,
  allowEmpty,
  emptyLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  kind?: 'income' | 'expense';
  invalid?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  const name = useCategoryName();
  const { data = [] } = useCategories();
  const tops = data.filter((c) => !c.parentId && (!kind || c.kind === kind));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{emptyLabel ?? (allowEmpty ? t('tx.noCategory') : t('tx.chooseCategory'))}</option>
      {tops.map((top) => {
        const children = data.filter((c) => c.parentId === top.id);
        return children.length ? (
          <optgroup key={top.id} label={name(top)}>
            <option value={top.id}>{name(top)}</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {name(c)}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={top.id} value={top.id}>
            {name(top)}
          </option>
        );
      })}
    </Select>
  );
}

export function AccountSelect({
  value,
  onChange,
  invalid,
  allowEmpty,
  emptyLabel,
  exclude,
}: {
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  exclude?: string;
}) {
  const { fmt } = useI18n();
  const { data = [] } = useAccounts();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      {(allowEmpty || !value) && <option value="">{emptyLabel ?? '—'}</option>}
      {data
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {fmt.money(a.balance, a.currency)}
          </option>
        ))}
    </Select>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { t, locale, fmt } = useI18n();
  const label = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
  void fmt;
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
      <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonthsToMonth(month, -1))} aria-label={t('fin.prevMonth')}>
        <ChevronLeft className="size-4 rtl:rotate-180" />
      </Button>
      <span className="min-w-32 text-center text-[13.5px] font-medium">{label}</span>
      <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonthsToMonth(month, 1))} aria-label={t('fin.nextMonth')}>
        <ChevronRight className="size-4 rtl:rotate-180" />
      </Button>
    </div>
  );
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function accountTypeLabel(t: (k: MessageKey) => string, type: string) {
  return t(`acc.type.${type}` as MessageKey);
}

/** Progress bar with semantic colour. */
export function Bar({ ratio, tone = 'accent' }: { ratio: number; tone?: 'accent' | 'pos' | 'warn' | 'neg' }) {
  const color = { accent: 'bg-accent', pos: 'bg-pos', warn: 'bg-warn', neg: 'bg-neg' }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  );
}

export function MissingRates({ list }: { list: string[] }) {
  const { t } = useI18n();
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <span>{t('fin.missingRates', { list: list.join(', ') })}</span>
      <a href="/finance/currencies" className="font-semibold underline">
        {t('fin.addRate')}
      </a>
    </div>
  );
}
