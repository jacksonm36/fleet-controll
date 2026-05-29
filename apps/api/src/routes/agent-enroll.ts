import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashToken, randomAgentToken, sha256Hex } from "../lib/crypto.js";

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Hostname must use letters, numbers, dots, dashes, or underscores",
  );

const enrollSchema = z.object({
  token: z.string().min(16).max(512),
  hostname: hostnameSchema,
  osType: z.enum(["linux", "windows", "darwin"]),
  osDetail: z.string().max(512).optional(),
  version: z.string().max(64).optional(),
});

export async function agentEnrollRoutes(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { token, hostname, osType, osDetail, version } = parsed.data;
    const argonTokenHash = await hashToken(token);
    let et = await prisma.enrollmentToken.findFirst({
      where: { tokenHash: argonTokenHash, expiresAt: { gt: new Date() } },
    });
    if (!et) {
      const legacyHash = sha256Hex(token);
      et = await prisma.enrollmentToken.findFirst({
        where: { tokenHash: legacyHash, expiresAt: { gt: new Date() } },
      });
    }
    if (!et) return reply.code(400).send({ error: "invalid_or_expired_token" });

    await prisma.enrollmentToken.delete({ where: { id: et.id } });

    const plainApiToken = randomAgentToken();
    const secretHash = await hashToken(plainApiToken);

    const agent = await prisma.agent.create({
      data: {
        hostname,
        osType,
        osDetail: osDetail?.slice(0, 512) ?? null,
        version: version?.slice(0, 64) ?? null,
        enrolledAt: new Date(),
        status: "OFFLINE",
        rebootRequired: false,
        crowdsecInstalled: false,
      },
    });

    await prisma.agentCredential.create({
      data: { agentId: agent.id, secretHash },
    });

    await prisma.auditEvent.create({
      data: {
        action: "agent_enrolled",
        meta: { agentId: agent.id, hostname },
      },
    });

    return {
      agentId: agent.id,
      apiToken: plainApiToken,
    };
  });
}
