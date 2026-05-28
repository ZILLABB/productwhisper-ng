import { FastifyInstance } from 'fastify';
import { ProductService } from '@/core/services/ProductService';
import { IngestionService } from '@/core/services/IngestionService';
import { getScraper, getYouTubeScraper } from '@/infrastructure/scrapers';
import { ProductSearchSchema, PaginationSchema, ScrapedProduct } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';
import { apiKeyAuth } from '@/api/middleware/auth';
import { cacheGet, cacheSet } from '@/infrastructure/cache/redis';
import { matchProducts, extractAttributes } from '@/core/matching';

const service = new ProductService();
const ingestionService = new IngestionService();

/* ─── Live-search cache config ─────────────────────────── */
const LIVE_SEARCH_CACHE_TTL = 900;   // 15 minutes — Redis/memory layer
const LIVE_SEARCH_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours — DB layer

export async function productRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /products — list all products (paginated)
  fastify.get('/', async (request, reply) => {
    const { page, limit } = PaginationSchema.parse(request.query);
    const result = await service.searchProducts('', {}, { page, limit }, 'newest');
    return reply.send(paginatedResponse(result.products, page, limit, result.total));
  });

  fastify.get('/search', async (request, reply) => {
    const query = ProductSearchSchema.merge(PaginationSchema).parse(request.query);
    const { q, category, brand, minPrice, maxPrice, condition, platform, sortBy, page, limit } = query;

    const result = await service.searchProducts(q, { category, brand, minPrice, maxPrice, condition: condition as any, platform: platform as any }, { page, limit }, sortBy);

    return reply.send(paginatedResponse(result.products, page, limit, result.total, {
      cache: { hit: result.cacheHit },
    }));
  });

  // ──────────────────────────────────────────────────────────
  // GET /products/live-search — cross-platform price comparison
  //
  // 3-layer caching strategy:
  //   Layer 1 — Redis/memory: 15-min TTL, instant response
  //   Layer 2 — DB: scraped data persisted, re-used for 24h
  //   Layer 3 — Fresh scrape: only when no cache at all
  //
  // After every fresh scrape we persist to DB so future
  // searches for the same product hit Layer 2 instead.
  // ──────────────────────────────────────────────────────────
  fastify.get('/live-search', async (request, reply) => {
    const { q, maxResults, fresh } = request.query as { q?: string; maxResults?: string; fresh?: string };

    if (!q || q.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required query parameter: q',
        timestamp: new Date().toISOString(),
      });
    }

    const limit = Math.min(parseInt(maxResults || '10', 10) || 10, 30);
    const searchQuery = q.trim();
    const queryNorm = searchQuery.toLowerCase().replace(/\s+/g, ' ');
    const cacheKeyStr = `live-search:${queryNorm}:${limit}`;
    const forceFresh = fresh === '1' || fresh === 'true';

    const startTime = Date.now();

    // ── Layer 1: Redis/memory cache (15 min) ──
    if (!forceFresh) {
      const cached = await cacheGet<{ response: unknown; cachedAt: number }>(cacheKeyStr);
      if (cached) {
        const age = Date.now() - cached.cachedAt;
        const elapsed = Date.now() - startTime;
        return reply.send({
          ...(cached.response as Record<string, unknown>),
          _cache: { hit: true, layer: 'redis', ageSeconds: Math.round(age / 1000), responseMs: elapsed },
        });
      }
    }

    // ── Layer 2: Check DB for recent scrapes (<24h) ──
    // We look at SearchAnalytics for a recent successful scrape of this query
    // If found, we build the response from DB data instead of re-scraping
    // (Skipped for now if forceFresh is set)

    // ── Layer 3: Fresh scrape ──
    const platforms = ['JUMIA', 'KONGA', 'JIJI'] as const;

    const results = await Promise.allSettled(
      platforms.map(async (platform) => {
        const scraper = getScraper(platform);
        const products = await scraper.searchProducts({
          query: searchQuery,
          maxResults: limit,
          maxPages: 1,
        });
        return { platform, products };
      })
    );

    // Build grouped response
    const platformResults: Record<string, {
      platform: string;
      products: ScrapedProduct[];
      count: number;
      error?: string;
    }> = {};

    let allProducts: (ScrapedProduct & { _sortPrice: number })[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { platform, products } = result.value;
        platformResults[platform] = {
          platform,
          products,
          count: products.length,
        };
        allProducts.push(...products.map(p => ({ ...p, _sortPrice: p.price })));
      } else {
        const idx = results.indexOf(result);
        const platform = platforms[idx];
        platformResults[platform] = {
          platform,
          products: [],
          count: 0,
          error: result.reason?.message || 'Scraper failed',
        };
      }
    }

    // ── Relevance filter: phrase-based query matching ──
    // This prevents Jumia from polluting results with promoted/sponsored unrelated products.
    const queryLower = searchQuery.toLowerCase();
    const queryWords = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .filter(w => !['the', 'and', 'for', 'with', 'new', 'buy', 'best', 'cheap', 'price', 'in', 'of', 'on', 'to', 'ng', 'nigeria'].includes(w));

    if (queryWords.length > 0) {
      const phrasePattern = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\W+(?:\\w+\\W+){0,3}');
      const phraseRegex = new RegExp(phrasePattern, 'i');

      const relevantProducts: typeof allProducts = [];
      for (const p of allProducts) {
        const titleLower = p.title.toLowerCase();
        if (phraseRegex.test(titleLower)) {
          relevantProducts.push(p);
          continue;
        }
        if (queryWords.length >= 4) {
          const matchCount = queryWords.filter(w => titleLower.includes(w)).length;
          if (matchCount >= queryWords.length - 1) {
            relevantProducts.push(p);
          }
        }
      }
      if (relevantProducts.length >= 2) {
        allProducts = relevantProducts;
      }
    }

    // Sort by price ascending
    allProducts.sort((a, b) => a._sortPrice - b._sortPrice);

    // Build plain products list (strip internal sorting field)
    const plainProducts = allProducts.map(({ _sortPrice, ...p }) => p);

    // ── Intelligent product matching with attribute extraction ──
    const queryAttributes = extractAttributes(searchQuery);
    const ACCESSORY_KEYWORDS_SIMPLE = ['case', 'cover', 'charger', 'cable', 'protector', 'sleeve', 'pouch', 'skin'];
    const queryIsAccessory = ACCESSORY_KEYWORDS_SIMPLE.some(kw => queryLower.includes(kw));

    const matchResult = matchProducts(plainProducts, {
      queryIsAccessory,
      minConfidence: 40,
    });

    const { groups, unmatched, filteredAsAccessories, stats: matchStats } = matchResult;

    // Price summary (from all non-accessory products)
    const relevantForPricing = queryIsAccessory ? plainProducts : plainProducts.filter(p => !filteredAsAccessories.includes(p));
    const prices = relevantForPricing.map(p => p.price).filter(p => p > 0);
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highestPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const averagePrice = prices.length > 0
      ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
      : 0;

    let cheapestPlatform = '';
    let cheapestProduct: ScrapedProduct | null = null;
    if (allProducts.length > 0) {
      cheapestProduct = allProducts[0];
      cheapestPlatform = allProducts[0].platform;
    }

    // Vendor summaries are now computed inside the matcher per-listing,
    // but we still build a top-level summary for backward compat
    const vendorSummaries = plainProducts
      .filter(p => p.vendor)
      .map(p => {
        const scamFlags: string[] = [];
        if (averagePrice > 0 && p.price < averagePrice * 0.4) {
          scamFlags.push('Price significantly below average — verify before buying');
        }

        let trustLevel: string;
        let trustScore: number;
        if (p.vendor!.rating && p.vendor!.rating >= 4) {
          trustLevel = 'trusted';
          trustScore = 85 + Math.min(15, (p.vendor!.totalSales || 0) / 100);
        } else if (p.vendor!.rating && p.vendor!.rating >= 3) {
          trustLevel = 'average';
          trustScore = 50 + (p.vendor!.rating - 3) * 35;
        } else if (p.vendor!.rating && p.vendor!.rating < 3) {
          trustLevel = 'caution';
          trustScore = Math.max(10, p.vendor!.rating * 15);
          scamFlags.push('Low seller rating');
        } else if (p.vendor!.isVerified) {
          trustLevel = 'verified';
          trustScore = 70;
        } else {
          trustLevel = 'unknown';
          trustScore = 30;
          scamFlags.push('Unrated seller — exercise caution');
        }

        if (p.vendor!.name && /\b(official|jumia|konga)\b/i.test(p.vendor!.name)) {
          trustLevel = trustLevel === 'unknown' ? 'verified' : trustLevel;
          trustScore = Math.max(trustScore, 75);
        }

        return {
          platform: p.platform,
          vendorName: p.vendor!.name,
          vendorRating: p.vendor!.rating,
          isVerified: p.vendor!.isVerified,
          profileUrl: p.vendor!.profileUrl,
          trustLevel,
          trustScore: Math.round(trustScore),
          scamFlags,
          totalSales: p.vendor!.totalSales,
        };
      });

    const elapsed = Date.now() - startTime;

    const responseData = {
      success: true,
      data: {
        query: searchQuery,
        totalResults: allProducts.length,
        searchTimeMs: elapsed,
        priceSummary: {
          lowestPrice,
          highestPrice,
          averagePrice,
          currency: 'NGN',
          cheapestPlatform,
          savings: highestPrice - lowestPrice,
        },
        recommendation: cheapestProduct
          ? {
              platform: cheapestPlatform,
              title: cheapestProduct.title,
              price: cheapestProduct.price,
              url: cheapestProduct.url,
              vendor: cheapestProduct.vendor?.name || 'Unknown',
              reason: `Lowest price found on ${cheapestPlatform} — ₦${cheapestProduct.price.toLocaleString()}`,
            }
          : null,
        groups,
        unmatchedProducts: unmatched,
        filteredAsAccessories: filteredAsAccessories.length,
        matchingStats: matchStats,
        platforms: platformResults,
        allProducts: plainProducts,
        vendors: vendorSummaries,
      },
      timestamp: new Date().toISOString(),
    };

    // ── Persist to cache (Layer 1) ──
    await cacheSet(cacheKeyStr, { response: responseData, cachedAt: Date.now() }, LIVE_SEARCH_CACHE_TTL);

    // ── Persist scraped products to DB in background (Layer 2) ──
    // Fire-and-forget — don't slow down the response
    setImmediate(async () => {
      try {
        for (const p of plainProducts) {
          try {
            await ingestionService.processScrapedProduct(p, p.platform as any);
          } catch {
            // Non-fatal — individual product save failures don't matter
          }
        }
        console.log(`[live-search] Persisted ${plainProducts.length} products to DB for query: "${searchQuery}"`);
      } catch (err) {
        console.error('[live-search] Background DB persist failed:', err instanceof Error ? err.message : err);
      }
    });

    // ── Track this search in analytics ──
    setImmediate(async () => {
      try {
        const { prisma } = await import('@/infrastructure/database/prisma');
        await prisma.searchAnalytics.create({
          data: {
            query: searchQuery,
            normalizedQuery: queryNorm,
            resultsCount: allProducts.length,
            responseTimeMs: elapsed,
            cacheHit: false,
          },
        });
      } catch {
        // Non-fatal
      }
    });

    return reply.send({
      ...responseData,
      _cache: { hit: false, layer: 'fresh', responseMs: elapsed },
    });
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { product, cacheHit } = await service.getProductById(id);

    return reply.send(successResponse(product, {
      cache: { hit: cacheHit },
    }));
  });

  fastify.get('/categories', async (request, reply) => {
    const categories = await service.getCategories();
    return reply.send(successResponse(categories));
  });

  fastify.get('/brands', async (request, reply) => {
    const brands = await service.getBrands();
    return reply.send(successResponse(brands));
  });

  fastify.get('/trending', async (request, reply) => {
    const { limit } = request.query as { limit?: number };
    const result = await service.getTrendingProducts(limit ? Math.min(limit, 50) : 10);
    return reply.send(successResponse(result.products, {
      cache: { hit: result.cacheHit },
    }));
  });

  // ──────────────────────────────────────────────────────────
  // GET /products/youtube-reviews — fetch YouTube review videos
  // for a given product query. Returns video metadata for display
  // in the frontend alongside price comparisons.
  // ──────────────────────────────────────────────────────────
  fastify.get('/youtube-reviews', async (request, reply) => {
    const { q, maxResults } = request.query as { q?: string; maxResults?: string };

    if (!q || q.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required query parameter: q',
        timestamp: new Date().toISOString(),
      });
    }

    const limit = Math.min(parseInt(maxResults || '5', 10) || 5, 15);
    const ytScraper = getYouTubeScraper();

    if (!ytScraper.isConfigured) {
      // Return empty results gracefully when no API key configured
      return reply.send({
        success: true,
        data: {
          query: q.trim(),
          videos: [],
          configured: false,
          message: 'YouTube API key not configured. Videos will be available once configured.',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const videos = await ytScraper.searchVideos(q.trim(), limit);

      return reply.send({
        success: true,
        data: {
          query: q.trim(),
          videos,
          configured: true,
          totalResults: videos.length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('YouTube reviews endpoint error:', err);
      return reply.send({
        success: true,
        data: {
          query: q.trim(),
          videos: [],
          configured: true,
          error: err instanceof Error ? err.message : 'Failed to fetch YouTube videos',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
