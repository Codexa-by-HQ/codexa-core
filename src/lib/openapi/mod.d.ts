/**
 * @module @codexa/core/openapi
 *
 * OpenAPI 3.1 generation for the plugin-first Codexa HTTP framework.
 *
 * The generator depends only on the public `inspect()` result and route
 * metadata. It does not import or instantiate the framework runtime class.
 */
import type { HttpMethod, InspectQuery, InspectResult, InspectRoute, IRouteScope, OpenApiConfig } from "../http/mod.d.ts";
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
    externalDocs?: {
        url: string;
        description?: string;
    };
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
    content: Record<string, {
        schema: JsonSchemaObject;
    }>;
}
/** OpenAPI response object. */
export interface OpenApiResponse {
    description: string;
    content?: Record<string, {
        schema: JsonSchemaObject;
    }>;
    headers?: Record<string, {
        schema: JsonSchemaObject;
    }>;
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
/**
 * Generate an OpenAPI document from a Codexa app or any object exposing
 * `inspect(query)`.
 */
export declare function generateOpenApiDocument(source: OpenApiSource, config: OpenApiDocConfig): OpenApiDocument;
/**
 * Register a route on a Codexa route scope that serves a cached OpenAPI JSON
 * document.
 */
export declare function serveOpenApiJson(scope: IRouteScope, source: OpenApiSource, config: OpenApiDocConfig, path?: string): void;
export type { HttpMethod, InspectQuery, InspectResult, InspectRoute, OpenApiConfig, };
