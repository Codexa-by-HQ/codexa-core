/* @ts-self-types="./mod.d.ts" */
import { createLogger } from "../../utils/logger.js";
import { generateId } from "../../utils/crypto.js";
const log = createLogger('Codexa:EventBus');
class EventBus {
    newHandler = new Map();
    emitter = new EventTarget();
    redisSub = null;
    redisClient = null;
    subscribedChannels = new Set();
    instanceId = generateId();
    initialized = false;
    key(channel, event) {
        return `${channel}:${event}`;
    }
    async initialize({ redisClient, subscribeChannels } = {}) {
        if (this.initialized) {
            log.warn('EventBus.initialize() called more than once - skipping');
            return;
        }
        this.initialized = true;
        if (redisClient) {
            this.redisClient = redisClient;
            log.info('EventBus: Redis client registered (distributed mode enabled)');
        }
        else {
            log.info('EventBus: No Redis client — local-only mode');
        }
        if (subscribeChannels?.length) {
            for (const channel of subscribeChannels) {
                await this.subscribeRedis(channel);
            }
        }
        log.info(`EventBus initialized [instanceId: ${this.instanceId}]`);
    }
    on(channel, event, handler, options) {
        const fullKey = this.key(channel, event);
        const wrappedHandler = ((e) => {
            const details = e.detail;
            try {
                Promise.resolve(handler(details)).catch((err) => {
                    log.error(`Async event handler error: ${fullKey}`, err);
                });
            }
            catch (error) {
                log.error(`Error in event handler for ${fullKey}`, error);
            }
        });
        this.emitter.addEventListener(fullKey, wrappedHandler, {
            signal: options?.signal,
        });
        const entry = {
            channel,
            event,
            originalHandler: handler,
            wrappedHandler,
            isOnce: false,
        };
        let set = this.newHandler.get(fullKey);
        if (!set) {
            set = new Set();
            this.newHandler.set(fullKey, set);
        }
        set.add(entry);
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off(channel, event, handler);
            });
        }
        log.debug(`Subscribed to ${fullKey}`);
    }
    once(channel, event, handler, options) {
        const fullKey = this.key(channel, event);
        const wrappedHandler = ((e) => {
            const details = e.detail;
            try {
                Promise.resolve(handler(details)).catch((err) => {
                    log.error(`Async event handler error: ${fullKey}`, err);
                });
            }
            catch (err) {
                log.error(`Event handler error: ${fullKey}`, err);
            }
            finally {
                this.off(channel, event, handler);
            }
        });
        this.emitter.addEventListener(fullKey, wrappedHandler, {
            once: true,
            signal: options?.signal,
        });
        const entry = {
            channel,
            event,
            originalHandler: handler,
            wrappedHandler,
            isOnce: true,
        };
        let set = this.newHandler.get(fullKey);
        if (!set) {
            set = new Set();
            this.newHandler.set(fullKey, set);
        }
        set.add(entry);
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off(channel, event, handler);
            });
        }
        log.debug(`Subscribed once to: ${fullKey}`);
    }
    off(channel, event, specificHandler) {
        if (!channel) {
            for (const [key, set] of this.newHandler) {
                for (const entry of set) {
                    this.emitter.removeEventListener(key, entry.wrappedHandler);
                }
            }
            this.newHandler.clear();
            this.emitter = new EventTarget();
            log.debug('All event handlers removed');
            return;
        }
        const fullKey = event ? this.key(channel, event) : null;
        for (const [key, set] of this.newHandler) {
            if (fullKey && key !== fullKey)
                continue;
            if (!fullKey && !key.startsWith(`${channel}:`))
                continue;
            for (const entry of [...set]) {
                if (specificHandler && entry.originalHandler !== specificHandler) {
                    continue;
                }
                this.emitter.removeEventListener(key, entry.wrappedHandler);
                set.delete(entry);
                if (set.size === 0) {
                    this.newHandler.delete(key);
                }
            }
        }
        log.debug(`Removed handlers for: ${channel}${event ? `:${event}` : ':*'}`);
    }
    emit(channel, event, data, options) {
        const fullKey = this.key(channel, event);
        this.emitter.dispatchEvent(new CustomEvent(fullKey, { detail: data }));
        log.debug(`Emitted locally: ${fullKey}`);
        if (this.isRedisReady() && options?.distributed) {
            try {
                const payload = JSON.stringify({
                    event,
                    data,
                    source: this.instanceId,
                    timestamp: new Date().toISOString(),
                });
                this.redisClient.publish(channel, payload);
            }
            catch (error) {
                log.error(`Failed to publish event to Redis: ${fullKey}`, error);
            }
        }
    }
    async emitAsync(channel, event, data) {
        const fullKey = this.key(channel, event);
        const set = this.newHandler.get(fullKey);
        if (!set)
            return;
        await Promise.all([...set].map(async (entry) => {
            try {
                await entry.originalHandler(data);
            }
            catch (error) {
                log.error(`Async event handler error: ${fullKey}`, error);
            }
            finally {
                if (entry.isOnce) {
                    this.off(channel, event, entry.originalHandler);
                }
            }
        }));
    }
    async subscribeRedis(channel) {
        if (!this.isRedisReady() || this.subscribedChannels.has(channel)) {
            return;
        }
        try {
            if (!this.redisSub) {
                this.redisSub = this.redisClient.duplicate();
                this.redisSub.on('message', (ch, message) => {
                    try {
                        const { event, data, source } = JSON.parse(message);
                        if (source === this.instanceId)
                            return;
                        const fullKey = this.key(ch, event);
                        this.emitter.dispatchEvent(new CustomEvent(fullKey, { detail: data }));
                        log.debug(`Redis event received & dispatched: ${fullKey}`);
                    }
                    catch (error) {
                        log.error(`Failed to parse Redis message: ${message}`, error);
                    }
                });
                this.redisSub.on('end', () => {
                    log.warn('Redis subscriber connection ended — state reset');
                    this.redisSub = null;
                    this.subscribedChannels.clear();
                });
            }
            await this.redisSub.subscribe(channel);
            this.subscribedChannels.add(channel);
            log.info(`Subscribed to Redis channel: ${channel}`);
        }
        catch (error) {
            log.error(`Failed to subscribe to Redis channel: ${channel}`, error);
        }
    }
    async unsubscribeRedis(channel) {
        if (!this.isRedisReady() || !this.subscribedChannels.has(channel)) {
            return;
        }
        try {
            await this.redisSub?.unsubscribe(channel);
            this.subscribedChannels.delete(channel);
            log.info(`Unsubscribed from Redis channel: ${channel}`);
        }
        catch (error) {
            log.error(`Failed to unsubscribe from Redis channel: ${channel}`, error);
        }
    }
    listActiveEvents() {
        return [...this.newHandler.keys()];
    }
    listenerCount(channel, event) {
        const set = this.newHandler.get(this.key(channel, event));
        return set ? set.size : 0;
    }
    hasListeners(channel, event) {
        return this.listenerCount(channel, event) > 0;
    }
    async destroy() {
        this.off();
        if (this.redisSub) {
            await this.redisSub.quit();
            this.redisSub = null;
        }
        this.redisClient = null;
        this.subscribedChannels.clear();
        this.initialized = false;
        log.info('EventBus destroyed');
    }
    isRedisReady() {
        return this.redisClient?.status === 'ready';
    }
}
export function createEventBus() {
    return new EventBus();
}
class EventBusRegistryImpl {
    #buses = new Map();
    #pending = new Set();
    async register(name, config = {}) {
        const normalizedName = normalizeBusName(name);
        if (this.#buses.has(normalizedName) || this.#pending.has(normalizedName)) {
            throw new Error(`Event bus "${normalizedName}" is already registered.`);
        }
        this.#pending.add(normalizedName);
        const bus = createEventBus();
        try {
            await bus.initialize(config);
            this.#buses.set(normalizedName, bus);
            return bus;
        }
        catch (error) {
            await bus.destroy();
            throw error;
        }
        finally {
            this.#pending.delete(normalizedName);
        }
    }
    get(name) {
        const normalizedName = normalizeBusName(name);
        const bus = this.#buses.get(normalizedName);
        if (!bus) {
            throw new Error(`Event bus "${normalizedName}" is not registered.`);
        }
        return bus;
    }
    has(name) {
        return this.#buses.has(normalizeBusName(name));
    }
    names() {
        return Object.freeze([...this.#buses.keys()]);
    }
    async destroy(name) {
        const normalizedName = normalizeBusName(name);
        const bus = this.#buses.get(normalizedName);
        if (!bus)
            return false;
        this.#buses.delete(normalizedName);
        await bus.destroy();
        return true;
    }
    async destroyAll() {
        const buses = [...this.#buses.values()];
        this.#buses.clear();
        await Promise.all(buses.map((bus) => bus.destroy()));
    }
}
function normalizeBusName(name) {
    const normalizedName = name.trim();
    if (!normalizedName) {
        throw new Error('Event bus name cannot be empty.');
    }
    return normalizedName;
}
export function createEventBusRegistry() {
    return new EventBusRegistryImpl();
}
export const eventBus = createEventBus();
