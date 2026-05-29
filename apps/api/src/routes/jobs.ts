import { prisma } from "@fleet/db";
import type { JobStatus, JobType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidateFleetCaches } from "../lib/cache.js";
import { notifyAgent } from "../lib/agent-sockets.js";
import {
  handlePatchExecuteJobComplete,
  handlePatchPlanJobComplete,
} from "../lib/patch-plans.js";
import { reconcileStaleJobsForAgent } from "../lib/job-reconcile.js";
import { subscribeJobLog } from "../lib/job-bus.js";
import { isServiceActionAllowed } from "../lib/service-allowlist.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

const DELETABLE_JOB_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

const createSchema = z.object({
  agentId: z.string(),
  type: z.enum([
    "PACKAGE_UPGRADE",
    "PACKAGE_PATCH_PLAN",
    "PACKAGE_REFRESH",
    "HOST_KERNEL_MAINTENANCE",
    "SERVICE_RESTART",
    "SERVICE_STOP",
    "SERVICE_START",
    "CROWDSEC_DECISION_ADD",
    "SHELL_SCRIPT",
    "ANSIBLE_PLAYBOOK",
    "ANSIBLE_ADHOC",
    "TERRAFORM_INIT",
    "TERRAFORM_PLAN",
    "TERRAFORM_APPLY",
  ]),
  payload: z.record(z.unknown()),
});

export async function jobsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: requireUser },
    async (req) => {
      const q = req.query as { agentId?: string };
      const agentId = q.agentId;
      if (agentId) {
        await reconcileStaleJobsForAgent(agentId);
      }
      const jobs = await prisma.job.findMany({
        where: agentId ? { agentId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          agent: { select: { id: true, hostname: true } },
        },
      });
      return jobs;
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
      const { agentId, type, payload } = parsed.data;
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });

      if (
        type === "SERVICE_RESTART" ||
        type === "SERVICE_STOP" ||
        type === "SERVICE_START"
      ) {
        const name = (payload as { unitOrServiceName?: string }).unitOrServiceName;
        if (!name || typeof name !== "string") {
          return reply.code(400).send({ error: "missing_service_name" });
        }
        if (!isServiceActionAllowed(name)) {
          return reply.code(400).send({ error: "service_not_allowed" });
        }
      }

      if (type === "PACKAGE_UPGRADE") {
        const patchPlanId = (payload as { patchPlanId?: string }).patchPlanId;
        if (!patchPlanId) {
          return reply.code(400).send({
            error: "use_patch_plan",
            message:
              "Direct package upgrades are disabled. Preview and approve a patch plan first.",
          });
        }
      }

      const job = await prisma.job.create({
        data: {
          agentId,
          type: type as JobType,
          payload,
          status: "QUEUED",
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "job_created",
          meta: { jobId: job.id, agentId, type },
        },
      });
      notifyAgent(agentId, { type: "pending_job", jobId: job.id });
      await invalidateFleetCaches(agentId);
      return job;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const job = await prisma.job.findUnique({
        where: { id: req.params.id },
        include: {
          logs: { orderBy: { seq: "asc" }, take: 500 },
          agent: { select: { id: true, hostname: true, osType: true } },
        },
      });
      if (!job) return reply.code(404).send({ error: "not_found" });
      return job;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/logs",
    { preHandler: requireUser },
    async (req, reply) => {
      const job = await prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) return reply.code(404).send({ error: "not_found" });

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const chunks = await prisma.jobLogChunk.findMany({
        where: { jobId: job.id },
        orderBy: { seq: "asc" },
      });
      for (const c of chunks) {
        reply.raw.write(
          `data: ${JSON.stringify({ seq: c.seq, message: c.message })}\n\n`,
        );
      }

      const unsub = subscribeJobLog(job.id, (line: string) => {
        reply.raw.write(`data: ${JSON.stringify({ message: line })}\n\n`);
      });

      req.raw.on("close", () => {
        unsub();
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/cancel",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const job = await prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (job.status !== "QUEUED" && job.status !== "RUNNING") {
        return reply.code(409).send({
          error: "not_active",
          status: job.status,
        });
      }

      const status = "CANCELLED" as JobStatus;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status,
          finishedAt: new Date(),
          errorMessage: "Cancelled by operator",
        },
      });

      if (job.type === "PACKAGE_PATCH_PLAN") {
        await handlePatchPlanJobComplete(job, status, null, "Cancelled by operator");
      } else if (job.type === "PACKAGE_UPGRADE") {
        await handlePatchExecuteJobComplete(job, status, null);
      }

      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "job_cancelled",
          meta: { jobId: job.id, agentId: job.agentId, type: job.type },
        },
      });
      notifyAgent(job.agentId, { type: "poll_commands" });
      await invalidateFleetCaches(job.agentId);
      return { ok: true, id: job.id, status };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const job = await prisma.job.findUnique({
        where: { id: req.params.id },
        select: { id: true, agentId: true, status: true, type: true },
      });
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (!DELETABLE_JOB_STATUSES.includes(job.status as (typeof DELETABLE_JOB_STATUSES)[number])) {
        return reply.code(409).send({
          error: "job_active",
          status: job.status,
          message: "Stop or wait for the job to finish before deleting it.",
        });
      }

      await prisma.job.delete({ where: { id: job.id } });
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "job_deleted",
          meta: { jobId: job.id, agentId: job.agentId, type: job.type },
        },
      });
      await invalidateFleetCaches(job.agentId);
      return { ok: true, id: job.id };
    },
  );
}
