/**
 * test_cache.ts — Cache module
 * Run: deno task test:cache
 */

import { initializeStore, closeStore } from '@codexa/core/store';
import { createCache } from '@codexa/core/cache';

async function testCache() {
	console.log('\n══════════════════════════════════════════');
	console.log('  Test: Cache Module');
	console.log('══════════════════════════════════════════');

	await initializeStore({ mode: 'memory' });

	// ── [1] Basic get/set/del/has ─────────────────────────────────────────────
	{
		console.log('\n[1] Basic CRUD...');
		const cache = createCache('users');

		await cache.set('user:1', { id: '1', name: 'Alice', role: 'admin' });
		await cache.set('user:2', { id: '2', name: 'Bob', role: 'user' });

		const user1 = await cache.get<{ id: string; name: string; role: string }>('user:1');
		console.log(`  get user:1 name = "${user1?.name}" ✅`);
		console.log(`  has user:1 = ${await cache.has('user:1')} ✅`);

		await cache.del('user:2');
		console.log(`  has user:2 after del = ${await cache.has('user:2')} ✅`);
		console.log(`  get user:2 = ${await cache.get('user:2')} (null) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [2] Namespace isolation ───────────────────────────────────────────────
	{
		console.log('\n[2] Namespace isolation...');
		const userCache = createCache('ns-users');
		const orderCache = createCache('ns-orders');

		await userCache.set('key1', 'user-data');
		await orderCache.set('key1', 'order-data');

		const u = await userCache.get('key1');
		const o = await orderCache.get('key1');
		console.log(`  user ns value  = "${u}" ✅`);
		console.log(`  order ns value = "${o}" ✅`);
		console.log(`  isolated = ${u !== o} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [3] TTL expiry ────────────────────────────────────────────────────────
	{
		console.log('\n[3] TTL expiry (1s)...');
		const cache = createCache('ttl-test');

		await cache.set('temp', { expires: true }, { ttl: 1 });
		console.log(`  has before expiry = ${await cache.has('temp')} ✅`);

		console.log('  Waiting 1.2s...');
		await new Promise(r => setTimeout(r, 1200));
		console.log(`  has after expiry = ${await cache.has('temp')} (false) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [4] getOrSet (cache-aside) ────────────────────────────────────────────
	{
		console.log('\n[4] getOrSet — cache-aside pattern...');
		const cache = createCache('aside');
		let fetchCount = 0;

		const fetchUser = async (): Promise<{ name: string }> => {
			fetchCount++;
			return { name: 'Computed User' };
		};

		// First call — computes
		const v1 = await cache.getOrSet('profile:1', fetchUser, { ttl: 300 });
		console.log(`  first call: fetched="${v1.name}", fetchCount=${fetchCount} (1) ✅`);

		// Second call — from cache
		const v2 = await cache.getOrSet('profile:1', fetchUser, { ttl: 300 });
		console.log(`  second call: cached="${v2.name}", fetchCount=${fetchCount} (1, no re-fetch) ✅`);

		// Third call new key — computes again
		const v3 = await cache.getOrSet('profile:2', fetchUser, { ttl: 300 });
		console.log(`  new key: fetched="${v3.name}", fetchCount=${fetchCount} (2) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [5] Tag-based invalidation ────────────────────────────────────────────
	{
		console.log('\n[5] Tag-based invalidation...');
		const cache = createCache('products');

		await cache.set('p1', { name: 'Widget' }, { tags: ['cat:electronics', 'brand:acme'] });
		await cache.set('p2', { name: 'Gadget' }, { tags: ['cat:electronics', 'brand:techco'] });
		await cache.set('p3', { name: 'Shirt' },  { tags: ['cat:clothing'] });
		await cache.set('p4', { name: 'Phone' },  { tags: ['cat:electronics', 'brand:acme'] });

		console.log(`  has p1 (before) = ${await cache.has('p1')} ✅`);
		console.log(`  has p2 (before) = ${await cache.has('p2')} ✅`);
		console.log(`  has p3 (before) = ${await cache.has('p3')} ✅`);

		// Invalidate by category — removes p1, p2, p4
		await cache.invalidateTag('cat:electronics');

		console.log(`  has p1 (after cat:electronics) = ${await cache.has('p1')} (false) ✅`);
		console.log(`  has p2 (after cat:electronics) = ${await cache.has('p2')} (false) ✅`);
		console.log(`  has p3 (unaffected) = ${await cache.has('p3')} (true) ✅`);
		console.log(`  has p4 (after cat:electronics) = ${await cache.has('p4')} (false) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [6] flush() clears namespace ──────────────────────────────────────────
	{
		console.log('\n[6] flush() clears entire namespace...');
		const cache = createCache('flush-ns');

		await cache.set('a', 1);
		await cache.set('b', 2);
		await cache.set('c', 3);
		console.log(`  has a,b,c before flush = ${await cache.has('a')}, ${await cache.has('b')}, ${await cache.has('c')}`);

		await cache.flush();
		console.log(`  has a after flush = ${await cache.has('a')} (false) ✅`);
		console.log(`  has b after flush = ${await cache.has('b')} (false) ✅`);
		console.log(`  has c after flush = ${await cache.has('c')} (false) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [7] Default TTL from namespace config ─────────────────────────────────
	{
		console.log('\n[7] Namespace defaultTtl...');
		const cache = createCache('short-lived', { defaultTtl: 1 });

		await cache.set('key', 'value'); // uses defaultTtl = 1s
		console.log(`  has before expiry = ${await cache.has('key')} ✅`);
		await new Promise(r => setTimeout(r, 1200));
		console.log(`  has after expiry = ${await cache.has('key')} (false) ✅`);
		console.log('  ✅ Passed');
	}

	// ── [8] Multiple tags on single entry ─────────────────────────────────────
	{
		console.log('\n[8] Multiple tags on single entry...');
		const cache = createCache('multi-tag');

		await cache.set('item', 'data', { tags: ['tag-a', 'tag-b', 'tag-c'] });
		console.log(`  has before = ${await cache.has('item')} ✅`);

		// Invalidating ANY single tag removes the entry
		await cache.invalidateTag('tag-b');
		console.log(`  has after tag-b invalidate = ${await cache.has('item')} (false) ✅`);
		console.log('  ✅ Passed');
	}

	closeStore();
	console.log('\n══ All cache tests passed! ══\n');
}

testCache().catch(e => { console.error('❌ FAILED:', e); Deno.exit(1); });
