/**
 * @module @codexa/core/config
 *
 * Configuration utilities for Codexa applications.
 *
 * @example
 * ```ts
 * import { env, createMongoDatabase, createRedisConnection, buildStorageConfig } from '@codexa/core/config';
 *
 * await env.loadEnv();
 *
 * const db = createMongoDatabase(env.get('MONGODB_URI'), 'myapp');
 * await db.connect();
 *
 * const redis = createRedisConnection({ url: env.get('REDIS_URL') });
 * await redis.connect();
 *
 * const storage = buildStorageConfig(Deno.env.toObject());
 * ```
 */

export { env, Environment } from './env.ts';
export { createMongoDatabase } from './database.ts';
export { createRedisConnection } from './redis.ts';
export { buildStorageConfig } from './storage.ts';
export type { MongoDatabaseOptions, MongoDatabaseConnection } from './database.ts';
export type { RedisConnectionConfig, RedisConnection, RedisClient } from './redis.ts';
