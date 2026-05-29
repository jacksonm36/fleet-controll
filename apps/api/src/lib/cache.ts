import { getRedis, redisPing } from "./redis.js";

const PREFIX = "fleet:cache:";

export type CacheMeta = { hit: boolean; redis: boolean };

export async function isCacheBackendReady(): Promise<boolean> {
  return redisPing();
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis || !(await redisPing())) return null;
  try {
    const raw = await redis.get(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await redisPing())) return;
  try {
    await redis.setex(PREFIX + key, ttlSeconds, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || !keys.length || !(await redisPing())) return;
  try {
    await redis.del(...keys.map((k) => PREFIX + k));
  } catch {
    /* ignore */
  }
}

export async function cacheDelByPattern(pattern: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await redisPing())) return;
  const fullPattern = PREFIX + pattern;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        fullPattern,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* ignore */
  }
}

/** Read-through cache; runs loader on miss or when Redis is down. */
export async function cacheWrap<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<{ data: T; meta: CacheMeta }> {
  const redisOk = await isCacheBackendReady();
  if (redisOk) {
    const hit = await cacheGet<T>(key);
    if (hit !== null) {
      return { data: hit, meta: { hit: true, redis: true } };
    }
  }
  const data = await loader();
  if (redisOk) {
    void cacheSet(key, data, ttlSeconds);
  }
  return { data, meta: { hit: false, redis: redisOk } };
}

export async function invalidateFleetCaches(agentId?: string): Promise<void> {
  await cacheDel("fleet:summary", "fleet:cves");
  await cacheDel("agents:list");
  await cacheDel(
    "crowdsec:status",
    "crowdsec:alerts",
    "crowdsec:decisions",
  );
  if (agentId) {
    await cacheDel(
      `agents:${agentId}`,
      `agents:${agentId}:packages`,
      `agents:${agentId}:applications`,
      `agents:${agentId}:services`,
      `agents:${agentId}:cves`,
      `agents:${agentId}:crowdsec`,
    );
  }
}
