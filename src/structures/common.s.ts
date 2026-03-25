import { zod } from '../utils/zod.ts';
import { ObjectId } from 'mongodb';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('Validators');

// deno-lint-ignore no-explicit-any
type AnyZodType = zod.ZodType<any, any>;

/** MongoDB ObjectId wrapper (for use in Zod schemas). */
export const MongoObjectId: AnyZodType = zod.instanceof(ObjectId);

/** Email validation with lowercase trim. */
export const emailSchema: AnyZodType = zod.email('Invalid email address').trim().toLowerCase();

/** Phone number validation (E.164 format). */
export const phoneSchema: AnyZodType = zod.string().regex(
	/^\+[1-9]\d{1,14}$/,
	'Invalid phone number (E.164 format required)',
);

/** Username: 3–30 chars, alphanumeric + underscore/hyphen. */
export const usernameSchema: AnyZodType = zod.string()
	.min(3, 'Username must be at least 3 characters')
	.max(30, 'Username must be at most 30 characters')
	.regex(
		/^[a-zA-Z0-9_-]+$/,
		'Username can only contain letters, numbers, underscores, and hyphens',
	);

/** Password: min 8 characters. */
export const passwordSchema: AnyZodType = zod.string()
	.min(8, 'Password must be at least 8 characters');

/** Strong password: min 8 chars, uppercase, lowercase, number, special char. */
export const strongPasswordSchema: AnyZodType = zod.string()
	.min(8, 'Password must be at least 8 characters')
	.regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
	.regex(/[a-z]/, 'Password must contain at least one lowercase letter')
	.regex(/[0-9]/, 'Password must contain at least one number')
	.regex(
		/[^A-Za-z0-9]/,
		'Password must contain at least one special character',
	);

export const DeviceTypeSchema: AnyZodType = zod.enum([
	'desktop',
	'mobile',
	'tablet',
	'tv',
	'iot',
	'cli',
	'unknown',
]);

export const DevicePlatformSchema: AnyZodType = zod.enum([
	'web',
	'ios',
	'android',
	'macos',
	'windows',
	'linux',
	'api',
]);

export const OSSchema: AnyZodType = zod.enum([
	'windows',
	'macos',
	'linux',
	'ios',
	'android',
	'chromeos',
	'unknown',
]);

/** Pagination query schema. */
export const paginationSchema: AnyZodType = zod.object({
	page: zod.coerce.number().int().min(1).default(1),
	limit: zod.coerce.number().int().min(1).max(100).default(20),
	sort: zod.string().optional().default('createdAt'),
	order: zod.enum(['asc', 'desc']).optional().default('desc'),
});

/** Generic search + filter query params. */
export const queryParamsSchema: AnyZodType = zod.object({
	search: zod.string().optional(),
	filters: zod.record(zod.string(), zod.unknown()).optional(),
});

/** Result type for safe validation helpers. */
export interface ValidationResult<T> {
	success: boolean;
	data?: T;
	errors?: zod.core.$ZodIssue[];
}

/**
 * Validate data against a Zod schema without throwing.
 */
export function validate<T>(
	schema: zod.ZodSchema<T>,
	data: unknown,
): ValidationResult<T> {
	const result = schema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	log.debug('Validation failed', result.error.issues);
	return { success: false, errors: result.error.issues };
}

/** System fields added to every DB document. */
export const SystemFieldsSchema: AnyZodType = zod.object({
	isActive: zod.boolean().default(true),
	createdAt: zod.date().default(() => new Date()),
	updatedAt: zod.date().default(() => new Date()),
	createdBy: zod.union([zod.instanceof(ObjectId), zod.literal('system')]).optional(),
	updatedBy: zod.union([zod.instanceof(ObjectId), zod.literal('system')]).optional(),
});
