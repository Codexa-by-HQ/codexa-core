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

import { createLogger } from '../../utils/logger.ts';
import { generateId } from '../../utils/crypto.ts';
import type {
	EventBusConfig,
	EventHandler,
	HandlerEntry,
	HandlerOptions,
	IEventBus,
} from '../../types/app.d.ts';

const log = createLogger('Codexa:EventBus');

// deno-lint-ignore no-explicit-any
type AnyRedisClient = any;

class EventBus implements IEventBus {
	private newHandler = new Map<string, Set<HandlerEntry>>();
	private emitter = new EventTarget();

	private redisSub: AnyRedisClient | null = null;
	private redisClient: AnyRedisClient | null = null;
	private subscribedChannels = new Set<string>();

	private readonly instanceId = generateId();
	private initialized = false;

	private key(channel: string, event: string): string {
		return `${channel}:${event}`;
	}

	/**
	 * Initialize the event bus.
	 *
	 * @param opts.redisClient      - Optional pre-connected Redis client for
	 *                                distributed pub/sub across processes.
	 *                                When omitted, the bus operates in
	 *                                local-only mode.
	 * @param opts.subscribeChannels - Redis channels to subscribe to on startup
	 *                                (requires `redisClient`).
	 */
	async initialize(
		{ redisClient, subscribeChannels }: EventBusConfig = {},
	): Promise<void> {
		if (this.initialized) {
			log.warn('EventBus.initialize() called more than once - skipping');
			return;
		}
		this.initialized = true;

		if (redisClient) {
			this.redisClient = redisClient;
			log.info(
				'EventBus: Redis client registered (distributed mode enabled)',
			);
		} else {
			log.info('EventBus: No Redis client — local-only mode');
		}

		if (subscribeChannels?.length) {
			for (const channel of subscribeChannels) {
				await this.subscribeRedis(channel);
			}
		}

		log.info(`EventBus initialized [instanceId: ${this.instanceId}]`);
	}

	on<T = unknown>(
		channel: string,
		event: string,
		handler: EventHandler<T>,
		options?: HandlerOptions,
	): void {
		const fullKey = this.key(channel, event);

		const wrappedHandler = ((e: Event) => {
			const details = (e as CustomEvent).detail;
			try {
				Promise.resolve(handler(details as T)).catch((err) => {
					log.error(`Async event handler error: ${fullKey}`, err);
				});
			} catch (error) {
				log.error(`Error in event handler for ${fullKey}`, error);
			}
		}) as EventListener;

		this.emitter.addEventListener(fullKey, wrappedHandler, {
			signal: options?.signal,
		});

		const entry: HandlerEntry = {
			channel,
			event,
			originalHandler: handler as EventHandler,
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
				this.off(channel, event, handler as EventHandler);
			});
		}
		log.debug(`Subscribed to ${fullKey}`);
	}

	once<T = unknown>(
		channel: string,
		event: string,
		handler: EventHandler<T>,
		options?: HandlerOptions,
	): void {
		const fullKey = this.key(channel, event);

		const wrappedHandler = ((e: Event) => {
			const details = (e as CustomEvent).detail;
			try {
				Promise.resolve(handler(details as T)).catch((err) => {
					log.error(`Async event handler error: ${fullKey}`, err);
				});
			} catch (err) {
				log.error(`Event handler error: ${fullKey}`, err);
			} finally {
				this.off(channel, event, handler as EventHandler);
			}
		}) as EventListener;

		this.emitter.addEventListener(fullKey, wrappedHandler, {
			once: true,
			signal: options?.signal,
		});

		const entry: HandlerEntry = {
			channel,
			event,
			originalHandler: handler as EventHandler,
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
				this.off(channel, event, handler as EventHandler);
			});
		}

		log.debug(`Subscribed once to: ${fullKey}`);
	}

	/**
	 * Remove handlers. Three call signatures:
	 *   off()                        → remove everything
	 *   off(channel)                 → remove all handlers for a channel
	 *   off(channel, event)          → remove all handlers for channel:event
	 *   off(channel, event, handler) → remove one specific handler
	 */
	off(
		channel?: string,
		event?: string,
		specificHandler?: EventHandler,
	): void {
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
			if (fullKey && key !== fullKey) continue;
			if (!fullKey && !key.startsWith(`${channel}:`)) continue;

			for (const entry of [...set]) {
				if (
					specificHandler && entry.originalHandler !== specificHandler
				) {
					continue;
				}
				this.emitter.removeEventListener(key, entry.wrappedHandler);
				set.delete(entry);
				if (set.size === 0) {
					this.newHandler.delete(key);
				}
			}
		}
		log.debug(
			`Removed handlers for: ${channel}${event ? `:${event}` : ':*'}`,
		);
	}

	/**
	 * Emit an event locally, and optionally publish to Redis (multi-process).
	 * Does not `await` async handlers — use `emitAsync` for that.
	 */
	emit<T = unknown>(
		channel: string,
		event: string,
		data: T,
		options?: { distributed?: boolean },
	): void {
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
			} catch (error) {
				log.error(
					`Failed to publish event to Redis: ${fullKey}`,
					error,
				);
			}
		}
	}

	/** Async local emit — awaits all handlers. Does not support distributed events. */
	async emitAsync<T = unknown>(
		channel: string,
		event: string,
		data: T,
	): Promise<void> {
		const fullKey = this.key(channel, event);
		const set = this.newHandler.get(fullKey);
		if (!set) return;

		await Promise.all(
			[...set].map(async (entry) => {
				try {
					await entry.originalHandler(data);
				} catch (error) {
					log.error(`Async event handler error: ${fullKey}`, error);
				} finally {
					if (entry.isOnce) {
						this.off(channel, event, entry.originalHandler);
					}
				}
			}),
		);
	}

	/** Subscribe to a Redis channel for cross-process events. */
	async subscribeRedis(channel: string): Promise<void> {
		if (!this.isRedisReady() || this.subscribedChannels.has(channel)) {
			return;
		}

		try {
			if (!this.redisSub) {
				// Create a dedicated subscriber from the same connection config
				this.redisSub = this.redisClient.duplicate();

				this.redisSub.on('message', (ch: string, message: string) => {
					try {
						const { event, data, source } = JSON.parse(message);
						if (source === this.instanceId) return;
						const fullKey = this.key(ch, event);
						this.emitter.dispatchEvent(
							new CustomEvent(fullKey, { detail: data }),
						);
						log.debug(
							`Redis event received & dispatched: ${fullKey}`,
						);
					} catch (error) {
						log.error(
							`Failed to parse Redis message: ${message}`,
							error,
						);
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
		} catch (error) {
			log.error(
				`Failed to subscribe to Redis channel: ${channel}`,
				error,
			);
		}
	}

	async unsubscribeRedis(channel: string): Promise<void> {
		if (!this.isRedisReady() || !this.subscribedChannels.has(channel)) {
			return;
		}
		try {
			await this.redisSub?.unsubscribe(channel);
			this.subscribedChannels.delete(channel);
			log.info(`Unsubscribed from Redis channel: ${channel}`);
		} catch (error) {
			log.error(
				`Failed to unsubscribe from Redis channel: ${channel}`,
				error,
			);
		}
	}

	listActiveEvents(): string[] {
		return [...this.newHandler.keys()];
	}

	listenerCount(channel: string, event: string): number {
		const set = this.newHandler.get(this.key(channel, event));
		return set ? set.size : 0;
	}

	hasListeners(channel: string, event: string): boolean {
		return this.listenerCount(channel, event) > 0;
	}

	async destroy(): Promise<void> {
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

	private isRedisReady(): boolean {
		return this.redisClient?.status === 'ready';
	}
}

/** Create an independent event bus instance. */
export function createEventBus(): IEventBus {
	return new EventBus();
}

/** A named collection of independently configured event buses. */
export interface EventBusRegistry {
	register(name: string, config?: EventBusConfig): Promise<IEventBus>;
	get(name: string): IEventBus;
	has(name: string): boolean;
	names(): readonly string[];
	destroy(name: string): Promise<boolean>;
	destroyAll(): Promise<void>;
}

class EventBusRegistryImpl implements EventBusRegistry {
	readonly #buses = new Map<string, IEventBus>();
	readonly #pending = new Set<string>();

	async register(
		name: string,
		config: EventBusConfig = {},
	): Promise<IEventBus> {
		const normalizedName = normalizeBusName(name);
		if (
			this.#buses.has(normalizedName) || this.#pending.has(normalizedName)
		) {
			throw new Error(
				`Event bus "${normalizedName}" is already registered.`,
			);
		}

		this.#pending.add(normalizedName);
		const bus = createEventBus();
		try {
			await bus.initialize(config);
			this.#buses.set(normalizedName, bus);
			return bus;
		} catch (error) {
			await bus.destroy();
			throw error;
		} finally {
			this.#pending.delete(normalizedName);
		}
	}

	get(name: string): IEventBus {
		const normalizedName = normalizeBusName(name);
		const bus = this.#buses.get(normalizedName);
		if (!bus) {
			throw new Error(`Event bus "${normalizedName}" is not registered.`);
		}
		return bus;
	}

	has(name: string): boolean {
		return this.#buses.has(normalizeBusName(name));
	}

	names(): readonly string[] {
		return Object.freeze([...this.#buses.keys()]);
	}

	async destroy(name: string): Promise<boolean> {
		const normalizedName = normalizeBusName(name);
		const bus = this.#buses.get(normalizedName);
		if (!bus) return false;
		this.#buses.delete(normalizedName);
		await bus.destroy();
		return true;
	}

	async destroyAll(): Promise<void> {
		const buses = [...this.#buses.values()];
		this.#buses.clear();
		await Promise.all(buses.map((bus) => bus.destroy()));
	}
}

function normalizeBusName(name: string): string {
	const normalizedName = name.trim();
	if (!normalizedName) {
		throw new Error('Event bus name cannot be empty.');
	}
	return normalizedName;
}

/** Create a registry that owns the lifecycle of its named bus instances. */
export function createEventBusRegistry(): EventBusRegistry {
	return new EventBusRegistryImpl();
}

/**
 * Backward-compatible default application bus.
 * Prefer {@link createEventBus} for plugin-owned or isolated buses.
 */
export const eventBus: IEventBus = createEventBus();

export type {
	EventBusConfig,
	EventHandler,
	HandlerOptions,
	IEventBus,
} from '../../types/app.d.ts';
