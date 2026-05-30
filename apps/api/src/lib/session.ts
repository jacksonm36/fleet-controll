import type { AppReply } from "../types/app-instance.js";
import { fleetRequireTls, isProduction } from "./env.js";

export const SESSION_COOKIE = "fleet_session";
const SESSION_MAX_AGE_SEC = 8 * 60 * 60;

function resolveSameSite(secure: boolean): "lax" | "none" | "strict" {
  const raw = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();
  if (raw === "none" || raw === "lax" || raw === "strict") {
    return raw;
  }
  // Same-origin UI via Next/nginx proxy — Lax reduces CSRF vs cross-site None.
  if (secure && isProduction()) {
    return "lax";
  }
  return secure ? "none" : "lax";
}

/** Secure cookies when HTTPS is required or SESSION_COOKIE_SECURE is set. */
export function sessionCookieOptions() {
  const secure =
    fleetRequireTls() ||
    process.env.SESSION_COOKIE_SECURE === "1" ||
    process.env.SESSION_COOKIE_SECURE === "true";
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: resolveSameSite(secure),
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

export function setSessionCookie(reply: AppReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(reply: AppReply): void {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}
