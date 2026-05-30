import {
  hashPassword,
  prisma,
} from "@fleet/db";
import type { Role } from "@prisma/client";
import type { AppInstance } from "../types/app-instance.js";
import { z } from "zod";
import { validateNewPassword } from "../lib/password-policy.js";
import {
  assertAdmin,
  requireUser,
} from "../middleware/auth.js";

function defaultUsernameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() || email.trim();
  return local.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "user";
}

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  email: z.string().trim().min(1).max(128),
  password: z.string().min(1),
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).default("OPERATOR"),
});

const updateUserSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  email: z.string().trim().min(1).max(128).optional(),
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(1).optional(),
});

async function audit(
  actorId: string,
  action: string,
  meta?: import("@prisma/client").Prisma.InputJsonValue,
) {
  await prisma.auditEvent.create({
    data: { actorId, action, meta: meta ?? {} },
  });
}

async function adminCount(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", disabled: false } });
}

export async function usersRoutes(app: AppInstance) {
  app.get("/", { preHandler: requireUser }, async (req, reply) => {
    if (!assertAdmin(req, reply)) return;
    const users = await prisma.user.findMany({
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        disabled: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { webAuthnCredentials: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      disabled: u.disabled,
      totpEnabled: u.totpEnabled,
      passkeyCount: u._count.webAuthnCredentials,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  });

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    if (!assertAdmin(req, reply)) return;
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const policyErr = validateNewPassword(parsed.data.password);
    if (policyErr) {
      return reply.code(400).send({ error: "weak_password", message: policyErr });
    }
    const username = parsed.data.username?.trim() || defaultUsernameFromEmail(parsed.data.email);
    const existingEmail = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existingEmail) {
      return reply.code(409).send({ error: "email_taken" });
    }
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return reply.code(409).send({ error: "username_taken" });
    }
    const actor = req.user as { sub: string };
    const user = await prisma.user.create({
      data: {
        username,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        role: parsed.data.role as Role,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        disabled: true,
        createdAt: true,
      },
    });
    await audit(actor.sub, "user_created", {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
    return user;
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertAdmin(req, reply)) return;
      const parsed = updateUserSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) return reply.code(404).send({ error: "not_found" });

      if (parsed.data.password) {
        const policyErr = validateNewPassword(parsed.data.password);
        if (policyErr) {
          return reply.code(400).send({ error: "weak_password", message: policyErr });
        }
      }

      if (
        target.role === "ADMIN" &&
        parsed.data.role &&
        parsed.data.role !== "ADMIN"
      ) {
        const admins = await adminCount();
        if (admins <= 1) {
          return reply.code(409).send({ error: "last_admin" });
        }
      }
      if (target.role === "ADMIN" && parsed.data.disabled === true) {
        const admins = await adminCount();
        if (admins <= 1) {
          return reply.code(409).send({ error: "last_admin" });
        }
      }

      if (parsed.data.username && parsed.data.username !== target.username) {
        const clash = await prisma.user.findUnique({
          where: { username: parsed.data.username },
        });
        if (clash) {
          return reply.code(409).send({ error: "username_taken" });
        }
      }

      if (parsed.data.email && parsed.data.email !== target.email) {
        const clash = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (clash) {
          return reply.code(409).send({ error: "email_taken" });
        }
      }

      const actor = req.user as { sub: string };
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: {
          ...(parsed.data.username ? { username: parsed.data.username } : {}),
          ...(parsed.data.email ? { email: parsed.data.email } : {}),
          ...(parsed.data.role ? { role: parsed.data.role as Role } : {}),
          ...(parsed.data.disabled !== undefined ? { disabled: parsed.data.disabled } : {}),
          ...(parsed.data.password
            ? { passwordHash: await hashPassword(parsed.data.password) }
            : {}),
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          disabled: true,
          totpEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await audit(actor.sub, "user_updated", {
        userId: updated.id,
        changes: parsed.data,
      });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertAdmin(req, reply)) return;
      const actor = req.user as { sub: string };
      if (req.params.id === actor.sub) {
        return reply.code(409).send({ error: "cannot_delete_self" });
      }
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) return reply.code(404).send({ error: "not_found" });
      if (target.role === "ADMIN") {
        const admins = await adminCount();
        if (admins <= 1) {
          return reply.code(409).send({ error: "last_admin" });
        }
      }
      await prisma.user.delete({ where: { id: target.id } });
      await audit(actor.sub, "user_deleted", {
        userId: target.id,
        username: target.username,
        email: target.email,
      });
      return { ok: true };
    },
  );
}
