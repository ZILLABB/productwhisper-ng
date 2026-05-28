import { FastifyInstance } from 'fastify';
import { ProductService } from '@/core/services/ProductService';
import { IngestionService } from '@/core/services/IngestionService';
import { getScraper, getYouTubeScraper } from '@/infrastructure/scrapers';
import { ProductSearchSchema, PaginationSchema, ScrapedProduct } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';
import { apiKeyAuth } from '@/api/middleware/auth';
import { cacheGet, cacheSet } from '@/infrastructure/cache/redis';

const service = new ProductService();
const ingestionService = new IngestionService();

/* ─── Live-search cache config ─────────────────────────── */
const LIVE_SEARCH_CACHE_TTL = 900;   // 15 minutes — Redis/memory layer
const LIVE_SEARCH_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours — DB layer

/* ─── Product Matching Helpers ───────────────────────────── */

/** Normalize a product title for fuzzy matching */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''""]/g, '')                     // smart quotes
    .replace(/\s*[-–—/|,]\s*/g, ' ')            // separators
    .replace(/\b(brand new|uk used|fairly used|used|refurbished|original)\b/gi, '')
    .replace(/\b(free delivery|free shipping|fast shipping)\b/gi, '')
    .replace(/\b(lagos|abuja|nigeria|naija)\b/gi, '')
    .replace(/\b\d+\s*%\s*off\b/gi, '')         // "30% off"
    .replace(/[^a-z0-9\s.]/g, ' ')              // non-alpha
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract key product signature: brand + model + storage/size.
 *  Strips colors, conditions, and noise to produce a canonical form
 *  e.g. "apple iphone 15 pro max 256gb black" → "iphone 15 pro max 256gb"
 */
function extractSignature(normalized: string): string {
  let sig = normalized
    // Remove common color words
    .replace(/\b(black|white|blue|green|red|gold|silver|grey|gray|purple|pink|yellow|natural titanium|desert titanium|cream|graphite|midnight|starlight|sierra)\b/g, '')
    // Remove condition words
    .replace(/\b(new|brand new|uk used|fairly used|used|refurbished|original|sealed)\b/g, '')
    // Remove noise/filler
    .replace(/\b(for|with|and|the|in|on|to|of|a|an|dual|sim|nano|single)\b/g, '')
    // Remove dimension descriptions like 6.1" or 6.7-inch
    .replace(/\d+\.\d+\s*["'']\s*/g, '')
    .replace(/\d+\.\d+\s*inch/g, '')
    // Normalize storage: "128 gb" → "128gb"
    .replace(/(\d+)\s*(gb|tb)/g, '$1$2')
    // Remove RAM specs like "8gb ram" (we match on storage, not RAM)
    .replace(/\d+gb\s*ram/g, '')
    // Remove ROM label
    .replace(/\brom\b/g, '')
    // Collapse spaces
    .replace(/\s+/g, ' ')
    .trim();

  return sig;
}

/** Calculate similarity between two strings (Jaccard on word bigrams) */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const bigramsOf = (s: string) => {
    const words = s.split(' ').filter(w => w.length > 0);
    const bg = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      bg.add(words[i] + ' ' + words[i + 1]);
    }
    // Also add individual words for short titles
    words.forEach(w => bg.add(w));
    return bg;
  };

  const setA = bigramsOf(a);
  const setB = bigramsOf(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }

  return intersection / (setA.size + setB.size - intersection);
}

interface ProductGroup {
  groupId: string;
  name: string;                  // best representative title
  listings: {
    platform: string;
    product: ScrapedProduct;
    vendorName?: string;
    trustLevel?: string;
  }[];
  lowestPrice: number;
  highestPrice: number;
  cheapestPlatform: string;
  savings: number;
  platformCount: number;
}

/** Group similar products across platforms */
function groupProducts(allProducts: ScrapedProduct[]): { groups: ProductGroup[]; unmatched: ScrapedProduct[] } {
  const THRESHOLD = 0.30; // Similarity threshold for grouping (lowered for better cross-platform matching)

  // Pre-compute normalized titles and signatures
  const items = allProducts.map((p, idx) => ({
    product: p,
    idx,
    normalized: normalizeTitle(p.title),
    signature: extractSignature(normalizeTitle(p.title)),
    grouped: false,
  }));

  // Debug: log signatures for troubleshooting
  if (items.length > 0) {
    console.log('[groupProducts] Sample signatures:', items.slice(0, 5).map(i => `${i.product.platform}: "${i.signature}"`).join(' | '));
  }

  const groups: ProductGroup[] = [];

  // Greedy clustering: for each unmatched product, find all similar ones
  for (let i = 0; i < items.length; i++) {
    if (items[i].grouped) continue;

    const anchor = items[i];
    anchor.grouped = true;

    const cluster: typeof items = [anchor];

    // Find matches from OTHER platforms
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].grouped) continue;
      // Only match across different platforms for cross-platform comparison
      if (items[j].product.platform === anchor.product.platform) continue;

      const sim = similarity(anchor.signature, items[j].signature);
      if (sim >= THRESHOLD) {
        items[j].grouped = true;
        cluster.push(items[j]);
      }
    }

    // Only create a group if we have listings from 2+ platforms
    if (cluster.length >= 2) {
      const listings = cluster.map(c => {
        const v = c.product.vendor;
        let trustLevel: string;
        let trustScore = 30;
        const scamFlags: string[] = [];

        if (v?.rating && v.rating >= 4) {
          trustLevel = 'trusted'; trustScore = 85;
        } else if (v?.rating && v.rating >= 3) {
          trustLevel = 'average'; trustScore = 55;
        } else if (v?.rating && v.rating < 3) {
          trustLevel = 'caution'; trustScore = 20;
          scamFlags.push('Low seller rating');
        } else if (v?.isVerified) {
          trustLevel = 'verified'; trustScore = 70;
        } else {
          trustLevel = v?.name ? 'unknown' : 'unknown';
          if (!v?.name) scamFlags.push('No seller info');
        }

        // Official store boost
        if (v?.name && /\b(official|jumia|konga)\b/i.test(v.name)) {
          trustLevel = trustLevel === 'unknown' ? 'verified' : trustLevel;
          trustScore = Math.max(trustScore, 75);
        }

        return {
          platform: c.product.platform,
          product: c.product,
          vendorName: v?.name,
          trustLevel,
          trustScore,
          scamFlags,
        };
      });

      // Sort listings by price
      listings.sort((a, b) => a.product.price - b.product.price);

      const prices = listings.map(l => l.product.price);
      const lowestPrice = Math.min(...prices);
      const highestPrice = Math.max(...prices);

      // Use the title from the cheapest listing (or the longest title for clarity)
      const bestTitle = listings.reduce((best, l) =>
        l.product.title.length > best.length ? l.product.title : best
      , listings[0].product.title);

      groups.push({
        groupId: `grp-${groups.length + 1}`,
        name: bestTitle,
        listings,
        lowestPrice,
        highestPrice,
        cheapestPlatform: listings[0].platform,
        savings: highestPrice - lowestPrice,
        platformCount: new Set(listings.map(l => l.platform)).size,
      });
    } else {
      // Ungroup — mark as not grouped so it goes to unmatched
      anchor.grouped = false;
    }
  }

  // Sort groups by savings descending (biggest savings first)
  groups.sort((a, b) => b.savings - a.savings);

  // Collect unmatched
  const unmatched = items.filter(i => !i.grouped).map(i => i.product);

  return { groups, unmatched };
}

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

    // ── Relevance filter: remove accessories & off-topic results ──
    const ACCESSORY_KEYWORDS = [
      'case', 'cover', 'pouch', 'sleeve', 'skin',
      'screen protector', 'tempered glass', 'film',
      'charger', 'charging', 'cable', 'adapter', 'power bank',
      'earphone', 'headphone', 'headset', 'earbud', 'airpod',
      'holder', 'stand', 'mount', 'ring', 'grip', 'strap',
      'stylus', 'pen', 'sticker', 'decal',
      'sim tray', 'repair', 'replacement', 'spare part',
      'back glass', 'lcd', 'digitizer', 'flex',
    ];

    const queryLower = searchQuery.toLowerCase();
    const queryIsAccessory = ACCESSORY_KEYWORDS.some(kw => queryLower.includes(kw));

    // Step 1: Remove accessories (unless the query IS for an accessory)
    if (!queryIsAccessory) {
      const mainProducts: typeof allProducts = [];
      for (const p of allProducts) {
        const titleLower = p.title.toLowerCase();
        const isAccessory = ACCESSORY_KEYWORDS.some(kw => titleLower.includes(kw));
        if (!isAccessory) mainProducts.push(p);
      }
      if (mainProducts.length >= 3) allProducts = mainProducts;
    }

    // Step 2: Query-relevance filter — drop products that don't contain
    // the important keywords from the search query. This prevents Jumia
    // from polluting results with promoted/sponsored unrelated products.
    const queryWords = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2)
      // Drop common filler words that don't help relevance matching
      .filter(w => !['the', 'and', 'for', 'with', 'new', 'buy', 'best', 'cheap', 'price', 'in', 'of', 'on', 'to', 'ng', 'nigeria'].includes(w));

    if (queryWords.length > 0) {
      // Build a phrase regex from the query for stricter matching.
      // "iPhone 15" should match "iPhone 15 Pro" but NOT "15+ Service Functions... iPhone"
      // We allow optional words between query terms (up to 3 words gap).
      const phrasePattern = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\W+(?:\\w+\\W+){0,3}');
      const phraseRegex = new RegExp(phrasePattern, 'i');

      const relevantProducts: typeof allProducts = [];
      for (const p of allProducts) {
        const titleLower = p.title.toLowerCase();

        // Primary check: does the title contain the query as a near-phrase?
        if (phraseRegex.test(titleLower)) {
          relevantProducts.push(p);
          continue;
        }

        // Fallback for long queries (4+ words): allow if all words present
        if (queryWords.length >= 4) {
          const matchCount = queryWords.filter(w => titleLower.includes(w)).length;
          if (matchCount >= queryWords.length - 1) {
            relevantProducts.push(p);
          }
        }
      }
      // Only apply if we still have enough results
      if (relevantProducts.length >= 2) {
        allProducts = relevantProducts;
      }
    }

    // Sort by price ascending
    allProducts.sort((a, b) => a._sortPrice - b._sortPrice);

    // Price summary
    const prices = allProducts.map(p => p.price).filter(p => p > 0);
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

    // ── Enhanced Merchant Trust Scoring ──
    const vendorSummaries = allProducts
      .filter(p => p.vendor)
      .map(p => {
        const scamFlags: string[] = [];

        // Scam signal: price suspiciously low
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

    // Group similar products across platforms
    const plainProducts = allProducts.map(({ _sortPrice, ...p }) => p);
    const { groups, unmatched } = groupProducts(plainProducts);

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
