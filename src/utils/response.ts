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

import type {
	ApiResponse,
	PaginatedResponse,
	PaginationMeta,
	ResponseMeta,
} from '../types/app.d.ts';

export interface JsonResponseContext {
	json(data: unknown, init?: ResponseInit): Response;
}

function buildMeta(meta?: ResponseMeta): ResponseMeta {
	return {
		timestamp: new Date().toISOString(),
		...meta,
	};
}

/** Build a standard success payload without allocating a native Response. */
export function createSuccessResponse<T>(
	data?: T,
	message?: string,
	meta?: ResponseMeta,
): ApiResponse<T> {
	const response: ApiResponse<T> = {
		success: true,
		meta: buildMeta(meta),
	};
	if (message) response.message = message;
	if (data !== undefined) response.data = data;
	return response;
}

/** Build a standard error payload without allocating a native Response. */
export function createErrorResponse(
	error: string,
	errors?: unknown,
	meta?: ResponseMeta,
): ApiResponse {
	const response: ApiResponse = {
		success: false,
		error,
		meta: buildMeta(meta),
	};
	if (errors !== undefined) response.errors = errors;
	return response;
}

/** Build a paginated success payload without allocating a native Response. */
export function createPaginatedResponse<T>(
	data: T[],
	pagination: PaginationMeta,
	message?: string,
	meta?: ResponseMeta,
): PaginatedResponse<T> {
	const response: PaginatedResponse<T> = {
		success: true,
		data,
		pagination,
		meta: buildMeta(meta),
	};
	if (message) response.message = message;
	return response;
}

/** Calculate pagination metadata from page, limit, and total item count. */
export function buildPaginationMeta(
	page: number,
	limit: number,
	total: number,
): PaginationMeta {
	const safeLimit = Math.max(1, limit);
	const safePage = Math.max(1, page);
	const totalPages = Math.ceil(total / safeLimit);
	return {
		page: safePage,
		limit: safeLimit,
		total,
		totalPages,
		hasNext: safePage < totalPages,
		hasPrev: safePage > 1,
	};
}

/** Send a success JSON Response through a Codexa context-compatible object. */
export function sendSuccess<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	status = 200,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createSuccessResponse(data, message, meta), { status });
}

/** Send an error JSON Response through a Codexa context-compatible object. */
export function sendError(
	ctx: JsonResponseContext,
	error: string,
	status = 500,
	errors?: unknown,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createErrorResponse(error, errors, meta), { status });
}

/** Send a paginated JSON Response through a Codexa context-compatible object. */
export function sendPaginated<T>(
	ctx: JsonResponseContext,
	data: T[],
	pagination: PaginationMeta,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createPaginatedResponse(data, pagination, message, meta));
}

/** Send a `200 OK` success response. */
export function sendOk<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return sendSuccess(ctx, data, message, 200, meta);
}

/** Send a `201 Created` success response. */
export function sendCreated<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return sendSuccess(ctx, data, message ?? 'Created', 201, meta);
}

/** Send an empty `204 No Content` response. */
export function sendNoContent(): Response {
	return new Response(null, { status: 204 });
}

/** Send a `400 Bad Request` error response. */
export function sendBadRequest(
	ctx: JsonResponseContext,
	error = 'Bad request',
	errors?: unknown,
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 400, errors, meta);
}

/** Send a `401 Unauthorized` error response. */
export function sendUnauthorized(
	ctx: JsonResponseContext,
	error = 'Unauthorized',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 401, undefined, meta);
}

/** Send a `403 Forbidden` error response. */
export function sendForbidden(
	ctx: JsonResponseContext,
	error = 'Forbidden',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 403, undefined, meta);
}

/** Send a `404 Not Found` error response. */
export function sendNotFound(
	ctx: JsonResponseContext,
	error = 'Not found',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 404, undefined, meta);
}

/** Send a `409 Conflict` error response. */
export function sendConflict(
	ctx: JsonResponseContext,
	error = 'Conflict',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 409, undefined, meta);
}

/** Send a `422 Unprocessable Entity` validation error response. */
export function sendValidationError(
	ctx: JsonResponseContext,
	errors: unknown,
	error = 'Validation failed',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 422, errors, meta);
}

/** Send a `500 Internal Server Error` response. */
export function sendInternalError(
	ctx: JsonResponseContext,
	error = 'Internal server error',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 500, undefined, meta);
}
