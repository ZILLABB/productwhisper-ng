import { FastifyInstance } from 'fastify';
import { SentimentService } from '@/core/services/SentimentService';
import { successResponse } from '@/shared/utils';

const service = new SentimentService();

export async function sentimentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };

    const result = await service.getProductSentiment(productId);

    return reply.send(successResponse(result.sentiment, {
      cache: { hit: result.cacheHit },
    }));
  });

  fastify.post('/analyze', async (request, reply) => {
    const { text, rating } = request.body as { text: string; rating?: number };

    if (!text || text.length < 10) {
      return reply.status(400).send({
        success: false,
        error: 'Text must be at least 10 characters',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await service.analyzeText(text, 'product_review', rating);

    return reply.send(successResponse(result));
  });

  fastify.post('/batch', async (request, reply) => {
    const { texts } = request.body as { texts: Array<string | { text: string; rating?: number }> };

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Provide an array of texts to analyze',
        code: 'VALIDATION_ERROR',
      });
    }

    if (texts.length > 50) {
      return reply.status(400).send({
        success: false,
        error: 'Maximum 50 texts per batch',
        code: 'VALIDATION_ERROR',
      });
    }

    const items = texts.map((t, i) => {
      if (typeof t === 'string') {
        return { id: String(i), text: t };
      }
      return { id: String(i), text: t.text, rating: t.rating };
    });
    const results = await service.analyzeBatch(items);

    return reply.send(successResponse(Array.from(results.values())));
  });

  fastify.get('/health', async (request, reply) => {
    const health = await service.healthCheck();

    return reply.send(successResponse({
      status: health.overall ? 'operational' : 'degraded',
      externalApi: health.external ? 'connected' : 'unavailable',
      builtinEngine: health.builtin ? 'ready' : 'error',
      note: health.external
        ? 'Using external Python sentiment API'
        : 'Using built-in Nigerian Sentiment Engine (keyword + rule-based)',
    }));
  });
}
