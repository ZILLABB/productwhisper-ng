import Fastify from 'fastify';
import { errorHandler } from '../../src/api/middleware/errorHandler';
import { ZodError } from 'zod';
import { AppError, NotFoundError, UnauthorizedError } from '../../src/shared/errors';

describe('Error Handler', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);

    app.get('/zod-error', async () => {
      throw new ZodError([{
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['q'],
        message: 'Required',
      }]);
    });

    app.get('/not-found', async () => {
      throw new NotFoundError('Product');
    });

    app.get('/unauthorized', async () => {
      throw new UnauthorizedError('Invalid key');
    });

    app.get('/internal', async () => {
      throw new Error('Something broke');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles ZodError with 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/zod-error' });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toHaveLength(1);
  });

  it('handles NotFoundError with 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/not-found' });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
  });

  it('handles UnauthorizedError with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/unauthorized' });
    expect(response.statusCode).toBe(401);
  });

  it('handles unknown errors with 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/internal' });
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});

describe('Response Utilities', () => {
  it('successResponse wraps data correctly', () => {
    const { successResponse } = require('../../src/shared/utils');
    const result = successResponse({ id: '123' });
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('123');
    expect(result.timestamp).toBeDefined();
  });

  it('paginatedResponse includes pagination meta', () => {
    const { paginatedResponse } = require('../../src/shared/utils');
    const result = paginatedResponse([1, 2, 3], 1, 10, 25);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.totalPages).toBe(3);
  });
});
