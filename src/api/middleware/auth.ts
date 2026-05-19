import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/infrastructure/database/prisma';
import { authConfig } from '@/config';
import { UnauthorizedError } from '@/shared/errors';

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    throw new UnauthorizedError('Missing X-API-Key header');
  }

  if (apiKey === authConfig.masterApiKey) return;

  const key = await prisma.apiKey.findUnique({ where: { key: apiKey } });

  if (!key || !key.isActive) {
    throw new UnauthorizedError('Invalid API key');
  }

  if (key.expiresAt && key.expiresAt < new Date()) {
    throw new UnauthorizedError('API key expired');
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });
}
