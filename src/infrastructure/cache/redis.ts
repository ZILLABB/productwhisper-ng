import Redis from 'ioredis';
import { dbConfig, cacheConfig } from '@/config';

let redis: Redis | null = null;
let redisAvailable = false;

const memoryCache = new Map<string, { value: string; expiresAt: number | null }>();

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(dbConfig.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keyPrefix: 'pwng:',
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });
    // Suppress noisy reconnect errors when Redis is not running
    redis.on('error', () => {});
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  try {
    const r = getRedis();
    if (r.status === 'ready') { redisAvailable = true; return; }
    await r.connect();
    redisAvailable = true;
  } catch {
    console.warn('Redis unavailable — using in-memory cache fallback');
    redisAvailable = false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis && redisAvailable) {
    try { await redis.quit(); } catch {}
  }
}

export async function healthCheckRedis(): Promise<boolean> {
  if (!redisAvailable) return false;
  try {
    return (await getRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

// ─── Cache Operations (Redis with in-memory fallback) ──

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt && entry.expiresAt < now) memoryCache.delete(key);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redisAvailable) {
      const val = await getRedis().get(key);
      return val ? JSON.parse(val) : null;
    }
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(entry.value);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (redisAvailable) {
      if (ttlSeconds) {
        await getRedis().setex(key, ttlSeconds, serialized);
      } else {
        await getRedis().set(key, serialized);
      }
    } else {
      memoryCache.set(key, {
        value: serialized,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      if (memoryCache.size > 10000) cleanExpired();
    }
  } catch {}
}

export async function cacheDel(key: string): Promise<void> {
  try {
    if (redisAvailable) {
      await getRedis().del(key);
    } else {
      memoryCache.delete(key);
    }
  } catch {}
}

export async function cacheDelPattern(pattern: string): Promise<number> {
  try {
    if (redisAvailable) {
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
    }
    let deleted = 0;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of memoryCache.keys()) {
      if (regex.test(key)) {
        memoryCache.delete(key);
        deleted++;
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

export { cacheConfig };
