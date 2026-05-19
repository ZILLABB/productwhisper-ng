import { FastifyInstance } from 'fastify';
import { TrustService } from '@/core/services/TrustService';
import { successResponse } from '@/shared/utils';

const service = new TrustService();

export async function trustRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/product/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };

    const result = await service.getProductTrust(productId);

    return reply.send(successResponse(result.trust, {
      cache: { hit: result.cacheHit },
    }));
  });

  fastify.get('/vendor/:vendorId', async (request, reply) => {
    const { vendorId } = request.params as { vendorId: string };

    const result = await service.getVendorTrust(vendorId);

    return reply.send(successResponse(result.trust, {
      cache: { hit: result.cacheHit },
    }));
  });
}
