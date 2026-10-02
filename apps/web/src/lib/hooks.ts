import type { Settings } from '@life-erp/shared';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '../components/ui/feedback';
import { useI18n } from '../i18n';
import { api, ApiError } from './api';
import type { AuthStatus, Workspace } from './types';

export function useAuthStatus() {
  return useQuery({ queryKey: ['auth', 'status'], queryFn: () => api.get<AuthStatus>('/api/auth/status'), staleTime: 60_000 });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings'), enabled, staleTime: 300_000 });
}

export function useWorkspaces(includeArchived = false) {
  return useQuery({
    queryKey: ['workspaces', { includeArchived }],
    queryFn: () => api.get<Workspace[]>(`/api/workspaces${includeArchived ? '?archived=1' : ''}`),
    staleTime: 60_000,
  });
}

/**
 * Mutation that shows server errors as a toast (unless the form handles field errors)
 * and refreshes the given queries on success.
 */
export function useAction<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult, v: TVars) => void; silentFieldErrors?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const { te } = useI18n();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r, v);
    },
    onError: (err) => {
      if (opts.silentFieldErrors && err instanceof ApiError && err.fields.length) return;
      toast.error(te(err instanceof Error ? err.message : String(err)));
    },
  });
}

export function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

/** Small form-state helper: values, field errors (client Zod + server), and submit wiring. */
export function useFormState<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  return {
    values,
    errors,
    formError,
    setValues,
    set: <K extends keyof T>(k: K, v: T[K]) => {
      setValues((s) => ({ ...s, [k]: v }));
      setErrors((e) => {
        if (!e[k as string]) return e;
        const { [k as string]: _drop, ...rest } = e;
        return rest;
      });
    },
    setErrors,
    setFormError,
    /** Apply an error from the server: field errors go next to fields, others above the form. */
    fail(err: unknown) {
      if (err instanceof ApiError && err.fields.length) {
        setErrors(err.fieldMap());
        setFormError(null);
      } else setFormError(err instanceof Error ? err.message : String(err));
    },
    reset: () => {
      setValues(initial);
      setErrors({});
      setFormError(null);
    },
  };
}
