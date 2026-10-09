/* @ts-self-types="./mod.d.ts" */
import { z } from "../../providers/zod.js";
const log = {
    warn: (...args) => console.warn('[codexa/openapi]', ...args),
};
function isZodSchema(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value;
    return ('_zod' in record ||
        '_def' in record ||
        '~standard' in record ||
        (typeof record.parse === 'function' &&
            typeof record.safeParse === 'function'));
}
function toJsonSchema(schema) {
    if (schema === undefined || schema === null) {
        return undefined;
    }
    if (!isZodSchema(schema)) {
        return schema;
    }
    try {
        const converted = z.toJSONSchema(schema);
        const { $schema: _schema, ...rest } = converted;
        return rest;
    }
    catch (error) {
        log.warn('Failed to convert Zod schema to JSON Schema.', error);
        return { type: 'object' };
    }
}
function extractParameters(schema, location) {
    const jsonSchema = toJsonSchema(schema);
    if (jsonSchema?.properties === undefined) {
        return [];
    }
    const required = new Set(jsonSchema.required ?? []);
    return Object.entries(jsonSchema.properties).map(([name, propSchema]) => {
        const schemaObject = propSchema;
        const { description, ...schemaWithoutDescription } = schemaObject;
        const parameter = {
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
function collectPathParamNames(path) {
    const names = new Set();
    for (const match of path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)[?+*]?/g)) {
        names.add(match[1]);
    }
    return [...names];
}
function addMissingPathParameters(parameters, path) {
    const existing = new Set(parameters
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name));
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
function toOpenApiPath(path, routeName) {
    if (/[*]|\([^)]*\)/.test(path)) {
        log.warn(`Route "${routeName ?? path}" contains a wildcard or regex segment. Replacing it with {wildcard}.`);
        path = path.replace(/\([^)]*\)|\*/g, '{wildcard}');
    }
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\??/g, '{$1}');
}
function deriveOperationId(route) {
    const versionPart = route.version === undefined
        ? ''
        : `_v_${route.version.replace(/[^a-zA-Z0-9]+/g, '_')}`;
    return `${route.method.toLowerCase()}_${route.name}${versionPart}`
        .replace(/[/:{}.\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}
function cloneSecurity(security) {
    if (security === undefined) {
        return undefined;
    }
    return security.map((entry) => Object.fromEntries(Object.entries(entry).map(([name, scopes]) => [name, [...scopes]])));
}
function buildOperation(route, openapi) {
    const parameters = addMissingPathParameters([
        ...extractParameters(openapi.params, 'path'),
        ...extractParameters(openapi.query, 'query'),
        ...extractParameters(openapi.headers, 'header'),
    ], route.path);
    if (route.version !== undefined) {
        const headerName = route.versionHeader ?? 'X-Version';
        const hasHeader = parameters.some((parameter) => parameter.in === 'header' &&
            parameter.name.toLowerCase() === headerName.toLowerCase());
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
    };
    const tags = buildOperationTags(route, openapi);
    const security = cloneSecurity(openapi.security);
    const operation = {
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
function buildOperationTags(route, openapi) {
    const tags = new Set();
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
function buildResponses(responses) {
    const result = {};
    for (const [statusCode, config] of Object.entries(responses)) {
        const response = { description: config.description };
        const schema = toJsonSchema(config.schema);
        if (schema !== undefined) {
            response.content = { 'application/json': { schema } };
        }
        if (config.headers !== undefined) {
            const headers = {};
            for (const [headerName, headerSchema] of Object.entries(config.headers)) {
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
function collectRoutes(source, config) {
    const inspected = source.inspect({
        includeDisabled: config.includeDisabled ?? false,
    });
    const inspectedRoutes = inspected.routes
        .filter((route) => config.excludePluginRoutes === true
        ? route.pluginName === undefined
        : true)
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
    return [...inspectedRoutes, ...additional].filter((route) => route.enabled && route.openapi?.exclude !== true);
}
function normalizeInspectRoute(route) {
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
function buildTagList(routes, userTags) {
    const tags = new Map();
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
function normalizePathPrefix(prefix) {
    if (prefix === undefined || prefix.trim() === '' || prefix === '/') {
        return '';
    }
    const value = prefix.trim();
    return value.startsWith('/') ? value.replace(/\/+$/, '') : `/${value}`;
}
function withPrefix(prefix, path) {
    if (prefix === '') {
        return path;
    }
    if (path === '/') {
        return prefix;
    }
    return `${prefix}${path}`;
}
function pathForRoute(route, config) {
    const original = toOpenApiPath(route.path, route.name);
    const prefixed = withPrefix(normalizePathPrefix(config.pathPrefix), original);
    if (route.version === undefined ||
        (config.versionedPathStrategy ?? 'suffix') === 'same-path') {
        return prefixed;
    }
    return `${prefixed};version=${encodeURIComponent(route.version)}`;
}
export function generateOpenApiDocument(source, config) {
    const routes = collectRoutes(source, config);
    const paths = {};
    for (const route of routes) {
        if (route.openapi === undefined) {
            continue;
        }
        const path = pathForRoute(route, config);
        const method = route.method.toLowerCase();
        paths[path] ??= {};
        if (paths[path][method] !== undefined) {
            log.warn(`Duplicate OpenAPI operation ${route.method} ${path} from route "${route.name}". Skipping later registration.`);
            continue;
        }
        paths[path][method] = buildOperation(route, route.openapi);
    }
    const tags = buildTagList(routes, config.tags);
    const document = {
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
export function serveOpenApiJson(scope, source, config, path = '/openapi.json') {
    let cached;
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
