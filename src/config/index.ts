import { config } from 'dotenv';
import { z } from 'zod';

config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  MASTER_API_KEY: z.string().min(1),
  SENTIMENT_API_URL: z.string().default('http://localhost:5001'),
  YOUTUBE_API_KEY: z.string().default(''),

  SCRAPE_INTERVAL_MINUTES: z.coerce.number().default(60),
  MAX_CONCURRENT_SCRAPES: z.coerce.number().default(3),
  SCRAPE_DELAY_MS: z.coerce.number().default(2000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  CACHE_TTL_SEARCH: z.coerce.number().default(300),
  CACHE_TTL_PRODUCT: z.coerce.number().default(1800),
  CACHE_TTL_PRICE: z.coerce.number().default(600),
  CACHE_TTL_SENTIMENT: z.coerce.number().default(3600),
});

type AppConfig = z.infer<typeof configSchema>;

let appConfig: AppConfig;

try {
  appConfig = configSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const missing = error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    console.error(`Invalid environment configuration:\n${missing}`);
  }
  process.exit(1);
}

export { appConfig };

export const serverConfig = {
  nodeEnv: appConfig.NODE_ENV,
  port: appConfig.PORT,
  logLevel: appConfig.LOG_LEVEL,
  apiPrefix: appConfig.API_PREFIX,
};

export const dbConfig = {
  url: appConfig.DATABASE_URL,
  redisUrl: appConfig.REDIS_URL,
};

export const authConfig = {
  masterApiKey: appConfig.MASTER_API_KEY,
};

export const scraperConfig = {
  intervalMinutes: appConfig.SCRAPE_INTERVAL_MINUTES,
  maxConcurrent: appConfig.MAX_CONCURRENT_SCRAPES,
  delayMs: appConfig.SCRAPE_DELAY_MS,
};

export const externalConfig = {
  sentimentApiUrl: appConfig.SENTIMENT_API_URL,
  youtubeApiKey: appConfig.YOUTUBE_API_KEY,
};

export const rateLimitConfig = {
  windowMs: appConfig.RATE_LIMIT_WINDOW_MS,
  maxRequests: appConfig.RATE_LIMIT_MAX_REQUESTS,
};

export const corsConfig = {
  origin: appConfig.CORS_ORIGIN,
};

export const cacheConfig = {
  search: appConfig.CACHE_TTL_SEARCH,
  product: appConfig.CACHE_TTL_PRODUCT,
  price: appConfig.CACHE_TTL_PRICE,
  sentiment: appConfig.CACHE_TTL_SENTIMENT,
};
