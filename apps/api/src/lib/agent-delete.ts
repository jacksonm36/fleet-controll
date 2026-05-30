import { prisma } from "@fleet/db";
import { invalidateFleetCaches } from "./cache.js";
import { disconnectAgent } from "./agent-sockets.js";

export async function deleteFleetAgent(
  agentId: string,
  actorId?: string,
): Promise<{ hostname: string } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, hostname: true },
  });
  if (!agent) return null;

  disconnectAgent(agent.id);
  await prisma.agent.delete({ where: { id: agent.id } });
  await invalidateFleetCaches(agent.id);
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "agent_deleted",
      meta: { agentId: agent.id, hostname: agent.hostname },
    },
  });
  return { hostname: agent.hostname };
}
