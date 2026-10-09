/* @ts-self-types="./mod.d.ts" */
import { createLogger } from "../../utils/logger.js";
const log = createLogger('Codexa:Store');
function serializeStoreValue(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new TypeError('Store values must be JSON serializable.');
    }
    return serialized;
}
function deserializeStoreValue(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
class MemoryStore {
    store = new Map();
    cleanupInterval = null;
    cleanupMs;
    constructor(cleanupIntervalMs = 60_000) {
        this.cleanupMs = cleanupIntervalMs;
        this.cleanupInterval = setInterval(() => this.cleanup(), this.cleanupMs);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
                this.store.delete(key);
            }
        }
    }
    isExpired(entry) {
        return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
    }
    getEntry(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (this.isExpired(entry)) {
            this.store.delete(key);
            return null;
        }
        return entry;
    }
    set(key, value, options) {
        const ttl = options?.ttl ?? options?.ex;
        const entry = { value };
        if (ttl && ttl > 0) {
            entry.expiresAt = Date.now() + ttl * 1000;
        }
        this.store.set(key, entry);
        return Promise.resolve('OK');
    }
    get(key) {
        const entry = this.getEntry(key);
        return Promise.resolve(entry ? entry.value : null);
    }
    take(key) {
        const entry = this.getEntry(key);
        if (!entry)
            return Promise.resolve(null);
        this.store.delete(key);
        return Promise.resolve(entry.value);
    }
    compareAndSet(key, expected, next, options) {
        const entry = this.getEntry(key);
        if (!entry ||
            serializeStoreValue(entry.value) !== serializeStoreValue(expected))
            return Promise.resolve(false);
        const ttl = options?.ttl ?? options?.ex;
        this.store.set(key, {
            value: next,
            expiresAt: ttl && ttl > 0
                ? Date.now() + ttl * 1000
                : entry.expiresAt,
        });
        return Promise.resolve(true);
    }
    del(...keys) {
        let deleted = 0;
        for (const key of keys) {
            if (this.store.delete(key))
                deleted++;
        }
        return Promise.resolve(deleted);
    }
    exists(...keys) {
        let count = 0;
        for (const key of keys) {
            if (this.getEntry(key))
                count++;
        }
        return Promise.resolve(count);
    }
    expire(key, seconds) {
        const entry = this.getEntry(key);
        if (!entry)
            return Promise.resolve(0);
        entry.expiresAt = Date.now() + seconds * 1000;
        return Promise.resolve(1);
    }
    ttl(key) {
        const entry = this.getEntry(key);
        if (!entry)
            return Promise.resolve(-2);
        if (entry.expiresAt === undefined)
            return Promise.resolve(-1);
        return Promise.resolve(Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)));
    }
    incr(key) {
        return this.incrby(key, 1);
    }
    decr(key) {
        return this.incrby(key, -1);
    }
    incrby(key, amount) {
        const entry = this.getEntry(key);
        const current = entry ? (Number(entry.value) || 0) : 0;
        const next = current + amount;
        this.store.set(key, { value: next, expiresAt: entry?.expiresAt });
        return Promise.resolve(next);
    }
    decrby(key, amount) {
        return this.incrby(key, -amount);
    }
    keys(pattern) {
        const regex = patternToRegex(pattern);
        const result = [];
        for (const [key, entry] of this.store) {
            if (!this.isExpired(entry) && regex.test(key)) {
                result.push(key);
            }
        }
        return Promise.resolve(result);
    }
    flushdb() {
        this.store.clear();
        return Promise.resolve('OK');
    }
    quit() {
        if (this.cleanupInterval !== null) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.store.clear();
        return Promise.resolve('OK');
    }
    size() {
        return this.store.size;
    }
}
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
class RedisStore {
    redis;
    closeClientOnClose;
    constructor(redis, closeClientOnClose) {
        this.redis = redis;
        this.closeClientOnClose = closeClientOnClose;
    }
    async set(key, value, options) {
        const serialized = JSON.stringify(value);
        const ttl = options?.ttl ?? options?.ex;
        if (ttl && ttl > 0) {
            return await this.redis.set(key, serialized, 'EX', ttl);
        }
        return await this.redis.set(key, serialized);
    }
    async get(key) {
        const raw = await this.redis.get(key);
        if (raw === null || raw === undefined)
            return null;
        return deserializeStoreValue(raw);
    }
    async take(key) {
        const raw = await this.redis.eval(REDIS_TAKE_SCRIPT, 1, key);
        if (raw === null || raw === undefined || raw === false)
            return null;
        return deserializeStoreValue(String(raw));
    }
    async compareAndSet(key, expected, next, options) {
        const ttl = options?.ttl ?? options?.ex;
        const result = await this.redis.eval(REDIS_COMPARE_AND_SET_SCRIPT, 1, key, serializeStoreValue(expected), serializeStoreValue(next), ttl && ttl > 0 ? String(ttl) : '');
        return Number(result) === 1;
    }
    async del(...keys) {
        if (keys.length === 0)
            return 0;
        return await this.redis.del(...keys);
    }
    async exists(...keys) {
        if (keys.length === 0)
            return 0;
        return await this.redis.exists(...keys);
    }
    async expire(key, seconds) {
        return await this.redis.expire(key, seconds);
    }
    async ttl(key) {
        return await this.redis.ttl(key);
    }
    async incr(key) {
        return await this.redis.incr(key);
    }
    async decr(key) {
        return await this.redis.decr(key);
    }
    async incrby(key, amount) {
        return await this.redis.incrby(key, amount);
    }
    async decrby(key, amount) {
        return await this.redis.decrby(key, amount);
    }
    async keys(pattern) {
        const connectionPrefix = typeof this.redis.options?.keyPrefix === 'string'
            ? this.redis.options.keyPrefix
            : '';
        const keys = await this.redis.keys(`${connectionPrefix}${pattern}`);
        if (!connectionPrefix)
            return keys;
        return keys.map((key) => key.startsWith(connectionPrefix)
            ? key.slice(connectionPrefix.length)
            : key);
    }
    async flushdb() {
        return await this.redis.flushdb();
    }
    async quit() {
        if (!this.closeClientOnClose)
            return 'OK';
        try {
            return await this.redis.quit();
        }
        catch {
            return 'OK';
        }
    }
}
class DenoKvStore {
    kv;
    prefix;
    cleanupInterval = null;
    cleanupMs;
    constructor(kv, prefix = 'store', cleanupIntervalMs = 60_000) {
        this.kv = kv;
        this.prefix = prefix;
        this.cleanupMs = cleanupIntervalMs;
        this.cleanupInterval = setInterval(() => this.cleanup(), this.cleanupMs);
    }
    parseKey(key) {
        return [this.prefix, key];
    }
    async cleanup() {
        const now = Date.now();
        const iter = this.kv.list({ prefix: [this.prefix] });
        const toDelete = [];
        for await (const entry of iter) {
            if (entry.value?.expiresAt && entry.value.expiresAt <= now) {
                toDelete.push(entry.key);
            }
        }
        for (const k of toDelete) {
            await this.kv.delete(k);
        }
    }
    async set(key, value, options) {
        const ttl = options?.ttl ?? options?.ex;
        const entry = { value };
        const setOptions = {};
        if (ttl && ttl > 0) {
            entry.expiresAt = Date.now() + ttl * 1000;
            setOptions.expireIn = ttl * 1000;
        }
        await this.kv.set(this.parseKey(key), entry, setOptions);
        return 'OK';
    }
    async get(key) {
        const result = await this.kv.get(this.parseKey(key));
        if (result.value === null)
            return null;
        const entry = result.value;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            await this.kv.delete(this.parseKey(key));
            return null;
        }
        return entry.value;
    }
    async take(key) {
        const parsedKey = this.parseKey(key);
        while (true) {
            const result = await this.kv.get(parsedKey);
            if (result.value === null)
                return null;
            const expired = result.value.expiresAt !== undefined &&
                result.value.expiresAt <= Date.now();
            const committed = await this.kv.atomic()
                .check(result)
                .delete(parsedKey)
                .commit();
            if (!committed.ok)
                continue;
            return expired ? null : result.value.value;
        }
    }
    async compareAndSet(key, expected, next, options) {
        const parsedKey = this.parseKey(key);
        const result = await this.kv.get(parsedKey);
        if (result.value === null)
            return false;
        const now = Date.now();
        if ((result.value.expiresAt !== undefined &&
            result.value.expiresAt <= now) ||
            serializeStoreValue(result.value.value) !==
                serializeStoreValue(expected))
            return false;
        const ttl = options?.ttl ?? options?.ex;
        const expiresAt = ttl && ttl > 0
            ? now + ttl * 1000
            : result.value.expiresAt;
        const setOptions = {};
        if (expiresAt !== undefined) {
            setOptions.expireIn = Math.max(1, expiresAt - now);
        }
        const committed = await this.kv.atomic()
            .check(result)
            .set(parsedKey, { value: next, expiresAt }, setOptions)
            .commit();
        return committed.ok;
    }
    async del(...keys) {
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
    async exists(...keys) {
        let count = 0;
        for (const key of keys) {
            const result = await this.kv.get(this.parseKey(key));
            if (result.value !== null) {
                const entry = result.value;
                if (!entry.expiresAt || entry.expiresAt > Date.now()) {
                    count++;
                }
            }
        }
        return count;
    }
    async expire(key, seconds) {
        const result = await this.kv.get(this.parseKey(key));
        if (result.value === null)
            return 0;
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
    async ttl(key) {
        const result = await this.kv.get(this.parseKey(key));
        if (result.value === null)
            return -2;
        const entry = result.value;
        if (!entry.expiresAt)
            return -1;
        if (entry.expiresAt <= Date.now())
            return -2;
        return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    }
    incr(key) {
        return this.incrby(key, 1);
    }
    decr(key) {
        return this.incrby(key, -1);
    }
    async incrby(key, amount) {
        while (true) {
            const result = await this.kv.get(this.parseKey(key));
            const isLive = result.value !== null &&
                (result.value.expiresAt === undefined ||
                    result.value.expiresAt > Date.now());
            const current = isLive ? (Number(result.value.value) || 0) : 0;
            const next = current + amount;
            const newEntry = {
                value: next,
                expiresAt: isLive ? result.value.expiresAt : undefined,
            };
            const op = this.kv.atomic()
                .check(result)
                .set(this.parseKey(key), newEntry);
            const res = await op.commit();
            if (res.ok)
                return next;
        }
    }
    decrby(key, amount) {
        return this.incrby(key, -amount);
    }
    async keys(pattern) {
        const regex = patternToRegex(pattern);
        const result = [];
        const now = Date.now();
        const iter = this.kv.list({ prefix: [this.prefix] });
        for await (const entry of iter) {
            const actualKey = entry.key[1];
            const val = entry.value;
            if (val !== null &&
                (val.expiresAt === undefined || val.expiresAt > now) &&
                regex.test(actualKey)) {
                result.push(actualKey);
            }
        }
        return result;
    }
    async flushdb() {
        const iter = this.kv.list({ prefix: [this.prefix] });
        for await (const entry of iter) {
            await this.kv.delete(entry.key);
        }
        return 'OK';
    }
    quit() {
        if (this.cleanupInterval !== null) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.kv.close();
        return Promise.resolve('OK');
    }
}
class PrefixedStore {
    backend;
    prefix;
    constructor(backend, prefix) {
        this.backend = backend;
        this.prefix = prefix;
    }
    key(key) {
        return `${this.prefix}${key}`;
    }
    set(key, value, options) {
        return this.backend.set(this.key(key), value, options);
    }
    get(key) {
        return this.backend.get(this.key(key));
    }
    take(key) {
        return this.backend.take(this.key(key));
    }
    compareAndSet(key, expected, next, options) {
        return this.backend.compareAndSet(this.key(key), expected, next, options);
    }
    del(...keys) {
        return this.backend.del(...keys.map((key) => this.key(key)));
    }
    exists(...keys) {
        return this.backend.exists(...keys.map((key) => this.key(key)));
    }
    expire(key, seconds) {
        return this.backend.expire(this.key(key), seconds);
    }
    ttl(key) {
        return this.backend.ttl(this.key(key));
    }
    incr(key) {
        return this.backend.incr(this.key(key));
    }
    decr(key) {
        return this.backend.decr(this.key(key));
    }
    incrby(key, amount) {
        return this.backend.incrby(this.key(key), amount);
    }
    decrby(key, amount) {
        return this.backend.decrby(this.key(key), amount);
    }
    async keys(pattern) {
        const keys = await this.backend.keys(`${this.prefix}${pattern}`);
        return keys.map((key) => key.slice(this.prefix.length));
    }
    async flushdb() {
        const keys = await this.backend.keys(`${this.prefix}*`);
        if (keys.length > 0)
            await this.backend.del(...keys);
        return 'OK';
    }
    quit() {
        return this.backend.quit();
    }
}
function patternToRegex(pattern) {
    let regexStr = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        if (c === '*') {
            regexStr += '.*';
            i++;
        }
        else if (c === '?') {
            regexStr += '.';
            i++;
        }
        else if (c === '[') {
            const close = pattern.indexOf(']', i + 1);
            if (close === -1) {
                regexStr += '\\[';
                i++;
            }
            else {
                regexStr += pattern.slice(i, close + 1);
                i = close + 1;
            }
        }
        else {
            regexStr += c.replace(/[.+^${}()|\\]/g, '\\$&');
            i++;
        }
    }
    return new RegExp(`^${regexStr}$`);
}
class ManagedStore {
    type;
    backend;
    startedAt = Date.now();
    #closed = false;
    constructor(type, backend) {
        this.type = type;
        this.backend = backend;
    }
    set(key, value, options) {
        this.assertOpen();
        return this.backend.set(key, value, options);
    }
    get(key) {
        this.assertOpen();
        return this.backend.get(key);
    }
    take(key) {
        this.assertOpen();
        return this.backend.take(key);
    }
    compareAndSet(key, expected, next, options) {
        this.assertOpen();
        return this.backend.compareAndSet(key, expected, next, options);
    }
    del(...keys) {
        this.assertOpen();
        return this.backend.del(...keys);
    }
    exists(...keys) {
        this.assertOpen();
        return this.backend.exists(...keys);
    }
    expire(key, seconds) {
        this.assertOpen();
        return this.backend.expire(key, seconds);
    }
    ttl(key) {
        this.assertOpen();
        return this.backend.ttl(key);
    }
    incr(key) {
        this.assertOpen();
        return this.backend.incr(key);
    }
    decr(key) {
        this.assertOpen();
        return this.backend.decr(key);
    }
    incrby(key, amount) {
        this.assertOpen();
        return this.backend.incrby(key, amount);
    }
    decrby(key, amount) {
        this.assertOpen();
        return this.backend.decrby(key, amount);
    }
    keys(pattern) {
        this.assertOpen();
        return this.backend.keys(pattern);
    }
    flushdb() {
        this.assertOpen();
        return this.backend.flushdb();
    }
    async quit() {
        if (this.#closed)
            return 'OK';
        this.#closed = true;
        return await this.backend.quit();
    }
    async getOrSet(key, compute, options) {
        const cached = await this.get(key);
        if (cached !== null)
            return cached;
        const value = await compute();
        await this.set(key, value, options);
        return value;
    }
    async delPattern(pattern) {
        const matched = await this.keys(pattern);
        if (matched.length === 0)
            return 0;
        return await this.del(...matched);
    }
    async mset(entries, options) {
        await Promise.all(Object.entries(entries).map(([key, value]) => this.set(key, value, options)));
    }
    async mget(keys) {
        const results = await Promise.all(keys.map((key) => this.get(key)));
        return new Map(keys.map((key, index) => [key, results[index]]));
    }
    async stats() {
        this.assertOpen();
        let keyCount;
        try {
            keyCount = (await this.keys('*')).length;
        }
        catch {
        }
        return {
            type: this.type,
            keyCount,
            uptimeMs: Date.now() - this.startedAt,
            backend: this.type,
        };
    }
    async close() {
        await this.quit();
    }
    assertOpen() {
        if (this.#closed) {
            throw new Error('Store instance is closed.');
        }
    }
}
export async function createStore(cfg = {}) {
    const mode = cfg.mode ?? 'memory';
    const fallbackEnabled = cfg.fallbackToMemory !== false;
    const keyPrefix = normalizeKeyPrefix(cfg.keyPrefix);
    async function tryRedis() {
        if (!cfg.redisClient) {
            log.warn('Store: mode=redis but no redisClient provided');
            return null;
        }
        try {
            await cfg.redisClient.ping();
            log.info('Store: Redis backend connected');
            return new RedisStore(cfg.redisClient, cfg.closeRedisClientOnClose ?? false);
        }
        catch (error) {
            log.warn('Store: Redis connection failed', error);
            return null;
        }
    }
    async function tryKv() {
        try {
            const kv = await Deno.openKv(cfg.kvPath ?? undefined);
            const prefix = cfg.kvPrefix ?? 'store';
            log.info('Store: Deno KV backend opened', {
                path: cfg.kvPath ?? 'default',
                prefix,
            });
            return new DenoKvStore(kv, prefix);
        }
        catch (error) {
            log.warn('Store: Deno KV failed to open', error);
            return null;
        }
    }
    function makeMemory() {
        log.info('Store: In-memory backend initialized');
        return new MemoryStore();
    }
    let backend;
    let resolvedType;
    switch (mode) {
        case 'redis': {
            const redisStore = await tryRedis();
            if (redisStore) {
                backend = redisStore;
                resolvedType = 'redis';
            }
            else if (fallbackEnabled) {
                log.warn('Store: Falling back to in-memory');
                backend = makeMemory();
                resolvedType = 'memory';
            }
            else {
                throw new Error('Store: Redis backend failed and fallbackToMemory is disabled');
            }
            break;
        }
        case 'kv': {
            const kvStore = await tryKv();
            if (kvStore) {
                backend = kvStore;
                resolvedType = 'kv';
            }
            else if (fallbackEnabled) {
                log.warn('Store: Falling back to in-memory');
                backend = makeMemory();
                resolvedType = 'memory';
            }
            else {
                throw new Error('Store: Deno KV backend failed and fallbackToMemory is disabled');
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
function normalizeKeyPrefix(prefix) {
    if (prefix === undefined || prefix.length === 0)
        return undefined;
    if (/[*?\[\]]/.test(prefix)) {
        throw new Error('Store keyPrefix cannot contain glob characters: *, ?, [ or ].');
    }
    return prefix;
}
class StoreRegistryImpl {
    #stores = new Map();
    #pending = new Set();
    async register(name, config = {}) {
        const normalizedName = normalizeStoreName(name);
        if (this.#stores.has(normalizedName) ||
            this.#pending.has(normalizedName)) {
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
        }
        finally {
            this.#pending.delete(normalizedName);
        }
    }
    get(name) {
        const normalizedName = normalizeStoreName(name);
        const instance = this.#stores.get(normalizedName);
        if (!instance) {
            throw new Error(`Store "${normalizedName}" is not registered.`);
        }
        return instance;
    }
    has(name) {
        return this.#stores.has(normalizeStoreName(name));
    }
    names() {
        return Object.freeze([...this.#stores.keys()]);
    }
    async close(name) {
        const normalizedName = normalizeStoreName(name);
        const instance = this.#stores.get(normalizedName);
        if (!instance)
            return false;
        this.#stores.delete(normalizedName);
        await instance.close();
        return true;
    }
    async closeAll() {
        const instances = [...this.#stores.values()];
        this.#stores.clear();
        await Promise.all(instances.map((instance) => instance.close()));
    }
}
function normalizeStoreName(name) {
    const normalizedName = name.trim();
    if (!normalizedName) {
        throw new Error('Store name cannot be empty.');
    }
    return normalizedName;
}
export function createStoreRegistry() {
    return new StoreRegistryImpl();
}
let _store = null;
let _storeInitialization = null;
export async function initializeStore(cfg = {}) {
    if (_store)
        return _store;
    if (_storeInitialization)
        return await _storeInitialization;
    _storeInitialization = createStore({
        ...cfg,
        closeRedisClientOnClose: cfg.closeRedisClientOnClose ?? true,
    }).then((instance) => {
        _store = instance;
        return instance;
    });
    try {
        return await _storeInitialization;
    }
    finally {
        _storeInitialization = null;
    }
}
export function getStore() {
    if (!_store) {
        throw new Error('Store not initialized. Call initializeStore() first.');
    }
    return _store;
}
export function getStoreType() {
    return _store?.type ?? 'memory';
}
export function isStoreReady() {
    return _store !== null;
}
export function getStoreStats() {
    return getStore().stats();
}
export async function closeStore() {
    const active = _store ??
        (_storeInitialization ? await _storeInitialization : null);
    if (!active)
        return;
    _store = null;
    try {
        await active.close();
    }
    catch (error) {
        log.warn('Store: error during close', error);
    }
    log.info('Default store closed');
}
export const store = {
    set: (key, value, options) => getStore().set(key, value, options),
    get: (key) => getStore().get(key),
    take: (key) => getStore().take(key),
    compareAndSet: (key, expected, next, options) => getStore().compareAndSet(key, expected, next, options),
    del: (...keys) => getStore().del(...keys),
    exists: (...keys) => getStore().exists(...keys),
    expire: (key, seconds) => getStore().expire(key, seconds),
    ttl: (key) => getStore().ttl(key),
    incr: (key) => getStore().incr(key),
    decr: (key) => getStore().decr(key),
    incrby: (key, amount) => getStore().incrby(key, amount),
    decrby: (key, amount) => getStore().decrby(key, amount),
    keys: (pattern) => getStore().keys(pattern),
    flushdb: () => getStore().flushdb(),
    async getOrSet(key, compute, options) {
        const cached = await getStore().get(key);
        if (cached !== null)
            return cached;
        const value = await compute();
        await getStore().set(key, value, options);
        return value;
    },
    async delPattern(pattern) {
        const matched = await getStore().keys(pattern);
        if (matched.length === 0)
            return 0;
        return getStore().del(...matched);
    },
    async mset(entries, options) {
        const s = getStore();
        await Promise.all(Object.entries(entries).map(([k, v]) => s.set(k, v, options)));
    },
    async mget(keys) {
        const s = getStore();
        const results = await Promise.all(keys.map((k) => s.get(k)));
        return new Map(keys.map((k, i) => [k, results[i]]));
    },
};
