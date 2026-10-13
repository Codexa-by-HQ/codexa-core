/**
 * Static application delivery for Codexa HTTP routes.
 *
 * Use this from a normal route handler so the application keeps ownership of
 * routing, middleware, versioning, and lifecycle behavior.
 *
 * @example
 * ```ts
 * router.route({
 * 	method: ['GET', 'HEAD'],
 * 	path: '/:path*',
 * 	handler: (ctx) => serveStatic(ctx, {
 * 		root: new URL('../app/dist/', import.meta.url),
 * 		spaFallback: true,
 * 	}),
 * })
 * ```
 */

import { extname, fromFileUrl, isAbsolute, relative, resolve } from '@std/path';
import type { Context, Empty } from './mod.ts';

const DEFAULT_INDEX_FILE = 'index.html';
const DEFAULT_HTML_CACHE_CONTROL = 'no-store';
const DEFAULT_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const HASHED_ASSET_PATTERN = /(?:^|[-_.])[A-Za-z0-9_-]{8,}(?=\.[^.]+$)/;

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
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

export interface StaticCacheControlOptions {
	/** Cache policy for HTML documents */
	html?: string;
	/** Cache policy for assets whose filenames contain a content hash */
	immutable?: string;
	/** Cache policy for all other files */
	assets?: string;
}

export interface ServeStaticOptions {
	/** Absolute directory containing the static application build */
	root: string | URL;
	/** Explicit relative asset path, otherwise the route's `path` param is used */
	path?: string;
	/** Route parameter containing the requested asset path */
	pathParam?: string;
	/** Entry document used for directories and SPA navigation fallback */
	index?: string;
	/** Return the entry document for missing extensionless HTML navigations */
	spaFallback?: boolean;
	/** Additional headers such as a host-defined Content-Security-Policy */
	headers?: Readonly<Record<string, string>>;
	/** Optional overrides for generated cache-control headers */
	cacheControl?: StaticCacheControlOptions;
}

interface StaticFile {
	path: string;
	info: Deno.FileInfo;
}

type StaticRouteContext<Params extends Record<string, string>> =
	& Pick<Context<Empty, Params>, 'request' | 'headers' | 'params'>
	& Pick<Context, 'text' | 'send' | 'stream'>;

/** Serve one static application request through a Codexa route context */
export async function serveStatic<Params extends Record<string, string>>(
	ctx: StaticRouteContext<Params>,
	options: ServeStaticOptions,
): Promise<Response> {
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
	if (normalizedPath instanceof Response) return normalizedPath;

	let file = await findStaticFile(root, normalizedPath, index);
	if (!file && shouldUseSpaFallback(ctx, normalizedPath, options)) {
		file = await findStaticFile(root, index, index);
	}
	if (!file) {
		return ctx.text('Not found.', { status: 404 });
	}

	return await sendStaticFile(ctx, file, options);
}

/** Resolve and validate the configured static build directory */
async function resolveStaticRoot(root: string | URL): Promise<string> {
	const path = root instanceof URL ? fromFileUrl(root) : resolve(root);
	const realPath = await Deno.realPath(path);
	const info = await Deno.stat(realPath);
	if (!info.isDirectory) {
		throw new TypeError('Static root must be a directory.');
	}
	return realPath;
}

/** Require the entry document to remain relative to the static root */
function normalizeIndexFile(index: string): string {
	const normalized = index.replaceAll('\\', '/').replace(/^\/+/, '');
	if (!normalized || hasParentSegment(normalized) || isAbsolute(index)) {
		throw new TypeError('Static index must be a safe relative path.');
	}
	return normalized;
}

/** Decode and validate the route path before it reaches the filesystem */
function normalizeRequestPath(path: string): string | Response {
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return new Response('Malformed static path.', { status: 400 });
	}

	const normalized = decoded.replaceAll('\\', '/').replace(/^\/+/, '');
	if (decoded.includes('\0') || hasParentSegment(normalized)) {
		return new Response('Forbidden.', { status: 403 });
	}
	return normalized;
}

/** Locate a regular file while preventing lexical and symlink traversal */
async function findStaticFile(
	root: string,
	requestedPath: string,
	index: string,
): Promise<StaticFile | undefined> {
	let candidate = resolve(root, requestedPath || index);
	if (!isWithinRoot(root, candidate)) return undefined;

	let info = await statIfPresent(candidate);
	if (!info) return undefined;
	if (info.isDirectory) {
		candidate = resolve(candidate, index);
		if (!isWithinRoot(root, candidate)) return undefined;
		info = await statIfPresent(candidate);
	}
	if (!info?.isFile) return undefined;

	const realPath = await Deno.realPath(candidate);
	if (!isWithinRoot(root, realPath)) return undefined;
	return { path: realPath, info: await Deno.stat(realPath) };
}

/** Treat missing files as normal misses while preserving operational errors */
async function statIfPresent(path: string): Promise<Deno.FileInfo | undefined> {
	try {
		return await Deno.stat(path);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return undefined;
		throw error;
	}
}

/** Confirm a resolved path remains below the configured static root */
function isWithinRoot(root: string, target: string): boolean {
	const child = relative(root, target);
	return child === '' ||
		(!isAbsolute(child) && !/^\.\.(?:[\\/]|$)/.test(child));
}

/** Detect navigation requests without hiding missing asset failures */
function shouldUseSpaFallback(
	ctx: StaticRouteContext<Record<string, string>>,
	path: string,
	options: ServeStaticOptions,
): boolean {
	if (!options.spaFallback || extname(path)) return false;
	return ctx.headers.get('accept')?.toLowerCase().includes('text/html') ??
		false;
}

/** Stream the selected file with MIME, validation, and cache headers */
async function sendStaticFile(
	ctx: StaticRouteContext<Record<string, string>>,
	file: StaticFile,
	options: ServeStaticOptions,
): Promise<Response> {
	const headers = new Headers(options.headers);
	const contentType = resolveContentType(file.path);
	const etag = createEntityTag(file.info);
	headers.set(
		'cache-control',
		resolveCacheControl(file.path, contentType, options),
	);
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

/** Map common frontend build extensions to browser-safe content types */
function resolveContentType(path: string): string {
	return CONTENT_TYPES[extname(path).toLowerCase()] ??
		'application/octet-stream';
}

/** Apply no-store to HTML and immutable caching only to hashed assets */
function resolveCacheControl(
	path: string,
	contentType: string,
	options: ServeStaticOptions,
): string {
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

/** Generate a stable weak validator without reading the file into memory */
function createEntityTag(info: Deno.FileInfo): string {
	const modified = info.mtime?.getTime() ?? 0;
	return `W/\"${info.size.toString(16)}-${modified.toString(16)}\"`;
}

/** Reject path traversal at any location in a relative path */
function hasParentSegment(path: string): boolean {
	return path.split('/').some((segment) => segment === '..');
}
