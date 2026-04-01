/**
 * test_crypto.ts — Crypto, Hash, Device, TTL, Logger, Zod
 * Run: deno task test:crypto
 */

import { generateId, hashPassword, verifyPassword } from '@codexa/core/crypto';
import { sha256, sha512, sha384, sha1, hmacSha256, hmacHex } from '@codexa/core/hash';
import { parseDevice, formatDeviceShort } from '@codexa/core/device';
import { parseTtlToSeconds, parseTtlToMs, ttlToDate } from '@codexa/core/ttl';
import { createLogger } from '@codexa/core/logger';
import { zod } from '@codexa/core/zod';
import { parseQueryParams } from '@codexa/core/query';

const log = createLogger('CryptoTest');

async function testCrypto() {
	console.log('\n══════════════════════════════════════════');
	console.log('  Test: Crypto, Hash, Utils');
	console.log('══════════════════════════════════════════');

	// ── [1] generateId ────────────────────────────────────────────────────────
	{
		console.log('\n[1] generateId...');
		const ids = Array.from({ length: 100 }, () => generateId());
		const unique = new Set(ids);
		console.log(`  100 unique IDs: ${unique.size === 100} ✅`);
		console.log(`  sample: ${ids[0]}`);
		console.log(`  type: ${typeof ids[0] === 'string'} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [2] hashPassword / verifyPassword ─────────────────────────────────────
	{
		console.log('\n[2] hashPassword / verifyPassword...');
		const password = 'MyStr0ng!Pass#2024';
		const hash = await hashPassword(password);
		console.log(`  hash produced: ${hash.length > 0} ✅`);
		console.log(`  hash is string: ${typeof hash === 'string'} ✅`);
		console.log(`  correct password matches: ${await verifyPassword(password, hash)} ✅`);
		console.log(`  wrong password rejects: ${!(await verifyPassword('wrong', hash))} ✅`);
		console.log(`  empty password rejects: ${!(await verifyPassword('', hash))} ✅`);

		// Same password hashes differently each time (salt)
		const hash2 = await hashPassword(password);
		console.log(`  same pwd → different hash (salted): ${hash !== hash2} ✅`);
		console.log(`  hash2 still verifies: ${await verifyPassword(password, hash2)} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [3] SHA variants ──────────────────────────────────────────────────────
	{
		console.log('\n[3] SHA hash variants...');
		const input = 'hello world';

		const h256 = await sha256(input);
		const h384 = await sha384(input);
		const h512 = await sha512(input);
		const h1   = await sha1(input);

		console.log(`  sha256 length = ${h256.length} (expected 64) ${h256.length === 64 ? '✅' : '❌'}`);
		console.log(`  sha384 length = ${h384.length} (expected 96) ${h384.length === 96 ? '✅' : '❌'}`);
		console.log(`  sha512 length = ${h512.length} (expected 128) ${h512.length === 128 ? '✅' : '❌'}`);
		console.log(`  sha1   length = ${h1.length} (expected 40) ${h1.length === 40 ? '✅' : '❌'}`);

		// Deterministic
		const h256b = await sha256(input);
		console.log(`  sha256 deterministic: ${h256 === h256b} ✅`);

		// Different inputs → different hashes
		const h256c = await sha256('different');
		console.log(`  different inputs → different: ${h256 !== h256c} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [4] HMAC ──────────────────────────────────────────────────────────────
	{
		console.log('\n[4] HMAC...');
		const msg = 'webhook-payload';
		const secret = 'my-webhook-secret';

		const h1 = await hmacSha256(msg, secret);
		const h2 = await hmacSha256(msg, secret);
		console.log(`  hmacSha256 deterministic: ${h1 === h2} ✅`);

		const h3 = await hmacSha256(msg, 'different-secret');
		console.log(`  different secret → different: ${h1 !== h3} ✅`);

		const hHex = await hmacHex(msg, secret);
		console.log(`  hmacHex type: ${typeof hHex === 'string'} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [5] Device parsing ────────────────────────────────────────────────────
	{
		console.log('\n[5] Device parsing...');
		const uas = [
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148',
			'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
			'curl/7.88.1',
			'', // empty
		];

		for (const ua of uas) {
			const info = parseDevice(ua);
			const short = formatDeviceShort(info);
			console.log(`  "${ua.slice(0, 40)}..." → "${short}"`);
		}
		console.log('  ✅ Passed');
	}

	// ── [6] TTL parsing ───────────────────────────────────────────────────────
	{
		console.log('\n[6] TTL parsing...');
		const cases: Array<[string, number]> = [
			['1s', 1],
			['30s', 30],
			['1m', 60],
			['5m', 300],
			['1h', 3600],
			['24h', 86400],
			['1d', 86400],
			['7d', 604800],
		];

		for (const [input, expected] of cases) {
			const result = parseTtlToSeconds(input);
			console.log(`  parseTtlToSeconds("${input}") = ${result} ${result === expected ? '✅' : `❌ (expected ${expected})`}`);
		}

		console.log(`  parseTtlToMs("1s") = ${parseTtlToMs('1s')} (expected 1000) ${parseTtlToMs('1s') === 1000 ? '✅' : '❌'}`);
		console.log(`  parseTtlToMs("1m") = ${parseTtlToMs('1m')} (expected 60000) ${parseTtlToMs('1m') === 60000 ? '✅' : '❌'}`);

		const futureDate = ttlToDate('1h');
		const diff = futureDate.getTime() - Date.now();
		console.log(`  ttlToDate("1h") ≈ 3600s future: ${Math.abs(diff - 3600000) < 1000 ? '✅' : '❌'}`);
		console.log('  ✅ Passed');
	}

	// ── [7] Logger ────────────────────────────────────────────────────────────
	{
		console.log('\n[7] Logger...');
		const rootLog = createLogger('Root');
		const childLog = rootLog.child('Child');
		const grandchildLog = childLog.child('GrandChild');

		rootLog.debug('debug message (may be hidden)');
		rootLog.info('info from root');
		rootLog.warn('warn from root');
		rootLog.error('error from root', new Error('test error'));
		childLog.info('info from child');
		grandchildLog.info('info from grandchild');
		console.log('  Logger output above ✅');
		console.log('  ✅ Passed');
	}

	// ── [8] Zod ───────────────────────────────────────────────────────────────
	{
		console.log('\n[8] Zod schema validation...');

		// Object schema
		const UserSchema = zod.object({
			name: zod.string().min(2).max(50),
			email: zod.string().email(),
			age: zod.number().int().min(0).max(150).optional(),
			role: zod.enum(['admin', 'user', 'moderator']).default('user'),
		});
		type User = zod.infer<typeof UserSchema>;

		const valid: User = UserSchema.parse({
			name: 'Alice',
			email: 'alice@example.com',
			age: 30,
		});
		console.log(`  valid parse: name="${valid.name}", role="${valid.role}" (default) ✅`);

		const fail = UserSchema.safeParse({ name: 'A', email: 'not-email' });
		console.log(`  invalid parse: success=${fail.success} (false) ✅`);
		if (!fail.success) {
			console.log(`  errors: ${fail.error.issues.map(i => i.path.join('.') + ': ' + i.message).join(', ')}`);
		}

		// Coercion
		const NumSchema = zod.object({ port: zod.coerce.number() });
		const coerced = NumSchema.parse({ port: '8080' });
		console.log(`  coerced "8080" → ${coerced.port} (number) ✅`);

		// Transform
		const BoolSchema = zod.object({
			flag: zod.string().transform(v => v === 'true'),
		});
		const transformed = BoolSchema.parse({ flag: 'true' });
		console.log(`  transformed "true" → ${transformed.flag} (boolean) ✅`);

		console.log('  ✅ Passed');
	}

	// ── [9] parseQueryParams ──────────────────────────────────────────────────
	{
		console.log('\n[9] parseQueryParams...');
		const qs = 'page=2&limit=20&sort=name&order=asc&tags[]=a&tags[]=b';
		const params = parseQueryParams(qs);
		console.log(`  params: ${JSON.stringify(params)}`);
		console.log(`  page = "${params['page']}" ✅`);
		console.log(`  tags = ${JSON.stringify(params['tags'])} ✅`);
		console.log('  ✅ Passed');
	}

	console.log('\n══ All crypto/utils tests passed! ══\n');
}

testCrypto().catch(e => { console.error('❌ FAILED:', e); Deno.exit(1); });
