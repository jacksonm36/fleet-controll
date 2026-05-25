import { clearToken, getToken } from "./auth";

function apiErrorBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    /* ignore */
  }
  return text;
}

export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401) {
    clearToken();
    if (
      typeof window !== "undefined" &&
      !path.includes("/api/auth/login")
    ) {
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
  return (await res.json()) as T;
}
