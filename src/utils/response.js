/* @ts-self-types="./response.d.ts" */
function buildMeta(meta) {
    return {
        timestamp: new Date().toISOString(),
        ...meta,
    };
}
export function createSuccessResponse(data, message, meta) {
    const response = {
        success: true,
        meta: buildMeta(meta),
    };
    if (message)
        response.message = message;
    if (data !== undefined)
        response.data = data;
    return response;
}
export function createErrorResponse(error, errors, meta) {
    const response = {
        success: false,
        error,
        meta: buildMeta(meta),
    };
    if (errors !== undefined)
        response.errors = errors;
    return response;
}
export function createPaginatedResponse(data, pagination, message, meta) {
    const response = {
        success: true,
        data,
        pagination,
        meta: buildMeta(meta),
    };
    if (message)
        response.message = message;
    return response;
}
export function buildPaginationMeta(page, limit, total) {
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
export function sendSuccess(ctx, data, message, status = 200, meta) {
    return ctx.json(createSuccessResponse(data, message, meta), { status });
}
export function sendError(ctx, error, status = 500, errors, meta) {
    return ctx.json(createErrorResponse(error, errors, meta), { status });
}
export function sendPaginated(ctx, data, pagination, message, meta) {
    return ctx.json(createPaginatedResponse(data, pagination, message, meta));
}
export function sendOk(ctx, data, message, meta) {
    return sendSuccess(ctx, data, message, 200, meta);
}
export function sendCreated(ctx, data, message, meta) {
    return sendSuccess(ctx, data, message ?? 'Created', 201, meta);
}
export function sendNoContent() {
    return new Response(null, { status: 204 });
}
export function sendBadRequest(ctx, error = 'Bad request', errors, meta) {
    return sendError(ctx, error, 400, errors, meta);
}
export function sendUnauthorized(ctx, error = 'Unauthorized', meta) {
    return sendError(ctx, error, 401, undefined, meta);
}
export function sendForbidden(ctx, error = 'Forbidden', meta) {
    return sendError(ctx, error, 403, undefined, meta);
}
export function sendNotFound(ctx, error = 'Not found', meta) {
    return sendError(ctx, error, 404, undefined, meta);
}
export function sendConflict(ctx, error = 'Conflict', meta) {
    return sendError(ctx, error, 409, undefined, meta);
}
export function sendValidationError(ctx, errors, error = 'Validation failed', meta) {
    return sendError(ctx, error, 422, errors, meta);
}
export function sendInternalError(ctx, error = 'Internal server error', meta) {
    return sendError(ctx, error, 500, undefined, meta);
}
