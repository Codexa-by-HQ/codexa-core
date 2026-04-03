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
 * import { zod } from '@codexa/core/zod';
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

import { AnyZodObject, zod, ZodError, ZodInfer } from '../utils/zod.ts';
import { load as envLoad } from '@std/dotenv';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('Codexa:Env');

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
export class Environment {
	private static instance: Environment;
	// deno-lint-ignore no-explicit-any
	private config: Record<string, any> = {};
	private _loaded = false;

	public static getInstance(): Environment {
		if (!Environment.instance) {
			Environment.instance = new Environment();
		}
		return Environment.instance;
	}

	/** True after `loadEnv()` has been called successfully. */
	public get loaded(): boolean {
		return this._loaded;
	}

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
	public async loadEnv<S extends AnyZodObject>(
		options?: LoadEnvOptions<S>,
	): Promise<zod.infer<S>> {
		const {
			paths = ['.env'],
			schema,
			loadFiles = true,
		} = options ?? {};

		const pathList = Array.isArray(paths) ? paths : [paths];

		// Step 1: Load .env files
		// deno-lint-ignore no-explicit-any
		let fileVars: Record<string, any> = {};

		if (loadFiles) {
			for (const envPath of pathList) {
				try {
					const loaded = await envLoad({
						envPath,
						export: true,
					});
					fileVars = { ...fileVars, ...loaded };
					log.info(`Loaded env from: ${envPath}`);
				} catch {
					log.debug(
						`Env file not found or unreadable: ${envPath} (skipped)`,
					);
				}
			}
		}

		// Step 2: Merge with system env (system wins)
		const merged: Record<string, string> = {
			...fileVars,
			...Deno.env.toObject(),
		};

		// Step 3: Validate with schema (if provided)
		if (schema) {
			try {
				this.config = schema.parse(merged);
				log.info('Environment validated successfully');
			} catch (error: unknown) {
				if (error instanceof ZodError) {
					log.fatal('Environment validation failed:');
					// deno-lint-ignore no-explicit-any
					(error.issues as any[]).forEach(
						(err: { path: PropertyKey[]; message: string }) => {
							log.fatal(
								`  [${err.path.join('.')}] ${err.message}`,
							);
						},
					);
					throw new Error(
						'Invalid environment configuration. See log output above.',
					);
				}
				throw error;
			}
		} else {
			// No schema - store raw merged values (all strings)
			this.config = merged;
			log.info(
				'Environment loaded (no schema validation - raw values)',
			);
		}

		this._loaded = true;
		return this.config as ZodInfer<S>;
	}

	/**
	 * Retrieve an environment variable by key.
	 *
	 * For fully typed access, use the config object returned by `loadEnv({ schema })`.
	 * This method is for **untyped** / runtime access.
	 */
	public get(key: string): string | undefined {
		if (key in this.config) {
			return this.config[key];
		}
		return Deno.env.get(key);
	}

	/** Get all loaded config as a plain object. */
	// deno-lint-ignore no-explicit-any
	public getAll(): Record<string, any> {
		return { ...this.config };
	}

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
	public getConfig<T = Record<string, string>>(): T {
		return this.config as T;
	}

	// Utility getters

	/** True if the env var is one of: true | 1 | yes | on */
	public enabled(key: string): boolean {
		const raw = this.config[key] ?? Deno.env.get(key);
		if (!raw) return false;
		return ['true', '1', 'yes', 'on'].includes(
			String(raw).toLowerCase(),
		);
	}

	/** Read env var as a number, returning `defaultValue` if absent/NaN. */
	public number(key: string, defaultValue: number): number {
		const raw = this.config[key] ?? Deno.env.get(key);
		if (raw === undefined || raw === null) return defaultValue;
		const parsed = Number(raw);
		return Number.isNaN(parsed) ? defaultValue : parsed;
	}

	/** Read a comma-separated env var as a string array. */
	public list(key: string): string[] {
		const raw = this.config[key] ?? Deno.env.get(key);
		if (!raw) return [];
		return String(raw)
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean);
	}

	// Environment checks

	/** Check if NODE_ENV matches the given type. */
	public is(type: string): boolean {
		return this.get('NODE_ENV') === type;
	}

	public isDevelopment(): boolean {
		return this.is('development');
	}

	public isProduction(): boolean {
		return this.is('production');
	}

	public isTest(): boolean {
		return this.is('test');
	}
}

/** Singleton environment instance. Call `.loadEnv()` once at startup. */
export const env: Environment = Environment.getInstance();
