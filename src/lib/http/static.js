/* @ts-self-types="./static.d.ts" */
import { extname, fromFileUrl, isAbsolute, relative, resolve } from '@std/path';
const DEFAULT_INDEX_FILE = 'index.html';
const DEFAULT_HTML_CACHE_CONTROL = 'no-store';
const DEFAULT_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const HASHED_ASSET_PATTERN = /(?:^|[-_.])[A-Za-z0-9_-]{8,}(?=\.[^.]+$)/;
const CONTENT_TYPES = Object.freeze({
    '.avif': 'image/avif',
    '.css': 'text/css; charset=utf-8',
    '.eot': 'application/vnd.ms-fontobject',
    '.gif': 'image/gif',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.otf': 'font/otf',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
});
export async function serveStatic(ctx, options) {
    if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
        return ctx.text('Method not allowed.', {
            status: 405,
            headers: { allow: 'GET, HEAD' },
        });
    }
    const index = normalizeIndexFile(options.index ?? DEFAULT_INDEX_FILE);
    const root = await resolveStaticRoot(options.root);
    const requestedPath = options.path ??
        ctx.params[options.pathParam ?? 'path'] ?? '';
    const normalizedPath = normalizeRequestPath(requestedPath);
    if (normalizedPath instanceof Response)
        return normalizedPath;
    let file = await findStaticFile(root, normalizedPath, index);
    if (!file && shouldUseSpaFallback(ctx, normalizedPath, options)) {
        file = await findStaticFile(root, index, index);
    }
    if (!file) {
        return ctx.text('Not found.', { status: 404 });
    }
    return await sendStaticFile(ctx, file, options);
}
async function resolveStaticRoot(root) {
    const path = root instanceof URL ? fromFileUrl(root) : resolve(root);
    const realPath = await Deno.realPath(path);
    const info = await Deno.stat(realPath);
    if (!info.isDirectory) {
        throw new TypeError('Static root must be a directory.');
    }
    return realPath;
}
function normalizeIndexFile(index) {
    const normalized = index.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized || hasParentSegment(normalized) || isAbsolute(index)) {
        throw new TypeError('Static index must be a safe relative path.');
    }
    return normalized;
}
function normalizeRequestPath(path) {
    let decoded;
    try {
        decoded = decodeURIComponent(path);
    }
    catch {
        return new Response('Malformed static path.', { status: 400 });
    }
    const normalized = decoded.replaceAll('\\', '/').replace(/^\/+/, '');
    if (decoded.includes('\0') || hasParentSegment(normalized)) {
        return new Response('Forbidden.', { status: 403 });
    }
    return normalized;
}
async function findStaticFile(root, requestedPath, index) {
    let candidate = resolve(root, requestedPath || index);
    if (!isWithinRoot(root, candidate))
        return undefined;
    let info = await statIfPresent(candidate);
    if (!info)
        return undefined;
    if (info.isDirectory) {
        candidate = resolve(candidate, index);
        if (!isWithinRoot(root, candidate))
            return undefined;
        info = await statIfPresent(candidate);
    }
    if (!info?.isFile)
        return undefined;
    const realPath = await Deno.realPath(candidate);
    if (!isWithinRoot(root, realPath))
        return undefined;
    return { path: realPath, info: await Deno.stat(realPath) };
}
async function statIfPresent(path) {
    try {
        return await Deno.stat(path);
    }
    catch (error) {
        if (error instanceof Deno.errors.NotFound)
            return undefined;
        throw error;
    }
}
function isWithinRoot(root, target) {
    const child = relative(root, target);
    return child === '' ||
        (!isAbsolute(child) && !/^\.\.(?:[\\/]|$)/.test(child));
}
function shouldUseSpaFallback(ctx, path, options) {
    if (!options.spaFallback || extname(path))
        return false;
    return ctx.headers.get('accept')?.toLowerCase().includes('text/html') ??
        false;
}
async function sendStaticFile(ctx, file, options) {
    const headers = new Headers(options.headers);
    const contentType = resolveContentType(file.path);
    const etag = createEntityTag(file.info);
    headers.set('cache-control', resolveCacheControl(file.path, contentType, options));
    headers.set('content-length', String(file.info.size));
    headers.set('content-type', contentType);
    headers.set('etag', etag);
    headers.set('x-content-type-options', 'nosniff');
    if (file.info.mtime) {
        headers.set('last-modified', file.info.mtime.toUTCString());
    }
    if (ctx.headers.get('if-none-match') === etag) {
        headers.delete('content-length');
        return ctx.send(null, { status: 304, headers });
    }
    if (ctx.request.method === 'HEAD') {
        return ctx.send(null, { status: 200, headers });
    }
    const openedFile = await Deno.open(file.path, { read: true });
    return ctx.stream(openedFile.readable, { status: 200, headers });
}
function resolveContentType(path) {
    return CONTENT_TYPES[extname(path).toLowerCase()] ??
        'application/octet-stream';
}
function resolveCacheControl(path, contentType, options) {
    if (contentType.startsWith('text/html')) {
        return options.cacheControl?.html ?? DEFAULT_HTML_CACHE_CONTROL;
    }
    const filename = path.replaceAll('\\', '/').split('/').at(-1) ?? '';
    if (HASHED_ASSET_PATTERN.test(filename)) {
        return options.cacheControl?.immutable ??
            DEFAULT_IMMUTABLE_CACHE_CONTROL;
    }
    return options.cacheControl?.assets ?? DEFAULT_ASSET_CACHE_CONTROL;
}
function createEntityTag(info) {
    const modified = info.mtime?.getTime() ?? 0;
    return `W/\"${info.size.toString(16)}-${modified.toString(16)}\"`;
}
function hasParentSegment(path) {
    return path.split('/').some((segment) => segment === '..');
}
