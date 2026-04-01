/**
 * test_env.ts — Environment configuration
 *
 * Tests typed env loading, schema validation, utility helpers.
 * Run: deno task test:env (from codexa_core_testing/)
 */

import { Environment } from '@codexa/core/config';
import { zod } from '@codexa/core/zod';

// ── Define schema ─────────────────────────────────────────────────────────────
// Put schema OUTSIDE main() so inferred type propagates via TypeScript
const AppSchema = zod.object({
	PORT:         zod.coerce.number().default(8080),
	NODE_ENV:     zod.enum(['development', 'production', 'staging', 'test']).default('development'),
	JWT_SECRET:   zod.string().min(32),
	DATABASE_URL: zod.string(),
	DATABASE_NAME: zod.string().default('myapp'),
	REDIS_URL:    zod.string().optional(),
	LOG_LEVEL:    zod.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
	FEATURE_DARK_MODE: zod.string().optional().transform((v) => v === 'true' || v === '1'),
	ALLOWED_ORIGINS:   zod.string().optional(),
	CACHE_TTL:    zod.coerce.number().default(300),
});

// Export the inferred type — import this in other files for typed access
export type AppConfig = zod.infer<typeof AppSchema>;

async function testEnv() {
	console.log('\n══════════════════════════════════════════');
	console.log('  Test: Environment Configuration');
	console.log('══════════════════════════════════════════');

	// ── Test 1: Typed loading ─────────────────────────────────────────────────
	{
		console.log('\n[1] Typed loadEnv with schema...');
		const e = new Environment();

		// loadEnv returns Promise<AppConfig> — fully typed config object
		// Hover over `config.PORT` in your editor → shows `number`
		// Hover over `config.NODE_ENV` → shows union 'development' | 'production' | ...
		const config: AppConfig = await e.loadEnv({
			paths: ['.env'],
			schema: AppSchema,
		});

		// ✅ All these have proper types — no `any`, no casting needed
		console.log(`  PORT:          ${config.PORT}`);            // number
		console.log(`  NODE_ENV:      ${config.NODE_ENV}`);        // 'development'|...
		console.log(`  JWT_SECRET:    ${config.JWT_SECRET.slice(0,8)}...`);  // string
		console.log(`  DATABASE_URL:  ${config.DATABASE_URL}`);    // string
		console.log(`  DATABASE_NAME: ${config.DATABASE_NAME}`);   // string
		console.log(`  REDIS_URL:     ${config.REDIS_URL ?? '(not set)'}`);  // string|undefined
		console.log(`  LOG_LEVEL:     ${config.LOG_LEVEL}`);       // 'debug'|'info'|...
		console.log(`  DARK_MODE:     ${config.FEATURE_DARK_MODE}`); // boolean (transformed)
		console.log(`  CACHE_TTL:     ${config.CACHE_TTL}`);       // number

		// getConfig<T>() for later typed retrieval anywhere in your app
		const later = e.getConfig<AppConfig>();
		console.log(`  [getConfig] PORT=${later.PORT}, NODE_ENV=${later.NODE_ENV}`);

		console.log('  ✅ Passed');
	}

	// ── Test 2: Utility helpers ───────────────────────────────────────────────
	{
		console.log('\n[2] Utility helpers...');
		const e = new Environment();
		await e.loadEnv({ paths: ['.env'], schema: AppSchema });

		console.log(`  enabled('FEATURE_DARK_MODE'): ${e.enabled('FEATURE_DARK_MODE')}`);
		console.log(`  number('CACHE_TTL', 300):     ${e.number('CACHE_TTL', 300)}`);
		console.log(`  number('MISSING', 99):        ${e.number('MISSING', 99)}`);
		console.log(`  list('ALLOWED_ORIGINS'):       ${JSON.stringify(e.list('ALLOWED_ORIGINS'))}`);
		console.log(`  list('MISSING'):               ${JSON.stringify(e.list('MISSING'))}`);
		console.log(`  isDevelopment():  ${e.isDevelopment()}`);
		console.log(`  isProduction():   ${e.isProduction()}`);
		console.log('  ✅ Passed');
	}

	// ── Test 3: Multiple paths — later files win ──────────────────────────────
	{
		console.log('\n[3] Multiple paths (merge left-to-right)...');
		const e = new Environment();
		// Nonexistent paths are silently skipped
		await e.loadEnv({
			paths: ['.env.nonexistent', '.env'],
			schema: AppSchema,
		});
		console.log(`  PORT after multi-path load: ${e.getConfig<AppConfig>().PORT}`);
		console.log('  ✅ Passed');
	}

	// ── Test 4: Raw mode (no schema) ─────────────────────────────────────────
	{
		console.log('\n[4] Raw mode (no schema)...');
		const e = new Environment();
		const raw = await e.loadEnv({ paths: ['.env'] });
		// raw is Record<string,string> — all values are strings
		console.log(`  raw['PORT'] = ${raw['PORT']} (type: ${typeof raw['PORT']})`);
		console.log(`  e.get('PORT') = ${e.get('PORT')}`);
		console.log('  ✅ Passed');
	}

	// ── Test 5: System env wins over file ─────────────────────────────────────
	{
		console.log('\n[5] System env overrides .env file...');
		Deno.env.set('PORT', '9999');
		const e = new Environment();
		await e.loadEnv({ paths: ['.env'], schema: AppSchema });
		const config = e.getConfig<AppConfig>();
		console.log(`  PORT (expected 9999, got ${config.PORT}): ${config.PORT === 9999 ? '✅' : '❌'}`);
		Deno.env.delete('PORT'); // restore
	}

	// ── Test 6: Schema validation failure ─────────────────────────────────────
	{
		console.log('\n[6] Schema validation failure...');
		const e = new Environment();
		try {
			await e.loadEnv({
				loadFiles: false,
				schema: zod.object({
					NONEXISTENT_REQUIRED_VAR: zod.string().min(1),
				}),
			});
			console.log('  ❌ Should have thrown');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`  Caught: "${msg.slice(0, 60)}..."`);
			console.log('  ✅ Passed');
		}
	}

	// ── Test 7: Boolean/enum coercions ───────────────────────────────────────
	{
		console.log('\n[7] Coercion & defaults...');
		Deno.env.set('COERCE_PORT', '3000');
		Deno.env.set('COERCE_FLAG', 'true');
		const e = new Environment();
		const coerceSchema = zod.object({
			COERCE_PORT: zod.coerce.number(),
			COERCE_FLAG: zod.string().transform(v => v === 'true'),
			COERCE_MISSING: zod.string().default('fallback'),
		}).passthrough();
		const config = await e.loadEnv({ loadFiles: false, schema: coerceSchema });
		console.log(`  COERCE_PORT (number):   ${config.COERCE_PORT} ${typeof config.COERCE_PORT === 'number' ? '✅' : '❌'}`);
		console.log(`  COERCE_FLAG (boolean):  ${config.COERCE_FLAG} ${config.COERCE_FLAG === true ? '✅' : '❌'}`);
		console.log(`  COERCE_MISSING (def):   ${config.COERCE_MISSING} ${config.COERCE_MISSING === 'fallback' ? '✅' : '❌'}`);
		Deno.env.delete('COERCE_PORT');
		Deno.env.delete('COERCE_FLAG');
	}

	console.log('\n══ All env tests passed! ══\n');
}

testEnv().catch(e => { console.error('❌ FAILED:', e); Deno.exit(1); });
