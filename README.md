# @codexa/core

> A modular, enterprise-grade toolkit for building scalable Deno applications.

[![JSR](https://jsr.io/badges/@codexa/core)](https://jsr.io/@codexa/core)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## Installation

```ts
// deno.json
{
  "imports": {
    "@codexa/core": "jsr:@codexa/core@^0.1.0"
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
import { env, createMongoDatabase, createRedisConnection } from '@codexa/core/config';
import { eventBus }             from '@codexa/core/bus';
import { initializeStore, store } from '@codexa/core/store';
import { createCache }          from '@codexa/core/cache';
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
| `@codexa/core/http` | HTTP framework (Oak-based), middleware pipeline, plugins |
| `@codexa/core/config` | Environment, MongoDB, Redis, Storage configuration |
| `@codexa/core/bus` | Event bus (local + distributed via Redis pub/sub) |
| `@codexa/core/store` | Unified key-value store (memory, Redis, Deno KV) |
| `@codexa/core/cache` | Namespaced caching layer with tag invalidation |
| `@codexa/core/logger` | Structured, leveled logger |
| `@codexa/core/zod` | Re-exported Zod for schema validation |
| `@codexa/core/crypto` | ID generation, password hashing (PBKDF2) |
| `@codexa/core/hash` | SHA-256/384/512, HMAC utilities |
| `@codexa/core/device` | User-Agent parsing |
| `@codexa/core/ttl` | TTL string parsing (`"1h"` → `3600`) |
| `@codexa/core/response` | Standardized API response helpers |
| `@codexa/core/query` | Query string parsing |

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

A priority-sorted, lifecycle-managed middleware pipeline built on [Oak](https://jsr.io/@oak/oak).

> **No need to install `@oak/oak` separately** — `Router` is re-exported from `@codexa/core/http`.

#### Creating an App

```ts
import { CodexaHttp, Router, MiddlewarePriority } from '@codexa/core/http';

const app = new CodexaHttp({ name: 'UserService' });
```

The `name` parameter identifies the app instance in logs. Each `new CodexaHttp()` creates a completely isolated instance with its own middleware pipeline, plugins, and lifecycle:

```ts
const app1 = new CodexaHttp({ name: 'PublicAPI' });
const app2 = new CodexaHttp({ name: 'AdminAPI' });
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
import { CodexaHttp, Router } from '@codexa/core/http';

const app = new CodexaHttp({ name: 'MyAPI' });

// Create routers (no need to install @oak/oak!)
const usersRouter = new Router();
usersRouter.get('/', listUsers);
usersRouter.post('/', createUser);
usersRouter.get('/:id', getUser);
usersRouter.put('/:id', updateUser);
usersRouter.delete('/:id', deleteUser);

const authRouter = new Router();
authRouter.post('/login', login);
authRouter.post('/register', register);

// Register with prefix
app.router('/api/users', usersRouter);
app.router('/api/auth', authRouter);
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

// Later: toggle at runtime
app.enableByTags('beta');    // turn on beta features
app.disableByTags('debug');  // turn off debug logging

console.table(app.inspectByTags('beta'));
```

#### Lifecycle

```ts
const app = new CodexaHttp({ name: 'MyAPI' });

// Register middleware before boot
app.use(cors());
app.router('/api/users', usersRouter);

// Shutdown hooks (run in reverse order)
app.onShutdown(() => db.disconnect());
app.onShutdown(() => redis.disconnect());

// Boot (commits pipeline, no more registrations after this)
await app.boot(async () => {
  await db.connect();
  await redis.connect();
});

// Listen
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

#### Plugin System

Plugins get a sandboxed scope — they can't call `boot()` or `shutdown()`:

```ts
import type { CodexaPlugin, IPluginScope } from '@codexa/core/http';

const authPlugin: CodexaPlugin<{ jwtSecret: string }> = {
  name: 'auth',
  version: '1.0.0',
  metadata: { license: 'MIT' },

  install(scope, context, config) {
    const { jwtSecret } = config!;

    scope.init(async () => {
      // Runs during boot in dependency order
    });

    scope.use(async (ctx, next) => {
      // Auth middleware — auto-tagged with 'auth'
      await next();
    }, {
      name: 'tokenValidator',
      priority: 20, // AUTH
      provide: { userId: '', role: '' },
    });

    scope.exposeService('jwtSecret', jwtSecret);
  },
};

// Install & boot
const app = new CodexaHttp({ name: 'MyAPI' });
await app.install(authPlugin, { db }, { jwtSecret: 'secret' });
await app.boot();
```

**Typed Plugin State** — augment `PluginStateMap` in your project:

```ts
declare module '@codexa/core/http' {
  interface PluginStateMap {
    auth: { userId: string; role: string; permissions: string[] };
  }
}

// Now fully typed everywhere:
// ctx.state.auth.userId   ✓ autocompletion works
```

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
    // App
    PORT: zod.coerce.number().default(8080),
    NODE_ENV: zod.enum(['development', 'production', 'test']).default('development'),

    // Database
    MONGODB_URI: zod.string().url(),
    MONGODB_DATABASE: zod.string(),

    // Redis
    REDIS_URL: zod.string().optional(),

    // JWT
    JWT_SECRET: zod.string().min(32),
    JWT_EXPIRY: zod.string().default('7d'),

    // Storage
    STORAGE_PROVIDER: zod.enum(['s3', 'cloudinary', 'local']).default('local'),
    S3_BUCKET: zod.string().optional(),
    S3_REGION: zod.string().optional(),
    S3_ACCESS_KEY: zod.string().optional(),
    S3_SECRET_KEY: zod.string().optional(),
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

Type-safe event bus with local and distributed (Redis) modes.

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

// Emit events
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
const id = generateId(); // "a1b2c3d4-e5f6-7890-..."

// Password hashing (PBKDF2-SHA256, no external deps)
const hashed = await hashPassword('MySecurePassword123!');
const isValid = await verifyPassword('MySecurePassword123!', hashed); // true
```

---

### Hash (`@codexa/core/hash`)

```ts
import { sha256, sha512, hmacSha256 } from '@codexa/core/hash';

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

## Full Example

```ts
// server.ts
import { CodexaHttp, Router, MiddlewarePriority } from '@codexa/core/http';
import { env, createMongoDatabase, createRedisConnection } from '@codexa/core/config';
import { eventBus } from '@codexa/core/bus';
import { initializeStore } from '@codexa/core/store';
import { createCache } from '@codexa/core/cache';
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

## License

[GPL-3.0-or-later](LICENSE)
