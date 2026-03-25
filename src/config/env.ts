import { zod } from '../utils/zod.ts';
import { load as envLoad } from '@std/dotenv';
import { createLogger } from '../utils/logger.ts';
import { EnvConfigSchema } from '../structures/env.s.ts';
import type { EnvConfig, EnvType } from '../types/app.d.ts';

const log = createLogger('Env');

/**
 * Typed, validated environment configuration for `@codexa/core`.
 *
 * Extend `EnvConfigSchema` in your own project to add application-specific
 * variables to the same validated config object.
 *
 * @example
 * ```ts
 * import { env } from '@codexa/core/config';
 * await env.loadEnv();   // loads .env file and validates
 * const port = env.get('PORT');
 * ```
 */
export class Environment {
	private static instance: Environment;
	private config!: EnvConfig;

	public static getInstance(): Environment {
		if (!Environment.instance) {
			Environment.instance = new Environment();
		}
		return Environment.instance;
	}

	public getConfig(): EnvConfig {
		return this.config;
	}

	/**
	 * Load environment variables from an `.env` file and validate them
	 * against `EnvConfigSchema`.
	 *
	 * Resolution order (first found wins):
	 *   1. `./env/.env.<NODE_ENV>`  (e.g. `./env/.env.production`)
	 *   2. `./.env`                 (root fallback)
	 *   3. System environment       (no file required)
	 */
	public async loadEnv(): Promise<void> {
		const envType = (Deno.env.get('ENV_TYPE') || Deno.env.get('NODE_ENV') ||
			'development') as EnvType;

		// Try env/<type> file first, then root .env as fallback
		const envFile = `./env/.env.${envType}`;
		try {
			await envLoad({ envPath: envFile, export: true });
			log.info(`Loaded environment from: ${envFile}`);
		} catch {
			try {
				await envLoad({ export: true });
				log.info('Loaded environment from: .env (fallback)');
			} catch {
				log.info(
					'No .env file found — using system environment variables',
				);
			}
		}

		this.validateEnv(envType);
		log.info(`Environment ready [${envType}]`);
	}

	private validateEnv(envType: EnvType): void {
		const rawEnv = { ...Deno.env.toObject(), NODE_ENV: envType };
		try {
			this.config = EnvConfigSchema.parse(rawEnv);
		} catch (error) {
			if (error instanceof zod.ZodError) {
				log.fatal('Environment validation failed:');
				error.issues.forEach((err) => {
					log.fatal(`  [${err.path.join('.')}] ${err.message}`);
				});
				throw new Error('Invalid environment configuration');
			}
			throw error;
		}
	}

	// ── Typed getters ────────────────────────────────────────────
	public get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
		return this.config[key];
	}

	public getAll(): EnvConfig {
		return { ...this.config };
	}

	// ── Utility getters ──────────────────────────────────────────
	/** True if the env var is one of: true | 1 | yes | on */
	public enabled<K extends keyof EnvConfig>(key: K): boolean {
		const raw = this.config[key] ?? Deno.env.get(String(key));
		if (!raw) return false;
		return ['true', '1', 'yes', 'on'].includes(raw.toString().toLowerCase());
	}

	/** Read env var as a number, returning `defaultValue` if absent/NaN. */
	public number<K extends keyof EnvConfig>(
		key: K,
		defaultValue: number,
	): number {
		const raw = this.config[key] ?? Deno.env.get(String(key));
		if (!raw) return defaultValue;
		const parsed = Number(raw);
		return Number.isNaN(parsed) ? defaultValue : parsed;
	}

	/** Read a comma-separated env var as a string array. */
	public list<K extends keyof EnvConfig>(key: K): string[] {
		const raw = this.config[key] ?? Deno.env.get(String(key));
		if (!raw) return [];
		return raw.toString().split(',').map((s: string) => s.trim()).filter(Boolean);
	}

	// ── Environment checks ───────────────────────────────────────
	public is(type: EnvType): boolean {
		return this.config.NODE_ENV === type;
	}

	public isDevelopment(): boolean {
		return this.config.NODE_ENV === 'development';
	}

	public isProduction(): boolean {
		return this.config.NODE_ENV === 'production';
	}

	public isTest(): boolean {
		return this.config.NODE_ENV === 'test';
	}
}

/** Singleton environment instance. Call `.loadEnv()` once at startup. */
export const env: Environment = Environment.getInstance();
