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

import IoRedis from 'ioredis';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('Redis');

// ioredis default export in Deno may be wrapped in a namespace object.
// We need the actual class constructor regardless of module format.
// deno-lint-ignore no-explicit-any
const _mod = IoRedis as any;
// deno-lint-ignore no-explicit-any
const Redis: any = typeof _mod.default === 'function' ? _mod.default : _mod;

/**
 * Re-exported Redis client type so consumers don't need to
 * install ioredis directly.
 */
// deno-lint-ignore no-explicit-any
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
	 * Connect to Redis. Safe to call multiple times — subsequent calls return
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
 * Build an ioredis client instance from config. NOT yet connected.
 */
function buildClient(
	config: RedisConnectionConfig,
	role: string,
): RedisClient {
	const keyPrefix = config.keyPrefix ?? 'codexa::';
	const maxRetries = config.maxRetries ?? 5;

	const retryStrategy = (times: number): number | null => {
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

/**
 * Wait for an ioredis client to reach "ready" state, with timeout.
 */
function waitForReady(
	client: RedisClient,
	role: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		// If already ready, resolve immediately
		if (client.status === 'ready') {
			resolve();
			return;
		}

		const timer = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					`Redis ${role} connection timed out after ${timeoutMs}ms`,
				),
			);
		}, timeoutMs);

		function onReady(): void {
			cleanup();
			resolve();
		}
		function onError(err: Error): void {
			cleanup();
			reject(err);
		}
		function cleanup(): void {
			clearTimeout(timer);
			client.removeListener('ready', onReady);
			client.removeListener('error', onError);
		}

		client.once('ready', onReady);
		client.once('error', onError);
	});
}

/**
 * Create a managed Redis connection.
 *
 * The connection is **not opened** until you call `.connect()`.
 */
export function createRedisConnection(
	config: RedisConnectionConfig,
): RedisConnection {
	let mainClient: RedisClient | null = null;
	let subClient: RedisClient | null = null;
	let connectingPromise: Promise<RedisClient> | null = null;
	const timeoutMs = config.connectTimeoutMS ?? 10_000;

	function wireEvents(client: RedisClient, role: string): void {
		client.on('connect', () => log.debug(`Redis ${role}: TCP connected`));
		client.on('ready', () => log.info(`Redis ${role}: ready`));
		client.on('error', (error: Error) =>
			log.error(`Redis ${role} error`, error)
		);
		client.on('close', () =>
			log.warn(`Redis ${role}: connection closed`)
		);
		client.on('reconnecting', () =>
			log.info(`Redis ${role}: reconnecting...`)
		);
	}

	async function _connect(): Promise<RedisClient> {
		// Build main client
		const client = buildClient(config, 'main');
		wireEvents(client, 'main');

		try {
			// Start connection and wait for ready
			client.connect().catch(() => {
				// Error handled via event listener
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

			// Create subscriber client if pub/sub enabled
			if (config.enablePubSub) {
				const sub = buildClient(config, 'subscriber');
				wireEvents(sub, 'subscriber');
				sub.connect().catch(() => {});
				await waitForReady(sub, 'subscriber', timeoutMs);
				subClient = sub;
				log.info('Redis subscriber client ready (pub/sub enabled)');
			}

			return mainClient;
		} catch (error) {
			log.error('Failed to connect to Redis', error);
			await client.quit().catch(() => {});
			mainClient = null;
			subClient = null;
			throw error;
		}
	}

	return {
		connect(): Promise<RedisClient> {
			if (mainClient && mainClient.status === 'ready') {
				log.debug('Redis already connected');
				return Promise.resolve(mainClient);
			}
			if (connectingPromise) {
				log.debug(
					'Redis connection already in progress — awaiting',
				);
				return connectingPromise;
			}
			connectingPromise = _connect().finally(() => {
				connectingPromise = null;
			});
			return connectingPromise;
		},

		async disconnect(): Promise<void> {
			if (subClient) {
				const closingSub = subClient;
				subClient = null;
				await closingSub.quit().catch(() => {});
				log.info('Redis subscriber disconnected');
			}
			if (!mainClient) return;
			const closing = mainClient;
			mainClient = null;
			await closing.quit();
			log.info('Disconnected from Redis');
		},

		getClient(): RedisClient {
			if (!mainClient) {
				throw new Error(
					'Redis not connected. Call connect() first.',
				);
			}
			return mainClient;
		},

		isReady(): boolean {
			return mainClient?.status === 'ready';
		},

		getSubscriber(): RedisClient {
			if (!config.enablePubSub) {
				throw new Error(
					'Pub/Sub is not enabled. Pass `enablePubSub: true` to createRedisConnection().',
				);
			}
			if (!subClient) {
				throw new Error(
					'Redis subscriber not connected. Call connect() first.',
				);
			}
			return subClient;
		},

		async createSubscriberClient(): Promise<RedisClient> {
			const client = buildClient(config, 'subscriber');
			wireEvents(client, 'additional-subscriber');
			client.connect().catch(() => {});
			await waitForReady(client, 'additional-subscriber', timeoutMs);
			return client;
		},
	};
}
