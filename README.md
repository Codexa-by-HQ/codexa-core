# @codexa/core

> A modular, enterprise-grade toolkit for building scalable Deno applications.

[![JSR](https://jsr.io/badges/@codexa/core)](https://jsr.io/@codexa/core)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**`@codexa/core`** provides everything you need to build production-ready Deno backends — HTTP framework, event bus, unified store, caching, storage adapters, type-safe environment config, MongoDB, Redis, cryptography, and more. Each module is available as a standalone subpath import for optimal tree-shaking.

---

## Table of Contents

- [Installation](#installation)
- [Subpath Imports](#subpath-imports)
- [Quick Start](#quick-start)
- [Modules](#modules)
  - [HTTP Framework](#http-framework-codexacorehttp)
  - [Environment Config](#environment-config-codexacoreconfig)
  - [MongoDB](#mongodb-codexacoreconfig)
  - [Redis](#redis-codexacoreconfig)
  - [Event Bus](#event-bus-codexacorebus)
  - [Store](#store-codexacorestore)
  - [Cache](#cache-codexacorecache)
  - [Storage](#storage-codexacorestorage)
  - [Logger](#logger-codexacorelogger)
  - [Crypto](#crypto-codexacorecrypto)
  - [Hash](#hash-codexacorehash)
  - [Zod](#zod-codexacorezod)
  - [Device](#device-codexacoredevice)
  - [TTL](#ttl-codexacorettl)
  - [Response](#response-codexacoreresponse)
  - [Query](#query-codexacorequery)
- [Full Example](#full-example)
- [Plugin System](#plugin-system)
- [Author & Organization](#author--organization)
- [License](#license)

---

## Installation

```ts
// deno.json
{
  "imports": {
    "@codexa/core": "jsr:@codexa/core"
  }
}
```

Or install directly:

```bash
deno add jsr:@codexa/core
```

---

## Subpath Imports

Every module is available via a dedicated subpath — **import only what you need**:

```ts
import { CodexaHttp, Router }   from '@codexa/core/http';
import { env, createMongoDatabase, createRedisConnection, buildStorageConfig } from '@codexa/core/config';
import { eventBus }             from '@codexa/core/bus';
import { initializeStore, store } from '@codexa/core/store';
import { createCache }          from '@codexa/core/cache';
import { createStorageManager } from '@codexa/core/storage';
import { createLogger }         from '@codexa/core/logger';
import { zod }                  from '@codexa/core/zod';
import { generateId, hashPassword, verifyPassword } from '@codexa/core/crypto';
import { sha256, hmacSha256 }   from '@codexa/core/hash';
import { parseDevice }          from '@codexa/core/device';
import { parseTtlToSeconds }    from '@codexa/core/ttl';
import { sendSuccess, sendError } from '@codexa/core/response';
import { parseQueryParams }     from '@codexa/core/query';
```

| Subpath | Description |
|---|---|
| `@codexa/core/http` | HTTP framework (Oak-based), middleware pipeline, plugin system |
| `@codexa/core/config` | Environment, MongoDB, Redis, Storage configuration factories |
| `@codexa/core/bus` | Event bus (local + distributed via Redis Pub/Sub) |
| `@codexa/core/store` | Unified key-value store (memory, Redis, Deno KV) |
| `@codexa/core/cache` | Namespaced caching layer with tag invalidation |
| `@codexa/core/storage` | Unified storage manager (S3, Cloudinary, ImageKit, Local) |
| `@codexa/core/logger` | Structured, leveled logger with file rotation |
| `@codexa/core/zod` | Re-exported Zod for schema validation |
| `@codexa/core/crypto` | ID generation, password hashing (PBKDF2-SHA256), base32/64 encoding |
| `@codexa/core/hash` | SHA-1/256/384/512, HMAC utilities, AWS Signature V4 helpers |
| `@codexa/core/device` | User-Agent parsing via ua-parser-js |
| `@codexa/core/ttl` | TTL string parsing (`"1h"` → `3600`) |
| `@codexa/core/response` | Standardized API response helpers |
| `@codexa/core/query` | Query string parsing via `qs` |

---

## Quick Start

```ts
import { CodexaHttp, Router } from '@codexa/core/http';
import { env } from '@codexa/core/config';
import { zod } from '@codexa/core/zod';

// 1. Load & validate environment
await env.loadEnv({
  paths: ['.env', '.env.local'],
  schema: zod.object({
    PORT: zod.coerce.number().default(8000),
    NODE_ENV: zod.enum(['development', 'production', 'test']).default('development'),
  }).passthrough(),
});

// 2. Create HTTP app
const app = new CodexaHttp({ name: 'MyAPI' });

// 3. Register a router
const usersRouter = new Router();
usersRouter.get('/', (ctx) => {
  ctx.response.body = { users: [] };
});

app.router('/api/users', usersRouter);

// 4. Health check
app.get('/health', (ctx) => {
  ctx.response.body = { status: 'ok', phase: app.getPhase() };
});

// 5. Boot & listen
await app.boot();
await app.listen({ port: env.get<number>('PORT') });
```

---

## Modules

### HTTP Framework (`@codexa/core/http`)

A priority-sorted, lifecycle-managed middleware pipeline built on [Oak](https://jsr.io/@oak/oak) with an enterprise plugin system.

> **No need to install `@oak/oak` separately** — `Router` is re-exported from `@codexa/core/http`.

#### Creating an App

```ts
import { CodexaHttp, Router, MiddlewarePriority } from '@codexa/core/http';

const app = new CodexaHttp({ name: 'UserService' });
```

Each `new CodexaHttp()` creates a **completely isolated instance** with its own middleware pipeline, plugins, and lifecycle:

```ts
const publicApi = new CodexaHttp({ name: 'PublicAPI' });
const adminApi  = new CodexaHttp({ name: 'AdminAPI' });
// Completely isolated — separate routes, plugins, state
```

#### Middleware Registration

```ts
// Simple middleware
app.use(async (ctx, next) => {
  console.log(`${ctx.request.method} ${ctx.request.url.pathname}`);
  await next();
});

// With options
app.use(corsMiddleware(), {
  name: 'cors',
  priority: MiddlewarePriority.CRITICAL,
  tags: ['security'],
});

// With context injection
app.use(tenantResolver, {
  name: 'tenant',
  priority: MiddlewarePriority.AUTH,
  provide: { tenantId: 'default' },
});

// With lifecycle hooks
app.use(authParser, {
  name: 'auth',
  priority: MiddlewarePriority.AUTH,
  onSuccess: (ctx) => console.log('Auth OK:', ctx.state.userId),
  onError: (ctx, err) => console.error('Auth failed:', err),
});
```

#### Routers

```ts
const usersRouter = new Router();
usersRouter.get('/', listUsers);
usersRouter.post('/', createUser);
usersRouter.get('/:id', getUser);
usersRouter.put('/:id', updateUser);
usersRouter.delete('/:id', deleteUser);

app.router('/api/users', usersRouter);
```

#### HTTP Shortcuts

```ts
app.get('/health', async (ctx) => {
  ctx.response.body = { status: 'ok' };
});

app.post('/api/webhook', async (ctx) => {
  const body = await ctx.request.body.json();
  ctx.response.body = { received: true };
});
```

#### Middleware Groups

```ts
app.group('auth', [authParser, sessionHydrator], {
  priority: MiddlewarePriority.AUTH,
  tags: ['authentication'],
});
```

#### Conditional & Safe Middleware

```ts
// Only run in production
app.useIf(
  () => env.isProduction(),
  rateLimiter,
  { name: 'rate-limit', priority: MiddlewarePriority.SECURITY },
);

// Catches errors without crashing the server
app.useSafe(riskyExternalCall, {
  name: 'external-api',
  onError: (ctx, err) => {
    ctx.response.status = 502;
    ctx.response.body = { success: false, error: 'Service unavailable' };
  },
});
```

#### Versioned Routes

```ts
app.version('1.0.0').get('/api/users', listUsersV1);
app.version('2.0.0').get('/api/users', listUsersV2);

// Client sends: curl -H "X-Version: 1.0.0" http://localhost:8000/api/users
```

#### Tag Controls (Runtime Enable/Disable)

```ts
app.use(debugLogger, { name: 'debug', tags: ['debug'] });
app.use(featureXHandler, { name: 'feature-x', tags: ['beta'], enabled: false });

// Toggle at runtime
app.enableByTags('beta');    // turn on beta features
app.disableByTags('debug');  // turn off debug logging
console.table(app.inspectByTags('beta'));
```

#### Lifecycle

```ts
idle → booting → ready → listening → shutting_down → stopped
```

```ts
const app = new CodexaHttp({ name: 'MyAPI' });

// Register everything before boot
app.use(cors());
app.router('/api/users', usersRouter);

// Shutdown hooks (run in reverse order)
app.onShutdown(() => db.disconnect());
app.onShutdown(() => redis.disconnect());

// Boot commits the pipeline — no more registrations after this
await app.boot(async () => {
  await db.connect();
  await redis.connect();
});

await app.listen({ port: 8000, host: '0.0.0.0' });
```

#### Priority System

| Priority | Value | Use Case |
|---|---|---|
| `PRE_SETUP` | 0 | CORS, helmet, body parsing |
| `CRITICAL` | 1 | Critical custom middleware |
| `AUTH` | 20 | Auth parsing, token validation |
| `SECURITY` | 30 | RBAC, ABAC, permissions |
| `BUSINESS` | 40 | Controllers (default) |
| `FALLBACK` | 50 | 404 handler |

#### Built-in Middleware (automatic)

- **Error Boundary** — outermost try/catch, returns structured 500 JSON, emits `oak:request:error`
- **Request Lifecycle** — generates `requestId`, records timing, sets `X-Request-Id` / `X-Response-Time` headers, logs morgan-style HTTP lines
- **Not-Found Handler** — returns structured 404 JSON for unmatched routes

#### Introspection

```ts
console.table(app.inspect());          // middleware pipeline
console.table(app.inspectVersioned()); // versioned routes
console.table(app.inspectPlugins());   // installed plugins
console.log(app.getPhase());           // 'idle' | 'ready' | 'listening' | ...
console.log(app.size);                 // number of middleware entries
```

---

### Environment Config (`@codexa/core/config`)

Flexible environment management — **you** define the schema, we load and validate.

```ts
import { env } from '@codexa/core/config';
import { zod } from '@codexa/core/zod';

await env.loadEnv({
  // Load multiple .env files (merged left-to-right, system env wins)
  paths: ['.env', '.env.local', '.env.production'],

  // YOUR schema — define exactly what your app needs
  schema: zod.object({
    PORT: zod.coerce.number().default(8080),
    NODE_ENV: zod.enum(['development', 'production', 'test']).default('development'),
    MONGODB_URI: zod.string().url(),
    MONGODB_DATABASE: zod.string(),
    REDIS_URL: zod.string().optional(),
    JWT_SECRET: zod.string().min(32),
    JWT_EXPIRY: zod.string().default('7d'),
    STORAGE_PROVIDER: zod.enum(['s3', 'cloudinary', 'imagekit', 'local']).default('local'),
  }).passthrough(),
});

// Typed access
const port = env.get<number>('PORT');        // number
const dbUri = env.get('MONGODB_URI');        // string

// Utility helpers
env.isDevelopment();                          // boolean
env.isProduction();                           // boolean
env.enabled('FEATURE_FLAG');                  // true/false from "true"/"1"/"yes"/"on"
env.number('CACHE_TTL', 300);                // number with fallback
env.list('ALLOWED_ORIGINS');                  // "a,b,c" → ["a", "b", "c"]
```

**No .env files needed** — use system env only:

```ts
await env.loadEnv({ loadFiles: false, schema: mySchema });
```

**No schema needed** — raw mode:

```ts
await env.loadEnv();  // loads .env, no validation
const val = env.get('MY_VAR');  // string
```

---

### MongoDB (`@codexa/core/config`)

```ts
import { createMongoDatabase } from '@codexa/core/config';

// Standalone (default) — no replica set required
const mongo = createMongoDatabase('mongodb://localhost:27017', 'myapp');
const db = await mongo.connect();
// ⚠️ Warning: transactions are NOT available in standalone mode

// Replica Set — enforced, throws if not a replica set
const mongo = createMongoDatabase(
  'mongodb://localhost:27017/myapp?replicaSet=rs0',
  'myapp',
  { replicaSet: true },
);
const db = await mongo.connect();
console.log(mongo.supportsTransactions()); // true
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `replicaSet` | `false` | Require replica set (throws if standalone) |
| `minPoolSize` | `5` | Minimum connection pool size |
| `maxPoolSize` | `20` | Maximum connection pool size |
| `serverSelectionTimeoutMS` | `10000` | Server selection timeout |
| `socketTimeoutMS` | `45000` | Socket timeout |
| `connectTimeoutMS` | `10000` | Connection timeout |
| `clientOptions` | `{}` | Extra `MongoClientOptions` for the driver |

**Connection interface:**

```ts
mongo.connect()              // → Promise<Db>
mongo.disconnect()           // → Promise<void>
mongo.getDb()                // → Db (throws if not connected)
mongo.getClient()            // → MongoClient
mongo.supportsTransactions() // → boolean
```

---

### Redis (`@codexa/core/config`)

```ts
import { createRedisConnection } from '@codexa/core/config';

// Basic connection (URL)
const redis = createRedisConnection({
  url: 'redis://localhost:6379',
});
await redis.connect();
const client = redis.getClient();
await client.set('hello', 'world');

// Individual fields
const redis = createRedisConnection({
  host: 'redis.example.com',
  port: 6379,
  password: 'my-password',
  db: 0,
  keyPrefix: 'myapp::',
});
```

**With Pub/Sub:**

```ts
const redis = createRedisConnection({
  url: 'redis://localhost:6379',
  enablePubSub: true,
});
await redis.connect();

// Subscriber client (dedicated connection, required by Redis for sub)
const sub = redis.getSubscriber();
sub.on('message', (channel: string, message: string) => {
  console.log(`[${channel}] ${message}`);
});
await sub.subscribe('events');

// Publish via main client
redis.getClient().publish('events', JSON.stringify({ type: 'user.created' }));
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `url` | — | Full Redis URL (takes priority) |
| `host` | `'localhost'` | Redis host |
| `port` | `6379` | Redis port |
| `password` | — | Redis password |
| `db` | `0` | Redis database index |
| `keyPrefix` | `'codexa::'` | Key prefix for all commands |
| `connectTimeoutMS` | `10000` | Connection timeout |
| `maxRetries` | `5` | Max retry attempts |
| `enablePubSub` | `false` | Create dedicated subscriber client |

**Connection interface:**

```ts
redis.connect()               // → Promise<RedisClient>
redis.disconnect()            // → Promise<void>
redis.getClient()             // → RedisClient (throws if not connected)
redis.isReady()               // → boolean
redis.getSubscriber()         // → RedisClient (throws if pub/sub not enabled)
redis.createSubscriberClient() // → Promise<RedisClient> (additional sub client)
```

---

### Event Bus (`@codexa/core/bus`)

Type-safe event bus with local and distributed (Redis Pub/Sub) modes.

```ts
import { eventBus } from '@codexa/core/bus';

// Local-only mode
await eventBus.initialize({});

// Distributed mode (with Redis)
await eventBus.initialize({
  redisClient: redis.getClient(),
  subscribeChannels: ['orders', 'users', 'notifications'],
});

// Subscribe to events
eventBus.on('orders', 'created', (data) => {
  console.log('New order:', data);
});

eventBus.once('system', 'startup', (data) => {
  console.log('System started (fires once)');
});

// Emit events (local)
eventBus.emit('orders', 'created', {
  id: 'ord-123',
  total: 99.99,
  customer: 'alice',
});

// Emit distributed (requires Redis)
eventBus.emit('notifications', 'send', { to: 'bob', msg: 'Hello!' }, {
  distributed: true,
});

// Unsubscribe
eventBus.off('orders', 'created');

// List active event subscriptions
console.log(eventBus.listActiveEvents());

// Cleanup
await eventBus.destroy();
```

---

### Store (`@codexa/core/store`)

Unified key-value store with three backends:

```ts
import { initializeStore, store, closeStore } from '@codexa/core/store';

// Memory (default — no dependencies)
await initializeStore({ mode: 'memory' });

// Redis
await initializeStore({ mode: 'redis', redisClient: redis.getClient() });

// Deno KV
await initializeStore({ mode: 'kv', kvPath: './data/kv.db' });
```

**CRUD operations:**

```ts
// Set with TTL
await store.set('session:abc', { userId: '123', role: 'admin' }, { ttl: 1800 });

// Get (typed)
const session = await store.get<{ userId: string; role: string }>('session:abc');

// Exists / Delete
await store.exists('session:abc');  // 1
await store.del('session:abc');     // 1

// Counters
await store.set('views', 0);
await store.incr('views');      // 1
await store.incrby('views', 5); // 6
await store.decr('views');      // 5

// TTL management
await store.expire('key', 60); // set/reset TTL
await store.ttl('key');        // remaining seconds

// Pattern matching
const keys = await store.keys('session:*');

// Cleanup
closeStore();
```

---

### Cache (`@codexa/core/cache`)

Namespaced caching layer with tag-based invalidation, built on top of Store.

```ts
import { initializeStore } from '@codexa/core/store';
import { createCache } from '@codexa/core/cache';

await initializeStore({ mode: 'memory' });

// Create namespaced caches
const userCache = createCache('users', { defaultTtl: 600 });
const productCache = createCache('products', { defaultTtl: 3600 });

// Set with tags
await userCache.set('user:123', userData, {
  ttl: 600,
  tags: ['user:123', 'team:engineering'],
});

// Get
const user = await userCache.get<User>('user:123');

// Cache-aside pattern (getOrSet)
const profile = await userCache.getOrSet(
  'profile:123',
  async () => {
    // Only called if not in cache
    return await fetchUserProfile('123');
  },
  { ttl: 300, tags: ['user:123'] },
);

// Tag-based invalidation
await userCache.invalidateTag('user:123');
// All entries tagged with 'user:123' are now gone

// Flush entire namespace
await userCache.flush();
```

---

### Storage (`@codexa/core/storage`)

Unified storage layer with four providers — **S3**, **Cloudinary**, **ImageKit**, and **Local filesystem**.

```ts
import { buildStorageConfig } from '@codexa/core/config';
import { createStorageManager } from '@codexa/core/storage';

// Build config from environment variables
const storageConfig = buildStorageConfig(Deno.env.toObject());

// Create storage manager (auto-resolves provider from config)
const storage = createStorageManager(storageConfig);
```

**Supported providers:**

| Provider | `STORAGE_PROVIDER` | Capabilities |
|---|---|---|
| **S3** (AWS, R2, MinIO, B2) | `s3` | Upload, delete, exists, presigned URLs, CDN |
| **Cloudinary** | `cloudinary` | Upload, delete, exists, signed URLs, transformations, direct upload |
| **ImageKit** | `imagekit` | Upload, delete, exists, signed URLs, transformations, direct upload |
| **Local** | `local` | Upload, delete, exists (dev/test only) |

**Server-side upload:**

```ts
// Single file
const result = await storage.upload(fileBytes, {
  folder: 'avatars',
  contentType: 'image/jpeg',
  assetType: 'image',
});
console.log(result.url);  // public URL
console.log(result.key);  // storage key for future operations

// Multiple files (concurrent)
const results = await storage.upload([imgBytes, pdfBytes], [
  { folder: 'images', contentType: 'image/png', assetType: 'image' },
  { folder: 'docs', contentType: 'application/pdf', assetType: 'document' },
]) as UploadResult[];
```

**Client-side direct upload (recommended for large files):**

```ts
// Server endpoint — generates signed credentials
app.post('/upload-token', async (ctx) => {
  const { folder, contentType, assetType } = await ctx.request.body.json();
  const token = await storage.getSignedUploadUrl({
    folder,
    contentType,
    assetType,
    expiresIn: 1800,  // 30 minutes
  });
  ctx.response.body = token;
  // Returns: { uploadUrl, method, fields?, key, expiresAt, publicUrl? }
});

// Browser client — uploads directly to provider
const token = await fetch('/upload-token', { method: 'POST', ... }).then(r => r.json());
// For Cloudinary/ImageKit (multipart POST):
const form = new FormData();
Object.entries(token.fields).forEach(([k, v]) => form.append(k, v));
form.append('file', fileInput.files[0]);
await fetch(token.uploadUrl, { method: 'POST', body: form });

// For S3 (raw PUT):
await fetch(token.uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: fileInput.files[0],
});
```

**Other operations:**

```ts
// Delete
await storage.delete(result.key);

// Check existence
const exists = await storage.exists(result.key);

// Signed delivery URL (private assets, time-limited)
const url = await storage.getSignedUrl(result.key, 3600);

// On-the-fly transformation URL (Cloudinary/ImageKit only)
const thumb = storage.getTransformedUrl(result.key, {
  width: 200, height: 200, crop: 'fill', format: 'webp',
});
```

**Environment variables by provider:**

```env
# S3 / S3-compatible
STORAGE_PROVIDER=s3
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY=AKIA...
S3_SECRET_KEY=wJal...
S3_ENDPOINT=https://account.r2.cloudflarestorage.com  # optional (R2, MinIO, etc.)
S3_CDN_BASE_URL=https://cdn.example.com               # optional

# Cloudinary
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=mycloud
CLOUDINARY_API_KEY=123456789
CLOUDINARY_API_SECRET=abcdef...

# ImageKit
STORAGE_PROVIDER=imagekit
IMAGEKIT_PUBLIC_KEY=public_abc...
IMAGEKIT_PRIVATE_KEY=private_xyz...
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/myid

# Local (dev/test only)
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=./uploads
LOCAL_BASE_URL=http://localhost:3000/uploads
```

---

### Logger (`@codexa/core/logger`)

```ts
import { createLogger } from '@codexa/core/logger';

const log = createLogger('OrderService');

log.debug('Processing order', { orderId: '123' });
log.info('Order created', { orderId: '123', total: 99.99 });
log.warn('Inventory low', { sku: 'WIDGET-01', remaining: 3 });
log.error('Payment failed', new Error('Card declined'));
log.fatal('Database connection lost');

// Child loggers
const paymentLog = log.child('Payment');
paymentLog.info('Processing payment...'); // [OrderService:Payment] Processing...
```

---

### Crypto (`@codexa/core/crypto`)

```ts
import { generateId, hashPassword, verifyPassword } from '@codexa/core/crypto';

// UUID-style ID generation
const id = generateId(); // "a1b2c3d4e5f67890..."

// Password hashing (PBKDF2-SHA256, Web Crypto API, no external deps)
const hashed = await hashPassword('MySecurePassword123!');
const isValid = await verifyPassword('MySecurePassword123!', hashed); // true
// Timing-safe comparison prevents timing attacks
```

---

### Hash (`@codexa/core/hash`)

```ts
import { sha256, sha512, hmacSha256, hmacSha1 } from '@codexa/core/hash';

const hash = await sha256('hello world');
const signature = await hmacSha256('payload', 'webhook-secret');
```

---

### Zod (`@codexa/core/zod`)

Re-exported [Zod](https://zod.dev) for schema validation:

```ts
import { zod } from '@codexa/core/zod';

const UserSchema = zod.object({
  name: zod.string().min(2),
  email: zod.string().email(),
  age: zod.number().min(0).optional(),
});

type User = zod.infer<typeof UserSchema>;
const result = UserSchema.safeParse(rawData);
```

---

### Device (`@codexa/core/device`)

```ts
import { parseDevice } from '@codexa/core/device';

const device = parseDevice(ctx.request.headers.get('user-agent') ?? '');
// { browser: 'Chrome', os: 'Windows', device: 'desktop', raw: '...' }
```

---

### TTL (`@codexa/core/ttl`)

```ts
import { parseTtlToSeconds } from '@codexa/core/ttl';

parseTtlToSeconds('1h');   // 3600
parseTtlToSeconds('30m');  // 1800
parseTtlToSeconds('7d');   // 604800
parseTtlToSeconds('90s');  // 90
parseTtlToSeconds(3600);   // 3600 (passthrough)
```

---

### Response (`@codexa/core/response`)

```ts
import { sendSuccess, sendError, sendNotFound, sendInternalError } from '@codexa/core/response';

// Standardized JSON responses
sendSuccess(ctx, { users: [] });
// → { success: true, data: { users: [] }, meta: { timestamp, requestId } }

sendError(ctx, 'Validation failed', 400, { field: 'email' });
// → { success: false, error: 'Validation failed', details: {...}, meta: {...} }

sendNotFound(ctx, 'User not found');
sendInternalError(ctx);
```

---

### Query (`@codexa/core/query`)

```ts
import { parseQueryParams } from '@codexa/core/query';

// Parses nested query strings via `qs`
const params = parseQueryParams(ctx.request.url.search);
// ?filters[status]=active&page=2 → { filters: { status: 'active' }, page: '2' }
```

---

## Full Example

```ts
// server.ts
import { CodexaHttp, Router, MiddlewarePriority } from '@codexa/core/http';
import { env, createMongoDatabase, createRedisConnection, buildStorageConfig } from '@codexa/core/config';
import { eventBus } from '@codexa/core/bus';
import { initializeStore } from '@codexa/core/store';
import { createCache } from '@codexa/core/cache';
import { createStorageManager } from '@codexa/core/storage';
import { zod } from '@codexa/core/zod';

// ── Environment ─────────────────────────────────────────────────
await env.loadEnv({
  paths: ['.env'],
  schema: zod.object({
    PORT: zod.coerce.number().default(8000),
    NODE_ENV: zod.enum(['development', 'production', 'test']).default('development'),
    MONGODB_URI: zod.string(),
    MONGODB_DATABASE: zod.string().default('myapp'),
    REDIS_URL: zod.string().optional(),
    STORAGE_PROVIDER: zod.enum(['s3', 'cloudinary', 'imagekit', 'local']).default('local'),
  }).passthrough(),
});

// ── Infrastructure ──────────────────────────────────────────────
const mongo = createMongoDatabase(
  env.get('MONGODB_URI'),
  env.get('MONGODB_DATABASE'),
);

const redis = createRedisConnection({
  url: env.get('REDIS_URL'),
  enablePubSub: true,
});

const storageConfig = buildStorageConfig(Deno.env.toObject());
const storage = createStorageManager(storageConfig);

// ── App ─────────────────────────────────────────────────────────
const app = new CodexaHttp({ name: 'MyAPI' });

// Routers
const usersRouter = new Router();
usersRouter.get('/', async (ctx) => {
  const db = mongo.getDb();
  const users = await db.collection('users').find().limit(20).toArray();
  ctx.response.body = { success: true, data: users };
});

const authRouter = new Router();
authRouter.post('/login', async (ctx) => {
  const body = await ctx.request.body.json();
  ctx.response.body = { success: true, token: '...' };
});

app.router('/api/users', usersRouter);
app.router('/api/auth', authRouter);

// Health check
app.get('/health', (ctx) => {
  ctx.response.body = {
    status: 'ok',
    phase: app.getPhase(),
    name: app.name,
  };
});

// Versioned routes
app.version('2.0.0').get('/api/users', async (ctx) => {
  ctx.response.body = { version: '2.0.0', users: [], pagination: {} };
});

// Shutdown hooks
app.onShutdown(() => mongo.disconnect());
app.onShutdown(() => redis.disconnect());
app.onShutdown(() => eventBus.destroy());

// ── Boot ────────────────────────────────────────────────────────
await app.boot(async () => {
  await mongo.connect();
  await redis.connect();
  await initializeStore({ mode: 'redis', redisClient: redis.getClient() });
  await eventBus.initialize({
    redisClient: redis.getClient(),
    subscribeChannels: ['orders', 'notifications'],
  });
});

console.table(app.inspect());
await app.listen({ port: env.get<number>('PORT') });
```

---

## Plugin System

Plugins get a sandboxed scope — they can register routes, middleware, and services, but **cannot** call `boot()`, `listen()`, or `shutdown()`:

```ts
import type { CodexaPlugin, IPluginScope } from '@codexa/core/http';

const authPlugin: CodexaPlugin<{ jwtSecret: string }> = {
  name: 'auth',
  version: '1.0.0',
  metadata: { license: 'MIT' },
  // dependsOn: ['db-plugin'], // optional dependency declaration

  install(scope, context, config) {
    const { jwtSecret } = config!;

    // Async init (runs during boot in dependency order)
    scope.init(async () => {
      // Load signing keys, warm caches, etc.
    });

    // Middleware — auto-tagged with 'auth'
    scope.use(async (ctx, next) => {
      const token = ctx.request.headers.get('authorization');
      // ... validate token ...
      await next();
    }, {
      name: 'tokenValidator',
      priority: 20,  // AUTH
      provide: { userId: '', role: '' },
    });

    // Services (accessible by sibling plugins)
    scope.exposeService('jwtSecret', jwtSecret);

    // Routes
    scope.get('/auth/me', async (ctx) => {
      ctx.response.body = { ok: true };
    });

    // Shutdown hook
    scope.onShutdown(async () => {
      // Cleanup plugin resources
    });
  },
};

// Install & boot
const app = new CodexaHttp({ name: 'MyAPI' });
await app.install(authPlugin, { db }, { jwtSecret: 'secret' });
await app.boot();
```

**Typed Plugin State** — augment `PluginStateMap` for full autocompletion:

```ts
declare module '@codexa/core/http' {
  interface PluginStateMap {
    auth: { userId: string; role: string; permissions: string[] };
  }
}

// Now fully typed everywhere:
// ctx.state.auth.userId   ✓ autocompletion
```

**Key guarantees:**
- All registrations are auto-tagged with the plugin name
- `provide` values are scoped under `ctx.state[pluginName]`
- Circular dependencies detected via Kahn's topological sort
- All lookups (plugin, service) are O(1)
- Plugins can be uninstalled: `await app.uninstall('auth')`

---

## Author & Organization

**`@codexa/core`** is built and maintained by **[Codexa-by-HQ](https://github.com/Codexa-by-HQ)**.

### Author

**Hamza Qureshi** — Founder & Owner of Codexa-by-HQ

- 🔗 **GitHub:** [Codexa-by-HQ](https://github.com/Codexa-by-HQ)
- 💼 **LinkedIn:** [Hamza Qureshi](https://www.linkedin.com/in/hamza-qureshi-871163245/)
- 📸 **Instagram:** [@hamza_qureshi_2906](https://www.instagram.com/hamza_qureshi_2906/?hl=en)
- 🌐 **GitHub Profile:** [Hamza-Qureshi09](https://github.com/Hamza-Qureshi09)

### Contributing

Contributions are welcome! Please follow the existing code style (tabs, single quotes, strict types) and ensure `deno check mod.ts` passes before submitting a PR.

### Publishing

This package is published to [JSR](https://jsr.io/@codexa/core) via the included GitHub Actions workflow. Tag a release with `v*` to trigger an automated publish:

```bash
git tag v0.0.4
git push origin v0.0.4
```

---

## License

[GPL-3.0-or-later](LICENSE)
