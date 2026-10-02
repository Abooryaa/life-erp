import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from './api';

/**
 * Phone outbox: quick-adds (expense, task, note…) made while the laptop is unreachable are
 * kept on the device and sent later. Each item carries an idempotency key, so a request that
 * reached the server before the connection dropped is never recorded twice.
 * Only "create" requests are queued — never edits or deletes — so nothing can conflict.
 */
export interface OutboxItem {
  key: string;
  url: string;
  body: unknown;
  label: string;
  createdAt: string;
}

const STORE = 'lerp.outbox';
const listeners = new Set<() => void>();
let cache: OutboxItem[] | null = null;

function read(): OutboxItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(STORE) ?? '[]') as OutboxItem[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: OutboxItem[]) {
  cache = items;
  try {
    localStorage.setItem(STORE, JSON.stringify(items));
  } catch {
    /* storage full or unavailable — items stay in memory for this session */
  }
  listeners.forEach((l) => l());
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type SendResult<T> = { queued: false; data: T } | { queued: true };

/** POST now; if the server can't be reached, keep it in the outbox instead of losing it. */
export async function postOrQueue<T>(url: string, body: unknown, label: string): Promise<SendResult<T>> {
  const key = newKey();
  try {
    const data = await api.post<T>(url, body, { 'X-Idempotency-Key': key });
    return { queued: false, data };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'offline') {
      write([...read(), { key, url, body, label, createdAt: new Date().toISOString() }]);
      return { queued: true };
    }
    throw err;
  }
}

let flushing = false;

/** Send everything waiting. Returns how many were delivered and which were rejected. */
export async function flushOutbox(): Promise<{ sent: number; rejected: { item: OutboxItem; message: string }[] }> {
  if (flushing) return { sent: 0, rejected: [] };
  flushing = true;
  let sent = 0;
  const rejected: { item: OutboxItem; message: string }[] = [];
  try {
    for (const item of [...read()]) {
      try {
        await api.post(item.url, item.body, { 'X-Idempotency-Key': item.key });
        sent++;
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'offline' || err.status === 401 || err.status >= 500)) break; // try again later
        rejected.push({ item, message: err instanceof Error ? err.message : String(err) });
      }
      write(read().filter((x) => x.key !== item.key));
    }
  } finally {
    flushing = false;
  }
  return { sent, rejected };
}

export function useOutbox() {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    read,
    read,
  );
  return items;
}

/** Retry automatically when the phone comes back online, and every 30 seconds while items wait. */
export function useOutboxSync(onResult: (r: Awaited<ReturnType<typeof flushOutbox>>) => void) {
  const items = useOutbox();
  useEffect(() => {
    if (!items.length) return;
    const run = () => void flushOutbox().then((r) => (r.sent || r.rejected.length) && onResult(r));
    run();
    window.addEventListener('online', run);
    const id = setInterval(run, 30_000);
    return () => {
      window.removeEventListener('online', run);
      clearInterval(id);
    };
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}
