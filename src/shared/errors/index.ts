import { HTTP_STATUS } from '@/shared/constants';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing API key') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED');
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', HTTP_STATUS.TOO_MANY_REQUESTS, 'RATE_LIMIT', { retryAfter });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`${service}: ${message}`, HTTP_STATUS.BAD_GATEWAY, 'EXTERNAL_SERVICE_ERROR', { service, ...(details && typeof details === 'object' ? details as Record<string, unknown> : { detail: details }) });
  }
}

export class ScraperError extends ExternalServiceError {
  constructor(platform: string, message: string, details?: unknown) {
    super(`${platform} Scraper`, message, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DATABASE_ERROR', details);
  }
}

export class CacheError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'CACHE_ERROR', details);
  }
}

export function toErrorResponse(error: unknown, requestId?: string) {
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
      timestamp: new Date().toISOString(),
      requestId,
    };
  }

  return {
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    requestId,
  };
}
