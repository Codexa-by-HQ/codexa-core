/**
 * @module @codexa/core/cache
 *
 * Namespaced caching layer built on top of `@codexa/core/store`.
 *
 * @example
 * ```ts
 * import { initializeStore } from '@codexa/core/store';
 * import { createCache, cache } from '@codexa/core/cache';
 *
 * await initializeStore({});
 * const userCache = createCache('users');
 * await userCache.set('u123', userData, { ttl: 600, tags: ['user:u123'] });
 * const user = await userCache.get<User>('u123');
 * await userCache.invalidateTag('user:u123');
 * ```
 */

import { store } from '../store/mod.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('Codexa:Cache');

const TAG_PREFIX = '_tag:';

/** Options accepted by {@link createCache}. */
export interface CacheOptions {
	/** Default TTL in seconds for entries in this namespace (default: 300). */
	defaultTtl?: number;
	/** Key prefix override (default: `'codexa_cache::<namespace>:'`). */
	prefix?: string;
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
	getOrSet<T>(
		key: string,
		compute: () => Promise<T>,
		options?: CacheSetOptions,
	): Promise<T>;
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
export function createCache(
	namespace: string,
	opts: CacheOptions = {},
): CacheNamespace {
	const defaultTtl = opts.defaultTtl ?? 300;
	const prefix = opts.prefix ?? `codexa_cache::${namespace}:`;

	function prefixKey(key: string): string {
		return `${prefix}${key}`;
	}

	function tagKey(tag: string): string {
		return `${TAG_PREFIX}${tag}`;
	}

	const ns: CacheNamespace = {
		async get<T = unknown>(key: string): Promise<T | null> {
			return await store.get<T>(prefixKey(key));
		},

		async set(
			key: string,
			value: unknown,
			options?: CacheSetOptions,
		): Promise<void> {
			const ttl = options?.ttl ?? defaultTtl;
			const fullKey = prefixKey(key);
			await store.set(fullKey, value, { ttl });
			if (options?.tags?.length) {
				for (const tag of options.tags) {
					const tk = tagKey(tag);
					const existing = await store.get<string[]>(tk) ?? [];
					if (!existing.includes(fullKey)) {
						existing.push(fullKey);
						await store.set(tk, existing, { ttl: ttl + 60 });
					}
				}
			}
		},

		async del(key: string): Promise<void> {
			await store.del(prefixKey(key));
		},

		async has(key: string): Promise<boolean> {
			const count = await store.exists(prefixKey(key));
			return count > 0;
		},

		async getOrSet<T>(
			key: string,
			compute: () => Promise<T>,
			options?: CacheSetOptions,
		): Promise<T> {
			const cached = await store.get<T>(prefixKey(key));
			if (cached !== null) return cached;
			const value = await compute();
			await ns.set(key, value, options);
			return value;
		},

		async invalidateTag(tag: string): Promise<number> {
			const tk = tagKey(tag);
			const keys = await store.get<string[]>(tk);
			if (!keys || keys.length === 0) {
				await store.del(tk);
				return 0;
			}
			const deleted = await store.del(...keys, tk);
			log.debug(`Tag "${tag}" invalidated: ${keys.length} keys removed`);
			return deleted;
		},

		async invalidateTags(tags: string[]): Promise<number> {
			let total = 0;
			for (const tag of tags) {
				total += await ns.invalidateTag(tag);
			}
			return total;
		},

		async flush(): Promise<number> {
			return await store.delPattern(`${prefix}*`);
		},
	};

	return ns;
}

/** Global cache instance with no namespace (for quick one-off caching). */
export const cache: CacheNamespace = createCache('global');
