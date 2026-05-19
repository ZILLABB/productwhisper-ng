import { FastifyInstance } from 'fastify';
import { PriceService } from '@/core/services/PriceService';
import { successResponse } from '@/shared/utils';

const service = new PriceService();

export async function priceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/compare/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };

    const result = await service.compareProductPrices(productId);

    return reply.send(successResponse(result.comparison, {
      cache: { hit: result.cacheHit },
    }));
  });

  fastify.get('/history/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const { days } = request.query as { days?: number };

    const history = await service.getPriceHistory(
      productId,
      days ? Math.min(days, 365) : 90
    );

    return reply.send(successResponse(history));
  });

  fastify.get('/deals', async (request, reply) => {
    const { limit } = request.query as { limit?: number };
    const deals = await service.getDeals(limit ? Math.min(limit, 50) : 20);

    return reply.send(successResponse(deals));
  });
}
