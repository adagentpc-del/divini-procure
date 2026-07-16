/**
 * Backend API client. Talks to the Express backend (same origin). Native auth:
 * the session lives in an httpOnly `divini_session` cookie set by the backend.
 * All requests use `credentials: 'include'` so the cookie is sent automatically.
 * Tokens are NOT stored in localStorage or sent as Authorization Bearer headers
 * to prevent XSS-based token theft.
 */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || JSON.stringify(body);
    } catch {
      detail = res.statusText;
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
  });
  return handle<T>(res);
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json(); detail = b?.error || JSON.stringify(b); } catch { detail = res.statusText; }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.blob();
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    credentials: 'include',
    // Do NOT set Content-Type — the browser sets the multipart boundary automatically.
    body: form,
  });
  return handle<T>(res);
}
