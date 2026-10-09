/* @ts-self-types="./mod.d.ts" */
import { store as defaultStore } from "../store/mod.js";
import { createLogger } from "../../utils/logger.js";
const log = createLogger('Codexa:Cache');
export function createCache(namespace, opts = {}) {
    const defaultTtl = opts.defaultTtl ?? 300;
    const prefix = opts.prefix ?? `codexa_cache::${namespace}:`;
    const backingStore = opts.store ?? defaultStore;
    function prefixKey(key) {
        return `${prefix}${key}`;
    }
    function tagKey(tag) {
        return `${prefix}_tag:${tag}`;
    }
    const ns = {
        async get(key) {
            return await backingStore.get(prefixKey(key));
        },
        async set(key, value, options) {
            const ttl = options?.ttl ?? defaultTtl;
            const fullKey = prefixKey(key);
            await backingStore.set(fullKey, value, { ttl });
            if (options?.tags?.length) {
                for (const tag of options.tags) {
                    const tk = tagKey(tag);
                    const existing = await backingStore.get(tk) ?? [];
                    if (!existing.includes(fullKey)) {
                        existing.push(fullKey);
                        await backingStore.set(tk, existing, { ttl: ttl + 60 });
                    }
                }
            }
        },
        async del(key) {
            await backingStore.del(prefixKey(key));
        },
        async has(key) {
            const count = await backingStore.exists(prefixKey(key));
            return count > 0;
        },
        async getOrSet(key, compute, options) {
            const cached = await backingStore.get(prefixKey(key));
            if (cached !== null)
                return cached;
            const value = await compute();
            await ns.set(key, value, options);
            return value;
        },
        async invalidateTag(tag) {
            const tk = tagKey(tag);
            const keys = await backingStore.get(tk);
            if (!keys || keys.length === 0) {
                await backingStore.del(tk);
                return 0;
            }
            const deleted = await backingStore.del(...keys, tk);
            log.debug(`Tag "${tag}" invalidated: ${keys.length} keys removed`);
            return deleted;
        },
        async invalidateTags(tags) {
            let total = 0;
            for (const tag of tags) {
                total += await ns.invalidateTag(tag);
            }
            return total;
        },
        async flush() {
            const keys = await backingStore.keys(`${prefix}*`);
            if (keys.length === 0)
                return 0;
            return await backingStore.del(...keys);
        },
    };
    return ns;
}
export const cache = createCache('global');
