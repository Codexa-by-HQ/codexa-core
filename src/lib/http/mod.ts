/**
 * @module @codexa/core/http
 *
 * HTTP framework for Codexa applications.
 * Built on top of Oak - so no need to install `@oak/oak` separately.
 *
 * @example
 * ```ts
 * import { CodexaHttp, Router, MiddlewarePriority } from '@codexa/core/http';
 *
 * const app = new CodexaHttp({ name: 'MyAPI' });
 *
 * const usersRouter = new Router();
 * usersRouter.get('/', (ctx) => { ctx.response.body = { users: [] }; });
 *
 * app.router('/api/users', usersRouter);
 * app.get('/health', (ctx) => { ctx.response.body = { status: 'ok' }; });
 *
 * await app.boot();
 * await app.listen({ port: 8000 });
 * ```
 */

import { Application, Middleware, Router } from '@oak/oak';
import type { Context, Next, RouteParams, RouterContext } from '@oak/oak';
import type { DeviceInfo, RequestMetrics } from '../../types/app.d.ts';

// Re-export Oak's Router so consumers don't need @oak/oak as a direct dependency.
export { Router } from '@oak/oak';
export type { Context, Next, RouteParams, RouterContext } from '@oak/oak';

/**
 * Plugins augment this interface to inject typed state into `ctx.state`.
 *
 * @example — in your plugin's declaration file:
 * ```ts
 * declare module '@codexa/core/http' {
 *   interface PluginStateMap {
 *     auth: { userId: string; role: string; permissions: string[] }
 *   }
 * }
 * // Now ctx.state.auth.userId is fully typed
 * ```
 */
// deno-lint-ignore no-empty-interface
export interface PluginStateMap {}

type PluginState = {
	[K in keyof PluginStateMap]?: PluginStateMap[K];
};

export interface OakAppState extends PluginState {
	requestId?: string;
	startTime?: number;
	device?: DeviceInfo;
	metrics?: RequestMetrics;
}

export type SafeProvide = Omit<
	Record<string, unknown>,
	keyof OakAppState | keyof PluginStateMap
>;
export type Empty = Record<string, never>;

/**
 * Typed Oak context with optional state injection.
 * Includes the `provide(data)` method for dynamic per-request injection.
 * The handler calls `ctx.provide(data)` to store computed values;
 * the framework exposes them via the `provide` callback in UseOptions.
 */
export type AppContext<S extends SafeProvide = Empty> =
	& Context<
		OakAppState & S
	>
	& {
		provide(data: unknown): void;
	};

export type AppNext = Next;
export type AppMiddleware<
	P extends SafeProvide = Empty,
> = (
	ctx: AppContext<P>,
	next: AppNext,
) => Promise<void> | void;

/** Use AppRouterContext when your handler needs BOTH:
 * • ctx.state.*  (requestId, device, etc. - from IOakAppState)
 * • ctx.params.* (path params like /:id, /:userId    — from RouterContext)
 *
 * R = the route path string literal, e.g. '/users/:userId'
 *     Oak automatically infers ctx.params shape from R.
 *
 * S is always locked to IOakAppState so you never repeat it.
 */
export type AppRouterContext<
	R extends string,
	S extends SafeProvide = Empty,
> = RouterContext<
	R,
	RouteParams<R>,
	OakAppState & S
>;

export type LifeCyclePhase =
	| 'idle'
	| 'booting'
	| 'ready'
	| 'listening'
	| 'shutting_down'
	| 'stopped';

export type Hook = () => void | Promise<void>; // this hook can be used for shutdown or any other purpose

export enum MiddlewarePriority {
	/** Error boundary, CORS, helmet, body parsing, query parsing, content-type, timing, request ID, device parsing. */
	PRE_SETUP = 0,
	/** Any critical middleware should be placed here. */
	CRITICAL = 1,
	/** Auth parsing, token validation, session hydration. */
	AUTH = 20,
	/** RBAC, ABAC, permission checks. */
	SECURITY = 30,
	/** Business logic / controllers. */
	BUSINESS = 40,
	/** 404 handler, fallback routes. */
	FALLBACK = 50,
}

export const PRIORITY_LABELS: Record<number, string> = {
	[MiddlewarePriority.PRE_SETUP]: 'PRE_SETUP',
	[MiddlewarePriority.CRITICAL]: 'CRITICAL',
	[MiddlewarePriority.AUTH]: 'AUTH',
	[MiddlewarePriority.SECURITY]: 'SECURITY',
	[MiddlewarePriority.BUSINESS]: 'BUSINESS',
	[MiddlewarePriority.FALLBACK]: 'FALLBACK',
};

export interface ListenOptions {
	host?: string;
	port?: number;
	signal?: AbortSignal;
}

/** Internal processing entry stored in the registry. */
export interface MiddlewareEntry<P extends SafeProvide = Empty> {
	name: string;
	priority: number;
	handler: AppMiddleware<P>;
	order: number;
	tags: string[];
	enabled: boolean;
	/**
	 * When true, this entry is a tag-control sentinel for an HTTP-method shortcut
	 * route registered on the shared _methodRouter. The sentinel carries tags +
	 * enabled state but its handler is a no-op pass-through. It must NOT be
	 * flushed to Oak during #commit() - the real dispatch runs inside _methodRouter.
	 */
	isSentinel?: boolean;
}

/** What the developer provides when calling use() / get() / post() etc. */
export interface UseOptions<P extends SafeProvide = Empty> {
	name?: string;
	priority?: number;
	enabled?: boolean;
	tags?: string[];
	/**
	 * Static or dynamic state injection.
	 *
	 * **Static** (existing): pass a plain object — it is merged into `ctx.state`
	 * *before* the handler runs.
	 *   ```ts
	 *   provide: { tenantId: 'default' }
	 *   ```
	 *
	 * **Dynamic** (new): pass a callback — the handler calls `ctx.provide(data)`
	 * with any computed values; the framework calls this function with that data
	 * *after* the handler resolves and merges the return value into `ctx.state`.
	 *   ```ts
	 *   // inside handler:
	 *   ctx.provide({ userId: decoded.sub, role: decoded.role });
	 *
	 *   // in options:
	 *   provide: (data) => ({ userId: (data as any).userId, role: (data as any).role })
	 *   ```
	 *
	 * If the handler never calls `ctx.provide()` and `provide` is a function,
	 * nothing is merged into `ctx.state`.
	 */
	provide?: P | ((data: unknown) => P);
	onSuccess?: (ctx: AppContext<P>) => void | Promise<void>;
	onError?: (ctx: AppContext<P>, error: unknown) => void | Promise<void>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface VersionedRouteEntry {
	version: string;
	method: HttpMethod;
	path: string;
	handler: AppMiddleware;
	options: UseOptions;
	enabled: boolean; // runtime toggle (tags can flip this route)
}

export interface VersionedRouterEntry {
	version: string;
	prefix: string;
	routerInstance: Router;
	options: UseOptions;
	enabled: boolean; // runtime toggle (tags can flip this router)
}

export interface IVersionedScope {
	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this;
}

export interface ICodexaHttp {
	// unversioned middleware
	use<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		options?: UseOptions<P>,
	): this;
	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this;
	group<P extends SafeProvide = Empty>(
		groupName: string,
		items: Array<AppMiddleware<P> | Router>,
		options?: UseOptions<P>,
	): this;
	useIf<P extends SafeProvide = Empty>(
		condition: (ctx: AppContext<P>) => boolean | Promise<boolean>,
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	useSafe<P extends SafeProvide = Empty>(
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;

	// unversioned HTTP shortcuts
	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;

	// versioning -> exact X-Version header match
	version(v: string): IVersionedScope;

	// tag controls -> runtime enable/disable
	enableByTags(...tags: string[]): this;
	disableByTags(...tags: string[]): this;
	inspectByTags(
		...tags: string[]
	): { name: string; priority: string; enabled: boolean; tags: string[] }[];

	// lifecycle
	boot(setup?: () => Promise<void> | void): Promise<this>;
	listen(options?: ListenOptions): Promise<void>;
	shutdown(): Promise<void>;
	whenStopped(): Promise<void>;
	onShutdown(hook: Hook): this;

	// introspection
	inspect(): {
		name: string;
		priority: string;
		order: number;
		enabled: boolean;
		tags: string[];
	}[];
	inspectVersioned(): {
		version: string;
		method: HttpMethod;
		path: string;
		name: string;
		enabled: boolean;
	}[];

	// runtime state
	getPhase(): LifeCyclePhase;
	getApp(): Application<OakAppState>;
	get size(): number;
}

/**
 * Descriptive metadata attached to a plugin.
 * Surfaced in `app.inspectPlugins()` and useful for admin dashboards.
 */
export interface PluginMetadata {
	/** Short human-readable description of what this plugin does. */
	description?: string;
	/** Author name or contact email. */
	author?: string;
	/** SPDX license identifier, e.g. `"MIT"` or `"GPL-3.0"`. */
	license: string;
	/** Homepage or repository URL for documentation / issue tracking. */
	homepage?: string;
	/** Arbitrary keyword tags for categorisation (e.g. `['auth', 'security']`). */
	tags?: string[];
}
export interface IPluginScope {
	// same registration API as ICodexaHttp but scoped
	use<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		options?: UseOptions<P>,
	): this;
	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this;
	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	version(v: string): IVersionedScope;
	group<P extends SafeProvide = Empty>(
		groupName: string,
		items: Array<AppMiddleware<P> | Router>,
		options?: UseOptions<P>,
	): this;
	useIf<P extends SafeProvide = Empty>(
		condition: (ctx: AppContext<P>) => boolean | Promise<boolean>,
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	useSafe<P extends SafeProvide = Empty>(
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this;
	// scoped tag controls -> plugin runtime enable/disable
	enableByTags(...tags: string[]): this;
	disableByTags(...tags: string[]): this;
	inspectByTags(
		...tags: string[]
	): { name: string; priority: string; enabled: boolean; tags: string[] }[];

	/**
	 * Plugin-scoped init. Runs before routes register.
	 * Use for DB connections, queue init, loading config from env.
	 * Runs inside the boot() sequence automatically.
	 */
	init(setup: () => Promise<void> | void): this;

	/**
	 * Expose a service so sibling plugins or the root can access it.
	 *
	 * @example
	 * scope.exposeService('policyChecker', new PolicyChecker(db));
	 */
	exposeService<T>(name: string, service: T): this;

	/**
	 * Access a service exposed by another already-installed plugin.
	 * Throws if plugin or service not found.
	 *
	 * @example
	 * const policy = scope.getService<PolicyChecker>('Codexa-auth', 'policyChecker');
	 */
	getService<T>(pluginName: string, serviceName: string): T;

	/**
	 * Register a shutdown hook scoped to this plugin.
	 * Runs during app.shutdown() or app.uninstall().
	 */
	onShutdown(hook: Hook): this;

	/**
	 * Returns the declared dependency names of this plugin (its `dependsOn` array).
	 *
	 * @example
	 * const deps = scope.getDependencyNames(); // ['auth', 'db']
	 */
	getDependencyNames(): string[];

	/**
	 * Returns `true` if the given plugin is both declared in `dependsOn` AND
	 * currently installed. Safe to use as a guard before calling `getService`.
	 *
	 * @example
	 * if (scope.hasDependency('cache')) {
	 *   const cache = scope.getService<CacheService>('cache', 'client');
	 * }
	 */
	hasDependency(name: string): boolean;

	/**
	 * Get ALL services exposed by a dependency plugin at once as a typed record.
	 * Requires the plugin to be declared in `dependsOn`.
	 *
	 * @example
	 * const auth = scope.getDependencyServices<{ verify: VerifyFn }>('auth');
	 * const token = await auth.verify(rawToken);
	 */
	getDependencyServices<T extends Record<string, unknown>>(
		pluginName: string,
	): T;
}
/**
 * Root-provided dependency context passed to each plugin during install().
 * Type is intentionally generic — root decides what to share.
 *
 * Root passes:
 *   app.install(authPlugin, context, config)
 *
 * Plugin receives whatever root decided to put in context.
 * No hardcoded mongo/redis fields here — root owns that decision.
 *
 * Plugin authors should cast to their expected shape:
 * @example
 * const db = context.db as Db;
 * const redis = context.redis as RedisClient;
 */
export type CodexaPluginContext = Record<string, unknown>;

export interface CodexaPlugin<Config = Record<string, unknown>> {
	name: string;
	version: string; /** exact version string */
	metadata: PluginMetadata;

	/** Plugin names that must be installed before this one */
	dependsOn?: string[];

	/**
	 * Called during app.install(plugin).
	 * Plugin registers its routes, middleware, hooks, services, here using limited scope and will never touch the app directly.
	 * scope auto-tags all registrations with plugin.name.
	 */
	install(
		scope: IPluginScope,
		context: CodexaPluginContext,
		config?: Config,
	): Promise<void> | void;

	/**
	 * Called during app.uninstall(plugin.name).
	 * Plugin should clean up - disable its tags, remove hooks etc.
	 */
	uninstall?(scope: IPluginScope): Promise<void> | void;
}
// helpers
export * from './helpers.ts';

// Codexa-Http Components
export * from './_registries/http.ts';
export * from './_registries/version.ts';
export * from './_registries/plugin.ts';
