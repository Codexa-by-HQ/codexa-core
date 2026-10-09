/**
 * @module @codexa/core/cache
 *
 * Namespaced caching layer built on top of `@codexa/core/store`.
 *
 * @example
 * ```ts
 * import { createStore } from '@codexa/core/store';
 * import { createCache } from '@codexa/core/cache';
 *
 * const authStore = await createStore({ mode: 'memory' });
 * const userCache = createCache('users', { store: authStore });
 * await userCache.set('u123', userData, { ttl: 600, tags: ['user:u123'] });
 * const user = await userCache.get<User>('u123');
 * await userCache.invalidateTag('user:u123');
 * ```
 */
import type { IStore } from "../store/mod.d.ts";
/** Minimal store contract required by a cache instance. */
export type CacheStore = Pick<IStore, 'get' | 'set' | 'del' | 'exists' | 'keys'>;
/** Options accepted by {@link createCache}. */
export interface CacheOptions {
    /** Default TTL in seconds for entries in this namespace (default: 300). */
    defaultTtl?: number;
    /** Key prefix override (default: `'codexa_cache::<namespace>:'`). */
    prefix?: string;
    /** Store instance used by this cache (default: application store facade). */
    store?: CacheStore;
}
export interface CacheSetOptions {
    /** TTL in seconds (default: namespace defaultTtl or 300). */
    ttl?: number;
    /** Tags for group invalidation. */
    tags?: string[];
}
/** Interface returned by {@link createCache}. */
export interface CacheNamespace {
    /** Get a cached value. Returns `null` if not found or expired. */
    get<T = unknown>(key: string): Promise<T | null>;
    /** Set a value with optional TTL and tags. */
    set(key: string, value: unknown, options?: CacheSetOptions): Promise<void>;
    /** Delete a specific key. */
    del(key: string): Promise<void>;
    /** True if the key exists and has not expired. */
    has(key: string): Promise<boolean>;
    /**
     * Cache-aside: get from cache, or compute + cache the result.
     * @example
     * ```ts
     * const user = await userCache.getOrSet('u123', () => fetchUser('u123'), { ttl: 600 });
     * ```
     */
    getOrSet<T>(key: string, compute: () => Promise<T>, options?: CacheSetOptions): Promise<T>;
    /**
     * Invalidate all cache entries associated with a tag.
     * Deletes both the tagged keys and the tag registry entry.
     */
    invalidateTag(tag: string): Promise<number>;
    /** Invalidate multiple tags at once. */
    invalidateTags(tags: string[]): Promise<number>;
    /** Delete all keys in this namespace. */
    flush(): Promise<number>;
}
/**
 * Create a namespaced cache instance.
 * All keys are prefixed with `codexa_cache:<namespace>:` to avoid collisions.
 */
export declare function createCache(namespace: string, opts?: CacheOptions): CacheNamespace;
/** Global cache instance with no namespace (for quick one-off caching). */
export declare const cache: CacheNamespace;
