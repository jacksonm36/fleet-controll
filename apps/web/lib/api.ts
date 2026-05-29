import { clearLegacyToken, getToken, logoutSession, markCookieSession } from "./auth";
import {
  cacheKey,
  invalidateCachePrefix,
  readCache,
  writeCache,
} from "./apiCache";

function apiErrorBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: unknown;
      message?: unknown;
    };
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.message === "string" && parsed.message.length > 0) {
        return parsed.message;
      }
      if (
        typeof parsed.error === "string" &&
        parsed.error !== "Bad Request" &&
        parsed.error !== "internal_error"
      ) {
        return parsed.error;
      }
      if (typeof parsed.error === "string") return parsed.error;
    }
  } catch {
    /* ignore */
  }
  return text;
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Browser: same-origin proxy via Next rewrites — httpOnly session cookies work.
  if (typeof window !== "undefined") return normalized;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base.replace(/\/$/, "")}${normalized}`;
}

export type ApiFetchOptions = RequestInit & {
  /** Client-side GET cache TTL (ms). Default 0 = no cache. */
  cacheTtlMs?: number;
};

export async function apiFetch<T>(
  path: string,
  init: ApiFetchOptions = {},
): Promise<T> {
  const { cacheTtlMs = 0, ...fetchInit } = init;
  const method = (fetchInit.method ?? "GET").toUpperCase();
  const key = cacheKey(path, fetchInit);

  if (method === "GET" && cacheTtlMs > 0) {
    const cached = readCache<T>(key);
    if (cached !== null) return cached;
  }

  const token = getToken();
  const headers = new Headers(fetchInit.headers);
  const hasBody =
    fetchInit.body !== undefined &&
    fetchInit.body !== null &&
    fetchInit.body !== "";
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(apiUrl(path), {
    ...fetchInit,
    headers,
    credentials: "include",
  });
  if (res.status === 401) {
    markCookieSession(null);
    clearLegacyToken();
    if (
      typeof window !== "undefined" &&
      !path.includes("/api/auth/login")
    ) {
      void logoutSession();
      window.location.href = "/login";
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      apiErrorBody(text.trim()) || `HTTP ${res.status}`,
    );
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  if (method !== "GET") {
    invalidateCachePrefix("/api/");
  } else if (cacheTtlMs > 0) {
    writeCache(key, data, cacheTtlMs);
  }
  return data;
}
