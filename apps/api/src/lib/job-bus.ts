import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export function emitJobLog(jobId: string, line: string): void {
  emitter.emit(`job:${jobId}`, line);
}

export function subscribeJobLog(
  jobId: string,
  handler: (line: string) => void,
): () => void {
  const channel = `job:${jobId}`;
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
