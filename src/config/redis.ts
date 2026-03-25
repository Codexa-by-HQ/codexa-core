import IoRedis from 'ioredis';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('Redis');

// ioredis default export in Deno resolves to a namespace — grab the constructor.
const Redis = IoRedis.default ?? IoRedis;

/** Re-exported so consumers don't need to import ioredis directly. */
export type RedisClient = InstanceType<typeof Redis>;

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
	/** Gracefully disconnect from Redis. */
	disconnect(): Promise<void>;
	/** Return the active Redis client. Throws if not connected. */
	getClient(): RedisClient;
	/** True when the client is in the "ready" state. */
	isReady(): boolean;
	/**
	 * Create a dedicated subscriber client using the same config.
	 * ioredis requires a separate connection for `subscribe`/`psubscribe`.
	 * Callers are responsible for calling `.quit()` on the returned client.
	 */
	createSubscriberClient(): Promise<RedisClient>;
}

function retryStrategy(times: number): number | null {
	if (times > 3) {
		log.warn('Redis retry limit exceeded, giving up');
		return null;
	}
	const delay = Math.min(times * 500, 2000);
	log.info(`Redis retry attempt ${times}, delay: ${delay}ms`);
	return delay;
}

function buildIoRedis(config: RedisConnectionConfig): RedisClient {
	const keyPrefix = config.keyPrefix ?? 'codexa::';

	if (config.url) {
		return new Redis(config.url, { keyPrefix, retryStrategy, lazyConnect: true });
	}

	return new Redis({
		host: config.host ?? 'localhost',
		port: config.port ?? 6379,
		password: config.password || undefined,
		db: config.db ?? 0,
		keyPrefix,
		retryStrategy,
		lazyConnect: true,
		maxRetriesPerRequest: 3,
		enableReadyCheck: true,
	});
}

/**
 * Create a managed Redis connection.
 *
 * The connection is **not opened** until you call `.connect()`.
 *
 * @example
 * ```ts
 * import { createRedisConnection } from '@codexa/core/config';
 *
 * const redis = createRedisConnection({
 *   url: Deno.env.get('REDIS_URL'),
 *   keyPrefix: 'myapp::',
 * });
 *
 * await redis.connect();
 * const client = redis.getClient();
 * await client.set('hello', 'world');
 * ```
 */
export function createRedisConnection(
	config: RedisConnectionConfig,
): RedisConnection {
	let redisClient: RedisClient | null = null;
	let connectingPromise: Promise<RedisClient> | null = null;

	async function _connect(): Promise<RedisClient> {
		const client = buildIoRedis(config);

		client.on('connect', () => log.info('Connected to Redis'));
		client.on('ready', () => log.info('Redis is ready'));
		client.on('error', (error: Error) => log.error('Redis error', error));
		client.on('close', () => log.warn('Redis connection closed'));
		client.on('reconnecting', (delay: number) =>
			log.info(`Redis reconnecting in ${delay}ms`)
		);
		client.on('end', () => {
			log.warn('Redis connection ended — state reset');
			redisClient = null;
		});

		try {
			await client.connect();
			log.info('Redis connected', {
				host: client.options.host,
				port: client.options.port,
				db: client.options.db,
				keyPrefix: client.options.keyPrefix,
			});
			redisClient = client;
			return redisClient;
		} catch (error) {
			log.error('Failed to connect to Redis', error);
			await client.quit().catch(() => {});
			redisClient = null;
			throw error;
		}
	}

	return {
		connect(): Promise<RedisClient> {
			if (redisClient) {
				log.debug('Redis already connected');
				return Promise.resolve(redisClient);
			}
			if (connectingPromise) {
				log.debug('Redis connection already in progress — awaiting');
				return connectingPromise;
			}
			connectingPromise = _connect().finally(() => {
				connectingPromise = null;
			});
			return connectingPromise;
		},

		async disconnect(): Promise<void> {
			if (!redisClient) return;
			const closing = redisClient;
			redisClient = null;
			await closing.quit();
			log.info('Disconnected from Redis');
		},

		getClient(): RedisClient {
			if (!redisClient) {
				throw new Error(
					'Redis not connected. Call connect() first.',
				);
			}
			return redisClient;
		},

		isReady(): boolean {
			return redisClient?.status === 'ready';
		},

		async createSubscriberClient(): Promise<RedisClient> {
			const client = buildIoRedis(config);
			client.on(
				'error',
				(error: Error) => log.error('Redis subscriber error', error),
			);
			client.on('end', () => log.warn('Redis subscriber connection ended'));
			await client.connect();
			return client;
		},
	};
}
