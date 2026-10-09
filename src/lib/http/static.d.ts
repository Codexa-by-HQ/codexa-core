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
import type { Context, Empty } from "./mod.d.ts";
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
type StaticRouteContext<Params extends Record<string, string>> = Pick<Context<Empty, Params>, 'request' | 'headers' | 'params'> & Pick<Context, 'text' | 'send' | 'stream'>;
/** Serve one static application request through a Codexa route context */
export declare function serveStatic<Params extends Record<string, string>>(ctx: StaticRouteContext<Params>, options: ServeStaticOptions): Promise<Response>;
export {};
