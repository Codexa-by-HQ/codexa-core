/**
 * Test 4: Event Bus
 *
 * Demonstrates:
 * - Local event bus (no Redis needed)
 * - on/once/off/emit
 * - Multiple handlers per event
 * - Channel:event namespacing
 * - listActiveEvents
 */

import { eventBus } from '@codexa/core/bus';
import { createLogger } from '@codexa/core/logger';

const log = createLogger('BusTest');

async function main() {
	log.info('═══ Test: Event Bus ═══');

	// ── Initialize (local mode) ──────────────────────────────────────────────
	await eventBus.initialize({});

	// ── on: persistent listener ──────────────────────────────────────────────
	log.info('\n── on() — persistent listener ──');

	let orderCount = 0;
	eventBus.on<{ id: string; total: number }>('orders', 'created', (data) => {
		orderCount++;
		log.info(`[orders:created] Order #${data.id} — $${data.total} (count: ${orderCount})`);
	});

	eventBus.emit('orders', 'created', { id: 'ORD-001', total: 49.99 });
	eventBus.emit('orders', 'created', { id: 'ORD-002', total: 129.00 });
	eventBus.emit('orders', 'created', { id: 'ORD-003', total: 9.99 });
	log.info(`Total orders received: ${orderCount}`); // 3

	// ── once: fires only once ────────────────────────────────────────────────
	log.info('\n── once() — fires only once ──');

	let startupCount = 0;
	eventBus.once('system', 'ready', () => {
		startupCount++;
		log.info(`[system:ready] System started (count: ${startupCount})`);
	});

	eventBus.emit('system', 'ready', {});
	eventBus.emit('system', 'ready', {}); // ignored
	eventBus.emit('system', 'ready', {}); // ignored
	log.info(`Startup fired ${startupCount} time(s)`); // 1

	// ── Multiple handlers for same event ─────────────────────────────────────
	log.info('\n── Multiple handlers ──');

	eventBus.on('users', 'registered', (data) => {
		log.info(`[Handler 1] Send welcome email to ${(data as { email: string }).email}`);
	});

	eventBus.on('users', 'registered', (data) => {
		log.info(`[Handler 2] Create default workspace for ${(data as { email: string }).email}`);
	});

	eventBus.on('users', 'registered', (data) => {
		log.info(`[Handler 3] Track signup analytics for ${(data as { email: string }).email}`);
	});

	eventBus.emit('users', 'registered', { email: 'alice@example.com' });

	// ── List active events ───────────────────────────────────────────────────
	log.info('\n── listActiveEvents ──');
	const events = eventBus.listActiveEvents();
	log.info(`Active events: ${JSON.stringify(events)}`);

	// ── off: remove handlers ─────────────────────────────────────────────────
	log.info('\n── off() — remove handlers ──');

	eventBus.off('orders', 'created');
	eventBus.emit('orders', 'created', { id: 'ORD-004', total: 0 });
	log.info(`Orders after off: ${orderCount}`); // still 3

	// ── Cleanup ──────────────────────────────────────────────────────────────
	await eventBus.destroy();
	log.info('\n✅ Event bus test passed!');
}

main().catch((e) => {
	console.error('❌ Bus test failed:', e);
	Deno.exit(1);
});
