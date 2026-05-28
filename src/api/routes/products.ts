import { FastifyInstance } from 'fastify';
import { ProductService } from '@/core/services/ProductService';
import { IngestionService } from '@/core/services/IngestionService';
import { getScraper } from '@/infrastructure/scrapers';
import { ProductSearchSchema, PaginationSchema, ScrapedProduct } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';
import { apiKeyAuth } from '@/api/middleware/auth';

const service = new ProductService();

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

/** Extract key product signature: brand + model + storage/size */
function extractSignature(normalized: string): string {
  // Try to extract: brand + model number + capacity
  // e.g. "samsung galaxy a15 128gb" → "samsung galaxy a15 128gb"
  // e.g. "apple iphone 15 pro max 256gb" → "iphone 15 pro max 256gb"
  const storage = normalized.match(/(\d+\s*(?:gb|tb))/i)?.[0]?.replace(/\s/g, '') || '';
  const ram = normalized.match(/(\d+\s*gb\s*ram)/i)?.[0]?.replace(/\s/g, '') || '';

  // Remove noise words
  const cleaned = normalized
    .replace(/\b(for|with|and|the|in|on|to|of|a|an)\b/g, '')
    .replace(/\b(case|cover|screen protector|charger|cable|earphone|headphone|tempered glass|pouch|bag)\b/g, (m) => `[acc:${m}]`)
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
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
  const THRESHOLD = 0.35; // Similarity threshold for grouping

  // Pre-compute normalized titles and signatures
  const items = allProducts.map((p, idx) => ({
    product: p,
    idx,
    normalized: normalizeTitle(p.title),
    signature: extractSignature(normalizeTitle(p.title)),
    grouped: false,
  }));

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
      const listings = cluster.map(c => ({
        platform: c.product.platform,
        product: c.product,
        vendorName: c.product.vendor?.name,
        trustLevel: c.product.vendor?.rating
          ? (c.product.vendor.rating >= 4 ? 'trusted' : c.product.vendor.rating >= 3 ? 'average' : 'caution')
          : (c.product.vendor?.isVerified ? 'verified' : 'unknown'),
      }));

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
  // GET /products/live-search — real-time cross-platform search
  // Searches Jumia, Konga, and Jiji in parallel and returns
  // results grouped by platform for price comparison.
  // ──────────────────────────────────────────────────────────
  fastify.get('/live-search', async (request, reply) => {
    const { q, maxResults } = request.query as { q?: string; maxResults?: string };

    if (!q || q.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required query parameter: q',
        timestamp: new Date().toISOString(),
      });
    }

    const limit = Math.min(parseInt(maxResults || '10', 10) || 10, 30);
    const platforms = ['JUMIA', 'KONGA', 'JIJI'] as const;

    const startTime = Date.now();

    // Search all 3 platforms in parallel
    const results = await Promise.allSettled(
      platforms.map(async (platform) => {
        const scraper = getScraper(platform);
        const products = await scraper.searchProducts({
          query: q.trim(),
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
        // Find which platform failed (based on order)
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

    // Sort all products by price ascending (cheapest first)
    allProducts.sort((a, b) => a._sortPrice - b._sortPrice);

    // Build price summary
    const prices = allProducts.map(p => p.price).filter(p => p > 0);
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highestPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const averagePrice = prices.length > 0
      ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
      : 0;

    // Find the cheapest platform
    let cheapestPlatform = '';
    let cheapestProduct: ScrapedProduct | null = null;
    if (allProducts.length > 0) {
      cheapestProduct = allProducts[0];
      cheapestPlatform = allProducts[0].platform;
    }

    // Build vendor info map — flag vendors with low ratings or no ratings
    const vendorSummaries = allProducts
      .filter(p => p.vendor)
      .map(p => ({
        platform: p.platform,
        vendorName: p.vendor!.name,
        vendorRating: p.vendor!.rating,
        isVerified: p.vendor!.isVerified,
        profileUrl: p.vendor!.profileUrl,
        trustLevel: p.vendor!.rating
          ? (p.vendor!.rating >= 4 ? 'trusted' : p.vendor!.rating >= 3 ? 'average' : 'caution')
          : (p.vendor!.isVerified ? 'verified' : 'unknown'),
      }));

    // Group similar products across platforms for side-by-side comparison
    const plainProducts = allProducts.map(({ _sortPrice, ...p }) => p);
    const { groups, unmatched } = groupProducts(plainProducts);

    const elapsed = Date.now() - startTime;

    return reply.send({
      success: true,
      data: {
        query: q.trim(),
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
        // NEW: Grouped cross-platform comparison
        groups,
        unmatchedProducts: unmatched,
        // Legacy flat list (kept for backwards compat)
        platforms: platformResults,
        allProducts: plainProducts,
        vendors: vendorSummaries,
      },
      timestamp: new Date().toISOString(),
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
}
