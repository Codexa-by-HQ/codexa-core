import type {
	AppMiddlewareFn,
	CodexaPluginDefinition,
	Empty,
	Hook,
	ICodexaHttpRouter,
	ICodexaPlugin,
	IPluginScope,
	IPluginVersionedScope,
	MiddlewareConfig,
	MiddlewareInputWithExpose,
	MiddlewareInputWithoutExpose,
	PluginConfig,
	PluginMiddleware,
	PluginMiddlewareConfig,
	PluginServices,
	RequestErrorHook,
	RequestSuccessHook,
	RouteDefinition,
	RouteMiddleware,
	SafeState,
	StateShape,
	UseOptions,
	UseOptionsWithExpose,
	UseOptionsWithoutExpose,
} from '../mod.ts';
import type {
	MiddlewareRegistration,
	PluginHost,
	PluginScopeSnapshot,
} from '../_internals/types.ts';
import {
	compileAppliedOn,
	eraseExpose,
	frameworkMessage,
	normalizeAppliedOn,
	normalizeVersion,
	normalizeVersionHeader,
	uniqueStrings,
} from '../_internals/helpers.ts';
import { CodexaRouter } from './router.ts';

export function defineMiddleware(
	config: MiddlewareInputWithoutExpose<StateShape, StateShape>,
): MiddlewareConfig<StateShape, never, Empty, StateShape>;
export function defineMiddleware<const TProvide extends StateShape>(
	config: MiddlewareInputWithExpose<
		TProvide,
		TProvide,
		StateShape,
		StateShape
	>,
): MiddlewareConfig<StateShape, TProvide, TProvide, StateShape>;
export function defineMiddleware<
	StateExt extends StateShape,
	TProvide extends StateShape,
	TExposed extends StateShape,
	LocalsExt extends StateShape,
>(
	config: MiddlewareInputWithExpose<
		TProvide,
		TExposed,
		StateExt,
		LocalsExt
	>,
): MiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>;
export function defineMiddleware(
	config:
		| RouteMiddleware
		| MiddlewareInputWithoutExpose
		| MiddlewareInputWithExpose<StateShape>,
): RouteMiddleware {
	return config as RouteMiddleware;
}

export function definePluginMiddleware(
	config: PluginMiddlewareConfig<Empty, never, Empty, Empty>,
): PluginMiddlewareConfig<Empty, never, Empty, Empty>;
export function definePluginMiddleware<const TProvide extends StateShape>(
	config: PluginMiddlewareConfig<Empty, TProvide, TProvide, Empty>,
): PluginMiddlewareConfig<Empty, TProvide, TProvide, Empty>;
export function definePluginMiddleware<
	const TProvide extends StateShape,
	StateExt extends StateShape,
	TExposed extends StateShape,
	LocalsExt extends StateShape,
>(
	config: PluginMiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>,
): PluginMiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>;
export function definePluginMiddleware(
	config: PluginMiddleware,
): PluginMiddleware {
	return config;
}

export function definePlugin<
	const Name extends string,
	Config = PluginConfig<Name>,
	const Deps extends readonly string[] = readonly [],
>(
	plugin: CodexaPluginDefinition<Name, Config, Deps>,
): ICodexaPlugin<Name, Config, Deps[number]> {
	return plugin;
}

export function plugin<
	const Name extends string,
	Config = PluginConfig<Name>,
	const Deps extends readonly string[] = readonly [],
>(
	definition: CodexaPluginDefinition<Name, Config, Deps>,
): ICodexaPlugin<Name, Config, Deps[number]> {
	return definePlugin(definition);
}

class CodexaPluginScope<
	StateExt extends StateShape = Empty,
	PluginName extends string = string,
	Deps extends string = never,
> extends CodexaRouter<StateExt>
	implements IPluginScope<StateExt, PluginName, Deps> {
	#middlewareOrder = 0;
	#middlewareMap = new Map<number, MiddlewareRegistration<StateExt>>();
	readonly #host: PluginHost;
	readonly #pluginName: PluginName;
	readonly #deps: readonly Deps[];
	readonly #depsSet: ReadonlySet<string>;
	readonly #versionHeader: string;

	constructor(
		host: PluginHost,
		pluginName: PluginName,
		deps: readonly Deps[],
		versionHeader: string,
	) {
		super(`plugin:${pluginName}`, 'plugin', pluginName);
		this.#host = host;
		this.#pluginName = pluginName;
		this.#deps = Object.freeze([...deps]);
		this.#depsSet = new Set(deps);
		this.#versionHeader = normalizeVersionHeader(versionHeader);
	}

	public mount<RouterState extends StateShape>(
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;
	public mount<RouterState extends StateShape>(
		prefix: string,
		router: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps>;
	public mount<RouterState extends StateShape>(
		routerOrPrefix: string | ICodexaHttpRouter<SafeState<RouterState>>,
		router?: ICodexaHttpRouter<SafeState<RouterState>>,
	): IPluginScope<SafeState<StateExt & RouterState>, PluginName, Deps> {
		this.assertNotCommitted('mount routers');
		const prefix = typeof routerOrPrefix === 'string' ? routerOrPrefix : '';
		const target = typeof routerOrPrefix === 'string'
			? router
			: routerOrPrefix;
		if (!(target instanceof CodexaRouter)) {
			frameworkMessage(
				'error',
				'Plugin scope mount() expects a router created by createRouter().',
			);
		}
		this.addSnapshot(
			target.snapshot(),
			prefix,
			undefined,
			this.#pluginName,
		);
		return this as unknown as IPluginScope<
			SafeState<StateExt & RouterState>,
			PluginName,
			Deps
		>;
	}

	public use(
		fn: AppMiddlewareFn<StateExt, never>,
		options?: UseOptionsWithoutExpose,
	): this;
	public use<TExposed extends StateShape, TProvide extends StateShape>(
		fn: AppMiddlewareFn<StateExt, TProvide>,
		options: UseOptionsWithExpose<TExposed, TProvide>,
	): IPluginScope<SafeState<StateExt & TExposed>, PluginName, Deps>;
	public use(
		middleware: PluginMiddlewareConfig<StateExt, never, Empty>,
	): this;
	public use<TExposed extends StateShape, TProvide extends StateShape>(
		middleware: PluginMiddlewareConfig<StateExt, TProvide, TExposed>,
	): IPluginScope<SafeState<StateExt & TExposed>, PluginName, Deps>;
	public use<TProvide extends StateShape = never>(
		fnOrMiddleware:
			| AppMiddlewareFn<StateExt, TProvide>
			| PluginMiddleware,
		options?: UseOptions<StateShape, TProvide>,
	): IPluginScope<StateExt, PluginName, Deps> {
		this.assertNotCommitted('register plugin middleware');
		const fn = typeof fnOrMiddleware === 'function'
			? fnOrMiddleware
			: fnOrMiddleware.fn;
		const resolvedOptions = typeof fnOrMiddleware === 'function'
			? options
			: fnOrMiddleware;
		const id = ++this.#middlewareOrder;
		const appliedOn = normalizeAppliedOn(resolvedOptions?.appliedOn);
		const expose = resolvedOptions?.expose === undefined
			? undefined
			: eraseExpose(resolvedOptions.expose);
		this.#middlewareMap.set(
			id,
			Object.freeze({
				id,
				kind: 'plugin',
				name: resolvedOptions?.name ??
					`${this.#pluginName}:middleware:${id}`,
				priority: resolvedOptions?.priority ?? 0,
				order: id,
				tags: uniqueStrings(resolvedOptions?.tags),
				appliedOn,
				matchers: compileAppliedOn(appliedOn),
				enabled: resolvedOptions?.enabled ?? true,
				scopeId: this.scopeId,
				routerId: undefined,
				routerName: this.name,
				pluginName: this.#pluginName,
				fn: fn as AppMiddlewareFn<StateExt, never, StateShape>,
				expose,
			}),
		);
		return this;
	}

	public version(
		v: string,
	): IPluginVersionedScope<
		StateExt,
		PluginName,
		Deps
	> {
		this.assertNotCommitted('register versioned plugin routes');
		const version = normalizeVersion(v);
		const versionHeader = this.#versionHeader;
		const scope = {
			route: <
				const Route extends string,
				const Middlewares extends readonly unknown[] = readonly [],
			>(
				definition: RouteDefinition<Route, StateExt, Middlewares>,
			): IPluginVersionedScope<StateExt, PluginName, Deps> => {
				this.assertNotCommitted('register versioned plugin routes');
				const methods = Array.isArray(definition.method)
					? definition.method
					: [definition.method];
				for (const method of methods) {
					this.addRouteRegistration(
						method,
						definition.path,
						definition.handler,
						definition.options,
						version,
						versionHeader,
					);
				}
				return scope;
			},
			mount: <RouterState extends StateShape>(
				routerOrPrefix:
					| string
					| ICodexaHttpRouter<SafeState<RouterState>>,
				router?: ICodexaHttpRouter<SafeState<RouterState>>,
			): IPluginScope<
				SafeState<StateExt & RouterState>,
				PluginName,
				Deps
			> => {
				this.assertNotCommitted('mount versioned plugin routers');
				const prefix = typeof routerOrPrefix === 'string'
					? routerOrPrefix
					: '';
				const target = typeof routerOrPrefix === 'string'
					? router
					: routerOrPrefix;
				if (!(target instanceof CodexaRouter)) {
					frameworkMessage(
						'error',
						'Plugin scope version().mount() expects a router created by createRouter().',
					);
				}
				this.addSnapshot(
					target.snapshot(),
					prefix,
					version,
					this.#pluginName,
					versionHeader,
				);
				return this as unknown as IPluginScope<
					SafeState<StateExt & RouterState>,
					PluginName,
					Deps
				>;
			},
		} as IPluginVersionedScope<StateExt, PluginName, Deps>;
		return Object.freeze(scope);
	}

	public onShutdown(hook: Hook): this {
		this.#host.addShutdownHook(this.#pluginName, hook);
		return this;
	}

	public onSuccess(hook: RequestSuccessHook<StateExt>): this {
		this.#host.addSuccessHook(this.#pluginName, hook);
		return this;
	}

	public onError(hook: RequestErrorHook<StateExt>): this {
		this.#host.addErrorHook(this.#pluginName, hook);
		return this;
	}

	public exposeService<
		ServiceName extends keyof PluginServices<PluginName> & string,
	>(
		name: ServiceName,
		service: PluginServices<PluginName>[ServiceName],
	): this {
		this.#host.exposeService(this.#pluginName, name, service);
		return this;
	}

	public getService<
		Name extends Deps,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName] {
		this.#assertDeclaredDependency(pluginName);
		return this.#host.readService(pluginName, serviceName);
	}

	public getServices<Name extends Deps>(
		pluginName: Name,
	): PluginServices<Name> {
		this.#assertDeclaredDependency(pluginName);
		return this.#host.readServices(pluginName);
	}

	public getDependencyNames(): readonly Deps[] {
		return this.#deps;
	}

	public hasDependency(name: string): boolean {
		return this.#depsSet.has(name) && this.#host.hasPlugin(name);
	}

	public hasPlugin(name: string): boolean {
		return this.#host.hasPlugin(name);
	}

	public hasService(pluginName: string, serviceName: string): boolean {
		return this.#depsSet.has(pluginName) &&
			this.#host.hasService(pluginName, serviceName);
	}

	public pluginSnapshot(): PluginScopeSnapshot<StateExt> {
		const snapshot = this.snapshot();
		return Object.freeze({
			name: snapshot.name,
			pluginName: this.#pluginName,
			routes: snapshot.routes,
			middleware: Object.freeze([...this.#middlewareMap.values()]),
		});
	}

	#assertDeclaredDependency(pluginName: string): void {
		if (!this.#depsSet.has(pluginName)) {
			frameworkMessage(
				'error',
				`Plugin "${this.#pluginName}" cannot access "${pluginName}" because it is not declared in dependsOn.`,
			);
		}
	}
}

export function createPluginScope<
	StateExt extends StateShape = Empty,
	PluginName extends string = string,
	Deps extends string = never,
>(
	host: PluginHost,
	pluginName: PluginName,
	deps: readonly Deps[],
	versionHeader: string,
): IPluginScope<StateExt, PluginName, Deps> & {
	pluginSnapshot(): PluginScopeSnapshot<StateExt>;
} {
	return new CodexaPluginScope<StateExt, PluginName, Deps>(
		host,
		pluginName,
		deps,
		versionHeader,
	);
}
