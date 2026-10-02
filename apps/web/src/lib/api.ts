export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: FieldError[] = [],
  ) {
    super(message);
  }
  /** Map of field path → first error message, for forms. */
  fieldMap(): Record<string, string> {
    const m: Record<string, string> = {};
    for (const f of this.fields) if (!m[f.path]) m[f.path] = f.message;
    return m;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called whenever the server says the session is gone (expired, revoked, restored backup). */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  }
  let body: { error?: { code?: string; message?: string; fields?: FieldError[] } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error (proxy, network) */
  }
  if (res.status === 401 && body.error?.code === 'unauthorized') unauthorizedListeners.forEach((l) => l());
  throw new ApiError(
    res.status,
    body.error?.code ?? 'http_error',
    body.error?.message ?? `The server answered ${res.status} ${res.statusText}`,
    body.error?.fields ?? [],
  );
}

async function request<T>(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        // Required by the server's CSRF check on every state-changing request.
        'X-Life-ERP': '1',
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach LIFE ERP. Check that the laptop is on and connected.');
  }
  return handle<T>(res);
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', url, body ?? {}, headers),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Multipart upload with progress reporting (fetch can't report upload progress). */
export function uploadWithProgress<T>(url: string, form: FormData, onProgress?: (ratio: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Life-ERP', '1');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'offline', 'Upload failed: cannot reach LIFE ERP.'));
    xhr.onload = () => {
      const res = new Response(xhr.responseText, {
        status: xhr.status,
        headers: { 'content-type': xhr.getResponseHeader('content-type') ?? 'application/json' },
      });
      handle<T>(res).then(resolve, reject);
    };
    xhr.send(form);
  });
}

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
