import { beforeEach, describe, expect, it, vi } from "vitest";

const auditCreate = vi.fn();
const findFirst = vi.fn();
const verifyPasswordMock = vi.fn();

vi.mock("@fleet/db", () => ({
  prisma: {
    user: { findFirst, findUnique: vi.fn() },
    userRecoveryCode: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    webAuthnCredential: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    authChallenge: { findFirst: vi.fn(), delete: vi.fn() },
    auditEvent: { create: auditCreate },
  },
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  hashPassword: vi.fn(),
  hashToken: vi.fn(),
  randomRecoveryCode: vi.fn(),
  verifyPassword: verifyPasswordMock,
  verifyToken: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("../lib/session.js", () => ({
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

vi.mock("../lib/webauthn-config.js", () => ({
  webAuthnOrigin: vi.fn(),
  webAuthnRpId: vi.fn(),
  webAuthnRpName: vi.fn(),
}));

vi.mock("../lib/auth-challenges.js", () => ({
  storeAuthChallenge: vi.fn(),
}));

vi.mock("../lib/password-policy.js", () => ({
  validateNewPassword: vi.fn(() => null),
}));

vi.mock("../middleware/auth.js", () => ({
  requireUser: vi.fn(),
  assertAdmin: vi.fn(),
}));

const { authRoutes } = await import("./auth.js");

type Handler = (req: unknown, reply: unknown) => unknown;

function fakeReply() {
  const reply = {
    codeArg: undefined as number | undefined,
    sendArg: undefined as unknown,
    code(statusCode: number) {
      reply.codeArg = statusCode;
      return reply;
    },
    send(payload: unknown) {
      reply.sendArg = payload;
      return payload;
    },
    setCookie: vi.fn(),
    jwtSign: vi.fn(async () => "fake.jwt.token"),
  };
  return reply;
}

async function collectRoutes(): Promise<Record<string, Handler>> {
  const routes: Record<string, Handler> = {};
  const fakeApp = {
    post: (path: string, optsOrHandler: unknown, maybeHandler?: Handler) => {
      routes[path] = (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) as Handler;
    },
    get: (path: string, optsOrHandler: unknown, maybeHandler?: Handler) => {
      routes[path] = (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) as Handler;
    },
    patch: (path: string, optsOrHandler: unknown, maybeHandler?: Handler) => {
      routes[path] = (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) as Handler;
    },
    delete: (path: string, optsOrHandler: unknown, maybeHandler?: Handler) => {
      routes[path] = (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) as Handler;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await authRoutes(fakeApp as any);
  return routes;
}

beforeEach(() => {
  auditCreate.mockClear();
  findFirst.mockClear();
  verifyPasswordMock.mockClear();
});

describe("auth.ts failure-path audit logging", () => {
  it("audits a failed /login attempt with the attempted email, no actor", async () => {
    findFirst.mockResolvedValue(null); // no such user
    const routes = await collectRoutes();
    const reply = fakeReply();

    await routes["/login"]!(
      { body: { email: "nobody@example.com", password: "wrong" } },
      reply,
    );

    expect(reply.codeArg).toBe(401);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "user_login_failed",
        meta: { email: "nobody@example.com" },
      },
    });
  });

  it("audits a failed /login attempt against a real account with actorId set", async () => {
    findFirst.mockResolvedValue({
      id: "user-123",
      disabled: false,
      passwordHash: "hash",
      totpEnabled: false,
    });
    verifyPasswordMock.mockResolvedValue(false); // wrong password
    const routes = await collectRoutes();
    const reply = fakeReply();

    await routes["/login"]!(
      { body: { email: "real@example.com", password: "wrong" } },
      reply,
    );

    expect(reply.codeArg).toBe(401);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: "user-123",
        action: "user_login_failed",
        meta: { email: "real@example.com" },
      },
    });
  });

  it("does not audit a failure event on successful login", async () => {
    findFirst.mockResolvedValue({
      id: "user-456",
      disabled: false,
      passwordHash: "hash",
      totpEnabled: false,
    });
    verifyPasswordMock.mockResolvedValue(true);
    const routes = await collectRoutes();
    const reply = fakeReply();

    await routes["/login"]!(
      { body: { email: "real@example.com", password: "correct" } },
      reply,
    );

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: { actorId: "user-456", action: "user_login", meta: {} },
    });
  });
});
