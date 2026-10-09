/* @ts-self-types="./helpers.d.ts" */
import { createLogger } from "../../../utils/logger.js";
import { DEFAULT_VERSION_HEADER, HTTP_METHOD_SET, HTTP_METHODS, } from "./constants.js";
const logger = createLogger('Codexa:Http');
let nextScopeId = 0;
export function frameworkMessage(hint, message, details, shouldThrow = hint === 'error') {
    const args = details === undefined ? [] : [details];
    if (hint === 'debug') {
        logger.debug(message, ...args);
    }
    else if (hint === 'error') {
        logger.error(message, ...args);
    }
    else {
        logger.info(message, ...args);
    }
    if (shouldThrow) {
        const errorMessage = `[Codexa] ${message}`;
        if (details === undefined) {
            throw new Error(errorMessage);
        }
        throw new Error(errorMessage, { cause: details });
    }
}
const RESERVED_RUNTIME_STATE_KEYS = new Set([
    'requestId',
    'startTime',
    '__proto__',
    'prototype',
    'constructor',
]);
const PHASE_TRANSITIONS = new Map([
    ['idle', new Set(['booting', 'stopped'])],
    ['booting', new Set(['ready', 'stopped'])],
    ['ready', new Set(['shutting_down', 'stopped'])],
    ['shutting_down', new Set(['stopped'])],
    ['stopped', new Set()],
]);
export function createScopeId() {
    nextScopeId += 1;
    return nextScopeId;
}
export function normalizeName(name) {
    if (name === undefined) {
        return undefined;
    }
    const normalized = name.trim();
    if (normalized === '') {
        frameworkMessage('error', 'Name cannot be empty.');
    }
    return normalized;
}
export function normalizePluginName(name) {
    const normalized = name.trim();
    if (normalized === '') {
        frameworkMessage('error', 'Plugin name cannot be empty.');
    }
    if (normalized !== name) {
        frameworkMessage('error', `Plugin name "${name}" cannot contain leading or trailing whitespace.`);
    }
    if (/\s/.test(normalized)) {
        frameworkMessage('error', `Plugin name "${name}" cannot contain whitespace. Use hyphens for multi-word names.`);
    }
    return normalized;
}
export function normalizeServiceName(name) {
    const normalized = name.trim();
    if (normalized === '') {
        frameworkMessage('error', 'Service name cannot be empty.');
    }
    if (normalized !== name) {
        frameworkMessage('error', `Service name "${name}" cannot contain leading or trailing whitespace.`);
    }
    if (/\s/.test(normalized)) {
        frameworkMessage('error', `Service name "${name}" cannot contain whitespace.`);
    }
    return normalized;
}
export function normalizePluginMetadata(metadata) {
    if (metadata === undefined) {
        return undefined;
    }
    return Object.freeze({
        ...metadata,
        ...(metadata.tags === undefined
            ? {}
            : { tags: uniqueStrings(metadata.tags) }),
    });
}
export function defaultRouterName(origin, scopeId) {
    return origin === 'plugin'
        ? `plugin-router:${scopeId}`
        : `router:${scopeId}`;
}
export function normalizeMethod(method) {
    const normalized = method.toUpperCase();
    if (!HTTP_METHODS.includes(normalized)) {
        frameworkMessage('error', `Unsupported HTTP method: ${method}`);
    }
    return normalized;
}
export function tryNormalizeMethod(method) {
    const normalized = method.toUpperCase();
    return HTTP_METHOD_SET.has(normalized)
        ? normalized
        : undefined;
}
export function normalizePath(path) {
    if (path === '') {
        return '/';
    }
    if (!path.startsWith('/')) {
        frameworkMessage('error', `Route path must start with "/": ${path}`);
    }
    if (path.length > 1 && path.endsWith('/')) {
        return path.slice(0, -1);
    }
    return path;
}
export function normalizeRequestPath(pathname) {
    if (pathname === '') {
        return '/';
    }
    if (pathname.length > 1 && pathname.endsWith('/')) {
        return pathname.slice(0, -1);
    }
    return pathname;
}
export function joinPaths(prefix, path) {
    const normalizedPrefix = prefix === '' ? '' : normalizePath(prefix);
    const normalizedPath = normalizePath(path);
    if (normalizedPrefix === '' || normalizedPrefix === '/') {
        return normalizedPath;
    }
    if (normalizedPath === '/') {
        return normalizedPrefix;
    }
    return `${normalizedPrefix}${normalizedPath}`;
}
export function routePathKey(method, path) {
    return makeRoutePathKey(normalizeMethod(method), normalizePath(path));
}
export function routeKey(method, path, version) {
    return makeRouteKey(normalizeMethod(method), normalizePath(path), version);
}
export function makeRoutePathKey(method, path) {
    return JSON.stringify([method, path]);
}
export function makeRouteKey(method, path, version) {
    return JSON.stringify([
        method,
        path,
        version ?? null,
    ]);
}
export function formatRouteIdentity(method, path, version) {
    return version === undefined
        ? `${method} ${path}`
        : `${method} ${path} @ ${version}`;
}
export function normalizeVersion(version) {
    const normalized = version.trim();
    if (normalized === '') {
        frameworkMessage('error', 'version() value cannot be empty.');
    }
    return normalized;
}
export function normalizeVersionHeader(header) {
    const normalized = (header ?? DEFAULT_VERSION_HEADER).trim();
    if (normalized === '') {
        frameworkMessage('error', 'Version header cannot be empty.');
    }
    const headers = new Headers();
    try {
        headers.set(normalized, '1');
    }
    catch (error) {
        frameworkMessage('error', `Invalid version header: ${normalized}`, error);
    }
    return normalized;
}
export function uniqueStrings(values) {
    if (values === undefined || values.length === 0) {
        return Object.freeze([]);
    }
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const item = value.trim();
        if (item === '' || seen.has(item)) {
            continue;
        }
        seen.add(item);
        out.push(item);
    }
    return Object.freeze(out);
}
export function normalizeAppliedOn(values) {
    if (values === undefined || values.length === 0) {
        return Object.freeze([]);
    }
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const item = value.trim();
        if (item === '') {
            frameworkMessage('error', 'appliedOn pattern cannot be empty.');
        }
        if (seen.has(item)) {
            continue;
        }
        seen.add(item);
        out.push(item);
    }
    return Object.freeze(out);
}
export function compileAppliedOnPattern(raw) {
    const pattern = raw.trim();
    if (pattern === '') {
        frameworkMessage('error', 'appliedOn pattern cannot be empty.');
    }
    if (pattern === '*') {
        return Object.freeze({
            raw: pattern,
            match: 'all',
        });
    }
    const startsWithStar = pattern.startsWith('*');
    const endsWithStar = pattern.endsWith('*');
    const body = pattern.slice(startsWithStar ? 1 : 0, endsWithStar ? -1 : pattern.length);
    if (body === '') {
        frameworkMessage('error', `Invalid appliedOn pattern: ${pattern}`);
    }
    if (body.includes('*')) {
        frameworkMessage('error', `Invalid appliedOn pattern "${pattern}". "*" is only allowed at the start or end.`);
    }
    if (startsWithStar && endsWithStar) {
        return Object.freeze({
            raw: pattern,
            match: 'contains',
            value: body,
        });
    }
    if (startsWithStar) {
        return Object.freeze({
            raw: pattern,
            match: 'endsWith',
            value: body,
        });
    }
    if (endsWithStar) {
        return Object.freeze({
            raw: pattern,
            match: 'startsWith',
            value: body,
        });
    }
    return Object.freeze({
        raw: pattern,
        match: 'exact',
        value: body,
    });
}
export function compileAppliedOn(values) {
    return Object.freeze(values.map(compileAppliedOnPattern));
}
export function matcherMatchesTag(matcher, tag) {
    const value = matcher.value;
    if (matcher.match === 'all') {
        return true;
    }
    if (value === undefined) {
        return false;
    }
    if (matcher.match === 'exact') {
        return tag === value;
    }
    if (matcher.match === 'startsWith') {
        return tag.startsWith(value);
    }
    if (matcher.match === 'endsWith') {
        return tag.endsWith(value);
    }
    return tag.includes(value);
}
export function isStateObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
export function assertSafeStateObject(value) {
    if (!isStateObject(value)) {
        frameworkMessage('error', 'expose() must return a plain object.');
    }
    for (const key of Object.keys(value)) {
        if (RESERVED_RUNTIME_STATE_KEYS.has(key)) {
            frameworkMessage('error', `expose() cannot provide reserved runtime key: ${key}`);
        }
    }
}
export function eraseExpose(expose) {
    return (data) => {
        const exposed = expose(data);
        assertSafeStateObject(exposed);
        return exposed;
    };
}
export function freezeState(state) {
    return Object.freeze({ ...state });
}
export function createRequestId() {
    return crypto.randomUUID();
}
export function withContentType(init, contentType) {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) {
        headers.set('content-type', contentType);
    }
    return { ...init, headers };
}
export function createJsonResponse(data, init) {
    return new Response(JSON.stringify(data), withContentType(init, 'application/json; charset=utf-8'));
}
export function createTextResponse(data, init) {
    return new Response(data, withContentType(init, 'text/plain; charset=utf-8'));
}
export function createHtmlResponse(data, init) {
    return new Response(data, withContentType(init, 'text/html; charset=utf-8'));
}
export function createMarkdownResponse(content, init) {
    return new Response(content, withContentType(init, 'text/markdown; charset=utf-8'));
}
export function createRedirectResponse(url, status = 302) {
    if (status !== 301 && status !== 302 && status !== 307 && status !== 308) {
        frameworkMessage('error', 'redirect() status must be 301, 302, 307, or 308.');
    }
    const headers = new Headers();
    headers.set('location', url);
    return new Response(null, { status, headers });
}
export function createStreamResponse(body, init) {
    return new Response(body, init);
}
export function createSendResponse(body = null, init) {
    return new Response(body, init);
}
export function headersToObject(headers) {
    const out = {};
    for (const [key, value] of headers) {
        out[key] = value;
    }
    return Object.freeze(out);
}
export function queryToObject(query) {
    const mutable = {};
    for (const [key, value] of query) {
        const current = mutable[key];
        if (current === undefined) {
            mutable[key] = value;
            continue;
        }
        if (Array.isArray(current)) {
            current.push(value);
            continue;
        }
        mutable[key] = [current, value];
    }
    const out = {};
    for (const [key, value] of Object.entries(mutable)) {
        out[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
    }
    return Object.freeze(out);
}
export function responseToSnapshot(response) {
    return Object.freeze({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        url: response.url,
        headers: headersToObject(response.headers),
        hasBody: response.body !== null,
        bodyUsed: response.bodyUsed,
        body: null,
    });
}
export function errorToSnapshot(error) {
    if (error instanceof Error) {
        return Object.freeze({
            name: error.name,
            message: error.message,
        });
    }
    return Object.freeze({
        name: typeof error,
        message: String(error),
    });
}
export function routeToHookSnapshot(route) {
    return Object.freeze({
        name: route.name,
        method: route.method,
        path: route.path,
        ...(route.pluginName === undefined
            ? {}
            : { pluginName: route.pluginName }),
        ...(route.version === undefined ? {} : { version: route.version }),
        ...(route.versionHeader === undefined
            ? {}
            : { versionHeader: route.versionHeader }),
    });
}
const EMPTY_PARAMS = Object.freeze({});
export function toParams(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return EMPTY_PARAMS;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
        return EMPTY_PARAMS;
    }
    const params = {};
    for (const [key, item] of entries) {
        params[key] = String(item);
    }
    return Object.freeze(params);
}
export function isRou3MatchResult(value) {
    return typeof value === 'object' && value !== null && 'data' in value;
}
export function setPhase(current, next) {
    const allowed = PHASE_TRANSITIONS.get(current);
    if (allowed === undefined || !allowed.has(next)) {
        frameworkMessage('error', `Invalid lifecycle transition: ${current} -> ${next}`);
    }
    return next;
}
export async function executeHooksSafe(hooks, label) {
    for (const hook of hooks) {
        try {
            await hook();
        }
        catch (error) {
            frameworkMessage('error', `${label} hook failed.`, error, false);
        }
    }
}
export function sortByPriorityAndOrder(entries) {
    if (entries.length === 0) {
        return [];
    }
    if (entries.length === 1) {
        return [entries[0]];
    }
    return [...entries].sort((a, b) => {
        const priority = a.priority - b.priority;
        return priority !== 0 ? priority : a.order - b.order;
    });
}
function createBaseState() {
    return Object.freeze({
        requestId: createRequestId(),
        startTime: Date.now(),
    });
}
const EMPTY_LOCALS = Object.freeze({});
function ctxJson(data, init) {
    return createJsonResponse(data, init);
}
function ctxText(data, init) {
    return createTextResponse(data, init);
}
function ctxHtml(data, init) {
    return createHtmlResponse(data, init);
}
function ctxMarkdown(content, init) {
    return createMarkdownResponse(content, init);
}
function ctxRedirect(url, status) {
    return createRedirectResponse(url, status);
}
function ctxStream(body, init) {
    return createStreamResponse(body, init);
}
function ctxSend(body, init) {
    return createSendResponse(body, init);
}
export function buildCtx(request, params, requestUrl) {
    const url = requestUrl ?? new URL(request.url);
    const stateRef = {
        current: createBaseState(),
    };
    const localsRef = {
        current: EMPTY_LOCALS,
    };
    const ctx = {
        request,
        url,
        query: url.searchParams,
        headers: request.headers,
        params,
        get state() {
            return stateRef.current;
        },
        get locals() {
            return localsRef.current;
        },
        json: ctxJson,
        text: ctxText,
        html: ctxHtml,
        markdown: ctxMarkdown,
        redirect: ctxRedirect,
        stream: ctxStream,
        send: ctxSend,
    };
    const inject = (ref, data, expose) => {
        const exposed = expose(data);
        assertSafeStateObject(exposed);
        ref.current = freezeState({
            ...ref.current,
            ...exposed,
        });
    };
    const withProvide = (ref, expose) => {
        if (expose === undefined) {
            return ctx;
        }
        const middlewareCtx = Object.create(ctx);
        Object.defineProperty(middlewareCtx, 'provide', {
            enumerable: false,
            configurable: false,
            writable: false,
            value(data) {
                inject(ref, data, expose);
            },
        });
        return middlewareCtx;
    };
    return Object.freeze({
        ctx,
        withStateProvide: (expose) => withProvide(stateRef, expose),
        withLocalProvide: (expose) => withProvide(localsRef, expose),
        hookEvent: (route) => Object.freeze({
            params,
            query: queryToObject(url.searchParams),
            path: url.pathname,
            method: request.method,
            state: stateRef.current,
            locals: localsRef.current,
            ...(route === undefined
                ? {}
                : { route: routeToHookSnapshot(route) }),
        }),
    });
}
export function buildCommitRouteIndex(routes) {
    const mutableRoutesByPlugin = new Map();
    const mutableRoutesByPluginTag = new Map();
    for (const route of routes) {
        const pluginName = route.meta.pluginName;
        if (pluginName === undefined) {
            continue;
        }
        let pluginRoutes = mutableRoutesByPlugin.get(pluginName);
        if (pluginRoutes === undefined) {
            pluginRoutes = [];
            mutableRoutesByPlugin.set(pluginName, pluginRoutes);
        }
        pluginRoutes.push(route);
        let pluginTags = mutableRoutesByPluginTag.get(pluginName);
        if (pluginTags === undefined) {
            pluginTags = new Map();
            mutableRoutesByPluginTag.set(pluginName, pluginTags);
        }
        for (const tag of route.meta.tags) {
            let bucket = pluginTags.get(tag);
            if (bucket === undefined) {
                bucket = [];
                pluginTags.set(tag, bucket);
            }
            bucket.push(route);
        }
    }
    const routesByPlugin = new Map();
    const tagsByPlugin = new Map();
    const routesByPluginTag = new Map();
    for (const [pluginName, pluginRoutes] of mutableRoutesByPlugin) {
        routesByPlugin.set(pluginName, Object.freeze(pluginRoutes));
    }
    for (const [pluginName, tagMap] of mutableRoutesByPluginTag) {
        const frozenTagMap = new Map();
        for (const [tag, taggedRoutes] of tagMap) {
            frozenTagMap.set(tag, Object.freeze(taggedRoutes));
        }
        tagsByPlugin.set(pluginName, Object.freeze([...tagMap.keys()]));
        routesByPluginTag.set(pluginName, frozenTagMap);
    }
    return Object.freeze({
        routesByPlugin,
        tagsByPlugin,
        routesByPluginTag,
    });
}
export function routesForMatcher(matcher, pluginName, index) {
    if (matcher.match === 'all') {
        return new Set(index.routesByPlugin.get(pluginName) ?? []);
    }
    const result = new Set();
    const value = matcher.value;
    if (value === undefined) {
        return result;
    }
    if (matcher.match === 'exact') {
        const exact = index.routesByPluginTag.get(pluginName)?.get(value);
        if (exact !== undefined) {
            for (const route of exact) {
                result.add(route);
            }
        }
        return result;
    }
    const tags = index.tagsByPlugin.get(pluginName) ?? [];
    const routeTags = index.routesByPluginTag.get(pluginName);
    if (routeTags === undefined) {
        return result;
    }
    for (const tag of tags) {
        if (!matcherMatchesTag(matcher, tag)) {
            continue;
        }
        const taggedRoutes = routeTags.get(tag);
        if (taggedRoutes === undefined) {
            continue;
        }
        for (const route of taggedRoutes) {
            result.add(route);
        }
    }
    return result;
}
export function routesForMiddleware(middleware, index) {
    const result = new Set();
    if (middleware.matchers.length === 0 ||
        middleware.pluginName === undefined) {
        return result;
    }
    for (const matcher of middleware.matchers) {
        for (const route of routesForMatcher(matcher, middleware.pluginName, index)) {
            result.add(route);
        }
    }
    return result;
}
export function hasAnyTag(values, tags) {
    for (const value of values) {
        if (tags.has(value)) {
            return true;
        }
    }
    return false;
}
export function toInlineMiddlewareRegistration(item, index, route, routeOrder) {
    const expose = item.expose === undefined
        ? undefined
        : eraseExpose(item.expose);
    const order = index + 1;
    return Object.freeze({
        id: -((routeOrder * 1000) + order),
        kind: 'inline',
        name: `${route.name}:middleware:${order}`,
        priority: item.priority ?? 0,
        order,
        tags: Object.freeze([]),
        appliedOn: Object.freeze([]),
        matchers: Object.freeze([]),
        enabled: true,
        scopeId: route.scopeId,
        routerId: route.routerId,
        routerName: route.routerName,
        pluginName: route.pluginName,
        fn: item.fn,
        expose,
    });
}
