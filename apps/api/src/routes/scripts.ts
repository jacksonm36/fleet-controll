import { prisma } from "@fleet/db";
import type { AutomationTool, JobType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  AUTOMATION_JOB_TYPES,
  buildPayloadFromScript,
  toolToDefaultJobType,
} from "../lib/automation.js";
import { invalidateFleetCaches } from "../lib/cache.js";
import { notifyAgent } from "../lib/agent-sockets.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

const toolEnum = z.enum([
  "shell",
  "ansible",
  "terraform",
  "opentofu",
  "puppet",
  "chef",
  "custom",
]);

const createScriptSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  tool: toolEnum,
  content: z.string().min(1).max(512_000),
  defaultPayload: z.record(z.unknown()).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
});

const runScriptSchema = z.object({
  agentId: z.string(),
  jobType: z.enum([...AUTOMATION_JOB_TYPES] as [string, ...string[]]).optional(),
  payload: z.record(z.unknown()).optional(),
});

export async function scriptsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireUser }, async () => {
    return prisma.automationScript.findMany({
      orderBy: { updatedAt: "desc" },
    });
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const script = await prisma.automationScript.findUnique({
        where: { id: req.params.id },
      });
      if (!script) return reply.code(404).send({ error: "not_found" });
      return script;
    },
  );

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    if (!assertOperator(req, reply)) return;
    const parsed = createScriptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const script = await prisma.automationScript.create({
      data: {
        ...parsed.data,
        tags: parsed.data.tags ?? [],
        createdBy: (req.user as { sub: string }).sub,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: (req.user as { sub: string }).sub,
        action: "script_created",
        meta: { scriptId: script.id, name: script.name, tool: script.tool },
      },
    });
    return script;
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const parsed = createScriptSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const existing = await prisma.automationScript.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const script = await prisma.automationScript.update({
        where: { id: req.params.id },
        data: parsed.data,
      });
      return script;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const existing = await prisma.automationScript.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await prisma.automationScript.delete({ where: { id: req.params.id } });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/run",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const parsed = runScriptSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const script = await prisma.automationScript.findUnique({
        where: { id: req.params.id },
      });
      if (!script) return reply.code(404).send({ error: "not_found" });

      const agent = await prisma.agent.findUnique({
        where: { id: parsed.data.agentId },
      });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });

      const jobType = (parsed.data.jobType ??
        toolToDefaultJobType(script.tool as AutomationTool)) as JobType;

      const payload = buildPayloadFromScript(
        script.tool as AutomationTool,
        script.content,
        script.defaultPayload as Record<string, unknown> | null,
        parsed.data.payload,
        jobType,
      );

      const job = await prisma.job.create({
        data: {
          agentId: agent.id,
          type: jobType,
          payload,
          status: "QUEUED",
        },
      });

      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "script_run",
          meta: {
            scriptId: script.id,
            scriptName: script.name,
            jobId: job.id,
            agentId: agent.id,
            jobType,
          },
        },
      });

      notifyAgent(agent.id, { type: "pending_job", jobId: job.id });
      await invalidateFleetCaches(agent.id);

      return { job, script: { id: script.id, name: script.name, tool: script.tool } };
    },
  );

  /** Queue a one-off automation job without saving to the library. */
  app.post("/run", { preHandler: requireUser }, async (req, reply) => {
    if (!assertOperator(req, reply)) return;
    const schema = z.object({
      agentId: z.string(),
      type: z.enum([...AUTOMATION_JOB_TYPES] as [string, ...string[]]),
      payload: z.record(z.unknown()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const agent = await prisma.agent.findUnique({
      where: { id: parsed.data.agentId },
    });
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const job = await prisma.job.create({
      data: {
        agentId: agent.id,
        type: parsed.data.type as JobType,
        payload: parsed.data.payload,
        status: "QUEUED",
      },
    });

    notifyAgent(agent.id, { type: "pending_job", jobId: job.id });
    await invalidateFleetCaches(agent.id);
    return job;
  });
}
