import { zod } from '../utils/zod.ts';

// deno-lint-ignore no-explicit-any
type AnyZodType = zod.ZodType<any, any>;

export const EnvTypeSchema: AnyZodType = zod.enum([
	'development',
	'production',
	'staging',
	'test',
]);

export const LogLevelSchema: AnyZodType = zod.enum([
	'debug',
	'info',
	'warn',
	'error',
	'fatal',
]);

export const StoreModeSchema: AnyZodType = zod.enum(['redis', 'kv', 'memory']);

/**
 * Core environment schema for `@codexa/core`.
 *
 * Only contains variables that the package's own services (logger, store,
 * cache, bus, storage) actually read. Your application is free to extend
 * this schema with its own variables before calling `env.loadEnv()`.
 */
export const EnvConfigSchema: AnyZodType = zod.object({
	// ── Runtime ───────────────────────────────────────────────
	NODE_ENV: zod.enum(['development', 'production', 'staging', 'test']).default('development'),
	PORT: zod.coerce.number().default(8080),
	SERVER_HOSTNAME: zod.string().default('localhost'),

	// ── Logger ────────────────────────────────────────────────
	LOG_LEVEL: zod.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('debug'),
	LOG_DIR: zod.string().default('./logs'),
	LOG_FILE_ENABLED: zod.coerce.boolean().default(false),
	LOG_MAX_FILE_SIZE: zod.coerce.number().default(5_242_880),
	LOG_MAX_FILES: zod.coerce.number().default(5),

	// ── Cache ─────────────────────────────────────────────────
	CACHE_TTL: zod.coerce.number().default(300),
	CACHE_PREFIX: zod.string().optional().default('codexa_cache::'),

	// ── Store ─────────────────────────────────────────────────
	STORE_MODE: zod.enum(['redis', 'kv', 'memory']).default('memory'),
	STORE_FALLBACK_TO_MEMORY: zod.coerce.boolean().default(true),

	// ── Redis ─────────────────────────────────────────────────
	REDIS_URL: zod.string().optional(),
	REDIS_HOST: zod.string().default('localhost'),
	REDIS_PORT: zod.coerce.number().int().positive().default(6379),
	REDIS_PASSWORD: zod.string().optional(),
	REDIS_DB: zod.coerce.number().default(0),
	REDIS_KEY_PREFIX: zod.string().default('codexa::'),

	// ── Deno KV ───────────────────────────────────────────────
	DENO_KV_PATH: zod.string().optional(),
	DENO_KV_PREFIX: zod.string().default('codexa::'),

	// ── Storage ───────────────────────────────────────────────
	STORAGE_PROVIDER: zod.enum(['s3', 'cloudinary', 'imagekit', 'local']).default('local'),
	S3_BUCKET: zod.string().optional(),
	S3_REGION: zod.string().optional(),
	S3_ACCESS_KEY: zod.string().optional(),
	S3_SECRET_KEY: zod.string().optional(),
	S3_ENDPOINT: zod.string().optional(),
	S3_CDN_BASE_URL: zod.string().optional(),
	CLOUDINARY_CLOUD_NAME: zod.string().optional(),
	CLOUDINARY_API_KEY: zod.string().optional(),
	CLOUDINARY_API_SECRET: zod.string().optional(),
	IMAGEKIT_PUBLIC_KEY: zod.string().optional(),
	IMAGEKIT_PRIVATE_KEY: zod.string().optional(),
	IMAGEKIT_URL_ENDPOINT: zod.string().optional(),
	LOCAL_STORAGE_DIR: zod.string().default('./uploads'),
	LOCAL_BASE_URL: zod.string().optional(),
}).superRefine((data, ctx) => {
	if (data['STORE_MODE'] === 'redis') {
		const hasHostDetails = data['REDIS_HOST'] && data['REDIS_PORT'];
		const hasUrl = data['REDIS_URL'];
		if (!(hasHostDetails || hasUrl)) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Either REDIS_URL or (REDIS_HOST + REDIS_PORT) must be provided when STORE_MODE is "redis"',
				path: ['STORE_MODE'],
			});
		}
	}
});
