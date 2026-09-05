/**
 * Minimal fetch wrapper for the Dharma Events API. All API responses use
 * the `{ success, data }` / `{ success: false, error }` envelope (Section
 * 86); `apiFetch` unwraps that envelope and throws an `ApiRequestError` on
 * failure so callers/react-query can treat it uniformly.
 */
export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string } }
    | null;

  if (!response.ok || !body || body.success === false) {
    const code = body && body.success === false ? body.error.code : 'UNKNOWN_ERROR';
    const message = body && body.success === false ? body.error.message : `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, code, message);
  }

  return body.data;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

export function apiPatch<T>(path: string, payload?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
