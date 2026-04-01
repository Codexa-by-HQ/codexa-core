/**
 * @module @codexa/core/http
 *
 * HTTP framework for Codexa applications.
 * Built on top of Oak — no need to install `@oak/oak` separately.
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
import { createLogger } from '../../utils/logger.ts';
import { eventBus } from '../bus/mod.ts';
import { sendInternalError, sendNotFound } from '../../utils/response.ts';
import { generateId } from '../../utils/crypto.ts';
import { formatDeviceShort } from '../../utils/device.ts';

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

/** Typed Oak context with optional state injection. */
export type AppContext<S extends SafeProvide = Empty> = Context<
	OakAppState & S
>;
export type AppNext = Next;
export type AppMiddleware<
	P extends SafeProvide = Empty,
> = (
	ctx: AppContext<P>,
	next: AppNext,
) => Promise<void> | void;

/** Use when you need both `ctx.state.*` and `ctx.params.*`. */
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
const PRIORITY_LABELS: Record<number, string> = {
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
	provide?: P;
	onSuccess?: (ctx: AppContext<P>) => void | Promise<void>;
	onError?: (ctx: AppContext<P>, error: unknown) => void | Promise<void>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface VersionedRouteEntry {
	version: string;
	method: HttpMethod;
	path: string;
	handler: AppMiddleware;
	options: UseOptions;
	enabled: boolean; // runtime toggle (tags can flip this route)
}

interface VersionedRouterEntry {
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

export interface PluginMetadata {
	description?: string;
	author?: string;
	//   dependencies?: string[];
	//   permissions?: string[];
	license: string;
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

/** Helpers */
function priorityLabel(p: number): string {
	return PRIORITY_LABELS[p] ?? `CUSTOM(${p})`;
}

// Browser auto-probe paths -> logged at DEBUG to reduce noise.
const BROWSER_PROBE_PATHS = new Set([
	'/favicon.ico',
	'/robots.txt',
	'/apple-touch-icon.png',
]);

function fnName(fn: unknown): string {
	return (fn as { name?: string }).name || 'anonymous';
}

function setFnName(fn: unknown, name: string): void {
	try {
		Object.defineProperty(fn, 'name', {
			value: name,
			configurable: true, //gives control of delete/redefine -> delete obj.id ❌ نہیں ہوگا if value is set to false
			// writable: false //gives control of property editable -> obj.id = 10 ❌ change نہیں ہوگا if value is set to false
			// enumerable: false //gives control of property visible in loops -> for(const key in obj) ❌ visible نہیں ہوگا if value is set to false
		});
	} catch {
		// fallback: ignore
	}
}

const log = createLogger('CodexaHttp');
const httpLog = createLogger('CodexaHttp:Http');

class EntryRegistry {
	/** Primary store: name -> entry. O(1) lookup by name. */
	private readonly store = new Map<string, MiddlewareEntry>();

	/**
	 * Tag index: tag -> Set of entries that carry that tag.
	 * Enables O(k) tag-based operations where k = matching entries only.
	 */
	private readonly tagIndex = new Map<string, Set<MiddlewareEntry>>();

	/** Monotonic insertion counter for stable sort. */
	private counter = 0;

	has(name: string): boolean {
		return this.store.has(name);
	}
	add(entry: Omit<MiddlewareEntry, 'order'>): MiddlewareEntry {
		if (this.store.has(entry.name)) {
			throw new Error(
				`CodexaHttp: Duplicate middleware name "${entry.name}". ` +
					'Provide a unique name via options.name.',
			);
		}

		const full: MiddlewareEntry = { ...entry, order: this.counter++ };
		this.store.set(full.name, full);

		// populate tag index
		for (const tag of full.tags) {
			let bucket = this.tagIndex.get(tag);
			if (!bucket) {
				bucket = new Set<MiddlewareEntry>();
				this.tagIndex.set(tag, bucket);
			}
			bucket.add(full);
		}
		return full;
	}
	sorted(): MiddlewareEntry[] {
		return Array.from(this.store.values()).sort((a, b) =>
			a.priority !== b.priority
				? a.priority - b.priority
				: a.order - b.order
		);
	}
	setEnabledByTags(tags: string[], enabled: boolean): string[] {
		const updated = new Set<string>();
		for (const tag of tags) {
			const bucket = this.tagIndex.get(tag);
			if (!bucket) continue;
			for (const entry of bucket) {
				entry.enabled = enabled;
				updated.add(entry.name);
			}
		}
		return Array.from(updated);
	}
	inspectByTags(
		tags: string[],
	): { name: string; priority: string; enabled: boolean; tags: string[] }[] {
		const seen = new Set<string>();
		const result: {
			name: string;
			priority: string;
			enabled: boolean;
			tags: string[];
		}[] = [];
		for (const tag of tags) {
			const bucket = this.tagIndex.get(tag);
			if (!bucket) continue;
			for (const entry of bucket) {
				if (seen.has(entry.name)) continue;
				seen.add(entry.name);
				result.push({
					name: entry.name,
					priority: priorityLabel(entry.priority),
					enabled: entry.enabled,
					tags: entry.tags,
				});
			}
		}
		return result;
	}
	inspectAll(): {
		name: string;
		priority: string;
		order: number;
		enabled: boolean;
		tags: string[];
	}[] {
		return this.sorted()
			.filter((entry) => !entry.name.startsWith('__')) // exclude internal methods for inspection purpose only
			.map((entry) => {
				return {
					name: entry.name,
					priority: priorityLabel(entry.priority),
					order: entry.order,
					enabled: entry.enabled,
					tags: entry.tags,
				};
			});
	}

	get size() {
		return this.store.size;
	}
	get currentOrder(): number {
		return this.counter;
	}
}

class LifecycleManager {
	private phase: LifeCyclePhase = 'idle';
	private readonly hooks: Hook[] = [];
	private abortController: AbortController | null = null;
	private signalHandler: (() => Promise<void>) | null = null;
	private listenPromise: Promise<void> | null = null;
	private listenResolve: (() => void) | null = null;
	private readonly log = createLogger('CodexaHttp:Lifecycle');

	getPhase(): LifeCyclePhase {
		return this.phase;
	}

	assertPhase(expected: LifeCyclePhase, action: string): void {
		if (this.phase !== expected) {
			throw new Error(
				`CodexaHttp: Cannot ${action} from phase "${this.phase}" - expected "${expected}".`,
			);
		}
	}

	transition(next: LifeCyclePhase): void {
		this.phase = next;
	}

	addHook(hook: Hook): void {
		this.hooks.push(hook);
	}

	registerSignalHandlers(onSignal: () => Promise<void>): void {
		// Guard: only register once (prevents memory leaks when listen() is called
		// multiple times in tests).
		if (this.signalHandler) return;

		this.signalHandler = onSignal;
		Deno.addSignalListener('SIGINT', this.signalHandler);
		if (Deno.build.os !== 'windows') {
			Deno.addSignalListener('SIGTERM', this.signalHandler);
		}
	}

	removeSignalHandlers(): void {
		if (!this.signalHandler) return;
		Deno.removeSignalListener('SIGINT', this.signalHandler);
		if (Deno.build.os !== 'windows') {
			Deno.removeSignalListener('SIGTERM', this.signalHandler);
		}
		this.signalHandler = null;
	}

	createAbortController(): AbortController {
		this.abortController = new AbortController();
		return this.abortController;
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	trackListenPromise(): Promise<void> {
		this.listenPromise = new Promise<void>((res) => {
			this.listenResolve = res;
		});
		return this.listenPromise;
	}

	resolveListenPromise(): void {
		this.listenResolve?.();
		this.listenResolve = null;
	}

	whenStopped(): Promise<void> {
		return this.listenPromise ?? Promise.resolve();
	}

	/** Run shutdown hooks in reverse registration order (stack unwinding). */
	async runHooks(): Promise<void> {
		for (let i = this.hooks.length - 1; i >= 0; i--) {
			try {
				await this.hooks[i]();
			} catch (err) {
				this.log.error(`Shutdown hook [${i}] failed:`, err);
			}
		}
	}
}

class VersionedRegistry {
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
	 * O(k) tag control – iterates only registered versioned entries,
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
				if (
					entryRef.options.provide &&
					Object.keys(entryRef.options.provide)?.length > 0
				) {
					Object.assign(ctx.state, entryRef.options.provide);
					// ctx.state = {
					// 	...(ctx.state ?? {}),
					// 	...entryRef.options.provide,
					// };
				}
				try {
					await (entryRef.handler as Middleware)(ctx, next);
					if (entryRef.options.onSuccess) {
						await entryRef.options.onSuccess(
							ctx as AppContext,
						);
					}
				} catch (err) {
					if (entryRef.options.onError) {
						await entryRef.options.onError(
							ctx as AppContext,
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

			router.use(async (ctx: AppContext, next: AppNext) => {
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
				if (
					entryRef.options.provide &&
					Object.keys(entryRef.options.provide)?.length > 0
				) {
					Object.assign(ctx.state, entryRef.options.provide); // context injection
					// ctx.state = {
					// 	...(ctx.state ?? {}),
					// 	...entryRef.options.provide,
					// };
				}
				try {
					await wrappedRoutes(ctx, next);
					if (entryRef.options.onSuccess) { // on success handler
						await entryRef.options.onSuccess(
							ctx as AppContext,
						);
					}
				} catch (err) {
					if (entryRef.options.onError) { // on error handler
						await entryRef.options.onError(
							ctx as AppContext,
							err,
						);
					} else {
						throw err;
					}
				}
			});

			router.use(async (ctx: AppContext, next: AppNext) => {
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
				await wrappedAllowed(ctx, next);
			});
		}

		return router;
	}
}

class VersionedScope implements IVersionedScope {
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

// ═══════════════════════════════════════════════════════════════════════════
//  Plugin System – PluginRegistry + PluginInstallScope
// ═══════════════════════════════════════════════════════════════════════════

/** Internal record for an installed plugin. */
interface InstalledPlugin {
	plugin: CodexaPlugin<Record<string, unknown>>;
	scope: PluginInstallScope;
	status: 'installed' | 'initialized' | 'uninstalled';
	installedAt: number;
}

const pluginLog = createLogger('CodexaHttp:Plugin');

/**
 * O(1)-amortised plugin & service registry.
 *
 * - Plugin store:   `Map<name, InstalledPlugin>`           → O(1) has/get/set/delete
 * - Service store:  `Map<pluginName, Map<svcName, svc>>`   → O(1) expose/get
 * - Dependency DAG: validated on install (eager) + topological sort in boot().
 */
class PluginRegistry {
	/** name → InstalledPlugin. O(1) lookup. */
	private readonly store = new Map<string, InstalledPlugin>();

	/** pluginName → Map<serviceName, serviceInstance>. O(1) × O(1). */
	private readonly services = new Map<string, Map<string, unknown>>();

	// ── plugin store ──

	has(name: string): boolean {
		return this.store.has(name);
	}

	get(name: string): InstalledPlugin | undefined {
		return this.store.get(name);
	}

	set(name: string, entry: InstalledPlugin): void {
		this.store.set(name, entry);
	}

	delete(name: string): boolean {
		this.services.delete(name);
		return this.store.delete(name);
	}

	get size(): number {
		return this.store.size;
	}

	entries(): IterableIterator<[string, InstalledPlugin]> {
		return this.store.entries();
	}

	// ── dependency validation ──

	/**
	 * Check that every declared dependency is already installed.
	 * O(d) where d = number of dependsOn entries (typically ≤5).
	 */
	validateDependencies(plugin: CodexaPlugin): void {
		for (const dep of plugin.dependsOn ?? []) {
			if (!this.store.has(dep)) {
				throw new Error(
					`CodexaHttp: Plugin "${plugin.name}" requires "${dep}" — install it first.`,
				);
			}
		}
	}

	/**
	 * Detect circular dependencies across ALL installed plugins.
	 * Uses Kahn's algorithm (BFS topological sort).
	 *
	 * Returns the topologically sorted plugin names (dependencies first).
	 * Throws if a cycle is detected, naming the offending plugins.
	 */
	topologicalSort(): string[] {
		const names = Array.from(this.store.keys());
		if (names.length === 0) return [];

		// Build in-degree map + adjacency (Set-based for O(1) add).
		const inDegree = new Map<string, number>();
		const dependents = new Map<string, Set<string>>(); // dep → Set<plugins that depend on it>

		for (const name of names) {
			inDegree.set(name, 0);
			if (!dependents.has(name)) dependents.set(name, new Set());
		}

		for (const [name, { plugin }] of this.store) {
			for (const dep of plugin.dependsOn ?? []) {
				// Only count dependencies that are in the plugin set.
				if (this.store.has(dep)) {
					inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
					let bucket = dependents.get(dep);
					if (!bucket) {
						bucket = new Set();
						dependents.set(dep, bucket);
					}
					bucket.add(name);
				}
			}
		}

		// BFS: start with all zero-in-degree nodes.
		const queue: string[] = [];
		for (const [name, deg] of inDegree) {
			if (deg === 0) queue.push(name);
		}

		const sorted: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) break;
			sorted.push(current);
			for (const dependent of dependents.get(current) ?? []) {
				const newDeg = (inDegree.get(dependent) ?? 1) - 1;
				inDegree.set(dependent, newDeg);
				if (newDeg === 0) queue.push(dependent);
			}
		}

		if (sorted.length < names.length) {
			const cycled = names.filter((n) => !sorted.includes(n));
			throw new Error(
				`CodexaHttp: Circular plugin dependency detected among: [${
					cycled.join(', ')
				}]. ` +
					'Review dependsOn declarations and remove the cycle.',
			);
		}

		return sorted;
	}

	// ── service registry (O(1) × O(1)) ──

	exposeService(pluginName: string, name: string, service: unknown): void {
		let bucket = this.services.get(pluginName);
		if (!bucket) {
			bucket = new Map<string, unknown>();
			this.services.set(pluginName, bucket);
		}
		if (bucket.has(name)) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" already exposes service "${name}".`,
			);
		}
		bucket.set(name, service);
	}

	getService<T>(pluginName: string, serviceName: string): T {
		const bucket = this.services.get(pluginName);
		if (!bucket) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" is not installed or has no exposed services.`,
			);
		}
		if (!bucket.has(serviceName)) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" has no service named "${serviceName}".`,
			);
		}
		return bucket.get(serviceName) as T;
	}

	hasService(pluginName: string, serviceName: string): boolean {
		return this.services.get(pluginName)?.has(serviceName) ?? false;
	}

	serviceNames(pluginName: string): string[] {
		return Array.from(this.services.get(pluginName)?.keys() ?? []);
	}

	deleteServices(pluginName: string): void {
		this.services.delete(pluginName);
	}

	// ── introspection ──

	inspectAll(): {
		name: string;
		version: string;
		status: string;
		installedAt: number;
		services: string[];
		dependsOn: string[];
	}[] {
		return Array.from(this.store.entries()).map(
			([name, { plugin, status, installedAt }]) => ({
				name,
				version: plugin.version,
				status,
				installedAt,
				services: this.serviceNames(name),
				dependsOn: plugin.dependsOn ?? [],
			}),
		);
	}
}

/**
 * Sandboxed scope given to each plugin during install().
 *
 * Rules:
 * - Blocks boot(), listen(), shutdown() — plugins cannot control the server lifecycle.
 * - Auto-tags every registration with the plugin name for O(1) tag lookups.
 * - Scopes provide values under ctx.state[pluginName] to prevent cross-plugin collisions.
 * - enableByTags/disableByTags only affect this plugin's own entries.
 */
class PluginInstallScope implements IPluginScope {
	private readonly pluginName: string;
	private readonly host: CodexaHttp;
	private readonly registry: PluginRegistry;
	private _initFn: (() => Promise<void> | void) | null = null;
	private readonly _shutdownHooks: Hook[] = [];

	constructor(
		pluginName: string,
		host: CodexaHttp,
		registry: PluginRegistry,
	) {
		this.pluginName = pluginName;
		this.host = host;
		this.registry = registry;
	}

	// ── option rewriting (auto-tag + scoped provide) ──

	/**
	 * Rewrites UseOptions so that:
	 * 1. The plugin name is always in the tags array (O(1) tag-based control).
	 * 2. Any provide values are scoped: `{ key: val }` → `{ [pluginName]: { key: val } }`
	 *    so they land in `ctx.state[pluginName].key`, not `ctx.state.key`.
	 * 3. Names are prefixed with `pluginName:` to avoid global collisions.
	 */
	private scopeOptions<P extends SafeProvide>(
		options?: UseOptions<P>,
	): UseOptions<P> {
		const tags = options?.tags ? [...options.tags] : [];
		// Always include the plugin name tag — Set-like dedup via indexOf.
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);

		// Prefix name if provided so it is globally unique.
		const name = options?.name
			? `${this.pluginName}:${options.name}`
			: undefined;

		// Scope provide under plugin namespace.
		const provide = options?.provide
			? ({ [this.pluginName]: options.provide } as unknown as P)
			: undefined;

		return {
			...options,
			name,
			tags,
			provide,
		};
	}

	/**
	 * Scope options for router() which omits 'name' from the options type.
	 */
	private scopeRouterOptions<P extends SafeProvide>(
		options?: Omit<UseOptions<P>, 'name'>,
	): Omit<UseOptions<P>, 'name'> {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);

		const provide = options?.provide
			? ({ [this.pluginName]: options.provide } as unknown as P)
			: undefined;

		return {
			...options,
			tags,
			provide,
		};
	}

	// ── delegated registration API ──

	use<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		options?: UseOptions<P>,
	): this {
		this.host.use(item, this.scopeOptions(options));
		return this;
	}

	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.get(path, handler, this.scopeOptions(options));
		return this;
	}

	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.post(path, handler, this.scopeOptions(options));
		return this;
	}

	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.put(path, handler, this.scopeOptions(options));
		return this;
	}

	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.delete(path, handler, this.scopeOptions(options));
		return this;
	}

	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.patch(path, handler, this.scopeOptions(options));
		return this;
	}

	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		this.host.router(
			prefix,
			routerInstance,
			this.scopeRouterOptions(options),
		);
		return this;
	}

	version(v: string): IVersionedScope {
		// Return a wrapped VersionedScope that auto-tags.
		return new PluginVersionedScope(
			v,
			this.host,
			this.pluginName,
		);
	}

	group<P extends SafeProvide = Empty>(
		groupName: string,
		items: Array<AppMiddleware<P> | Router>,
		options?: UseOptions<P>,
	): this {
		this.host.group(
			`${this.pluginName}:${groupName}`,
			items,
			this.scopeOptions(options),
		);
		return this;
	}

	useIf<P extends SafeProvide = Empty>(
		condition: (ctx: AppContext<P>) => boolean | Promise<boolean>,
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.useIf(condition, item, this.scopeOptions(options));
		return this;
	}

	useSafe<P extends SafeProvide = Empty>(
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.useSafe(item, this.scopeOptions(options));
		return this;
	}

	// ── plugin-scoped tag controls ──
	// Scoping is already enforced at registration time via scopeOptions()
	// which auto-tags every entry with this plugin's name. The plugin
	// developer is responsible for using tags they themselves registered.

	enableByTags(...tags: string[]): this {
		this.host.enableByTags(...tags);
		return this;
	}

	disableByTags(...tags: string[]): this {
		this.host.disableByTags(...tags);
		return this;
	}

	inspectByTags(
		...tags: string[]
	): { name: string; priority: string; enabled: boolean; tags: string[] }[] {
		return this.host.inspectByTags(...tags);
	}

	// ── plugin lifecycle ──

	init(setup: () => Promise<void> | void): this {
		if (this._initFn) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" already has an init() registered. ` +
					'Call init() only once per plugin.',
			);
		}
		this._initFn = setup;
		return this;
	}

	// ── service inter-plugin communication ──

	exposeService<T>(name: string, service: T): this {
		this.registry.exposeService(this.pluginName, name, service);
		pluginLog.debug(
			`Plugin "${this.pluginName}" exposed service: "${name}"`,
		);
		return this;
	}

	getService<T>(pluginName: string, serviceName: string): T {
		// Guard: cannot access own services via getService (use local refs).
		if (pluginName === this.pluginName) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" cannot call getService() on itself — use a local reference.`,
			);
		}
		// Guard: target plugin must be installed.
		if (!this.registry.has(pluginName)) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" is not installed. ` +
					`Add it to "${this.pluginName}".dependsOn to guarantee install order.`,
			);
		}
		return this.registry.getService<T>(pluginName, serviceName);
	}

	onShutdown(hook: Hook): this {
		this._shutdownHooks.push(hook);
		return this;
	}

	// ── internal helpers (called by CodexaHttp, not by plugins) ──

	/** Run the plugin's init() during boot sequence. */
	async _runInit(): Promise<void> {
		if (this._initFn) {
			await this._initFn();
		}
	}

	/** Run shutdown hooks in reverse order (stack unwinding). */
	async _runShutdownHooks(): Promise<void> {
		for (let i = this._shutdownHooks.length - 1; i >= 0; i--) {
			try {
				await this._shutdownHooks[i]();
			} catch (err) {
				pluginLog.error(
					`Shutdown hook for plugin "${this.pluginName}" failed:`,
					err,
				);
			}
		}
	}

	/** Disable all middleware tagged with this plugin's name. */
	_disableAll(): void {
		this.host.disableByTags(this.pluginName);
	}
}

/**
 * Versioned scope wrapper that auto-tags registrations with the plugin name.
 * Ensures that version().get(...) calls from a plugin are still scoped.
 */
class PluginVersionedScope implements IVersionedScope {
	constructor(
		private readonly ver: string,
		private readonly host: CodexaHttp,
		private readonly pluginName: string,
	) {}

	private scopeOpts<P extends SafeProvide>(
		options?: UseOptions<P>,
	): UseOptions<P> {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);
		const name = options?.name
			? `${this.pluginName}:${options.name}`
			: undefined;
		const provide = options?.provide
			? ({ [this.pluginName]: options.provide } as unknown as P)
			: undefined;
		return { ...options, name, tags, provide };
	}

	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).get(path, handler, this.scopeOpts(options));
		return this;
	}

	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).post(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).put(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).delete(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).patch(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);
		const provide = options?.provide
			? ({ [this.pluginName]: options.provide } as unknown as P)
			: undefined;
		this.host.version(this.ver).router(prefix, routerInstance, {
			...options,
			tags,
			provide,
		});
		return this;
	}
}

/**
 * Options for creating a {@link CodexaHttp} instance.
 */
export interface CodexaHttpOptions {
	/**
	 * Application name. Used in log output and for isolation when running
	 * multiple CodexaHttp instances.
	 *
	 * @default 'CodexaApp'
	 */
	name?: string;
}

export class CodexaHttp implements ICodexaHttp {
	private readonly app: Application<OakAppState>;
	private readonly entries: EntryRegistry;
	private readonly versioned: VersionedRegistry;
	private readonly lifecycle: LifecycleManager;
	private readonly plugins: PluginRegistry;

	private readonly _methodRouter: Router;
	private _methodRouterRegistered: boolean = false;

	/** Application name for logging and identification. */
	public readonly name: string;

	#committed: boolean = false;

	constructor(options?: CodexaHttpOptions) {
		this.name = options?.name ?? 'CodexaApp';
		this.app = new Application<OakAppState>();
		this.entries = new EntryRegistry();
		this.versioned = new VersionedRegistry();
		this.lifecycle = new LifecycleManager();
		this.plugins = new PluginRegistry();
		this._methodRouter = new Router();

		// Bind Oak's native error event immediately.
		this.app.addEventListener('error', (e) => {
			const error = e.error instanceof Error
				? e.error
				: new Error(String(e.error ?? 'Unknown error'));
			log.error(`[${this.name}] Uncaught Oak error:`, { error });
			eventBus.emit('oak', 'error', {
				error,
				app: this.name,
				message: error.message,
				stack: error.stack,
			}, { distributed: false });
		});
	}

	// ***************** Private Helpers ********************
	private assertNotCommitted(action: string): void {
		if (this.#committed) {
			throw new Error(
				`CodexaHttp: Cannot ${action} after middleware has been committed. ` +
					'Register all middleware before calling boot().',
			);
		}
	}

	/**
	 * Derive a stable auto-name from a function or Router.
	 * Falls back to a counter-based name when the function is anonymous.
	 */
	private autoName<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		prefix: string,
	): string {
		if (
			!(item instanceof Router) &&
			item.name &&
			item.name !== '' &&
			item.name !== 'mw_'
		) {
			return item.name;
		}
		return `${prefix}_${this.entries.currentOrder}`;
	}

	/**
	 * Wrap a raw handler with provide injection + onSuccess/onError lifecycle.
	 * Returns a new AppMiddleware; does not mutate the original.
	 */
	private wrapHandler<P extends SafeProvide = Empty>(
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): AppMiddleware {
		const provide = options?.provide;
		const onSuccess = options?.onSuccess;
		const onError = options?.onError;

		// Fast path: nothing to wrap -> return as-is (avoids an extra async frame)
		const hasProvide = provide !== null && provide !== undefined &&
			Object.keys(provide).length > 0;
		if (!hasProvide && !onSuccess && !onError) {
			return handler as AppMiddleware;
		}
		// if (!provide && !onSuccess && !onError) {
		// 	return handler as AppMiddleware;
		// }

		const wrapped: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		) => {
			if (provide && Object.keys(provide)?.length > 0) {
				Object.assign(ctx.state, provide); // context injection
				// ctx.state = {
				// 	...(ctx.state ?? {}),
				// 	...provide,
				// };
			}
			try {
				await (handler as AppMiddleware)(ctx, next);
				if (onSuccess) await onSuccess(ctx as AppContext<P>); // success handler
			} catch (err) {
				if (onError) { // error handler
					await onError(ctx as AppContext<P>, err);
				} else {
					throw err;
				}
			}
		};
		return wrapped;
	}

	/**
	 * Core registration: wraps the handler and inserts into EntryRegistry.
	 */
	private pushEntry<P extends SafeProvide = Empty>(
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
		fallbackName?: string,
	): this {
		const name = options?.name ?? fallbackName ??
			this.autoName(handler, 'mw');
		const priority = options?.priority ?? MiddlewarePriority.BUSINESS;
		const enabled = options?.enabled ?? true;
		const tags = options?.tags ?? [];

		const wrappedHandler = this.wrapHandler(handler, options); // wrap handler with provide injection + onSuccess/onError lifecycle

		// add to entry registry
		this.entries.add({
			name,
			priority,
			handler: wrappedHandler,
			tags,
			enabled,
		});
		log.debug(
			`Registered middleware: "${name}" [${priorityLabel(priority)}]`,
		);
		return this;
	}

	/**
	 * Register an Oak Router into the pipeline.
	 * Extracts .routes() + .allowedMethods() and pushes both as separate entries
	 * so they appear individually in inspect() output.
	 */
	private useRouter<P extends SafeProvide = Empty>(
		routerInstance: Router,
		options?: UseOptions<P>,
	): this {
		const baseName = options?.name ?? `router_${this.entries.currentOrder}`;
		const priority = options?.priority ?? MiddlewarePriority.BUSINESS;
		const enabled = options?.enabled ?? true;
		const tags = options?.tags ?? [];
		const provide = options?.provide;
		const onSuccess = options?.onSuccess;
		const onError = options?.onError;

		const routesName = `${baseName}:routes`;
		const methodsName = `${baseName}:allowedMethods`;

		if (
			this.entries.has(routesName) || this.entries.has(methodsName)
		) {
			throw new Error(
				`CodexaHttp: Duplicate router name "${baseName}". ` +
					'Provide a unique name via options.name.',
			);
		}

		// Wrap .routes() with provide/onSuccess/onError lifecycle hooks.
		const rawRoutes = routerInstance.routes() as AppMiddleware;
		const wrappedRoutes: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		) => {
			if (provide && Object.keys(provide)?.length > 0) {
				Object.assign(ctx.state, provide); // context injection
				// ctx.state = {
				// 	...(ctx.state ?? {}),
				// 	...provide,
				// };
			}
			try {
				await rawRoutes(ctx, next);
				if (onSuccess) await onSuccess(ctx as AppContext<P>); // success handler
			} catch (err) {
				if (onError) { // error handler
					await onError(ctx as AppContext<P>, err);
				} else {
					throw err;
				}
			}
		};

		this.entries.add({
			name: routesName,
			priority,
			handler: wrappedRoutes,
			tags,
			enabled,
		});

		// .allowedMethods() is a pure HTTP 405 responder - no lifecycle hooks needed.
		this.entries.add({
			name: methodsName,
			priority,
			handler: routerInstance.allowedMethods() as AppMiddleware,
			tags,
			enabled,
		});

		log.debug(
			`Registered router: "${baseName}" [${priorityLabel(priority)}]`,
		);
		return this;
	}

	/**
	 * Register an HTTP-method shortcut route onto the single shared _methodRouter.
	 *
	 * Each route gets a thin per-request wrapper that handles:
	 *   - runtime enabled check    (tags can toggle this at any time)
	 *   - provide injection        (ctx.state extension)
	 *   - onSuccess / onError hooks
	 *
	 * The shared _methodRouter is registered into EntryRegistry exactly once
	 * (on first use) so it appears in inspect() output.
	 */
	private addMethodRoute<P extends SafeProvide = Empty>(
		method: HttpMethod,
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.assertNotCommitted(`${method.toLowerCase()}()`);

		const name = options?.name ?? `${method}:${path}`;
		const provide = options?.provide;
		const onSuccess = options?.onSuccess;
		const onError = options?.onError;
		const tags = options?.tags ?? [];

		// Guard against duplicate route names before touching any state.
		if (this.entries.has(name)) {
			throw new Error(
				`CodexaHttp: Duplicate route name "${name}". ` +
					'Provide a unique name via options.name.',
			);
		}

		/** Sentinel entry -> carries tags + enabled so tag control methods work on individual routes. The handler is intentionally a no-op pass through, the real dispatch happens inside the shared _methodRouter via the wrapper below. isSentinal:true tell the #commit() to skip flushing this to Oak. simply its a dummy entry use to control configurations of each route.*/
		const sentinel: AppMiddleware = async (
			_ctx: AppContext,
			next: AppNext,
		) => {
			await next();
		};
		setFnName(sentinel, name);

		const priority = options?.priority ?? MiddlewarePriority.BUSINESS;
		const sentinelEntry = this.entries.add({
			name,
			priority,
			handler: sentinel,
			tags,
			enabled: options?.enabled ?? true,
			isSentinel: true,
		});

		/** The real per-route handler. Closes over sentinelEntry so it reads the live enabled flag that tag controls may flip at runtime. */
		const wrappedHandler: AppMiddleware<P> = async (
			ctx: AppContext<P>,
			next: AppNext,
		) => {
			// Mirror the sentinel's live enabled flag at request time.
			if (!sentinelEntry?.enabled) {
				await next();
				return;
			}
			// inject provide
			if (provide && Object.keys(provide)?.length > 0) {
				Object.assign(ctx.state, provide); // context injection
				// ctx.state = {
				// 	...(ctx.state ?? {}),
				// 	...provide,
				// };
			}
			// run handler
			try {
				await (handler as AppMiddleware<P>)(ctx, next);
				// run onSuccess if provided
				if (onSuccess) {
					await onSuccess(ctx);
				}
			} catch (error) {
				// run onError if provided
				if (onError) {
					await onError(ctx, error);
				} else {
					// otherwise rethrow to let Oak handle it
					throw error;
				}
			}
		};

		const methodLower = method.toLowerCase() as
			| 'get'
			| 'post'
			| 'put'
			| 'delete'
			| 'patch';
		this._methodRouter[methodLower](path, wrappedHandler); // registering route in oak router not executing yet, execution happen in #commit() when oak router is flushed to oak app

		/** Register the shared _methodRouter into EntryRegistry on first use. This ensures it appears in inspect() and is flushed to Oak during #commit() - but only once, no matter how many routes are added.*/
		if (!this._methodRouterRegistered) {
			this._methodRouterRegistered = true;
			/** Register at BUSINESS priority so it interleaves correctly with any user-registered middleware. The sentinel entries above carry each route's individual priority for inspect() purposes.*/
			this.entries.add({
				name: '__methodRouter:routes',
				priority: MiddlewarePriority.BUSINESS,
				handler: this._methodRouter.routes() as AppMiddleware,
				tags: [],
				enabled: true,
			});
			this.entries.add({
				name: '__methodRouter:allowedMethods',
				priority: MiddlewarePriority.BUSINESS,
				handler: this._methodRouter.allowedMethods() as AppMiddleware,
				tags: [],
				enabled: true,
			});
		}

		log.debug(
			`Registered route: "${name}" [${priorityLabel(priority)}]`,
		);
		return this;
	}

	// ***************** Built-in Middlewares ********************
	/**
	 * Error Boundary - outermost middleware.
	 * Wraps the entire pipeline. Catches any uncaught error, logs it,
	 * returns a 500 JSON response, and prevents the server from crashing.
	 */
	private errorBoundary(): Middleware {
		return async (ctx, next) => {
			try {
				await next();
			} catch (err) {
				const error = err instanceof Error
					? err
					: new Error(String(err));

				log.error('Unhandled request error:', {
					method: ctx.request.method,
					url: ctx.request.url.pathname,
					error: error.message,
					stack: error.stack,
				});

				eventBus.emit('oak', 'request:error', {
					error,
					method: ctx.request.method,
					path: ctx.request.url.pathname,
					requestId: (ctx.state as OakAppState).requestId,
				}, { distributed: false });

				if (!ctx.response.writable) return;
				sendInternalError(ctx);
			}
		};
	}

	/**
	 * Request Lifecycle - pre/post flow middleware.
	 *
	 * PRE  (before next): generate requestId, record start time.
	 * HANDLER: await next() - business logic executes.
	 * POST (after next): calculate duration, set response headers,
	 *                    emit morgan-style HTTP log line.
	 */
	private requestLifecycle(): AppMiddleware {
		return async (ctx: AppContext, next: AppNext) => {
			// PRE
			const requestId = generateId();
			const startTime = performance.now();

			ctx.state.requestId = requestId;
			ctx.state.startTime = startTime;

			const deviceShort = ctx.state.device
				? formatDeviceShort(ctx.state.device)
				: 'unknown';

			// HANDLER
			await next();

			// POST
			const durationMs = performance.now() - startTime;
			const durationStr = durationMs.toFixed(2);

			ctx.response.headers.set('X-Request-Id', requestId);
			ctx.response.headers.set('X-Response-Time', `${durationStr}ms`);

			const { method, url, headers, ip } = ctx.request;
			const path = url.pathname;
			const search = url.search || '';
			const status = ctx.response.status;

			// Size estimation - avoids JSON.stringify on object bodies.
			const clHeader = headers.get('Content-Length');
			let sizeStr: string;
			if (clHeader) {
				sizeStr = `${clHeader}b`;
			} else {
				const body = ctx.response.body;
				if (body === null) {
					sizeStr = '0b';
				} else if (typeof body === 'string') {
					sizeStr = `${body.length}b`;
				} else if (body instanceof Uint8Array) {
					sizeStr = `${body.byteLength}b`;
				} else {
					sizeStr = '-';
				}
			}

			const logLine =
				`-> ${method} ${path}${search} ${status} ${durationStr}ms ${sizeStr} ${ip} rid:${requestId} [${deviceShort}]`;

			if (
				BROWSER_PROBE_PATHS.has(path) ||
				path.startsWith('/.well-known/')
			) {
				httpLog.debug(logLine);
			} else if (status >= 500) {
				httpLog.error(logLine);
			} else if (status >= 400) {
				httpLog.warn(logLine);
			} else {
				httpLog.info(logLine);
			}
		};
	}

	/**
	 * Not-Found handler - sits at the very end of the pipeline.
	 * Returns a structured JSON 404 when no middleware has set a response body.
	 */
	private notFoundMiddleware(): AppMiddleware {
		return async (ctx: AppContext, next: AppNext) => {
			await next();
			if (ctx.response.status === 404) {
				sendNotFound(
					ctx,
					`Route not found: ${ctx.request.method} ${ctx.request.url.pathname}`,
				);
			}
		};
	}

	// ****************** Public API Http Methods Shortcuts/use/router etc.. ********************
	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addMethodRoute('GET', path, handler, options);
	}
	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addMethodRoute('POST', path, handler, options);
	}
	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addMethodRoute('PUT', path, handler, options);
	}
	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addMethodRoute('DELETE', path, handler, options);
	}
	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		return this.addMethodRoute('PATCH', path, handler, options);
	}
	/**
	 * Register middleware or a Router.
	 *
	 * Accepts:
	 * - AppMiddleware (typed middleware function)
	 * - Router (Oak Router; .routes() + .allowedMethods() extracted automatically)
	 */
	use<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		options?: UseOptions<P>,
	): this {
		this.assertNotCommitted('use()');
		if (item instanceof Router) return this.useRouter(item, options);
		return this.pushEntry(item, options); //
	}
	/**
	 * Mount a router under a path prefix.
	 *
	 * Example:
	 *   app.router('/users', usersRouter)
	 */
	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		this.assertNotCommitted('router()');
		const name = `route:${prefix}`;
		const wrapper = new Router();
		wrapper.use(prefix, routerInstance.routes());
		wrapper.use(prefix, routerInstance.allowedMethods());
		return this.use(
			wrapper,
			{ ...options, name } as UseOptions<P>,
		);
	}
	/**
	 * Register a middleware group.
	 * All items share the same priority and options.
	 */
	group<P extends SafeProvide = Empty>(
		groupName: string,
		items: Array<AppMiddleware<P> | Router>,
		options?: UseOptions<P>,
	): this {
		this.assertNotCommitted('group()');

		for (let i = 0; i < items.length; i++) {
			const entry = items[i];
			const entryName = `${groupName}:${
				entry instanceof Router
					? `router_${i}`
					: fnName(entry) !== 'anonymous'
					? fnName(entry)
					: i
			}`;

			if (entry instanceof Router) {
				this.use(entry, {
					...options,
					name: entryName,
				} as UseOptions<P>);
			} else {
				this.pushEntry(entry, {
					...options,
					name: entryName,
				} as UseOptions<P>);
			}
		}

		log.debug(`Registered group: "${groupName}" (${items.length} items)`);
		return this;
	}
	/**
	 * Register middleware that only runs when the runtime condition returns true.
	 * The condition is evaluated per-request (differs from `enabled: false`
	 * which is a registration-time flag).
	 */
	useIf<P extends SafeProvide = Empty>(
		condition: (ctx: AppContext<P>) => boolean | Promise<boolean>,
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.assertNotCommitted('useIf()');

		const conditionalHandler: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		): Promise<void> => {
			const shouldRun = await condition(ctx as AppContext<P>);
			if (shouldRun) {
				await (item as AppMiddleware)(ctx, next);
			} else {
				await next();
			}
		};

		setFnName(
			conditionalHandler,
			options?.name ?? `useIf:${fnName(item)}`,
		);
		return this.pushEntry(
			conditionalHandler as AppMiddleware<P>,
			options,
		);
	}

	/**
	 * Wrap a middleware with per-middleware error handling (try/catch).
	 * Errors are caught, logged, and either handled via onError or a 500 is returned.
	 * The server stays alive.
	 */
	useSafe<P extends SafeProvide = Empty>(
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.assertNotCommitted('useSafe()');

		const safeHandler: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		): Promise<void> => {
			try {
				await (item as AppMiddleware)(ctx, next);
			} catch (err) {
				const middlewareName = options?.name ?? fnName(item);
				const error = err instanceof Error
					? err
					: new Error(String(err));

				log.error(
					`[useSafe] Middleware error in "${middlewareName}": ${error.message}`,
					err,
				);

				eventBus.emit('oak', 'middleware:error', {
					error,
					middleware: middlewareName,
					method: ctx.request.method,
					path: ctx.request.url.pathname,
					requestId: ctx.state.requestId,
				}, { distributed: false });

				if (options?.onError) {
					await options.onError(ctx as AppContext<P>, err);
					return;
				}

				sendInternalError(ctx);
			}
		};

		setFnName(safeHandler, options?.name ?? `useSafe:${fnName(item)}`);
		return this.pushEntry(
			safeHandler as AppMiddleware<P>,
			options,
		);
	}
	// ****************** Public API (versioning) cont.. ********************
	/**
	 * Create a versioned scope. Routes registered through this scope
	 * require the `X-Version` header to exactly match the version string.
	 *
	 * @example
	 * app.version('1.0.0').get('/api/users', listUsersV1);
	 * app.version('2.0.0').get('/api/users', listUsersV2);
	 */
	version(v: string): IVersionedScope {
		this.assertNotCommitted('version()');
		return new VersionedScope(v, this.versioned);
	}
	// ****************** Public API (tags controls) cont.. ********************
	/**
	 * Disable all middleware/routes that carry ANY of the given tags.
	 * O(k) where k = number of matching entries - does not walk the full pipeline.
	 */
	disableByTags(...tags: string[]): this {
		const updated = this.entries.setEnabledByTags(tags, false);
		this.versioned.setEnabledByTags(tags, false);
		log.info(
			`Disabled [${updated.join(', ')}] by tags: [${tags.join(', ')}]`,
		);
		return this;
	}

	/**
	 * Enable all middleware/routes that carry ANY of the given tags.
	 * O(k) where k = number of matching entries - does not walk the full pipeline.
	 */
	enableByTags(...tags: string[]): this {
		const updated = this.entries.setEnabledByTags(tags, true);
		this.versioned.setEnabledByTags(tags, true);
		log.info(
			`Enabled [${updated.join(', ')}] by tags: [${tags.join(', ')}]`,
		);
		return this;
	}
	/**
	 * Inspect all middleware/routes associated with the given tags.
	 * O(k) where k = number of matching entries.
	 */
	inspectByTags(
		...tags: string[]
	): { name: string; priority: string; enabled: boolean; tags: string[] }[] {
		return [
			...this.entries.inspectByTags(tags),
			...this.versioned.inspectByTags(tags),
		];
	}
	// ****************** Public API (shutdown hooks) cont.. ********************
	onShutdown(hook: Hook): this {
		this.lifecycle.addHook(hook);
		return this;
	}

	// ****************** Commit (private) ********************

	/**
	 * Sort entries, inject built-ins, build versioned router, flush to Oak.
	 * Called exactly once by boot(). After commit, no registrations allowed.
	 */
	#commit() {
		if (this.#committed) return;
		this.#committed = true;

		// 1. Sort user entries by (priority ASC, order ASC).
		const sorted = this.entries.sorted();

		// 2. Build the versioned-route dispatcher (null when nothing registered).
		const versionedRouter = this.versioned.buildRouter();

		// 3. Assemble the final pipeline:
		//    errorBoundary -> requestLifecycle
		//    -> user entries (runtime enabled check per entry)
		//    -> versionedRouter (if any)
		//    -> notFound
		this.app.use(this.errorBoundary());
		this.app.use(this.requestLifecycle());

		for (const entry of sorted) {
			// Skip sentinel entries - they are tag-control bookmarks for HTTP-method
			// shortcut routes registered on the shared _methodRouter. Their handlers
			// are no-op pass-throughs; the real dispatch lives inside _methodRouter
			// which is already flushed to Oak via its own __methodRouter:* entries.
			if (entry.isSentinel) continue;

			const entryRef = entry;
			const enabledWrapper: AppMiddleware = async (
				ctx: AppContext,
				next: AppNext,
			) => {
				// this check works only when user use "app.use" not when user use "app.get" or "app.post" etc
				if (!entryRef.enabled) {
					await next();
					return;
				}

				/** for "app.get" or "app.post" etc we have to use this check that is available inside this handler wrapper so for shortcut methods the flow is like this
                 *
                 * entryRef.handler(ctx, next)
                    -> _methodRouter.routes() dispatches based on path/method write in addMethodRoute
                        -> wrappedHandler(ctx, next)  ← the real logic lives here which hold enabled and other options references.
                 */
				await entryRef.handler(ctx, next);
			};
			this.app.use(enabledWrapper);
		}

		if (versionedRouter) {
			this.app.use(versionedRouter.routes() as unknown as Middleware);
			this.app.use(
				versionedRouter.allowedMethods() as unknown as Middleware,
			);
		}

		this.app.use(this.notFoundMiddleware());

		log.info(
			`Pipeline committed: ${this.entries.size} entries` +
				(this.versioned.routeCount
					? `, ${this.versioned.routeCount} versioned routes`
					: '') +
				(this.versioned.routerCount
					? `, ${this.versioned.routerCount} versioned routers`
					: ''),
		);
	}

	/**
	 * Boot the app. Optionally accepts a setup callback for infra init.
	 * Transitions: idle -> booting -> ready.
	 *
	 * Boot sequence:
	 *   1. Run user setup() callback (infra init: DB, Redis, etc.)
	 *   2. Validate plugin dependency graph (topological sort, detect cycles)
	 *   3. Run plugin init() callbacks in topological order (dependencies first)
	 *   4. #commit() — sort, build versioned router, flush to Oak
	 *
	 * @example
	 * await app.boot(async () => {
	 *   await connectDatabase();
	 *   await initializeStore();
	 *   eventBus.bindCodexaHttpEvents();
	 *   any async service registry
	 * });
	 */
	async boot(setup?: () => Promise<void> | void): Promise<this> {
		this.lifecycle.assertPhase('idle', 'boot()');
		this.lifecycle.transition('booting');
		log.info('Booting…');

		// 1. Run root setup (DB connections, store init, etc.)
		if (setup) await setup();

		// 2. Plugin init sequence (topological order → dependencies first)
		if (this.plugins.size > 0) {
			const initOrder = this.plugins.topologicalSort();
			log.info(
				`Initializing ${initOrder.length} plugin(s) in order: [${
					initOrder.join(' → ')
				}]`,
			);

			for (const name of initOrder) {
				const entry = this.plugins.get(name);
				if (!entry || entry.status !== 'installed') continue;

				pluginLog.debug(`Initializing plugin: "${name}"`);
				await entry.scope._runInit();
				entry.status = 'initialized';
				pluginLog.info(`Plugin initialized: "${name}"`);
			}
		}

		// 3. Commit pipeline
		this.#commit();

		this.lifecycle.transition('ready');
		log.info('Boot complete - ready to listen.');
		return this;
	}

	/**
	 * Start listening. Transitions: ready -> listening.
	 */
	async listen(options?: ListenOptions): Promise<void> {
		this.lifecycle.assertPhase('ready', 'listen()');

		const port = options?.port ?? 8000;
		const hostname = options?.host ?? '0.0.0.0';

		const ac = this.lifecycle.createAbortController();
		this.lifecycle.registerSignalHandlers(async () => {
			log.info('Received shutdown signal.');
			await this.shutdown();
		});
		this.lifecycle.transition('listening');
		this.lifecycle.trackListenPromise();

		log.info(`Listening on http://${hostname}:${port}`);

		try {
			await this.app.listen({
				port,
				hostname,
				signal: options?.signal ?? ac.signal,
			});
		} finally {
			this.lifecycle.resolveListenPromise();
		}
	}

	/**
	 * Returns a Promise that resolves once listen() has fully settled.
	 * Useful for programmatic shutdown to confirm the port is released.
	 */
	whenStopped(): Promise<void> {
		return this.lifecycle.whenStopped();
	}

	/**
	 * Graceful shutdown.
	 * - Plugin shutdown hooks run first (in reverse install order).
	 * - Then root lifecycle hooks (reverse registration order / stack unwinding).
	 */
	async shutdown(): Promise<void> {
		const phase = this.lifecycle.getPhase();
		if (phase === 'shutting_down' || phase === 'stopped') return;

		this.lifecycle.transition('shutting_down');
		log.info('Shutting down…');

		// Run plugin shutdown hooks in reverse install order.
		const pluginNames = Array.from(this.plugins.entries()).map(
			([name]) => name,
		);
		for (let i = pluginNames.length - 1; i >= 0; i--) {
			const entry = this.plugins.get(pluginNames[i]);
			if (entry && entry.status === 'initialized') {
				pluginLog.debug(
					`Running shutdown hooks for plugin: "${pluginNames[i]}"`,
				);
				await entry.scope._runShutdownHooks();
			}
		}

		// Run root lifecycle hooks.
		await this.lifecycle.runHooks();

		this.lifecycle.removeSignalHandlers();
		this.lifecycle.abort();

		this.lifecycle.transition('stopped');
		log.info('Shutdown complete.');
	}

	// ****************** Public API - Introspection ********************
	/** Returns the full middleware pipeline metadata. Useful for debugging. */
	inspect(): {
		name: string;
		priority: string;
		order: number;
		enabled: boolean;
		tags: string[];
	}[] {
		return this.entries.inspectAll();
	}

	/** Returns all registered versioned routes. Useful for debugging. */
	inspectVersioned(): {
		version: string;
		method: HttpMethod;
		path: string;
		name: string;
		enabled: boolean;
	}[] {
		return this.versioned.inspectAll();
	}

	getPhase(): LifeCyclePhase {
		return this.lifecycle.getPhase();
	}

	/** Escape hatch: the underlying Oak Application. */
	getApp(): Application<OakAppState> {
		return this.app;
	}

	get size(): number {
		return this.entries.size;
	}

	// ****************** Public API - Plugin System ********************

	/**
	 * Install a plugin. Must be called before boot().
	 *
	 * - Validates that the plugin is not already installed.
	 * - Validates all dependsOn plugins are already installed.
	 * - Creates a sandboxed PluginInstallScope.
	 * - Calls plugin.install(scope, context, config).
	 * - Plugin registers routes, middleware, hooks, services via the scope.
	 * - Plugin's init() (if any) runs later during boot() in dependency order.
	 *
	 * @example
	 * await app.install(authPlugin, { db, redis }, { jwtSecret: '...' });
	 * await app.install(billingPlugin, { db }, { stripe: '...' });
	 * await app.boot();
	 */
	async install<C extends Record<string, unknown> = Record<string, unknown>>(
		plugin: CodexaPlugin<C>,
		context: CodexaPluginContext = {},
		config?: C,
	): Promise<this> {
		this.assertNotCommitted('install()');

		// Guard: duplicate install.
		if (this.plugins.has(plugin.name)) {
			throw new Error(
				`CodexaHttp: Plugin "${plugin.name}" is already installed.`,
			);
		}

		// Guard: dependency validation (O(d), d = dependsOn.length).
		this.plugins.validateDependencies(
			plugin as CodexaPlugin<Record<string, unknown>>,
		);

		// Create sandboxed scope.
		const scope = new PluginInstallScope(
			plugin.name,
			this,
			this.plugins,
		);

		// Let plugin register its routes, middleware, hooks, services.
		await plugin.install(scope, context, config);

		// Store in registry (erase generic C — runtime doesn't need it).
		this.plugins.set(plugin.name, {
			plugin: plugin as CodexaPlugin<Record<string, unknown>>,
			scope,
			status: 'installed',
			installedAt: Date.now(),
		});

		pluginLog.info(
			`Plugin installed: "${plugin.name}@${plugin.version}"`,
		);
		return this;
	}

	/**
	 * Uninstall a plugin by name.
	 *
	 * - Calls plugin.uninstall() if defined.
	 * - Runs plugin's shutdown hooks in reverse order.
	 * - Disables all middleware/routes tagged with the plugin's name.
	 * - Removes plugin and its services from the registry.
	 *
	 * Works both before AND after boot():
	 *   - Before commit: tags were set → disableAll() silences them.
	 *   - After commit: Oak routes stay registered but sentinel.enabled = false.
	 */
	async uninstall(pluginName: string): Promise<this> {
		const entry = this.plugins.get(pluginName);
		if (!entry) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" is not installed.`,
			);
		}

		// Guard: check no other installed plugin depends on this one.
		for (const [name, { plugin: p }] of this.plugins.entries()) {
			if (
				name !== pluginName &&
				(p.dependsOn ?? []).includes(pluginName)
			) {
				throw new Error(
					`CodexaHttp: Cannot uninstall "${pluginName}" — ` +
						`plugin "${name}" depends on it. Uninstall "${name}" first.`,
				);
			}
		}

		// Call plugin's own cleanup.
		if (entry.plugin.uninstall) {
			await entry.plugin.uninstall(entry.scope);
		}

		// Run plugin shutdown hooks.
		await entry.scope._runShutdownHooks();

		// Disable all middleware tagged with this plugin's name.
		entry.scope._disableAll();

		// Remove from registry.
		entry.status = 'uninstalled';
		this.plugins.delete(pluginName);

		pluginLog.info(`Plugin uninstalled: "${pluginName}"`);
		return this;
	}

	/** O(1) check if a plugin is installed. */
	hasPlugin(pluginName: string): boolean {
		return this.plugins.has(pluginName);
	}

	/**
	 * Access a service exposed by a plugin.
	 * Root-level alternative to scope.getService().
	 *
	 * @example
	 * const checker = app.getPluginService<PolicyChecker>('Codexa-auth', 'policyChecker');
	 */
	getPluginService<T>(pluginName: string, serviceName: string): T {
		return this.plugins.getService<T>(pluginName, serviceName);
	}

	/**
	 * Introspect all installed plugins.
	 * Useful for admin dashboards, health checks, debugging.
	 */
	inspectPlugins(): {
		name: string;
		version: string;
		status: string;
		installedAt: number;
		services: string[];
		dependsOn: string[];
	}[] {
		return this.plugins.inspectAll();
	}
}
