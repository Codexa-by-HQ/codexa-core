// import type { Context } from '@oak/oak';
import type { AppContext as Context } from '../lib/http/mod.ts';
import type {
	ApiResponse,
	PaginatedResponse,
	PaginationMeta,
} from '../types/app.d.ts';

// Response Builders
export function createSuccessResponse<T>(
	data?: T,
	message?: string,
): ApiResponse<T> {
	const response: ApiResponse<T> = {
		success: true,
		meta: { timestamp: new Date().toISOString() },
	};
	if (message) response.message = message;
	if (data !== undefined) response.data = data;
	return response;
}

export function createErrorResponse(
	error: string,
	errors?: unknown,
): ApiResponse {
	const response: ApiResponse = {
		success: false,
		error,
		meta: { timestamp: new Date().toISOString() },
	};
	if (errors) response.errors = errors;
	return response;
}

export function createPaginatedResponse<T>(
	data: T[],
	pagination: PaginationMeta,
	message?: string,
): PaginatedResponse<T> {
	const response: PaginatedResponse<T> = {
		success: true,
		data,
		pagination,
		meta: { timestamp: new Date().toISOString() },
	};
	if (message) response.message = message;
	return response;
}

// Pagination Helper
export function buildPaginationMeta(
	page: number,
	limit: number,
	total: number,
): PaginationMeta {
	const totalPages = Math.ceil(total / limit);
	return {
		page,
		limit,
		total,
		totalPages,
		hasNext: page < totalPages,
		hasPrev: page > 1,
	};
}

// Oak Context Senders
export function sendSuccess<T>(
	ctx: Context,
	data?: T,
	message?: string,
	status = 200,
): void {
	ctx.response.status = status;
	ctx.response.body = createSuccessResponse(data, message);
}

export function sendError(
	ctx: Context,
	error: string,
	status = 500,
	errors?: unknown,
): void {
	ctx.response.status = status;
	ctx.response.body = createErrorResponse(error, errors);
}

export function sendPaginated<T>(
	ctx: Context,
	data: T[],
	pagination: PaginationMeta,
	message?: string,
): void {
	ctx.response.status = 200;
	ctx.response.body = createPaginatedResponse(data, pagination, message);
}

// Convenience Helpers
export function sendOk<T>(ctx: Context, data?: T, message?: string): void {
	sendSuccess(ctx, data, message, 200);
}

export function sendCreated<T>(ctx: Context, data?: T, message?: string): void {
	sendSuccess(ctx, data, message ?? 'Created', 201);
}

export function sendNoContent(ctx: Context): void {
	ctx.response.status = 204;
	ctx.response.body = null;
}

export function sendBadRequest(
	ctx: Context,
	error = 'Bad request',
	errors?: unknown,
): void {
	sendError(ctx, error, 400, errors);
}

export function sendUnauthorized(ctx: Context, error = 'Unauthorized'): void {
	sendError(ctx, error, 401);
}

export function sendForbidden(ctx: Context, error = 'Forbidden'): void {
	sendError(ctx, error, 403);
}

export function sendNotFound(ctx: Context, error = 'Not found'): void {
	sendError(ctx, error, 404);
}

export function sendConflict(ctx: Context, error = 'Conflict'): void {
	sendError(ctx, error, 409);
}

export function sendValidationError(
	ctx: Context,
	errors: unknown,
	error = 'Validation failed',
): void {
	sendError(ctx, error, 422, errors);
}

export function sendInternalError(
	ctx: Context,
	error = 'Internal server error',
): void {
	sendError(ctx, error, 500);
}
