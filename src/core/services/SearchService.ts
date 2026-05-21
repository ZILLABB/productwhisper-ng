import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey, normalizeProductName } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import type { PaginationParams } from '@/shared/types';

export class SearchService {
  async search(query: string, filters: Record<string, unknown>, pagination: PaginationParams, sortBy?: string) {
    const normalized = normalizeProductName(query);
    const startTime = Date.now();

    const ck = cacheKey(CACHE_PREFIXES.SEARCH, normalized, JSON.stringify(filters), pagination.page, pagination.limit);
    const cached = await cacheGet<{ products: unknown[]; total: number }>(ck);

    if (cached) {
      const responseTimeMs = Date.now() - startTime;
      await this.trackSearch(query, normalized, cached.total, responseTimeMs, true);
      return { ...cached, cacheHit: true, responseTimeMs };
    }

    const where: Record<string, unknown> = {
      isActive: true,
      OR: [
        { name: { contains: normalized, mode: 'insensitive' } },
        { brand: { contains: normalized, mode: 'insensitive' } },
        { category: { contains: normalized, mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: normalized, mode: 'insensitive' } } } },
      ],
    };

    if (filters.category) where.category = { contains: filters.category, mode: 'insensitive' };
    if (filters.brand) where.brand = { contains: filters.brand, mode: 'insensitive' };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: where as any,
        include: {
          listings: { take: 3, orderBy: { price: 'asc' } },
          sentimentAnalyses: { take: 1, orderBy: { analyzedAt: 'desc' } },
          trustScores: { take: 1, orderBy: { computedAt: 'desc' } },
          _count: { select: { listings: true, sentimentAnalyses: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.product.count({ where: where as any }),
    ]);

    const result = { products, total };
    const responseTimeMs = Date.now() - startTime;
    await cacheSet(ck, result, cacheConfig.search);
    await this.trackSearch(query, normalized, total, responseTimeMs, false);

    return { ...result, cacheHit: false, responseTimeMs };
  }

  async getSuggestions(query: string, limit = 10): Promise<string[]> {
    const normalized = normalizeProductName(query);

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: normalized, mode: 'insensitive' } },
          { brand: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      select: { name: true },
      take: limit,
    });

    return products.map(p => p.name);
  }

  async getTrendingSearches(limit = 10): Promise<{ query: string; count: number }[]> {
    const ck = cacheKey(CACHE_PREFIXES.SEARCH, 'trending', limit);
    const cached = await cacheGet<{ query: string; count: number }[]>(ck);
    if (cached) return cached;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await prisma.searchAnalytics.groupBy({
      by: ['normalizedQuery'],
      _count: { normalizedQuery: true },
      where: { createdAt: { gte: since } },
      orderBy: { _count: { normalizedQuery: 'desc' } },
      take: limit,
    });

    const trending = result.map(r => ({
      query: r.normalizedQuery,
      count: r._count.normalizedQuery,
    }));

    await cacheSet(ck, trending, cacheConfig.search);
    return trending;
  }

  private async trackSearch(query: string, normalizedQuery: string, resultsCount: number, responseTimeMs: number, cacheHit: boolean): Promise<void> {
    try {
      await prisma.searchAnalytics.create({
        data: { query, normalizedQuery, resultsCount, responseTimeMs, cacheHit },
      });
    } catch {
      // tracking failures are non-fatal
    }
  }
}
