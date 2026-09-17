/**
 * Thin fetch wrapper for the Companio API. Every call:
 *  - sends `credentials: 'include'` so the httpOnly session cookie
 *    (companio_sid) rides along automatically — this app never touches
 *    the session id itself, exactly like the API expects (see API.md).
 *  - attaches `X-CSRF-Token` on every mutating request (POST/PUT/DELETE),
 *    sourced from the companio_csrf cookie via GET /auth/csrf. That
 *    cookie is deliberately readable by JS (double-submit CSRF), but we
 *    still fetch the token from the endpoint rather than reading the
 *    cookie ourselves, so this file has exactly one source of truth and
 *    doesn't need its own cookie-parsing logic.
 *  - throws an ApiError with the server's real status + message so
 *    calling code can show something meaningful instead of a generic
 *    failure.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

// The Socket.IO gateway is not behind the `api/v1` prefix (Nest's
// setGlobalPrefix only applies to REST controllers) — it lives at the
// server root, so this is deliberately API_BASE_URL with that suffix
// stripped, not a second env var to keep in sync by hand.
export const WS_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 502/503/504 mean a gateway/proxy problem, not the app rejecting the
// request -- on Render's free tier this is almost always one of the two
// services (this proxy's own target, or the proxy itself) still finishing
// its cold-start wake-up after ~15 minutes idle, which can briefly outlast
// a single request. A thrown fetch (network/DNS blip, connection reset --
// also more common on flaky mobile networks) is the same class of
// transient failure. Retrying those few times with a short backoff clears
// almost all of them without the user ever seeing an error; everything
// else (4xx, a real 500) is a genuine failure and is never retried here.
const RETRYABLE_STATUS = new Set([502, 503, 504]);

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(800 * attempt);
    }
    try {
      const res = await fetch(url, init);
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts - 1) {
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

let csrfTokenPromise: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_BASE_URL}/auth/csrf`, {
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'Could not prepare a secure request. Please retry.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'Could not prepare a secure request. Please retry.');
  }
  const data = (await res.json()) as { csrfToken: string };
  return data.csrfToken;
}

async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    csrfTokenPromise = null;
  }
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetchCsrfToken();
  }
  try {
    return await csrfTokenPromise;
  } catch (err) {
    csrfTokenPromise = null;
    throw err;
  }
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  allowCsrfRetry = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
  }

  let res: Response;
  try {
    res = await fetchWithRetry(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Please check your connection and retry.');
  }

  // A stale/rotated CSRF cookie is the one failure mode worth a single
  // transparent retry — everything else (401/403 for a real auth
  // reason, 404, validation errors) should surface to the caller as-is.
  if (res.status === 403 && method !== 'GET' && allowCsrfRetry) {
    await ensureCsrfToken(true);
    return request<T>(path, method, body, false);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(data, 'Something went wrong. Please try again.'));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, 'GET'),
  post: <T>(path: string, body?: unknown) => request<T>(path, 'POST', body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>(path, 'PUT', body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>(path, 'DELETE', body),
};
