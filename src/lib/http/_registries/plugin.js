/* @ts-self-types="./plugin.d.ts" */
import { compileAppliedOn, eraseExpose, frameworkMessage, normalizeAppliedOn, normalizeVersion, normalizeVersionHeader, uniqueStrings, } from "../_internals/helpers.js";
import { CodexaRouter } from "./router.js";
export function defineMiddleware(config) {
    return config;
}
export function definePluginMiddleware(config) {
    return config;
}
export function definePlugin(plugin) {
    return plugin;
}
export function plugin(definition) {
    return definePlugin(definition);
}
class CodexaPluginScope extends CodexaRouter {
    #middlewareOrder = 0;
    #middlewareMap = new Map();
    #host;
    #pluginName;
    #deps;
    #depsSet;
    #versionHeader;
    constructor(host, pluginName, deps, versionHeader) {
        super(`plugin:${pluginName}`, 'plugin', pluginName);
        this.#host = host;
        this.#pluginName = pluginName;
        this.#deps = Object.freeze([...deps]);
        this.#depsSet = new Set(deps);
        this.#versionHeader = normalizeVersionHeader(versionHeader);
    }
    mount(routerOrPrefix, router) {
        this.assertNotCommitted('mount routers');
        const prefix = typeof routerOrPrefix === 'string' ? routerOrPrefix : '';
        const target = typeof routerOrPrefix === 'string'
            ? router
            : routerOrPrefix;
        if (!(target instanceof CodexaRouter)) {
            frameworkMessage('error', 'Plugin scope mount() expects a router created by createRouter().');
        }
        this.addSnapshot(target.snapshot(), prefix, undefined, this.#pluginName);
        return this;
    }
    use(fnOrMiddleware, options) {
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
        this.#middlewareMap.set(id, Object.freeze({
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
            fn: fn,
            expose,
        }));
        return this;
    }
    version(v) {
        this.assertNotCommitted('register versioned plugin routes');
        const version = normalizeVersion(v);
        const versionHeader = this.#versionHeader;
        const scope = {
            route: (definition) => {
                this.assertNotCommitted('register versioned plugin routes');
                const methods = Array.isArray(definition.method)
                    ? definition.method
                    : [definition.method];
                for (const method of methods) {
                    this.addRouteRegistration(method, definition.path, definition.handler, definition.options, version, versionHeader);
                }
                return scope;
            },
            mount: (routerOrPrefix, router) => {
                this.assertNotCommitted('mount versioned plugin routers');
                const prefix = typeof routerOrPrefix === 'string'
                    ? routerOrPrefix
                    : '';
                const target = typeof routerOrPrefix === 'string'
                    ? router
                    : routerOrPrefix;
                if (!(target instanceof CodexaRouter)) {
                    frameworkMessage('error', 'Plugin scope version().mount() expects a router created by createRouter().');
                }
                this.addSnapshot(target.snapshot(), prefix, version, this.#pluginName, versionHeader);
                return this;
            },
        };
        return Object.freeze(scope);
    }
    onShutdown(hook) {
        this.#host.addShutdownHook(this.#pluginName, hook);
        return this;
    }
    onSuccess(hook) {
        this.#host.addSuccessHook(this.#pluginName, hook);
        return this;
    }
    onError(hook) {
        this.#host.addErrorHook(this.#pluginName, hook);
        return this;
    }
    exposeService(name, service) {
        this.#host.exposeService(this.#pluginName, name, service);
        return this;
    }
    getService(pluginName, serviceName) {
        this.#assertDeclaredDependency(pluginName);
        return this.#host.readService(pluginName, serviceName);
    }
    getServices(pluginName) {
        this.#assertDeclaredDependency(pluginName);
        return this.#host.readServices(pluginName);
    }
    getDependencyNames() {
        return this.#deps;
    }
    hasDependency(name) {
        return this.#depsSet.has(name) && this.#host.hasPlugin(name);
    }
    hasPlugin(name) {
        return this.#host.hasPlugin(name);
    }
    hasService(pluginName, serviceName) {
        return this.#depsSet.has(pluginName) &&
            this.#host.hasService(pluginName, serviceName);
    }
    pluginSnapshot() {
        const snapshot = this.snapshot();
        return Object.freeze({
            name: snapshot.name,
            pluginName: this.#pluginName,
            routes: snapshot.routes,
            middleware: Object.freeze([...this.#middlewareMap.values()]),
        });
    }
    #assertDeclaredDependency(pluginName) {
        if (!this.#depsSet.has(pluginName)) {
            frameworkMessage('error', `Plugin "${this.#pluginName}" cannot access "${pluginName}" because it is not declared in dependsOn.`);
        }
    }
}
export function createPluginScope(host, pluginName, deps, versionHeader) {
    return new CodexaPluginScope(host, pluginName, deps, versionHeader);
}
