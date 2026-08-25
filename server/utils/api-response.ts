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
 */
export function sendNotFound(res: Response, resource: string): void {
  sendError(res, `${resource} not found`, 404);
}

/**
 * Send a 400 Bad Request error
 */
export function sendBadRequest(res: Response, message: string, details?: unknown): void {
  sendError(res, message, 400, details);
}

/**
 * Send a 500 Internal Server Error
 */
export function sendServerError(res: Response, message: string = 'Internal server error'): void {
  sendError(res, message, 500);
}
