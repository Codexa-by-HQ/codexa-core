import type {
	Empty,
	HttpMethod,
	ICodexaHttpRouter,
	MiddlewareLocals,
	RouteDefinition,
	RouteHandler,
	RouteMiddleware,
	RouteOptions,
	StateShape,
} from '../mod.ts';
import type {
	MiddlewareRegistration,
	RouteKey,
	RouteMeta,
	RouteOrigin,
	RoutePathKey,
	RouteRegistration,
	RouterSnapshot,
} from '../_internals/types.ts';
import {
	createScopeId,
	defaultRouterName,
	formatRouteIdentity,
	frameworkMessage,
	joinPaths,
	makeRouteKey,
	makeRoutePathKey,
	normalizeMethod,
	normalizeName,
	normalizePath,
	normalizeVersion,
	normalizeVersionHeader,
	toInlineMiddlewareRegistration,
	uniqueStrings,
} from '../_internals/helpers.ts';

export class CodexaRouter<StateExt extends StateShape = Empty>
	implements ICodexaHttpRouter<StateExt> {
	#committed = false;
	#routeOrder = 0;
	#routesMap = new Map<RouteKey, RouteRegistration<StateExt>>();
	#routePathKeys = new Set<RoutePathKey>();
	readonly #origin: RouteOrigin;
	readonly #name: string;
	readonly #scopeId: number;
	readonly #pluginName: string | undefined;

	constructor(
		name?: string,
		origin: RouteOrigin = 'router',
		pluginName?: string,
	) {
		this.#origin = origin;
		this.#scopeId = createScopeId();
		this.#pluginName = pluginName;
		this.#name = normalizeName(name) ??
			defaultRouterName(origin, this.#scopeId);
	}

	public getName(): string {
		return this.#name;
	}

	public route<
		const Route extends string,
		const Middlewares extends readonly unknown[] = readonly [],
	>(
		definition: RouteDefinition<Route, StateExt, Middlewares>,
	): this {
		this.assertNotCommitted('register routes');
		const methods = Array.isArray(definition.method)
			? definition.method
			: [definition.method];
		for (const method of methods) {
			this.addRouteRegistration(
				method,
				definition.path,
				definition.handler,
				definition.options,
			);
		}
		return this;
	}

	public snapshot(): RouterSnapshot<StateExt> {
		const snapshot = Object.freeze({
			name: this.#name,
			scopeId: this.#scopeId,
			origin: this.#origin,
			pluginName: this.#pluginName,
			routes: Object.freeze([...this.#routesMap.values()]),
		});
		this.markCommitted();
		return snapshot;
	}

	protected assertNotCommitted(action: string): void {
		if (this.#committed) {
			frameworkMessage(
				'error',
				`Cannot ${action} after boot(). All registrations must happen before boot().`,
			);
		}
	}

	protected markCommitted(): void {
		this.#committed = true;
	}

	protected get name(): string {
		return this.#name;
	}

	protected get scopeId(): number {
		return this.#scopeId;
	}

	protected addSnapshot<SnapshotState extends StateShape>(
		snapshot: RouterSnapshot<SnapshotState>,
		prefix = '',
		version?: string,
		pluginName?: string,
		versionHeader?: string,
	): void {
		this.assertNotCommitted('mount routers');
		const mountScopeId = createScopeId();
		const routerId = snapshot.scopeId;
		const routerName = snapshot.name;
		const ownerPluginName = pluginName ?? this.#pluginName ??
			snapshot.pluginName;

		for (const route of snapshot.routes) {
			const path = joinPaths(prefix, route.path);
			const resolvedVersion = version ?? route.meta.version;
			const resolvedVersionHeader = resolvedVersion === undefined
				? undefined
				: normalizeVersionHeader(
					versionHeader ?? route.meta.versionHeader,
				);
			const key = makeRouteKey(route.method, path, resolvedVersion);
			const matchKey = makeRoutePathKey(route.method, path);
			if (this.#routesMap.has(key)) {
				frameworkMessage(
					'error',
					`Duplicate mounted route: ${
						formatRouteIdentity(route.method, path, resolvedVersion)
					}`,
				);
			}
			const order = ++this.#routeOrder;
			const meta: RouteMeta = Object.freeze({
				...route.meta,
				path,
				origin: ownerPluginName === undefined
					? route.meta.origin
					: 'plugin',
				scopeId: mountScopeId,
				routerId,
				routerName,
				resolvedMountPath: path,
				pluginName: ownerPluginName,
				version: resolvedVersion,
				versionHeader: resolvedVersionHeader,
			});
			this.#routePathKeys.add(matchKey);
			this.#routesMap.set(
				key,
				Object.freeze({
					key,
					matchKey,
					method: route.method,
					path,
					order,
					enabled: route.enabled,
					handler: route.handler as unknown as RouteHandler<
						string,
						StateExt,
						StateShape
					>,
					middleware: route.middleware.map((middleware) =>
						Object.freeze({
							...middleware,
							scopeId: mountScopeId,
							routerId,
							routerName,
							pluginName: ownerPluginName,
						})
					) as unknown as readonly MiddlewareRegistration<StateExt>[],
					meta,
				}),
			);
		}
	}

	protected addRouteRegistration<
		Route extends string,
		Middlewares extends readonly unknown[],
	>(
		methodInput: HttpMethod,
		pathInput: Route,
		handler: RouteHandler<Route, StateExt, MiddlewareLocals<Middlewares>>,
		routeOptions?: RouteOptions<Middlewares>,
		version?: string,
		versionHeader?: string,
	): void {
		const method = normalizeMethod(methodInput);
		const path = normalizePath(pathInput);
		const resolvedVersion = version === undefined
			? undefined
			: normalizeVersion(version);
		const resolvedVersionHeader = resolvedVersion === undefined
			? undefined
			: normalizeVersionHeader(versionHeader);
		const key = makeRouteKey(method, path, resolvedVersion);
		const matchKey = makeRoutePathKey(method, path);
		if (this.#routesMap.has(key)) {
			frameworkMessage(
				'error',
				`Duplicate route: ${
					formatRouteIdentity(method, path, resolvedVersion)
				}`,
			);
		}

		const tags = uniqueStrings(routeOptions?.tags);
		const enabled = routeOptions?.enabled ?? true;
		const name = routeOptions?.name ?? `${method} ${path}`;
		const order = ++this.#routeOrder;
		const meta: RouteMeta = Object.freeze({
			name,
			method,
			path,
			tags,
			enabled,
			origin: this.#origin,
			scopeId: this.#scopeId,
			routerId: this.#origin === 'router' ? this.#scopeId : undefined,
			routerName: this.#name,
			pluginName: this.#pluginName,
			version: resolvedVersion,
			versionHeader: resolvedVersionHeader,
			openapi: routeOptions?.openapi,
		});
		const routeMiddleware =
			(routeOptions?.middleware ?? []) as readonly RouteMiddleware[];
		const middleware = Object.freeze(
			routeMiddleware.map((item, index) =>
				toInlineMiddlewareRegistration(item, index, meta, order)
			),
		);

		this.#routesMap.set(
			key,
			Object.freeze({
				key,
				matchKey,
				method,
				path,
				order,
				enabled,
				handler: handler as RouteHandler<string, StateExt, StateShape>,
				middleware,
				meta,
			}),
		);
		this.#routePathKeys.add(matchKey);
	}
}

/**
 * Create a reusable route collection that can be mounted inside a plugin.
 */
export function createRouter<StateExt extends StateShape = Empty>(
	name?: string,
): ICodexaHttpRouter<StateExt> {
	return new CodexaRouter<StateExt>(name);
}

/** Alias for {@link createRouter}. */
export function router<StateExt extends StateShape = Empty>(
	name?: string,
): ICodexaHttpRouter<StateExt> {
	return createRouter<StateExt>(name);
}
