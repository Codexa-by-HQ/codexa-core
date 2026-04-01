/**
 * test_all.ts — Run all tests sequentially
 * Run: deno task test:all
 */

import { createLogger } from '@codexa/core/logger';

const log = createLogger('TestRunner');

async function run(name: string, file: string) {
	log.info(`\n${'═'.repeat(50)}`);
	log.info(`  Running: ${name}`);
	log.info('═'.repeat(50));

	const cmd = new Deno.Command(Deno.execPath(), {
		args: ['run', '--allow-env', '--allow-read', '--allow-net', '--allow-sys', file],
		cwd: import.meta.dirname,
		stdout: 'inherit',
		stderr: 'inherit',
	});
	const result = await cmd.output();
	if (!result.success) {
		log.error(`❌ ${name} FAILED (exit code: ${result.code})`);
		Deno.exit(1);
	}
	log.info(`✅ ${name} PASSED`);
}

const tests = [
	['Environment Config', 'test_env.ts'],
	['Key-Value Store',    'test_store.ts'],
	['Cache Module',       'test_cache.ts'],
	['Event Bus',          'test_bus.ts'],
	['Crypto & Utils',     'test_crypto.ts'],
	['HTTP Framework',     'test_http.ts'],
] as const;

log.info('🚀 Running all Codexa Core integration tests...');
const start = Date.now();

for (const [name, file] of tests) {
	await run(name, file);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
log.info(`\n✅ ALL TESTS PASSED in ${elapsed}s`);
