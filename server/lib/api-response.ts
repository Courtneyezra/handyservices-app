import type { Response } from 'express';

/**
 * Standardized API response format
 *
 * All API endpoints should use these helpers to ensure consistent response structure:
 * - Success responses: { success: true, data: T, pagination?: {...} }
 * - Error responses: { success: false, error: string }
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Create a standardized success response
 *
 * @param data - The response payload
 * @param pagination - Optional pagination metadata
 * @returns Formatted success response object
 *
 * @example
 * res.json(successResponse({ quotes: [...] }));
 * res.json(successResponse({ calls: [...] }, { page: 1, limit: 25, total: 100 }));
 */
export function successResponse<T>(data: T, pagination?: PaginationMeta): ApiSuccessResponse<T> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
  };

  if (pagination) {
    response.pagination = {
      ...pagination,
      totalPages: pagination.totalPages ?? Math.ceil(pagination.total / pagination.limit),
    };
  }

  return response;
}

/**
 * Create a standardized error response
 *
 * @param message - Human-readable error message
 * @param details - Optional additional error details (validation errors, etc.)
 * @returns Formatted error response object
 *
 * @example
 * res.status(400).json(errorResponse('Invalid input'));
 * res.status(500).json(errorResponse('Database error', { query: 'SELECT...' }));
 */
export function errorResponse(message: string, details?: unknown): ApiErrorResponse {
  const response: ApiErrorResponse = {
    success: false,
    error: message,
  };

  if (details !== undefined) {
    response.details = details;
  }

  return response;
}

/**
 * Send a standardized success response
 *
 * @param res - Express response object
 * @param data - The response payload
 * @param pagination - Optional pagination metadata
 * @param statusCode - HTTP status code (default: 200)
 *
 * @example
 * sendSuccess(res, { quote: {...} });
 * sendSuccess(res, { leadId: '123' }, undefined, 201);
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  pagination?: PaginationMeta,
  statusCode: number = 200
): void {
  res.status(statusCode).json(successResponse(data, pagination));
}

/**
 * Send a standardized error response
 *
 * @param res - Express response object
 * @param message - Human-readable error message
 * @param statusCode - HTTP status code (default: 500)
 * @param details - Optional additional error details
 *
 * @example
 * sendError(res, 'Quote not found', 404);
 * sendError(res, 'Invalid input', 400, validationErrors);
 */
export function sendError(
  res: Response,
  message: string,
  statusCode: number = 500,
  details?: unknown
): void {
  res.status(statusCode).json(errorResponse(message, details));
}

/**
 * Send a 404 Not Found error
 *
 * @param res - Express response object
 * @param resource - Name of the resource that wasn't found
 *
 * @example
 * sendNotFound(res, 'Quote');
 * sendNotFound(res, 'Call');
 */
export function sendNotFound(res: Response, resource: string): void {
  sendError(res, `${resource} not found`, 404);
}

/**
 * Send a 400 Bad Request error
 *
 * @param res - Express response object
 * @param message - Error message
 * @param details - Optional validation error details
 *
 * @example
 * sendBadRequest(res, 'Missing required field: phone');
 * sendBadRequest(res, 'Invalid input', zodError.errors);
 */
export function sendBadRequest(res: Response, message: string, details?: unknown): void {
  sendError(res, message, 400, details);
}

/**
 * Send a 500 Internal Server Error
 *
 * @param res - Express response object
 * @param message - Error message (default: 'Internal server error')
 *
 * @example
 * sendServerError(res);
 * sendServerError(res, 'Database connection failed');
 */
export function sendServerError(res: Response, message: string = 'Internal server error'): void {
  sendError(res, message, 500);
}
