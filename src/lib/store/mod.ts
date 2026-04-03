/**
 * @module @codexa/core/store
 *
 * Unified key-value store for Codexa applications.
 *
 * Supports three backends: in-memory (default), Redis, and Deno KV.
 * The backend is chosen at `initializeStore()` time via `StoreConfig`.
 *
 * @example Memory (no config needed)
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

// ── 1. Memory Store ───────────────────────────────────────────────────────────

interface MemoryEntry {
	value: unknown;
	expiresAt?: number;
}

class MemoryStore implements IStore {
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

// ── 2. Redis Store ────────────────────────────────────────────────────────────

class RedisStore implements IStore {
	// deno-lint-ignore no-explicit-any
	constructor(private readonly redis: any) {}

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
		try {
			return JSON.parse(raw) as T;
		} catch {
			return raw as T;
		}
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
		return await this.redis.keys(pattern);
	}

	async flushdb(): Promise<string> {
		return await this.redis.flushdb();
	}

	async quit(): Promise<string> {
		try {
			return await this.redis.quit();
		} catch {
			return 'OK';
		}
	}
}

// ── 3. Deno KV Store ──────────────────────────────────────────────────────────

interface KvEntry {
	value: unknown;
	expiresAt?: number;
}

class DenoKvStore implements IStore {
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

// ── Shared utilities
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

// ── Store Registry & Lifecycle ────────────────────────────────────────────────

let _store: IStore | null = null;
let _storeType: StoreType = 'memory';
let _startedAt = 0;

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
export async function initializeStore(cfg: StoreConfig = {}): Promise<IStore> {
	if (_store) return _store;

	const mode = cfg.mode ?? 'memory';
	const fallbackEnabled = cfg.fallbackToMemory !== false;
	_startedAt = Date.now();

	async function tryRedis(): Promise<IStore | null> {
		if (!cfg.redisClient) {
			log.warn('Store: STORE_MODE=redis but no redisClient provided');
			return null;
		}
		try {
			// Probe the connection with a PING before committing to the backend
			await cfg.redisClient.ping();
			log.info('Store: Redis backend connected');
			return new RedisStore(cfg.redisClient);
		} catch (err) {
			log.warn('Store: Redis connection failed', err);
			return null;
		}
	}

	async function tryKv(): Promise<IStore | null> {
		try {
			const kv = await Deno.openKv(cfg.kvPath ?? undefined);
			const prefix = cfg.kvPrefix ?? 'store';
			log.info('Store: Deno KV backend opened', {
				path: cfg.kvPath ?? 'default',
			});
			return new DenoKvStore(kv, prefix);
		} catch (err) {
			log.warn('Store: Deno KV failed to open', err);
			return null;
		}
	}

	function makeMemory(): IStore {
		log.info('Store: In-memory backend initialized');
		return new MemoryStore();
	}

	switch (mode) {
		case 'redis': {
			const s = await tryRedis();
			if (s) {
				_store = s;
				_storeType = 'redis';
			} else if (fallbackEnabled) {
				log.warn('Store: Falling back to in-memory');
				_store = makeMemory();
				_storeType = 'memory';
			} else {
				throw new Error(
					'Store: Redis backend failed and fallbackToMemory is disabled',
				);
			}
			break;
		}

		case 'kv': {
			const s = await tryKv();
			if (s) {
				_store = s;
				_storeType = 'kv';
			} else if (fallbackEnabled) {
				log.warn('Store: Falling back to in-memory');
				_store = makeMemory();
				_storeType = 'memory';
			} else {
				throw new Error(
					'Store: Deno KV backend failed and fallbackToMemory is disabled',
				);
			}
			break;
		}

		case 'memory':
		default: {
			_store = makeMemory();
			_storeType = 'memory';
			break;
		}
	}

	log.info(`Store initialized: type=${_storeType}`);
	return _store;
}

/** Get the active store. Throws if not initialized. */
export function getStore(): IStore {
	if (!_store) {
		throw new Error('Store not initialized. Call initializeStore() first.');
	}
	return _store;
}

/** Current store type: 'redis' | 'kv' | 'memory' */
export function getStoreType(): StoreType {
	return _storeType;
}

/** True if store has been initialized. */
export function isStoreReady(): boolean {
	return _store !== null;
}

/** Stats about the current store. */
export async function getStoreStats(): Promise<StoreStats> {
	const store = getStore();
	let keyCount: number | undefined;
	try {
		const allKeys = await store.keys('*');
		keyCount = allKeys.length;
	} catch {
		// Not all backends support wildcard keys efficiently
	}
	return {
		type: _storeType,
		keyCount,
		uptimeMs: Date.now() - _startedAt,
		backend: _storeType,
	};
}

/** Close the store and release all resources. */
export async function closeStore(): Promise<void> {
	if (!_store) return;
	try {
		await _store.quit();
	} catch (err) {
		log.warn('Store: error during close', err);
	}
	_store = null;
	_storeType = 'memory';
	_startedAt = 0;
	log.info('Store closed');
}

// ── Convenience wrapper ───────────────────────────────────────────────────────

/** Use these helpers instead of calling `getStore()` directly. */
export const store: {
	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string>;
	get<T = unknown>(key: string): Promise<T | null>;
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
