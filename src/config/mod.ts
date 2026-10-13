/**
 * @module @codexa/core/config
 *
 * Configuration utilities for Codexa applications.
 *
 * @example
 * ```ts
 * import {
 *   env,
 *   createMongoDatabase,
 *   createRedisConnection,
 *   buildStorageConfig,
 * } from '@codexa/core/config';
 *
 * // Load env with custom schema
 * import { zod } from '@codexa/core/providers/zod';
 * await env.loadEnv({
 *   paths: ['.env', '.env.local'],
 *   schema: zod.object({
 *     PORT: zod.coerce.number().default(8080),
 *     DATABASE_URL: zod.string(),
 *     REDIS_URL: zod.string().optional(),
 *   }),
 * });
 *
 * // MongoDB
 * const db = createMongoDatabase(env.get('DATABASE_URL'), 'myapp');
 * await db.connect();
 *
 * // Redis (with pub/sub)
 * const redis = createRedisConnection({
 *   url: env.get('REDIS_URL'),
 *   enablePubSub: true,
 * });
 * await redis.connect();
 *
 * // Storage
 * const storage = buildStorageConfig(Deno.env.toObject());
 * ```
 */

export { env, Environment } from './env.ts';
export type { LoadEnvOptions } from './env.ts';
export { createMongoDatabase } from './database.ts';
export type {
	MongoDatabaseConnection,
	MongoDatabaseOptions,
} from './database.ts';
export { createRedisConnection } from './redis.ts';
export type {
	RedisClient,
	RedisConnection,
	RedisConnectionConfig,
} from './redis.ts';
export { buildStorageConfig } from './storage.ts';
