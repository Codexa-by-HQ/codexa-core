import type { createRouter as rou3Create } from '../../../providers/rou3.ts';
import type {
	AppMiddlewareFn,
	Context,
	Empty,
	Hook,
	HttpMethod,
	IPluginMetaData,
	OpenApiConfig,
	PluginServices,
	RequestErrorHook,
	RequestHookEvent,
	RequestSuccessHook,
	RouteHandler,
	RouteParams,
	StateShape,
} from '../mod.ts';
export type RoutePathKey = string;
export type RouteKey = string;
export type Rou3Router = ReturnType<typeof rou3Create>;
export type RouteOrigin = 'router' | 'plugin';
export type MiddlewareKind = 'plugin' | 'inline';
export type AppliedOnMatchKind =
	| 'all'
	| 'exact'
	| 'startsWith'
	| 'endsWith'
	| 'contains';

export interface Rou3MatchResult {
	readonly data: unknown;
	readonly params?: unknown;
}

export interface CompiledAppliedOnMatcher {
	readonly raw: string;
	readonly match: AppliedOnMatchKind;
	readonly value?: string;
}

export interface RouteMeta {
	readonly name: string;
	readonly method: HttpMethod;
	readonly path: string;
	readonly tags: readonly string[];
	readonly enabled: boolean;
	readonly origin: RouteOrigin;
	readonly scopeId: number;
	readonly routerId?: number;
	readonly routerName?: string;
	readonly resolvedMountPath?: string;
	readonly pluginName?: string;
	readonly version?: string;
	readonly versionHeader?: string;
	readonly openapi?: OpenApiConfig;
}

export interface MiddlewareRegistration<S extends StateShape> {
	readonly id: number;
	readonly kind: MiddlewareKind;
	readonly name: string;
	readonly priority: number;
	readonly order: number;
	readonly tags: readonly string[];
	readonly appliedOn: readonly string[];
	readonly matchers: readonly CompiledAppliedOnMatcher[];
	readonly enabled: boolean;
	readonly scopeId: number;
	readonly routerId?: number;
	readonly routerName?: string;
	readonly pluginName?: string;
	readonly fn: AppMiddlewareFn<S, never, StateShape>;
	readonly expose?: (data: unknown) => StateShape;
}

export interface RouteRegistration<S extends StateShape> {
	readonly key: RouteKey;
	readonly matchKey: RoutePathKey;
	readonly method: HttpMethod;
	readonly path: string;
	readonly order: number;
	readonly enabled: boolean;
	readonly handler: RouteHandler<string, S, StateShape>;
	readonly middleware: readonly MiddlewareRegistration<S>[];
	readonly meta: RouteMeta;
}

export interface RouterSnapshot<S extends StateShape = Empty> {
	readonly name: string;
	readonly scopeId: number;
	readonly origin: RouteOrigin;
	readonly pluginName?: string;
	readonly routes: readonly RouteRegistration<S>[];
}

export interface PluginScopeSnapshot<S extends StateShape = Empty> {
	readonly name: string;
	readonly pluginName: string;
	readonly routes: readonly RouteRegistration<S>[];
	readonly middleware: readonly MiddlewareRegistration<S>[];
}

export interface BuiltContext<S extends StateShape> {
	readonly ctx: Context<S, RouteParams, StateShape>;
	readonly withStateProvide: (
		expose?: (data: unknown) => StateShape,
	) => Context<S, RouteParams, StateShape>;
	readonly withLocalProvide: (
		expose?: (data: unknown) => StateShape,
	) => Context<S, RouteParams, StateShape>;
	readonly hookEvent: (
		route?: RouteMeta,
	) => Omit<RequestHookEvent<S>, 'response'>;
}

export interface CommittedRoute<S extends StateShape> {
	readonly middleware: readonly MiddlewareRegistration<S>[];
	readonly handler: RouteHandler<string, S, StateShape>;
	readonly meta: RouteMeta;
}

export interface CommittedRouteBucket<S extends StateShape> {
	readonly unversioned?: CommittedRoute<S>;
	readonly versionHeader?: string;
	readonly versions: ReadonlyMap<string, CommittedRoute<S>>;
}

export interface PluginRecord {
	readonly name: string;
	readonly metadata?: IPluginMetaData;
	readonly dependsOn: readonly string[];
}

export interface PluginHost {
	exposeService(
		pluginName: string,
		serviceName: string,
		service: unknown,
	): void;
	readService<
		Name extends string,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName];
	readServices<Name extends string>(pluginName: Name): PluginServices<Name>;
	addShutdownHook(pluginName: string, hook: Hook): void;
	addSuccessHook<StateExt extends StateShape>(
		pluginName: string,
		hook: RequestSuccessHook<StateExt>,
	): void;
	addErrorHook<StateExt extends StateShape>(
		pluginName: string,
		hook: RequestErrorHook<StateExt>,
	): void;
	hasPlugin(name: string): boolean;
	hasService(pluginName: string, serviceName: string): boolean;
}

export interface CommitRouteIndex<S extends StateShape> {
	readonly routesByPlugin: ReadonlyMap<
		string,
		readonly RouteRegistration<S>[]
	>;
	readonly tagsByPlugin: ReadonlyMap<string, readonly string[]>;
	readonly routesByPluginTag: ReadonlyMap<
		string,
		ReadonlyMap<string, readonly RouteRegistration<S>[]>
	>;
}
