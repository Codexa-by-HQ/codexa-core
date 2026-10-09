/**
 * @module @codexa/core/bus
 *
 * Type-safe event bus for Codexa applications.
 *
 * Supports both local (in-process) and distributed (Redis Pub/Sub) event
 * delivery. Provide a Redis client at `initialize()` time to enable
 * distributed mode — local-only mode requires no dependencies.
 *
 * @example Local-only (no Redis needed)
 * ```ts
 * import { createEventBus } from '@codexa/core/bus';
 * const ordersBus = createEventBus();
 * await ordersBus.initialize();
 * ordersBus.on('orders', 'created', (data) => console.log(data));
 * ordersBus.emit('orders', 'created', { id: '123' });
 * ```
 *
 * @example Distributed (with Redis)
 * ```ts
 * import { eventBus } from '@codexa/core/bus';
 * import { createRedisConnection } from '@codexa/core/config';
 *
 * const redis = createRedisConnection({ url: Deno.env.get('REDIS_URL') });
 * await redis.connect();
 *
 * await eventBus.initialize({
 *   redisClient: redis.getClient(),
 *   subscribeChannels: ['orders', 'users'],
 * });
 * ```
 */
import type { EventBusConfig, IEventBus } from "../../types/app.d.ts";
/** Create an independent event bus instance. */
export declare function createEventBus(): IEventBus;
/** A named collection of independently configured event buses. */
export interface EventBusRegistry {
    register(name: string, config?: EventBusConfig): Promise<IEventBus>;
    get(name: string): IEventBus;
    has(name: string): boolean;
    names(): readonly string[];
    destroy(name: string): Promise<boolean>;
    destroyAll(): Promise<void>;
}
/** Create a registry that owns the lifecycle of its named bus instances. */
export declare function createEventBusRegistry(): EventBusRegistry;
/**
 * Backward-compatible default application bus.
 * Prefer {@link createEventBus} for plugin-owned or isolated buses.
 */
export declare const eventBus: IEventBus;
export type { EventBusConfig, EventHandler, HandlerOptions, IEventBus, } from "../../types/app.d.ts";
