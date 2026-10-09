/* @ts-self-types="./router.d.ts" */
import { createScopeId, defaultRouterName, formatRouteIdentity, frameworkMessage, joinPaths, makeRouteKey, makeRoutePathKey, normalizeMethod, normalizeName, normalizePath, normalizeVersion, normalizeVersionHeader, toInlineMiddlewareRegistration, uniqueStrings, } from "../_internals/helpers.js";
export class CodexaRouter {
    #committed = false;
    #routeOrder = 0;
    #routesMap = new Map();
    #routePathKeys = new Set();
    #origin;
    #name;
    #scopeId;
    #pluginName;
    constructor(name, origin = 'router', pluginName) {
        this.#origin = origin;
        this.#scopeId = createScopeId();
        this.#pluginName = pluginName;
        this.#name = normalizeName(name) ??
            defaultRouterName(origin, this.#scopeId);
    }
    getName() {
        return this.#name;
    }
    route(definition) {
        this.assertNotCommitted('register routes');
        const methods = Array.isArray(definition.method)
            ? definition.method
            : [definition.method];
        for (const method of methods) {
            this.addRouteRegistration(method, definition.path, definition.handler, definition.options);
        }
        return this;
    }
    snapshot() {
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
    assertNotCommitted(action) {
        if (this.#committed) {
            frameworkMessage('error', `Cannot ${action} after boot(). All registrations must happen before boot().`);
        }
    }
    markCommitted() {
        this.#committed = true;
    }
    get name() {
        return this.#name;
    }
    get scopeId() {
        return this.#scopeId;
    }
    addSnapshot(snapshot, prefix = '', version, pluginName, versionHeader) {
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
                : normalizeVersionHeader(versionHeader ?? route.meta.versionHeader);
            const key = makeRouteKey(route.method, path, resolvedVersion);
            const matchKey = makeRoutePathKey(route.method, path);
            if (this.#routesMap.has(key)) {
                frameworkMessage('error', `Duplicate mounted route: ${formatRouteIdentity(route.method, path, resolvedVersion)}`);
            }
            const order = ++this.#routeOrder;
            const meta = Object.freeze({
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
            this.#routesMap.set(key, Object.freeze({
                key,
                matchKey,
                method: route.method,
                path,
                order,
                enabled: route.enabled,
                handler: route.handler,
                middleware: route.middleware.map((middleware) => Object.freeze({
                    ...middleware,
                    scopeId: mountScopeId,
                    routerId,
                    routerName,
                    pluginName: ownerPluginName,
                })),
                meta,
            }));
        }
    }
    addRouteRegistration(methodInput, pathInput, handler, routeOptions, version, versionHeader) {
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
            frameworkMessage('error', `Duplicate route: ${formatRouteIdentity(method, path, resolvedVersion)}`);
        }
        const tags = uniqueStrings(routeOptions?.tags);
        const enabled = routeOptions?.enabled ?? true;
        const name = routeOptions?.name ?? `${method} ${path}`;
        const order = ++this.#routeOrder;
        const meta = Object.freeze({
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
        const routeMiddleware = (routeOptions?.middleware ?? []);
        const middleware = Object.freeze(routeMiddleware.map((item, index) => toInlineMiddlewareRegistration(item, index, meta, order)));
        this.#routesMap.set(key, Object.freeze({
            key,
            matchKey,
            method,
            path,
            order,
            enabled,
            handler: handler,
            middleware,
            meta,
        }));
        this.#routePathKeys.add(matchKey);
    }
}
export function createRouter(name) {
    return new CodexaRouter(name);
}
export function router(name) {
    return createRouter(name);
}
