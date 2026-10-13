export type Role = "owner" | "admin" | "operator" | "viewer";
export type User = { id: string; email: string; name: string; role: Role };

let csrf: string | null = null;
export function setCsrf(value?: string | null) {
  csrf = value || null;
}
export function getCsrf() {
  return csrf;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (method === "GET") headers.set("X-Admin-Polling", "1");
  if (options.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD" && csrf)
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body?.message || body?.error || `Request failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number; body?: any };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body as T;
}

export async function loadMe() {
  const result = await api<{ user: User | null; csrf?: string }>(
    "/api/auth/me"
  );
  setCsrf(result.csrf);
  return result;
}
export function isPermissionDenied(error: unknown) {
  return (
    error instanceof Error &&
    /forbidden|permission|unauthorized/i.test(error.message)
  );
}
export function formatDate(value?: string | null, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(
    undefined,
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }
  );
}
export function formatAge(value?: string | null) {
  if (!value) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000)
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** Generate a password without Math.random or persistence. */
export function generateSecurePassword(length = 24) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}
export function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${generateSecurePassword(16)}`;
  }
}
export async function downloadApiFile(
  path: string,
  filename: string,
  signal?: AbortSignal
) {
  const headers = new Headers();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const response = await fetch(path, {
    signal,
    credentials: "include",
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.error || body.message || message;
    } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
