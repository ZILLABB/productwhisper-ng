import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError, toErrorResponse } from '@/shared/errors';

export async function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = request.id;

  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      timestamp: new Date().toISOString(),
      requestId,
    });
  }

  if (error instanceof AppError) {
    const response = toErrorResponse(error, requestId);
    return reply.status(error.statusCode).send(response);
  }

  if ((error as FastifyError).statusCode) {
    return reply.status((error as FastifyError).statusCode!).send({
      success: false,
      error: error.message,
      code: 'HTTP_ERROR',
      timestamp: new Date().toISOString(),
      requestId,
    });
  }

  request.log.error({ err: error, requestId }, 'Unhandled error');

  return reply.status(500).send({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    requestId,
  });
}
