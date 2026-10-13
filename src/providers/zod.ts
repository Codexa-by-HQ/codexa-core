/**
 * @module @codexa/core/providers/zod
 *
 * Full provider re-export for Zod, with Codexa-friendly aliases.
 *
 * @example
 * ```ts
 * import { zod, type ZodInfer } from '@codexa/core/providers/zod';
 *
 * const User = zod.object({ id: zod.string() });
 * type User = ZodInfer<typeof User>;
 * ```
 */

import { z, ZodError } from '@zod/zod';

export * from '@zod/zod';

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
