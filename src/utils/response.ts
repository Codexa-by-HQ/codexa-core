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

// JSON payload builders. These do not allocate a native Response.
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

// Native Response helpers for Codexa ctx or any compatible { json() } object.
export function sendSuccess<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	status = 200,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createSuccessResponse(data, message, meta), { status });
}

export function sendError(
	ctx: JsonResponseContext,
	error: string,
	status = 500,
	errors?: unknown,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createErrorResponse(error, errors, meta), { status });
}

export function sendPaginated<T>(
	ctx: JsonResponseContext,
	data: T[],
	pagination: PaginationMeta,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return ctx.json(createPaginatedResponse(data, pagination, message, meta));
}

export function sendOk<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return sendSuccess(ctx, data, message, 200, meta);
}

export function sendCreated<T>(
	ctx: JsonResponseContext,
	data?: T,
	message?: string,
	meta?: ResponseMeta,
): Response {
	return sendSuccess(ctx, data, message ?? 'Created', 201, meta);
}

export function sendNoContent(): Response {
	return new Response(null, { status: 204 });
}

export function sendBadRequest(
	ctx: JsonResponseContext,
	error = 'Bad request',
	errors?: unknown,
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 400, errors, meta);
}

export function sendUnauthorized(
	ctx: JsonResponseContext,
	error = 'Unauthorized',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 401, undefined, meta);
}

export function sendForbidden(
	ctx: JsonResponseContext,
	error = 'Forbidden',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 403, undefined, meta);
}

export function sendNotFound(
	ctx: JsonResponseContext,
	error = 'Not found',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 404, undefined, meta);
}

export function sendConflict(
	ctx: JsonResponseContext,
	error = 'Conflict',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 409, undefined, meta);
}

export function sendValidationError(
	ctx: JsonResponseContext,
	errors: unknown,
	error = 'Validation failed',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 422, errors, meta);
}

export function sendInternalError(
	ctx: JsonResponseContext,
	error = 'Internal server error',
	meta?: ResponseMeta,
): Response {
	return sendError(ctx, error, 500, undefined, meta);
}
