/**
 * Comprehensive tests for @codexa/core
 *
 * Run: deno test --allow-env --allow-read --allow-net --allow-sys tests/smoke.test.ts
 */

import {
	assertEquals,
	assertExists,
	assertRejects,
	assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// ZOD
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('zod: exports zod namespace', async () => {
	const { zod } = await import('../src/utils/zod.ts');
	assertExists(zod);
	assertExists(zod.string);
	assertExists(zod.object);
	assertExists(zod.enum);
});

Deno.test('zod: schema validation works', async () => {
	const { zod } = await import('../src/utils/zod.ts');
	const schema = zod.object({
		name: zod.string().min(2),
		age: zod.coerce.number().min(0),
		email: zod.string().email().optional(),
	});
	const good = schema.safeParse({ name: 'Alice', age: '30', email: 'a@b.com' });
	assertEquals(good.success, true);

	const bad = schema.safeParse({ name: 'A', age: -1 });
	assertEquals(bad.success, false);
});

Deno.test('zod: nested object schemas', async () => {
	const { zod } = await import('../src/utils/zod.ts');
	const addressSchema = zod.object({
		street: zod.string(),
		city: zod.string(),
		zip: zod.string().regex(/^\d{5}$/),
	});
	const userSchema = zod.object({
		name: zod.string(),
		address: addressSchema,
	});
	const result = userSchema.safeParse({
		name: 'Bob',
		address: { street: '123 Main', city: 'NYC', zip: '10001' },
	});
	assertEquals(result.success, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('logger: createLogger returns Logger interface', async () => {
	const { createLogger } = await import('../src/utils/logger.ts');
	const log = createLogger('TestModule');
	assertExists(log.debug);
	assertExists(log.info);
	assertExists(log.warn);
	assertExists(log.error);
	assertExists(log.fatal);
	assertExists(log.child);
	log.info('smoke test log');
});

Deno.test('logger: child logger preserves hierarchy', async () => {
	const { createLogger } = await import('../src/utils/logger.ts');
	const log = createLogger('Parent');
	const child = log.child('Child');
	assertExists(child.info);
	child.info('child log message');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTO
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('crypto: generateId produces unique IDs', async () => {
	const { generateId } = await import('../src/utils/crypto.ts');
	const ids = new Set<string>();
	for (let i = 0; i < 100; i++) {
		ids.add(generateId());
	}
	assertEquals(ids.size, 100); // all unique
});

Deno.test('crypto: hashPassword and verifyPassword', async () => {
	const { hashPassword, verifyPassword } = await import('../src/utils/crypto.ts');
	const password = 'Str0ng!P@ssw0rd';
	const hashed = await hashPassword(password);
	assertEquals(typeof hashed, 'string');
	assertEquals(hashed.includes('$'), true);

	assertEquals(await verifyPassword(password, hashed), true);
	assertEquals(await verifyPassword('wrongPassword', hashed), false);
	assertEquals(await verifyPassword('', hashed), false);
});

Deno.test('crypto: different passwords produce different hashes', async () => {
	const { hashPassword } = await import('../src/utils/crypto.ts');
	const h1 = await hashPassword('password1');
	const h2 = await hashPassword('password2');
	const h3 = await hashPassword('password1'); // same input, different salt
	assertEquals(h1 !== h2, true);
	assertEquals(h1 !== h3, true); // salt makes them different
});

// ═══════════════════════════════════════════════════════════════════════════════
// HASH
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('hash: sha256 produces consistent hex output', async () => {
	const { sha256 } = await import('../src/utils/hash.ts');
	const h1 = await sha256('hello');
	const h2 = await sha256('hello');
	assertEquals(h1, h2); // deterministic
	assertEquals(h1.length, 64);
});

Deno.test('hash: different inputs produce different hashes', async () => {
	const { sha256 } = await import('../src/utils/hash.ts');
	const h1 = await sha256('hello');
	const h2 = await sha256('world');
	assertEquals(h1 !== h2, true);
});

Deno.test('hash: hmacSha256 produces valid HMAC', async () => {
	const { hmacSha256 } = await import('../src/utils/hash.ts');
	const h1 = await hmacSha256('message', 'secret');
	const h2 = await hmacSha256('message', 'secret');
	assertEquals(h1, h2); // deterministic
	assertEquals(typeof h1, 'string');

	const h3 = await hmacSha256('message', 'different-secret');
	assertEquals(h1 !== h3, true); // different keys = different HMAC
});

Deno.test('hash: all sha variants exist', async () => {
	const { sha256, sha1, sha384, sha512 } = await import('../src/utils/hash.ts');
	assertExists(sha256);
	assertExists(sha1);
	assertExists(sha384);
	assertExists(sha512);
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('device: parseDevice with Chrome UA', async () => {
	const { parseDevice } = await import('../src/utils/device.ts');
	const info = parseDevice(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	);
	assertExists(info.browser);
	assertExists(info.os);
	assertExists(info.raw);
});

Deno.test('device: parseDevice with empty UA', async () => {
	const { parseDevice } = await import('../src/utils/device.ts');
	const info = parseDevice('');
	assertExists(info);
	assertEquals(typeof info.browser, 'string');
});

Deno.test('device: formatDeviceShort returns string', async () => {
	const { parseDevice, formatDeviceShort } = await import('../src/utils/device.ts');
	const info = parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
	const short = formatDeviceShort(info);
	assertEquals(typeof short, 'string');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TTL
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('ttl: parseTtlToSeconds handles all units', async () => {
	const { parseTtlToSeconds } = await import('../src/utils/ttl.ts');
	assertEquals(parseTtlToSeconds('1s'), 1);
	assertEquals(parseTtlToSeconds('30s'), 30);
	assertEquals(parseTtlToSeconds('1m'), 60);
	assertEquals(parseTtlToSeconds('5m'), 300);
	assertEquals(parseTtlToSeconds('1h'), 3600);
	assertEquals(parseTtlToSeconds('24h'), 86400);
	assertEquals(parseTtlToSeconds('1d'), 86400);
	assertEquals(parseTtlToSeconds('7d'), 604800);
});

Deno.test('ttl: parseTtlToMs returns milliseconds', async () => {
	const { parseTtlToMs } = await import('../src/utils/ttl.ts');
	assertEquals(parseTtlToMs('1s'), 1000);
	assertEquals(parseTtlToMs('1m'), 60000);
	assertEquals(parseTtlToMs('1h'), 3600000);
});

Deno.test('ttl: ttlToDate returns a future Date', async () => {
	const { ttlToDate } = await import('../src/utils/ttl.ts');
	const before = Date.now();
	const date = ttlToDate('1h');
	const diff = date.getTime() - before;
	assertEquals(diff >= 3599000 && diff <= 3601000, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('response: all helper functions exist', async () => {
	const mod = await import('../src/utils/response.ts');
	assertExists(mod.sendSuccess);
	assertExists(mod.sendError);
	assertExists(mod.sendNotFound);
	assertExists(mod.sendInternalError);
	assertExists(mod.sendPaginated);
});

Deno.test('response: send helpers return native Response', async () => {
	const { sendCreated } = await import('../src/utils/response.ts');
	const ctx = {
		json(data: unknown, init?: ResponseInit): Response {
			return Response.json(data, init);
		},
	};

	const response = sendCreated(ctx, { id: 'u1' }, 'Created');
	assertEquals(response instanceof Response, true);
	assertEquals(response.status, 201);
	const payload = await response.json();
	assertEquals(payload.success, true);
	assertEquals(payload.message, 'Created');
	assertEquals(payload.data, { id: 'u1' });
	assertEquals(typeof payload.meta.timestamp, 'string');
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY PARAMS
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('query: parseQueryParams exists', async () => {
	const { parseQueryParams } = await import('../src/utils/parseQueryParams.ts');
	assertExists(parseQueryParams);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENV CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('config/env: loadEnv without schema (raw mode)', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const e = new Environment();
	await e.loadEnv({ loadFiles: false });
	assertEquals(e.loaded, true);
	// System env vars are accessible
	const path = e.get('PATH') ?? e.get('Path');
	assertEquals(typeof path, 'string');
});

Deno.test('config/env: loadEnv with custom schema validates', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const { zod } = await import('../src/utils/zod.ts');
	const e = new Environment();

	Deno.env.set('SMOKE_PORT', '3000');
	Deno.env.set('SMOKE_NAME', 'test-app');

	await e.loadEnv({
		loadFiles: false,
		schema: zod.object({
			SMOKE_PORT: zod.coerce.number(),
			SMOKE_NAME: zod.string().min(1),
		}).passthrough(),
	});

	const cfg = e.getConfig<{ SMOKE_PORT: number; SMOKE_NAME: string }>();
	assertEquals(cfg.SMOKE_PORT, 3000);
	assertEquals(cfg.SMOKE_NAME, 'test-app');

	Deno.env.delete('SMOKE_PORT');
	Deno.env.delete('SMOKE_NAME');
});

Deno.test('config/env: loadEnv with schema rejects invalid env', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const { zod } = await import('../src/utils/zod.ts');
	const e = new Environment();

	// REQUIRED_VAR not set in Deno.env
	await assertRejects(
		() =>
			e.loadEnv({
				loadFiles: false,
				schema: zod.object({
					REQUIRED_NONEXISTENT_VAR_FOR_TEST: zod.string().min(1),
				}),
			}),
		Error,
		'Invalid environment',
	);
});

Deno.test('config/env: utility helpers (enabled, number, list)', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const e = new Environment();

	Deno.env.set('SMOKE_BOOL', 'true');
	Deno.env.set('SMOKE_NUM', '42');
	Deno.env.set('SMOKE_LIST', 'a,b, c , d');

	await e.loadEnv({ loadFiles: false });

	assertEquals(e.enabled('SMOKE_BOOL'), true);
	assertEquals(e.enabled('NONEXISTENT'), false);
	assertEquals(e.number('SMOKE_NUM', 0), 42);
	assertEquals(e.number('NONEXISTENT', 99), 99);

	const list = e.list('SMOKE_LIST');
	assertEquals(list, ['a', 'b', 'c', 'd']);
	assertEquals(e.list('NONEXISTENT'), []);

	Deno.env.delete('SMOKE_BOOL');
	Deno.env.delete('SMOKE_NUM');
	Deno.env.delete('SMOKE_LIST');
});

Deno.test('config/env: environment check helpers', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const { zod } = await import('../src/utils/zod.ts');
	const e = new Environment();

	Deno.env.set('NODE_ENV', 'production');
	await e.loadEnv({
		loadFiles: false,
		schema: zod.object({
			NODE_ENV: zod.enum(['development', 'production', 'test']),
		}).passthrough(),
	});

	assertEquals(e.isProduction(), true);
	assertEquals(e.isDevelopment(), false);
	assertEquals(e.isTest(), false);
	assertEquals(e.is('production'), true);

	Deno.env.delete('NODE_ENV');
});

Deno.test('config/env: multiple env files merge left-to-right', async () => {
	const { Environment } = await import('../src/config/env.ts');
	const e = new Environment();
	// Even if files don't exist, loadEnv should not throw (silently skips)
	await e.loadEnv({
		paths: ['.env.nonexistent1', '.env.nonexistent2'],
	});
	assertEquals(e.loaded, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MONGO CONFIG (factory only — no actual connection)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('config/mongo: factory returns connection interface', async () => {
	const { createMongoDatabase } = await import('../src/config/database.ts');
	const conn = createMongoDatabase('mongodb://localhost:27017', 'testdb');
	assertExists(conn.connect);
	assertExists(conn.disconnect);
	assertExists(conn.getDb);
	assertExists(conn.getClient);
	assertExists(conn.supportsTransactions);
	assertEquals(conn.supportsTransactions(), false); // not connected yet
});

Deno.test('config/mongo: getDb throws before connect', async () => {
	const { createMongoDatabase } = await import('../src/config/database.ts');
	const conn = createMongoDatabase('mongodb://localhost:27017', 'testdb');
	assertThrows(() => conn.getDb(), Error, 'not connected');
});

Deno.test('config/mongo: getClient throws before connect', async () => {
	const { createMongoDatabase } = await import('../src/config/database.ts');
	const conn = createMongoDatabase('mongodb://localhost:27017', 'testdb');
	assertThrows(() => conn.getClient(), Error, 'not connected');
});

Deno.test('config/mongo: replicaSet option accepted', async () => {
	const { createMongoDatabase } = await import('../src/config/database.ts');
	const conn = createMongoDatabase('mongodb://localhost:27017', 'testdb', {
		replicaSet: true,
		minPoolSize: 2,
		maxPoolSize: 10,
	});
	assertExists(conn);
});

// ═══════════════════════════════════════════════════════════════════════════════
// REDIS CONFIG (factory only — no actual connection)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('config/redis: factory returns connection interface', async () => {
	const { createRedisConnection } = await import('../src/config/redis.ts');
	const conn = createRedisConnection({ host: 'localhost', port: 6379 });
	assertExists(conn.connect);
	assertExists(conn.disconnect);
	assertExists(conn.getClient);
	assertExists(conn.isReady);
	assertExists(conn.getSubscriber);
	assertExists(conn.createSubscriberClient);
	assertEquals(conn.isReady(), false);
});

Deno.test('config/redis: getClient throws before connect', async () => {
	const { createRedisConnection } = await import('../src/config/redis.ts');
	const conn = createRedisConnection({ host: 'localhost' });
	assertThrows(() => conn.getClient(), Error, 'not connected');
});

Deno.test('config/redis: getSubscriber throws when pub/sub not enabled', async () => {
	const { createRedisConnection } = await import('../src/config/redis.ts');
	const conn = createRedisConnection({ host: 'localhost' });
	assertThrows(() => conn.getSubscriber(), Error, 'not enabled');
});

Deno.test('config/redis: pub/sub config accepted', async () => {
	const { createRedisConnection } = await import('../src/config/redis.ts');
	const conn = createRedisConnection({
		url: 'redis://localhost:6379',
		enablePubSub: true,
		keyPrefix: 'test::',
		connectTimeoutMS: 5000,
		maxRetries: 3,
	});
	assertExists(conn);
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('config/storage: buildStorageConfig defaults to local', async () => {
	const { buildStorageConfig } = await import('../src/config/storage.ts');
	const cfg = buildStorageConfig({ STORAGE_PROVIDER: 'local' });
	assertEquals(cfg.provider, 'local');
	assertExists(cfg.local);
	assertEquals(cfg.local?.dir, './uploads');
});

Deno.test('config/storage: buildStorageConfig s3 accepts partial env shape', async () => {
	const { buildStorageConfig } = await import('../src/config/storage.ts');
	const cfg = buildStorageConfig({
		STORAGE_PROVIDER: 's3',
	} as Parameters<typeof buildStorageConfig>[0]);
	assertEquals(cfg.provider, 's3');
	assertEquals(cfg.s3?.bucket, undefined);
});

Deno.test('config/storage: buildStorageConfig s3 with valid keys', async () => {
	const { buildStorageConfig } = await import('../src/config/storage.ts');
	const cfg = buildStorageConfig({
		STORAGE_PROVIDER: 's3',
		S3_BUCKET: 'my-bucket',
		S3_REGION: 'us-east-1',
		S3_ACCESS_KEY: 'AKIA...',
		S3_SECRET_KEY: 'secret',
	});
	assertEquals(cfg.provider, 's3');
	assertEquals(cfg.s3?.bucket, 'my-bucket');
	assertEquals(cfg.s3?.region, 'us-east-1');
});

Deno.test('config/storage: buildStorageConfig cloudinary', async () => {
	const { buildStorageConfig } = await import('../src/config/storage.ts');
	const cfg = buildStorageConfig({
		STORAGE_PROVIDER: 'cloudinary',
		CLOUDINARY_CLOUD_NAME: 'mycloud',
		CLOUDINARY_API_KEY: 'key123',
		CLOUDINARY_API_SECRET: 'secret',
	});
	assertEquals(cfg.provider, 'cloudinary');
	assertEquals(cfg.cloudinary?.cloudName, 'mycloud');
});

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP

Deno.test('http: createApp installs plugin routes and dispatches requests', async () => {
	const { createApp, definePlugin } = await import('../src/lib/http/mod.ts');

	const healthPlugin = definePlugin({
		name: 'health',
		metadata: { tags: ['system'] },
		setup(scope) {
			scope.route({
				method: 'GET',
				path: '/health',
				handler: (ctx) => ctx.json({ ok: true }),
				options: { name: 'health.check', tags: ['public:health'] },
			});
		},
	});

	const app = createApp('SmokeApi').install(healthPlugin);
	await app.boot();

	const response = await app.dispatch(new Request('http://local.test/health'));
	assertEquals(response.status, 200);
	assertEquals(await response.json(), { ok: true });
	assertEquals(app.getPhase(), 'ready');
	assertEquals(app.size, 1);

	await app.shutdown();
	assertEquals(app.getPhase(), 'stopped');
});

Deno.test('http: plugin router mount and route params work', async () => {
	const { createApp, createRouter, definePlugin } = await import(
		'../src/lib/http/mod.ts'
	);

	const usersRouter = createRouter('users-router').route({
		method: 'GET',
		path: '/users/:id',
		handler: (ctx) => ctx.json({ userId: ctx.params.id }),
		options: { name: 'users.show', tags: ['users:get'] },
	});

	const usersPlugin = definePlugin({
		name: 'users',
		setup(scope) {
			scope.mount('/api', usersRouter);
		},
	});

	const app = createApp('MountedApi').install(usersPlugin);
	const response = await app.dispatch(new Request('http://local.test/api/users/u1'));
	assertEquals(response.status, 200);
	assertEquals(await response.json(), { userId: 'u1' });
	await app.shutdown();
});

Deno.test('http: plugin middleware provides plugin-scoped request state', async () => {
	const { createApp, definePlugin, definePluginMiddleware } = await import(
		'../src/lib/http/mod.ts'
	);

	const requestSource = definePluginMiddleware<{ requestSource: string }>({
		name: 'request-source',
		tags: ['state'],
		appliedOn: ['guarded*'],
		priority: -10,
		fn(ctx) {
			ctx.provide({
				requestSource: ctx.headers.get('x-request-source') ?? 'test',
			});
		},
		expose(data) {
			return { requestSource: data.requestSource };
		},
	});

	const auditPlugin = definePlugin({
		name: 'audit',
		setup(scope) {
			const scoped = scope.use(requestSource);
			scoped.route({
				method: 'GET',
				path: '/audit',
				handler: (ctx) => ctx.json({ source: ctx.state.requestSource }),
				options: { name: 'audit.show', tags: ['guarded:audit'] },
			});
		},
	});

	const app = createApp('StateApi').install(auditPlugin);
	const response = await app.dispatch(
		new Request('http://local.test/audit', {
			headers: { 'x-request-source': 'smoke' },
		}),
	);
	assertEquals(response.status, 200);
	assertEquals(await response.json(), { source: 'smoke' });
	await app.shutdown();
});

Deno.test('http: plugin version header is plugin-owned', async () => {
	const { createApp, definePlugin } = await import('../src/lib/http/mod.ts');

	const versionedPlugin = definePlugin({
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

	const app = createApp('VersionApi').install(versionedPlugin).onNotFound(
		() => Response.json({ error: 'missing' }, { status: 404 }),
	);

	const miss = await app.dispatch(new Request('http://local.test/catalog/items'));
	assertEquals(miss.status, 404);

	const hit = await app.dispatch(
		new Request('http://local.test/catalog/items', {
			headers: { 'x-catalog-version': '2.0.0' },
		}),
	);
	assertEquals(hit.status, 200);
	assertEquals(await hit.json(), { version: '2.0.0' });
	await app.shutdown();
});

Deno.test('http: exposed services are available to declared dependencies and root app', async () => {
	const { createApp, definePlugin } = await import('../src/lib/http/mod.ts');

	const authPlugin = definePlugin({
		name: 'auth',
		setup(scope) {
			scope.exposeService('verify', (token: string) => token === 'valid');
		},
	});

	const profilePlugin = definePlugin({
		name: 'profile',
		dependsOn: ['auth'] as const,
		setup(scope) {
			const verify = scope.getService('auth', 'verify') as (token: string) => boolean;
			scope.route({
				method: 'GET',
				path: '/profile/me',
				handler: (ctx) => {
					const token = ctx.headers.get('authorization') ?? '';
					return ctx.json({ verified: verify(token) });
				},
				options: { name: 'profile.me', tags: ['profile'] },
			});
		},
	});

	const app = createApp('ServiceApi').install(authPlugin).install(profilePlugin);
	assertEquals(app.hasService('auth', 'verify'), true);
	assertEquals(typeof app.getService('auth', 'verify'), 'function');

	const response = await app.dispatch(
		new Request('http://local.test/profile/me', {
			headers: { authorization: 'valid' },
		}),
	);
	assertEquals(response.status, 200);
	assertEquals(await response.json(), { verified: true });
	await app.shutdown();
});

Deno.test('http: inspect and tag controls update committed routes', async () => {
	const { createApp, definePlugin } = await import('../src/lib/http/mod.ts');

	const featurePlugin = definePlugin({
		name: 'feature',
		setup(scope) {
			scope.route({
				method: 'GET',
				path: '/feature',
				handler: (ctx) => ctx.text('enabled'),
				options: { name: 'feature.index', tags: ['feature:x'] },
			});
		},
	});

	const app = createApp('InspectApi').install(featurePlugin);
	await app.boot();

	const before = app.inspect({ tags: ['feature:x'] });
	assertEquals(before.routes.length, 1);
	assertEquals(before.routes[0].enabled, true);

	app.disableByTags('feature:x');
	const disabled = app.inspect({ tags: ['feature:x'] });
	assertEquals(disabled.routes[0].enabled, false);
	assertEquals(
		(await app.dispatch(new Request('http://local.test/feature'))).status,
		404,
	);

	app.enableByTags('feature:x');
	assertEquals(
		(await app.dispatch(new Request('http://local.test/feature'))).status,
		200,
	);
	await app.shutdown();
});
// EVENT BUS
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('bus: initialize in local mode', async () => {
	const { eventBus } = await import('../src/lib/bus/mod.ts');
	await eventBus.initialize({});
	assertExists(eventBus.on);
	await eventBus.destroy();
});

Deno.test('bus: on/emit local events', async () => {
	const { eventBus } = await import('../src/lib/bus/mod.ts');
	await eventBus.initialize({});

	let received: unknown = null;
	eventBus.on('orders', 'created', (data) => { received = data; });
	eventBus.emit('orders', 'created', { id: 'order-123', total: 99.99 });

	assertEquals((received as { id: string }).id, 'order-123');
	eventBus.off('orders', 'created');
	await eventBus.destroy();
});

Deno.test('bus: once fires only once', async () => {
	const { eventBus } = await import('../src/lib/bus/mod.ts');
	await eventBus.initialize({});

	let count = 0;
	eventBus.once('test', 'once-event', () => { count++; });

	eventBus.emit('test', 'once-event', {});
	eventBus.emit('test', 'once-event', {});
	eventBus.emit('test', 'once-event', {});

	assertEquals(count, 1);
	await eventBus.destroy();
});

Deno.test('bus: off removes specific handler', async () => {
	const { eventBus } = await import('../src/lib/bus/mod.ts');
	await eventBus.initialize({});

	let count = 0;
	const handler = () => { count++; };
	eventBus.on('ch', 'ev', handler);

	eventBus.emit('ch', 'ev', {});
	assertEquals(count, 1);

	eventBus.off('ch', 'ev', handler);
	eventBus.emit('ch', 'ev', {});
	assertEquals(count, 1); // no longer fires

	await eventBus.destroy();
});

Deno.test('bus: listActiveEvents', async () => {
	const { eventBus } = await import('../src/lib/bus/mod.ts');
	await eventBus.initialize({});

	eventBus.on('users', 'created', () => {});
	eventBus.on('users', 'updated', () => {});
	eventBus.on('orders', 'placed', () => {});

	const events = eventBus.listActiveEvents();
	assertEquals(events.length >= 3, true);

	eventBus.off();
	await eventBus.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('store: memory backend CRUD', async () => {
	const { initializeStore, store, closeStore } = await import('../src/lib/store/mod.ts');
	await initializeStore({ mode: 'memory' });

	// SET
	await store.set('user:1', { name: 'Alice', role: 'admin' });

	// GET
	const user = await store.get<{ name: string; role: string }>('user:1');
	assertEquals(user?.name, 'Alice');
	assertEquals(user?.role, 'admin');

	// EXISTS
	const exists = await store.exists('user:1');
	assertEquals(exists, 1);

	// DEL
	await store.del('user:1');
	const deleted = await store.get('user:1');
	assertEquals(deleted, null);

	closeStore();
});

Deno.test('store: TTL expiry', async () => {
	const { initializeStore, store, closeStore } = await import('../src/lib/store/mod.ts');
	await initializeStore({ mode: 'memory' });

	await store.set('temp', 'value', { ttl: 1 }); // 1 second
	const before = await store.get('temp');
	assertEquals(before, 'value');

	// Wait for expiry
	await new Promise((r) => setTimeout(r, 1200));
	const after = await store.get('temp');
	assertEquals(after, null);

	closeStore();
});

Deno.test('store: incr/decr counters', async () => {
	const { initializeStore, store, closeStore } = await import('../src/lib/store/mod.ts');
	await initializeStore({ mode: 'memory' });

	await store.set('counter', 0);
	await store.incr('counter');
	await store.incr('counter');
	await store.incr('counter');
	assertEquals(await store.get<number>('counter'), 3);

	await store.decr('counter');
	assertEquals(await store.get<number>('counter'), 2);

	await store.incrby('counter', 10);
	assertEquals(await store.get<number>('counter'), 12);

	await store.decrby('counter', 5);
	assertEquals(await store.get<number>('counter'), 7);

	closeStore();
});

Deno.test('store: keys pattern matching', async () => {
	const { initializeStore, store, closeStore } = await import('../src/lib/store/mod.ts');
	await initializeStore({ mode: 'memory' });

	await store.set('user:1', 'alice');
	await store.set('user:2', 'bob');
	await store.set('order:1', 'ord-1');

	const userKeys = await store.keys('user:*');
	assertEquals(userKeys.length, 2);

	const allKeys = await store.keys('*');
	assertEquals(allKeys.length >= 3, true);

	closeStore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('cache: namespace isolation', async () => {
	const { initializeStore, closeStore } = await import('../src/lib/store/mod.ts');
	const { createCache } = await import('../src/lib/cache/mod.ts');
	await initializeStore({ mode: 'memory' });

	const userCache = createCache('users');
	const orderCache = createCache('orders');

	await userCache.set('key1', 'user-data');
	await orderCache.set('key1', 'order-data');

	assertEquals(await userCache.get('key1'), 'user-data');
	assertEquals(await orderCache.get('key1'), 'order-data');

	closeStore();
});

Deno.test('cache: getOrSet (cache-aside pattern)', async () => {
	const { initializeStore, closeStore } = await import('../src/lib/store/mod.ts');
	const { createCache } = await import('../src/lib/cache/mod.ts');
	await initializeStore({ mode: 'memory' });

	const cache = createCache('test');
	let computeCount = 0;

	const compute = async () => {
		computeCount++;
		return { id: '123', name: 'Computed' };
	};

	// First call — computes
	const v1 = await cache.getOrSet('item', compute);
	assertEquals(v1.name, 'Computed');
	assertEquals(computeCount, 1);

	// Second call — served from cache
	const v2 = await cache.getOrSet('item', compute);
	assertEquals(v2.name, 'Computed');
	assertEquals(computeCount, 1); // not called again

	closeStore();
});

Deno.test('cache: tag-based invalidation', async () => {
	const { initializeStore, closeStore } = await import('../src/lib/store/mod.ts');
	const { createCache } = await import('../src/lib/cache/mod.ts');
	await initializeStore({ mode: 'memory' });

	const cache = createCache('products');

	await cache.set('p1', { name: 'Widget' }, { tags: ['category:electronics'] });
	await cache.set('p2', { name: 'Gadget' }, { tags: ['category:electronics'] });
	await cache.set('p3', { name: 'Shirt' }, { tags: ['category:clothing'] });

	assertEquals(await cache.has('p1'), true);
	assertEquals(await cache.has('p2'), true);

	await cache.invalidateTag('category:electronics');

	assertEquals(await cache.has('p1'), false);
	assertEquals(await cache.has('p2'), false);
	assertEquals(await cache.has('p3'), true); // clothing unaffected

	closeStore();
});

Deno.test('cache: flush clears all entries in namespace', async () => {
	const { initializeStore, closeStore } = await import('../src/lib/store/mod.ts');
	const { createCache } = await import('../src/lib/cache/mod.ts');
	await initializeStore({ mode: 'memory' });

	const cache = createCache('flushtest');
	await cache.set('a', 1);
	await cache.set('b', 2);
	await cache.set('c', 3);

	assertEquals(await cache.has('a'), true);
	await cache.flush();
	assertEquals(await cache.has('a'), false);
	assertEquals(await cache.has('b'), false);
	assertEquals(await cache.has('c'), false);

	closeStore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE (factory only)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('storage: createStorageManager export', async () => {
	const { createStorageManager } = await import('../src/lib/storage/mod.ts');
	assertExists(createStorageManager);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT MODULE
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test('root: mod.ts keeps root import lightweight', async () => {
	const mod = await import('../mod.ts');
	assertEquals(mod.CODEXA_CORE_VERSION, '0.0.5');
	assertEquals(mod.CODEXA_CORE_MODULES.includes('http'), true);
	assertEquals(mod.CODEXA_CORE_MODULES.includes('store'), true);
});
