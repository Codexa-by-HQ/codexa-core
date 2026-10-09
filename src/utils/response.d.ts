/**
 * @module @codexa/core/response
 *
 * Native Response payload builders and Codexa context send helpers.
 *
 * @example
 * ```ts
 * import { sendOk, sendNotFound } from '@codexa/core/response';
 *
 * scope.route({
 *   method: 'GET',
 *   path: '/users/:id',
 *   handler: (ctx) => sendOk(ctx, { id: ctx.params.id }),
 * });
 * ```
 */
import type { ApiResponse, PaginatedResponse, PaginationMeta, ResponseMeta } from "../types/app.d.ts";
export interface JsonResponseContext {
    json(data: unknown, init?: ResponseInit): Response;
}
/** Build a standard success payload without allocating a native Response. */
export declare function createSuccessResponse<T>(data?: T, message?: string, meta?: ResponseMeta): ApiResponse<T>;
/** Build a standard error payload without allocating a native Response. */
export declare function createErrorResponse(error: string, errors?: unknown, meta?: ResponseMeta): ApiResponse;
/** Build a paginated success payload without allocating a native Response. */
export declare function createPaginatedResponse<T>(data: T[], pagination: PaginationMeta, message?: string, meta?: ResponseMeta): PaginatedResponse<T>;
/** Calculate pagination metadata from page, limit, and total item count. */
export declare function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta;
/** Send a success JSON Response through a Codexa context-compatible object. */
export declare function sendSuccess<T>(ctx: JsonResponseContext, data?: T, message?: string, status?: number, meta?: ResponseMeta): Response;
/** Send an error JSON Response through a Codexa context-compatible object. */
export declare function sendError(ctx: JsonResponseContext, error: string, status?: number, errors?: unknown, meta?: ResponseMeta): Response;
/** Send a paginated JSON Response through a Codexa context-compatible object. */
export declare function sendPaginated<T>(ctx: JsonResponseContext, data: T[], pagination: PaginationMeta, message?: string, meta?: ResponseMeta): Response;
/** Send a `200 OK` success response. */
export declare function sendOk<T>(ctx: JsonResponseContext, data?: T, message?: string, meta?: ResponseMeta): Response;
/** Send a `201 Created` success response. */
export declare function sendCreated<T>(ctx: JsonResponseContext, data?: T, message?: string, meta?: ResponseMeta): Response;
/** Send an empty `204 No Content` response. */
export declare function sendNoContent(): Response;
/** Send a `400 Bad Request` error response. */
export declare function sendBadRequest(ctx: JsonResponseContext, error?: string, errors?: unknown, meta?: ResponseMeta): Response;
/** Send a `401 Unauthorized` error response. */
export declare function sendUnauthorized(ctx: JsonResponseContext, error?: string, meta?: ResponseMeta): Response;
/** Send a `403 Forbidden` error response. */
export declare function sendForbidden(ctx: JsonResponseContext, error?: string, meta?: ResponseMeta): Response;
/** Send a `404 Not Found` error response. */
export declare function sendNotFound(ctx: JsonResponseContext, error?: string, meta?: ResponseMeta): Response;
/** Send a `409 Conflict` error response. */
export declare function sendConflict(ctx: JsonResponseContext, error?: string, meta?: ResponseMeta): Response;
/** Send a `422 Unprocessable Entity` validation error response. */
export declare function sendValidationError(ctx: JsonResponseContext, errors: unknown, error?: string, meta?: ResponseMeta): Response;
/** Send a `500 Internal Server Error` response. */
export declare function sendInternalError(ctx: JsonResponseContext, error?: string, meta?: ResponseMeta): Response;
