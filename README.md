# @codexa/core

[![JSR](https://jsr.io/badges/@codexa/core)](https://jsr.io/@codexa/core)
[![JSR Score](https://jsr.io/badges/@codexa/core/score)](https://jsr.io/@codexa/core)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A modular, enterprise-grade toolkit for building scalable Deno applications.
Import only what you need via subpath exports — no bloated bundles.

## Installation

```sh
# Deno
deno add jsr:@codexa/core

# Node.js / Bun
npx jsr add @codexa/core
```

## Submodules at a Glance

| Import path                | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `@codexa/core/config`      | Connection factories + env loader                      |
| `@codexa/core/http`        | HTTP server framework (CodexaHttp, routing, plugins)   |
| `@codexa/core/bus`         | Type-safe event bus — local + Redis distributed mode   |
| `@codexa/core/store`       | Unified KV store (memory / Redis / Deno KV)            |
| `@codexa/core/cache`       | Namespaced cache with tag-based invalidation           |
| `@codexa/core/storage`     | File/asset storage manager (pluggable adapters)        |
| `@codexa/core/logger`      | Structured logger with levels and file transport       |
| `@codexa/core/zod`         | Zod v4 re-exports + type helpers                       |

---

## `@codexa/core/config`

Connection factories and an environment loader. The package never reads env vars on its own — you own the configuration.

```ts
import {
  env,
  createMongoDatabase,
  createRedisConnection,
  buildStorageConfig,
} from '@codexa/core/config';

// 1. Load & validate .env file
await env.loadEnv();

// 2. MongoDB
const db = createMongoDatabase(
  Deno.env.get('MONGODB_URI')!,
  'myapp',                        // database name
  { minPoolSize: 2, maxPoolSize: 10 },
);
await db.connect();
const col = db.getDb().collection('users');

// 3. Redis
const redis = createRedisConnection({
  url: Deno.env.get('REDIS_URL'),  // OR use host/port/password/db fields
  keyPrefix: 'myapp::',
});
await redis.connect();
const client = redis.getClient();
await client.set('hello', 'world', 'EX', 60);

// 4. Storage config (reads STORAGE_PROVIDER + provider-specific vars)
const storageCfg = buildStorageConfig(Deno.env.toObject());
```

### `env` helpers

```ts
env.get('PORT')          // typed value from validated config
env.list('ALLOWED_IPS')  // comma-separated → string[]
env.number('TIMEOUT', 5000)
env.enabled('FEATURE_FLAG')
env.isDevelopment()      // NODE_ENV === 'development'
env.isProduction()
```

---

## `@codexa/core/http`

A structured HTTP server built on [Oak](https://jsr.io/@oak/oak). Features priority-ordered middleware, versioned routing, plugin system, and lifecycle management.

```ts
import { CodexaHttp, MiddlewarePriority } from '@codexa/core/http';
import { Router } from '@oak/oak';

const app = new CodexaHttp({ name: 'MyApp' });

// ── Middleware ────────────────────────────────────────────────
app.use(loggerMiddleware, { name: 'logger', priority: MiddlewarePriority.PRE_SETUP });
app.use(authMiddleware,   { name: 'auth',   priority: MiddlewarePriority.AUTH });

// ── HTTP shortcuts ────────────────────────────────────────────
app.get('/health', (ctx) => { ctx.response.body = { ok: true }; });
app.post('/users', createUserHandler);

// ── Oak Router ────────────────────────────────────────────────
const userRouter = new Router();
userRouter.get('/:id', getUserHandler);
app.router('/users', userRouter);

// ── Versioned routing (X-Version header) ─────────────────────
app.version('2').get('/users', usersV2Handler);
app.version('2').router('/orders', ordersV2Router);

// ── Runtime tag controls ──────────────────────────────────────
app.use(maintenancePage, { name: 'maintenance', tags: ['maintenance'], enabled: false });
app.enableByTags('maintenance');   // enable at runtime
app.disableByTags('maintenance');  // disable at runtime

// ── Lifecycle ─────────────────────────────────────────────────
app.onShutdown(async () => { await db.disconnect(); });
await app.boot();
await app.listen({ port: 8080 });
```

### Plugin System

```ts
import type { OrbitPlugin, IPluginScope } from '@codexa/core/http';

const authPlugin: OrbitPlugin = {
  name: 'auth',
  version: '1.0.0',
  metadata: { description: 'JWT auth', license: 'GPL-3.0' },
  async install(scope: IPluginScope, ctx) {
    const db = ctx.db as Db;
    scope.use(jwtMiddleware, { priority: MiddlewarePriority.AUTH });
    scope.get('/auth/me', profileHandler);
    scope.exposeService('verifyToken', verifyToken);
  },
};

await app.install(authPlugin, { db: db.getDb() });
```

### State injection (`provide`)

```ts
app.get('/admin', adminHandler, {
  provide: { role: 'admin' },   // injected into ctx.state.role
  onSuccess: (ctx) => log.info('Admin hit', ctx.state.requestId),
  onError: (ctx, err) => sendInternalError(ctx),
});
```

---

## `@codexa/core/bus`

In-process event bus. Optionally connects to Redis for cross-process pub/sub.

```ts
import { eventBus } from '@codexa/core/bus';

// ── Local-only (no Redis needed) ──────────────────────────────
await eventBus.initialize({});

eventBus.on('orders', 'created', async (data) => {
  console.log('New order:', data);
});

eventBus.emit('orders', 'created', { id: 'ord_123', total: 99.99 });

// ── One-time listener ─────────────────────────────────────────
eventBus.once('users', 'registered', sendWelcomeEmail);

// ── Remove listener ───────────────────────────────────────────
eventBus.off('orders', 'created', myHandler);  // specific handler
eventBus.off('orders');                         // entire channel
eventBus.off();                                 // everything
```

### Distributed mode (Redis)

```ts
import { createRedisConnection } from '@codexa/core/config';

const redis = createRedisConnection({ url: Deno.env.get('REDIS_URL') });
await redis.connect();

await eventBus.initialize({
  redisClient: redis.getClient(),
  subscribeChannels: ['orders', 'users'],  // subscribe on startup
});

// Publish to all processes
eventBus.emit('orders', 'created', payload, { distributed: true });
```

---

## `@codexa/core/store`

Unified key-value store. Backends: `memory` (default), `redis`, `kv` (Deno KV).

```ts
import { initializeStore, store } from '@codexa/core/store';

// Memory (default — no config needed)
await initializeStore({ mode: 'memory' });

// Redis
await initializeStore({ mode: 'redis', redisClient: redis.getClient() });

// Deno KV
await initializeStore({ mode: 'kv', kvPath: './data/store.db' });
```

### Store operations

```ts
await store.set('session:abc', { userId: '123' }, { ttl: 1800 });
const session = await store.get<Session>('session:abc');

await store.del('session:abc');
await store.exists('session:abc');   // → 0 | 1
await store.expire('session:abc', 600);
await store.ttl('session:abc');      // → seconds remaining

// Counters
await store.incr('views:post:1');
await store.incrby('credits:user:1', 50);

// Bulk helpers
await store.mset({ 'k1': 'v1', 'k2': 'v2' }, { ttl: 60 });
const map = await store.mget(['k1', 'k2']);  // → Map<string, T|null>

// Cache-aside
const user = await store.getOrSet('user:1', () => fetchUser('1'), { ttl: 300 });

// Pattern delete
await store.delPattern('session:*');
```

---

## `@codexa/core/cache`

Namespaced cache with tag-based invalidation, built on top of the store.

```ts
import { createCache, cache } from '@codexa/core/cache';

// Named namespace (recommended — avoids key collisions)
const userCache = createCache('users', { defaultTtl: 600 });

await userCache.set('u123', userData, { ttl: 300, tags: ['user:u123', 'tenant:t1'] });
const user = await userCache.get<User>('u123');
await userCache.has('u123');  // → boolean

// Cache-aside
const user = await userCache.getOrSet('u123', () => db.findUser('u123'), { ttl: 600 });

// Tag-based invalidation
await userCache.invalidateTag('user:u123');   // delete all keys tagged with this
await userCache.invalidateTags(['tenant:t1']); // bulk invalidate

await userCache.del('u123');    // delete one key
await userCache.flush();        // clear entire namespace

// Quick global cache (for one-offs)
await cache.set('config', appConfig, { ttl: 3600 });
```

---

## `@codexa/core/storage`

Pluggable file storage. Implement `StorageProvider` and pass it to the factory.

```ts
import { createStorageManager } from '@codexa/core/storage';
import { buildStorageConfig } from '@codexa/core/config';

const cfg = buildStorageConfig(Deno.env.toObject());

// Bring your own adapter — implement StorageProvider
const storage = createStorageManager(cfg, myS3Adapter);

const result = await storage.upload(fileBytes, {
  folder: 'avatars',
  fileName: 'user-123.webp',
  contentType: 'image/webp',
  tags: ['avatar', 'user:123'],
});
console.log(result.url);

await storage.delete(result.key);
const exists = await storage.exists(result.key);
const signed = await storage.getSignedUrl(result.key, 3600);
```

### Implementing `StorageProvider`

```ts
import type { StorageProvider, UploadOptions, UploadResult } from '@codexa/core/storage';

const myAdapter: StorageProvider = {
  async upload(file, options): Promise<UploadResult> { /* ... */ },
  async delete(key): Promise<void> { /* ... */ },
  async exists(key): Promise<boolean> { /* ... */ },
  async getSignedUrl(key, expiresIn): Promise<string> { /* ... */ },
};
```

---

## `@codexa/core/logger`

Structured logger — pretty in development, JSON in production.

```ts
import { createLogger } from '@codexa/core/logger';

const log = createLogger('Auth');

log.debug('Starting token validation');
log.info('User signed in', { userId: 'u123', ip: '1.2.3.4' });
log.warn('Rate limit approaching', { current: 95, limit: 100 });
log.error('DB query failed', new Error('Connection timeout'));
log.fatal('Unrecoverable state — shutting down');

// Child logger (scoped module name)
const tokenLog = log.child('JWT');
tokenLog.info('Token verified');  // prints [Auth:JWT]
```

Auto-reads from env: `LOG_LEVEL` (default `debug`), `LOG_DIR`, `LOG_FILE_ENABLED`, `LOG_MAX_FILE_SIZE`, `LOG_MAX_FILES`.

---

## `@codexa/core/zod`

Re-exports Zod v4 (`@zod/zod`) under the `zod` name plus useful type helpers.

```ts
import { zod, ZodInfer, ZodInput, ZodOutput } from '@codexa/core/zod';

const UserSchema = zod.object({
  name:  zod.string().min(1),
  email: zod.email(),
  age:   zod.number().int().min(0).optional(),
});

type User      = ZodInfer<typeof UserSchema>;   // output type
type UserInput = ZodInput<typeof UserSchema>;   // input type (before coerce/defaults)
```

---

## Utilities (exported from `@codexa/core`)

The root entry re-exports all utilities:

```ts
import {
  // Crypto
  hashPassword, verifyPassword,   // PBKDF2-SHA256 (no native addons)
  generateId,                      // crypto.randomUUID()
  randomBytes, randomBytesRaw,
  generateOtp,
  base32Encode, base32Decode,
  toBase64Url, fromBase64Url,
  timingSafeEqual,
  blake2bDigest,

  // Hash (Web Crypto API)
  createHash, sha256, sha512,
  hmacHex, hmacSha256, hmacSha1,

  // Device
  parseDevice, formatDeviceShort,

  // Response builders
  createSuccessResponse, createErrorResponse, createPaginatedResponse,
  buildPaginationMeta,
  // Oak context senders
  sendOk, sendCreated, sendNoContent,
  sendBadRequest, sendUnauthorized, sendForbidden,
  sendNotFound, sendConflict, sendValidationError, sendInternalError,

  // TTL
  parseTtlToSeconds, parseTtlToMs, ttlToDate,

  // Query params
  parseQueryParams,
} from '@codexa/core';
```

---

## Environment Variables

All variables `@codexa/core` reads. Copy `env.example.txt` as a starting point.

| Variable               | Used by              | Default          |
| ---------------------- | -------------------- | ---------------- |
| `NODE_ENV`             | everywhere           | `development`    |
| `PORT`                 | http / env           | `8080`           |
| `LOG_LEVEL`            | logger               | `debug`          |
| `LOG_FILE_ENABLED`     | logger               | `false`          |
| `LOG_DIR`              | logger               | `./logs`         |
| `CACHE_TTL`            | cache                | `300`            |
| `CACHE_PREFIX`         | cache                | `codexa_cache::` |
| `STORE_MODE`           | store                | `memory`         |
| `REDIS_URL`            | store=redis, bus     | —                |
| `REDIS_HOST/PORT`      | store=redis, bus     | `localhost:6379` |
| `DENO_KV_PATH`         | store=kv             | Deno Deploy KV   |
| `STORAGE_PROVIDER`     | storage              | `local`          |
| `S3_*`                 | storage=s3           | —                |
| `CLOUDINARY_*`         | storage=cloudinary   | —                |
| `IMAGEKIT_*`           | storage=imagekit     | —                |
| `LOCAL_STORAGE_DIR`    | storage=local        | `./uploads`      |

---

## License

[GPL v3](./LICENSE) © [Codexa-by-HQ](https://github.com/Codexa-by-HQ)
