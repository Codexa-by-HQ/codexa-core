/**
 * @module @codexa/core/http
 *
 * Plugin-first HTTP for Codexa applications.
 *
 * Slogan: build APIs as installable capabilities, then let Rou3 keep request
 * dispatch fast.
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
 * await app.boot();
 * await app.listen({ port: 8000 });
 * `
 */

import { HTTP_METHODS } from './_internals/constants.ts';

export {
	DEFAULT_VERSION_HEADER,
	HTTP_METHODS,
} from './_internals/constants.ts';
export type LifeCyclePhase =
	| 'idle'
	| 'booting'
	| 'ready'
	| 'listening'
	| 'shutting_down'
	| 'stopped';

export type HttpMethod = (typeof HTTP_METHODS)[number];
export type Hook = () => void | Promise<void>;

export interface AppListenOptions {
	port?: number;
	hostname?: string;
	signal?: AbortSignal;
	onListen?: (addr: Deno.NetAddr) => void;
	secure?: boolean;
	cert?: string;
	key?: string;
}

export type StateShape = Record<string, unknown>;
export type Empty = Record<never, never>;

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

export type RouteParams = Readonly<Record<string, string>>;

export interface ResponseHelpers {
	json(data: unknown, init?: ResponseInit): Response;
	text(data: string, init?: ResponseInit): Response;
	html(data: string, init?: ResponseInit): Response;
	markdown(content: string, init?: ResponseInit): Response;
	redirect(url: string, status?: 301 | 302 | 307 | 308): Response;
	stream(body: ReadableStream<Uint8Array>, init?: ResponseInit): Response;
	send(body?: BodyInit | null, init?: ResponseInit): Response;
}

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

export interface OpenApiResponse {
	description: string;
	schema?: unknown;
	headers?: StateShape;
}

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

export type QueryValue = string | readonly string[];

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

export interface HookErrorSnapshot {
	readonly name: string;
	readonly message: string;
}

export interface HookRouteSnapshot {
	readonly name: string;
	readonly method: HttpMethod;
	readonly path: string;
	readonly pluginName?: string;
	readonly version?: string;
	readonly versionHeader?: string;
}

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

export type RequestSuccessHook<StateExt extends StateShape = Empty> = (
	event: RequestHookEvent<StateExt>,
) => void | Promise<void>;

export type RequestErrorHook<StateExt extends StateShape = Empty> = (
	event: RequestHookEvent<StateExt> & {
		readonly error?: HookErrorSnapshot;
	},
) => void | Promise<void>;

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

export type MiddlewareInputWithoutExpose<
	StateExt extends StateShape = StateShape,
	LocalsExt extends StateShape = StateShape,
> = MiddlewareBaseConfig & {
	fn(ctx: MiddlewareInputCtx<StateExt, LocalsExt>): MiddlewareResult;
	expose?: never;
};

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

export interface RouteMiddleware extends MiddlewareBaseConfig {
	fn(ctx: never): MiddlewareResult;
	expose?(data: never): StateShape;
}

type MiddlewareExposed<T> = T extends
	MiddlewareConfig<infer _State, infer _Provide, infer Exposed, infer _Locals>
	? Exposed
	: Empty;

export type MiddlewareLocals<Middlewares extends readonly unknown[]> =
	Middlewares extends readonly [] ? Empty
	: Simplify<UnionToIntersection<MiddlewareExposed<Middlewares[number]>>>;

export interface UseOptions<
	TExposed extends StateShape = Empty,
	TProvide extends StateShape = TExposed,
> {
	tags?: readonly string[];
	appliedOn?: readonly string[];
	name?: string;
	priority?: number;
	enabled?: boolean;
	expose?: (data: TProvide) => SafeState<TExposed>;
}

export type UseOptionsWithoutExpose =
	& Omit<UseOptions<Empty, never>, 'expose'>
	& {
		expose?: never;
	};

export type UseOptionsWithExpose<
	TExposed extends StateShape,
	TProvide extends StateShape,
> = Omit<UseOptions<SafeState<TExposed>, TProvide>, 'expose'> & {
	expose: (data: TProvide) => SafeState<TExposed>;
};

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

export interface PluginMiddleware {
	tags?: readonly string[];
	appliedOn?: readonly string[];
	name?: string;
	priority?: number;
	enabled?: boolean;
	fn(ctx: never): MiddlewareResult;
	expose?(data: never): StateShape;
}

export interface RouteOptions<
	Middlewares extends readonly unknown[] = readonly RouteMiddleware[],
> {
	tags?: readonly string[];
	name?: string;
	enabled?: boolean;
	middleware?: Middlewares;
	openapi?: OpenApiConfig;
}

export type RouteHandler<
	Route extends string = string,
	StateExt extends StateShape = Empty,
	LocalsExt extends StateShape = Empty,
> = (
	ctx: Context<StateExt, ExtractRouteParams<Route>, LocalsExt>,
) => Response | Promise<Response>;

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

export interface IRouteScope<StateExt extends StateShape = Empty> {
	route<
		const Route extends string,
		const Middlewares extends readonly unknown[] = readonly [],
	>(definition: RouteDefinition<Route, StateExt, Middlewares>): this;
}

export interface ICodexaHttpRouter<
	StateExt extends StateShape = Empty,
> extends IRouteScope<StateExt> {
	getName(): string;
}

// deno-lint-ignore no-empty-interface
export interface IPluginConfigMap { }

// deno-lint-ignore no-empty-interface
export interface IPluginServiceMap { }

export type PluginConfig<Name extends string> = Name extends
	keyof IPluginConfigMap ? IPluginConfigMap[Name] : void;

export type PluginServices<Name extends string> = Name extends
	keyof IPluginServiceMap ? IPluginServiceMap[Name]
	: Record<string, unknown>;

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

export interface IPluginMetaData {
	license?: string;
	description?: string;
	author?: string;
	repository?: string;
	tags?: readonly string[];
}

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

export type CodexaPluginDefinition<
	Name extends string,
	Config,
	Deps extends readonly string[],
> =
	& Omit<ICodexaPlugin<Name, Config, Deps[number]>, 'dependsOn'>
	& {
		dependsOn?: Deps;
	};

export interface InspectQuery {
	tags?: readonly string[];
	plugins?: readonly string[];
	routes?: readonly string[];
	services?: readonly string[];
	methods?: readonly HttpMethod[];
	versions?: readonly string[];
	includeDisabled?: boolean;
}

export interface InstalledPluginInfo {
	name: string;
	metadata?: IPluginMetaData;
}

export type MiddlewareKind = 'plugin' | 'inline';

export interface InspectMiddlewareRef {
	readonly name: string;
	readonly kind: MiddlewareKind;
	readonly priority: number;
	readonly pluginName?: string;
}

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

export interface InspectMiddleware {
	readonly name: string;
	readonly kind: MiddlewareKind;
	readonly enabled: boolean;
	readonly tags: readonly string[];
	readonly appliedOn: readonly string[];
	readonly priority: number;
	readonly pluginName?: string;
}

export interface InspectService {
	readonly name: string;
	readonly pluginName?: string;
	readonly exists: boolean;
}

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

export interface InspectSummary {
	readonly routeCount: number;
	readonly enabledRouteCount: number;
	readonly disabledRouteCount: number;
	readonly pluginCount: number;
	readonly serviceCount: number;
	readonly middlewareCount: number;
}

export interface InspectResult {
	readonly query?: InspectQuery;
	readonly summary: InspectSummary;
	readonly routes: readonly InspectRoute[];
	readonly middlewares: readonly InspectMiddleware[];
	readonly plugins: readonly InspectPlugin[];
	readonly services: readonly InspectService[];
}

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
	listen(options?: AppListenOptions): Promise<void>;
	dispatch(request: Request): Promise<Response>;
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
	getServer(): Deno.HttpServer | undefined;
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
