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
import type { IStore, StoreConfig, StoreSetOptions, StoreStats, StoreType } from "../../types/app.d.ts";
/** An independently configured store with helpers and lifecycle metadata. */
export interface StoreInstance extends IStore {
    readonly type: StoreType;
    readonly startedAt: number;
    /** Atomically read and delete one value. */
    take<T = unknown>(key: string): Promise<T | null>;
    /** Replace one value only when it still matches the expected value. */
    compareAndSet<T>(key: string, expected: T, next: T, options?: StoreSetOptions): Promise<boolean>;
    getOrSet<T>(key: string, compute: () => Promise<T>, options?: StoreSetOptions): Promise<T>;
    delPattern(pattern: string): Promise<number>;
    mset(entries: Record<string, unknown>, options?: StoreSetOptions): Promise<void>;
    mget<T = unknown>(keys: string[]): Promise<Map<string, T | null>>;
    stats(): Promise<StoreStats>;
    close(): Promise<void>;
}
/**
 * Create a fully independent store instance.
 *
 * Each call can use a different mode and owns its memory/KV lifecycle. An
 * injected Redis client remains caller-owned unless
 * `closeRedisClientOnClose: true` is set. Pass the returned instance through
 * plugin config instead of importing the default application store.
 */
export declare function createStore(cfg?: StoreConfig): Promise<StoreInstance>;
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
/** Create a registry that owns all store instances registered in it. */
export declare function createStoreRegistry(): StoreRegistry;
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
export declare function initializeStore(cfg?: StoreConfig): Promise<StoreInstance>;
/** Get the default application store. Throws if it is not initialized. */
export declare function getStore(): StoreInstance;
/** Current default store type. */
export declare function getStoreType(): StoreType;
/** True if the default store has been initialized. */
export declare function isStoreReady(): boolean;
/** Stats about the default application store. */
export declare function getStoreStats(): Promise<StoreStats>;
/** Close the default store and release its resources. */
export declare function closeStore(): Promise<void>;
/** Use these helpers instead of calling `getStore()` directly. */
export declare const store: {
    set(key: string, value: unknown, options?: StoreSetOptions): Promise<string>;
    get<T = unknown>(key: string): Promise<T | null>;
    take<T = unknown>(key: string): Promise<T | null>;
    compareAndSet<T>(key: string, expected: T, next: T, options?: StoreSetOptions): Promise<boolean>;
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
    getOrSet<T>(key: string, compute: () => Promise<T>, options?: StoreSetOptions): Promise<T>;
    delPattern(pattern: string): Promise<number>;
    mset(entries: Record<string, unknown>, options?: StoreSetOptions): Promise<void>;
    mget<T = unknown>(keys: string[]): Promise<Map<string, T | null>>;
};
export type { IStore, StoreConfig, StoreSetOptions, StoreStats, StoreType, } from "../../types/app.d.ts";
