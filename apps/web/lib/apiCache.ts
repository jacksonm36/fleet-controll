type Entry<T> = { data: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export function cacheKey(path: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  return `${method}:${path}`;
}

export function readCache<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.data as T;
}

export function writeCache<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCachePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.includes(prefix)) store.delete(key);
  }
}

export function clearApiCache(): void {
  store.clear();
}
