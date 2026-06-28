/**
 * @module @codexa/core/zod
 *
 * Re-export of Zod with small type aliases used across Codexa modules.
 *
 * @example
 * ```ts
 * import { zod, type ZodInfer } from '@codexa/core/zod';
 *
 * const User = zod.object({ id: zod.string() });
 * type User = ZodInfer<typeof User>;
 * ```
 */

import { z, ZodError } from '@zod/zod';

/** Zod namespace re-exported as `zod` for consistent Codexa imports. */
export { z as zod };
/** Zod validation error class. */
export { ZodError };

/** Infer the parsed output type of a Zod schema. */
export type ZodInfer<T extends z.ZodTypeAny> = z.infer<T>;
/** Infer the accepted input type of a Zod schema. */
export type ZodInput<T extends z.ZodTypeAny> = z.input<T>;
/** Infer the parsed output type of a Zod schema. */
export type ZodOutput<T extends z.ZodTypeAny> = z.output<T>;
/** Any Zod object schema. */
// deno-lint-ignore no-explicit-any
export type AnyZodObject = z.ZodObject<any>;
