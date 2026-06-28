/**
 * @module @codexa/core/openapi
 *
 * OpenAPI 3.1 generation for the plugin-first Codexa HTTP framework.
 *
 * The generator depends only on the public `inspect()` result and route
 * metadata. It does not import or instantiate the framework runtime class.
 */

import { z } from '@zod/zod';
import type {
	HttpMethod,
	InspectQuery,
	InspectResult,
	InspectRoute,
	IRouteScope,
	OpenApiConfig,
	OpenApiResponse as CodexaOpenApiResponse,
} from '../http/mod.ts';

/** OAuth flow object used inside OpenAPI security schemes. */
export interface OAuthFlow {
	authorizationUrl?: string;
	tokenUrl?: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
}

/** OpenAPI security scheme definition. */
export interface SecuritySchemeObject {
	type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
	description?: string;
	name?: string;
	in?: 'query' | 'header' | 'cookie';
	scheme?: string;
	bearerFormat?: string;
	flows?: Record<string, OAuthFlow>;
	openIdConnectUrl?: string;
}

/** OpenAPI tag definition used for grouping operations. */
export interface TagDefinition {
	name: string;
	description?: string;
	externalDocs?: { url: string; description?: string };
}

/** Contact metadata for the OpenAPI info object. */
export interface ContactObject {
	name?: string;
	url?: string;
	email?: string;
}

/** License metadata for the OpenAPI info object. */
export interface LicenseObject {
	name: string;
	url?: string;
}

/** Variable definition for parameterized OpenAPI server URLs. */
export interface ServerVariable {
	default: string;
	enum?: string[];
	description?: string;
}

/** OpenAPI server object. */
export interface ServerObject {
	url: string;
	description?: string;
	variables?: Record<string, ServerVariable>;
}

/** Strategy for rendering versioned routes into OpenAPI paths. */
export type VersionedPathStrategy = 'suffix' | 'same-path';

/** Document-level configuration for {@link generateOpenApiDocument}. */
export interface OpenApiDocConfig {
	openapi?: '3.0.3' | '3.1.0';
	info: {
		title: string;
		version: string;
		description?: string;
		termsOfService?: string;
		contact?: ContactObject;
		license?: LicenseObject;
	};
	servers?: ServerObject[];
	securitySchemes?: Record<string, SecuritySchemeObject>;
	security?: Array<Record<string, string[]>>;
	tags?: TagDefinition[];
	additionalRoutes?: readonly AdditionalOpenApiRoute[];
	pathPrefix?: string;
	excludePluginRoutes?: boolean;
	includeDisabled?: boolean;
	versionedPathStrategy?: VersionedPathStrategy;
}

/** Manually provided route included alongside inspected Codexa routes. */
export interface AdditionalOpenApiRoute {
	method: HttpMethod;
	path: string;
	name?: string;
	enabled?: boolean;
	tags?: readonly string[];
	pluginName?: string;
	version?: string;
	versionHeader?: string;
	openapi: OpenApiConfig;
}

/** OpenAPI document produced by {@link generateOpenApiDocument}. */
export interface OpenApiDocument {
	openapi: string;
	info: OpenApiDocConfig['info'];
	servers?: ServerObject[];
	tags?: TagDefinition[];
	paths: Record<string, Record<string, OpenApiOperation>>;
	components?: {
		securitySchemes?: Record<string, SecuritySchemeObject>;
		schemas?: Record<string, JsonSchemaObject>;
	};
	security?: Array<Record<string, string[]>>;
}

/** OpenAPI operation object with Codexa extension fields. */
export interface OpenApiOperation {
	operationId: string;
	summary?: string;
	description?: string;
	tags?: string[];
	deprecated?: boolean;
	parameters?: OpenApiParameter[];
	requestBody?: OpenApiRequestBody;
	responses: Record<string, OpenApiResponse>;
	security?: Array<Record<string, string[]>>;
	'x-codexa-route-name': string;
	'x-codexa-original-path': string;
	'x-codexa-plugin'?: string;
	'x-codexa-route-tags'?: readonly string[];
	'x-codexa-version'?: string;
	'x-codexa-version-header'?: string;
}

/** OpenAPI parameter object. */
export interface OpenApiParameter {
	name: string;
	in: 'path' | 'query' | 'header' | 'cookie';
	required: boolean;
	description?: string;
	schema?: JsonSchemaObject;
}

/** OpenAPI request body object. */
export interface OpenApiRequestBody {
	required: boolean;
	description?: string;
	content: Record<string, { schema: JsonSchemaObject }>;
}

/** OpenAPI response object. */
export interface OpenApiResponse {
	description: string;
	content?: Record<string, { schema: JsonSchemaObject }>;
	headers?: Record<string, { schema: JsonSchemaObject }>;
}

/** JSON Schema object shape accepted by OpenAPI 3.1. */
export interface JsonSchemaObject {
	type?: string | string[];
	format?: string;
	description?: string;
	example?: unknown;
	default?: unknown;
	nullable?: boolean;
	enum?: unknown[];
	properties?: Record<string, JsonSchemaObject>;
	required?: string[];
	additionalProperties?: boolean | JsonSchemaObject;
	items?: JsonSchemaObject;
	oneOf?: JsonSchemaObject[];
	anyOf?: JsonSchemaObject[];
	allOf?: JsonSchemaObject[];
	not?: JsonSchemaObject;
	$ref?: string;
	[key: string]: unknown;
}

/** Minimal source required by the OpenAPI generator. */
export interface OpenApiSource {
	inspect(query?: InspectQuery): InspectResult;
}

interface NormalizedRoute {
	method: HttpMethod;
	path: string;
	name: string;
	enabled: boolean;
	tags: readonly string[];
	pluginName?: string;
	version?: string;
	versionHeader?: string;
	openapi?: OpenApiConfig;
}

const log = {
	warn: (...args: unknown[]) => console.warn('[codexa/openapi]', ...args),
};

function isZodSchema(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		'_zod' in record ||
		'_def' in record ||
		'~standard' in record ||
		(typeof record.parse === 'function' &&
			typeof record.safeParse === 'function')
	);
}

function toJsonSchema(schema: unknown): JsonSchemaObject | undefined {
	if (schema === undefined || schema === null) {
		return undefined;
	}
	if (!isZodSchema(schema)) {
		return schema as JsonSchemaObject;
	}
	try {
		const converted = z.toJSONSchema(
			schema as z.ZodType,
		) as JsonSchemaObject;
		const { $schema: _schema, ...rest } = converted;
		return rest as JsonSchemaObject;
	} catch (error) {
		log.warn('Failed to convert Zod schema to JSON Schema.', error);
		return { type: 'object' };
	}
}

function extractParameters(
	schema: unknown,
	location: 'path' | 'query' | 'header',
): OpenApiParameter[] {
	const jsonSchema = toJsonSchema(schema);
	if (jsonSchema?.properties === undefined) {
		return [];
	}
	const required = new Set(jsonSchema.required ?? []);
	return Object.entries(jsonSchema.properties).map(([name, propSchema]) => {
		const schemaObject = propSchema as JsonSchemaObject;
		const { description, ...schemaWithoutDescription } = schemaObject;
		const parameter: OpenApiParameter = {
			name,
			in: location,
			required: location === 'path' || required.has(name),
			schema: schemaWithoutDescription,
		};
		if (description !== undefined) {
			parameter.description = description;
		}
		return parameter;
	});
}

function collectPathParamNames(path: string): string[] {
	const names = new Set<string>();
	for (const match of path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)[?+*]?/g)) {
		names.add(match[1]);
	}
	return [...names];
}

function addMissingPathParameters(
	parameters: OpenApiParameter[],
	path: string,
): OpenApiParameter[] {
	const existing = new Set(
		parameters
			.filter((parameter) => parameter.in === 'path')
			.map((parameter) => parameter.name),
	);
	for (const name of collectPathParamNames(path)) {
		if (existing.has(name)) {
			continue;
		}
		parameters.push({
			name,
			in: 'path',
			required: true,
			schema: { type: 'string' },
		});
	}
	return parameters;
}

function toOpenApiPath(path: string, routeName?: string): string {
	if (/[*]|\([^)]*\)/.test(path)) {
		log.warn(
			`Route "${
				routeName ?? path
			}" contains a wildcard or regex segment. Replacing it with {wildcard}.`,
		);
		path = path.replace(/\([^)]*\)|\*/g, '{wildcard}');
	}
	return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\??/g, '{$1}');
}

function deriveOperationId(route: NormalizedRoute): string {
	const versionPart = route.version === undefined
		? ''
		: `_v_${route.version.replace(/[^a-zA-Z0-9]+/g, '_')}`;
	return `${route.method.toLowerCase()}_${route.name}${versionPart}`
		.replace(/[/:{}.\s-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
}

function cloneSecurity(
	security: ReadonlyArray<Record<string, readonly string[]>> | undefined,
): Array<Record<string, string[]>> | undefined {
	if (security === undefined) {
		return undefined;
	}
	return security.map((entry) =>
		Object.fromEntries(
			Object.entries(entry).map(([name, scopes]) => [name, [...scopes]]),
		)
	);
}

function buildOperation(
	route: NormalizedRoute,
	openapi: OpenApiConfig,
): OpenApiOperation {
	const parameters = addMissingPathParameters([
		...extractParameters(openapi.params, 'path'),
		...extractParameters(openapi.query, 'query'),
		...extractParameters(openapi.headers, 'header'),
	], route.path);

	if (route.version !== undefined) {
		const headerName = route.versionHeader ?? 'X-Version';
		const hasHeader = parameters.some((parameter) =>
			parameter.in === 'header' &&
			parameter.name.toLowerCase() === headerName.toLowerCase()
		);
		if (!hasHeader) {
			parameters.push({
				name: headerName,
				in: 'header',
				required: true,
				schema: { type: 'string', enum: [route.version] },
			});
		}
	}

	const bodySchema = toJsonSchema(openapi.body);
	const requestBody = bodySchema === undefined ? undefined : {
		required: true,
		content: {
			[openapi.bodyContentType ?? 'application/json']: {
				schema: bodySchema,
			},
		},
	} satisfies OpenApiRequestBody;

	const tags = buildOperationTags(route, openapi);
	const security = cloneSecurity(openapi.security);
	const operation: OpenApiOperation = {
		operationId: openapi.operationId ?? deriveOperationId(route),
		responses: openapi.responses === undefined
			? { '200': { description: 'Successful response' } }
			: buildResponses(openapi.responses),
		'x-codexa-route-name': route.name,
		'x-codexa-original-path': route.path,
	};

	if (openapi.summary !== undefined) {
		operation.summary = openapi.summary;
	}
	if (openapi.description !== undefined) {
		operation.description = openapi.description;
	}
	if (tags.length > 0) {
		operation.tags = tags;
	}
	if (openapi.deprecated === true) {
		operation.deprecated = true;
	}
	if (parameters.length > 0) {
		operation.parameters = parameters;
	}
	if (requestBody !== undefined) {
		operation.requestBody = requestBody;
	}
	if (security !== undefined) {
		operation.security = security;
	}
	if (route.pluginName !== undefined) {
		operation['x-codexa-plugin'] = route.pluginName;
	}
	if (route.tags.length > 0) {
		operation['x-codexa-route-tags'] = route.tags;
	}
	if (route.version !== undefined) {
		operation['x-codexa-version'] = route.version;
		operation['x-codexa-version-header'] = route.versionHeader ??
			'X-Version';
	}
	return operation;
}

function buildOperationTags(
	route: NormalizedRoute,
	openapi: OpenApiConfig,
): string[] {
	const tags = new Set<string>();
	for (const tag of openapi.tags ?? []) {
		tags.add(tag);
	}
	if (tags.size === 0 && route.pluginName !== undefined) {
		tags.add(route.pluginName);
	}
	if (route.version !== undefined) {
		tags.add(`version:${route.version}`);
	}
	return [...tags];
}

function buildResponses(
	responses: Record<number | string, CodexaOpenApiResponse>,
): Record<string, OpenApiResponse> {
	const result: Record<string, OpenApiResponse> = {};
	for (const [statusCode, config] of Object.entries(responses)) {
		const response: OpenApiResponse = { description: config.description };
		const schema = toJsonSchema(config.schema);
		if (schema !== undefined) {
			response.content = { 'application/json': { schema } };
		}
		if (config.headers !== undefined) {
			const headers: Record<string, { schema: JsonSchemaObject }> = {};
			for (
				const [headerName, headerSchema] of Object.entries(
					config.headers,
				)
			) {
				const converted = toJsonSchema(headerSchema);
				if (converted !== undefined) {
					headers[headerName] = { schema: converted };
				}
			}
			if (Object.keys(headers).length > 0) {
				response.headers = headers;
			}
		}
		result[String(statusCode)] = response;
	}
	return result;
}

function collectRoutes(
	source: OpenApiSource,
	config: OpenApiDocConfig,
): NormalizedRoute[] {
	const inspected = source.inspect({
		includeDisabled: config.includeDisabled ?? false,
	});
	const inspectedRoutes = inspected.routes
		.filter((route) =>
			config.excludePluginRoutes === true
				? route.pluginName === undefined
				: true
		)
		.map(normalizeInspectRoute);
	const additional = (config.additionalRoutes ?? []).map((route) => ({
		method: route.method,
		path: route.path,
		name: route.name ?? `${route.method} ${route.path}`,
		enabled: route.enabled ?? true,
		tags: route.tags ?? [],
		pluginName: route.pluginName,
		version: route.version,
		versionHeader: route.versionHeader,
		openapi: route.openapi,
	}));
	return [...inspectedRoutes, ...additional].filter((route) =>
		route.enabled && route.openapi?.exclude !== true
	);
}

function normalizeInspectRoute(route: InspectRoute): NormalizedRoute {
	return {
		method: route.method,
		path: route.path,
		name: route.name,
		enabled: route.enabled,
		tags: route.tags,
		pluginName: route.pluginName,
		version: route.version,
		versionHeader: route.versionHeader,
		openapi: route.openapi,
	};
}

function buildTagList(
	routes: readonly NormalizedRoute[],
	userTags: readonly TagDefinition[] | undefined,
): TagDefinition[] {
	const tags = new Map<string, TagDefinition>();
	for (const tag of userTags ?? []) {
		tags.set(tag.name, tag);
	}
	for (const route of routes) {
		if (route.openapi === undefined) {
			continue;
		}
		for (const tag of buildOperationTags(route, route.openapi)) {
			if (!tags.has(tag)) {
				tags.set(tag, { name: tag });
			}
		}
	}
	return [...tags.values()];
}

function normalizePathPrefix(prefix: string | undefined): string {
	if (prefix === undefined || prefix.trim() === '' || prefix === '/') {
		return '';
	}
	const value = prefix.trim();
	return value.startsWith('/') ? value.replace(/\/+$/, '') : `/${value}`;
}

function withPrefix(prefix: string, path: string): string {
	if (prefix === '') {
		return path;
	}
	if (path === '/') {
		return prefix;
	}
	return `${prefix}${path}`;
}

function pathForRoute(
	route: NormalizedRoute,
	config: OpenApiDocConfig,
): string {
	const original = toOpenApiPath(route.path, route.name);
	const prefixed = withPrefix(
		normalizePathPrefix(config.pathPrefix),
		original,
	);
	if (
		route.version === undefined ||
		(config.versionedPathStrategy ?? 'suffix') === 'same-path'
	) {
		return prefixed;
	}
	return `${prefixed};version=${encodeURIComponent(route.version)}`;
}

/**
 * Generate an OpenAPI document from a Codexa app or any object exposing
 * `inspect(query)`.
 */
export function generateOpenApiDocument(
	source: OpenApiSource,
	config: OpenApiDocConfig,
): OpenApiDocument {
	const routes = collectRoutes(source, config);
	const paths: Record<string, Record<string, OpenApiOperation>> = {};

	for (const route of routes) {
		if (route.openapi === undefined) {
			continue;
		}
		const path = pathForRoute(route, config);
		const method = route.method.toLowerCase();
		paths[path] ??= {};
		if (paths[path][method] !== undefined) {
			log.warn(
				`Duplicate OpenAPI operation ${route.method} ${path} from route "${route.name}". Skipping later registration.`,
			);
			continue;
		}
		paths[path][method] = buildOperation(route, route.openapi);
	}

	const tags = buildTagList(routes, config.tags);
	const document: OpenApiDocument = {
		openapi: config.openapi ?? '3.1.0',
		info: config.info,
		paths,
	};
	if (config.servers?.length) {
		document.servers = config.servers;
	}
	if (tags.length > 0) {
		document.tags = tags;
	}
	if (config.securitySchemes !== undefined) {
		document.components = {
			securitySchemes: config.securitySchemes,
		};
	}
	if (config.security?.length) {
		document.security = config.security;
	}
	return document;
}

/**
 * Register a route on a Codexa route scope that serves a cached OpenAPI JSON
 * document.
 */
export function serveOpenApiJson(
	scope: IRouteScope,
	source: OpenApiSource,
	config: OpenApiDocConfig,
	path = '/openapi.json',
): void {
	let cached: OpenApiDocument | undefined;
	scope.route({
		method: 'GET',
		path,
		handler: (ctx) => {
			cached ??= generateOpenApiDocument(source, config);
			return ctx.json(cached, {
				headers: {
					'cache-control': 'public, max-age=3600',
				},
			});
		},
		options: {
			name: 'openapi-json',
			tags: ['docs:openapi'],
			openapi: {
				exclude: true,
				summary: 'OpenAPI document',
				responses: {
					200: { description: 'OpenAPI document returned.' },
				},
			},
		},
	});
}

export type {
	HttpMethod,
	InspectQuery,
	InspectResult,
	InspectRoute,
	OpenApiConfig,
};
