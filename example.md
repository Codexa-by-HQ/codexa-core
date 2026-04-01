# OrbitHttp – Middleware Framework API

> Built on [Oak](https://jsr.io/@oak/oak) + Deno. Priority-sorted, versioned, lifecycle-managed middleware pipeline.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Lifecycle](#lifecycle)
- [use() – Register Middleware](#use--register-middleware)
- [router() – Prefixed Routers](#router--prefixed-routers)
- [group() – Middleware Groups](#group--middleware-groups)
- [useIf() – Conditional Middleware](#useif--conditional-middleware)
- [useSafe() – Error-Safe Middleware](#usesafe--error-safe-middleware)
- [HTTP Shortcuts (get/post/put/delete/patch)](#http-shortcuts)
- [version() – Versioned Routes](#version--versioned-routes)
- [onShutdown() – Cleanup Hooks](#onshutdown--cleanup-hooks)
- [Tag Controls (disableByTags / enableByTags / inspectByTags)](#tag-controls--runtime-enabledisable)
- [Plugin System](#plugin-system)
  - [Architecture Overview](#architecture-overview)
  - [Writing a Plugin](#writing-a-plugin)
  - [Installing Plugins](#installing-plugins)
  - [Plugin Scoped State (PluginStateMap)](#plugin-scoped-state)
  - [Plugin Services](#plugin-services)
  - [Plugin Dependencies](#plugin-dependencies)
  - [Plugin Lifecycle](#plugin-lifecycle)
  - [Plugin Tag Controls](#plugin-tag-controls)
  - [Uninstalling Plugins](#uninstalling-plugins)
- [Introspection (inspect / inspectVersioned / inspectPlugins)](#introspection)
- [Priority System](#priority-system)
- [Built-in Middleware](#built-in-middleware)
- [Type System (SafeProvide / Context Injection / PluginStateMap)](#type-system)
- [Full Example (server.ts)](#full-example)
- [Testing with curl](#testing-with-curl)

---

## Quick Start

```ts
import { MiddlewarePriority, OrbitHttp } from '@/core/lib/orbitHttp.ts';

const app = new OrbitHttp();

app.get('/health', async (ctx) => {
	ctx.response.body = { status: 'ok' };
});

await app.boot();
await app.listen({ port: 8000 });
```

---

## Lifecycle

OrbitHttp has a strict lifecycle:

```
idle → booting → ready → listening → shutting_down → stopped
```

| Method                           | Transition                    | What happens                                                             |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `new OrbitHttp()`                | → `idle`                      | Oak Application created, error event bound                               |
| `install(plugin, ctx?, config?)` | stays `idle`                  | Validates deps, creates sandboxed scope, calls `plugin.install()`        |
| `boot(setup?)`                   | `idle` → `booting` → `ready`  | Runs setup → plugin inits (topological order) → sorts & commits pipeline |
| `listen(opts?)`                  | `ready` → `listening`         | Starts HTTP server, registers signal handlers                            |
| `shutdown()`                     | → `shutting_down` → `stopped` | Plugin shutdown hooks (reverse order) → root hooks → abort listener      |
| `uninstall(name)`                | any (before or after boot)    | Runs plugin cleanup, disables tagged entries, removes from registry      |

```ts
const app = new OrbitHttp();

// Register everything here (middleware, routes, etc.)
app.use(corsMiddleware(), {
	name: 'cors',
	priority: MiddlewarePriority.CRITICAL,
});

await app.boot(async () => {
	await connectDatabase();
	await initializeStore();
});

await app.listen({ port: 8000, host: '0.0.0.0' });
```

> **After `boot()` is called, all middleware is committed. No more registrations allowed.**

---

## use() – Register Middleware

Register a middleware function or an Oak Router.

```ts
// Simple middleware
app.use(myMiddleware);

// With full options
app.use(corsMiddleware(), {
	name: 'cors',
	priority: MiddlewarePriority.CRITICAL,
	enabled: true,
	tags: ['security'],
});

// With dynamic context injection (provide)
app.use(tenantResolver, {
	name: 'tenant',
	priority: MiddlewarePriority.AUTH,
	provide: { tenantId: 'default' },
});

// With lifecycle hooks
app.use(authParser, {
	name: 'auth',
	priority: MiddlewarePriority.AUTH,
	onSuccess: (ctx) => console.log('Auth succeeded for', ctx.state.userId),
	onError: (ctx, err) => console.log('Auth failed:', err),
});

// Oak Router directly
import { Router } from '@oak/oak';
const apiRouter = new Router();
apiRouter.get('/users', listUsers);
app.use(apiRouter, { name: 'api-routes' });
```

### UseOptions

| Option      | Type                 | Default         | Description                                                                                    |
| ----------- | -------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `name`      | `string`             | auto-generated  | Unique name (duplicates throw)                                                                 |
| `priority`  | `number`             | `BUSINESS (40)` | Execution order group (lower = earlier)                                                        |
| `enabled`   | `boolean`            | `true`          | If `false`, entry is registered but skipped at runtime. Can be re-enabled via `enableByTags()` |
| `tags`      | `string[]`           | `[]`            | For grouping and runtime toggling                                                              |
| `provide`   | `object`             | -               | Values injected into `ctx.state` at runtime                                                    |
| `onSuccess` | `(ctx) => void`      | -               | Called after middleware executes successfully                                                  |
| `onError`   | `(ctx, err) => void` | -               | Called when middleware throws (prevents re-throw)                                              |

> **Lifecycle hooks coverage:** `provide`, `onSuccess`, and `onError` work across **all** registration methods: `use()`, `router()`, `group()`, `useIf()`, `useSafe()`, HTTP shortcuts (`get`/`post`/`put`/`delete`/`patch`), and versioned routes/routers.

---

## router() – Prefixed Routers

Register an Oak Router with a prefix. The prefix is set via `router.prefix()`.

```ts
import { Router } from '@oak/oak';

const usersRouter = new Router();
usersRouter.get('/', listUsers);
usersRouter.post('/', createUser);
usersRouter.get('/:id', getUser);

const authRouter = new Router();
authRouter.post('/login', login);
authRouter.post('/register', register);

app.router('/api/users', usersRouter, {
	priority: MiddlewarePriority.BUSINESS,
});
app.router('/api/auth', authRouter, { priority: MiddlewarePriority.BUSINESS });

// With lifecycle hooks – provide/onSuccess/onError work on routers too
app.router('/api/tenant', tenantRouter, {
	priority: MiddlewarePriority.BUSINESS,
	provide: { tenantId: 'default' },
	onSuccess: (ctx) => console.log('Tenant route completed'),
	onError: (ctx, err) => console.error('Tenant route failed:', err),
});
```

> **Note:** `router()` wraps the router via a new Router internally so the original instance is **not** mutated.

---

## group() – Middleware Groups

Register multiple middleware/routers that share the same priority and options.

```ts
app.group('auth', [
	authParser,
	sessionHydrator,
], {
	priority: MiddlewarePriority.AUTH,
	tags: ['authentication'],
});
```

Each item is named `groupName:functionName` (or `groupName:index` for anonymous functions).

---

## useIf() – Conditional Middleware

Register middleware that only runs when a **per-request** condition returns `true`.

```ts
// Only run rate limiter in production
app.useIf(
	() => env.isProduction(),
	rateLimiter,
	{
		name: 'rate-limit',
		priority: MiddlewarePriority.SECURITY,
		enabled: true,
	},
);

// Only run for API routes
app.useIf(
	(ctx) => ctx.request.url.pathname.startsWith('/api'),
	apiLogger,
	{ name: 'api-logger' },
);

// Async condition
app.useIf(
	async (ctx) => {
		const isMaintenanceMode = await store.get('maintenance');
		return !isMaintenanceMode;
	},
	normalHandler,
);
```

> **Note:** `useIf()` condition is evaluated per-request at runtime. If you want to skip registration entirely, use `enabled: false` instead.

> **⚠️ Pipeline behavior:** If the middleware executes and does not call `next()`, the pipeline stops. This is standard middleware behavior – for example, an auth middleware may reject a request without calling `next()`. `useIf` only controls _whether_ the middleware runs, not _how_ it behaves once running.

---

## useSafe() – Error-Safe Middleware

Wrap a middleware with per-middleware error handling. Errors are caught, logged, and handled without crashing the server.

```ts
// Basic – returns generic 500 on error
app.useSafe(riskyMiddleware);

// With custom error handler
app.useSafe(externalApiCall, {
	name: 'external-api',
	onError: (ctx, err) => {
		ctx.response.status = 502;
		ctx.response.body = {
			success: false,
			error: 'External service unavailable',
		};
	},
});
```

> **Event emission:** When `useSafe` catches an error, it emits `oak:middleware:error` via EventBus (non-distributed) with `{ error, middleware, method, path, requestId }`. This allows monitoring/alerting systems to observe errors that are handled gracefully without crashing the server.

---

## HTTP Shortcuts

Register single-path routes directly (creates an internal Oak Router behind the scenes).

```ts
app.get('/health', async (ctx) => {
	ctx.response.body = { status: 'ok' };
});

app.post('/api/users', async (ctx) => {
	const body = await ctx.request.body.json();
	ctx.response.body = { success: true, data: body };
});

app.put('/api/users/:id', updateUser);
app.delete('/api/users/:id', deleteUser);
app.patch('/api/users/:id', patchUser);
```

---

## version() – Versioned Routes

Create versioned routes that require a matching `X-Version` header. **Exact string match** – no semver parsing.

```ts
// Version 1 – list users v1
app.version('1.0.0').get('/api/users', async (ctx) => {
	ctx.response.body = { version: '1.0.0', users: ['alice'] };
});

// Version 2 – list users v2 with pagination
app.version('2.0.0').get('/api/users', async (ctx) => {
	ctx.response.body = { version: '2.0.0', users: ['alice', 'bob'], page: 1 };
});

// Version-specific routes
app.version('1.0.0').post('/api/users', createUserV1);
app.version('1.3.0').post('/api/users', createUserV1WithValidation);

// Full CRUD across versions
app.version('2.0.1').put('/api/users', updateUserV2);
app.version('2.0.1').delete('/api/users', deleteUserV2);

// Versioned routers
app.version('1.2.0').router('/api/users', usersRouterV1);
app.version('2.0.1').router('/api/users', usersRouterV2);
```

### How It Works

1. Client sends `X-Version: 1.0.0` header
2. OrbitHttp matches routes registered under `version('1.0.0')`
3. If no match found → falls through to notFound handler
4. If no `X-Version` header → versioned routes are **not matched** (unversioned routes still work)

> **⚠️ Router mutation:** `version().router()` calls `.prefix()` on the Router instance. If the same Router instance is passed to multiple version scopes, OrbitHttp will detect the duplicate and **skip the prefix** with a warning. Always use **separate Router instances** per version:
>
> ```ts
> const usersV1 = new Router(); // ✔️ separate instance
> const usersV2 = new Router(); // ✔️ separate instance
> app.version('1.0.0').router('/api/users', usersV1);
> app.version('2.0.0').router('/api/users', usersV2);
> ```

### Testing Versioned Routes

```bash
# Hits version 1.0.0
curl -H "X-Version: 1.0.0" http://localhost:8000/api/users

# Hits version 2.0.0
curl -H "X-Version: 2.0.0" http://localhost:8000/api/users

# No version header – only unversioned routes match
curl http://localhost:8000/api/users
```

---

## onShutdown() – Cleanup Hooks

Register cleanup functions that run during graceful shutdown. Hooks run in **reverse** registration order (stack unwinding).

```ts
app.onShutdown(() => db.disconnect());
app.onShutdown(() => redis.quit());
app.onShutdown(() => eventBus.destroy());
app.onShutdown(async () => {
	console.log('Custom cleanup…');
	await flushMetrics();
});
```

**Execution order:** If registered in order [db, redis, eventBus, metrics], shutdown runs: metrics → eventBus → redis → db.

---

## Tag Controls – Runtime Enable/Disable

Tags let you group middleware/routes and toggle them at runtime. This overrides the `enabled` flag set at registration time.

### disableByTags(...tags)

Disable all middleware/routes that hold ANY of the given tags. Disabled entries are skipped when a request comes in — the request falls through to the next middleware (effectively 404 for disabled routes).

```ts
// Register with tags
app.use(debugLogger, { name: 'debug-log', tags: ['debug'] });
app.use(metricsCollector, { name: 'metrics', tags: ['debug', 'monitoring'] });
app.router('/api/admin', adminRouter, { tags: ['admin'] });

// Later: disable everything tagged 'debug'
app.disableByTags('debug');
// → debugLogger and metricsCollector are now disabled
// → adminRouter is unaffected

// Disable multiple tags at once
app.disableByTags('admin', 'debug');
```

### enableByTags(...tags)

Re-enable middleware/routes that were disabled (either at registration or by `disableByTags`).

```ts
// Register as disabled
app.use(featureFlagHandler, {
	name: 'feature-x',
	enabled: false,
	tags: ['beta'],
});

// Later: turn on beta features
app.enableByTags('beta');
```

### inspectByTags(...tags)

Inspect all middleware/routes associated with the given tags. Returns name, priority, enabled status, and tags.

```ts
console.table(app.inspectByTags('security'));
// ┌──────────────┬──────────┬─────────┬──────────────────┐
// │     name     │ priority │ enabled │       tags       │
// ├──────────────┼──────────┼─────────┼──────────────────┤
// │ cors         │ CRITICAL │  true   │ ['security']     │
// │ rate-limit   │ SECURITY │  false  │ ['security']     │
// └──────────────┴──────────┴─────────┴──────────────────┘
```

> **Note:** Tag controls work on both regular middleware entries AND versioned routes/routers AND plugin-registered entries. Changes take effect immediately for the next incoming request.

---

## Plugin System

OrbitHttp includes an enterprise plugin system that gives each plugin a sandboxed view of the framework while preserving full type safety.

### Architecture Overview

```
OrbitHttp = Kernel
  ├── middleware engine      (EntryRegistry)
  ├── lifecycle manager      (LifecycleManager)
  ├── router system          (VersionedRegistry)
  └── plugin registry        (PluginRegistry)     ← NEW

PluginInstallScope = Sandboxed App View
  ├── wraps OrbitHttp
  ├── auto-tags everything with plugin name
  ├── scopes ctx.state injection under plugin namespace
  ├── exposes services to other plugins
  └── gives each plugin its own init() lifecycle

Plugins = Feature Modules
  ├── own routes, middleware, services
  ├── own init (db, queue, external services)
  ├── consume root context OR create their own
  ├── expose services to siblings
  └── fully removable via uninstall
```

**Key guarantees:**

- Plugins **cannot** call `boot()`, `listen()`, or `shutdown()` — these are not on `IPluginScope`
- All registrations are auto-tagged with the plugin name for O(1) tag controls
- `provide` values are scoped under `ctx.state[pluginName]` — no cross-plugin collisions
- Circular dependencies are detected at boot time via Kahn's topological sort
- All lookups (plugin, service) are O(1) via `Map`

### Writing a Plugin

A plugin implements the `OrbitPlugin<Config>` interface:

```ts
import type {
	IPluginScope,
	MiddlewarePriority,
	OrbitPlugin,
	OrbitPluginContext,
} from '@/core/lib/orbitHttp.ts';

export interface AuthConfig {
	jwtSecret: string;
	prefix?: string;
}

export const authPlugin: OrbitPlugin<AuthConfig> = {
	name: 'orbit-auth',
	version: '1.0.0',
	metadata: { license: 'MIT', author: 'your-team' },
	// dependsOn: ['orbit-db'],  // optional — must be installed first

	install(scope, context, config) {
		const { jwtSecret, prefix = '/auth' } = config!;
		const db = context.db as Db; // cast — root decides what to share

		// Plugin-scoped async init (runs during boot in dependency order)
		scope.init(async () => {
			// Load signing keys, warm cache, connect to vault, etc.
		});

		// Expose services for sibling plugins
		scope.exposeService('jwtSecret', jwtSecret);

		// Register middleware — auto-tagged with 'orbit-auth'
		// provide is scoped: { userId, role } → ctx.state['orbit-auth'].userId
		scope.use(async (ctx, next) => {
			const token = ctx.request.headers.get('authorization');
			// ... validate token ...
			await next();
		}, {
			name: 'tokenValidator',
			priority: MiddlewarePriority.AUTH,
			provide: { userId: '', role: '' },
		});

		// Register routes — auto-tagged and name-prefixed
		scope.get(`${prefix}/me`, async (ctx) => {
			ctx.response.body = { ok: true };
		}, { name: 'me-route' });

		// Register a full router
		scope.router(prefix, authRouter);

		// Versioned routes
		scope.version('2.0.0').get(`${prefix}/me`, meHandlerV2);

		// Shutdown hook
		scope.onShutdown(async () => {
			// Close plugin-owned connections
		});
	},

	// Optional cleanup on uninstall
	uninstall(scope) {
		// Any additional cleanup beyond shutdown hooks
	},
};
```

### Installing Plugins

```ts
const app = new OrbitHttp();

// Install plugins BEFORE boot()
await app.install(dbPlugin, {}, { connectionString: '...' });
await app.install(authPlugin, { db }, { jwtSecret: 'secret' });
await app.install(billingPlugin, { db, redis }, { stripeKey: '...' });

// Boot runs plugin inits in dependency order, then commits pipeline
await app.boot(async () => {
	// Root infrastructure setup
});

await app.listen({ port: 8000 });
```

**`install(plugin, context?, config?)`**

| Parameter | Type                 | Description                                                                                                                         |
| --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `plugin`  | `OrbitPlugin<C>`     | The plugin object                                                                                                                   |
| `context` | `OrbitPluginContext` | Root-provided dependencies (db, redis, etc.). Intentionally `Record<string, unknown>` — plugin authors cast to their expected shape |
| `config`  | `C`                  | Plugin-specific configuration                                                                                                       |

### Plugin Scoped State

Every `provide` from a plugin is automatically scoped under `ctx.state[pluginName]`:

```ts
// Plugin registers:
scope.use(middleware, { provide: { userId: '', role: '' } });

// At runtime, this becomes:
// ctx.state['orbit-auth'].userId  ✓
// ctx.state.userId                ✗ (not polluted)
```

For full TypeScript autocompletion, plugins augment `PluginStateMap` in `global.d.ts`:

```ts
// In your plugin's type declaration file:
declare module '@/types/global.d.ts' {
	interface PluginStateMap {
		'orbit-auth': { userId: string; role: string; permissions: string[] };
	}
}

// Now typed everywhere:
// ctx.state['orbit-auth'].userId  — full autocomplete ✓
```

### Plugin Services

Plugins can expose services for sibling plugins to consume:

```ts
// In auth plugin's install():
scope.exposeService('policyChecker', new PolicyChecker(db));
scope.exposeService('tokenExpiry', 3600);

// In billing plugin's install() (must declare dependsOn: ['orbit-auth']):
const checker = scope.getService<PolicyChecker>('orbit-auth', 'policyChecker');

// From root code (after install):
const checker = app.getPluginService<PolicyChecker>(
	'orbit-auth',
	'policyChecker',
);
```

**Guards:**

- `exposeService()` throws if a service with the same name already exists
- `getService()` throws if the target plugin isn't installed
- A plugin cannot call `getService()` on itself — use local references

### Plugin Dependencies

```ts
export const billingPlugin: OrbitPlugin<BillingConfig> = {
	name: 'orbit-billing',
	version: '1.0.0',
	metadata: { license: 'MIT' },
	dependsOn: ['orbit-auth', 'orbit-db'], // must be installed first

	install(scope, context, config) {
		// Safe to access auth services here
		const checker = scope.getService<PolicyChecker>(
			'orbit-auth',
			'policyChecker',
		);
		// ...
	},
};
```

- Dependencies are validated at install time — if `orbit-auth` isn't installed yet, `install()` throws immediately
- At `boot()`, circular dependencies are detected via Kahn's topological sort — throws with the offending plugin names
- Plugin `init()` callbacks run in topological order (dependencies first)

### Plugin Lifecycle

```
install()   → plugin.install(scope, ctx, cfg) → routes/middleware/services registered
boot()      → topologicalSort() → init() per plugin (dependencies first) → #commit()
shutdown()  → plugin shutdown hooks (reverse install order) → root hooks
uninstall()     → plugin.uninstall() → shutdown hooks → disableAll → remove from registry
```

### Plugin Tag Controls

Since every plugin registration is auto-tagged with the plugin name, you can toggle an entire plugin:

```ts
// Disable everything registered by orbit-auth
app.disableByTags('orbit-auth');

// Re-enable
app.enableByTags('orbit-auth');

// Inspect
console.table(app.inspectByTags('orbit-auth'));
```

From within a plugin's `install()`, `scope.enableByTags()` / `scope.disableByTags()` delegate directly to the host — the plugin developer uses the tags they registered:

```ts
// Inside plugin install:
scope.use(handler, { tags: ['admin'] });
// Later:
scope.disableByTags('admin'); // disables entries tagged 'admin'
```

### Uninstalling Plugins

```ts
await app.uninstall('orbit-auth');
```

- Checks no other plugin depends on it (throws if so — uninstall dependents first)
- Calls `plugin.uninstall(scope)` if defined
- Runs plugin shutdown hooks in reverse order
- Disables all middleware/routes tagged with the plugin name
- Removes plugin and its services from the registry
- Works before or after `boot()`: after boot, Oak entries stay registered but disabled

---

## Introspection

### inspect()

Returns the middleware pipeline in execution order. Includes enabled and tags info.

> **Note:** Call `inspect()` after `boot()` to see the **final execution order**. Before boot, entries are shown in insertion order (not yet priority-sorted).

```ts
console.table(app.inspect());
// ┌───────────────────┬────────────┬───────┬─────────┬──────────────────┐
// │       name        │  priority  │ order │ enabled │       tags       │
// ├───────────────────┼────────────┼───────┼─────────┼──────────────────┤
// │ cors              │ CRITICAL   │   0   │  true   │ ['security']     │
// │ auth:authParser   │ AUTH       │   2   │  true   │ ['auth']         │
// │ orbit-auth:tokenV │ AUTH       │   5   │  true   │ ['orbit-auth']   │
// │ route:/api/users  │ BUSINESS   │   4   │  true   │ []               │
// └───────────────────┴────────────┴───────┴─────────┴──────────────────┘
```

### inspectVersioned()

Returns all registered versioned routes and routers with enabled status.

```ts
console.table(app.inspectVersioned());
// ┌──────────┬────────┬─────────────┬──────────────────────────┬─────────┐
// │ version  │ method │    path     │          name            │ enabled │
// ├──────────┼────────┼─────────────┼──────────────────────────┼─────────┤
// │ 1.0.0    │ GET    │ /api/users  │ v1.0.0:GET:/api/users    │  true   │
// │ 2.0.0    │ GET    │ /api/users  │ v2.0.0:GET:/api/users    │  true   │
// └──────────┴────────┴─────────────┴──────────────────────────┴─────────┘
```

### inspectPlugins()

Returns all installed plugins with version, status, services, and dependencies.

```ts
console.table(app.inspectPlugins());
// ┌──────────────┬─────────┬─────────────┬───────────────┬────────────────────┬──────────────┐
// │     name     │ version │   status    │  installedAt  │      services      │  dependsOn   │
// ├──────────────┼─────────┼─────────────┼───────────────┼────────────────────┼──────────────┤
// │ orbit-db     │ 1.0.0   │ initialized │ 1710000000000 │ ['client','db']    │ []           │
// │ orbit-auth   │ 1.0.0   │ initialized │ 1710000000001 │ ['policyChecker']  │ ['orbit-db'] │
// └──────────────┴─────────┴─────────────┴───────────────┴────────────────────┴──────────────┘
```

### Other

| Method                                 | Returns                                         |
| -------------------------------------- | ----------------------------------------------- |
| `getPhase()`                           | Current lifecycle phase string                  |
| `getApp()`                             | Underlying Oak `Application` (escape hatch)     |
| `size`                                 | Number of registered middleware entries         |
| `hasPlugin(name)`                      | `boolean` — O(1) check if a plugin is installed |
| `getPluginService<T>(plugin, service)` | Service instance exposed by a plugin            |

---

## Priority System

Middleware executes in priority order (lowest number first). Within the same priority, insertion order is preserved (stable sort).

| Priority    | Value | Use Case                                          |
| ----------- | ----- | ------------------------------------------------- |
| `PRE_SETUP` | 0     | CORS, helmet, body parsing, content-type          |
| `CRITICAL`  | 1     | Critical custom middleware                        |
| `AUTH`      | 20    | Auth parsing, token validation, session hydration |
| `SECURITY`  | 30    | RBAC, ABAC, permission checks                     |
| `BUSINESS`  | 40    | Controllers, route handlers (default)             |
| `FALLBACK`  | 50    | 404 handler, fallback routes                      |

```ts
import { MiddlewarePriority } from '@/core/lib/orbitHttp.ts';

app.use(cors(), { priority: MiddlewarePriority.CRITICAL }); // runs first
app.use(auth(), { priority: MiddlewarePriority.AUTH }); // runs after CRITICAL
app.use(handler, { priority: MiddlewarePriority.BUSINESS }); // runs after AUTH
```

---

## Built-in Middleware

These are injected automatically by OrbitHttp during `commit()`. You don't register them manually.

### Error Boundary (outermost)

- Wraps the **entire** pipeline
- Catches any uncaught error
- Logs the error with method, path, stack
- Emits `oak:request:error` event via EventBus
- Returns structured 500 JSON:

```json
{
	"success": false,
	"error": "Internal server error",
	"meta": { "timestamp": "...", "requestId": "..." }
}
```

### Request Lifecycle (pre/post)

**PRE** (before handlers):

- Generates unique `requestId` → sets `ctx.state.requestId`
- Records `startTime` via `performance.now()`

**POST** (after handlers):

- Calculates duration (`performance.now() - startTime`)
- Sets `X-Request-Id` response header
- Sets `X-Response-Time` response header (e.g. `12.34ms`)
- Logs morgan-style HTTP line with estimated body size:

```
GET /api/users 200 12.34ms ~142b [abc123def456]
```

> **Size estimation:** If `Content-Length` is set, that's used. Otherwise, size is derived from the body: string `.length`, `Uint8Array` `.byteLength`, or `~` prefix for JSON-stringified object estimate. `0b` for empty, `-` if unknown.

### Not-Found Handler (last)

- Sits at the very end of the pipeline
- If no middleware set a response body and status is 404:

```json
{
	"success": false,
	"error": "Route not found: GET /api/missing"
}
```

---

## Type System

### SafeProvide – Dynamic Context Injection

The `provide` option lets you inject typed values into `ctx.state` that your middleware can use:

```ts
interface TenantState {
	tenantId: string;
	tenantConfig: TenantConfig;
}

app.use<TenantState>(tenantResolver, {
	provide: { tenantId: 'default', tenantConfig: defaults },
});

// In the middleware, ctx.state.tenantId and ctx.state.tenantConfig are typed
```

### AppContext and AppMiddleware

```ts
import type { AppContext, AppMiddleware, AppNext } from '@/types/global.d.ts';

// Basic middleware
const myMiddleware: AppMiddleware = async (ctx: AppContext, next: AppNext) => {
	console.log(ctx.state.requestId); // always available from OakAppState
	await next();
};

// With custom state
interface MyState {
	userId: string;
}
const authMiddleware: AppMiddleware<MyState> = async (ctx, next) => {
	ctx.state.userId = 'abc123'; // typed!
	await next();
};
```

### PluginStateMap – Typed Plugin State

Plugins inject values into `ctx.state[pluginName]`. For full TypeScript autocompletion, plugins augment the `PluginStateMap` interface:

```ts
// global.d.ts (or in a separate .d.ts file)
export interface PluginStateMap {}

// OakAppState automatically includes all declared plugin state:
// export interface OakAppState extends PluginState { ... }
```

**Plugin author declares their state shape:**

```ts
// auth-plugin.d.ts
declare module '@/types/global.d.ts' {
	interface PluginStateMap {
		'orbit-auth': {
			userId: string;
			role: string;
			permissions: string[];
		};
	}
}
```

**Now typed everywhere in the app:**

```ts
// In any middleware or controller:
const userId = ctx.state['orbit-auth']?.userId; // string | undefined — fully typed ✓
const role = ctx.state['orbit-auth']?.role; // string | undefined — fully typed ✓
```

**`SafeProvide` safety:**

`SafeProvide` excludes both `OakAppState` keys and `PluginStateMap` keys, so you cannot accidentally inject values that collide with the core state or plugin state:

```ts
// This would be a type error:
app.use(handler, { provide: { requestId: '123' } }); // ✗ requestId is in OakAppState
```

---

## Full Example

```ts
// server.ts
import { MiddlewarePriority, OrbitHttp } from '@/core/lib/orbitHttp.ts';
import { Router } from '@oak/oak';

const app = new OrbitHttp();

// ─── Global Middleware ──────────────────────────────────────

app.use(corsMiddleware(), {
	name: 'cors',
	priority: MiddlewarePriority.CRITICAL,
});

app.use(helmetMiddleware, {
	name: 'helmet',
	priority: MiddlewarePriority.CRITICAL,
});

// ─── Conditional Middleware ─────────────────────────────────

app.useIf(
	() => Deno.env.get('ENV_TYPE') === 'production',
	rateLimiter,
	{ name: 'rate-limit', priority: MiddlewarePriority.SECURITY },
);

// ─── Grouped Auth Middleware ────────────────────────────────

app.group('auth', [
	authParser,
	sessionHydrator,
], { priority: MiddlewarePriority.AUTH });

// ─── Oak Routers ────────────────────────────────────────────

const usersRouter = new Router();
usersRouter.get('/', listUsers);
usersRouter.post('/', createUser);
usersRouter.get('/:id', getUser);

const authRouter = new Router();
authRouter.post('/login', login);
authRouter.post('/register', register);

app.router('/api/users', usersRouter, {
	priority: MiddlewarePriority.BUSINESS,
});
app.router('/api/auth', authRouter, { priority: MiddlewarePriority.BUSINESS });

// ─── HTTP Shortcuts ─────────────────────────────────────────

app.get('/health', async (ctx) => {
	ctx.response.body = { status: 'ok', phase: app.getPhase() };
});

// ─── Versioned Routes ───────────────────────────────────────

app.version('1.0.0').get('/api/users', listUsersV1);
app.version('2.0.0').get('/api/users', listUsersV2);
app.version('1.0.0').post('/api/users', createUserV1);
app.version('2.0.1').router('/api/accounts', accountsRouterV2);

// ─── Shutdown Hooks ─────────────────────────────────────────

app.onShutdown(() => db.disconnect());
app.onShutdown(() => redis.quit());
app.onShutdown(() => eventBus.destroy());

// ─── Plugins ────────────────────────────────────────────────

await app.install(authPlugin, { db, redis }, { jwtSecret: 'secret' });
await app.install(billingPlugin, { db }, { stripeKey: 'sk_test_...' });

// ─── Boot & Listen ──────────────────────────────────────────

await app.boot(async () => {
	await connectDatabase();
	await initializeStore();
});

// Debug: print the pipeline
console.table(app.inspect());
console.table(app.inspectVersioned());
console.table(app.inspectPlugins());

await app.listen({ port: 8000 });
```

---

## Testing with curl

```bash
# ─── Health Check ────────────────────────────────────────────
curl -s http://localhost:8000/health | jq

# ─── List Users (unversioned) ────────────────────────────────
curl -s http://localhost:8000/api/users | jq

# ─── Create User ─────────────────────────────────────────────
curl -s -X POST http://localhost:8000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}' | jq

# ─── Get User by ID ──────────────────────────────────────────
curl -s http://localhost:8000/api/users/abc123 | jq

# ─── Versioned: v1.0.0 ───────────────────────────────────────
curl -s -H "X-Version: 1.0.0" http://localhost:8000/api/users | jq

# ─── Versioned: v2.0.0 ───────────────────────────────────────
curl -s -H "X-Version: 2.0.0" http://localhost:8000/api/users | jq

# ─── Versioned: POST v1.0.0 ──────────────────────────────────
curl -s -X POST -H "X-Version: 1.0.0" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob"}' \
  http://localhost:8000/api/users | jq

# ─── Versioned: PUT v2.0.1 ───────────────────────────────────
curl -s -X PUT -H "X-Version: 2.0.1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Bob"}' \
  http://localhost:8000/api/users | jq

# ─── Versioned: DELETE v2.0.1 ────────────────────────────────
curl -s -X DELETE -H "X-Version: 2.0.1" \
  http://localhost:8000/api/users | jq

# ─── Wrong version (should 404) ──────────────────────────────
curl -s -H "X-Version: 99.0.0" http://localhost:8000/api/users | jq

# ─── Non-existent route (404) ────────────────────────────────
curl -s http://localhost:8000/does-not-exist | jq

# ─── Check response headers ──────────────────────────────────
curl -si http://localhost:8000/health
# Look for:
#   X-Request-Id: <unique id>
#   X-Response-Time: 0.42ms

# ─── Auth endpoints ──────────────────────────────────────────
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret"}' | jq

curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret"}' | jq
```

### Verifying the Pipeline

```ts
// In your server.ts after boot
console.table(app.inspect()); // see middleware order
console.table(app.inspectVersioned()); // see versioned routes
console.table(app.inspectPlugins()); // see installed plugins
console.log('Phase:', app.getPhase()); // should be 'ready' after boot
console.log('Size:', app.size); // number of registered middleware
console.log('Has auth?', app.hasPlugin('orbit-auth')); // true/false
```
