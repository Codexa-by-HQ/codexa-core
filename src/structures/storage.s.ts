import { zod } from '../utils/zod.ts';

// deno-lint-ignore no-explicit-any
type AnyZodType = zod.ZodType<any, any>;

// Storage provider type
export const StorageProviderTypeSchema: AnyZodType = zod.enum([
	's3',
	'cloudinary',
	'imagekit',
	'local',
]);

/**
 * Storage-related environment variables.
 * Spread into `EnvConfigSchema` via `...StorageEnvSchema.shape`.
 */
export const StorageEnvSchema: AnyZodType = zod.object({
	/** Storage backend provider (default: local) */
	STORAGE_PROVIDER: zod.enum(['s3', 'cloudinary', 'imagekit', 'local']).default('local'),

	// ── AWS S3 / S3-Compatible (MinIO, DigitalOcean Spaces, etc.) ──
	S3_BUCKET: zod.string().optional(),
	S3_REGION: zod.string().optional(),
	S3_ACCESS_KEY: zod.string().optional(),
	S3_SECRET_KEY: zod.string().optional(),
	/** Custom endpoint for S3-compatible providers (MinIO, DO Spaces) */
	S3_ENDPOINT: zod.string().optional(),
	/** CloudFront / CDN base URL */
	S3_CDN_BASE_URL: zod.string().optional(),

	// ── Cloudinary ────────────────────────────────────────────────────
	CLOUDINARY_CLOUD_NAME: zod.string().optional(),
	CLOUDINARY_API_KEY: zod.string().optional(),
	CLOUDINARY_API_SECRET: zod.string().optional(),

	// ── ImageKit ──────────────────────────────────────────────────────
	IMAGEKIT_PUBLIC_KEY: zod.string().optional(),
	IMAGEKIT_PRIVATE_KEY: zod.string().optional(),
	IMAGEKIT_URL_ENDPOINT: zod.string().optional(),

	// ── Local filesystem ──────────────────────────────────────────────
	/** Directory to store uploaded files (default: ./uploads) */
	LOCAL_STORAGE_DIR: zod.string().default('./uploads'),
	/** URL prefix for serving uploaded files */
	LOCAL_BASE_URL: zod.string().optional(),
});
