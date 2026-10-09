/* @ts-self-types="./redis.d.ts" */
import IoRedis from "../providers/ioredis.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger('Codexa:Redis');
const _mod = IoRedis;
const Redis = typeof _mod.default === 'function' ? _mod.default : _mod;
function buildClient(config, role) {
    const keyPrefix = config.keyPrefix ?? 'codexa::';
    const maxRetries = config.maxRetries ?? 5;
    const retryStrategy = (times) => {
        if (times > maxRetries) {
            log.warn(`Redis ${role} retry limit (${maxRetries}) exceeded`);
            return null;
        }
        const delay = Math.min(times * 500, 3000);
        log.info(`Redis ${role} retry attempt ${times}, delay: ${delay}ms`);
        return delay;
    };
    const commonOpts = {
        keyPrefix: role === 'subscriber' ? undefined : keyPrefix,
        retryStrategy,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectTimeout: config.connectTimeoutMS ?? 10_000,
    };
    if (config.url) {
        return new Redis(config.url, commonOpts);
    }
    return new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password || undefined,
        db: config.db ?? 0,
        ...commonOpts,
    });
}
function waitForReady(client, role, timeoutMs) {
    return new Promise((resolve, reject) => {
        if (client.status === 'ready') {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Redis ${role} connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        function onReady() {
            cleanup();
            resolve();
        }
        function onError(err) {
            cleanup();
            reject(err);
        }
        function cleanup() {
            clearTimeout(timer);
            client.removeListener('ready', onReady);
            client.removeListener('error', onError);
        }
        client.once('ready', onReady);
        client.once('error', onError);
    });
}
export function createRedisConnection(config) {
    let mainClient = null;
    let subClient = null;
    let connectingPromise = null;
    const timeoutMs = config.connectTimeoutMS ?? 10_000;
    function wireEvents(client, role) {
        client.on('connect', () => log.debug(`Redis ${role}: TCP connected`));
        client.on('ready', () => log.info(`Redis ${role}: ready`));
        client.on('error', (error) => log.error(`Redis ${role} error`, error));
        client.on('close', () => log.warn(`Redis ${role}: connection closed`));
        client.on('reconnecting', () => log.info(`Redis ${role}: reconnecting...`));
    }
    async function _connect() {
        const client = buildClient(config, 'main');
        wireEvents(client, 'main');
        try {
            client.connect().catch(() => {
            });
            await waitForReady(client, 'main', timeoutMs);
            log.info('Redis connected', {
                host: client.options?.host,
                port: client.options?.port,
                db: client.options?.db,
                keyPrefix: client.options?.keyPrefix,
                pubSub: config.enablePubSub ?? false,
            });
            mainClient = client;
            if (config.enablePubSub) {
                const sub = buildClient(config, 'subscriber');
                wireEvents(sub, 'subscriber');
                sub.connect().catch(() => { });
                await waitForReady(sub, 'subscriber', timeoutMs);
                subClient = sub;
                log.info('Redis subscriber client ready (pub/sub enabled)');
            }
            return mainClient;
        }
        catch (error) {
            log.error('Failed to connect to Redis', error);
            await client.quit().catch(() => { });
            mainClient = null;
            subClient = null;
            throw error;
        }
    }
    return {
        connect() {
            if (mainClient && mainClient.status === 'ready') {
                log.debug('Redis already connected');
                return Promise.resolve(mainClient);
            }
            if (connectingPromise) {
                log.debug('Redis connection already in progress - awaiting');
                return connectingPromise;
            }
            connectingPromise = _connect().finally(() => {
                connectingPromise = null;
            });
            return connectingPromise;
        },
        async disconnect() {
            if (subClient) {
                const closingSub = subClient;
                subClient = null;
                await closingSub.quit().catch(() => { });
                log.info('Redis subscriber disconnected');
            }
            if (!mainClient)
                return;
            const closing = mainClient;
            mainClient = null;
            await closing.quit();
            log.info('Disconnected from Redis');
        },
        getClient() {
            if (!mainClient) {
                throw new Error('Redis not connected. Call connect() first.');
            }
            return mainClient;
        },
        isReady() {
            return mainClient?.status === 'ready';
        },
        getSubscriber() {
            if (!config.enablePubSub) {
                throw new Error('Pub/Sub is not enabled. Pass `enablePubSub: true` to createRedisConnection().');
            }
            if (!subClient) {
                throw new Error('Redis subscriber not connected. Call connect() first.');
            }
            return subClient;
        },
        async createSubscriberClient() {
            const client = buildClient(config, 'subscriber');
            wireEvents(client, 'additional-subscriber');
            client.connect().catch(() => { });
            await waitForReady(client, 'additional-subscriber', timeoutMs);
            return client;
        },
    };
}
