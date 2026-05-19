import { FastifyInstance } from 'fastify';
import { SearchService } from '@/core/services/SearchService';
import { ProductSearchSchema, PaginationSchema } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';

const service = new SearchService();

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    const query = ProductSearchSchema.merge(PaginationSchema).parse(request.query);
    const { q, category, brand, minPrice, maxPrice, condition, platform, sortBy, page, limit } = query;

    const result = await service.search(
      q,
      { category, brand, minPrice, maxPrice, condition: condition as any, platform: platform as any },
      { page, limit },
      sortBy
    );

    return reply.send(paginatedResponse(result.products, page, limit, result.total, {
      cache: { hit: result.cacheHit },
    }));
  });

  fastify.get('/suggestions', async (request, reply) => {
    const { q } = request.query as { q: string };

    if (!q || q.length < 2) {
      return reply.send(successResponse([]));
    }

    const suggestions = await service.getSuggestions(q);

    return reply.send(successResponse(suggestions));
  });

  fastify.get('/trending', async (request, reply) => {
    const { limit } = request.query as { limit?: number };
    const trending = await service.getTrendingSearches(limit ? Math.min(limit, 20) : 10);

    return reply.send(successResponse(trending));
  });
}
