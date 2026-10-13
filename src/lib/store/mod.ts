/**
 * @module @codexa/core/store
 *
 * Unified key-value store for Codexa applications.
 *
 * Supports three backends: in-memory (default), Redis, and Deno KV. Use
 * `createStore()` for independent plugin-owned instances or
 * `createStoreRegistry()` for named instances with centralized cleanup.
 * `initializeStore()` and `store` remain the default-app compatibility API.
 * 
 * @example Independent plugin stores
 * ```ts
 * import { createStore } from '@codexa/core/store';
 * const sessions = await createStore({ mode: 'redis', redisClient });
 * const metadata = await createStore({ mode: 'kv', kvPath: './auth.db' });
 * const temporary = await createStore({ mode: 'memory' });
 * ```
 *
 * @example Default application store (backward compatible)
 * ```ts
 * import { initializeStore, store } from '@codexa/core/store';
 * await initializeStore({ mode: 'memory' });
 * await store.set('key', { hello: 'world' }, { ttl: 60 });
 * const val = await store.get('key');
 * ```
 *
 * @example Redis
 * ```ts
 * import { createRedisConnection } from '@codexa/core/config';
 * import { initializeStore, store } from '@codexa/core/store';
 *
 * const redis = createRedisConnection({ url: Deno.env.get('REDIS_URL') });
 * await redis.connect();
 *
 * await initializeStore({ mode: 'redis', redisClient: redis.getClient() });
 * await store.set('session:xyz', payload, { ttl: 1800 });
 * ```
 *
 * @example Deno KV
 * ```ts
 * import { initializeStore, store } from '@codexa/core/store';
 * await initializeStore({ mode: 'kv', kvPath: './data/kv.db' });
 * ```
 *
 * @example Atomic read and delete
 * ```ts
 * const transaction = await authStore.take<AuthTransaction>('txn:123');
 * if (transaction === null) {
 *   throw new Error('Transaction is missing, expired, or already consumed.');
 * }
 * ```
 *
 * @example Atomic compare and set
 * ```ts
 * while (true) {
 *   const current = await authStore.get<AuthTransaction>('txn:123');
 *   if (current === null) throw new Error('Transaction is missing.');
 *
 *   const next = { ...current, loginVerified: true };
 *   const updated = await authStore.compareAndSet(
 *     'txn:123',
 *     current,
 *     next,
 *   );
 *   if (updated) break;
 * }
 * ```
 */

import { createLogger } from '../../utils/logger.ts';
import type {
	IStore,
	StoreConfig,
	StoreSetOptions,
	StoreStats,
	StoreType,
} from '../../types/app.d.ts';

const log = createLogger('Codexa:Store');

interface AtomicStoreBackend extends IStore {
	take<T = unknown>(key: string): Promise<T | null>;
	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean>;
}

function serializeStoreValue(value: unknown): string {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new TypeError('Store values must be JSON serializable.');
	}
	return serialized;
}

function deserializeStoreValue<T>(value: string): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return value as T;
	}
}

// 1. Memory Store

interface MemoryEntry {
	value: unknown;
	expiresAt?: number;
}

class MemoryStore implements AtomicStoreBackend {
	private store = new Map<string, MemoryEntry>();
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;
	private readonly cleanupMs: number;

	constructor(cleanupIntervalMs = 60_000) {
		this.cleanupMs = cleanupIntervalMs;
		this.cleanupInterval = setInterval(
			() => this.cleanup(),
			this.cleanupMs,
		);
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.store.entries()) {
			if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
				this.store.delete(key);
			}
		}
	}

	private isExpired(entry: MemoryEntry): boolean {
		return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
	}

	private getEntry(key: string): MemoryEntry | null {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (this.isExpired(entry)) {
			this.store.delete(key);
			return null;
		}
		return entry;
	}

	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string> {
		const ttl = options?.ttl ?? options?.ex;
		const entry: MemoryEntry = { value };
		if (ttl && ttl > 0) {
			entry.expiresAt = Date.now() + ttl * 1000;
		}
		this.store.set(key, entry);
		return Promise.resolve('OK');
	}

	get<T = unknown>(key: string): Promise<T | null> {
		const entry = this.getEntry(key);
		return Promise.resolve(entry ? (entry.value as T) : null);
	}

	take<T = unknown>(key: string): Promise<T | null> {
		const entry = this.getEntry(key);
		if (!entry) return Promise.resolve(null);
		this.store.delete(key);
		return Promise.resolve(entry.value as T);
	}

	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> {
		const entry = this.getEntry(key);
		if (
			!entry ||
			serializeStoreValue(entry.value) !== serializeStoreValue(expected)
		) return Promise.resolve(false);

		const ttl = options?.ttl ?? options?.ex;
		this.store.set(key, {
			value: next,
			expiresAt: ttl && ttl > 0
				? Date.now() + ttl * 1000
				: entry.expiresAt,
		});
		return Promise.resolve(true);
	}

	del(...keys: string[]): Promise<number> {
		let deleted = 0;
		for (const key of keys) {
			if (this.store.delete(key)) deleted++;
		}
		return Promise.resolve(deleted);
	}

	exists(...keys: string[]): Promise<number> {
		let count = 0;
		for (const key of keys) {
			if (this.getEntry(key)) count++;
		}
		return Promise.resolve(count);
	}

	expire(key: string, seconds: number): Promise<number> {
		const entry = this.getEntry(key);
		if (!entry) return Promise.resolve(0);
		entry.expiresAt = Date.now() + seconds * 1000;
		return Promise.resolve(1);
	}

	ttl(key: string): Promise<number> {
		const entry = this.getEntry(key);
		if (!entry) return Promise.resolve(-2);
		if (entry.expiresAt === undefined) return Promise.resolve(-1);
		return Promise.resolve(
			Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
		);
	}

	incr(key: string): Promise<number> {
		return this.incrby(key, 1);
	}

	decr(key: string): Promise<number> {
		return this.incrby(key, -1);
	}

	incrby(key: string, amount: number): Promise<number> {
		const entry = this.getEntry(key);
		const current = entry ? (Number(entry.value) || 0) : 0;
		const next = current + amount;
		this.store.set(key, { value: next, expiresAt: entry?.expiresAt });
		return Promise.resolve(next);
	}

	decrby(key: string, amount: number): Promise<number> {
		return this.incrby(key, -amount);
	}

	keys(pattern: string): Promise<string[]> {
		// const regex = new RegExp(
		// 	'^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// 		.replace(/\*/g, '.*')
		// 		.replace(/\?/g, '.') +
		// 		'$',
		// );
		const regex = patternToRegex(pattern);
		const result: string[] = [];
		for (const [key, entry] of this.store) {
			if (!this.isExpired(entry) && regex.test(key)) {
				result.push(key);
			}
		}
		return Promise.resolve(result);
	}

	flushdb(): Promise<string> {
		this.store.clear();
		return Promise.resolve('OK');
	}

	quit(): Promise<string> {
		if (this.cleanupInterval !== null) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.store.clear();
		return Promise.resolve('OK');
	}

	size(): number {
		return this.store.size;
	}
}

// 2. Redis Store

const REDIS_TAKE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
	return false
end
redis.call('DEL', KEYS[1])
return value
`;

const REDIS_COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then
	return 0
end

local requestedTtl = tonumber(ARGV[3])
if requestedTtl and requestedTtl > 0 then
	redis.call('SET', KEYS[1], ARGV[2], 'EX', requestedTtl)
else
	local remainingTtl = redis.call('PTTL', KEYS[1])
	redis.call('SET', KEYS[1], ARGV[2])
	if remainingTtl > 0 then
		redis.call('PEXPIRE', KEYS[1], remainingTtl)
	end
end

return 1
`;

class RedisStore implements AtomicStoreBackend {
	constructor(
		// deno-lint-ignore no-explicit-any
		private readonly redis: any,
		private readonly closeClientOnClose: boolean,
	) {}

	async set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string> {
		const serialized = JSON.stringify(value);
		const ttl = options?.ttl ?? options?.ex;
		if (ttl && ttl > 0) {
			return await this.redis.set(key, serialized, 'EX', ttl);
		}
		return await this.redis.set(key, serialized);
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const raw = await this.redis.get(key);
		if (raw === null || raw === undefined) return null;
		return deserializeStoreValue<T>(raw);
	}

	async take<T = unknown>(key: string): Promise<T | null> {
		const raw = await this.redis.eval(REDIS_TAKE_SCRIPT, 1, key);
		if (raw === null || raw === undefined || raw === false) return null;
		return deserializeStoreValue<T>(String(raw));
	}

	async compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> {
		const ttl = options?.ttl ?? options?.ex;
		const result = await this.redis.eval(
			REDIS_COMPARE_AND_SET_SCRIPT,
			1,
			key,
			serializeStoreValue(expected),
			serializeStoreValue(next),
			ttl && ttl > 0 ? String(ttl) : '',
		);
		return Number(result) === 1;
	}

	async del(...keys: string[]): Promise<number> {
		if (keys.length === 0) return 0;
		return await this.redis.del(...keys);
	}

	async exists(...keys: string[]): Promise<number> {
		if (keys.length === 0) return 0;
		return await this.redis.exists(...keys);
	}

	async expire(key: string, seconds: number): Promise<number> {
		return await this.redis.expire(key, seconds);
	}

	async ttl(key: string): Promise<number> {
		return await this.redis.ttl(key);
	}

	async incr(key: string): Promise<number> {
		return await this.redis.incr(key);
	}

	async decr(key: string): Promise<number> {
		return await this.redis.decr(key);
	}

	async incrby(key: string, amount: number): Promise<number> {
		return await this.redis.incrby(key, amount);
	}

	async decrby(key: string, amount: number): Promise<number> {
		return await this.redis.decrby(key, amount);
	}

	async keys(pattern: string): Promise<string[]> {
		const connectionPrefix =
			typeof this.redis.options?.keyPrefix === 'string'
				? this.redis.options.keyPrefix
				: '';
		const keys = await this.redis.keys(`${connectionPrefix}${pattern}`);
		if (!connectionPrefix) return keys;
		return keys.map((key: string) =>
			key.startsWith(connectionPrefix)
				? key.slice(connectionPrefix.length)
				: key
		);
	}

	async flushdb(): Promise<string> {
		return await this.redis.flushdb();
	}

	async quit(): Promise<string> {
		if (!this.closeClientOnClose) return 'OK';
		try {
			return await this.redis.quit();
		} catch {
			return 'OK';
		}
	}
}

// 3. Deno KV Store

interface KvEntry {
	value: unknown;
	expiresAt?: number;
}

class DenoKvStore implements AtomicStoreBackend {
	private readonly kv: Deno.Kv;
	private readonly prefix: string;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;
	private readonly cleanupMs: number;

	constructor(kv: Deno.Kv, prefix = 'store', cleanupIntervalMs = 60_000) {
		this.kv = kv;
		this.prefix = prefix;
		this.cleanupMs = cleanupIntervalMs;
		this.cleanupInterval = setInterval(
			() => this.cleanup(),
			this.cleanupMs,
		);
	}

	private parseKey(key: string): Deno.KvKey {
		return [this.prefix, key];
	}

	private async cleanup(): Promise<void> {
		const now = Date.now();
		const iter = this.kv.list<KvEntry>({ prefix: [this.prefix] });
		const toDelete: Deno.KvKey[] = [];
		for await (const entry of iter) {
			if (entry.value?.expiresAt && entry.value.expiresAt <= now) {
				toDelete.push(entry.key);
			}
		}
		for (const k of toDelete) {
			await this.kv.delete(k);
		}
	}

	async set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string> {
		const ttl = options?.ttl ?? options?.ex;
		const entry: KvEntry = { value };
		const setOptions: { expireIn?: number } = {};
		if (ttl && ttl > 0) {
			entry.expiresAt = Date.now() + ttl * 1000;
			setOptions.expireIn = ttl * 1000;
		}
		await this.kv.set(this.parseKey(key), entry, setOptions);
		return 'OK';
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const result = await this.kv.get<KvEntry>(this.parseKey(key));
		if (result.value === null) return null;
		const entry = result.value;
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			await this.kv.delete(this.parseKey(key));
			return null;
		}
		return entry.value as T;
	}

	async take<T = unknown>(key: string): Promise<T | null> {
		const parsedKey = this.parseKey(key);
		while (true) {
			const result = await this.kv.get<KvEntry>(parsedKey);
			if (result.value === null) return null;

			const expired = result.value.expiresAt !== undefined &&
				result.value.expiresAt <= Date.now();
			const committed = await this.kv.atomic()
				.check(result)
				.delete(parsedKey)
				.commit();
			if (!committed.ok) continue;
			return expired ? null : result.value.value as T;
		}
	}

	async compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> {
		const parsedKey = this.parseKey(key);
		const result = await this.kv.get<KvEntry>(parsedKey);
		if (result.value === null) return false;

		const now = Date.now();
		if (
			(result.value.expiresAt !== undefined &&
				result.value.expiresAt <= now) ||
			serializeStoreValue(result.value.value) !==
				serializeStoreValue(expected)
		) return false;

		const ttl = options?.ttl ?? options?.ex;
		const expiresAt = ttl && ttl > 0
			? now + ttl * 1000
			: result.value.expiresAt;
		const setOptions: { expireIn?: number } = {};
		if (expiresAt !== undefined) {
			setOptions.expireIn = Math.max(1, expiresAt - now);
		}

		const committed = await this.kv.atomic()
			.check(result)
			.set(parsedKey, { value: next, expiresAt }, setOptions)
			.commit();
		return committed.ok;
	}

	async del(...keys: string[]): Promise<number> {
		let deleted = 0;
		for (const key of keys) {
			const exists = await this.kv.get(this.parseKey(key));
			if (exists.value !== null) {
				await this.kv.delete(this.parseKey(key));
				deleted++;
			}
		}
		return deleted;
	}

	async exists(...keys: string[]): Promise<number> {
		let count = 0;
		for (const key of keys) {
			const result = await this.kv.get<KvEntry>(this.parseKey(key));
			if (result.value !== null) {
				const entry = result.value;
				if (!entry.expiresAt || entry.expiresAt > Date.now()) {
					count++;
				}
			}
		}
		return count;
	}

	async expire(key: string, seconds: number): Promise<number> {
		const result = await this.kv.get<KvEntry>(this.parseKey(key));
		if (result.value === null) return 0;
		const entry = result.value;
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			await this.kv.delete(this.parseKey(key));
			return 0;
		}
		entry.expiresAt = Date.now() + seconds * 1000;
		await this.kv.set(this.parseKey(key), entry, {
			expireIn: seconds * 1000,
		});
		return 1;
	}

	async ttl(key: string): Promise<number> {
		const result = await this.kv.get<KvEntry>(this.parseKey(key));
		if (result.value === null) return -2;
		const entry = result.value;
		if (!entry.expiresAt) return -1;
		if (entry.expiresAt <= Date.now()) return -2;
		return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
	}

	incr(key: string): Promise<number> {
		return this.incrby(key, 1);
	}

	decr(key: string): Promise<number> {
		return this.incrby(key, -1);
	}

	async incrby(key: string, amount: number): Promise<number> {
		// Optimistic concurrency loop - retries until the atomic check passes.
		while (true) {
			const result = await this.kv.get<KvEntry>(this.parseKey(key));
			const isLive = result.value !== null &&
				(result.value.expiresAt === undefined ||
					result.value.expiresAt > Date.now());
			const current = isLive ? (Number(result.value.value) || 0) : 0;
			const next = current + amount;
			const newEntry: KvEntry = {
				value: next,
				expiresAt: isLive ? result.value.expiresAt : undefined,
			};

			const op = this.kv.atomic()
				.check(result)
				.set(this.parseKey(key), newEntry);

			const res = await op.commit();
			if (res.ok) return next;
		}
	}

	decrby(key: string, amount: number): Promise<number> {
		return this.incrby(key, -amount);
	}

	async keys(pattern: string): Promise<string[]> {
		// const regex = new RegExp(
		// 	'^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// 		.replace(/\*/g, '.*')
		// 		.replace(/\?/g, '.') +
		// 		'$',
		// );
		const regex = patternToRegex(pattern);
		const result: string[] = [];
		const now = Date.now();
		const iter = this.kv.list<KvEntry>({ prefix: [this.prefix] });

		for await (const entry of iter) {
			const actualKey = entry.key[1] as string;
			const val = entry.value;
			if (
				val !== null &&
				(val.expiresAt === undefined || val.expiresAt > now) &&
				regex.test(actualKey)
			) {
				result.push(actualKey);
			}
		}
		return result;
	}

	async flushdb(): Promise<string> {
		const iter = this.kv.list({ prefix: [this.prefix] });
		for await (const entry of iter) {
			await this.kv.delete(entry.key);
		}
		return 'OK';
	}

	quit(): Promise<string> {
		if (this.cleanupInterval !== null) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.kv.close();
		return Promise.resolve('OK');
	}
}

// Shared utilities
/** Restrict a backend to one logical keyspace. */
class PrefixedStore implements AtomicStoreBackend {
	constructor(
		private readonly backend: AtomicStoreBackend,
		private readonly prefix: string,
	) {}

	private key(key: string): string {
		return `${this.prefix}${key}`;
	}

	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string> {
		return this.backend.set(this.key(key), value, options);
	}

	get<T = unknown>(key: string): Promise<T | null> {
		return this.backend.get<T>(this.key(key));
	}

	take<T = unknown>(key: string): Promise<T | null> {
		return this.backend.take<T>(this.key(key));
	}

	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> {
		return this.backend.compareAndSet(
			this.key(key),
			expected,
			next,
			options,
		);
	}

	del(...keys: string[]): Promise<number> {
		return this.backend.del(...keys.map((key) => this.key(key)));
	}

	exists(...keys: string[]): Promise<number> {
		return this.backend.exists(...keys.map((key) => this.key(key)));
	}

	expire(key: string, seconds: number): Promise<number> {
		return this.backend.expire(this.key(key), seconds);
	}

	ttl(key: string): Promise<number> {
		return this.backend.ttl(this.key(key));
	}

	incr(key: string): Promise<number> {
		return this.backend.incr(this.key(key));
	}

	decr(key: string): Promise<number> {
		return this.backend.decr(this.key(key));
	}

	incrby(key: string, amount: number): Promise<number> {
		return this.backend.incrby(this.key(key), amount);
	}

	decrby(key: string, amount: number): Promise<number> {
		return this.backend.decrby(this.key(key), amount);
	}

	async keys(pattern: string): Promise<string[]> {
		const keys = await this.backend.keys(`${this.prefix}${pattern}`);
		return keys.map((key) => key.slice(this.prefix.length));
	}

	async flushdb(): Promise<string> {
		const keys = await this.backend.keys(`${this.prefix}*`);
		if (keys.length > 0) await this.backend.del(...keys);
		return 'OK';
	}

	quit(): Promise<string> {
		return this.backend.quit();
	}
}

function patternToRegex(pattern: string): RegExp {
	// Escape every regex metacharacter EXCEPT the glob wildcards and brackets
	// we intentionally support.
	let regexStr = '';
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === '*') {
			regexStr += '.*';
			i++;
		} else if (c === '?') {
			regexStr += '.';
			i++;
		} else if (c === '[') {
			// Find the closing bracket and pass the character class through verbatim
			const close = pattern.indexOf(']', i + 1);
			if (close === -1) {
				// No closing bracket - treat '[' as a literal
				regexStr += '\\[';
				i++;
			} else {
				regexStr += pattern.slice(i, close + 1);
				i = close + 1;
			}
		} else {
			// Escape all other regex metacharacters
			regexStr += c.replace(/[.+^${}()|\\]/g, '\\$&');
			i++;
		}
	}
	return new RegExp(`^${regexStr}$`);
}

// Store Registry & Lifecycle

/** An independently configured store with helpers and lifecycle metadata. */
export interface StoreInstance extends IStore {
	readonly type: StoreType;
	readonly startedAt: number;
	/** Atomically read and delete one value. */
	take<T = unknown>(key: string): Promise<T | null>;
	/** Replace one value only when it still matches the expected value. */
	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean>;
	getOrSet<T>(
		key: string,
		compute: () => Promise<T>,
		options?: StoreSetOptions,
	): Promise<T>;
	delPattern(pattern: string): Promise<number>;
	mset(
		entries: Record<string, unknown>,
		options?: StoreSetOptions,
	): Promise<void>;
	mget<T = unknown>(keys: string[]): Promise<Map<string, T | null>>;
	stats(): Promise<StoreStats>;
	close(): Promise<void>;
}

class ManagedStore implements StoreInstance {
	readonly startedAt = Date.now();
	#closed = false;

	constructor(
		readonly type: StoreType,
		private readonly backend: AtomicStoreBackend,
	) {}

	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string> {
		this.assertOpen();
		return this.backend.set(key, value, options);
	}

	get<T = unknown>(key: string): Promise<T | null> {
		this.assertOpen();
		return this.backend.get<T>(key);
	}

	take<T = unknown>(key: string): Promise<T | null> {
		this.assertOpen();
		return this.backend.take<T>(key);
	}

	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> {
		this.assertOpen();
		return this.backend.compareAndSet(key, expected, next, options);
	}

	del(...keys: string[]): Promise<number> {
		this.assertOpen();
		return this.backend.del(...keys);
	}

	exists(...keys: string[]): Promise<number> {
		this.assertOpen();
		return this.backend.exists(...keys);
	}

	expire(key: string, seconds: number): Promise<number> {
		this.assertOpen();
		return this.backend.expire(key, seconds);
	}

	ttl(key: string): Promise<number> {
		this.assertOpen();
		return this.backend.ttl(key);
	}

	incr(key: string): Promise<number> {
		this.assertOpen();
		return this.backend.incr(key);
	}

	decr(key: string): Promise<number> {
		this.assertOpen();
		return this.backend.decr(key);
	}

	incrby(key: string, amount: number): Promise<number> {
		this.assertOpen();
		return this.backend.incrby(key, amount);
	}

	decrby(key: string, amount: number): Promise<number> {
		this.assertOpen();
		return this.backend.decrby(key, amount);
	}

	keys(pattern: string): Promise<string[]> {
		this.assertOpen();
		return this.backend.keys(pattern);
	}

	flushdb(): Promise<string> {
		this.assertOpen();
		return this.backend.flushdb();
	}

	async quit(): Promise<string> {
		if (this.#closed) return 'OK';
		this.#closed = true;
		return await this.backend.quit();
	}

	async getOrSet<T>(
		key: string,
		compute: () => Promise<T>,
		options?: StoreSetOptions,
	): Promise<T> {
		const cached = await this.get<T>(key);
		if (cached !== null) return cached;
		const value = await compute();
		await this.set(key, value, options);
		return value;
	}

	async delPattern(pattern: string): Promise<number> {
		const matched = await this.keys(pattern);
		if (matched.length === 0) return 0;
		return await this.del(...matched);
	}

	async mset(
		entries: Record<string, unknown>,
		options?: StoreSetOptions,
	): Promise<void> {
		await Promise.all(
			Object.entries(entries).map(([key, value]) =>
				this.set(key, value, options)
			),
		);
	}

	async mget<T = unknown>(
		keys: string[],
	): Promise<Map<string, T | null>> {
		const results = await Promise.all(keys.map((key) => this.get<T>(key)));
		return new Map(keys.map((key, index) => [key, results[index]]));
	}

	async stats(): Promise<StoreStats> {
		this.assertOpen();
		let keyCount: number | undefined;
		try {
			keyCount = (await this.keys('*')).length;
		} catch {
			// Some custom backends may not support wildcard key scans.
		}
		return {
			type: this.type,
			keyCount,
			uptimeMs: Date.now() - this.startedAt,
			backend: this.type,
		};
	}

	async close(): Promise<void> {
		await this.quit();
	}

	private assertOpen(): void {
		if (this.#closed) {
			throw new Error('Store instance is closed.');
		}
	}
}

/**
 * Create a fully independent store instance.
 *
 * Each call can use a different mode and owns its memory/KV lifecycle. An
 * injected Redis client remains caller-owned unless
 * `closeRedisClientOnClose: true` is set. Pass the returned instance through
 * plugin config instead of importing the default application store.
 */
export async function createStore(
	cfg: StoreConfig = {},
): Promise<StoreInstance> {
	const mode = cfg.mode ?? 'memory';
	const fallbackEnabled = cfg.fallbackToMemory !== false;
	const keyPrefix = normalizeKeyPrefix(cfg.keyPrefix);

	async function tryRedis(): Promise<AtomicStoreBackend | null> {
		if (!cfg.redisClient) {
			log.warn('Store: mode=redis but no redisClient provided');
			return null;
		}
		try {
			await cfg.redisClient.ping();
			log.info('Store: Redis backend connected');
			return new RedisStore(
				cfg.redisClient,
				cfg.closeRedisClientOnClose ?? false,
			);
		} catch (error) {
			log.warn('Store: Redis connection failed', error);
			return null;
		}
	}

	async function tryKv(): Promise<AtomicStoreBackend | null> {
		try {
			const kv = await Deno.openKv(cfg.kvPath ?? undefined);
			const prefix = cfg.kvPrefix ?? 'store';
			log.info('Store: Deno KV backend opened', {
				path: cfg.kvPath ?? 'default',
				prefix,
			});
			return new DenoKvStore(kv, prefix);
		} catch (error) {
			log.warn('Store: Deno KV failed to open', error);
			return null;
		}
	}

	function makeMemory(): AtomicStoreBackend {
		log.info('Store: In-memory backend initialized');
		return new MemoryStore();
	}

	let backend: AtomicStoreBackend;
	let resolvedType: StoreType;

	switch (mode) {
		case 'redis': {
			const redisStore = await tryRedis();
			if (redisStore) {
				backend = redisStore;
				resolvedType = 'redis';
			} else if (fallbackEnabled) {
				log.warn('Store: Falling back to in-memory');
				backend = makeMemory();
				resolvedType = 'memory';
			} else {
				throw new Error(
					'Store: Redis backend failed and fallbackToMemory is disabled',
				);
			}
			break;
		}

		case 'kv': {
			const kvStore = await tryKv();
			if (kvStore) {
				backend = kvStore;
				resolvedType = 'kv';
			} else if (fallbackEnabled) {
				log.warn('Store: Falling back to in-memory');
				backend = makeMemory();
				resolvedType = 'memory';
			} else {
				throw new Error(
					'Store: Deno KV backend failed and fallbackToMemory is disabled',
				);
			}
			break;
		}

		case 'memory':
		default:
			backend = makeMemory();
			resolvedType = 'memory';
			break;
	}

	if (keyPrefix) {
		backend = new PrefixedStore(backend, keyPrefix);
	}

	log.info(`Store instance created: type=${resolvedType}`);
	return new ManagedStore(resolvedType, backend);
}

function normalizeKeyPrefix(prefix: string | undefined): string | undefined {
	if (prefix === undefined || prefix.length === 0) return undefined;
	if (/[*?\[\]]/.test(prefix)) {
		throw new Error(
			'Store keyPrefix cannot contain glob characters: *, ?, [ or ].',
		);
	}
	return prefix;
}

/**
 * A registry that owns named store instances and gives each a key prefix.
 * Injected Redis clients remain caller-owned unless explicitly configured.
 */
export interface StoreRegistry {
	register(name: string, config?: StoreConfig): Promise<StoreInstance>;
	get(name: string): StoreInstance;
	has(name: string): boolean;
	names(): readonly string[];
	close(name: string): Promise<boolean>;
	closeAll(): Promise<void>;
}

class StoreRegistryImpl implements StoreRegistry {
	readonly #stores = new Map<string, StoreInstance>();
	readonly #pending = new Set<string>();

	async register(
		name: string,
		config: StoreConfig = {},
	): Promise<StoreInstance> {
		const normalizedName = normalizeStoreName(name);
		if (
			this.#stores.has(normalizedName) ||
			this.#pending.has(normalizedName)
		) {
			throw new Error(`Store "${normalizedName}" is already registered.`);
		}

		this.#pending.add(normalizedName);
		try {
			const instance = await createStore({
				...config,
				keyPrefix: config.keyPrefix ?? `${normalizedName}:`,
			});
			this.#stores.set(normalizedName, instance);
			return instance;
		} finally {
			this.#pending.delete(normalizedName);
		}
	}

	get(name: string): StoreInstance {
		const normalizedName = normalizeStoreName(name);
		const instance = this.#stores.get(normalizedName);
		if (!instance) {
			throw new Error(`Store "${normalizedName}" is not registered.`);
		}
		return instance;
	}

	has(name: string): boolean {
		return this.#stores.has(normalizeStoreName(name));
	}

	names(): readonly string[] {
		return Object.freeze([...this.#stores.keys()]);
	}

	async close(name: string): Promise<boolean> {
		const normalizedName = normalizeStoreName(name);
		const instance = this.#stores.get(normalizedName);
		if (!instance) return false;
		this.#stores.delete(normalizedName);
		await instance.close();
		return true;
	}

	async closeAll(): Promise<void> {
		const instances = [...this.#stores.values()];
		this.#stores.clear();
		await Promise.all(instances.map((instance) => instance.close()));
	}
}

function normalizeStoreName(name: string): string {
	const normalizedName = name.trim();
	if (!normalizedName) {
		throw new Error('Store name cannot be empty.');
	}
	return normalizedName;
}

/** Create a registry that owns all store instances registered in it. */
export function createStoreRegistry(): StoreRegistry {
	return new StoreRegistryImpl();
}

// Backward-compatible default application store.
let _store: StoreInstance | null = null;
let _storeInitialization: Promise<StoreInstance> | null = null;

/**
 * Initialize the store.
 *
 * @example
 * ```ts
 * // Memory (default)
 * await initializeStore({});
 *
 * // Redis - pass a pre-connected client
 * await initializeStore({ mode: 'redis', redisClient: redis.getClient() });
 *
 * // Deno KV
 * await initializeStore({ mode: 'kv', kvPath: './data.db' });
 * ```
 */
export async function initializeStore(
	cfg: StoreConfig = {},
): Promise<StoreInstance> {
	if (_store) return _store;
	if (_storeInitialization) return await _storeInitialization;

	_storeInitialization = createStore({
		...cfg,
		closeRedisClientOnClose: cfg.closeRedisClientOnClose ?? true,
	}).then((instance) => {
		_store = instance;
		return instance;
	});
	try {
		return await _storeInitialization;
	} finally {
		_storeInitialization = null;
	}
}

/** Get the default application store. Throws if it is not initialized. */
export function getStore(): StoreInstance {
	if (!_store) {
		throw new Error('Store not initialized. Call initializeStore() first.');
	}
	return _store;
}

/** Current default store type. */
export function getStoreType(): StoreType {
	return _store?.type ?? 'memory';
}

/** True if the default store has been initialized. */
export function isStoreReady(): boolean {
	return _store !== null;
}

/** Stats about the default application store. */
export function getStoreStats(): Promise<StoreStats> {
	return getStore().stats();
}

/** Close the default store and release its resources. */
export async function closeStore(): Promise<void> {
	const active = _store ??
		(_storeInitialization ? await _storeInitialization : null);
	if (!active) return;
	_store = null;
	try {
		await active.close();
	} catch (error) {
		log.warn('Store: error during close', error);
	}
	log.info('Default store closed');
}

// Convenience wrapper

/** Use these helpers instead of calling `getStore()` directly. */
export const store: {
	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string>;
	get<T = unknown>(key: string): Promise<T | null>;
	take<T = unknown>(key: string): Promise<T | null>;
	compareAndSet<T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean>;
	del(...keys: string[]): Promise<number>;
	exists(...keys: string[]): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
	ttl(key: string): Promise<number>;
	incr(key: string): Promise<number>;
	decr(key: string): Promise<number>;
	incrby(key: string, amount: number): Promise<number>;
	decrby(key: string, amount: number): Promise<number>;
	keys(pattern: string): Promise<string[]>;
	flushdb(): Promise<string>;
	getOrSet<T>(
		key: string,
		compute: () => Promise<T>,
		options?: StoreSetOptions,
	): Promise<T>;
	delPattern(pattern: string): Promise<number>;
	mset(
		entries: Record<string, unknown>,
		options?: StoreSetOptions,
	): Promise<void>;
	mget<T = unknown>(keys: string[]): Promise<Map<string, T | null>>;
} = {
	set: (key, value, options) => getStore().set(key, value, options),

	get: <T = unknown>(key: string): Promise<T | null> =>
		getStore().get(key) as Promise<T | null>,

	take: <T = unknown>(key: string): Promise<T | null> =>
		getStore().take<T>(key),

	compareAndSet: <T>(
		key: string,
		expected: T,
		next: T,
		options?: StoreSetOptions,
	): Promise<boolean> =>
		getStore().compareAndSet(key, expected, next, options),

	del: (...keys: string[]): Promise<number> => getStore().del(...keys),

	exists: (...keys: string[]): Promise<number> => getStore().exists(...keys),

	expire: (key: string, seconds: number): Promise<number> =>
		getStore().expire(key, seconds),

	ttl: (key: string): Promise<number> => getStore().ttl(key),

	incr: (key: string): Promise<number> => getStore().incr(key),

	decr: (key: string): Promise<number> => getStore().decr(key),

	incrby: (key: string, amount: number): Promise<number> =>
		getStore().incrby(key, amount),

	decrby: (key: string, amount: number): Promise<number> =>
		getStore().decrby(key, amount),

	keys: (pattern: string): Promise<string[]> => getStore().keys(pattern),

	flushdb: (): Promise<string> => getStore().flushdb(),

	async getOrSet<T>(
		key: string,
		compute: () => Promise<T>,
		options?: StoreSetOptions,
	): Promise<T> {
		const cached = await getStore().get(key) as T | null;
		if (cached !== null) return cached;
		const value = await compute();
		await getStore().set(key, value, options);
		return value;
	},

	async delPattern(pattern: string): Promise<number> {
		const matched = await getStore().keys(pattern);
		if (matched.length === 0) return 0;
		return getStore().del(...matched);
	},

	async mset(
		entries: Record<string, unknown>,
		options?: StoreSetOptions,
	): Promise<void> {
		const s = getStore();
		await Promise.all(
			Object.entries(entries).map(([k, v]) => s.set(k, v, options)),
		);
	},

	async mget<T = unknown>(keys: string[]): Promise<Map<string, T | null>> {
		const s = getStore();
		const results = await Promise.all(keys.map((k) => s.get(k)));
		return new Map(keys.map((k, i) => [k, results[i] as T | null]));
	},
};

export type {
	IStore,
	StoreConfig,
	StoreSetOptions,
	StoreStats,
	StoreType,
} from '../../types/app.d.ts';
