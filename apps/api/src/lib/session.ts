import type { FastifyReply } from "fastify";
import { fleetRequireTls } from "./env.js";

export const SESSION_COOKIE = "fleet_session";
const SESSION_MAX_AGE_SEC = 8 * 60 * 60;

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
    sameSite: (secure ? "none" : "lax") as "lax" | "none",
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}
