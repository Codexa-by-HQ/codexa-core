import { zod } from '../utils/zod.ts';

// deno-lint-ignore no-explicit-any
type AnyZodType = zod.ZodType<any, any>;

export const HashSchema: AnyZodType = zod.enum([
	'SHA-1',
	'SHA-256',
	'SHA-384',
	'SHA-512',
]);
export const HmacSchema: AnyZodType = zod.enum([
	'SHA-1',
	'SHA-256',
	'SHA-384',
	'SHA-512',
]);
