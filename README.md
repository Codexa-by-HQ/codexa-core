# @codexa/core

Codexa Core is a modular Deno toolkit for building backend systems with small, focused imports.

The HTTP module is plugin-first: build each capability as an installable plugin, expose only the services you want other plugins to consume, and let Rou3 handle fast route dispatch.

## Install

```ts
import { createApp, definePlugin } from 'jsr:@codexa/core/http';
```

For projects using JSR import maps:

```json
{
	"imports": {
		"@codexa/core/http": "jsr:@codexa/core/http",
		"@codexa/core/openapi": "jsr:@codexa/core/openapi",
		"@codexa/core/config": "jsr:@codexa/core/config",
		"@codexa/core/bus": "jsr:@codexa/core/bus",
		"@codexa/core/store": "jsr:@codexa/core/store",
		"@codexa/core/cache": "jsr:@codexa/core/cache",
		"@codexa/core/storage": "jsr:@codexa/core/storage",
		"@codexa/core/providers": "jsr:@codexa/core/providers",
		"@codexa/core/providers/": "jsr:@codexa/core/providers/",
		"@codexa/core/providers/zod": "jsr:@codexa/core/providers/zod"
	}
}
```

## Imports

Use subpath imports. The root module is intentionally lightweight and does not import every subsystem.

```ts
import { createApp } from '@codexa/core/http';
import { generateOpenApiDocument } from '@codexa/core/openapi';
import { env } from '@codexa/core/config';
import { createEventBus } from '@codexa/core/bus';
import { createStore, createStoreRegistry } from '@codexa/core/store';
import { createCache } from '@codexa/core/cache';
import { createStorageManager, createStorageRegistry } from '@codexa/core/storage';
import { createLogger } from '@codexa/core/logger';
import { zod } from '@codexa/core/providers/zod';
```

Available public subpaths:

| Import                   | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `@codexa/core/http`      | Plugin-first HTTP framework built on Deno and Rou3      |
| `@codexa/core/openapi`   | OpenAPI 3.1 generator from HTTP `inspect()` metadata    |
| `@codexa/core/config`    | Environment, MongoDB, Redis, and storage config helpers |
| `@codexa/core/bus`       | Local or Redis-backed event bus                         |
| `@codexa/core/store`     | Memory, Redis, or Deno KV key-value store               |
| `@codexa/core/cache`     | Namespaced cache on top of store                        |
| `@codexa/core/storage`   | Local, S3, Cloudinary, and ImageKit storage manager     |
| `@codexa/core/providers` | Third-party provider namespace exports                  |
| `@codexa/core/logger`    | Structured logger                                       |
| `@codexa/core/zod`       | Compatibility alias for the Zod provider                |
| `@codexa/core/crypto`    | IDs and password hashing                                |
| `@codexa/core/hash`      | SHA and HMAC helpers                                    |
| `@codexa/core/device`    | User-agent parsing                                      |
| `@codexa/core/ttl`       | TTL parsing helpers                                     |
| `@codexa/core/response`  | Response payload builders                               |
| `@codexa/core/query`     | Query-string parser                                     |

## Provider Re-exports

Codexa Core exposes the third-party packages it depends on through provider subpaths, so package consumers can import these providers from `@codexa/core` instead of installing or mapping each dependency again.

```ts
import { zod } from '@codexa/core/providers/zod';
import { MongoClient } from '@codexa/core/providers/mongodb';
import Redis from '@codexa/core/providers/ioredis';
import qs from '@codexa/core/providers/qs';
import { createRouter } from '@codexa/core/providers/rou3';
import { UAParser } from '@codexa/core/providers/ua-parser-js';
import { join } from '@codexa/core/providers/path';
import { load } from '@codexa/core/providers/dotenv';
import { blake2b, bytesToHex } from '@codexa/core/providers/noble-hashes';
```

Dedicated provider subpaths:

| Import                                | Re-exports              |
| ------------------------------------- | ----------------------- |
| `@codexa/core/providers/path`         | `@std/path`             |
| `@codexa/core/providers/zod`          | `@zod/zod`              |
| `@codexa/core/providers/dotenv`       | `@std/dotenv`           |
| `@codexa/core/providers/ioredis`      | `ioredis`               |
| `@codexa/core/providers/mongodb`      | `mongodb`               |
| `@codexa/core/providers/qs`           | `qs`                    |
| `@codexa/core/providers/rou3`         | `rou3`                  |
| `@codexa/core/providers/ua-parser-js` | `ua-parser-js`          |
| `@codexa/core/providers/noble-hashes` | `@noble/hashes` modules |

`@codexa/core/zod` remains available as a compatibility alias, but new code should prefer `@codexa/core/providers/zod`.

## HTTP Quick Start

```ts
import { createApp, definePlugin } from '@codexa/core/http';

const healthPlugin = definePlugin({
	name: 'health',
	metadata: {
		description: 'Health and readiness endpoints',
		tags: ['system'],
	},
	setup(scope) {
		scope.route({
			method: 'GET',
			path: '/health',
			handler: (ctx) => ctx.json({ ok: true }),
			options: {
				name: 'health.check',
				tags: ['public:health'],
				openapi: {
					summary: 'Health check',
					responses: { 200: { description: 'Service is healthy' } },
				},
			},
		});
	},
});

const app = createApp('codexa-api')
	.install(healthPlugin)
	.onNotFound((request) => {
		const url = new URL(request.url);
		return Response.json({ error: 'Not Found', path: url.pathname }, {
			status: 404,
		});
	});

await app.boot();
await app.listen({ port: 8000 });
```

Use factories instead of class constructors: `createApp`, `createRouter`, `definePlugin`, `defineMiddleware`, and `definePluginMiddleware`.

## Plugin Shape

Plugins own their routes, plugin middleware, version header, hooks, and exposed services.

```ts
import { definePlugin } from '@codexa/core/http';

export const usersPlugin = definePlugin({
	name: 'users',
	metadata: {
		license: 'GPL-3.0-or-later',
		description: 'User profile API',
		tags: ['users'],
	},
	setup(scope) {
		scope.route({
			method: 'GET',
			path: '/users/:id',
			handler: (ctx) => {
				return ctx.json({
					id: ctx.params.id,
					requestId: ctx.state.requestId,
				});
			},
			options: {
				name: 'users.show',
				tags: ['users:get'],
			},
		});
	},
});
```

Plugin names and dependency names are exact matches. Prefer lowercase kebab names like `auth`, `billing-core`, or `media-service`.

## Typed Config And Services

Use module augmentation from `@codexa/core/http` so plugin config and exposed services become discoverable.

```ts
import { definePlugin } from '@codexa/core/http';

type Session = { userId: string; role: 'admin' | 'member' };

declare module '@codexa/core/http' {
	interface IPluginConfigMap {
		auth: { issuer: string };
	}

	interface IPluginServiceMap {
		auth: {
			verifyToken(token: string): Promise<Session | null>;
		};
	}
}

export const authPlugin = definePlugin({
	name: 'auth',
	setup(scope, config) {
		scope.exposeService('verifyToken', async (token) => {
			if (token === '') return null;
			return { userId: `${config.issuer}:u1`, role: 'member' };
		});
	},
});
```

Other plugins can consume only services from plugins listed in `dependsOn`.

```ts
export const profilePlugin = definePlugin({
	name: 'profile',
	dependsOn: ['auth'] as const,
	setup(scope) {
		const verifyToken = scope.getService('auth', 'verifyToken');

		scope.route({
			method: 'GET',
			path: '/me',
			handler: async (ctx) => {
				const token = ctx.headers.get('authorization') ?? '';
				const session = await verifyToken(token.replace('Bearer ', ''));
				if (!session) {
					return ctx.json({ error: 'Unauthorized' }, { status: 401 });
				}
				return ctx.json({ userId: session.userId, role: session.role });
			},
			options: { name: 'profile.me', tags: ['guarded:profile'] },
		});
	},
});
```

The root app can read exposed plugin services after installation:

```ts
const app = createApp('api')
	.install(authPlugin, { issuer: 'codexa' })
	.install(profilePlugin);

const authServices = app.getServices('auth');
```

## Plugin Middleware

Plugin middleware is scoped to the plugin that registered it. It does not mutate another plugin's `ctx.state`.

```ts
import { definePlugin, definePluginMiddleware } from '@codexa/core/http';

const authState = definePluginMiddleware<{
	authUserId: string;
	authRole: 'admin' | 'member';
}>({
	name: 'auth.state',
	tags: ['auth:middleware'],
	appliedOn: ['guarded*'],
	priority: -20,
	fn(ctx) {
		const token = ctx.headers.get('authorization');
		if (!token) {
			return ctx.json({ error: 'Unauthorized' }, { status: 401 });
		}
		ctx.provide({ authUserId: 'u1', authRole: 'member' });
	},
	expose(data) {
		return {
			authUserId: data.authUserId,
			authRole: data.authRole,
		};
	},
});

export const accountPlugin = definePlugin({
	name: 'account',
	setup(scope) {
		const guarded = scope.use(authState);

		guarded.route({
			method: 'GET',
			path: '/account',
			handler: (ctx) =>
				ctx.json({
					userId: ctx.state.authUserId,
					role: ctx.state.authRole,
				}),
			options: { name: 'account.show', tags: ['guarded:account'] },
		});
	},
});
```

`appliedOn` patterns match route tags:

| Pattern    | Meaning                       |
| ---------- | ----------------------------- |
| `*`        | all routes in the same plugin |
| `user:get` | exact tag                     |
| `user*`    | starts with `user`            |
| `*user`    | ends with `user`              |
| `*user*`   | contains `user`               |

Middleware without `appliedOn` is registered but does not apply to routes by default.

## Inline Route Middleware And Locals

Inline middleware belongs to one route and writes to `ctx.locals`, not `ctx.state`.

```ts
import { defineMiddleware } from '@codexa/core/http';

const tenantLocal = defineMiddleware<{ tenantId: string }>({
	fn(ctx) {
		ctx.provide({
			tenantId: ctx.headers.get('x-tenant-id') ?? 'default',
		});
	},
	expose(data) {
		return { tenantId: data.tenantId };
	},
});

scope.route({
	method: 'GET',
	path: '/tenant',
	handler: (ctx) => {
		return ctx.json({ tenantId: ctx.locals.tenantId });
	},
	options: {
		name: 'tenant.current',
		tags: ['tenant:get'],
		middleware: [tenantLocal] as const,
	},
});
```

## Versioned Routes

Version headers are plugin-owned. Set `versionHeader` on the plugin.

```ts
const catalogPlugin = definePlugin({
	name: 'catalog',
	versionHeader: 'X-Catalog-Version',
	setup(scope) {
		scope.version('2.0.0').route({
			method: 'GET',
			path: '/catalog/items',
			handler: (ctx) => ctx.json({ version: '2.0.0' }),
			options: { name: 'catalog.items.v2', tags: ['catalog'] },
		});
	},
});
```

Request:

```bash
curl -H "X-Catalog-Version: 2.0.0" http://localhost:8000/catalog/items
```

Duplicate routes are rejected by `method + path + version`. Unversioned and versioned routes may share the same method and path.

## Routers

Routers are reusable route collections. Mount them inside plugins.

```ts
import { createRouter, definePlugin } from '@codexa/core/http';

const usersRouter = createRouter('users-router')
	.route({
		method: 'GET',
		path: '/users/:id',
		handler: (ctx) => ctx.json({ id: ctx.params.id }),
		options: { name: 'users.show', tags: ['users:get'] },
	});

export const usersPlugin = definePlugin({
	name: 'users',
	setup(scope) {
		scope.mount('/api', usersRouter);
	},
});
```

## Hooks

Hooks receive controlled snapshots. They do not receive the native `Response` body, so stream responses are not consumed accidentally.

```ts
const app = createApp('api')
	.onSuccess((event) => {
		console.log('request success', {
			path: event.path,
			status: event.response.status,
			route: event.route?.name,
		});
	})
	.onError((event) => {
		console.error('request error', {
			path: event.path,
			status: event.response.status,
			error: event.error?.message,
		});
	})
	.onShutdown(() => {
		console.log('closing database connections');
	});
```

Plugin hooks are registered inside plugin setup:

```ts
const auditPlugin = definePlugin({
	name: 'audit',
	setup(scope) {
		scope.onSuccess((event) => {
			console.log('audit route', event.route?.name);
		});
	},
});
```

## Response Helpers

Every `ctx` has response helpers. The root app also has the same helpers for utility usage.

```ts
ctx.json({ ok: true });
ctx.text('hello');
ctx.html('<strong>hello</strong>');
ctx.markdown('# hello');
ctx.redirect('/login', 302);
ctx.stream(readable);
ctx.send(formData);
```

## WebSocket Route

Use a WebSocket client for WebSocket routes. A plain browser GET is not an upgrade request.

```ts
scope.route({
	method: 'GET',
	path: '/realtime/ws',
	handler: (ctx) => {
		const upgrade = ctx.headers.get('upgrade')?.toLowerCase();
		if (upgrade !== 'websocket') {
			return ctx.json(
				{ error: 'Expected WebSocket upgrade' },
				{ status: 426, headers: { upgrade: 'websocket' } },
			);
		}

		const { socket, response } = Deno.upgradeWebSocket(ctx.request);

		socket.onopen = () => socket.send('connected');
		socket.onmessage = (event) => socket.send(`echo:${event.data}`);

		return response;
	},
	options: { name: 'realtime.ws', tags: ['realtime'] },
});
```

Browser client:

```ts
const socket = new WebSocket('ws://localhost:8000/realtime/ws');
socket.onmessage = (event) => console.log(event.data);
```

## Dispatch And Lifecycle

`dispatch()` is useful for tests, local probes, and serverless adapters.

```ts
const app = createApp('api').install(healthPlugin);

await app.boot();

const response = await app.dispatch(
	new Request('http://local.test/health'),
);

console.log(response.status);

await app.shutdown();
await app.whenStopped();
```

`listen()` starts Deno's HTTP server:

```ts
await app.listen({
	port: 8000,
	hostname: 'localhost',
	onListen(addr) {
		console.log(`listening on ${addr.hostname}:${addr.port}`);
	},
});
```

`whenStopped()` resolves after shutdown finishes. It is useful when another signal calls `shutdown()` and your main function wants to wait for cleanup.

## Inspection And Tags

```ts
const result = app.inspect({
	plugins: ['users'],
	tags: ['users:get'],
	includeDisabled: true,
});

console.log(result.summary);
console.table(result.routes);

app.disableByTags('beta');
app.enableByTags('beta');
```

`inspect()` can query routes, plugins, tags, services, HTTP methods, and versions.

## OpenAPI

`@codexa/core/openapi` generates OpenAPI 3.1 documents from the public HTTP `inspect()` API. It does not instantiate the HTTP runtime class, and it works with plugin routes, mounted routers, disabled-route filtering, route tags, plugin names, and plugin-owned version headers.

Add metadata on routes:

```ts
import { zod } from '@codexa/core/providers/zod';

scope.route({
	method: 'POST',
	path: '/users',
	handler: createUser,
	options: {
		name: 'users.create',
		tags: ['users:create'],
		openapi: {
			summary: 'Create user',
			tags: ['Users'],
			body: zod.object({
				email: zod.string().email(),
				name: zod.string().min(2),
			}),
			bodyContentType: 'application/json',
			responses: {
				201: { description: 'User created' },
				400: { description: 'Invalid payload' },
			},
		},
	},
});
```

Generate a document from the app:

```ts
import { generateOpenApiDocument } from '@codexa/core/openapi';

const document = generateOpenApiDocument(app, {
	info: {
		title: 'Codexa API',
		version: '1.0.0',
		description: 'Plugin-first API generated from route metadata',
	},
	servers: [{ url: 'https://api.example.com' }],
	securitySchemes: {
		bearer: {
			type: 'http',
			scheme: 'bearer',
			bearerFormat: 'JWT',
		},
	},
	security: [{ bearer: [] }],
	versionedPathStrategy: 'suffix',
});

await Deno.writeTextFile(
	'openapi.json',
	JSON.stringify(document, null, 2),
);
```

Serve the document from a plugin:

```ts
import {
	generateOpenApiDocument,
	serveOpenApiJson,
} from '@codexa/core/openapi';
import { definePlugin } from '@codexa/core/http';

const docsPlugin = definePlugin({
	name: 'docs',
	setup(scope) {
		serveOpenApiJson(
			scope,
			app,
			{
				info: { title: 'Codexa API', version: '1.0.0' },
				servers: [{ url: 'http://localhost:8000' }],
				versionedPathStrategy: 'suffix',
			},
			'/docs/openapi.json',
		);

		scope.route({
			method: 'GET',
			path: '/docs/openapi-summary',
			handler: (ctx) => {
				const doc = generateOpenApiDocument(app, {
					info: { title: 'Codexa API', version: '1.0.0' },
				});
				return ctx.json({
					paths: Object.keys(doc.paths).length,
					tags: doc.tags?.map((tag) => tag.name) ?? [],
				});
			},
			options: { name: 'docs.openapi.summary' },
		});
	},
});
```

Versioned routes include the correct plugin-owned header automatically:

```ts
const catalogPlugin = definePlugin({
	name: 'catalog',
	versionHeader: 'X-Catalog-Version',
	setup(scope) {
		scope.version('2.0.0').route({
			method: 'GET',
			path: '/catalog/items/:id',
			handler: (ctx) => ctx.json({ id: ctx.params.id }),
			options: {
				name: 'catalog.items.show.v2',
				tags: ['catalog:item'],
				openapi: {
					summary: 'Get catalog item',
					params: zod.object({ id: zod.string() }),
					responses: {
						200: { description: 'Catalog item returned' },
					},
				},
			},
		});
	},
});
```

With `versionedPathStrategy: 'suffix'`, this appears as `/catalog/items/{id};version=2.0.0` and includes a required `X-Catalog-Version: 2.0.0` header parameter. Import the generated JSON into Postman, Insomnia, Swagger UI, Scalar, or any OpenAPI 3.1-compatible tooling.

## Config And Env

```ts
import { Environment } from '@codexa/core/config';
import { zod } from '@codexa/core/providers/zod';

const env = new Environment();
await env.loadEnv({
	loadFiles: true,
	schema: zod.object({
		PORT: zod.coerce.number().default(8000),
		REDIS_URL: zod.string().optional(),
	}),
});

const port = env.getNumber('PORT');
```

## Logger

```ts
import { createLogger } from '@codexa/core/logger';

const log = createLogger('Api');
log.info('booting');
log.error('request failed', { requestId: 'r1' });
```

File logging is controlled by logger configuration and environment variables. See `env.example.txt`.

## Event Bus

Local mode:

```ts
import { createEventBus } from '@codexa/core/bus';

const ordersBus = createEventBus();
await ordersBus.initialize();

ordersBus.on<{ id: string }>('orders', 'created', (order) => {
	console.log(order.id);
});

ordersBus.emit('orders', 'created', { id: 'o1' });
```

Redis distributed mode:

```ts
import { createRedisConnection } from '@codexa/core/config';
import { createEventBus } from '@codexa/core/bus';

const redis = createRedisConnection({ url: Deno.env.get('REDIS_URL') });
await redis.connect();

const distributedBus = createEventBus();
await distributedBus.initialize({
	redisClient: redis.getClient(),
	subscribeChannels: ['orders'],
});
```

For multiple named buses with centralized cleanup:

```ts
import { createEventBusRegistry } from '@codexa/core/bus';

const buses = createEventBusRegistry();
const authEvents = await buses.register('auth');
const billingEvents = await buses.register('billing', {
	redisClient: redis.getClient(),
	subscribeChannels: ['billing'],
});

await buses.destroyAll();
```

`eventBus` remains available as the default application bus for backward compatibility.

## Store

Independent stores (recommended for plugins):

```ts
import { createStore } from '@codexa/core/store';

const authStore = await createStore({
	mode: 'redis',
	redisClient: redis.getClient(),
	keyPrefix: 'auth:',
});
const walletStore = await createStore({
	mode: 'kv',
	kvPath: './data/wallet.db',
	kvPrefix: 'wallet',
});
const temporaryStore = await createStore({ mode: 'memory' });

await authStore.set('session:u1', { userId: 'u1' }, { ttl: 900 });
await Promise.all([
	authStore.close(),
	walletStore.close(),
	temporaryStore.close(),
]);
```

Named stores with centralized lifecycle management:

```ts
import { createStoreRegistry } from '@codexa/core/store';

const stores = createStoreRegistry();
const sessions = await stores.register('auth:sessions', {
	mode: 'redis', redisClient: redis.getClient(),
});
const authMetadata = await stores.register('auth:metadata', {
	mode: 'kv', kvPath: './data/auth.db', kvPrefix: 'auth',
});

await stores.closeAll();
```

Named registry stores automatically receive a `<name>:` key prefix unless `keyPrefix` is provided. This makes two logical stores safe on the same Redis database and scopes `flushdb()` to that store's keys. Direct `createStore()` calls can opt into the same protection with `keyPrefix`.

Injected Redis clients are caller-owned by default, so closing one plugin store does not disconnect other users of the client. Set `closeRedisClientOnClose: true` only when the store owns a dedicated client. The legacy `initializeStore()` API keeps its previous behavior and owns its Redis client unless explicitly configured otherwise.

The original singleton API remains the default application-store shorthand:

```ts
import { initializeStore, store } from '@codexa/core/store';

await initializeStore({ mode: 'memory' });
await store.set('key', 'value');
```

Local Deno KV requires the unstable flag:

```bash
deno run --unstable-kv --allow-read --allow-write main.ts
```

## Cache

```ts
import { createCache } from '@codexa/core/cache';
import { createStore } from '@codexa/core/store';

const routeStore = await createStore({
	mode: 'redis',
	redisClient: redis.getClient(),
});
const usersCache = createCache('users', {
	defaultTtl: 300,
	store: routeStore,
});

const user = await usersCache.getOrSet(
	'u1',
	() => fetchUserFromDatabase('u1'),
	{ ttl: 600, tags: ['user:u1'] },
);

await usersCache.invalidateTag('user:u1');
```

Every cache captures its configured store instance. Different routers can use the same namespace with different stores without sharing data. Omitting `store` keeps the legacy default-store behavior.

## Storage

```ts
import { buildStorageConfig } from '@codexa/core/config';
import { createStorageManager } from '@codexa/core/storage';

const storage = createStorageManager(
	buildStorageConfig({
		STORAGE_PROVIDER: 'local',
		LOCAL_STORAGE_DIR: './uploads',
		LOCAL_BASE_URL: 'http://localhost:8000/uploads',
	}),
);

const uploaded = await storage.upload(new Uint8Array([1, 2, 3]), {
	folder: 'avatars',
	contentType: 'image/png',
	assetType: 'image',
});
```

Create as many storage managers as needed, or keep named managers in a registry:

```ts
import { createStorageRegistry } from '@codexa/core/storage';

const storages = createStorageRegistry();
const mediaStorage = storages.register('media', cloudinaryConfig);
const invoiceStorage = storages.register('invoices', s3Config);

await mediaStorage.upload(imageBytes, { folder: 'products' });
await invoiceStorage.upload(pdfBytes, { folder: 'invoices' });
```

Storage managers do not currently own long-lived connections, so `remove()` and `clear()` only remove registry references. A custom adapter with its own connection should expose and manage that connection in the plugin or app lifecycle that created it.

Direct client upload token:

```ts
const token = await storage.getSignedUploadUrl({
	folder: 'videos',
	contentType: 'video/mp4',
	assetType: 'video',
	expiresIn: 1800,
});
```

## Plugin Resource Composition

HTTP plugins receive resources through their install config. The app (or the registry it creates) owns shared-resource cleanup; a plugin should only close an instance when it created that instance itself.

```ts
import { createApp, definePlugin } from '@codexa/core/http';
import { createCache, type CacheNamespace } from '@codexa/core/cache';
import { createRedisConnection } from '@codexa/core/config';
import {
	createStoreRegistry,
	type StoreInstance,
} from '@codexa/core/store';
import {
	createEventBusRegistry,
	type IEventBus,
} from '@codexa/core/bus';

interface AuthResources {
	sessions: StoreInstance;
	metadata: StoreInstance;
	pageCache: CacheNamespace;
	events: IEventBus;
}

const authPlugin = definePlugin<'auth', AuthResources>({
	name: 'auth',
	setup(scope, resources) {
		scope.route({
			method: 'GET',
			path: '/session/:id',
			handler: async (ctx) => {
				const session = await resources.sessions.get(ctx.params.id);
				return ctx.json({ session });
			},
		});
	},
});

const redis = createRedisConnection({ url: Deno.env.get('REDIS_URL') });
await redis.connect();
const stores = createStoreRegistry();
const buses = createEventBusRegistry();
const sessions = await stores.register('auth:sessions', {
	mode: 'redis',
	redisClient: redis.getClient(),
});
const metadata = await stores.register('auth:metadata', {
	mode: 'kv',
	kvPath: './data/auth.db',
});
const events = await buses.register('auth');

const app = createApp().install(authPlugin, {
	sessions,
	metadata,
	pageCache: createCache('auth-pages', { store: metadata }),
	events,
});

app.onShutdown(async () => {
	await Promise.all([stores.closeAll(), buses.destroyAll()]);
	await redis.disconnect();
});
```

## Utilities

```ts
import { generateId, hashPassword, verifyPassword } from '@codexa/core/crypto';
import { sha256 } from '@codexa/core/hash';
import { parseDevice } from '@codexa/core/device';
import { parseTtlToSeconds } from '@codexa/core/ttl';
import { createSuccessResponse } from '@codexa/core/response';
import { parseQueryParams } from '@codexa/core/query';

const id = generateId();
const hash = await hashPassword('secret');
const ok = await verifyPassword('secret', hash);
const digest = await sha256('payload');
const device = parseDevice('Mozilla/5.0');
const ttl = parseTtlToSeconds('15m');
const body = createSuccessResponse({ id });
const query = parseQueryParams('a=1&a=2');
```

## Release Notes For HTTP Users

- The HTTP framework uses Deno and Rou3 with factory-based APIs.
- Import `createApp`, `createRouter`, `definePlugin`, and middleware helpers from `@codexa/core/http`.
- The main app installs plugins and owns lifecycle methods like `boot`, `listen`, `dispatch`, `shutdown`, and `whenStopped`.
- Plugins own routes, middleware, version headers, hooks, and services.
- Cross-plugin access must go through explicitly exposed services and declared `dependsOn`.
- `ctx.state` is plugin-scoped request state. `ctx.locals` is route-inline middleware state.
- Native responses and streams are never exposed to hooks in a way that can consume the body.
