/* @ts-self-types="./http.d.ts" */
import { addRoute as rou3Add, createRouter as rou3Create, findRoute as rou3Find, routeToRegExp as rou3ToRegExp, } from "../../../providers/rou3.js";
import { DEFAULT_VERSION_HEADER } from "../_internals/constants.js";
import { buildCommitRouteIndex, buildCtx, createHtmlResponse, createJsonResponse, createMarkdownResponse, createRedirectResponse, createSendResponse, createStreamResponse, createTextResponse, errorToSnapshot, executeHooksSafe, formatRouteIdentity, frameworkMessage, hasAnyTag, isRou3MatchResult, normalizeName, normalizePath, normalizePluginMetadata, normalizePluginName, normalizeRequestPath, normalizeServiceName, normalizeVersionHeader, responseToSnapshot, routePathKey, routesForMiddleware, setPhase, sortByPriorityAndOrder, toParams, tryNormalizeMethod, uniqueStrings, } from "../_internals/helpers.js";
import { createPluginScope } from "./plugin.js";
class CodexaHttpApp {
    #phase = 'idle';
    #matcher;
    #compiledRoutesMap = new Map();
    #compiledRouteBuckets = new Map();
    #routesMap = new Map();
    #routePathKeys = new Set();
    #middlewaresMap = new Map();
    #middlewareOrder = 0;
    #disabledTags = new Set();
    #shutdownHooks = [];
    #pluginShutdownHooks = new Map();
    #successHooks = [];
    #pluginSuccessHooks = new Map();
    #errorHooks = [];
    #pluginErrorHooks = new Map();
    #installedPlugins = new Set();
    #installingPlugins = new Set();
    #pluginRecords = new Map();
    #exposedServices = new Map();
    #serviceViews = new Map();
    #stoppedResolve;
    #shutdownPromise;
    #bootPromise;
    #committed = false;
    #dirty = true;
    #stoppedPromise = new Promise((resolve) => {
        this.#stoppedResolve = resolve;
    });
    #notFoundHandler = () => {
        return new Response('Not Found', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    };
    #errorHandler = (err) => {
        frameworkMessage('error', 'Unhandled request error.', err, false);
        return new Response('Internal Server Error', {
            status: 500,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    };
    #pluginHost = Object.freeze({
        exposeService: (pluginName, serviceName, service) => this.#exposeService(pluginName, serviceName, service),
        readService: (pluginName, serviceName) => this.#readService(pluginName, serviceName),
        readServices: (pluginName) => this.#readServices(pluginName),
        addShutdownHook: (pluginName, hook) => this.#addPluginShutdownHook(pluginName, hook),
        addSuccessHook: (pluginName, hook) => this.#addPluginSuccessHook(pluginName, hook),
        addErrorHook: (pluginName, hook) => this.#addPluginErrorHook(pluginName, hook),
        hasPlugin: (name) => this.hasPlugin(name),
        hasService: (pluginName, serviceName) => this.hasService(pluginName, serviceName),
    });
    constructor(name) {
        normalizeName(name);
    }
    json(data, init) {
        return createJsonResponse(data, init);
    }
    text(data, init) {
        return createTextResponse(data, init);
    }
    html(data, init) {
        return createHtmlResponse(data, init);
    }
    markdown(content, init) {
        return createMarkdownResponse(content, init);
    }
    redirect(url, status) {
        return createRedirectResponse(url, status);
    }
    stream(body, init) {
        return createStreamResponse(body, init);
    }
    send(body, init) {
        return createSendResponse(body, init);
    }
    install(plugin, config) {
        this.#assertNotCommitted('install plugins');
        const pluginName = normalizePluginName(plugin.name);
        if (this.#installedPlugins.has(pluginName)) {
            frameworkMessage('error', `Plugin "${pluginName}" is already installed.`);
        }
        if (this.#installingPlugins.has(pluginName)) {
            frameworkMessage('error', `Circular plugin installation detected for "${pluginName}".`);
        }
        const dependsOn = uniqueStrings(plugin.dependsOn);
        for (const dependency of dependsOn) {
            if (!this.#installedPlugins.has(dependency)) {
                frameworkMessage('error', `Plugin "${pluginName}" requires "${dependency}" to be installed first.`);
            }
        }
        this.#installingPlugins.add(pluginName);
        this.#exposedServices.set(pluginName, new Map());
        try {
            const pluginVersionHeader = normalizeVersionHeader(plugin.versionHeader);
            const scope = createPluginScope(this.#pluginHost, pluginName, dependsOn, pluginVersionHeader);
            const setupResult = plugin.setup(scope, config);
            if (setupResult instanceof Promise) {
                frameworkMessage('error', `Plugin "${pluginName}" setup returned a Promise. Install async plugins inside boot() or make setup synchronous for cold-start-safe registration.`);
            }
            this.#addPluginSnapshot(scope.pluginSnapshot());
            this.#dirty = true;
            this.#serviceViews.set(pluginName, this.#createServiceView(pluginName));
            this.#pluginRecords.set(pluginName, Object.freeze({
                name: pluginName,
                metadata: normalizePluginMetadata(plugin.metadata),
                dependsOn,
            }));
            this.#installedPlugins.add(pluginName);
            return this;
        }
        catch (error) {
            this.#rollbackPluginInstall(pluginName);
            this.#exposedServices.delete(pluginName);
            this.#serviceViews.delete(pluginName);
            this.#pluginShutdownHooks.delete(pluginName);
            this.#pluginSuccessHooks.delete(pluginName);
            this.#pluginErrorHooks.delete(pluginName);
            throw error;
        }
        finally {
            this.#installingPlugins.delete(pluginName);
        }
    }
    getService(pluginName, serviceName) {
        return this.#readService(pluginName, serviceName);
    }
    getServices(pluginName) {
        return this.#readServices(pluginName);
    }
    hasPlugin(name) {
        return this.#installedPlugins.has(name);
    }
    hasService(pluginName, serviceName) {
        return this.#exposedServices.get(pluginName)?.has(normalizeServiceName(serviceName)) ?? false;
    }
    installedPlugins() {
        return Object.freeze([...this.#pluginRecords.values()].map((record) => Object.freeze({
            name: record.name,
            metadata: record.metadata,
        })));
    }
    inspect(query) {
        if (this.#dirty) {
            this.#commit();
        }
        return this.#inspect(query);
    }
    enableByTags(...tags) {
        for (const tag of uniqueStrings(tags)) {
            this.#disabledTags.delete(tag);
            this.#dirty = true;
        }
        if (this.#committed) {
            this.#commit();
        }
        return this;
    }
    disableByTags(...tags) {
        for (const tag of uniqueStrings(tags)) {
            this.#disabledTags.add(tag);
            this.#dirty = true;
        }
        if (this.#committed) {
            this.#commit();
        }
        return this;
    }
    async boot(setup) {
        if (this.#phase === 'ready') {
            return this;
        }
        if (this.#phase === 'booting' && this.#bootPromise !== undefined) {
            return await this.#bootPromise;
        }
        if (this.#phase !== 'idle') {
            frameworkMessage('error', `Cannot boot() while lifecycle phase is ${this.#phase}.`);
        }
        this.#bootPromise = this.#performBoot(setup);
        return await this.#bootPromise;
    }
    dispatch = async (request) => {
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
        let built;
        let matchedRoute;
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
            const found = rou3Find(matcher, method, normalizeRequestPath(url.pathname), {
                params: true,
                normalize: false,
            });
            if (!isRou3MatchResult(found) || typeof found.data !== 'string') {
                const response = await this.#notFoundHandler(request);
                await this.#emitRequestHooksForRequest(request, response);
                return response;
            }
            const route = this.#selectCommittedRoute(found.data, request);
            if (route === undefined || !route.meta.enabled) {
                const response = await this.#notFoundHandler(request);
                await this.#emitRequestHooksForRequest(request, response);
                return response;
            }
            matchedRoute = route.meta;
            built = buildCtx(request, toParams(found.params), url);
            const response = await this.#executeCommittedRoute(route, built);
            await this.#emitRequestHooks(built, response, undefined, matchedRoute);
            return response;
        }
        catch (error) {
            const response = await this.#handleRequestError(error, request);
            if (built === undefined) {
                await this.#emitRequestHooksForRequest(request, response, error, matchedRoute);
            }
            else {
                await this.#emitRequestHooks(built, response, error, matchedRoute);
            }
            return response;
        }
    };
    async shutdown() {
        if (this.#phase === 'stopped') {
            return await this.#stoppedPromise;
        }
        if (this.#shutdownPromise !== undefined) {
            return await this.#shutdownPromise;
        }
        this.#shutdownPromise = this.#performShutdown();
        return await this.#shutdownPromise;
    }
    whenStopped() {
        return this.#stoppedPromise;
    }
    onShutdown(hook) {
        this.#assertNotCommitted('register shutdown hooks');
        this.#shutdownHooks.push(hook);
        return this;
    }
    onSuccess(hook) {
        this.#assertNotCommitted('register success hooks');
        this.#successHooks.push(hook);
        return this;
    }
    onError(hook) {
        this.#assertNotCommitted('register error hooks');
        this.#errorHooks.push(hook);
        return this;
    }
    onNotFound(handler) {
        this.#assertNotCommitted('register not-found handler');
        this.#notFoundHandler = handler;
        return this;
    }
    onException(handler) {
        this.#assertNotCommitted('register exception handler');
        this.#errorHandler = handler;
        return this;
    }
    hasRoute(method, path) {
        return this.#routePathKeys.has(routePathKey(method, path));
    }
    toRegExp(method, path) {
        if (!this.hasRoute(method, path)) {
            return null;
        }
        return rou3ToRegExp(normalizePath(path));
    }
    getPhase() {
        return this.#phase;
    }
    get size() {
        return this.#committed
            ? this.#compiledRoutesMap.size
            : this.#routesMap.size;
    }
    #exposeService(pluginName, serviceName, service) {
        const normalizedServiceName = normalizeServiceName(serviceName);
        const services = this.#exposedServices.get(pluginName);
        if (services === undefined || !this.#installingPlugins.has(pluginName)) {
            frameworkMessage('error', `Plugin "${pluginName}" can expose services only during setup().`);
        }
        if (services.has(normalizedServiceName)) {
            frameworkMessage('error', `Plugin "${pluginName}" already exposes service "${normalizedServiceName}".`);
        }
        services.set(normalizedServiceName, service);
    }
    #addPluginShutdownHook(pluginName, hook) {
        this.#assertInstalling(pluginName, 'register shutdown hooks');
        this.#pushPluginHook(this.#pluginShutdownHooks, pluginName, hook);
    }
    #addPluginSuccessHook(pluginName, hook) {
        this.#assertInstalling(pluginName, 'register success hooks');
        this.#pushPluginHook(this.#pluginSuccessHooks, pluginName, hook);
    }
    #addPluginErrorHook(pluginName, hook) {
        this.#assertInstalling(pluginName, 'register error hooks');
        this.#pushPluginHook(this.#pluginErrorHooks, pluginName, hook);
    }
    async #performBoot(setup) {
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
        }
        catch (error) {
            this.#phase = setPhase(this.#phase, 'stopped');
            this.#resolveStopped();
            throw error;
        }
    }
    #resolveStopped() {
        this.#stoppedResolve?.();
        this.#stoppedResolve = undefined;
    }
    async #performShutdown() {
        if (this.#phase === 'booting' && this.#bootPromise !== undefined) {
            try {
                await this.#bootPromise;
            }
            catch {
                return;
            }
        }
        if (this.#phase === 'idle') {
            this.#phase = setPhase(this.#phase, 'stopped');
        }
        else if (this.#phase === 'ready') {
            this.#phase = setPhase(this.#phase, 'shutting_down');
        }
        try {
            await executeHooksSafe(this.#shutdownHooks, 'shutdown');
            for (const hooks of this.#pluginShutdownHooks.values()) {
                await executeHooksSafe(hooks, 'shutdown');
            }
        }
        finally {
            if (this.#phase !== 'stopped') {
                this.#phase = setPhase(this.#phase, 'stopped');
            }
            this.#resolveStopped();
        }
    }
    async #executeCommittedRoute(route, built) {
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
    #selectCommittedRoute(matchKey, request) {
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
    async #emitRequestHooksForRequest(request, response, error, route) {
        const shouldRunErrorHooks = error !== undefined ||
            response.status >= 400;
        if (!this.#hasRequestHooks(shouldRunErrorHooks, route?.pluginName)) {
            return response;
        }
        const built = buildCtx(request, Object.freeze({}));
        return await this.#emitRequestHooks(built, response, error, route);
    }
    async #emitRequestHooks(built, response, error, route) {
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
            });
            await this.#runSuccessHooks(event, pluginName);
            return response;
        }
        const event = Object.freeze({
            ...base,
            response: responseSnapshot,
            ...(error === undefined ? {} : { error: errorToSnapshot(error) }),
        });
        await this.#runErrorHooks(event, pluginName);
        return response;
    }
    #hasRequestHooks(runErrorHooks, pluginName) {
        if (runErrorHooks) {
            return this.#errorHooks.length > 0 ||
                (pluginName !== undefined &&
                    (this.#pluginErrorHooks.get(pluginName)?.length ?? 0) > 0);
        }
        return this.#successHooks.length > 0 ||
            (pluginName !== undefined &&
                (this.#pluginSuccessHooks.get(pluginName)?.length ?? 0) > 0);
    }
    async #runSuccessHooks(event, pluginName) {
        await this.#runHookList(this.#successHooks, event, 'onSuccess');
        const hooks = pluginName === undefined
            ? undefined
            : this.#pluginSuccessHooks.get(pluginName);
        if (hooks !== undefined) {
            await this.#runHookList(hooks, event, 'onSuccess');
        }
    }
    async #runErrorHooks(event, pluginName) {
        await this.#runHookList(this.#errorHooks, event, 'onError');
        const hooks = pluginName === undefined
            ? undefined
            : this.#pluginErrorHooks.get(pluginName);
        if (hooks !== undefined) {
            await this.#runHookList(hooks, event, 'onError');
        }
    }
    async #runHookList(hooks, event, label) {
        for (const hook of hooks) {
            try {
                await hook(event);
            }
            catch (hookError) {
                frameworkMessage('error', `${label} hook failed.`, hookError, false);
            }
        }
    }
    async #handleRequestError(error, request) {
        try {
            return await this.#errorHandler(error, request);
        }
        catch (handlerError) {
            frameworkMessage('error', 'Custom onException handler failed.', handlerError, false);
            return new Response('Internal Server Error', {
                status: 500,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }
    }
    #addPluginSnapshot(snapshot) {
        for (const route of snapshot.routes) {
            if (this.#routesMap.has(route.key)) {
                frameworkMessage('error', `Duplicate route across plugins: ${formatRouteIdentity(route.method, route.path, route.meta.version)}`);
            }
        }
        for (const route of snapshot.routes) {
            this.#routesMap.set(route.key, route);
            this.#routePathKeys.add(route.matchKey);
        }
        for (const middleware of snapshot.middleware) {
            const id = ++this.#middlewareOrder;
            this.#middlewaresMap.set(id, Object.freeze({
                ...middleware,
                id,
                order: id,
            }));
        }
    }
    #rollbackPluginInstall(pluginName) {
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
    #rebuildRoutePathKeys() {
        this.#routePathKeys = new Set([...this.#routesMap.values()].map((route) => route.matchKey));
    }
    #commit() {
        const routes = [...this.#routesMap.values()];
        const nextMatcher = rou3Create();
        const nextCompiled = new Map();
        const addedMatcherKeys = new Set();
        const mutableBuckets = new Map();
        const middlewareByRoute = new Map();
        const enabledRoutes = [];
        const enabledRouteKeys = new Set();
        for (const route of routes) {
            if (route.enabled && !hasAnyTag(route.meta.tags, this.#disabledTags)) {
                enabledRoutes.push(route);
                enabledRouteKeys.add(route.key);
                middlewareByRoute.set(route.key, []);
            }
        }
        const pluginMiddleware = sortByPriorityAndOrder([...this.#middlewaresMap.values()].filter((middleware) => middleware.enabled &&
            middleware.matchers.length > 0 &&
            !hasAnyTag(middleware.tags, this.#disabledTags)));
        if (pluginMiddleware.length > 0 && enabledRoutes.length > 0) {
            const routeIndex = buildCommitRouteIndex(enabledRoutes);
            for (const middleware of pluginMiddleware) {
                const matchedRoutes = routesForMiddleware(middleware, routeIndex);
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
                ? sortByPriorityAndOrder(route.middleware.filter((middleware) => middleware.enabled &&
                    !hasAnyTag(middleware.tags, this.#disabledTags)))
                : [];
            const meta = Object.freeze({
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
                        versions: new Map(),
                    };
                    mutableBuckets.set(route.matchKey, bucket);
                }
                if (route.meta.version === undefined) {
                    bucket.unversioned = committed;
                }
                else {
                    const routeVersionHeader = route.meta.versionHeader ??
                        DEFAULT_VERSION_HEADER;
                    if (bucket.versionHeader !== undefined &&
                        bucket.versionHeader !== routeVersionHeader) {
                        frameworkMessage('error', `Version header conflict for ${formatRouteIdentity(route.method, route.path)}. Use one version header per method/path bucket.`);
                    }
                    bucket.versionHeader = routeVersionHeader;
                    bucket.versions.set(route.meta.version, committed);
                }
                if (!addedMatcherKeys.has(route.matchKey)) {
                    rou3Add(nextMatcher, route.method, route.path, route.matchKey);
                    addedMatcherKeys.add(route.matchKey);
                }
            }
        }
        this.#matcher = nextMatcher;
        this.#compiledRoutesMap = nextCompiled;
        this.#compiledRouteBuckets = new Map([...mutableBuckets].map(([key, bucket]) => [
            key,
            Object.freeze({
                unversioned: bucket.unversioned,
                versionHeader: bucket.versionHeader,
                versions: bucket.versions,
            }),
        ]));
        this.#dirty = false;
    }
    #inspect(query) {
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
        const routeList = [...this.#routesMap.values()].sort((a, b) => a.order - b.order);
        const allRoutes = routeList.map((route) => this.#toInspectRoute(route));
        const allMiddlewares = wantsMiddlewares
            ? [...this.#middlewaresMap.values()].map((middleware) => this.#toInspectMiddleware(middleware))
            : [];
        const routesByPlugin = wantsPlugins
            ? this.#groupInspectRoutesByPlugin(allRoutes)
            : new Map();
        const middlewareCountByPlugin = wantsPlugins
            ? this.#countMiddlewaresByPlugin()
            : new Map();
        const allPlugins = wantsPlugins
            ? [...this.#pluginRecords.values()].map((plugin) => this.#toInspectPlugin(plugin, routesByPlugin.get(plugin.name) ?? [], middlewareCountByPlugin.get(plugin.name) ?? 0))
            : [];
        const filteredRoutes = wantsRoutes
            ? allRoutes.filter((route) => (includeDisabled || route.enabled) &&
                this.#matchesRouteQuery(route, query))
            : [];
        const filteredMiddlewares = wantsMiddlewares
            ? allMiddlewares.filter((middleware) => this.#matchesMiddlewareQuery(middleware, query))
            : [];
        const filteredPlugins = wantsPlugins
            ? allPlugins.filter((plugin) => this.#matchesPluginQuery(plugin, query))
            : [];
        const filteredServices = wantsServices
            ? this.#inspectServicesForQuery(query)
            : [];
        const enabledRouteCount = allRoutes.filter((route) => route.enabled).length;
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
    #toInspectRoute(route) {
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
            middlewares: Object.freeze(middlewares.map((middleware) => Object.freeze({
                name: middleware.name,
                kind: middleware.kind,
                priority: middleware.priority,
                pluginName: middleware.pluginName,
            }))),
        });
    }
    #toInspectMiddleware(middleware) {
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
    #toInspectPlugin(plugin, routes, middlewareCount) {
        const services = [
            ...(this.#exposedServices.get(plugin.name)?.keys() ?? []),
        ];
        return Object.freeze({
            name: plugin.name,
            metadata: plugin.metadata,
            dependsOn: plugin.dependsOn,
            services: Object.freeze(services),
            routeCount: routes.length,
            unversionedRouteCount: routes.filter((route) => route.version === undefined).length,
            versionedRouteCount: routes.filter((route) => route.version !== undefined).length,
            middlewareCount,
            routes: Object.freeze(routes),
        });
    }
    #groupInspectRoutesByPlugin(routes) {
        const mutable = new Map();
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
        const grouped = new Map();
        for (const [pluginName, pluginRoutes] of mutable) {
            grouped.set(pluginName, Object.freeze(pluginRoutes));
        }
        return grouped;
    }
    #countMiddlewaresByPlugin() {
        const counts = new Map();
        for (const middleware of this.#middlewaresMap.values()) {
            if (middleware.pluginName === undefined) {
                continue;
            }
            counts.set(middleware.pluginName, (counts.get(middleware.pluginName) ?? 0) + 1);
        }
        return counts;
    }
    #countExposedServices() {
        let count = 0;
        for (const services of this.#exposedServices.values()) {
            count += services.size;
        }
        return count;
    }
    #inspectAllServices() {
        const services = [];
        this.#forEachExposedService((pluginName, serviceName) => {
            services.push(this.#toInspectService(pluginName, serviceName));
        });
        return Object.freeze(services);
    }
    #inspectServicesForQuery(query) {
        const requested = uniqueStrings(query?.services);
        if (requested.length === 0) {
            return this.#inspectAllServices();
        }
        const services = [];
        for (const serviceName of requested) {
            let found = false;
            this.#forEachExposedService((pluginName, exposedServiceName) => {
                if (exposedServiceName === serviceName) {
                    found = true;
                    services.push(this.#toInspectService(pluginName, exposedServiceName));
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
    #forEachExposedService(visit) {
        for (const [pluginName, pluginServices] of this.#exposedServices) {
            for (const serviceName of pluginServices.keys()) {
                visit(pluginName, serviceName);
            }
        }
    }
    #toInspectService(pluginName, serviceName) {
        return Object.freeze({
            name: serviceName,
            pluginName,
            exists: true,
        });
    }
    #matchesRouteQuery(route, query) {
        if (query === undefined) {
            return true;
        }
        const tags = uniqueStrings(query.tags);
        if (tags.length > 0 && !hasAnyTag(route.tags, new Set(tags))) {
            return false;
        }
        const plugins = uniqueStrings(query.plugins);
        if (plugins.length > 0 &&
            (route.pluginName === undefined ||
                !plugins.includes(route.pluginName))) {
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
        if (versions.length > 0 &&
            (route.version === undefined || !versions.includes(route.version))) {
            return false;
        }
        return true;
    }
    #matchesMiddlewareQuery(middleware, query) {
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
    #matchesPluginQuery(plugin, query) {
        if (query === undefined) {
            return true;
        }
        const plugins = uniqueStrings(query.plugins);
        if (plugins.length > 0 && !plugins.includes(plugin.name)) {
            return false;
        }
        const tags = uniqueStrings(query.tags);
        if (tags.length > 0 &&
            !hasAnyTag(plugin.metadata?.tags ?? [], new Set(tags)) &&
            !plugin.routes.some((route) => hasAnyTag(route.tags, new Set(tags)))) {
            return false;
        }
        return true;
    }
    #readService(pluginName, serviceName) {
        const service = this.#getRawService(pluginName, serviceName);
        return service;
    }
    #readServices(pluginName) {
        const view = this.#serviceViews.get(pluginName);
        if (view === undefined || !this.#installedPlugins.has(pluginName)) {
            frameworkMessage('error', `Plugin "${pluginName}" is not installed.`);
        }
        return view;
    }
    #createServiceView(pluginName) {
        const services = this.#exposedServices.get(pluginName);
        if (services === undefined) {
            frameworkMessage('error', `Plugin "${pluginName}" has no exposed service registry.`);
        }
        return Object.freeze(Object.fromEntries(services));
    }
    #getRawService(pluginName, serviceName) {
        const normalizedServiceName = normalizeServiceName(serviceName);
        const services = this.#exposedServices.get(pluginName);
        if (services === undefined || !this.#installedPlugins.has(pluginName)) {
            frameworkMessage('error', `Plugin "${pluginName}" is not installed.`);
        }
        if (!services.has(normalizedServiceName)) {
            frameworkMessage('error', `Plugin "${pluginName}" does not expose service "${normalizedServiceName}".`);
        }
        return services.get(normalizedServiceName);
    }
    #assertNotCommitted(action) {
        if (this.#committed) {
            frameworkMessage('error', `Cannot ${action} after boot(). All registrations must happen before boot().`);
        }
    }
    #assertInstalling(pluginName, action) {
        if (!this.#installingPlugins.has(pluginName)) {
            frameworkMessage('error', `Plugin "${pluginName}" can ${action} only during setup().`);
        }
    }
    #pushPluginHook(map, pluginName, hook) {
        let hooks = map.get(pluginName);
        if (hooks === undefined) {
            hooks = [];
            map.set(pluginName, hooks);
        }
        hooks.push(hook);
    }
}
export function createApp(name) {
    return new CodexaHttpApp(name);
}
export function http(name) {
    return createApp(name);
}
