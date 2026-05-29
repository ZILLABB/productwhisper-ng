import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey, formatNaira } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import { NotFoundError } from '@/shared/errors';
import type { PriceComparison, PlatformPrice, ConditionPrice, PricePoint } from '@/shared/types';

export class PriceService {
  async compareProductPrices(productId: string): Promise<{ comparison: PriceComparison; cacheHit: boolean }> {
    const ck = cacheKey(CACHE_PREFIXES.PRICE, 'compare', productId);
    const cached = await cacheGet<PriceComparison>(ck);
    if (cached) return { comparison: cached, cacheHit: true };

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        listings: {
          where: { inStock: true },
          include: { vendor: true },
          orderBy: { price: 'asc' },
        },
      },
    });

    if (!product) throw new NotFoundError('Product');

    const listings = product.listings;
    if (listings.length === 0) {
      const comparison: PriceComparison = {
        productId,
        productName: product.name,
        lowestPrice: 0,
        highestPrice: 0,
        averagePrice: 0,
        currency: 'NGN',
        platforms: [],
        conditions: [],
        lastUpdated: new Date().toISOString(),
      };
      return { comparison, cacheHit: false };
    }

    const prices = listings.map(l => Number(l.price));
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

    const platforms: PlatformPrice[] = listings.map(l => ({
      platform: l.platform,
      price: Number(l.price),
      condition: l.condition,
      url: l.url,
      vendorName: l.vendor?.name,
      inStock: l.inStock,
      lastScraped: l.lastScrapedAt.toISOString(),
    }));

    const conditionMap = new Map<string, number[]>();
    for (const l of listings) {
      const arr = conditionMap.get(l.condition) ?? [];
      arr.push(Number(l.price));
      conditionMap.set(l.condition, arr);
    }

    const conditions: ConditionPrice[] = Array.from(conditionMap.entries()).map(([condition, ps]) => ({
      condition,
      minPrice: Math.min(...ps),
      maxPrice: Math.max(...ps),
      avgPrice: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length),
      listingCount: ps.length,
    }));

    const priceHistory = await this.getPriceHistory(productId, 30);

    const comparison: PriceComparison = {
      productId,
      productName: product.name,
      lowestPrice,
      highestPrice,
      averagePrice,
      currency: 'NGN',
      platforms,
      conditions,
      priceHistory,
      lastUpdated: new Date().toISOString(),
    };

    await cacheSet(ck, comparison, cacheConfig.price);
    return { comparison, cacheHit: false };
  }

  async getPriceHistory(productId: string, days = 30): Promise<PricePoint[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const history = await prisma.priceHistory.findMany({
      where: { productId, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
    });

    return history.map(h => ({
      date: h.recordedAt.toISOString().split('T')[0],
      price: Number(h.price),
      platform: h.platform,
    }));
  }

  async recordPriceSnapshot(productId: string, platform: string, price: number, condition: string): Promise<void> {
    await prisma.priceHistory.create({
      data: {
        productId,
        platform: platform as any,
        price,
        condition: condition as any,
      },
    });
  }

  async getDeals(limit = 20): Promise<unknown[]> {
    const ck = cacheKey(CACHE_PREFIXES.PRICE, 'deals', limit);
    const cached = await cacheGet<unknown[]>(ck);
    if (cached) return cached;

    // Find products with significant price drops
    const recentHistory = await prisma.$queryRaw<Array<{
      product_id: string;
      platform: string;
      current_price: number;
      previous_price: number;
      drop_percent: number;
    }>>`
      WITH recent_prices AS (
        SELECT
          product_id,
          platform,
          price AS current_price,
          LAG(price) OVER (PARTITION BY product_id, platform ORDER BY recorded_at) AS previous_price,
          recorded_at
        FROM price_history
        WHERE recorded_at > NOW() - INTERVAL '7 days'
      )
      SELECT
        product_id,
        platform,
        current_price::float,
        previous_price::float,
        ((previous_price - current_price) / previous_price * 100)::float AS drop_percent
      FROM recent_prices
      WHERE previous_price IS NOT NULL AND previous_price > current_price
      ORDER BY drop_percent DESC
      LIMIT ${limit}
    `;

    const deals = [];
    for (const row of recentHistory) {
      const product = await prisma.product.findUnique({
        where: { id: row.product_id },
        select: { id: true, name: true, slug: true, imageUrl: true },
      });
      if (product) {
        deals.push({
          ...product,
          platform: row.platform,
          currentPrice: row.current_price,
          previousPrice: row.previous_price,
          dropPercent: Math.round(row.drop_percent * 10) / 10,
        });
      }
    }

    await cacheSet(ck, deals, cacheConfig.price);
    return deals;
  }
}
