import { prisma } from "@fleet/db";
import type { JobType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidateFleetCaches } from "../lib/cache.js";
import { notifyAgent } from "../lib/agent-sockets.js";
import { parsePlanPackages } from "../lib/patch-plans.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

const createSchema = z.object({
  agentId: z.string(),
  manager: z.enum(["apt", "dpkg", "dnf", "yum"]).default("apt"),
  securityOnly: z.boolean().optional().default(false),
});

const approveSchema = z.object({
  packageNames: z.array(z.string()).optional(),
});

export async function patchPlansRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: requireUser },
    async (req) => {
      const q = req.query as { agentId?: string };
      const plans = await prisma.patchPlan.findMany({
        where: q.agentId ? { agentId: q.agentId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          agent: { select: { id: true, hostname: true } },
        },
      });
      return plans;
    },
  );

  app.get(
    "/runs",
    { preHandler: requireUser },
    async (req) => {
      const q = req.query as { agentId?: string };
      const runs = await prisma.patchRun.findMany({
        where: q.agentId ? { agentId: q.agentId } : undefined,
        orderBy: { startedAt: "desc" },
        take: 200,
        include: {
          agent: { select: { id: true, hostname: true } },
          patchPlan: { select: { id: true, approvedById: true } },
        },
      });
      return runs;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const plan = await prisma.patchPlan.findUnique({
        where: { id: req.params.id },
        include: {
          agent: { select: { id: true, hostname: true, osType: true } },
          dryRunJob: {
            include: { logs: { orderBy: { seq: "asc" }, take: 500 } },
          },
          executeJob: {
            include: { logs: { orderBy: { seq: "asc" }, take: 500 } },
          },
        },
      });
      if (!plan) return reply.code(404).send({ error: "not_found" });
      return plan;
    },
  );

  app.post(
    "/",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }
      const { agentId, manager, securityOnly } = parsed.data;
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });

      const inFlight = await prisma.patchPlan.findFirst({
        where: {
          agentId,
          status: { in: ["PENDING_DRY_RUN", "APPROVED"] },
        },
        select: { id: true, status: true },
      });
      if (inFlight) {
        return reply.code(409).send({
          error: "patch_in_progress",
          planId: inFlight.id,
          status: inFlight.status,
        });
      }

      const dryRunJob = await prisma.job.create({
        data: {
          agentId,
          type: "PACKAGE_PATCH_PLAN" as JobType,
          payload: { manager, securityOnly },
          status: "QUEUED",
        },
      });

      const plan = await prisma.patchPlan.create({
        data: {
          agentId,
          manager,
          securityOnly,
          status: "PENDING_DRY_RUN",
          dryRunJobId: dryRunJob.id,
        },
      });

      const actorId = (req.user as { sub: string }).sub;
      await prisma.auditEvent.create({
        data: {
          actorId,
          action: "patch_plan_created",
          meta: { patchPlanId: plan.id, agentId, dryRunJobId: dryRunJob.id },
        },
      });

      notifyAgent(agentId, { type: "poll_commands" });
      await invalidateFleetCaches(agentId);
      return { ...plan, dryRunJob };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/approve",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const parsed = approveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const plan = await prisma.patchPlan.findUnique({
        where: { id: req.params.id },
      });
      if (!plan) return reply.code(404).send({ error: "not_found" });
      if (plan.status !== "READY") {
        return reply.code(409).send({ error: "plan_not_ready", status: plan.status });
      }

      const stored = parsePlanPackages(plan.packages);
      let packageNames = parsed.data.packageNames;
      if (!packageNames?.length) {
        packageNames = stored.map((p) => p.name);
      }
      if (!packageNames.length) {
        return reply.code(400).send({ error: "empty_plan" });
      }

      const allowed = new Set(stored.map((p) => p.name));
      const invalid = packageNames.filter((name) => !allowed.has(name));
      if (invalid.length) {
        return reply.code(400).send({
          error: "invalid_packages",
          packages: invalid.slice(0, 20),
        });
      }

      const actorId = (req.user as { sub: string }).sub;
      const selectedPackages = stored.filter((p) => packageNames.includes(p.name));
      const pkgRecords = await prisma.packageRecord.findMany({
        where: { agentId: plan.agentId, name: { in: packageNames } },
        select: { name: true, availableVersion: true },
      });
      const availableByName = new Map(
        pkgRecords.map((r) => [r.name, r.availableVersion?.trim() || ""]),
      );
      const executeJob = await prisma.job.create({
        data: {
          agentId: plan.agentId,
          type: "PACKAGE_UPGRADE",
          payload: {
            manager: plan.manager,
            securityOnly: plan.securityOnly,
            packageNames,
            packages: selectedPackages.map((p) => ({
              name: p.name,
              targetVersion:
                availableByName.get(p.name) ||
                (plan.planSource === "cve-hints" ? null : p.targetVersion ?? null),
            })),
            planSource: plan.planSource,
            patchPlanId: plan.id,
          },
          status: "QUEUED",
        },
      });

      const claimed = await prisma.patchPlan.updateMany({
        where: { id: plan.id, status: "READY", executeJobId: null },
        data: {
          status: "APPROVED",
          approvedById: actorId,
          approvedAt: new Date(),
          executeJobId: executeJob.id,
        },
      });
      if (claimed.count === 0) {
        await prisma.job.update({
          where: { id: executeJob.id },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            errorMessage: "Patch plan was no longer ready for approval",
          },
        });
        return reply.code(409).send({ error: "plan_not_ready" });
      }

      const updated = await prisma.patchPlan.findUnique({
        where: { id: plan.id },
      });
      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }

      await prisma.auditEvent.create({
        data: {
          actorId,
          action: "patch_plan_approved",
          meta: {
            patchPlanId: plan.id,
            executeJobId: executeJob.id,
            packageCount: packageNames.length,
          },
        },
      });

      notifyAgent(plan.agentId, { type: "poll_commands" });
      await invalidateFleetCaches(plan.agentId);
      return { plan: updated, executeJob };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/reject",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const plan = await prisma.patchPlan.findUnique({
        where: { id: req.params.id },
      });
      if (!plan) return reply.code(404).send({ error: "not_found" });
      if (plan.status !== "READY" && plan.status !== "PENDING_DRY_RUN" && plan.status !== "NO_UPDATES") {
        return reply.code(409).send({ error: "cannot_reject", status: plan.status });
      }

      const actorId = (req.user as { sub: string }).sub;

      if (plan.dryRunJobId && plan.status === "PENDING_DRY_RUN") {
        await prisma.job.updateMany({
          where: {
            id: plan.dryRunJobId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            errorMessage: "Patch plan rejected by operator",
          },
        });
      }

      const updated = await prisma.patchPlan.update({
        where: { id: plan.id },
        data: { status: "REJECTED" },
      });

      await prisma.auditEvent.create({
        data: {
          actorId,
          action: "patch_plan_rejected",
          meta: { patchPlanId: plan.id },
        },
      });

      await invalidateFleetCaches(plan.agentId);
      return updated;
    },
  );
}
