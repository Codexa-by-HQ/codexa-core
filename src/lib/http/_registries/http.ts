import { Application, Middleware, Router } from '@oak/oak';
import {
	AppContext,
	AppMiddleware,
	AppNext,
	CodexaPlugin,
	CodexaPluginContext,
	Empty,
	Hook,
	HttpMethod,
	ICodexaHttp,
	IVersionedScope,
	LifeCyclePhase,
	ListenOptions,
	MiddlewareEntry,
	MiddlewarePriority,
	OakAppState,
	SafeProvide,
	UseOptions,
} from '../mod.ts';
import { createLogger } from '../../../utils/logger.ts';
import { eventBus } from '../../bus/mod.ts';
import { sendInternalError, sendNotFound } from '../../../utils/response.ts';
import { generateId } from '../../../utils/crypto.ts';
import { formatDeviceShort } from '../../../utils/device.ts';
import {
	BROWSER_PROBE_PATHS,
	fnName,
	injectProvide,
	priorityLabel,
	setFnName,
} from '../helpers.ts';
import { VersionedRegistry, VersionedScope } from './version.ts';
import { PluginInstallScope, pluginLog, PluginRegistry } from './plugin.ts';

const log = createLogger('CodexaHttp');
const httpLog = createLogger('Codexa:Http');

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
	 *
	 * Static provide: merged into ctx.state BEFORE the handler runs.
	 * Dynamic provide (function): ctx.provide() is injected onto ctx so the
	 *   handler can call it; after the handler resolves the callback is invoked
	 *   with the stored slot value and the result is merged into ctx.state.
	 */
	private wrapHandler<P extends SafeProvide = Empty>(
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): AppMiddleware {
		const provide = options?.provide;
		const onSuccess = options?.onSuccess;
		const onError = options?.onError;

		// Fast path: nothing to wrap -> return as-is (avoids an extra async frame).
		// Note: a function provide always requires wrapping.
		const hasStaticProvide = provide !== null && provide !== undefined &&
			typeof provide !== 'function' &&
			Object.keys(provide as object).length > 0;
		const hasDynamicProvide = typeof provide === 'function';
		if (!hasStaticProvide && !hasDynamicProvide && !onSuccess && !onError) {
			// Still need to attach ctx.provide as a safe no-op so handlers can
			// always call it without guarding for existence.
			const bare: AppMiddleware = async (
				ctx: AppContext,
				next: AppNext,
			) => {
				injectProvide(ctx, undefined);
				await (handler as AppMiddleware)(ctx, next);
			};
			return bare;
		}

		const wrapped: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		) => {
			// Inject ctx.provide() and get the post-handler flush function.
			const flush = injectProvide(
				ctx,
				provide as P | ((data: unknown) => P) | undefined,
			);

			// Static provide: merge into state BEFORE the handler so it sees the values.
			if (hasStaticProvide) {
				Object.assign(ctx.state, provide);
			}
			try {
				await (handler as AppMiddleware)(ctx, next);
				// Dynamic provide: flush after handler resolves.
				flush();
				if (onSuccess) await onSuccess(ctx as AppContext<P>); // success handler
			} catch (err) {
				flush(); // cleanup slot even on error
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

		// Determine static vs dynamic provide once (not per request).
		const hasStaticProvide = provide !== null && provide !== undefined &&
			typeof provide !== 'function' &&
			Object.keys(provide as object).length > 0;

		// Wrap .routes() with provide/onSuccess/onError lifecycle hooks.
		const rawRoutes = routerInstance.routes() as AppMiddleware;
		const wrappedRoutes: AppMiddleware = async (
			ctx: AppContext,
			next: AppNext,
		) => {
			// Inject ctx.provide() and get the post-handler flush function.
			const flush = injectProvide(
				ctx,
				provide as P | ((data: unknown) => P) | undefined,
			);
			// Static provide: merge before handler.
			if (hasStaticProvide) {
				Object.assign(ctx.state, provide);
			}
			try {
				await rawRoutes(ctx, next);
				// Dynamic provide: flush after handler resolves.
				flush();
				if (onSuccess) await onSuccess(ctx as AppContext<P>); // success handler
			} catch (err) {
				flush(); // cleanup slot even on error
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

		// Determine static vs dynamic provide once (not per request).
		const hasStaticProvide = provide !== null && provide !== undefined &&
			typeof provide !== 'function' &&
			Object.keys(provide as object).length > 0;

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
			// Inject ctx.provide() and get the post-handler flush function.
			const flush = injectProvide(
				ctx as unknown as AppContext,
				provide as P | ((data: unknown) => P) | undefined,
			);
			// Static provide: merge into state BEFORE the handler.
			if (hasStaticProvide) {
				Object.assign(ctx.state, provide);
			}
			// run handler
			try {
				await (handler as AppMiddleware<P>)(ctx, next);
				// Dynamic provide: flush after handler resolves.
				flush();
				// run onSuccess if provided
				if (onSuccess) {
					await onSuccess(ctx);
				}
			} catch (error) {
				flush(); // cleanup slot even on error
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
		// Cast to Middleware: AppMiddleware requires ctx.provide() but Oak provides plain Context.
		// injectProvide() attaches .provide() at runtime before user code runs — safe cast.
		this._methodRouter[methodLower](
			path,
			wrappedHandler as unknown as Middleware,
		); // registering route in oak router not executing yet, execution happen in #commit() when oak router is flushed to oak app

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
	private errorBoundary(): Middleware<OakAppState> {
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
					requestId: ctx.state.requestId,
				}, { distributed: false });

				if (!ctx.response.writable) return;
				sendInternalError(ctx as unknown as AppContext);
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
	private requestLifecycle(): Middleware<OakAppState> {
		return async (ctx, next) => {
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
	private notFoundMiddleware(): Middleware<OakAppState> {
		return async (ctx, next) => {
			await next();
			if (ctx.response.status === 404) {
				sendNotFound(
					ctx as unknown as AppContext,
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
			// Plain Oak Middleware — ctx.provide() is injected by wrapHandler/injectProvide
			// before user handlers run, so the Oak-level enabledWrapper doesn't need it.
			const enabledWrapper: Middleware<OakAppState> = async (
				ctx,
				next,
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
				await entryRef.handler(ctx as unknown as AppContext, next);
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

		// Create sandboxed scope — pass dependsOn so it can enforce getService discipline.
		const scope = new PluginInstallScope(
			plugin.name,
			this,
			this.plugins,
			plugin.dependsOn ?? [],
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
