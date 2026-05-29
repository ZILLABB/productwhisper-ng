import { NIGERIAN_CONDITION_KEYWORDS, PLATFORMS_DEFAULT_NEW, SCRAPER_USER_AGENTS } from '@/shared/constants';
import type { ApiResponse, PaginatedResponse } from '@/shared/types';

// ─── Response Helpers ───────────────────────────────────

export function successResponse<T>(data: T, opts?: { message?: string; requestId?: string; cache?: { hit: boolean; ttl?: number }; source?: string[]; confidence?: number }): ApiResponse<T> {
  return {
    success: true,
    data,
    message: opts?.message,
    timestamp: new Date().toISOString(),
    requestId: opts?.requestId,
    cache: opts?.cache,
    source: opts?.source,
    confidence: opts?.confidence,
  };
}

export function paginatedResponse<T>(data: T[], page: number, limit: number, total: number, opts?: { message?: string; requestId?: string; cache?: { hit: boolean; ttl?: number } }): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    success: true,
    data,
    message: opts?.message,
    timestamp: new Date().toISOString(),
    requestId: opts?.requestId,
    cache: opts?.cache,
    pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

// ─── Product ID Resolution ────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a UUID (vs a slug).
 */
export function isUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Build a Prisma `where` clause that works with both UUIDs and slugs.
 */
export function productWhere(id: string): { id: string } | { slug: string } {
  return isUuid(id) ? { id } : { slug: id };
}

// ─── Nigerian Product Helpers ───────────────────────────

export function classifyCondition(text: string, platform?: string): string {
  const lower = text.toLowerCase();
  // Check explicit condition keywords first (most specific wins)
  // Check USED conditions before NEW to avoid false positives
  // (e.g. "uk used" should not match "new" first)
  const orderedConditions = ['UK_USED', 'FAIRLY_USED', 'REFURBISHED', 'OPEN_BOX', 'NEW'];
  for (const condition of orderedConditions) {
    const keywords = NIGERIAN_CONDITION_KEYWORDS[condition];
    if (keywords && keywords.some(kw => lower.includes(kw))) return condition;
  }
  // If no keyword matched, default to NEW for official retail platforms
  if (platform && PLATFORMS_DEFAULT_NEW.includes(platform.toUpperCase())) {
    return 'NEW';
  }
  return 'UNKNOWN';
}

export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\b(gb|tb)\b/gi, (m) => m.toUpperCase())
    .replace(/\biphone\b/gi, 'iPhone')
    .replace(/\bsamsung\b/gi, 'Samsung')
    .replace(/\binfinix\b/gi, 'Infinix')
    .replace(/\btecno\b/gi, 'Tecno')
    .replace(/\bitel\b/gi, 'Itel')
    .replace(/\bredmi\b/gi, 'Redmi')
    .replace(/\bxiaomi\b/gi, 'Xiaomi')
    .trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function extractBrand(title: string): string | null {
  const brands = [
    'Apple', 'Samsung', 'Infinix', 'Tecno', 'Itel', 'Xiaomi', 'Redmi', 'OPPO', 'Vivo',
    'Nokia', 'Huawei', 'Google', 'OnePlus', 'Realme', 'Sony', 'LG', 'HP', 'Dell', 'Lenovo',
    'Asus', 'Acer', 'MSI', 'JBL', 'Bose', 'Oraimo', 'Anker', 'Hisense', 'Haier', 'Binatone',
  ];
  const lower = title.toLowerCase();
  return brands.find(b => lower.includes(b.toLowerCase())) ?? null;
}

// ─── Fuzzy Matching ─────────────────────────────────────

export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[b.length][a.length];
}

export function similarityScore(a: string, b: string): number {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (na === nb) return 1;
  const dist = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

export function trigramSimilarity(a: string, b: string): number {
  const trigramsOf = (s: string): Set<string> => {
    const t = new Set<string>();
    const padded = `  ${s.toLowerCase()} `;
    for (let i = 0; i < padded.length - 2; i++) t.add(padded.substring(i, i + 3));
    return t;
  };
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Scraper Helpers ────────────────────────────────────

export function randomUserAgent(): string {
  return SCRAPER_USER_AGENTS[Math.floor(Math.random() * SCRAPER_USER_AGENTS.length)];
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return delay(minMs + Math.random() * (maxMs - minMs));
}

export function retry<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 1000): Promise<T> {
  return (async () => {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) await delay(delayMs * attempt);
      }
    }
    throw lastError!;
  })();
}

// ─── Cache Helpers ──────────────────────────────────────

export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

// ─── Price Formatting ───────────────────────────────────

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function parseNairaPrice(text: string): number | null {
  const cleaned = text.replace(/[₦,\s]/g, '').replace(/naira/gi, '').replace(/^ngn/i, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
