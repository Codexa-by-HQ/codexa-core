/**
 * @module env
 *
 * Environment configuration for `@codexa/core`.
 *
 * Users define their OWN Zod schema to validate environment variables.
 * When a schema is provided, `loadEnv()` returns a **fully typed** config
 * object with autocomplete on every key.
 *
 * @example Typed environment (recommended)
 * ```ts
 * import { env } from '@codexa/core/config';
 * import { zod } from '@codexa/core/providers/zod';
 *
 * const config = await env.loadEnv({
 *   paths: ['.env', '.env.local'],
 *   schema: zod.object({
 *     PORT: zod.coerce.number().default(8080),
 *     JWT_SECRET: zod.string().min(32),
 *     NODE_ENV: zod.enum(['development', 'production', 'test']).default('development'),
 *   }),
 * });
 *
 * config.PORT        // number - fully typed with autocomplete
 * config.JWT_SECRET  // string - fully typed with autocomplete
 * ```
 *
 * @example Untyped (raw mode)
 * ```ts
 * await env.loadEnv();  // loads .env, no validation
 * const port = env.get('PORT');  // string | undefined
 * ```
 */
import { AnyZodObject, zod } from "../providers/zod.d.ts";
/**
 * Options for {@link Environment.loadEnv}.
 *
 * When `schema` is provided, the returned config is fully typed
 * based on the Zod schema - giving autocomplete on all fields.
 */
export interface LoadEnvOptions<S extends AnyZodObject = AnyZodObject> {
    /**
     * One or more `.env` file paths to load. Files are merged left-to-right
     * (later files override earlier ones). Paths that don't exist are silently
     * skipped.
     *
     * @default ['.env']
     */
    paths?: string | string[];
    /**
     * A Zod **object** schema to validate the merged environment against.
     * When provided, `loadEnv()` returns the fully typed parsed config.
     */
    schema?: S;
    /**
     * If `false`, skip loading `.env` files entirely - use only `Deno.env`.
     * @default true
     */
    loadFiles?: boolean;
}
/**
 * Typed, validated environment configuration.
 *
 * Call `loadEnv()` once at application startup.
 *
 * @example Typed access via returned config
 * ```ts
 * const config = await env.loadEnv({
 *   schema: zod.object({
 *     PORT: zod.coerce.number().default(8080),
 *     DATABASE_URL: zod.string(),
 *   }),
 * });
 * config.PORT         // number - fully typed
 * config.DATABASE_URL // string - fully typed
 * ```
 *
 * @example Untyped access via env.get()
 * ```ts
 * await env.loadEnv();
 * env.get('PORT');   // string | undefined
 * ```
 */
export declare class Environment {
    private static instance;
    private config;
    private _loaded;
    static getInstance(): Environment;
    /** True after `loadEnv()` has been called successfully. */
    get loaded(): boolean;
    /**
     * Load environment variables and optionally validate them.
     *
     * 1. Reads `.env` file(s) from `paths` (merged left-to-right).
     * 2. Overlays `Deno.env` system vars (system always wins).
     * 3. If `schema` is provided, validates and parses - returns **typed config**.
     *
     * @returns The validated config when a schema is provided.
     *          Without a schema, returns the raw merged env as `Record<string,string>`.
     *
     * @example
     * ```ts
     * const config = await env.loadEnv({
     *   schema: zod.object({ PORT: zod.coerce.number().default(8080) }),
     * });
     * config.PORT // number - fully typed
     * ```
     */
    loadEnv<S extends AnyZodObject>(options?: LoadEnvOptions<S>): Promise<zod.infer<S>>;
    /**
     * Retrieve an environment variable by key.
     *
     * For fully typed access, use the config object returned by `loadEnv({ schema })`.
     * This method is for **untyped** / runtime access.
     */
    get(key: string): string | undefined;
    /** Get all loaded config as a plain object. */
    getAll(): Record<string, any>;
    /**
     * Get the validated config, cast to a specific type.
     *
     * @example
     * ```ts
     * type MyEnv = { PORT: number; JWT_SECRET: string };
     * const config = env.getConfig<MyEnv>();
     * config.PORT // number
     * ```
     */
    getConfig<T = Record<string, string>>(): T;
    /** True if the env var is one of: true | 1 | yes | on */
    enabled(key: string): boolean;
    /** Read env var as a number, returning `defaultValue` if absent/NaN. */
    number(key: string, defaultValue: number): number;
    /** Read a comma-separated env var as a string array. */
    list(key: string): string[];
    /** Check if NODE_ENV matches the given type. */
    is(type: string): boolean;
    isDevelopment(): boolean;
    isProduction(): boolean;
    isTest(): boolean;
}
/** Singleton environment instance. Call `.loadEnv()` once at startup. */
export declare const env: Environment;
