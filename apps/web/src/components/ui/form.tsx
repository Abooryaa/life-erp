import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useI18n } from '../../i18n';

/** Lets a Field's <label> point at whatever control is inside it, without wiring ids by hand. */
const FieldIdContext = createContext<string | undefined>(undefined);
export function useFieldId(explicit?: string) {
  const fromField = useContext(FieldIdContext);
  return explicit ?? fromField;
}
/** Wrap repeated controls inside one Field (lists of rows) so they don't share the field's id. */
export function NoFieldId({ children }: { children: ReactNode }) {
  return <FieldIdContext.Provider value={undefined}>{children}</FieldIdContext.Provider>;
}

const control =
  'w-full rounded-lg border bg-surface text-ink placeholder:text-ink-3 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent disabled:opacity-60 disabled:bg-surface-2';

function borderFor(invalid?: boolean) {
  return invalid ? 'border-neg' : 'border-line-strong';
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, id, ...rest }, ref) {
    const fid = useFieldId(id);
    return <input ref={ref} id={fid} aria-invalid={invalid || undefined} className={clsx(control, borderFor(invalid), 'h-9 px-3', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, id, ...rest }, ref) {
    const fid = useFieldId(id);
    return (
      <textarea ref={ref} id={fid} rows={rows} aria-invalid={invalid || undefined} className={clsx(control, borderFor(invalid), 'px-3 py-2 leading-relaxed', className)} {...rest} />
    );
  },
);

/** Native select: the best picker on phones, styled to match. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, id, ...rest }, ref) {
    const fid = useFieldId(id);
    return (
      <div className={clsx('relative', className)}>
        <select ref={ref} id={fid} aria-invalid={invalid || undefined} className={clsx(control, borderFor(invalid), 'h-9 appearance-none ps-3 pe-8')} {...rest}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      </div>
    );
  },
);

export function Field({
  label,
  error,
  hint,
  optional,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const { t, te } = useI18n();
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <FieldIdContext.Provider value={id}>
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
          {label}
          {optional && <span className="ms-1 font-normal text-ink-3">({t('common.optional')})</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-neg">
          {te(error)}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
    </FieldIdContext.Provider>
  );
}

/** Label + input in one, wired with ids and errors. */
export function TextField({
  label,
  error,
  hint,
  optional,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string | null; hint?: ReactNode; optional?: boolean }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} optional={optional} className={className} htmlFor={id}>
      <Input id={id} invalid={!!error} {...input} />
    </Field>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex flex-col">
        <span className="font-medium">{label}</span>
        {description && <span className="text-[13px] text-ink-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'start-[18px]' : 'start-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  const { te } = useI18n();
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-neg/30 bg-neg-soft px-3 py-2 text-[13px] text-neg">
      {te(message)}
    </div>
  );
}
