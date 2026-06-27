import { createLogger } from '../../../utils/logger.ts';
import { DEFAULT_VERSION_HEADER, HTTP_METHODS } from './constants.ts';
import type {
	AppMiddlewareFn,
	Context,
	Hook,
	HookErrorSnapshot,
	HookResponseSnapshot,
	HookRouteSnapshot,
	HttpMethod,
	IPluginMetaData,
	LifeCyclePhase,
	QueryValue,
	RequestHookEvent,
	RequestState,
	RouteMiddleware,
	RouteParams,
	StateShape,
} from '../mod.ts';
import type {
	BuiltContext,
	CommitRouteIndex,
	CompiledAppliedOnMatcher,
	MiddlewareRegistration,
	Rou3MatchResult,
	RouteKey,
	RouteMeta,
	RouteOrigin,
	RoutePathKey,
	RouteRegistration,
} from './types.ts';

const logger = createLogger('Codexa:Http');

type FrameworkMessageHint = 'info' | 'debug' | 'error';
let nextScopeId = 0;

export function frameworkMessage(
	hint: 'error',
	message: string,
	details?: unknown,
): never;
export function frameworkMessage(
	hint: 'error',
	message: string,
	details: unknown,
	shouldThrow: false,
): void;
export function frameworkMessage(
	hint: Exclude<FrameworkMessageHint, 'error'>,
	message: string,
	details?: unknown,
): void;
export function frameworkMessage(
	hint: FrameworkMessageHint,
	message: string,
	details?: unknown,
	shouldThrow = hint === 'error',
): void {
	const args = details === undefined ? [] : [details];
	if (hint === 'debug') {
		logger.debug(message, ...args);
	} else if (hint === 'error') {
		logger.error(message, ...args);
	} else {
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
const RESERVED_RUNTIME_STATE_KEYS: ReadonlySet<string> = new Set([
	'requestId',
	'startTime',
	'__proto__',
	'prototype',
	'constructor',
]);

const PHASE_TRANSITIONS: ReadonlyMap<
	LifeCyclePhase,
	ReadonlySet<LifeCyclePhase>
> = new Map([
	['idle', new Set(['booting', 'stopped'])],
	['booting', new Set(['ready', 'stopped'])],
	['ready', new Set(['listening', 'shutting_down', 'stopped'])],
	['listening', new Set(['shutting_down', 'stopped'])],
	['shutting_down', new Set(['stopped'])],
	['stopped', new Set<LifeCyclePhase>()],
]);

export function createScopeId(): number {
	nextScopeId += 1;
	return nextScopeId;
}

export function normalizeName(name?: string): string | undefined {
	if (name === undefined) {
		return undefined;
	}
	const normalized = name.trim();
	if (normalized === '') {
		frameworkMessage('error', 'Name cannot be empty.');
	}
	return normalized;
}

export function normalizePluginName(name: string): string {
	const normalized = name.trim();
	if (normalized === '') {
		frameworkMessage('error', 'Plugin name cannot be empty.');
	}
	if (normalized !== name) {
		frameworkMessage(
			'error',
			`Plugin name "${name}" cannot contain leading or trailing whitespace.`,
		);
	}
	if (/\s/.test(normalized)) {
		frameworkMessage(
			'error',
			`Plugin name "${name}" cannot contain whitespace. Use hyphens for multi-word names.`,
		);
	}
	return normalized;
}

export function normalizeServiceName(name: string): string {
	const normalized = name.trim();
	if (normalized === '') {
		frameworkMessage('error', 'Service name cannot be empty.');
	}
	if (normalized !== name) {
		frameworkMessage(
			'error',
			`Service name "${name}" cannot contain leading or trailing whitespace.`,
		);
	}
	if (/\s/.test(normalized)) {
		frameworkMessage(
			'error',
			`Service name "${name}" cannot contain whitespace.`,
		);
	}
	return normalized;
}

export function normalizePluginMetadata(
	metadata: IPluginMetaData | undefined,
): IPluginMetaData | undefined {
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

export function defaultRouterName(
	origin: RouteOrigin,
	scopeId: number,
): string {
	return origin === 'plugin'
		? `plugin-router:${scopeId}`
		: `router:${scopeId}`;
}

export function normalizeMethod(method: string): HttpMethod {
	const normalized = method.toUpperCase();
	if (!HTTP_METHODS.includes(normalized as HttpMethod)) {
		frameworkMessage('error', `Unsupported HTTP method: ${method}`);
	}
	return normalized as HttpMethod;
}

export function tryNormalizeMethod(method: string): HttpMethod | undefined {
	const normalized = method.toUpperCase();
	return HTTP_METHODS.includes(normalized as HttpMethod)
		? normalized as HttpMethod
		: undefined;
}

export function normalizePath(path: string): string {
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

export function normalizeRequestPath(pathname: string): string {
	if (pathname === '') {
		return '/';
	}
	if (pathname.length > 1 && pathname.endsWith('/')) {
		return pathname.slice(0, -1);
	}
	return pathname;
}

export function joinPaths(prefix: string, path: string): string {
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

export function routePathKey(method: string, path: string): RoutePathKey {
	return makeRoutePathKey(normalizeMethod(method), normalizePath(path));
}

export function routeKey(
	method: string,
	path: string,
	version?: string,
): RouteKey {
	return makeRouteKey(normalizeMethod(method), normalizePath(path), version);
}

export function makeRoutePathKey(
	method: HttpMethod,
	path: string,
): RoutePathKey {
	return JSON.stringify([method, path]);
}

export function makeRouteKey(
	method: HttpMethod,
	path: string,
	version?: string,
): RouteKey {
	return JSON.stringify([
		method,
		path,
		version ?? null,
	]);
}

export function formatRouteIdentity(
	method: HttpMethod,
	path: string,
	version?: string,
): string {
	return version === undefined
		? `${method} ${path}`
		: `${method} ${path} @ ${version}`;
}

export function normalizeVersion(version: string): string {
	const normalized = version.trim();
	if (normalized === '') {
		frameworkMessage('error', 'version() value cannot be empty.');
	}
	return normalized;
}

export function normalizeVersionHeader(header?: string): string {
	const normalized = (header ?? DEFAULT_VERSION_HEADER).trim();
	if (normalized === '') {
		frameworkMessage('error', 'Version header cannot be empty.');
	}
	const headers = new Headers();
	try {
		headers.set(normalized, '1');
	} catch (error) {
		frameworkMessage(
			'error',
			`Invalid version header: ${normalized}`,
			error,
		);
	}
	return normalized;
}

export function uniqueStrings(values?: readonly string[]): readonly string[] {
	if (values === undefined || values.length === 0) {
		return Object.freeze([] as string[]);
	}
	const out: string[] = [];
	const seen = new Set<string>();
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

export function normalizeAppliedOn(
	values?: readonly string[],
): readonly string[] {
	if (values === undefined || values.length === 0) {
		return Object.freeze([] as string[]);
	}
	const out: string[] = [];
	const seen = new Set<string>();
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

export function compileAppliedOnPattern(raw: string): CompiledAppliedOnMatcher {
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
	const body = pattern.slice(
		startsWithStar ? 1 : 0,
		endsWithStar ? -1 : pattern.length,
	);

	if (body === '') {
		frameworkMessage('error', `Invalid appliedOn pattern: ${pattern}`);
	}
	if (body.includes('*')) {
		frameworkMessage(
			'error',
			`Invalid appliedOn pattern "${pattern}". "*" is only allowed at the start or end.`,
		);
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

export function compileAppliedOn(
	values: readonly string[],
): readonly CompiledAppliedOnMatcher[] {
	return Object.freeze(values.map(compileAppliedOnPattern));
}

export function matcherMatchesTag(
	matcher: CompiledAppliedOnMatcher,
	tag: string,
): boolean {
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

export function isStateObject(value: unknown): value is StateShape {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function assertSafeStateObject(
	value: unknown,
): asserts value is StateShape {
	if (!isStateObject(value)) {
		frameworkMessage('error', 'expose() must return a plain object.');
	}
	for (const key of Object.keys(value)) {
		if (RESERVED_RUNTIME_STATE_KEYS.has(key)) {
			frameworkMessage(
				'error',
				`expose() cannot provide reserved runtime key: ${key}`,
			);
		}
	}
}

export function eraseExpose<TProvide extends StateShape>(
	expose: (data: TProvide) => StateShape,
): (data: unknown) => StateShape {
	return (data: unknown): StateShape => {
		const exposed = expose(data as TProvide);
		assertSafeStateObject(exposed);
		return exposed;
	};
}

export function freezeState<T extends StateShape>(state: T): Readonly<T> {
	return Object.freeze({ ...state });
}

export function createRequestId(): string {
	return crypto.randomUUID();
}

export function withContentType(
	init: ResponseInit | undefined,
	contentType: string,
): ResponseInit {
	const headers = new Headers(init?.headers);
	if (!headers.has('content-type')) {
		headers.set('content-type', contentType);
	}
	return { ...init, headers };
}

export function createJsonResponse(
	data: unknown,
	init?: ResponseInit,
): Response {
	return new Response(
		JSON.stringify(data),
		withContentType(init, 'application/json; charset=utf-8'),
	);
}

export function createTextResponse(
	data: string,
	init?: ResponseInit,
): Response {
	return new Response(
		data,
		withContentType(init, 'text/plain; charset=utf-8'),
	);
}

export function createHtmlResponse(
	data: string,
	init?: ResponseInit,
): Response {
	return new Response(
		data,
		withContentType(init, 'text/html; charset=utf-8'),
	);
}

export function createMarkdownResponse(
	content: string,
	init?: ResponseInit,
): Response {
	return new Response(
		content,
		withContentType(init, 'text/markdown; charset=utf-8'),
	);
}

export function createRedirectResponse(
	url: string,
	status: 301 | 302 | 307 | 308 = 302,
): Response {
	if (
		status !== 301 && status !== 302 && status !== 307 && status !== 308
	) {
		frameworkMessage(
			'error',
			'redirect() status must be 301, 302, 307, or 308.',
		);
	}
	const headers = new Headers();
	headers.set('location', url);
	return new Response(null, { status, headers });
}

export function createStreamResponse(
	body: ReadableStream<Uint8Array>,
	init?: ResponseInit,
): Response {
	return new Response(body, init);
}

export function createSendResponse(
	body: BodyInit | null = null,
	init?: ResponseInit,
): Response {
	return new Response(body, init);
}

export function headersToObject(
	headers: Headers,
): Readonly<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [key, value] of headers) {
		out[key] = value;
	}
	return Object.freeze(out);
}

export function queryToObject(
	query: URLSearchParams,
): Readonly<Record<string, QueryValue>> {
	const mutable: Record<string, string | string[]> = {};
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

	const out: Record<string, QueryValue> = {};
	for (const [key, value] of Object.entries(mutable)) {
		out[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
	}
	return Object.freeze(out);
}

export function responseToSnapshot(response: Response): HookResponseSnapshot {
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

export function errorToSnapshot(error: unknown): HookErrorSnapshot {
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

export function routeToHookSnapshot(route: RouteMeta): HookRouteSnapshot {
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

export function toParams(value: unknown): RouteParams {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return Object.freeze({});
	}
	const params: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		params[key] = String(item);
	}
	return Object.freeze(params);
}

export function isRou3MatchResult(value: unknown): value is Rou3MatchResult {
	return typeof value === 'object' && value !== null && 'data' in value;
}

export function setPhase(
	current: LifeCyclePhase,
	next: LifeCyclePhase,
): LifeCyclePhase {
	const allowed = PHASE_TRANSITIONS.get(current);
	if (allowed === undefined || !allowed.has(next)) {
		frameworkMessage(
			'error',
			`Invalid lifecycle transition: ${current} -> ${next}`,
		);
	}
	return next;
}

export async function executeHooksSafe(
	hooks: readonly Hook[],
	label: string,
): Promise<void> {
	for (const hook of hooks) {
		try {
			await hook();
		} catch (error) {
			frameworkMessage('error', `${label} hook failed.`, error, false);
		}
	}
}

export function sortByPriorityAndOrder<
	T extends { readonly priority: number; readonly order: number },
>(entries: readonly T[]): T[] {
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

export function buildCtx<S extends StateShape>(
	request: Request,
	params: RouteParams,
): BuiltContext<S> {
	const url = new URL(request.url);
	const baseState: StateShape = {
		requestId: createRequestId(),
		startTime: Date.now(),
	};
	const stateRef: { current: Readonly<StateShape> } = {
		current: freezeState(baseState),
	};
	const localsRef: { current: Readonly<StateShape> } = {
		current: Object.freeze({}),
	};

	const ctx: Context<S, RouteParams, StateShape> = {
		request,
		url,
		query: url.searchParams,
		headers: request.headers,
		params,
		get state() {
			return stateRef.current as RequestState<S>;
		},
		get locals() {
			return localsRef.current;
		},
		json(data: unknown, init?: ResponseInit): Response {
			return createJsonResponse(data, init);
		},
		text(data: string, init?: ResponseInit): Response {
			return createTextResponse(data, init);
		},
		html(data: string, init?: ResponseInit): Response {
			return createHtmlResponse(data, init);
		},
		markdown(content: string, init?: ResponseInit): Response {
			return createMarkdownResponse(content, init);
		},
		redirect(url: string, status?: 301 | 302 | 307 | 308): Response {
			return createRedirectResponse(url, status);
		},
		stream(
			body: ReadableStream<Uint8Array>,
			init?: ResponseInit,
		): Response {
			return createStreamResponse(body, init);
		},
		send(body?: BodyInit | null, init?: ResponseInit): Response {
			return createSendResponse(body, init);
		},
	};

	const inject = (
		ref: { current: Readonly<StateShape> },
		data: unknown,
		expose: (data: unknown) => StateShape,
	): void => {
		const exposed = expose(data);
		assertSafeStateObject(exposed);
		ref.current = freezeState({
			...ref.current,
			...exposed,
		});
	};

	const withProvide = (
		ref: { current: Readonly<StateShape> },
		expose?: (data: unknown) => StateShape,
	): Context<S, RouteParams, StateShape> => {
		if (expose === undefined) {
			return ctx;
		}
		const middlewareCtx = Object.create(ctx) as Context<
			S,
			RouteParams,
			StateShape
		>;
		Object.defineProperty(middlewareCtx, 'provide', {
			enumerable: false,
			configurable: false,
			writable: false,
			value(data: unknown): void {
				inject(ref, data, expose);
			},
		});
		return middlewareCtx;
	};

	return Object.freeze({
		ctx,
		withStateProvide: (expose?: (data: unknown) => StateShape) =>
			withProvide(stateRef, expose),
		withLocalProvide: (expose?: (data: unknown) => StateShape) =>
			withProvide(localsRef, expose),
		hookEvent: (route?: RouteMeta) =>
			Object.freeze({
				params,
				query: queryToObject(url.searchParams),
				path: url.pathname,
				method: request.method,
				state: stateRef.current as RequestState<S>,
				locals: localsRef.current,
				...(route === undefined
					? {}
					: { route: routeToHookSnapshot(route) }),
			}),
	});
}

export function buildCommitRouteIndex<S extends StateShape>(
	routes: readonly RouteRegistration<S>[],
): CommitRouteIndex<S> {
	const mutableRoutesByPlugin = new Map<string, RouteRegistration<S>[]>();
	const mutableRoutesByPluginTag = new Map<
		string,
		Map<string, RouteRegistration<S>[]>
	>();

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
			pluginTags = new Map<string, RouteRegistration<S>[]>();
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

	const routesByPlugin = new Map<string, readonly RouteRegistration<S>[]>();
	const tagsByPlugin = new Map<string, readonly string[]>();
	const routesByPluginTag = new Map<
		string,
		ReadonlyMap<string, readonly RouteRegistration<S>[]>
	>();

	for (const [pluginName, pluginRoutes] of mutableRoutesByPlugin) {
		routesByPlugin.set(pluginName, Object.freeze(pluginRoutes));
	}
	for (const [pluginName, tagMap] of mutableRoutesByPluginTag) {
		const frozenTagMap = new Map<
			string,
			readonly RouteRegistration<S>[]
		>();
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

export function routesForMatcher<S extends StateShape>(
	matcher: CompiledAppliedOnMatcher,
	pluginName: string,
	index: CommitRouteIndex<S>,
): Set<RouteRegistration<S>> {
	if (matcher.match === 'all') {
		return new Set(index.routesByPlugin.get(pluginName) ?? []);
	}
	const result = new Set<RouteRegistration<S>>();
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

export function routesForMiddleware<S extends StateShape>(
	middleware: MiddlewareRegistration<S>,
	index: CommitRouteIndex<S>,
): Set<RouteRegistration<S>> {
	const result = new Set<RouteRegistration<S>>();
	if (
		middleware.matchers.length === 0 ||
		middleware.pluginName === undefined
	) {
		return result;
	}
	for (const matcher of middleware.matchers) {
		for (
			const route of routesForMatcher(
				matcher,
				middleware.pluginName,
				index,
			)
		) {
			result.add(route);
		}
	}
	return result;
}

export function hasAnyTag(
	values: readonly string[],
	tags: ReadonlySet<string>,
): boolean {
	for (const value of values) {
		if (tags.has(value)) {
			return true;
		}
	}
	return false;
}

export function toInlineMiddlewareRegistration<S extends StateShape>(
	item: RouteMiddleware,
	index: number,
	route: RouteMeta,
	routeOrder: number,
): MiddlewareRegistration<S> {
	const expose = item.expose === undefined
		? undefined
		: eraseExpose(item.expose as (data: StateShape) => StateShape);
	const order = index + 1;
	return Object.freeze({
		id: -((routeOrder * 1000) + order),
		kind: 'inline',
		name: `${route.name}:middleware:${order}`,
		priority: item.priority ?? 0,
		order,
		tags: Object.freeze([] as string[]),
		appliedOn: Object.freeze([] as string[]),
		matchers: Object.freeze([] as CompiledAppliedOnMatcher[]),
		enabled: true,
		scopeId: route.scopeId,
		routerId: route.routerId,
		routerName: route.routerName,
		pluginName: route.pluginName,
		fn: item.fn as AppMiddlewareFn<S, never, StateShape>,
		expose,
	});
}
