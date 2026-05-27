import { FastifyInstance } from 'fastify';
import { ProductService } from '@/core/services/ProductService';
import { IngestionService } from '@/core/services/IngestionService';
import { getScraper } from '@/infrastructure/scrapers';
import { ProductSearchSchema, PaginationSchema, ScrapedProduct } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';
import { apiKeyAuth } from '@/api/middleware/auth';

const service = new ProductService();

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
        platforms: platformResults,
        allProducts: allProducts.map(({ _sortPrice, ...p }) => p),
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
