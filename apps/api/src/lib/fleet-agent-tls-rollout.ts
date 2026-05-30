import { prisma } from "@fleet/db";
import type { Prisma } from "@prisma/client";
import { isAgentOnline } from "./agent-presence.js";
import { notifyAgent } from "./agent-sockets.js";
import { invalidateFleetCaches } from "./cache.js";

export function tlsFixScriptForAgent(centralUrl: string): string {
  const central = centralUrl.replace(/\/$/, "");
  return `#!/bin/bash
set -uo pipefail
CENTRAL="${central}"
ENV=""
for f in /root/.config/fleet-agent/env "$HOME/.config/fleet-agent/env"; do
  [[ -f "$f" ]] && ENV="$f" && break
done
if [[ -n "$ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV"
  set +a
fi
CURL=(curl -fsSL)
if [[ -n "\${FLEET_CA_FILE:-}" && -f "\${FLEET_CA_FILE}" ]]; then
  CURL+=(--cacert "\${FLEET_CA_FILE}")
else
  CURL=(-kfsSL)
fi
export FLEET_DEFER_AGENT_RESTART=1
"\${CURL[@]}" "\${CENTRAL}/api/public/fix-agent-connection.sh" | bash
rc=$?
(
  sleep 3
  if declare -F fleet_agent_restart_service >/dev/null 2>&1; then
    fleet_agent_restart_service || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart fleet-agent.service 2>/dev/null \\
      || systemctl --user restart fleet-agent.service 2>/dev/null \\
      || true
  fi
) &
exit $rc
`;
}

export async function queueTlsRolloutJobs(centralUrl: string): Promise<{
  queued: number;
  skippedOffline: number;
  jobIds: string[];
}> {
  const now = Date.now();
  const agents = await prisma.agent.findMany({
    select: { id: true, lastSeenAt: true, status: true, hostname: true },
  });
  const script = tlsFixScriptForAgent(centralUrl);
  const payload = {
    script,
    cwd: "/tmp",
    timeoutSec: 600,
    interpreter: "/bin/bash",
  } satisfies Prisma.InputJsonValue;

  const jobIds: string[] = [];
  let skippedOffline = 0;

  for (const agent of agents) {
    if (!isAgentOnline(agent.lastSeenAt, agent.status, now)) {
      skippedOffline++;
      continue;
    }
    const job = await prisma.job.create({
      data: {
        agentId: agent.id,
        type: "SHELL_SCRIPT",
        status: "QUEUED",
        payload,
      },
    });
    jobIds.push(job.id);
    notifyAgent(agent.id, { type: "poll_commands", jobId: job.id });
    await invalidateFleetCaches(agent.id);
    await prisma.auditEvent.create({
      data: {
        action: "fleet_tls_rollout_job",
        meta: { agentId: agent.id, hostname: agent.hostname, jobId: job.id },
      },
    });
  }

  return {
    queued: jobIds.length,
    skippedOffline,
    jobIds,
  };
}

export async function listOnlineAgentsForRollout() {
  const now = Date.now();
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      hostname: true,
      lastSeenAt: true,
      status: true,
      primaryIp: true,
    },
  });
  return agents.filter((a) => isAgentOnline(a.lastSeenAt, a.status, now));
}
