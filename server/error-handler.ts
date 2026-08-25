import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async handler wrapper that catches errors from async route handlers
 * and forwards them to Express error middleware.
 *
 * Usage:
 *   app.get('/api/example', asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json(data);
 *   }));
 */
export const asyncHandler = <T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
};

/**
 * Custom error class for API errors with status codes
 */
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found handler - catches requests that don't match any route
 * Should be placed after all routes but before error handler
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/api/')) {
    const error = new ApiError(`Route not found: ${req.method} ${req.path}`, 404);
    next(error);
  } else {
    next();
  }
};

/**
 * Global error handler middleware
 * Must be registered LAST in the middleware chain (after all routes)
 */
export const globalErrorHandler = (
  err: Error | ApiError | unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let isOperational = false;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
  } else if (err instanceof Error) {
    message = err.message;
    if (err.name === 'ValidationError') {
      statusCode = 400;
      isOperational = true;
    } else if (err.name === 'UnauthorizedError' || err.message.includes('unauthorized')) {
      statusCode = 401;
      isOperational = true;
    }
  }

  const logContext = {
    method: req.method,
    path: req.path,
    statusCode,
    message,
    isOperational,
  };

  if (isOperational) {
    console.warn('[API Error]', JSON.stringify(logContext));
  } else {
    console.error('[API Error]', JSON.stringify(logContext));
    if (err instanceof Error && err.stack) {
      console.error('[API Error Stack]', err.stack);
    }
  }

  const isProd = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    success: false,
    error: isProd && !isOperational ? 'Internal server error' : message,
    ...(isProd ? {} : {
      path: req.path,
      method: req.method,
    }),
  });
};
