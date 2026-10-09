/**
 * @module redis
 *
 * Managed Redis connection factory for `@codexa/core`.
 *
 * @example Basic connection
 * ```ts
 * import { createRedisConnection } from '@codexa/core/config';
 *
 * const redis = createRedisConnection({
 *   url: 'redis://localhost:6379',
 * });
 * await redis.connect();
 * const client = redis.getClient();
 * await client.set('hello', 'world');
 * ```
 *
 * @example With pub/sub
 * ```ts
 * const redis = createRedisConnection({
 *   url: 'redis://localhost:6379',
 *   enablePubSub: true,
 * });
 * await redis.connect();
 *
 * const sub = redis.getSubscriber();
 * sub.on('message', (channel, message) => console.log(channel, message));
 * await sub.subscribe('events');
 *
 * redis.getClient().publish('events', JSON.stringify({ type: 'test' }));
 * ```
 */
/**
 * Re-exported Redis client type so consumers don't need to
 * install ioredis directly.
 */
export type RedisClient = any;
/**
 * Configuration for {@link createRedisConnection}.
 *
 * Either provide a `url` (e.g. `redis://user:pass@host:6379/0`)
 * or supply individual `host` / `port` / `password` / `db` fields.
 */
export interface RedisConnectionConfig {
    /** Full Redis URL. Takes priority over individual fields when provided. */
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    /** Redis database index (default: 0) */
    db?: number;
    /** Key prefix applied to every command (default: 'codexa::') */
    keyPrefix?: string;
    /** Connection timeout in ms (default: 10 000) */
    connectTimeoutMS?: number;
    /** Max retry attempts before giving up (default: 5) */
    maxRetries?: number;
    /**
     * Create a dedicated subscriber client alongside the main client.
     * Required for Redis pub/sub (subscribe/psubscribe need a separate connection).
     * @default false
     */
    enablePubSub?: boolean;
}
/**
 * A managed Redis connection returned by {@link createRedisConnection}.
 */
export interface RedisConnection {
    /**
     * Connect to Redis. Safe to call multiple times - subsequent calls return
     * the existing client.
     */
    connect(): Promise<RedisClient>;
    /** Gracefully disconnect from Redis (and subscriber if enabled). */
    disconnect(): Promise<void>;
    /** Return the active Redis client. Throws if not connected. */
    getClient(): RedisClient;
    /** True when the client is in the "ready" state. */
    isReady(): boolean;
    /**
     * Return the dedicated subscriber client.
     * Only available when `enablePubSub: true` was passed to the config.
     * Throws if pub/sub is not enabled or not connected.
     */
    getSubscriber(): RedisClient;
    /**
     * Create an additional dedicated subscriber client using the same config.
     * Callers are responsible for calling `.quit()` on the returned client.
     */
    createSubscriberClient(): Promise<RedisClient>;
}
/**
 * Create a managed Redis connection.
 *
 * The connection is **not opened** until you call `.connect()`.
 */
export declare function createRedisConnection(config: RedisConnectionConfig): RedisConnection;
