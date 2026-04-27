// Lightweight authed fetch wrapper. Always sends:
//   - credentials: 'include'  → session cookie travels on every call
//   - X-Requested-With: fetch → matches the server-side CSRF guard
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  body?: unknown;
  signal?: AbortSignal;
}

async function call<T>(method: string, path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  const res = await fetch(`${BASE}${path}`, init);

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = await res.json() as { error?: { code?: string; message?: string } };
      if (parsed.error?.code) code = parsed.error.code;
      if (parsed.error?.message) message = parsed.error.message;
    } catch { /* non-JSON body */ }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json() as { data: T };
  return data.data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => call<T>('GET', path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body !== undefined ? { body } : {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body !== undefined ? { body } : {}),
  del: <T>(path: string) => call<T>('DELETE', path),
};
