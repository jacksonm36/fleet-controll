import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomEnrollmentToken, sha256Hex } from "../lib/crypto.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

export async function enrollmentRoutes(app: FastifyInstance) {
  app.post(
    "/",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const schema = z.object({
        ttlMinutes: z.number().min(5).max(10080).optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      const ttl = parsed.data.ttlMinutes ?? 60;
      const plain = randomEnrollmentToken();
      const tokenHash = sha256Hex(plain);
      const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
      await prisma.enrollmentToken.create({
        data: {
          tokenHash,
          expiresAt,
          createdBy: (req.user as { sub: string }).sub,
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "enrollment_token_created",
          meta: { expiresAt },
        },
      });
      return { token: plain, expiresAt };
    },
  );
}
