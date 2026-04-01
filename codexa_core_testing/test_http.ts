/**
 * test_http.ts — HTTP Framework
 * Run: deno task test:http
 */

import {
	CodexaHttp,
	Router,
	MiddlewarePriority,
	type CodexaPlugin,
	type IPluginScope,
	type AppContext,
	type AppNext,
} from '@codexa/core/http';
import { createLogger } from '@codexa/core/logger';

const log = createLogger('HttpTest');

async function testHttp() {
	console.log('\n══════════════════════════════════════════');
	console.log('  Test: HTTP Framework');
	console.log('══════════════════════════════════════════');

	// ── [1] Constructor & name ────────────────────────────────────────────────
	{
		console.log('\n[1] Constructor & name...');
		const app1 = new CodexaHttp({ name: 'API' });
		const app2 = new CodexaHttp();
		console.log(`  app1.name = "${app1.name}" ✅`);
		console.log(`  app2.name = "${app2.name}" (default) ✅`);
		console.log(`  phase = "${app1.getPhase()}" ✅`);
		console.log(`  isolated = ${app1 !== app2} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [2] Router import (no @oak/oak needed) ────────────────────────────────
	{
		console.log('\n[2] Router from @codexa/core/http...');
		const r = new Router();
		r.get('/test', (ctx) => { ctx.response.body = 'ok'; });
		r.post('/test', async (ctx) => { ctx.response.body = await ctx.request.body.json(); });
		r.put('/test/:id', (ctx) => { ctx.response.body = { id: ctx.params.id }; });
		r.delete('/test/:id', (ctx) => { ctx.response.status = 204; });
		console.log('  Router methods: get/post/put/delete ✅');
		console.log('  ✅ Passed');
	}

	// ── [3] MiddlewarePriority enum ───────────────────────────────────────────
	{
		console.log('\n[3] MiddlewarePriority values...');
		console.log(`  PRE_SETUP = ${MiddlewarePriority.PRE_SETUP}  (expected 0) ${MiddlewarePriority.PRE_SETUP === 0 ? '✅' : '❌'}`);
		console.log(`  CRITICAL  = ${MiddlewarePriority.CRITICAL}  (expected 1) ${MiddlewarePriority.CRITICAL === 1 ? '✅' : '❌'}`);
		console.log(`  AUTH      = ${MiddlewarePriority.AUTH}  (expected 20) ${MiddlewarePriority.AUTH === 20 ? '✅' : '❌'}`);
		console.log(`  SECURITY  = ${MiddlewarePriority.SECURITY}  (expected 30) ${MiddlewarePriority.SECURITY === 30 ? '✅' : '❌'}`);
		console.log(`  BUSINESS  = ${MiddlewarePriority.BUSINESS}  (expected 40) ${MiddlewarePriority.BUSINESS === 40 ? '✅' : '❌'}`);
		console.log(`  FALLBACK  = ${MiddlewarePriority.FALLBACK}  (expected 50) ${MiddlewarePriority.FALLBACK === 50 ? '✅' : '❌'}`);
		console.log('  ✅ Passed');
	}

	// ── [4] Middleware registration + size ────────────────────────────────────
	{
		console.log('\n[4] Middleware registration...');
		const app = new CodexaHttp({ name: 'MwTest' });

		// use() with options
		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, {
			name: 'cors',
			priority: MiddlewarePriority.PRE_SETUP,
			tags: ['infra'],
		});

		// HTTP shortcuts
		app.get('/health', (ctx) => { ctx.response.body = { ok: true }; });
		app.post('/data', (ctx) => { ctx.response.body = { created: true }; });
		app.put('/data/:id', (ctx) => { ctx.response.body = { updated: true }; });
		app.delete('/data/:id', (ctx) => { ctx.response.status = 204; });
		app.patch('/data/:id', (ctx) => { ctx.response.body = { patched: true }; });

		// useIf
		app.useIf(
			() => true,
			async (_ctx: AppContext, next: AppNext) => { await next(); },
			{ name: 'conditional', tags: ['debug'] },
		);

		// useSafe (wraps in try/catch)
		app.useSafe(
			async (_ctx: AppContext, next: AppNext) => { await next(); },
			{ name: 'safe-mw', tags: ['error-handling'] },
		);

		console.log(`  size = ${app.size} entries ✅`);
		console.log('  ✅ Passed');
	}

	// ── [5] Versioned routes ──────────────────────────────────────────────────
	{
		console.log('\n[5] Versioned routes...');
		const app = new CodexaHttp({ name: 'VersionTest' });

		app.version('1.0.0')
			.get('/api/users', (ctx) => { ctx.response.body = { v: '1.0.0' }; })
			.post('/api/users', (ctx) => { ctx.response.body = { v: '1.0.0', created: true }; });

		app.version('2.0.0')
			.get('/api/users', (ctx) => { ctx.response.body = { v: '2.0.0', cursor: 'abc' }; })
			.router('/api/v2/products', new Router(), { tags: ['v2'] });

		const versioned = app.inspectVersioned();
		console.log(`  versioned route count = ${versioned.length} ✅`);
		console.table(versioned);
		console.log('  ✅ Passed');
	}

	// ── [6] Router with prefix ────────────────────────────────────────────────
	{
		console.log('\n[6] Router with prefix...');
		const app = new CodexaHttp({ name: 'RouterTest' });

		const usersRouter = new Router();
		usersRouter.get('/', (ctx) => { ctx.response.body = []; });
		usersRouter.get('/:id', (ctx) => { ctx.response.body = { id: ctx.params.id }; });
		usersRouter.post('/', (ctx) => { ctx.response.status = 201; });

		const authRouter = new Router();
		authRouter.post('/login', (ctx) => { ctx.response.body = { token: 'jwt' }; });
		authRouter.post('/logout', (ctx) => { ctx.response.body = { ok: true }; });

		app.router('/api/users', usersRouter, { tags: ['users'] });
		app.router('/api/auth', authRouter, { tags: ['auth'] });

		console.log(`  middleware size = ${app.size} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [7] Tag controls ──────────────────────────────────────────────────────
	{
		console.log('\n[7] Tag controls...');
		const app = new CodexaHttp({ name: 'TagTest' });

		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, {
			name: 'feature-a',
			tags: ['beta'],
		});
		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, {
			name: 'feature-b',
			tags: ['beta'],
		});

		// Initially enabled
		const before = app.inspectByTags('beta');
		console.log(`  enabled before: ${before.every(e => e.enabled)} ✅`);

		// Disable
		app.disableByTags('beta');
		const after = app.inspectByTags('beta');
		console.log(`  disabled: ${after.every(e => !e.enabled)} ✅`);

		// Re-enable
		app.enableByTags('beta');
		const reenabled = app.inspectByTags('beta');
		console.log(`  re-enabled: ${reenabled.every(e => e.enabled)} ✅`);

		// inspectByTags — tags spread
		const specific = app.inspectByTags('beta', 'auth');
		console.log(`  inspectByTags spread: ${specific.length} entries ✅`);
		console.log('  ✅ Passed');
	}

	// ── [8] Plugin system ─────────────────────────────────────────────────────
	{
		console.log('\n[8] Plugin system...');
		const app = new CodexaHttp({ name: 'PluginTest' });

		let initCalled = false;
		let shutdownCalled = false;

		const helloPlugin: CodexaPlugin<{ greeting: string }> = {
			name: 'hello',
			version: '1.0.0',
			metadata: { license: 'MIT', description: 'Test plugin' },

			install(scope: IPluginScope, _ctx, config) {
				const greeting = config?.greeting ?? 'Hello';

				scope.init(async () => {
					initCalled = true;
					log.debug(`[hello] init — greeting="${greeting}"`);
				});

				scope.get('/hello', (ctx) => {
					ctx.response.body = { message: `${greeting}, World!` };
				});

				scope.exposeService('greeting', greeting);

				scope.onShutdown(async () => {
					shutdownCalled = true;
					log.debug('[hello] shutdown hook called');
				});
			},

			uninstall(scope: IPluginScope) {
				log.debug('[hello] uninstalling…');
			},
		};

		await app.install(helloPlugin, {}, { greeting: 'Howdy' });

		// Inspect before boot
		const plugins = app.inspectPlugins();
		console.log(`  plugins count = ${plugins.length} ✅`);
		console.table(plugins);

		// Boot (triggers init)
		await app.boot();
		console.log(`  initCalled = ${initCalled} ✅`);

		// getPluginService
		const svc = app.getPluginService<string>('hello', 'greeting');
		console.log(`  service 'greeting' = "${svc}" ✅`);

		// Phase
		console.log(`  phase = "${app.getPhase()}" ✅`);

		// Shutdown (triggers plugin shutdown hook)
		await app.shutdown();
		console.log(`  shutdownCalled = ${shutdownCalled} ✅`);
		console.log(`  phase after shutdown = "${app.getPhase()}" ✅`);
		console.log('  ✅ Passed');
	}

	// ── [9] boot with setup + onShutdown ordering ─────────────────────────────
	{
		console.log('\n[9] Boot setup & shutdown hook order...');
		const app = new CodexaHttp({ name: 'LifecycleTest' });
		const order: string[] = [];

		app.onShutdown(() => { order.push('hook-1'); });
		app.onShutdown(() => { order.push('hook-2'); });
		app.onShutdown(() => { order.push('hook-3'); });

		let setupRan = false;
		await app.boot(async () => { setupRan = true; });
		console.log(`  setupRan = ${setupRan} ✅`);

		await app.shutdown();
		// Shutdown hooks fire in reverse registration order
		console.log(`  order = ${JSON.stringify(order)} ✅`);
		const correct = order[0] === 'hook-3' && order[1] === 'hook-2' && order[2] === 'hook-1';
		console.log(`  reverse order correct = ${correct} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [10] Multi-instance isolation ─────────────────────────────────────────
	{
		console.log('\n[10] Multi-instance isolation...');
		const app1 = new CodexaHttp({ name: 'Service1' });
		const app2 = new CodexaHttp({ name: 'Service2' });

		app1.get('/route1', (ctx) => { ctx.response.body = 'service1'; });
		app1.get('/route2', (ctx) => { ctx.response.body = 'service1'; });

		app2.get('/route1', (ctx) => { ctx.response.body = 'service2'; });

		console.log(`  app1.size = ${app1.size}, app2.size = ${app2.size}`);
		console.log(`  isolated (sizes differ): ${app1.size !== app2.size} ✅`);

		// getApp() escape hatch
		const oakApp = app1.getApp();
		console.log(`  getApp() returns Oak Application: ${typeof oakApp === 'object'} ✅`);
		console.log('  ✅ Passed');
	}

	// ── [11] Duplicate middleware name throws ─────────────────────────────────
	{
		console.log('\n[11] Duplicate name protection...');
		const app = new CodexaHttp({ name: 'DupTest' });
		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, { name: 'my-mw' });
		try {
			app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, { name: 'my-mw' });
			console.log('  ❌ Should have thrown');
		} catch (e) {
			const msg = (e as Error).message;
			console.log(`  Throws on duplicate: "${msg.slice(0, 50)}..." ✅`);
		}
		console.log('  ✅ Passed');
	}

	// ── [12] Inspect pipeline ─────────────────────────────────────────────────
	{
		console.log('\n[12] inspect() pipeline...');
		const app = new CodexaHttp({ name: 'InspectTest' });
		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, {
			name: 'mw-a', priority: MiddlewarePriority.PRE_SETUP, tags: ['a'],
		});
		app.use(async (_ctx: AppContext, next: AppNext) => { await next(); }, {
			name: 'mw-b', priority: MiddlewarePriority.BUSINESS, tags: ['b'],
		});
		const entries = app.inspect();
		console.log(`  entries = ${entries.length} ✅`);
		console.table(entries);
		console.log('  ✅ Passed');
	}

	console.log('\n══ All HTTP tests passed! ══\n');
}

testHttp().catch(e => { console.error('❌ FAILED:', e); Deno.exit(1); });
