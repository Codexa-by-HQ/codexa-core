import { z, ZodError } from '@zod/zod';

// Re-export z as "zod" and ZodError it will preserves both value AND namespace which helps with type inference z.infer<>, z.ZodTypeAny, etc.
export { z as zod };
export { ZodError };

// useful type helpers if above z.infer or other namespace not works
export type ZodInfer<T extends z.ZodTypeAny> = z.infer<T>;
export type ZodInput<T extends z.ZodTypeAny> = z.input<T>;
export type ZodOutput<T extends z.ZodTypeAny> = z.output<T>;
// deno-lint-ignore no-explicit-any
export type AnyZodObject = z.ZodObject<any>;
