import { EventEmitter } from "node:events";

import { getRedis, redisPing } from "./redis.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

const REDIS_CHANNEL = "fleet:job-log";

let redisSubReady = false;

async function ensureRedisPubSub(): Promise<void> {
  if (redisSubReady) return;
  const redis = getRedis();
  if (!redis || !(await redisPing())) return;
  try {
    const sub = redis.duplicate({ lazyConnect: true });
    if (sub.status !== "ready") await sub.connect();
    await sub.subscribe(REDIS_CHANNEL);
    sub.on("message", (_ch, payload) => {
      try {
        const { jobId, line } = JSON.parse(payload) as {
          jobId: string;
          line: string;
        };
        emitter.emit(`job:${jobId}`, line);
      } catch {
        /* ignore */
      }
    });
    redisSubReady = true;
  } catch {
    /* local-only fallback */
  }
}

void ensureRedisPubSub();

export function emitJobLog(jobId: string, line: string): void {
  emitter.emit(`job:${jobId}`, line);
  void (async () => {
    const redis = getRedis();
    if (!redis || !(await redisPing())) return;
    try {
      await redis.publish(
        REDIS_CHANNEL,
        JSON.stringify({ jobId, line }),
      );
    } catch {
      /* ignore */
    }
  })();
}

export function subscribeJobLog(
  jobId: string,
  handler: (line: string) => void,
): () => void {
  const channel = `job:${jobId}`;
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
