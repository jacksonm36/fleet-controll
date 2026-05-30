import type { AppInstance } from "../types/app-instance.js";

/** Minimal WebSocket surface used by @fastify/websocket (avoids hard dependency on @types/ws in the IDE). */
type AgentWebSocket = {
  readonly OPEN: number;
  readonly CONNECTING: number;
  readyState: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  on(event: "close", listener: () => void): void;
};
import { isProduction } from "../lib/env.js";
import { resolveAgentCredential } from "../middleware/agent-auth.js";
import {
  registerAgentSocket,
  unregisterAgentSocket,
} from "../lib/agent-sockets.js";

function tokenFromRequest(
  url: string,
  authorization?: string | string[],
  log?: { warn: (obj: object, msg: string) => void },
): string | null {
  const auth = Array.isArray(authorization) ? authorization[0] : authorization;
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice("Bearer ".length).trim();
    if (t) return t;
  }
  const q = url.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  const queryToken = params.get("token");
  if (!queryToken) return null;
  if (isProduction()) {
    log?.warn({}, "websocket token in query string rejected in production");
    return null;
  }
  log?.warn({}, "websocket token via query string is deprecated; use Authorization header");
  return queryToken;
}

/** @fastify/websocket v11 passes WebSocket directly; older versions use { socket }. */
function wsSocket(conn: { socket?: AgentWebSocket } | AgentWebSocket): AgentWebSocket {
  if (
    conn &&
    typeof conn === "object" &&
    "socket" in conn &&
    conn.socket != null
  ) {
    return conn.socket;
  }
  return conn as AgentWebSocket;
}

function safeClose(sock: AgentWebSocket, code: number, reason: string) {
  try {
    if (sock.readyState === sock.OPEN || sock.readyState === sock.CONNECTING) {
      sock.close(code, reason);
    }
  } catch {
    /* ignore */
  }
}

export async function agentWsRoutes(app: AppInstance) {
  app.get(
    "/stream",
    { websocket: true },
    (conn, req) => {
      const sock = wsSocket(conn);
      const token = tokenFromRequest(
        req.url ?? "",
        req.headers.authorization,
        app.log,
      );

      if (!token) {
        safeClose(sock, 4001, "missing_token");
        return;
      }

      void (async () => {
        try {
          const cred = await resolveAgentCredential(token);
          if (!cred) {
            safeClose(sock, 4002, "invalid_token");
            return;
          }

          const agentId = cred.agentId;
          const bridge = {
            send: (data: string) => {
              if (sock.readyState === sock.OPEN) sock.send(data);
            },
            close: () => safeClose(sock, 1000, "bye"),
          };
          registerAgentSocket(agentId, bridge);

          const pingIv = setInterval(() => {
            if (sock.readyState !== sock.OPEN) return;
            try {
              sock.ping();
            } catch {
              clearInterval(pingIv);
            }
          }, 25_000);

          sock.on("close", () => {
            clearInterval(pingIv);
            unregisterAgentSocket(agentId, bridge);
          });

          if (sock.readyState === sock.OPEN) {
            sock.send(JSON.stringify({ type: "hello", agentId }));
          }
        } catch (err) {
          app.log.error({ err }, "agent websocket handler failed");
          safeClose(sock, 1011, "server_error");
        }
      })();
    },
  );
}
