import Redis from "ioredis";

let client: Redis | null = null;
let connectAttempted = false;

export function resolveRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getRedis(): Redis | null {
  const url = resolveRedisUrl();
  if (!url) return null;
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    client.on("error", () => {
      /* logged via health / cache fallback */
    });
  }
  return client;
}

export async function ensureRedisConnected(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  if (redis.status === "ready") return true;
  if (connectAttempted && redis.status === "connecting") {
    await new Promise((r) => setTimeout(r, 50));
    return redis.status === "ready";
  }
  connectAttempted = true;
  try {
    await redis.connect();
    return true;
  } catch {
    return false;
  }
}

export async function redisPing(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    if (!(await ensureRedisConnected())) return false;
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
