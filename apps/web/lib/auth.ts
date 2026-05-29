const TOKEN_KEY = "fleet_token";

/** In-memory flag after /api/auth/me or login (httpOnly cookie holds the JWT). */
let cookieSession = false;

export type SessionUser = {
  id: string;
  username?: string;
  email: string;
  role: string;
  totpEnabled?: boolean;
  passkeyCount?: number;
};

let cachedUser: SessionUser | null = null;

export function apiBase(): string {
  if (typeof window !== "undefined") return "";
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
    /\/$/,
    "",
  );
}

export function hasSession(): boolean {
  if (cookieSession) return true;
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(TOKEN_KEY);
}

/** @deprecated Prefer hasSession(); kept for legacy Bearer in localStorage. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setLegacyToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearLegacyToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function markCookieSession(user: SessionUser | null) {
  cookieSession = !!user;
  cachedUser = user;
}

export function getSessionUser(): SessionUser | null {
  return cachedUser;
}

export async function bootstrapSession(): Promise<boolean> {
  try {
    const headers: HeadersInit = {};
    const legacy = getToken();
    if (legacy) headers.Authorization = `Bearer ${legacy}`;

    const res = await fetch(`${apiBase()}/api/auth/me`, {
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      markCookieSession(null);
      return false;
    }
    const data = (await res.json()) as { user: SessionUser };
    markCookieSession(data.user);
    return true;
  } catch {
    markCookieSession(null);
    return false;
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* ignore */
  }
  markCookieSession(null);
  clearLegacyToken();
}
