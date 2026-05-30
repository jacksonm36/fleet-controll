import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  prisma,
  randomRecoveryCode,
  verifyPassword,
  verifyToken,
} from "@fleet/db";
import type { Prisma, Role } from "@prisma/client";
import type { AppReply } from "../types/app-instance.js";
import type { AppInstance } from "../types/app-instance.js";
import { authenticator } from "otplib";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { storeAuthChallenge } from "../lib/auth-challenges.js";
import { validateNewPassword } from "../lib/password-policy.js";
import { clearSessionCookie, setSessionCookie } from "../lib/session.js";
import {
  webAuthnOrigin,
  webAuthnRpId,
  webAuthnRpName,
} from "../lib/webauthn-config.js";
import {
  assertAdmin,
  requireUser,
} from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

const totpCodeSchema = z.object({
  code: z.string().trim().min(6).max(16),
});

const pendingTokenBody = z.object({
  pendingToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

const RECOVERY_CODE_COUNT = 8;

function userPublicSelect() {
  return {
    id: true,
    username: true,
    email: true,
    role: true,
    disabled: true,
    totpEnabled: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { webAuthnCredentials: true } },
  } as const;
}

async function findUserByLogin(identifier: string) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { username: identifier }],
    },
  });
  if (!user || user.disabled) return null;
  return user;
}

async function audit(
  actorId: string | null,
  action: string,
  meta?: Prisma.InputJsonValue,
) {
  await prisma.auditEvent.create({
    data: { actorId, action, meta: meta ?? {} },
  });
}

async function issueSession(
  reply: AppReply,
  user: { id: string; role: Role },
) {
  const token = await reply.jwtSign(
    { sub: user.id, role: user.role, purpose: "session" },
    { expiresIn: "8h" },
  );
  setSessionCookie(reply, token);
  return token;
}

async function issueMfaPending(
  reply: AppReply,
  user: { id: string; role: Role },
) {
  return reply.jwtSign(
    { sub: user.id, role: user.role, purpose: "mfa_pending" },
    { expiresIn: "5m" },
  );
}

async function loadActiveUser(identifier: string) {
  return findUserByLogin(identifier);
}

async function generateRecoveryCodes(userId: string): Promise<string[]> {
  await prisma.userRecoveryCode.deleteMany({ where: { userId } });
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const plain = randomRecoveryCode();
    codes.push(plain);
    await prisma.userRecoveryCode.create({
      data: { userId, codeHash: await hashToken(plain) },
    });
  }
  return codes;
}

export async function authRoutes(app: AppInstance) {
  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { email, password } = parsed.data;
    const user = await findUserByLogin(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    if (user.totpEnabled) {
      const pendingToken = await issueMfaPending(reply, user);
      return {
        requiresTotp: true,
        pendingToken,
        methods: ["totp", "recovery"],
      };
    }

    const token = await issueSession(reply, user);
    await audit(user.id, "user_login");
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
    };
  });

  app.post("/login/totp", async (req, reply) => {
    const parsed = pendingTokenBody.merge(totpCodeSchema).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    let payload: { sub?: string; purpose?: string };
    try {
      payload = app.jwt.verify(parsed.data.pendingToken) as { sub?: string; purpose?: string };
    } catch {
      return reply.code(401).send({ error: "invalid_pending_token" });
    }
    if (payload.purpose !== "mfa_pending" || !payload.sub) {
      return reply.code(401).send({ error: "invalid_pending_token" });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabled || !user.totpEnabled || !user.totpSecret) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!authenticator.check(parsed.data.code, secret)) {
      return reply.code(401).send({ error: "invalid_totp" });
    }
    const token = await issueSession(reply, user);
    await audit(user.id, "user_login_totp");
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
    };
  });

  app.post("/login/recovery", async (req, reply) => {
    const parsed = pendingTokenBody
      .extend({ recoveryCode: z.string().trim().min(6).max(16) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    let payload: { sub?: string; purpose?: string };
    try {
      payload = app.jwt.verify(parsed.data.pendingToken) as { sub?: string; purpose?: string };
    } catch {
      return reply.code(401).send({ error: "invalid_pending_token" });
    }
    if (payload.purpose !== "mfa_pending" || !payload.sub) {
      return reply.code(401).send({ error: "invalid_pending_token" });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabled || !user.totpEnabled) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const codes = await prisma.userRecoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
    });
    let matchedId: string | null = null;
    for (const row of codes) {
      if (await verifyToken(parsed.data.recoveryCode.toUpperCase(), row.codeHash)) {
        matchedId = row.id;
        break;
      }
    }
    if (!matchedId) {
      return reply.code(401).send({ error: "invalid_recovery_code" });
    }
    await prisma.userRecoveryCode.update({
      where: { id: matchedId },
      data: { usedAt: new Date() },
    });
    const token = await issueSession(reply, user);
    await audit(user.id, "user_login_recovery_code");
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
    };
  });

  app.post("/login/webauthn/options", async (req, reply) => {
    const parsed = z
      .object({ email: z.string().trim().min(1).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const email = parsed.data.email?.trim();
    const user = email ? await loadActiveUser(email) : null;
    const credentials = user
      ? await prisma.webAuthnCredential.findMany({ where: { userId: user.id } })
      : [];
    if (email && credentials.length === 0) {
      return reply.code(404).send({ error: "no_passkeys" });
    }
    const options = await generateAuthenticationOptions({
      rpID: webAuthnRpId(req),
      userVerification: "preferred",
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports?.split(",") as AuthenticatorTransport[] | undefined,
      })),
    });
    const challengeId = await storeAuthChallenge({
      userId: user?.id ?? null,
      email: email ?? null,
      type: "webauthn_login",
      challenge: options.challenge,
    });
    return { options, challengeId, email: user?.email ?? null };
  });

  app.post("/login/webauthn/verify", async (req, reply) => {
    const parsed = z
      .object({
        challengeId: z.string().min(1),
        response: z.unknown(),
        email: z.string().trim().min(1).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const response = parsed.data.response as Parameters<
      typeof verifyAuthenticationResponse
    >[0]["response"];
    const credentialId = String((response as { id?: string }).id ?? "");
    const stored = await prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });
    if (!stored || stored.user.disabled) {
      return reply.code(401).send({ error: "invalid_passkey" });
    }
    if (parsed.data.email && stored.user.email !== parsed.data.email) {
      return reply.code(401).send({ error: "invalid_passkey" });
    }
    const storedChallenge = await prisma.authChallenge.findFirst({
      where: { id: parsed.data.challengeId, type: "webauthn_login", expiresAt: { gt: new Date() } },
    });
    if (!storedChallenge) {
      return reply.code(401).send({ error: "invalid_passkey" });
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: webAuthnOrigin(req),
      expectedRPID: webAuthnRpId(req),
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: Number(stored.counter),
        transports: stored.transports?.split(",") as AuthenticatorTransport[] | undefined,
      },
    });
    if (!verification.verified || !verification.authenticationInfo) {
      return reply.code(401).send({ error: "invalid_passkey" });
    }
    await prisma.authChallenge.delete({ where: { id: storedChallenge.id } });
    await prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    const token = await issueSession(reply, stored.user);
    await audit(stored.user.id, "user_login_passkey");
    return {
      token,
      user: {
        id: stored.user.id,
        email: stored.user.email,
        role: stored.user.role,
        totpEnabled: stored.user.totpEnabled,
      },
    };
  });

  app.get("/me", { preHandler: requireUser }, async (req, reply) => {
    const payload = req.user as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: userPublicSelect(),
    });
    if (!user || user.disabled) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
        passkeyCount: user._count.webAuthnCredentials,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  });

  app.patch("/profile", { preHandler: requireUser }, async (req, reply) => {
    const parsed = z
      .object({
        username: z.string().trim().min(1).max(64).optional(),
        email: z.string().trim().min(1).max(128).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user) return reply.code(404).send({ error: "not_found" });

    if (parsed.data.username && parsed.data.username !== user.username) {
      const clash = await prisma.user.findUnique({
        where: { username: parsed.data.username },
      });
      if (clash && clash.id !== user.id) {
        return reply.code(409).send({ error: "username_taken" });
      }
    }
    if (parsed.data.email && parsed.data.email !== user.email) {
      const clash = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      if (clash && clash.id !== user.id) {
        return reply.code(409).send({ error: "email_taken" });
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.username ? { username: parsed.data.username } : {}),
        ...(parsed.data.email ? { email: parsed.data.email } : {}),
      },
      select: userPublicSelect(),
    });
    await audit(user.id, "profile_updated", {
      username: parsed.data.username,
      email: parsed.data.email,
    });
    return {
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        totpEnabled: updated.totpEnabled,
        passkeyCount: updated._count.webAuthnCredentials,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    };
  });

  app.post("/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/change-password", { preHandler: requireUser }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const policyErr = validateNewPassword(parsed.data.newPassword);
    if (policyErr) {
      return reply.code(400).send({ error: "weak_password", message: policyErr });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword) },
    });
    await audit(user.id, "password_changed");
    clearSessionCookie(reply);
    return { ok: true, requiresLogin: true };
  });

  app.post("/totp/setup", { preHandler: requireUser }, async (req, reply) => {
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.totpEnabled) {
      return reply.code(409).send({ error: "totp_already_enabled" });
    }
    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret), totpEnabled: false },
    });
    const otpauthUrl = authenticator.keyuri(user.email, webAuthnRpName(), secret);
    return { secret, otpauthUrl };
  });

  app.post("/totp/enable", { preHandler: requireUser }, async (req, reply) => {
    const parsed = totpCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user?.totpSecret) {
      return reply.code(400).send({ error: "totp_not_setup" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!authenticator.check(parsed.data.code, secret)) {
      return reply.code(401).send({ error: "invalid_totp" });
    }
    const recoveryCodes = await generateRecoveryCodes(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    await audit(user.id, "totp_enabled");
    return { ok: true, recoveryCodes };
  });

  app.post("/totp/disable", { preHandler: requireUser }, async (req, reply) => {
    const parsed = changePasswordSchema
      .pick({ currentPassword: true })
      .merge(totpCodeSchema)
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user?.totpEnabled || !user.totpSecret) {
      return reply.code(400).send({ error: "totp_not_enabled" });
    }
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!authenticator.check(parsed.data.code, secret)) {
      return reply.code(401).send({ error: "invalid_totp" });
    }
    await prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    await audit(user.id, "totp_disabled");
    return { ok: true };
  });

  app.post("/totp/recovery/regenerate", { preHandler: requireUser }, async (req, reply) => {
    const parsed = changePasswordSchema
      .pick({ currentPassword: true })
      .merge(totpCodeSchema)
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user?.totpEnabled || !user.totpSecret) {
      return reply.code(400).send({ error: "totp_not_enabled" });
    }
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!authenticator.check(parsed.data.code, secret)) {
      return reply.code(401).send({ error: "invalid_totp" });
    }
    const recoveryCodes = await generateRecoveryCodes(user.id);
    await audit(user.id, "totp_recovery_regenerated");
    return { recoveryCodes };
  });

  app.post("/webauthn/register/options", { preHandler: requireUser }, async (req, reply) => {
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: actor.sub },
      include: { webAuthnCredentials: true },
    });
    if (!user) return reply.code(404).send({ error: "not_found" });
    const options = await generateRegistrationOptions({
      rpName: webAuthnRpName(),
      rpID: webAuthnRpId(req),
      userName: user.username,
      userDisplayName: user.username,
      attestationType: "none",
      excludeCredentials: user.webAuthnCredentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports?.split(",") as AuthenticatorTransport[] | undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    const challengeId = await storeAuthChallenge({
      userId: user.id,
      type: "webauthn_register",
      challenge: options.challenge,
    });
    return { options, challengeId };
  });

  app.post("/webauthn/register/verify", { preHandler: requireUser }, async (req, reply) => {
    const parsed = z
      .object({
        challengeId: z.string().min(1),
        response: z.unknown(),
        nickname: z.string().trim().max(64).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    const response = parsed.data.response as Parameters<
      typeof verifyRegistrationResponse
    >[0]["response"];
    const storedChallenge = await prisma.authChallenge.findFirst({
      where: {
        id: parsed.data.challengeId,
        userId: user.id,
        type: "webauthn_register",
        expiresAt: { gt: new Date() },
      },
    });
    if (!storedChallenge) {
      return reply.code(400).send({ error: "invalid_passkey" });
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: webAuthnOrigin(req),
      expectedRPID: webAuthnRpId(req),
    });
    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: "invalid_passkey" });
    }
    await prisma.authChallenge.delete({ where: { id: storedChallenge.id } });
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: BigInt(credential.counter),
        transports: credential.transports?.join(",") ?? null,
        nickname: parsed.data.nickname?.trim() || credentialDeviceType || "Passkey",
      },
    });
    await audit(user.id, "passkey_registered", {
      backedUp: credentialBackedUp,
      nickname: parsed.data.nickname,
    });
    return { ok: true };
  });

  app.get("/webauthn/credentials", { preHandler: requireUser }, async (req) => {
    const actor = req.user as { sub: string };
    const creds = await prisma.webAuthnCredential.findMany({
      where: { userId: actor.sub },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        nickname: true,
        createdAt: true,
        lastUsedAt: true,
        transports: true,
      },
    });
    return { credentials: creds };
  });

  app.delete<{ Params: { id: string } }>(
    "/webauthn/credentials/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const actor = req.user as { sub: string };
      const cred = await prisma.webAuthnCredential.findFirst({
        where: { id: req.params.id, userId: actor.sub },
      });
      if (!cred) return reply.code(404).send({ error: "not_found" });
      await prisma.webAuthnCredential.delete({ where: { id: cred.id } });
      await audit(actor.sub, "passkey_removed", { credentialId: cred.id });
      return { ok: true };
    },
  );
}
