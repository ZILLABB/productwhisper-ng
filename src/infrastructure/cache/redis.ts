import Redis from 'ioredis';
import { dbConfig, serverConfig, cacheConfig } from '@/config';

let redis: Redis;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(dbConfig.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keyPrefix: 'pwng:',
    });
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  const r = getRedis();
  if (r.status === 'ready') return;
  await r.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redis) await redis.quit();
}

export async function healthCheckRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}

// ─── Cache Operations ───────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await getRedis().get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await getRedis().setex(key, ttlSeconds, serialized);
    } else {
      await getRedis().set(key, serialized);
    }
  } catch {
    // cache write failures are non-fatal
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch {
    // ignore
  }
}

export async function cacheDelPattern(pattern: string): Promise<number> {
  try {
    const r = getRedis();
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', `pwng:${pattern}`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        const stripped = keys.map(k => k.replace(/^pwng:/, ''));
        deleted += await r.del(...stripped);
      }
    } while (cursor !== '0');
    return deleted;
  } catch {
    return 0;
  }
}

export { cacheConfig };
