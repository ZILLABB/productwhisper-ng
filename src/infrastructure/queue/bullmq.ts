import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { dbConfig } from '@/config';
import { QUEUE_NAMES } from '@/shared/constants';

let connection: { host: string; port: number };
try {
  const url = new URL(dbConfig.redisUrl);
  connection = { host: url.hostname || 'localhost', port: parseInt(url.port || '6379') };
} catch {
  connection = { host: 'localhost', port: 6379 };
}

// ─── Queues ─────────────────────────────────────────────

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    }));
  }
  return queues.get(name)!;
}

// ─── Add Jobs ───────────────────────────────────────────

export async function addScrapingJob(platform: string, payload: Record<string, unknown>): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.SCRAPING);
  return queue.add(`scrape:${platform}`, { platform, ...payload }, {
    priority: 1,
  });
}

export async function addSentimentJob(productId: string, reviewIds: string[]): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.SENTIMENT);
  return queue.add('analyze', { productId, reviewIds });
}

export async function addPriceUpdateJob(productId: string): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.PRICE_UPDATE);
  return queue.add('update-price', { productId });
}

export async function addTrustComputeJob(entityId: string, entityType: 'product' | 'vendor'): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.TRUST_COMPUTE);
  return queue.add('compute-trust', { entityId, entityType });
}

// ─── Scheduler ──────────────────────────────────────────

export async function scheduleRecurringJobs(intervalMinutes: number): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.SCRAPING);

  const platforms = ['JUMIA', 'KONGA', 'JIJI', 'NAIRALAND'];
  for (const platform of platforms) {
    await queue.add(
      `recurring:${platform}`,
      { platform, type: 'full_scrape' },
      {
        repeat: { every: intervalMinutes * 60 * 1000 },
        jobId: `recurring-${platform}`,
      }
    );
  }
}

// ─── Create Worker ──────────────────────────────────────

export function createWorker(
  queueName: string,
  processor: (job: Job) => Promise<unknown>,
  concurrency = 3
): Worker {
  return new Worker(queueName, processor, {
    connection,
    concurrency,
    limiter: { max: 5, duration: 10000 },
  });
}

// ─── Cleanup ────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  for (const q of queues.values()) {
    await q.close();
  }
  queues.clear();
}
