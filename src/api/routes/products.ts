import { FastifyInstance } from 'fastify';
import { ProductService } from '@/core/services/ProductService';
import { ProductSearchSchema, PaginationSchema } from '@/shared/types';
import { successResponse, paginatedResponse } from '@/shared/utils';
import { apiKeyAuth } from '@/api/middleware/auth';

const service = new ProductService();

export async function productRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/search', async (request, reply) => {
    const query = ProductSearchSchema.merge(PaginationSchema).parse(request.query);
    const { q, category, brand, minPrice, maxPrice, condition, platform, sortBy, page, limit } = query;

    const result = await service.searchProducts(q, { category, brand, minPrice, maxPrice, condition: condition as any, platform: platform as any }, { page, limit }, sortBy);

    return reply.send(paginatedResponse(result.products, page, limit, result.total, {
      cache: { hit: result.cacheHit },
    }));
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
