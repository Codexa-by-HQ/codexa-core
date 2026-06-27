import {
	addRoute as rou3Add,
	createRouter as rou3Create,
	findRoute as rou3Find,
	routeToRegExp as rou3ToRegExp,
} from 'rou3';
import { DEFAULT_VERSION_HEADER } from '../_internals/constants.ts';
import type {
	AppListenOptions,
	Empty,
	Hook,
	HookErrorSnapshot,
	HttpMethod,
	ICodexaHttp,
	ICodexaPlugin,
	InspectMiddleware,
	InspectPlugin,
	InspectQuery,
	InspectResult,
	InspectRoute,
	InspectService,
	InstalledPluginInfo,
	LifeCyclePhase,
	PluginServices,
	RequestErrorHook,
	RequestHookEvent,
	RequestSuccessHook,
	RouteParams,
	StateShape,
} from '../mod.ts';
import type {
	BuiltContext,
	CommittedRoute,
	CommittedRouteBucket,
	MiddlewareRegistration,
	PluginHost,
	PluginRecord,
	PluginScopeSnapshot,
	Rou3Router,
	RouteKey,
	RouteMeta,
	RoutePathKey,
	RouteRegistration,
} from '../_internals/types.ts';
import {
	buildCommitRouteIndex,
	buildCtx,
	createHtmlResponse,
	createJsonResponse,
	createMarkdownResponse,
	createRedirectResponse,
	createSendResponse,
	createStreamResponse,
	createTextResponse,
	errorToSnapshot,
	executeHooksSafe,
	formatRouteIdentity,
	frameworkMessage,
	hasAnyTag,
	isRou3MatchResult,
	normalizeName,
	normalizePath,
	normalizePluginMetadata,
	normalizePluginName,
	normalizeRequestPath,
	normalizeServiceName,
	normalizeVersionHeader,
	responseToSnapshot,
	routePathKey,
	routesForMiddleware,
	setPhase,
	sortByPriorityAndOrder,
	toParams,
	tryNormalizeMethod,
	uniqueStrings,
} from '../_internals/helpers.ts';
import { createPluginScope } from './plugin.ts';

class CodexaHttpApp<InstalledPlugins extends string = never>
	implements ICodexaHttp<InstalledPlugins> {
	#phase: LifeCyclePhase = 'idle';
	#matcher: Rou3Router | undefined;
	#compiledRoutesMap = new Map<RouteKey, CommittedRoute<StateShape>>();
	#compiledRouteBuckets = new Map<
		RoutePathKey,
		CommittedRouteBucket<StateShape>
	>();
	#routesMap = new Map<RouteKey, RouteRegistration<StateShape>>();
	#routePathKeys = new Set<RoutePathKey>();
	#middlewaresMap = new Map<number, MiddlewareRegistration<StateShape>>();
	#middlewareOrder = 0;
	#disabledTags = new Set<string>();
	#shutdownHooks: Hook[] = [];
	#pluginShutdownHooks = new Map<string, Hook[]>();
	#successHooks: RequestSuccessHook<StateShape>[] = [];
	#pluginSuccessHooks = new Map<string, RequestSuccessHook<StateShape>[]>();
	#errorHooks: RequestErrorHook<StateShape>[] = [];
	#pluginErrorHooks = new Map<string, RequestErrorHook<StateShape>[]>();
	#installedPlugins = new Set<string>();
	#installingPlugins = new Set<string>();
	#pluginRecords = new Map<string, PluginRecord>();
	#exposedServices = new Map<string, Map<string, unknown>>();
	#serviceViews = new Map<string, Readonly<Record<string, unknown>>>();
	#server: Deno.HttpServer | undefined;
	#stoppedResolve: (() => void) | undefined;
	#shutdownPromise: Promise<void> | undefined;
	#bootPromise: Promise<this> | undefined;
	#committed = false;
	#dirty = true;
	#stoppedPromise = new Promise<void>((resolve) => {
		this.#stoppedResolve = resolve;
	});
	#notFoundHandler: (req: Request) => Response | Promise<Response> = () => {
		return new Response('Not Found', {
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	};
	#errorHandler: (
		err: unknown,
		req: Request,
	) => Response | Promise<Response> = (err) => {
		frameworkMessage('error', 'Unhandled request error.', err, false);
		return new Response('Internal Server Error', {
			status: 500,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	};
	readonly #pluginHost: PluginHost = Object.freeze({
		exposeService: (
			pluginName: string,
			serviceName: string,
			service: unknown,
		) => this.#exposeService(pluginName, serviceName, service),
		readService: <
			Name extends string,
			ServiceName extends keyof PluginServices<Name> & string,
		>(
			pluginName: Name,
			serviceName: ServiceName,
		) => this.#readService(pluginName, serviceName),
		readServices: <Name extends string>(pluginName: Name) =>
			this.#readServices(pluginName),
		addShutdownHook: (pluginName: string, hook: Hook) =>
			this.#addPluginShutdownHook(pluginName, hook),
		addSuccessHook: <StateExt extends StateShape>(
			pluginName: string,
			hook: RequestSuccessHook<StateExt>,
		) => this.#addPluginSuccessHook(pluginName, hook),
		addErrorHook: <StateExt extends StateShape>(
			pluginName: string,
			hook: RequestErrorHook<StateExt>,
		) => this.#addPluginErrorHook(pluginName, hook),
		hasPlugin: (name: string) => this.hasPlugin(name),
		hasService: (pluginName: string, serviceName: string) =>
			this.hasService(pluginName, serviceName),
	});

	constructor(name?: string) {
		normalizeName(name);
	}

	public json(data: unknown, init?: ResponseInit): Response {
		return createJsonResponse(data, init);
	}

	public text(data: string, init?: ResponseInit): Response {
		return createTextResponse(data, init);
	}

	public html(data: string, init?: ResponseInit): Response {
		return createHtmlResponse(data, init);
	}

	public markdown(content: string, init?: ResponseInit): Response {
		return createMarkdownResponse(content, init);
	}

	public redirect(url: string, status?: 301 | 302 | 307 | 308): Response {
		return createRedirectResponse(url, status);
	}

	public stream(
		body: ReadableStream<Uint8Array>,
		init?: ResponseInit,
	): Response {
		return createStreamResponse(body, init);
	}

	public send(body?: BodyInit | null, init?: ResponseInit): Response {
		return createSendResponse(body, init);
	}

	public install<const Name extends string, Deps extends string>(
		plugin: ICodexaPlugin<Name, void, Deps>,
	): ICodexaHttp<InstalledPlugins | Name>;
	public install<const Name extends string, Config, Deps extends string>(
		plugin: ICodexaPlugin<Name, Config, Deps>,
		config: Config,
	): ICodexaHttp<InstalledPlugins | Name>;
	public install<const Name extends string, Config, Deps extends string>(
		plugin: ICodexaPlugin<Name, Config, Deps>,
		config?: Config,
	): ICodexaHttp<InstalledPlugins | Name> {
		this.#assertNotCommitted('install plugins');
		const pluginName = normalizePluginName(plugin.name);
		if (this.#installedPlugins.has(pluginName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" is already installed.`,
			);
		}
		if (this.#installingPlugins.has(pluginName)) {
			frameworkMessage(
				'error',
				`Circular plugin installation detected for "${pluginName}".`,
			);
		}
		const dependsOn = uniqueStrings(plugin.dependsOn);
		for (const dependency of dependsOn) {
			if (!this.#installedPlugins.has(dependency)) {
				frameworkMessage(
					'error',
					`Plugin "${pluginName}" requires "${dependency}" to be installed first.`,
				);
			}
		}

		this.#installingPlugins.add(pluginName);
		this.#exposedServices.set(pluginName, new Map<string, unknown>());
		try {
			const pluginVersionHeader = normalizeVersionHeader(
				plugin.versionHeader,
			);
			const scope = createPluginScope<Empty, Name, Deps>(
				this.#pluginHost,
				pluginName as Name,
				dependsOn as readonly Deps[],
				pluginVersionHeader,
			);
			const setupResult: unknown = plugin.setup(scope, config as Config);
			if (setupResult instanceof Promise) {
				frameworkMessage(
					'error',
					`Plugin "${pluginName}" setup returned a Promise. Install async plugins inside boot() or make setup synchronous for cold-start-safe registration.`,
				);
			}
			this.#addPluginSnapshot(scope.pluginSnapshot());
			this.#dirty = true;
			this.#serviceViews.set(
				pluginName,
				this.#createServiceView(pluginName),
			);
			this.#pluginRecords.set(
				pluginName,
				Object.freeze({
					name: pluginName,
					metadata: normalizePluginMetadata(plugin.metadata),
					dependsOn,
				}),
			);
			this.#installedPlugins.add(pluginName);
			return this as ICodexaHttp<InstalledPlugins | Name>;
		} catch (error) {
			this.#rollbackPluginInstall(pluginName);
			this.#exposedServices.delete(pluginName);
			this.#serviceViews.delete(pluginName);
			this.#pluginShutdownHooks.delete(pluginName);
			this.#pluginSuccessHooks.delete(pluginName);
			this.#pluginErrorHooks.delete(pluginName);
			throw error;
		} finally {
			this.#installingPlugins.delete(pluginName);
		}
	}

	public getService<
		Name extends InstalledPlugins,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName] {
		return this.#readService(pluginName, serviceName);
	}

	public getServices<Name extends InstalledPlugins>(
		pluginName: Name,
	): PluginServices<Name> {
		return this.#readServices(pluginName);
	}

	public hasPlugin(name: string): boolean {
		return this.#installedPlugins.has(name);
	}

	public hasService(pluginName: string, serviceName: string): boolean {
		return this.#exposedServices.get(pluginName)?.has(
			normalizeServiceName(serviceName),
		) ?? false;
	}

	public installedPlugins(): readonly InstalledPluginInfo[] {
		return Object.freeze(
			[...this.#pluginRecords.values()].map((record) =>
				Object.freeze({
					name: record.name,
					metadata: record.metadata,
				})
			),
		);
	}

	public inspect(query?: InspectQuery): InspectResult {
		if (this.#dirty) {
			this.#commit();
		}
		return this.#inspect(query);
	}

	public enableByTags(...tags: string[]): this {
		for (const tag of uniqueStrings(tags)) {
			this.#disabledTags.delete(tag);
			this.#dirty = true;
		}
		if (this.#committed) {
			this.#commit();
		}
		return this;
	}

	public disableByTags(...tags: string[]): this {
		for (const tag of uniqueStrings(tags)) {
			this.#disabledTags.add(tag);
			this.#dirty = true;
		}
		if (this.#committed) {
			this.#commit();
		}
		return this;
	}

	public async boot(setup?: () => Promise<void> | void): Promise<this> {
		if (this.#phase === 'ready' || this.#phase === 'listening') {
			return this;
		}
		if (this.#phase === 'booting' && this.#bootPromise !== undefined) {
			return await this.#bootPromise;
		}
		if (this.#phase !== 'idle') {
			frameworkMessage(
				'error',
				`Cannot boot() while lifecycle phase is ${this.#phase}.`,
			);
		}
		this.#bootPromise = this.#performBoot(setup);
		return await this.#bootPromise;
	}

	public async listen(options: AppListenOptions = {}): Promise<void> {
		await this.boot();
		if (this.#phase !== 'ready') {
			frameworkMessage(
				'error',
				`Cannot listen() while lifecycle phase is ${this.#phase}.`,
			);
		}
		const serveOptions = this.#createServeOptions(options);
		this.#phase = setPhase(this.#phase, 'listening');
		try {
			const server = Deno.serve(
				serveOptions,
				(request: Request) => this.dispatch(request),
			);
			this.#server = server;
			await this.#server.finished;
		} catch (error) {
			if (this.#phase !== 'shutting_down' && this.#phase !== 'stopped') {
				await this.#handleServerFailure(error);
			}
			throw error;
		} finally {
			if (this.#phase !== 'stopped') {
				await this.shutdown();
			}
		}
	}

	public async dispatch(request: Request): Promise<Response> {
		if (!this.#committed) {
			await this.boot();
		}
		if (this.#phase === 'shutting_down' || this.#phase === 'stopped') {
			const response = new Response('Service Unavailable', {
				status: 503,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
			await this.#emitRequestHooksForRequest(request, response);
			return response;
		}

		let built: BuiltContext<StateShape> | undefined;
		let matchedRoute: RouteMeta | undefined;
		try {
			const url = new URL(request.url);
			const method = tryNormalizeMethod(request.method);
			if (method === undefined) {
				const response = new Response('Method Not Implemented', {
					status: 501,
					headers: { 'content-type': 'text/plain; charset=utf-8' },
				});
				await this.#emitRequestHooksForRequest(request, response);
				return response;
			}
			const matcher = this.#matcher;
			if (matcher === undefined) {
				frameworkMessage('error', 'Router matcher is not ready.');
			}
			const found = rou3Find(
				matcher,
				method,
				normalizeRequestPath(url.pathname),
				{
					params: true,
					normalize: false,
				},
			);
			if (!isRou3MatchResult(found) || typeof found.data !== 'string') {
				const response = await this.#notFoundHandler(request);
				await this.#emitRequestHooksForRequest(request, response);
				return response;
			}
			const route = this.#selectCommittedRoute(
				found.data as RoutePathKey,
				request,
			);
			if (route === undefined || !route.meta.enabled) {
				const response = await this.#notFoundHandler(request);
				await this.#emitRequestHooksForRequest(request, response);
				return response;
			}
			matchedRoute = route.meta;
			built = buildCtx<StateShape>(request, toParams(found.params));
			const response = await this.#executeCommittedRoute(route, built);
			await this.#emitRequestHooks(
				built,
				response,
				undefined,
				matchedRoute,
			);
			return response;
		} catch (error) {
			const response = await this.#handleRequestError(error, request);
			if (built === undefined) {
				await this.#emitRequestHooksForRequest(
					request,
					response,
					error,
					matchedRoute,
				);
			} else {
				await this.#emitRequestHooks(
					built,
					response,
					error,
					matchedRoute,
				);
			}
			return response;
		}
	}

	public async shutdown(): Promise<void> {
		if (this.#phase === 'stopped') {
			return await this.#stoppedPromise;
		}
		if (this.#shutdownPromise !== undefined) {
			return await this.#shutdownPromise;
		}
		this.#shutdownPromise = this.#performShutdown();
		return await this.#shutdownPromise;
	}

	public whenStopped(): Promise<void> {
		return this.#stoppedPromise;
	}

	public onShutdown(hook: Hook): this {
		this.#assertNotCommitted('register shutdown hooks');
		this.#shutdownHooks.push(hook);
		return this;
	}

	public onSuccess(hook: RequestSuccessHook<StateShape>): this {
		this.#assertNotCommitted('register success hooks');
		this.#successHooks.push(hook);
		return this;
	}

	public onError(hook: RequestErrorHook<StateShape>): this {
		this.#assertNotCommitted('register error hooks');
		this.#errorHooks.push(hook);
		return this;
	}

	public onNotFound(
		handler: (req: Request) => Response | Promise<Response>,
	): this {
		this.#assertNotCommitted('register not-found handler');
		this.#notFoundHandler = handler;
		return this;
	}

	public onException(
		handler: (err: unknown, req: Request) => Response | Promise<Response>,
	): this {
		this.#assertNotCommitted('register exception handler');
		this.#errorHandler = handler;
		return this;
	}

	public hasRoute(method: HttpMethod, path: string): boolean {
		return this.#routePathKeys.has(routePathKey(method, path));
	}

	public toRegExp(method: HttpMethod, path: string): RegExp | null {
		if (!this.hasRoute(method, path)) {
			return null;
		}
		return rou3ToRegExp(normalizePath(path));
	}

	public getPhase(): LifeCyclePhase {
		return this.#phase;
	}

	public get size(): number {
		return this.#committed
			? this.#compiledRoutesMap.size
			: this.#routesMap.size;
	}

	public getServer(): Deno.HttpServer | undefined {
		return this.#server;
	}

	#exposeService<PluginName extends string>(
		pluginName: PluginName,
		serviceName: string,
		service: unknown,
	): void {
		const normalizedServiceName = normalizeServiceName(serviceName);
		const services = this.#exposedServices.get(pluginName);
		if (
			services === undefined || !this.#installingPlugins.has(pluginName)
		) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" can expose services only during setup().`,
			);
		}
		if (services.has(normalizedServiceName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" already exposes service "${normalizedServiceName}".`,
			);
		}
		services.set(normalizedServiceName, service);
	}

	#addPluginShutdownHook(pluginName: string, hook: Hook): void {
		this.#assertInstalling(pluginName, 'register shutdown hooks');
		this.#pushPluginHook(this.#pluginShutdownHooks, pluginName, hook);
	}

	#addPluginSuccessHook<StateExt extends StateShape>(
		pluginName: string,
		hook: RequestSuccessHook<StateExt>,
	): void {
		this.#assertInstalling(pluginName, 'register success hooks');
		this.#pushPluginHook(
			this.#pluginSuccessHooks,
			pluginName,
			hook as RequestSuccessHook<StateShape>,
		);
	}

	#addPluginErrorHook<StateExt extends StateShape>(
		pluginName: string,
		hook: RequestErrorHook<StateExt>,
	): void {
		this.#assertInstalling(pluginName, 'register error hooks');
		this.#pushPluginHook(
			this.#pluginErrorHooks,
			pluginName,
			hook as RequestErrorHook<StateShape>,
		);
	}

	async #performBoot(setup?: () => Promise<void> | void): Promise<this> {
		this.#phase = setPhase(this.#phase, 'booting');
		try {
			if (setup !== undefined) {
				await setup();
			}
			if (this.#dirty) {
				this.#commit();
			}
			this.#committed = true;
			this.#phase = setPhase(this.#phase, 'ready');
			return this;
		} catch (error) {
			this.#phase = setPhase(this.#phase, 'stopped');
			this.#resolveStopped();
			throw error;
		}
	}

	#createServeOptions(
		options: AppListenOptions,
	): Deno.ServeTcpOptions | (Deno.ServeTcpOptions & Deno.TlsCertifiedKeyPem) {
		if (options.secure === true) {
			if (options.cert === undefined || options.cert.trim() === '') {
				frameworkMessage(
					'error',
					'secure listen() requires a TLS cert.',
				);
			}
			if (options.key === undefined || options.key.trim() === '') {
				frameworkMessage(
					'error',
					'secure listen() requires a TLS key.',
				);
			}
			return {
				port: options.port ?? 8000,
				hostname: options.hostname,
				signal: options.signal,
				onListen: options.onListen,
				cert: options.cert,
				key: options.key,
			};
		}
		return {
			port: options.port ?? 8000,
			hostname: options.hostname,
			signal: options.signal,
			onListen: options.onListen,
		};
	}

	async #handleServerFailure(error: unknown): Promise<void> {
		frameworkMessage('error', 'Server failed.', error, false);
		await this.shutdown();
	}

	#resolveStopped(): void {
		this.#stoppedResolve?.();
		this.#stoppedResolve = undefined;
	}

	async #performShutdown(): Promise<void> {
		if (this.#phase === 'idle') {
			this.#phase = setPhase(this.#phase, 'stopped');
		} else if (this.#phase === 'ready' || this.#phase === 'listening') {
			this.#phase = setPhase(this.#phase, 'shutting_down');
		}
		try {
			const server = this.#server;
			if (server !== undefined) {
				this.#server = undefined;
				try {
					await server.shutdown();
				} catch (error) {
					frameworkMessage(
						'error',
						'Server shutdown failed.',
						error,
						false,
					);
				}
			}
			await executeHooksSafe(this.#shutdownHooks, 'shutdown');
			for (const hooks of this.#pluginShutdownHooks.values()) {
				await executeHooksSafe(hooks, 'shutdown');
			}
		} finally {
			if (this.#phase !== 'stopped') {
				this.#phase = setPhase(this.#phase, 'stopped');
			}
			this.#resolveStopped();
		}
	}

	async #executeCommittedRoute(
		route: CommittedRoute<StateShape>,
		built: BuiltContext<StateShape>,
	): Promise<Response> {
		for (const entry of route.middleware) {
			const runCtx = entry.kind === 'inline'
				? built.withLocalProvide(entry.expose)
				: built.withStateProvide(entry.expose);
			const output = await entry.fn(runCtx);
			if (output instanceof Response) {
				return output;
			}
		}
		return await route.handler(built.ctx);
	}

	#selectCommittedRoute(
		matchKey: RoutePathKey,
		request: Request,
	): CommittedRoute<StateShape> | undefined {
		const bucket = this.#compiledRouteBuckets.get(matchKey);
		if (bucket === undefined) {
			return undefined;
		}
		const requestedVersion = bucket.versionHeader === undefined
			? null
			: request.headers.get(bucket.versionHeader);
		if (requestedVersion !== null) {
			const versionedRoute = bucket.versions.get(requestedVersion);
			if (versionedRoute !== undefined) {
				return versionedRoute;
			}
			if (bucket.versions.size > 0) {
				return undefined;
			}
		}
		return bucket.unversioned;
	}

	async #emitRequestHooksForRequest(
		request: Request,
		response: Response,
		error?: unknown,
		route?: RouteMeta,
	): Promise<Response> {
		const shouldRunErrorHooks = error !== undefined ||
			response.status >= 400;
		if (!this.#hasRequestHooks(shouldRunErrorHooks, route?.pluginName)) {
			return response;
		}
		const built = buildCtx<StateShape>(request, Object.freeze({}));
		return await this.#emitRequestHooks(built, response, error, route);
	}

	async #emitRequestHooks(
		built: BuiltContext<StateShape>,
		response: Response,
		error?: unknown,
		route?: RouteMeta,
	): Promise<Response> {
		const pluginName = route?.pluginName;
		const shouldRunErrorHooks = error !== undefined ||
			response.status >= 400;
		if (!this.#hasRequestHooks(shouldRunErrorHooks, pluginName)) {
			return response;
		}
		const responseSnapshot = responseToSnapshot(response);
		const base = built.hookEvent(route);
		if (!shouldRunErrorHooks) {
			const event = Object.freeze({
				...base,
				response: responseSnapshot,
			}) as RequestHookEvent<StateShape>;
			await this.#runSuccessHooks(event, pluginName);
			return response;
		}

		const event = Object.freeze({
			...base,
			response: responseSnapshot,
			...(error === undefined ? {} : { error: errorToSnapshot(error) }),
		}) as RequestHookEvent<StateShape> & {
			readonly error?: HookErrorSnapshot;
		};
		await this.#runErrorHooks(event, pluginName);
		return response;
	}

	#hasRequestHooks(runErrorHooks: boolean, pluginName?: string): boolean {
		if (runErrorHooks) {
			return this.#errorHooks.length > 0 ||
				(pluginName !== undefined &&
					(this.#pluginErrorHooks.get(pluginName)?.length ?? 0) > 0);
		}
		return this.#successHooks.length > 0 ||
			(pluginName !== undefined &&
				(this.#pluginSuccessHooks.get(pluginName)?.length ?? 0) > 0);
	}

	async #runSuccessHooks(
		event: RequestHookEvent<StateShape>,
		pluginName?: string,
	): Promise<void> {
		await this.#runHookList(this.#successHooks, event, 'onSuccess');
		const hooks = pluginName === undefined
			? undefined
			: this.#pluginSuccessHooks.get(pluginName);
		if (hooks !== undefined) {
			await this.#runHookList(hooks, event, 'onSuccess');
		}
	}

	async #runErrorHooks(
		event: RequestHookEvent<StateShape> & {
			readonly error?: HookErrorSnapshot;
		},
		pluginName?: string,
	): Promise<void> {
		await this.#runHookList(this.#errorHooks, event, 'onError');
		const hooks = pluginName === undefined
			? undefined
			: this.#pluginErrorHooks.get(pluginName);
		if (hooks !== undefined) {
			await this.#runHookList(hooks, event, 'onError');
		}
	}

	async #runHookList<TEvent>(
		hooks: readonly ((event: TEvent) => void | Promise<void>)[],
		event: TEvent,
		label: string,
	): Promise<void> {
		for (const hook of hooks) {
			try {
				await hook(event);
			} catch (hookError) {
				frameworkMessage(
					'error',
					`${label} hook failed.`,
					hookError,
					false,
				);
			}
		}
	}

	async #handleRequestError(
		error: unknown,
		request: Request,
	): Promise<Response> {
		try {
			return await this.#errorHandler(error, request);
		} catch (handlerError) {
			frameworkMessage(
				'error',
				'Custom onException handler failed.',
				handlerError,
				false,
			);
			return new Response('Internal Server Error', {
				status: 500,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
		}
	}

	#addPluginSnapshot(snapshot: PluginScopeSnapshot<StateShape>): void {
		for (const route of snapshot.routes) {
			if (this.#routesMap.has(route.key)) {
				frameworkMessage(
					'error',
					`Duplicate route across plugins: ${
						formatRouteIdentity(
							route.method,
							route.path,
							route.meta.version,
						)
					}`,
				);
			}
		}
		for (const route of snapshot.routes) {
			this.#routesMap.set(route.key, route);
			this.#routePathKeys.add(route.matchKey);
		}
		for (const middleware of snapshot.middleware) {
			const id = ++this.#middlewareOrder;
			this.#middlewaresMap.set(
				id,
				Object.freeze({
					...middleware,
					id,
					order: id,
				}),
			);
		}
	}

	#rollbackPluginInstall(pluginName: string): void {
		let routesChanged = false;
		for (const [key, route] of this.#routesMap) {
			if (route.meta.pluginName === pluginName) {
				this.#routesMap.delete(key);
				routesChanged = true;
			}
		}
		for (const [id, middleware] of this.#middlewaresMap) {
			if (middleware.pluginName === pluginName) {
				this.#middlewaresMap.delete(id);
			}
		}
		if (routesChanged) {
			this.#rebuildRoutePathKeys();
			this.#dirty = true;
		}
	}

	#rebuildRoutePathKeys(): void {
		this.#routePathKeys = new Set(
			[...this.#routesMap.values()].map((route) => route.matchKey),
		);
	}

	#commit(): void {
		const routes = [...this.#routesMap.values()];
		const nextMatcher = rou3Create();
		const nextCompiled = new Map<RouteKey, CommittedRoute<StateShape>>();
		const addedMatcherKeys = new Set<RoutePathKey>();
		const mutableBuckets = new Map<
			RoutePathKey,
			{
				unversioned?: CommittedRoute<StateShape>;
				versionHeader?: string;
				versions: Map<string, CommittedRoute<StateShape>>;
			}
		>();
		const middlewareByRoute = new Map<
			RouteKey,
			MiddlewareRegistration<StateShape>[]
		>();

		const enabledRoutes: RouteRegistration<StateShape>[] = [];
		const enabledRouteKeys = new Set<RouteKey>();
		for (const route of routes) {
			if (
				route.enabled && !hasAnyTag(route.meta.tags, this.#disabledTags)
			) {
				enabledRoutes.push(route);
				enabledRouteKeys.add(route.key);
				middlewareByRoute.set(route.key, []);
			}
		}

		const pluginMiddleware = sortByPriorityAndOrder(
			[...this.#middlewaresMap.values()].filter((middleware) =>
				middleware.enabled &&
				middleware.matchers.length > 0 &&
				!hasAnyTag(middleware.tags, this.#disabledTags)
			),
		);

		if (pluginMiddleware.length > 0 && enabledRoutes.length > 0) {
			const routeIndex = buildCommitRouteIndex(enabledRoutes);
			for (const middleware of pluginMiddleware) {
				const matchedRoutes = routesForMiddleware(
					middleware,
					routeIndex,
				);
				for (const route of matchedRoutes) {
					middlewareByRoute.get(route.key)?.push(middleware);
				}
			}
		}

		for (const route of routes) {
			const effectiveEnabled = enabledRouteKeys.has(route.key);
			const globals = effectiveEnabled
				? sortByPriorityAndOrder(middlewareByRoute.get(route.key) ?? [])
				: [];
			const inline = effectiveEnabled
				? sortByPriorityAndOrder(
					route.middleware.filter((middleware) =>
						middleware.enabled &&
						!hasAnyTag(middleware.tags, this.#disabledTags)
					),
				)
				: [];
			const meta: RouteMeta = Object.freeze({
				...route.meta,
				enabled: effectiveEnabled,
			});
			const committed = Object.freeze({
				middleware: Object.freeze([...globals, ...inline]),
				handler: route.handler,
				meta,
			});
			nextCompiled.set(route.key, committed);
			if (effectiveEnabled) {
				let bucket = mutableBuckets.get(route.matchKey);
				if (bucket === undefined) {
					bucket = {
						versions: new Map<string, CommittedRoute<StateShape>>(),
					};
					mutableBuckets.set(route.matchKey, bucket);
				}
				if (route.meta.version === undefined) {
					bucket.unversioned = committed;
				} else {
					const routeVersionHeader = route.meta.versionHeader ??
						DEFAULT_VERSION_HEADER;
					if (
						bucket.versionHeader !== undefined &&
						bucket.versionHeader !== routeVersionHeader
					) {
						frameworkMessage(
							'error',
							`Version header conflict for ${
								formatRouteIdentity(route.method, route.path)
							}. Use one version header per method/path bucket.`,
						);
					}
					bucket.versionHeader = routeVersionHeader;
					bucket.versions.set(route.meta.version, committed);
				}
				if (!addedMatcherKeys.has(route.matchKey)) {
					rou3Add(
						nextMatcher,
						route.method,
						route.path,
						route.matchKey,
					);
					addedMatcherKeys.add(route.matchKey);
				}
			}
		}

		this.#matcher = nextMatcher;
		this.#compiledRoutesMap = nextCompiled;
		this.#compiledRouteBuckets = new Map(
			[...mutableBuckets].map(([key, bucket]) => [
				key,
				Object.freeze({
					unversioned: bucket.unversioned,
					versionHeader: bucket.versionHeader,
					versions: bucket.versions,
				}),
			]),
		);
		this.#dirty = false;
	}

	#inspect(query?: InspectQuery): InspectResult {
		const includeDisabled = query?.includeDisabled !== false;
		const hasQuery = query !== undefined &&
			((query.tags?.length ?? 0) > 0 ||
				(query.plugins?.length ?? 0) > 0 ||
				(query.routes?.length ?? 0) > 0 ||
				(query.services?.length ?? 0) > 0 ||
				(query.methods?.length ?? 0) > 0 ||
				(query.versions?.length ?? 0) > 0);
		const wantsRoutes = !hasQuery ||
			(query?.tags?.length ?? 0) > 0 ||
			(query?.plugins?.length ?? 0) > 0 ||
			(query?.routes?.length ?? 0) > 0 ||
			(query?.methods?.length ?? 0) > 0 ||
			(query?.versions?.length ?? 0) > 0;
		const wantsMiddlewares = hasQuery &&
			((query?.tags?.length ?? 0) > 0 ||
				(query?.plugins?.length ?? 0) > 0);
		const wantsPlugins = hasQuery &&
			((query?.tags?.length ?? 0) > 0 ||
				(query?.plugins?.length ?? 0) > 0);
		const wantsServices = hasQuery && (query?.services?.length ?? 0) > 0;

		const routeList = [...this.#routesMap.values()].sort((a, b) =>
			a.order - b.order
		);
		const allRoutes = routeList.map((route) => this.#toInspectRoute(route));
		const allMiddlewares = wantsMiddlewares
			? [...this.#middlewaresMap.values()].map((middleware) =>
				this.#toInspectMiddleware(middleware)
			)
			: [];
		const routesByPlugin = wantsPlugins
			? this.#groupInspectRoutesByPlugin(allRoutes)
			: new Map<string, readonly InspectRoute[]>();
		const middlewareCountByPlugin = wantsPlugins
			? this.#countMiddlewaresByPlugin()
			: new Map<string, number>();
		const allPlugins = wantsPlugins
			? [...this.#pluginRecords.values()].map((plugin) =>
				this.#toInspectPlugin(
					plugin,
					routesByPlugin.get(plugin.name) ?? [],
					middlewareCountByPlugin.get(plugin.name) ?? 0,
				)
			)
			: [];

		const filteredRoutes = wantsRoutes
			? allRoutes.filter((route) =>
				(includeDisabled || route.enabled) &&
				this.#matchesRouteQuery(route, query)
			)
			: [];
		const filteredMiddlewares = wantsMiddlewares
			? allMiddlewares.filter((middleware) =>
				this.#matchesMiddlewareQuery(middleware, query)
			)
			: [];
		const filteredPlugins = wantsPlugins
			? allPlugins.filter((plugin) =>
				this.#matchesPluginQuery(plugin, query)
			)
			: [];
		const filteredServices = wantsServices
			? this.#inspectServicesForQuery(query)
			: [];

		const enabledRouteCount =
			allRoutes.filter((route) => route.enabled).length;
		return Object.freeze({
			query,
			summary: Object.freeze({
				routeCount: allRoutes.length,
				enabledRouteCount,
				disabledRouteCount: allRoutes.length - enabledRouteCount,
				pluginCount: this.#pluginRecords.size,
				serviceCount: this.#countExposedServices(),
				middlewareCount: this.#middlewaresMap.size,
			}),
			routes: Object.freeze(filteredRoutes),
			middlewares: Object.freeze(filteredMiddlewares),
			plugins: Object.freeze(filteredPlugins),
			services: Object.freeze(filteredServices),
		});
	}

	#toInspectRoute(route: RouteRegistration<StateShape>): InspectRoute {
		const compiled = this.#compiledRoutesMap.get(route.key);
		const meta = compiled?.meta ?? route.meta;
		const middlewares = compiled?.middleware ?? route.middleware;
		return Object.freeze({
			name: meta.name,
			method: meta.method,
			path: meta.path,
			enabled: meta.enabled,
			configuredEnabled: route.enabled,
			tags: meta.tags,
			pluginName: meta.pluginName,
			version: meta.version,
			versionHeader: meta.versionHeader,
			openapi: meta.openapi,
			middlewares: Object.freeze(
				middlewares.map((middleware) =>
					Object.freeze({
						name: middleware.name,
						kind: middleware.kind,
						priority: middleware.priority,
						pluginName: middleware.pluginName,
					})
				),
			),
		});
	}

	#toInspectMiddleware(
		middleware: MiddlewareRegistration<StateShape>,
	): InspectMiddleware {
		return Object.freeze({
			name: middleware.name,
			kind: middleware.kind,
			enabled: middleware.enabled &&
				!hasAnyTag(middleware.tags, this.#disabledTags),
			tags: middleware.tags,
			appliedOn: middleware.appliedOn,
			priority: middleware.priority,
			pluginName: middleware.pluginName,
		});
	}

	#toInspectPlugin(
		plugin: PluginRecord,
		routes: readonly InspectRoute[],
		middlewareCount: number,
	): InspectPlugin {
		const services = [
			...(this.#exposedServices.get(plugin.name)?.keys() ?? []),
		];
		return Object.freeze({
			name: plugin.name,
			metadata: plugin.metadata,
			dependsOn: plugin.dependsOn,
			services: Object.freeze(services),
			routeCount: routes.length,
			unversionedRouteCount: routes.filter((route) =>
				route.version === undefined
			).length,
			versionedRouteCount:
				routes.filter((route) => route.version !== undefined).length,
			middlewareCount,
			routes: Object.freeze(routes),
		});
	}

	#groupInspectRoutesByPlugin(
		routes: readonly InspectRoute[],
	): Map<string, readonly InspectRoute[]> {
		const mutable = new Map<string, InspectRoute[]>();
		for (const route of routes) {
			if (route.pluginName === undefined) {
				continue;
			}
			let pluginRoutes = mutable.get(route.pluginName);
			if (pluginRoutes === undefined) {
				pluginRoutes = [];
				mutable.set(route.pluginName, pluginRoutes);
			}
			pluginRoutes.push(route);
		}
		const grouped = new Map<string, readonly InspectRoute[]>();
		for (const [pluginName, pluginRoutes] of mutable) {
			grouped.set(pluginName, Object.freeze(pluginRoutes));
		}
		return grouped;
	}

	#countMiddlewaresByPlugin(): Map<string, number> {
		const counts = new Map<string, number>();
		for (const middleware of this.#middlewaresMap.values()) {
			if (middleware.pluginName === undefined) {
				continue;
			}
			counts.set(
				middleware.pluginName,
				(counts.get(middleware.pluginName) ?? 0) + 1,
			);
		}
		return counts;
	}

	#countExposedServices(): number {
		let count = 0;
		for (const services of this.#exposedServices.values()) {
			count += services.size;
		}
		return count;
	}

	#inspectAllServices(): readonly InspectService[] {
		const services: InspectService[] = [];
		this.#forEachExposedService((pluginName, serviceName) => {
			services.push(this.#toInspectService(pluginName, serviceName));
		});
		return Object.freeze(services);
	}

	#inspectServicesForQuery(query?: InspectQuery): readonly InspectService[] {
		const requested = uniqueStrings(query?.services);
		if (requested.length === 0) {
			return this.#inspectAllServices();
		}
		const services: InspectService[] = [];
		for (const serviceName of requested) {
			let found = false;
			this.#forEachExposedService((pluginName, exposedServiceName) => {
				if (exposedServiceName === serviceName) {
					found = true;
					services.push(
						this.#toInspectService(pluginName, exposedServiceName),
					);
				}
			});
			if (!found) {
				services.push(Object.freeze({
					name: serviceName,
					exists: false,
				}));
			}
		}
		return Object.freeze(services);
	}

	#forEachExposedService(
		visit: (pluginName: string, serviceName: string) => void,
	): void {
		for (const [pluginName, pluginServices] of this.#exposedServices) {
			for (const serviceName of pluginServices.keys()) {
				visit(pluginName, serviceName);
			}
		}
	}

	#toInspectService(
		pluginName: string,
		serviceName: string,
	): InspectService {
		return Object.freeze({
			name: serviceName,
			pluginName,
			exists: true,
		});
	}

	#matchesRouteQuery(route: InspectRoute, query?: InspectQuery): boolean {
		if (query === undefined) {
			return true;
		}
		const tags = uniqueStrings(query.tags);
		if (tags.length > 0 && !hasAnyTag(route.tags, new Set(tags))) {
			return false;
		}
		const plugins = uniqueStrings(query.plugins);
		if (
			plugins.length > 0 &&
			(route.pluginName === undefined ||
				!plugins.includes(route.pluginName))
		) {
			return false;
		}
		const routes = uniqueStrings(query.routes);
		if (routes.length > 0 && !routes.includes(route.name)) {
			return false;
		}
		const methods = query.methods ?? [];
		if (methods.length > 0 && !methods.includes(route.method)) {
			return false;
		}
		const versions = uniqueStrings(query.versions);
		if (
			versions.length > 0 &&
			(route.version === undefined || !versions.includes(route.version))
		) {
			return false;
		}
		return true;
	}

	#matchesMiddlewareQuery(
		middleware: InspectMiddleware,
		query?: InspectQuery,
	): boolean {
		if (query === undefined) {
			return true;
		}
		const tags = uniqueStrings(query.tags);
		const plugins = uniqueStrings(query.plugins);
		return (tags.length === 0 ||
			hasAnyTag(middleware.tags, new Set(tags))) &&
			(plugins.length === 0 ||
				(middleware.pluginName !== undefined &&
					plugins.includes(middleware.pluginName)));
	}

	#matchesPluginQuery(plugin: InspectPlugin, query?: InspectQuery): boolean {
		if (query === undefined) {
			return true;
		}
		const plugins = uniqueStrings(query.plugins);
		if (plugins.length > 0 && !plugins.includes(plugin.name)) {
			return false;
		}
		const tags = uniqueStrings(query.tags);
		if (
			tags.length > 0 &&
			!hasAnyTag(plugin.metadata?.tags ?? [], new Set(tags)) &&
			!plugin.routes.some((route) => hasAnyTag(route.tags, new Set(tags)))
		) {
			return false;
		}
		return true;
	}

	#readService<
		Name extends string,
		ServiceName extends keyof PluginServices<Name> & string,
	>(
		pluginName: Name,
		serviceName: ServiceName,
	): PluginServices<Name>[ServiceName] {
		const service = this.#getRawService(pluginName, serviceName);
		return service as PluginServices<Name>[ServiceName];
	}

	#readServices<Name extends string>(pluginName: Name): PluginServices<Name> {
		const view = this.#serviceViews.get(pluginName);
		if (view === undefined || !this.#installedPlugins.has(pluginName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" is not installed.`,
			);
		}
		return view as PluginServices<Name>;
	}

	#createServiceView(pluginName: string): Readonly<Record<string, unknown>> {
		const services = this.#exposedServices.get(pluginName);
		if (services === undefined) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" has no exposed service registry.`,
			);
		}
		return Object.freeze(Object.fromEntries(services));
	}

	#getRawService(pluginName: string, serviceName: string): unknown {
		const normalizedServiceName = normalizeServiceName(serviceName);
		const services = this.#exposedServices.get(pluginName);
		if (services === undefined || !this.#installedPlugins.has(pluginName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" is not installed.`,
			);
		}
		if (!services.has(normalizedServiceName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" does not expose service "${normalizedServiceName}".`,
			);
		}
		return services.get(normalizedServiceName);
	}

	#assertNotCommitted(action: string): void {
		if (this.#committed) {
			frameworkMessage(
				'error',
				`Cannot ${action} after boot(). All registrations must happen before boot().`,
			);
		}
	}

	#assertInstalling(pluginName: string, action: string): void {
		if (!this.#installingPlugins.has(pluginName)) {
			frameworkMessage(
				'error',
				`Plugin "${pluginName}" can ${action} only during setup().`,
			);
		}
	}

	#pushPluginHook<T>(
		map: Map<string, T[]>,
		pluginName: string,
		hook: T,
	): void {
		let hooks = map.get(pluginName);
		if (hooks === undefined) {
			hooks = [];
			map.set(pluginName, hooks);
		}
		hooks.push(hook);
	}
}

export function createApp<InstalledPlugins extends string = never>(
	name?: string,
): ICodexaHttp<InstalledPlugins> {
	return new CodexaHttpApp<InstalledPlugins>(name);
}

export function http<InstalledPlugins extends string = never>(
	name?: string,
): ICodexaHttp<InstalledPlugins> {
	return createApp<InstalledPlugins>(name);
}
