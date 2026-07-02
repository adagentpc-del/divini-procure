/**
 * Backend API client. Talks to the Express backend (same origin). Native auth:
 * the session lives in an httpOnly `divini_session` cookie set by the backend,
 * so requests just send credentials. We ALSO keep the returned token in memory
 * + localStorage and send it as `Authorization: Bearer` as a belt-and-braces
 * fallback for environments where the cookie is not delivered.
 */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

const TOKEN_KEY = 'procure_session_token';

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function authHeader(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
    headers: { ...authHeader() },
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
      ...authHeader(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: { ...authHeader() },
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
    headers: { ...authHeader() }, // do NOT set Content-Type; browser sets boundary
    body: form,
  });
  return handle<T>(res);
}
