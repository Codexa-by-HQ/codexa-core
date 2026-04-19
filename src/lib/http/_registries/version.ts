import { Middleware, Router } from '@oak/oak';
import { AppContext, AppMiddleware, Empty, HttpMethod, IVersionedScope, SafeProvide, UseOptions, VersionedRouteEntry, VersionedRouterEntry } from '../mod.ts';
import { injectProvide } from '../helpers.ts';


export class VersionedRegistry {
	private readonly routes: VersionedRouteEntry[] = [];
	private readonly routers: VersionedRouterEntry[] = [];

	addRoute(entry: VersionedRouteEntry): void {
		this.routes.push(entry);
	}

	addRouter(entry: VersionedRouterEntry): void {
		this.routers.push(entry);
	}

	get routeCount(): number {
		return this.routes.length;
	}

	get routerCount(): number {
		return this.routers.length;
	}

	get isEmpty(): boolean {
		return this.routes.length === 0 && this.routers.length === 0;
	}

	/**
	 * O(k) tag control - iterates only registered versioned entries,
	 * not the full middleware pipeline.
	 */
	setEnabledByTags(tags: string[], enabled: boolean): void {
		const tagSet = new Set(tags);
		for (const entry of this.routes) {
			const entryTags = entry.options.tags ?? [];
			if (entryTags.some((t) => tagSet.has(t))) entry.enabled = enabled;
		}
		for (const entry of this.routers) {
			const entryTags = entry.options.tags ?? [];
			if (entryTags.some((t) => tagSet.has(t))) entry.enabled = enabled;
		}
	}

	inspectByTags(
		tags: string[],
	): { name: string; priority: string; enabled: boolean; tags: string[] }[] {
		const tagSet = new Set(tags);
		const results: {
			name: string;
			priority: string;
			enabled: boolean;
			tags: string[];
		}[] = [];

		for (const entry of this.routes) {
			const entryTags = entry.options.tags ?? [];
			if (entryTags.some((t) => tagSet.has(t))) {
				results.push({
					name: entry.options.name ??
						`v${entry.version}:${entry.method}:${entry.path}`,
					priority: 'VERSIONED',
					enabled: entry.enabled,
					tags: entryTags,
				});
			}
		}
		for (const entry of this.routers) {
			const entryTags = entry.options.tags ?? [];
			if (entryTags.some((t) => tagSet.has(t))) {
				results.push({
					name: entry.options.name ??
						`v${entry.version}:router:${entry.prefix}`,
					priority: 'VERSIONED',
					enabled: entry.enabled,
					tags: entryTags,
				});
			}
		}
		return results;
	}

	inspectAll(): {
		version: string;
		method: HttpMethod;
		path: string;
		name: string;
		enabled: boolean;
	}[] {
		const routeRows = this.routes.map((r) => ({
			version: r.version,
			method: r.method,
			path: r.path,
			name: r.options.name ?? `v${r.version}:${r.method}:${r.path}`,
			enabled: r.enabled,
		}));
		const routerRows = this.routers.map((r) => ({
			version: r.version,
			method: 'ROUTER' as HttpMethod,
			path: r.prefix,
			name: r.options.name ?? `v${r.version}:router:${r.prefix}`,
			enabled: r.enabled,
		}));
		return [...routeRows, ...routerRows];
	}

	/**
	 * Build and return a single Oak Router that dispatches all versioned
	 * routes and versioned routers. Returns null if nothing registered.
	 * Called once during CodexaHttp.#commit().
	 */
	buildRouter(): Router | null {
		if (this.isEmpty) return null;

		const router = new Router();

		// ── versioned individual routes ──
		for (const entry of this.routes) {
			const entryRef = entry;

			const versionGuard: Middleware = async (ctx, next) => {
                // if entry is disable
				if (!entryRef.enabled) {
					await next();
					return;
				}
                // if version not match
				if (
					ctx.request.headers.get('x-version')?.trim() !==
						entryRef.version
				) {
					await next();
					return;
				}
				const _vProvide = entryRef.options.provide;
				const _vHasStatic = _vProvide !== null &&
					_vProvide !== undefined &&
					typeof _vProvide !== 'function' &&
					Object.keys(_vProvide as object).length > 0;
                    
				const _vFlush = injectProvide(
					ctx as unknown as AppContext,
					_vProvide as
						| SafeProvide
						| ((data: unknown) => SafeProvide)
						| undefined,
				);
				if (_vHasStatic) {
					Object.assign(ctx.state, _vProvide);
				}
				try {
					await (entryRef.handler as Middleware)(ctx, next);
					_vFlush();
					if (entryRef.options.onSuccess) {
						await entryRef.options.onSuccess(
							ctx as unknown as AppContext,
						);
					}
				} catch (err) {
					_vFlush();
					if (entryRef.options.onError) {
						await entryRef.options.onError(
							ctx as unknown as AppContext,
							err,
						);
					} else {
						throw err;
					}
				}
			};

			const methodLower = entry.method.toLowerCase() as
				| 'get'
				| 'post'
				| 'put'
				| 'delete'
				| 'patch';
			router[methodLower](entry.path, versionGuard); // adding route to router not executing it yet
		}

		// ── versioned full routers ──
		for (const entry of this.routers) {
			const entryRef = entry;

			const wrapper = new Router();
			wrapper.use(entryRef.prefix, entryRef.routerInstance.routes());
			wrapper.use(
				entryRef.prefix,
				entryRef.routerInstance.allowedMethods(),
			);

			const wrappedRoutes = wrapper.routes() as AppMiddleware;
			const wrappedAllowed = wrapper
				.allowedMethods() as AppMiddleware;

			router.use(async (ctx, next) => {
                 // if entry is disable
				if (!entryRef.enabled) {
					await next();
					return;
				}
                 // if version not match
				if (
					ctx.request.headers.get('x-version')?.trim() !==
						entryRef.version
				) {
					await next();
					return;
				}

				const _vrProvide = entryRef.options.provide;
				const _vrHasStatic = _vrProvide !== null &&
					_vrProvide !== undefined &&
					typeof _vrProvide !== 'function' &&
					Object.keys(_vrProvide as object).length > 0;

				const _vrFlush = injectProvide(
					ctx as unknown as AppContext,
					_vrProvide as
						| SafeProvide
						| ((data: unknown) => SafeProvide)
						| undefined,
				);
				if (_vrHasStatic) {
					Object.assign(ctx.state, _vrProvide);
				}
				try {
					await (wrappedRoutes as unknown as Middleware)(ctx, next);
					_vrFlush();
					if (entryRef.options.onSuccess) { // on success handler
						await entryRef.options.onSuccess(
							ctx as unknown as AppContext,
						);
					}
				} catch (err) {
					_vrFlush();
					if (entryRef.options.onError) { // on error handler
						await entryRef.options.onError(
							ctx as unknown as AppContext,
							err,
						);
					} else {
						throw err;
					}
				}
			});

			router.use(async (ctx, next) => {
				if (!entryRef.enabled) {
					await next();
					return;
				}
				if (
					ctx.request.headers.get('x-version')?.trim() !==
						entryRef.version
				) {
					await next();
					return;
				}
				await (wrappedAllowed as unknown as Middleware)(ctx, next);
			});
		}

		return router;
	}
}

export class VersionedScope implements IVersionedScope {
	constructor(
		private readonly ver: string,
		private readonly registry: VersionedRegistry,
	) {}

	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addRoute('GET', path, handler, options);
	}
	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addRoute('POST', path, handler, options);
	}
	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addRoute('PUT', path, handler, options);
	}
	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addRoute('DELETE', path, handler, options);
	}
	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addRoute('PATCH', path, handler, options);
	}

	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		const opts = (options ?? {}) as unknown as UseOptions;
		this.registry.addRouter({
			version: this.ver,
			prefix,
			routerInstance,
			options: opts,
			enabled: opts.enabled ?? true,
		});
		return this;
	}

	private addRoute<P extends SafeProvide = Empty>(
		method: HttpMethod,
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		const opts = (options ?? {}) as unknown as UseOptions;
		this.registry.addRoute({
			version: this.ver,
			method,
			path,
			handler: handler as AppMiddleware,
			options: opts,
			enabled: opts.enabled ?? true,
		});
		return this;
	}
}