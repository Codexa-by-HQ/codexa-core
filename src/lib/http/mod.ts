/**
 * @module @codexa/core/http
 *
 * Plugin-first HTTP for Codexa applications.
 *
 * Slogan: build APIs as installable capabilities, then let Rou3 keep request
 * routing fast.
 *
 * This module is the public contract: request context, middleware, plugin,
 * inspection, lifecycle, and helper types live here so plugin authors can use
 * module augmentation from one predictable import path.
 *
 * `	s
 * import { createApp, definePlugin } from '@codexa/core/http';
 *
 * const healthPlugin = definePlugin({
 *   name: 'health',
 *   setup(scope) {
 *     scope.route({
 *       method: 'GET',
 *       path: '/health',
 *       handler: (ctx) => ctx.json({ ok: true }),
 *       options: { name: 'health.check', tags: ['public', 'health'] },
 *     });
 *   },
 * });
 *
 * const app = createApp('api').install(healthPlugin);
 *
 * // Deno:
 * Deno.serve(app.dispatch);
 * 
 * // Bun:
 * Bun.serve({
 *   port: 3000,
 *   fetch: app.dispatch,
 * });
 * 
 * // Cloudflare Worker:
 * export default {
 *   fetch: app.dispatch,
 * };
 * 
 * // Direct invocation (tests, jobs, other frameworks):
 * const response = await app.dispatch(
 *   new Request('http://localhost/api'),
 * );
 * 
 * // Node.js with a Fetch-compatible adapter such as `@hono/node-server`:
 * import { serve } from '@hono/node-server';
 * serve({ fetch: app.dispatch, port: 3000 });
 *
 * // The same app.dispatch handler can be passed to Bun, Cloudflare Workers,
 * // Node.js Web-standard adapters, and other Fetch API runtimes.
 * `
 */

import { HTTP_METHODS } from './_internals/constants.ts';

export {
	DEFAULT_VERSION_HEADER,
	HTTP_METHODS,
} from './_internals/constants.ts';
/** Lifecycle phases reported by {@link ICodexaHttp.getPhase}. */
export type LifeCyclePhase =
	| 'idle'
	| 'booting'
	| 'ready'
	| 'shutting_down'
	| 'stopped';

/** HTTP methods supported by Codexa route definitions. */
export type HttpMethod = (typeof HTTP_METHODS)[number];
/** Async or sync lifecycle hook callback. */
export type Hook = () => void | Promise<void>;

/** A runtime-neutral Web Request/Response dispatcher. */
export type DispatchHandler = (request: Request) => Promise<Response>;

/** Plain object shape accepted for typed request state and locals. */
export type StateShape = Record<string, unknown>;
/** Empty object type used as the default state/locals shape. */
export type Empty = Record<never, never>;

/** Built-in request state fields reserved by the framework. */
export interface BaseState {
	readonly requestId?: string;
	readonly startTime?: number;
}

type ReservedStateKey = keyof BaseState;

/**
 * Prevents state extensions from using reserved keys defined in BaseState.
 *
 * Extract<A, B> keeps only the members of A that are assignable to B.
 * If T contains any reserved key (e.g. "requestId" or "startTime"),
 * the resulting type becomes never.
 */
type NoReservedKeys<T> = Extract<keyof T, ReservedStateKey> extends never ? T
	: never;

/**
 * Creates a readonly copy of T by mapping over all of its properties.
 *
 * Example:
 *   type User = { name: string; age: number };
 *
 *   type Result = Simplify<User>;
 *
 * Result:
 *   {
 *     readonly name: string;
 *     readonly age: number;
 *   }
 */
type Simplify<T> = { readonly [K in keyof T]: T[K] };

/**
 * Converts a union type into an intersection type.
 *
 * Example:
 *   { name: string } | { age: number }
 *
 * becomes:
 *   { name: string } & { age: number }
 *
 * which behaves like:
 *   { name: string; age: number }
 */
type UnionToIntersection<T> =
	(T extends unknown ? (value: T) => void : never) extends
		(value: infer Result) => void ? Result
		: never;

export type SafeState<T extends StateShape = Empty> = NoReservedKeys<T>;

/** Complete request state visible on `ctx.state`. */
export type RequestState<Ext extends StateShape = Empty> =
	& Readonly<BaseState>
	& Readonly<SafeState<Ext>>;

/**
 * Removes route parameter modifiers from a parameter name.
 *
 * Examples:
 *   "id?"      -> "id"
 *   "id*"      -> "id"
 *   "id+"      -> "id"
 *   "id(\\d+)" -> "id"
 */
type StripModifiers<S extends string> = S extends `${infer N}?`
	? StripModifiers<N>
	: S extends `${infer N}+` ? StripModifiers<N>
	: S extends `${infer N}*` ? StripModifiers<N>
	: S extends `${infer N}(${string})` ? StripModifiers<N>
	: S;

/**
 * Extracts route parameter names from a path string and maps them
 * to readonly string properties.
 *
 * Example:
 *   "/users/:userId/posts/:postId"
 *
 * becomes:
 *   {
 *     readonly userId: string;
 *     readonly postId: string;
 *   }
 */
export type ExtractRouteParams<Path extends string> = Path extends
	`${string}:${infer Raw}/${infer Rest}` ? {
		readonly [
			K in StripModifiers<Raw> | keyof ExtractRouteParams<`/${Rest}`>
		]: string;
	}
	: Path extends `${string}:${infer Raw}`
		? { readonly [K in StripModifiers<Raw>]: string }
	: Empty;

/**
 * Conditionally adds a provide() method.
 *
 * If TProvide is never, produces an empty object type.
 * Otherwise adds:
 *
 *   provide(data: TProvide): void
 */
type WithProvide<TProvide> = [TProvide] extends [never] ? Empty
	: { provide(data: TProvide): void };

/** Runtime route parameter map. */
export type RouteParams = Readonly<Record<string, string>>;

/** Response helper methods available on `ctx` and the root app. */
export interface ResponseHelpers {
	json(data: unknown, init?: ResponseInit): Response;
	text(data: string, init?: ResponseInit): Response;
	html(data: string, init?: ResponseInit): Response;
	markdown(content: string, init?: ResponseInit): Response;
	redirect(url: string, status?: 301 | 302 | 307 | 308): Response;
	stream(body: ReadableStream<Uint8Array>, init?: ResponseInit): Response;
	send(body?: BodyInit | null, init?: ResponseInit): Response;
}

/** Request context passed to middleware and route handlers. */
export type Context<
	StateExt extends StateShape = Empty,
	Params extends Record<string, string> = RouteParams,
	LocalsExt extends StateShape = Empty,
	TProvide = never,
> =
	& {
		readonly request: Request;
		readonly url: URL;
		readonly query: URLSearchParams;
		readonly headers: Headers;
		readonly params: Readonly<Params>;
		readonly state: RequestState<StateExt>;
		readonly locals: Readonly<LocalsExt>;
	}
	& ResponseHelpers
	& WithProvide<TProvide>;

/** OpenAPI response metadata attached to a route. */
export interface OpenApiResponse {
	description: string;
	schema?: unknown;
	headers?: StateShape;
}

/** OpenAPI operation metadata attached to route options. */
export interface OpenApiConfig {
	summary?: string;
	description?: string;
	tags?: readonly string[];
	deprecated?: boolean;
	operationId?: string;
	params?: unknown;
	query?: unknown;
	headers?: unknown;
	body?: unknown;
	bodyContentType?: string;
	responses?: Record<number | string, OpenApiResponse>;
	security?: ReadonlyArray<Record<string, readonly string[]>>;
	exclude?: boolean;
}

type MiddlewareResult = void | Response | Promise<void | Response>;

/** Query snapshot value used by request hooks. */
export type QueryValue = string | readonly string[];

/** Controlled response snapshot passed to request hooks. */
export interface HookResponseSnapshot {
	readonly status: number;
	readonly statusText: string;
	readonly ok: boolean;
	readonly redirected: boolean;
	readonly type: ResponseType;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly hasBody: boolean;
	readonly bodyUsed: boolean;
	readonly body: null;
}

/** Controlled error snapshot passed to error hooks. */
export interface HookErrorSnapshot {
	readonly name: string;
	readonly message: string;
}

/** Controlled route snapshot passed to request hooks. */
export interface HookRouteSnapshot {
	readonly name: string;
	readonly method: HttpMethod;
	readonly path: string;
	readonly pluginName?: string;
	readonly version?: string;
	readonly versionHeader?: string;
}

/** Controlled request hook event. Native bodies are intentionally not exposed. */
export interface RequestHookEvent<StateExt extends StateShape = Empty> {
	readonly params: RouteParams;
	readonly query: Readonly<Record<string, QueryValue>>;
	readonly path: string;
	readonly method: string;
	readonly state: RequestState<StateExt>;
	readonly locals: Readonly<StateShape>;
	readonly route?: HookRouteSnapshot;
	readonly response: HookResponseSnapshot;
}

/** Hook called after a request completes successfully. */
export type RequestSuccessHook<StateExt extends StateShape = Empty> = (
	event: RequestHookEvent<StateExt>,
) => void | Promise<void>;

/** Hook called after a request completes through the error path. */
export type RequestErrorHook<StateExt extends StateShape = Empty> = (
	event: RequestHookEvent<StateExt> & {
		readonly error?: HookErrorSnapshot;
	},
) => void | Promise<void>;

/** Plugin middleware function signature. */
export type AppMiddlewareFn<
	StateExt extends StateShape = Empty,
	TProvide = never,
	LocalsExt extends StateShape = Empty,
> = (
	ctx: Context<StateExt, RouteParams, LocalsExt, TProvide>,
) => MiddlewareResult;

interface MiddlewareBaseConfig {
	priority?: number;
}

/** Inline middleware configuration returned by {@link defineMiddleware}. */
export type MiddlewareConfig<
	StateExt extends StateShape = Empty, // global plugin state
	TProvide extends StateShape = never, // middleware injected from provide (route/global)
	TExposed extends StateShape = [TProvide] extends [never] ? Empty
		: TProvide, // what middleware options will expose T from "expose"
	LocalsExt extends StateShape = Empty, // local state from plugin route.
> = [TProvide] extends [never] ? MiddlewareBaseConfig & {
		fn: AppMiddlewareFn<StateExt, never, LocalsExt>;
		expose?: never;
	}
	: MiddlewareBaseConfig & {
		fn: AppMiddlewareFn<StateExt, TProvide, LocalsExt>;
		expose(data: TProvide): SafeState<TExposed>;
	};

type MiddlewareInputCtx<
	StateExt extends StateShape,
	LocalsExt extends StateShape,
> = Context<StateExt, RouteParams, LocalsExt, never>;

type MiddlewareInputCtxWithProvide<
	StateExt extends StateShape,
	LocalsExt extends StateShape,
	TProvide extends StateShape,
> = MiddlewareInputCtx<StateExt, LocalsExt> & {
	provide(data: TProvide): void;
};

/** Input shape for middleware that does not call `ctx.provide`. */
export type MiddlewareInputWithoutExpose<
	StateExt extends StateShape = StateShape,
	LocalsExt extends StateShape = StateShape,
> = MiddlewareBaseConfig & {
	fn(ctx: MiddlewareInputCtx<StateExt, LocalsExt>): MiddlewareResult;
	expose?: never;
};

/** Input shape for middleware that calls `ctx.provide`. */
export type MiddlewareInputWithExpose<
	TProvide extends StateShape,
	TExposed extends StateShape = TProvide,
	StateExt extends StateShape = StateShape,
	LocalsExt extends StateShape = StateShape,
> = MiddlewareBaseConfig & {
	fn(
		ctx: MiddlewareInputCtxWithProvide<StateExt, LocalsExt, TProvide>,
	): MiddlewareResult;
	expose(data: TProvide): SafeState<TExposed>;
};

/** Runtime-erased inline middleware shape used by route options. */
export interface RouteMiddleware extends MiddlewareBaseConfig {
	fn(ctx: never): MiddlewareResult;
	expose?(data: never): StateShape;
}

type MiddlewareExposed<T> = T extends
	MiddlewareConfig<infer _State, infer _Provide, infer Exposed, infer _Locals>
	? Exposed
	: Empty;

/** Locals inferred from a route's inline middleware array. */
export type MiddlewareLocals<Middlewares extends readonly unknown[]> =
	Middlewares extends readonly [] ? Empty
		: Simplify<UnionToIntersection<MiddlewareExposed<Middlewares[number]>>>;

/** Options shared by plugin middleware registration. */
export interface UseOptions<
	TExposed extends StateShape = Empty,
	TProvide extends StateShape = TExposed,
> {
	tags?: readonly string[];
	/** Mention pattern/value, otherwise it wont apply to any route by default */
	appliedOn?: readonly string[];
	name?: string;
	priority?: number;
	enabled?: boolean;
	expose?: (data: TProvide) => SafeState<TExposed>;
}

/** Plugin middleware options when no state is exposed. */
export type UseOptionsWithoutExpose =
	& Omit<UseOptions<Empty, never>, 'expose'>
	& {
		expose?: never;
	};

/** Plugin middleware options when provided data is exposed into state. */
export type UseOptionsWithExpose<
	TExposed extends StateShape,
	TProvide extends StateShape,
> = Omit<UseOptions<SafeState<TExposed>, TProvide>, 'expose'> & {
	expose: (data: TProvide) => SafeState<TExposed>;
};

/** Plugin middleware configuration returned by {@link definePluginMiddleware}. */
export type PluginMiddlewareConfig<
	StateExt extends StateShape = Empty,
	TProvide extends StateShape = never,
	TExposed extends StateShape = [TProvide] extends [never] ? Empty
		: TProvide,
	LocalsExt extends StateShape = Empty,
> = [TProvide] extends [never] ? UseOptionsWithoutExpose & {
		fn: AppMiddlewareFn<StateExt, never, LocalsExt>;
	}
	: UseOptionsWithExpose<TExposed, TProvide> & {
		fn: AppMiddlewareFn<StateExt, TProvide, LocalsExt>;
	};

/** Runtime-erased plugin middleware shape. */
export interface PluginMiddleware {
	tags?: readonly string[];
	appliedOn?: readonly string[];
	name?: string;
	priority?: number;
	enabled?: boolean;
	fn(ctx: never): MiddlewareResult;
	expose?(data: never): StateShape;
}

/** Options accepted by a route definition. */
export interface RouteOptions<
	Middlewares extends readonly unknown[] = readonly RouteMiddleware[],
> {
	tags?: readonly string[];
	name?: string;
	enabled?: boolean;
	middleware?: Middlewares;
	openapi?: OpenApiConfig;
}

/** Route handler signature with params and locals inferred from the route. */
export type RouteHandler<
	Route extends string = string,
	StateExt extends StateShape = Empty,
	LocalsExt extends StateShape = Empty,
> = (
	ctx: Context<StateExt, ExtractRouteParams<Route>, LocalsExt>,
) => Response | Promise<Response>;

/** Declarative route definition accepted by route scopes. */
export interface RouteDefinition<
	Route extends string = string,
	StateExt extends StateShape = Empty,
	Middlewares extends readonly unknown[] = readonly [],
> {
	method: HttpMethod | readonly HttpMethod[];
	path: Route;
	handler: RouteHandler<Route, StateExt, MiddlewareLocals<Middlewares>>;
	options?: RouteOptions<Middlewares>;
}

/** Minimal scope that can register routes. */
export interface IRouteScope<StateExt extends StateShape = Empty> {
	route<
		const Route extends string,
		const Middlewares extends readonly unknown[] = readonly [],
	>(definition: RouteDefinition<Route, StateExt, Middlewares>): this;
}

/** Reusable router contract returned by {@link createRouter}. */
export interface ICodexaHttpRouter<
	StateExt extends StateShape = Empty,
> extends IRouteScope<StateExt> {
	getName(): string;
}

/** Module augmentation map for plugin config by plugin name. */
// deno-lint-ignore no-empty-interface
export interface IPluginConfigMap {}

/** Module augmentation map for exposed plugin services by plugin name. */
// deno-lint-ignore no-empty-interface
export interface IPluginServiceMap {}

/** Config type looked up from {@link IPluginConfigMap}. */
export type PluginConfig<Name extends string> = Name extends
	keyof IPluginConfigMap ? IPluginConfigMap[Name] : void;

/** Service map looked up from {@link IPluginServiceMap}. */
export type PluginServices<Name extends string> = Name extends
	keyof IPluginServiceMap ? IPluginServiceMap[Name]
	: Record<string, unknown>;

/** Scope returned by `scope.version(v)` inside a plugin. */
export interface IPluginVersionedScope<
	StateExt extends StateShape = Empty,
	PluginName extends string = string,
	Deps extends string = never,
> extends IRouteScope<StateExt> {
	mount<RouterState extends StateShape>(
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;
	mount<RouterState extends StateShape>(
		prefix: string,
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;
}

/** Controlled plugin setup scope. Plugins cannot own app shutdown. */
export interface IPluginScope<
	StateExt extends StateShape = Empty,
	PluginName extends string = string,
	Deps extends string = never,
> extends IRouteScope<StateExt> {
	mount<RouterState extends StateShape>(
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;
	mount<RouterState extends StateShape>(
		prefix: string,
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;

	use(
		fn: AppMiddlewareFn<StateExt, never>,
		options?: UseOptionsWithoutExpose,
	): this;
	use<TExposed extends StateShape, TProvide extends StateShape>(
		fn: AppMiddlewareFn<StateExt, TProvide>,
		options: UseOptionsWithExpose<TExposed, TProvide>,
	): IPluginScope<SafeState<StateExt & TExposed>, PluginName, Deps>;
	use(
		middleware: PluginMiddlewareConfig<StateExt, never, Empty>,
	): this;
	use<TExposed extends StateShape, TProvide extends StateShape>(
		middleware: PluginMiddlewareConfig<StateExt, TProvide, TExposed>,
	): IPluginScope<SafeState<StateExt & TExposed>, PluginName, Deps>;

	version(
		v: string,
	): IPluginVersionedScope<StateExt, PluginName, Deps>;

	onShutdown(hook: Hook): this;
	onSuccess(hook: RequestSuccessHook<StateExt>): this;
	onError(hook: RequestErrorHook<StateExt>): this;

	exposeService<
		ServiceName extends keyof PluginServices<PluginName> & string,
	>(
		name: ServiceName,
		service: PluginServices<PluginName>[ServiceName],
	): this;

	getService<
		Name extends Deps,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName];

	getServices<Name extends Deps>(pluginName: Name): PluginServices<Name>;
	getDependencyNames(): readonly Deps[];
	hasDependency(name: string): boolean;
	hasPlugin(name: string): boolean;
	hasService(pluginName: string, serviceName: string): boolean;
}

/** Optional package/author metadata attached to a plugin. */
export interface IPluginMetaData {
	license?: string;
	description?: string;
	author?: string;
	repository?: string;
	tags?: readonly string[];
}

/** Plugin definition accepted by {@link ICodexaHttp.install}. */
export interface ICodexaPlugin<
	Name extends string,
	Config = PluginConfig<Name>,
	Deps extends string = never,
> {
	name: Name;
	metadata?: IPluginMetaData;
	versionHeader?: string;
	dependsOn?: readonly Deps[];
	setup(
		scope: IPluginScope<Empty, Name, Deps>,
		config: Config,
	): void;
}

/** Helper type accepted by {@link definePlugin}. */
export type CodexaPluginDefinition<
	Name extends string,
	Config,
	Deps extends readonly string[],
> =
	& Omit<ICodexaPlugin<Name, Config, Deps[number]>, 'dependsOn'>
	& {
		dependsOn?: Deps;
	};

/** Query options for {@link ICodexaHttp.inspect}. */
export interface InspectQuery {
	tags?: readonly string[];
	plugins?: readonly string[];
	routes?: readonly string[];
	services?: readonly string[];
	methods?: readonly HttpMethod[];
	versions?: readonly string[];
	includeDisabled?: boolean;
}

/** Public installed plugin summary. */
export interface InstalledPluginInfo {
	name: string;
	metadata?: IPluginMetaData;
}

/** Middleware kind shown by inspection APIs. */
export type MiddlewareKind = 'plugin' | 'inline';

/** Middleware reference attached to an inspected route. */
export interface InspectMiddlewareRef {
	readonly name: string;
	readonly kind: MiddlewareKind;
	readonly priority: number;
	readonly pluginName?: string;
}

/** Route metadata returned by {@link ICodexaHttp.inspect}. */
export interface InspectRoute {
	readonly name: string;
	readonly method: HttpMethod;
	readonly path: string;
	readonly enabled: boolean;
	readonly configuredEnabled: boolean;
	readonly tags: readonly string[];
	readonly pluginName?: string;
	readonly version?: string;
	readonly versionHeader?: string;
	readonly openapi?: OpenApiConfig;
	readonly middlewares: readonly InspectMiddlewareRef[];
}

/** Middleware metadata returned by {@link ICodexaHttp.inspect}. */
export interface InspectMiddleware {
	readonly name: string;
	readonly kind: MiddlewareKind;
	readonly enabled: boolean;
	readonly tags: readonly string[];
	readonly appliedOn: readonly string[];
	readonly priority: number;
	readonly pluginName?: string;
}

/** Service metadata returned by {@link ICodexaHttp.inspect}. */
export interface InspectService {
	readonly name: string;
	readonly pluginName?: string;
	readonly exists: boolean;
}

/** Plugin metadata returned by {@link ICodexaHttp.inspect}. */
export interface InspectPlugin {
	readonly name: string;
	readonly metadata?: IPluginMetaData;
	readonly dependsOn: readonly string[];
	readonly services: readonly string[];
	readonly routeCount: number;
	readonly unversionedRouteCount: number;
	readonly versionedRouteCount: number;
	readonly middlewareCount: number;
	readonly routes: readonly InspectRoute[];
}

/** Aggregate counts returned by {@link ICodexaHttp.inspect}. */
export interface InspectSummary {
	readonly routeCount: number;
	readonly enabledRouteCount: number;
	readonly disabledRouteCount: number;
	readonly pluginCount: number;
	readonly serviceCount: number;
	readonly middlewareCount: number;
}

/** Full inspection result for routes, plugins, services, and middleware. */
export interface InspectResult {
	readonly query?: InspectQuery;
	readonly summary: InspectSummary;
	readonly routes: readonly InspectRoute[];
	readonly middlewares: readonly InspectMiddleware[];
	readonly plugins: readonly InspectPlugin[];
	readonly services: readonly InspectService[];
}

/** Root Codexa HTTP application contract. */
export interface ICodexaHttp<
	InstalledPlugins extends string = never,
> extends ResponseHelpers {
	install<const Name extends string, Deps extends string>(
		plugin: ICodexaPlugin<Name, void, Deps>,
	): ICodexaHttp<InstalledPlugins | Name>;
	install<const Name extends string, Config, Deps extends string>(
		plugin: ICodexaPlugin<Name, Config, Deps>,
		config: Config,
	): ICodexaHttp<InstalledPlugins | Name>;

	getService<
		Name extends InstalledPlugins,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName];
	getServices<Name extends InstalledPlugins>(
		pluginName: Name,
	): PluginServices<Name>;

	hasPlugin(name: string): boolean;
	hasService(pluginName: string, serviceName: string): boolean;
	installedPlugins(): readonly InstalledPluginInfo[];
	inspect(query?: InspectQuery): InspectResult;

	enableByTags(...tags: string[]): this;
	disableByTags(...tags: string[]): this;

	boot(setup?: () => Promise<void> | void): Promise<this>;
	/**
	 * Bound, runtime-neutral request dispatcher.
	 *
	 * Pass it directly to a Fetch API compatible server or adapter, such as
	 * `Deno.serve(app.dispatch)` or `Bun.serve({ fetch: app.dispatch })`.
	 * The application boots lazily on its first request.
	 */
	readonly dispatch: DispatchHandler;
	shutdown(): Promise<void>;
	whenStopped(): Promise<void>;
	onShutdown(hook: Hook): this;
	onSuccess(hook: RequestSuccessHook<StateShape>): this;
	onError(hook: RequestErrorHook<StateShape>): this;
	onNotFound(handler: (req: Request) => Response | Promise<Response>): this;
	onException(
		handler: (err: unknown, req: Request) => Response | Promise<Response>,
	): this;
	hasRoute(method: HttpMethod, path: string): boolean;
	toRegExp(method: HttpMethod, path: string): RegExp | null;
	getPhase(): LifeCyclePhase;
	get size(): number;
}

// Registries
export { createApp, http } from './_registries/http.ts';
export { createRouter, router } from './_registries/router.ts';
export {
	defineMiddleware,
	definePlugin,
	definePluginMiddleware,
	plugin,
} from './_registries/plugin.ts';
