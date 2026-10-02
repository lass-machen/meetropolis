import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { AppError } from '../errors/AppError.js';
import { randomUUID } from 'crypto';

/**
 * Extract correlation ID from request headers or generate a new one
 */
function getCorrelationId(req: Request): string {
  const headerValue = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  if (typeof headerValue === 'string' && headerValue) {
    return headerValue;
  }
  return randomUUID();
}

/**
 * Extract tenant information from request for error logging context
 */
function getTenantContext(req: Request): { tenantId?: string; tenantSlug?: string } {
  const tenant = (req as Request & { tenant?: { id?: string; slug?: string } }).tenant;
  if (tenant && typeof tenant === 'object') {
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    };
  }
  return {};
}

/**
 * Extract user information from request for error logging context
 */
function getUserContext(req: Request): { userId?: string; userEmail?: string } {
  const user = (req as Request & { user?: { id?: string; email?: string } }).user;
  if (user && typeof user === 'object') {
    return {
      userId: user.id,
      userEmail: user.email,
    };
  }
  return {};
}

type NormalizedError = {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
};

/**
 * Client errors raised by the body parsers (`express.json()`, `express.raw()`
 * and friends, via `raw-body` and `http-errors`). They carry a 4xx `status`
 * and `expose: true`; the request was at fault, not the server. Mapping them
 * to 500 reported every malformed or oversized body as an internal error and
 * logged it at error level. `type` is the body-parser error type.
 */
const BODY_PARSER_ERRORS: Readonly<Record<string, { code: string; message: string }>> = {
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'Malformed request body' },
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
  'entity.verify.failed': { code: 'BAD_REQUEST', message: 'Request body rejected' },
  'encoding.unsupported': { code: 'UNSUPPORTED_ENCODING', message: 'Unsupported content encoding' },
  'charset.unsupported': { code: 'UNSUPPORTED_CHARSET', message: 'Unsupported charset' },
  'request.aborted': { code: 'REQUEST_ABORTED', message: 'Request aborted' },
  'request.size.invalid': { code: 'BAD_REQUEST', message: 'Request size did not match content length' },
};

function normalizeClientHttpError(err: Error): NormalizedError | null {
  const candidate = err as Error & { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof status !== 'number' || status < 400 || status > 499 || candidate.expose !== true) {
    return null;
  }
  const known = typeof candidate.type === 'string' ? BODY_PARSER_ERRORS[candidate.type] : undefined;
  return {
    statusCode: status,
    code: known?.code ?? 'BAD_REQUEST',
    // Fixed texts: the parser's own message can quote parts of the body.
    message: known?.message ?? 'Bad request',
    isOperational: true,
  };
}

function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      isOperational: err.isOperational,
    };
  }
  if (err instanceof Error) {
    const clientError = normalizeClientHttpError(err);
    if (clientError) {
      return clientError;
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: err.message, isOperational: false };
  }
  if (typeof err === 'string') {
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: err, isOperational: false };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal Server Error', isOperational: false };
}

function logErrorWithContext(err: unknown, req: Request, normalized: NormalizedError, correlationId: string) {
  const logContext = {
    event: 'http.error',
    correlationId,
    statusCode: normalized.statusCode,
    code: normalized.code,
    isOperational: normalized.isOperational,
    method: req.method,
    path: req.path,
    url: req.url,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    ...getTenantContext(req),
    ...getUserContext(req),
  };

  if (normalized.isOperational) {
    logger.warn({
      ...logContext,
      message: normalized.message,
      stack: err instanceof Error ? err.stack : undefined,
    });
  } else {
    logger.error({
      ...logContext,
      message: normalized.message,
      stack: err instanceof Error ? err.stack : undefined,
      error:
        err instanceof Error
          ? {
              name: err.name,
              message: err.message,
              stack: err.stack,
            }
          : String(err),
    });
  }
}

function buildErrorResponse(err: unknown, normalized: NormalizedError, correlationId: string, isProd: boolean) {
  const response: {
    success: boolean;
    error: {
      code: string;
      message: string;
      correlationId?: string;
      stack?: string;
    };
  } = {
    success: false,
    error: {
      code: normalized.code,
      message: isProd && !normalized.isOperational ? 'Internal Server Error' : normalized.message,
    },
  };

  if (!isProd || normalized.isOperational) {
    response.error.correlationId = correlationId;
  }

  if (!isProd && err instanceof Error && err.stack) {
    response.error.stack = err.stack;
  }

  return response;
}

/**
 * Central error handler middleware
 * Should be the last middleware in the chain
 *
 * Handles both operational errors (AppError) and unexpected errors
 * Logs all errors with full context and stack traces
 * Returns structured JSON error responses
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isProd = process.env.NODE_ENV === 'production';
  const correlationId = getCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  const normalized = normalizeError(err);
  logErrorWithContext(err, req, normalized, correlationId);
  const response = buildErrorResponse(err, normalized, correlationId, isProd);
  res.status(normalized.statusCode).json(response);
}
