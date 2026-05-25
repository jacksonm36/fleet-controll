import type { FastifyInstance } from "fastify";
import { prisma } from "@fleet/db";
import { sha256Hex } from "../lib/crypto.js";
import {
  registerAgentSocket,
  unregisterAgentSocket,
} from "../lib/agent-sockets.js";

function tokenFromUrl(url: string): string | null {
  const q = url.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  return params.get("token");
}

export async function agentWsRoutes(app: FastifyInstance) {
  app.get(
    "/stream",
    { websocket: true },
    (conn, req) => {
      const token = tokenFromUrl(req.url ?? "");

      if (!token) {
        conn.socket.close(4001, "missing_token");
        return;
      }

      void (async () => {
        const secretHash = sha256Hex(token);
        const cred = await prisma.agentCredential.findFirst({
          where: { secretHash },
        });
        if (!cred) {
          conn.socket.close(4002, "invalid_token");
          return;
        }

        const agentId = cred.agentId;
        const socket = {
          send: (data: string) => conn.socket.send(data),
          close: () => conn.socket.close(),
        };
        registerAgentSocket(agentId, socket);

        conn.socket.on("close", () => {
          unregisterAgentSocket(agentId, socket);
        });

        conn.socket.send(JSON.stringify({ type: "hello", agentId }));
      })();
    },
  );
}
