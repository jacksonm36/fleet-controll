type AgentSocket = {
  send: (data: string) => void;
  close?: () => void;
};

const sockets = new Map<string, AgentSocket>();

export function registerAgentSocket(agentId: string, socket: AgentSocket): void {
  const existing = sockets.get(agentId);
  existing?.close?.();
  sockets.set(agentId, socket);
}

export function unregisterAgentSocket(agentId: string, socket: AgentSocket): void {
  if (sockets.get(agentId) === socket) sockets.delete(agentId);
}

export function disconnectAgent(agentId: string): void {
  const s = sockets.get(agentId);
  s?.close?.();
  sockets.delete(agentId);
}

export function notifyAgent(agentId: string, payload: unknown): void {
  const s = sockets.get(agentId);
  if (s) {
    try {
      s.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }
}
