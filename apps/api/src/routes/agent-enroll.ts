import { prisma } from "@fleet/db";
import type { AppInstance } from "../types/app-instance.js";
import { z } from "zod";
import { clientIpFromRequest } from "../lib/client-ip.js";
import {
  defaultFleetHostnameFromIp,
  normalizeEnrollHostname,
} from "../lib/enroll-hostname.js";
import { hashToken, randomAgentToken, sha256Hex } from "../lib/crypto.js";
import { fleetAgentMtlsIssueOnEnroll } from "../lib/env.js";
import { issueAgentClientCert } from "../lib/fleet-mtls.js";
import { invalidateFleetCaches } from "../lib/cache.js";
import { agentLabelsJson } from "../lib/agent-labels.js";

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
  /** OS / template hostname (stored as machineHostname; never used alone to pick another VM). */
  hostname: hostnameSchema,
  /** Fleet UI name — use after rename; optional on reinstall (same IP re-enrolls). */
  fleetHostname: hostnameSchema.optional(),
  osType: z.enum([
    "linux",
    "windows",
    "darwin",
    "freebsd",
    "openbsd",
    "netbsd",
  ]),
  osDetail: z.string().max(512).optional(),
  version: z.string().max(64).optional(),
});

async function findAgentByIp(enrollIp: string) {
  return prisma.agent.findFirst({
    where: {
      OR: [{ primaryIp: enrollIp }, { ipAddresses: { has: enrollIp } }],
    },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, hostname: true, primaryIp: true },
  });
}

export async function agentEnrollRoutes(app: AppInstance) {
  app.post("/", async (req, reply) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [
        ...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body")),
      ];
      return reply.code(400).send({
        error: "invalid_body",
        fields,
        hint:
          fields.includes("osDetail") || fields.includes("hostname")
            ? "Hostname must match [A-Za-z0-9][A-Za-z0-9._-]* (max 128). osDetail max 512 chars."
            : "Check token length (min 16), osType, and JSON body.",
      });
    }
    const { token, osType, osDetail, version } = parsed.data;
    const machineHostname = normalizeEnrollHostname(parsed.data.hostname);
    const explicitFleet = parsed.data.fleetHostname
      ? normalizeEnrollHostname(parsed.data.fleetHostname)
      : null;
    const enrollIp = clientIpFromRequest(req);
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

    const plainApiToken = randomAgentToken();
    const secretHash = await hashToken(plainApiToken);
    const labels = agentLabelsJson({ machineHostname });

    type Target = { id: string; hostname: string; reEnroll: boolean };
    let target: Target | null = null;
    let newFleetHostname: string | null = null;

    if (explicitFleet) {
      const row = await prisma.agent.findUnique({
        where: { hostname: explicitFleet },
        select: { id: true, hostname: true, primaryIp: true },
      });
      if (row) {
        if (
          enrollIp &&
          row.primaryIp &&
          enrollIp !== row.primaryIp
        ) {
          return reply.code(409).send({
            error: "hostname_registered_elsewhere",
            message: `Fleet name "${row.hostname}" is already used by ${row.primaryIp}. Use another name or delete the stale agent.`,
            fleetHostname: row.hostname,
          });
        }
        target = { id: row.id, hostname: row.hostname, reEnroll: true };
      } else if (enrollIp) {
        const sameIp = await findAgentByIp(enrollIp);
        if (sameIp) {
          return reply.code(409).send({
            error: "agent_ip_conflict",
            message: `This machine is already "${sameIp.hostname}" in Fleet. Re-enroll with FLEET_HOSTNAME=${sameIp.hostname}.`,
            existingHostname: sameIp.hostname,
          });
        }
        newFleetHostname = explicitFleet;
      } else {
        newFleetHostname = explicitFleet;
      }
    } else if (enrollIp) {
      const sameIp = await findAgentByIp(enrollIp);
      if (sameIp) {
        target = { id: sameIp.id, hostname: sameIp.hostname, reEnroll: true };
      } else {
        newFleetHostname = defaultFleetHostnameFromIp(machineHostname, enrollIp);
        let taken = await prisma.agent.findUnique({
          where: { hostname: newFleetHostname },
          select: { id: true },
        });
        let attempts = 0;
        while (taken && attempts < 8) {
          newFleetHostname = defaultFleetHostnameFromIp(machineHostname, enrollIp);
          taken = await prisma.agent.findUnique({
            where: { hostname: newFleetHostname },
            select: { id: true },
          });
          attempts += 1;
        }
        if (taken) {
          return reply.code(409).send({
            error: "hostname_collision",
            message: "Could not allocate a unique Fleet name; try FLEET_HOSTNAME=my-vm-name.",
          });
        }
      }
    } else {
      newFleetHostname = defaultFleetHostnameFromIp(machineHostname, null);
    }

    try {
      const agent = await prisma.$transaction(async (tx) => {
        const consumed = await tx.enrollmentToken.deleteMany({
          where: { id: et!.id },
        });
        if (consumed.count !== 1) {
          throw new Error("enrollment_token_already_used");
        }

        if (target?.reEnroll) {
          await tx.agentCredential.deleteMany({ where: { agentId: target.id } });
          const updated = await tx.agent.update({
            where: { id: target.id },
            data: {
              osType,
              osDetail: osDetail?.slice(0, 512) ?? null,
              version: version?.slice(0, 64) ?? null,
              status: "OFFLINE",
              rebootRequired: false,
              crowdsecInstalled: false,
              enrolledAt: new Date(),
              labels,
              ...(enrollIp ? { primaryIp: enrollIp } : {}),
            },
          });
          await tx.agentCredential.create({
            data: { agentId: updated.id, secretHash },
          });
          return { row: updated, reEnroll: true };
        }

        const created = await tx.agent.create({
          data: {
            hostname: newFleetHostname!,
            osType,
            osDetail: osDetail?.slice(0, 512) ?? null,
            version: version?.slice(0, 64) ?? null,
            status: "OFFLINE",
            rebootRequired: false,
            crowdsecInstalled: false,
            enrolledAt: new Date(),
            labels,
            ...(enrollIp ? { primaryIp: enrollIp } : {}),
          },
        });
        await tx.agentCredential.create({
          data: { agentId: created.id, secretHash },
        });
        return { row: created, reEnroll: false };
      });

      await invalidateFleetCaches(agent.row.id);
      await prisma.auditEvent.create({
        data: {
          action: agent.reEnroll ? "agent_re_enrolled" : "agent_enrolled",
          meta: {
            agentId: agent.row.id,
            hostname: agent.row.hostname,
            machineHostname,
            fleetHostname: explicitFleet ?? undefined,
            enrollIp: enrollIp ?? undefined,
          },
        },
      });

      const body: {
        agentId: string;
        apiToken: string;
        fleetHostname: string;
        mtlsCert?: string;
        mtlsKey?: string;
        mtlsExpiresAt?: string;
      } = {
        agentId: agent.row.id,
        apiToken: plainApiToken,
        fleetHostname: agent.row.hostname,
      };

      if (fleetAgentMtlsIssueOnEnroll()) {
        const mtls = issueAgentClientCert(agent.row.id);
        if (mtls) {
          body.mtlsCert = mtls.certPem;
          body.mtlsKey = mtls.keyPem;
          body.mtlsExpiresAt = mtls.expiresAt;
        }
      }

      return body;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "enrollment_token_already_used"
      ) {
        return reply.code(400).send({ error: "invalid_or_expired_token" });
      }
      throw err;
    }
  });
}
