import {
	assertEquals,
	assertExists,
	assertRejects,
	assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
	createApp,
	createRouter,
	definePlugin,
	definePluginMiddleware,
	type ICodexaHttp,
	type ICodexaPlugin,
} from '../src/lib/http/mod.ts';
import * as jetrouter from '../src/providers/jetrouter.ts';

async function withRoutes(
	setup: ICodexaPlugin<'routing', void>['setup'],
	run: (app: ICodexaHttp<'routing'>) => Promise<void>,
): Promise<void> {
	const app = createApp('JetRouterTests').install(
		definePlugin({ name: 'routing', setup }),
	);
	try {
		await run(app);
	} finally {
		await app.shutdown();
	}
}

function request(
	app: ICodexaHttp<'routing'>,
	path: string,
	method = 'GET',
	headers?: HeadersInit,
): Promise<Response> {
	return app.dispatch(
		new Request(`http://local.test${path}`, { method, headers }),
	);
}

async function json(
	app: ICodexaHttp<'routing'>,
	path: string,
	method = 'GET',
	headers?: HeadersInit,
): Promise<unknown> {
	const response = await request(app, path, method, headers);
	assertEquals(response.status, 200, `${method} ${path}`);
	return await response.json();
}

Deno.test('jetrouter: provider exposes the published engine and functional API', async () => {
	const providers = await import('../src/providers/mod.ts');
	assertEquals(providers.jetrouter.Router, jetrouter.Router);
	const matcher = jetrouter.createRouter<{ action: string }>();
	jetrouter.addRoute(matcher, 'GET', '/users/:id', { action: 'show' });
	matcher.compile();
	assertEquals(jetrouter.findRoute(matcher, 'GET', '/users/42'), {
		data: { action: 'show' },
		params: { id: '42' },
	});
	assertEquals(
		jetrouter.findAllRoutes(matcher, 'GET', '/users/42').length,
		1,
	);
	assertEquals(jetrouter.routeToRegExp('/users/:id').test('/users/42'), true);
	assertEquals(jetrouter.removeRoute(matcher, 'GET', '/users/:id'), true);
	assertEquals(jetrouter.findRoute(matcher, 'GET', '/users/42'), undefined);
});

Deno.test('http/jetrouter: exact paths ignore one trailing slash only', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/users',
			handler: (ctx) => ctx.json('users'),
		});
		scope.route({
			method: 'GET',
			path: '/',
			handler: (ctx) => ctx.json('root'),
		});
	}, async (app) => {
		assertEquals(await json(app, '/users'), 'users');
		assertEquals(await json(app, '/users/'), 'users');
		assertEquals(await json(app, '/'), 'root');
		assertEquals(await json(app, '//'), 'root');
		for (
			const path of [
				'/users//',
				'/users///',
				'/users////',
				'///',
				'/Users',
				'/missing',
			]
		) {
			assertEquals((await request(app, path)).status, 404, path);
		}
	});
});

Deno.test('http/jetrouter: query strings do not affect matching and params stay encoded', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/users/:id',
			handler: (ctx) => ctx.json(ctx.params),
		});
	}, async (app) => {
		for (const id of ['42', 'a%2Fb', 'a%252Fb', '%E2%9C%93', '%ZZ']) {
			assertEquals(await json(app, `/users/${id}?sort=name`), { id });
		}
		assertEquals(await json(app, '/users/42/'), { id: '42' });
		for (const path of ['/users/42//', '/users//42', '/users/42/extra']) {
			assertEquals((await request(app, path)).status, 404, path);
		}
	});
});

Deno.test('http/jetrouter: static routes beat params and catch-alls in either registration order', async () => {
	for (const reverse of [false, true]) {
		await withRoutes((scope) => {
			const paths = ['/users/**:tail', '/users/:id', '/users/new'];
			for (const path of reverse ? paths.reverse() : paths) {
				scope.route({
					method: 'GET',
					path,
					handler: (ctx) =>
						ctx.json({ route: path, params: ctx.params }),
				});
			}
		}, async (app) => {
			assertEquals(await json(app, '/users/new'), {
				route: '/users/new',
				params: {},
			});
			assertEquals(await json(app, '/users/42'), {
				route: '/users/:id',
				params: { id: '42' },
			});
			assertEquals(await json(app, '/users/42/posts'), {
				route: '/users/**:tail',
				params: { tail: '42/posts' },
			});
		});
	}
});

Deno.test('http/jetrouter: constrained params beat unconstrained params', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/items/:slug',
			handler: (ctx) => ctx.json({ slug: ctx.params.slug }),
		});
		scope.route({
			method: 'GET',
			path: '/items/:id(\\d+)',
			handler: (ctx) => ctx.json({ id: ctx.params.id }),
		});
	}, async (app) => {
		assertEquals(await json(app, '/items/123'), { id: '123' });
		assertEquals(await json(app, '/items/abc'), { slug: 'abc' });
		assertEquals((await request(app, '/items/123//')).status, 404);
	});
});

Deno.test('http/jetrouter: optional and repeated params and optional groups dispatch', async () => {
	await withRoutes((scope) => {
		for (
			const path of [
				'/optional/:id?',
				'/repeat/:parts+',
				'/zero/:parts*',
				'/book{s}?',
			]
		) {
			scope.route({
				method: 'GET',
				path,
				handler: (ctx) => ctx.json(ctx.params),
			});
		}
	}, async (app) => {
		assertEquals(await json(app, '/optional'), {});
		assertEquals(await json(app, '/optional/42'), { id: '42' });
		assertEquals(await json(app, '/repeat/a/b'), { parts: 'a/b' });
		assertEquals((await request(app, '/repeat')).status, 404);
		assertEquals(await json(app, '/zero'), {});
		assertEquals(await json(app, '/zero/a/b'), { parts: 'a/b' });
		assertEquals(await json(app, '/book'), {});
		assertEquals(await json(app, '/books'), {});
	});
});

Deno.test('http/jetrouter: named and unnamed wildcards capture their documented values', async () => {
	await withRoutes((scope) => {
		for (const path of ['/files/**:path', '/unnamed/**', '/single/*']) {
			scope.route({
				method: 'GET',
				path,
				handler: (ctx) => ctx.json(ctx.params),
			});
		}
	}, async (app) => {
		assertEquals(await json(app, '/files/a/b.txt'), { path: 'a/b.txt' });
		assertEquals((await request(app, '/files')).status, 404);
		assertEquals(await json(app, '/unnamed'), {});
		assertEquals(await json(app, '/unnamed/a/b.txt'), { _: 'a/b.txt' });
		assertEquals(await json(app, '/single/a'), { '0': 'a' });
		assertEquals((await request(app, '/single/a/b')).status, 404);
	});
});

Deno.test('http/jetrouter: multiple captures in one segment preserve parameter names', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/images/:name.:ext',
			handler: (ctx) => ctx.json(ctx.params),
		});
	}, async (app) => {
		assertEquals(await json(app, '/images/photo.jpg'), {
			name: 'photo',
			ext: 'jpg',
		});
		assertEquals((await request(app, '/images/photo')).status, 404);
	});
});

Deno.test('http/jetrouter: methods stay independent with explicit HEAD and OPTIONS routes', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: ['GET', 'POST'],
			path: '/shared',
			handler: (ctx) => ctx.json('shared'),
		});
		scope.route({
			method: 'HEAD',
			path: '/explicit',
			handler: (ctx) =>
				ctx.send(null, { headers: { 'x-route': 'head' } }),
		});
		scope.route({
			method: 'OPTIONS',
			path: '/explicit',
			handler: (ctx) => ctx.json('options'),
		});
	}, async (app) => {
		assertEquals(await json(app, '/shared'), 'shared');
		assertEquals(await json(app, '/shared', 'POST'), 'shared');
		for (const method of ['PUT', 'HEAD', 'OPTIONS']) {
			assertEquals((await request(app, '/shared', method)).status, 404);
		}
		const head = await request(app, '/explicit', 'HEAD');
		assertEquals(head.status, 200);
		assertEquals(head.headers.get('x-route'), 'head');
		assertEquals(await head.text(), '');
		assertEquals(await json(app, '/explicit', 'OPTIONS'), 'options');
		assertEquals((await request(app, '/shared', 'PROPFIND')).status, 501);
	});
});

Deno.test('http/jetrouter: mounted routers preserve prefixes, params and inspection metadata', async () => {
	const users = createRouter('users').route({
		method: 'GET',
		path: '/users/:id',
		handler: (ctx) => ctx.json(ctx.params),
		options: { tags: ['users'] },
	});
	await withRoutes((scope) => {
		scope.mount('/api/v1', users);
		scope.mount('/api/v2', users);
	}, async (app) => {
		assertEquals(await json(app, '/api/v1/users/42'), { id: '42' });
		assertEquals(await json(app, '/api/v2/users/7/'), { id: '7' });
		assertEquals((await request(app, '/api/v2/users/7//')).status, 404);
		assertEquals((await request(app, '/users/42')).status, 404);
		assertEquals(
			app.inspect({ tags: ['users'] }).routes.map((route) => route.path),
			[
				'/api/v1/users/:id',
				'/api/v2/users/:id',
			],
		);
	});
});

Deno.test('http/jetrouter: version buckets share a matcher entry and honor the plugin header', async () => {
	const app = createApp('versions').install(definePlugin({
		name: 'versions',
		versionHeader: 'X-API-Version',
		setup(scope) {
			scope.route({
				method: 'GET',
				path: '/users/:id',
				handler: (ctx) =>
					ctx.json({ id: ctx.params.id, version: 'default' }),
			});
			for (const version of ['1', '2']) {
				scope.version(version).route({
					method: 'GET',
					path: '/users/:id',
					handler: (ctx) => ctx.json({ id: ctx.params.id, version }),
				});
			}
		},
	}));
	try {
		await app.boot();
		for (
			const [headers, expected] of [
				[{}, 'default'],
				[{ 'X-API-Version': '1' }, '1'],
				[{ 'X-API-Version': '2' }, '2'],
			] as const
		) {
			const response = await app.dispatch(
				new Request('http://local.test/users/42', { headers }),
			);
			assertEquals(response.status, 200);
			assertEquals(await response.json(), {
				id: '42',
				version: expected,
			});
		}
		const response = await app.dispatch(
			new Request('http://local.test/users/42', {
				headers: { 'X-API-Version': '3' },
			}),
		);
		assertEquals(response.status, 404);
	} finally {
		await app.shutdown();
	}
});

Deno.test('http/jetrouter: tag changes recompile the matcher without losing other routes', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/feature/:id',
			handler: (ctx) => ctx.json(ctx.params),
			options: { tags: ['feature'] },
		});
		scope.route({
			method: 'GET',
			path: '/health',
			handler: (ctx) => ctx.json('ok'),
		});
	}, async (app) => {
		await app.boot();
		for (let i = 0; i < 3; i++) {
			assertEquals(await json(app, '/feature/42'), { id: '42' });
			app.disableByTags('feature');
			assertEquals((await request(app, '/feature/42')).status, 404);
			assertEquals(await json(app, '/health'), 'ok');
			app.enableByTags('feature');
		}
		assertEquals(await json(app, '/feature/7'), { id: '7' });
	});
});

Deno.test('http/jetrouter: middleware and success hooks receive the selected route params', async () => {
	const middlewareParams: unknown[] = [];
	const hookParams: unknown[] = [];
	const source = definePluginMiddleware<{ source: string }>({
		name: 'source',
		appliedOn: ['guarded'],
		fn(ctx) {
			middlewareParams.push(ctx.params);
			ctx.provide({ source: 'middleware' });
		},
		expose(data) {
			return data;
		},
	});
	await withRoutes((scope) => {
		scope.use(source).route({
			method: 'GET',
			path: '/users/:id',
			handler: (ctx) =>
				ctx.json({ id: ctx.params.id, source: ctx.state.source }),
			options: { tags: ['guarded'] },
		});
		scope.onSuccess((event) => {
			hookParams.push(event.params);
		});
	}, async (app) => {
		assertEquals(await json(app, '/users/42'), {
			id: '42',
			source: 'middleware',
		});
		assertEquals(middlewareParams, [{ id: '42' }]);
		assertEquals(hookParams, [{ id: '42' }]);
	});
});

Deno.test('http/jetrouter: not-found handler receives malformed trailing slash requests', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/users',
			handler: (ctx) => ctx.json('users'),
		});
	}, async (app) => {
		app.onNotFound((req) =>
			Response.json({ path: new URL(req.url).pathname }, { status: 404 })
		);
		const response = await request(app, '/users//');
		assertEquals(response.status, 404);
		assertEquals(await response.json(), { path: '/users//' });
	});
});

Deno.test('http/jetrouter: native regex conversion matches dispatch and named captures', async () => {
	await withRoutes((scope) => {
		for (
			const path of ['/users/:id', '/items/:id(\\d+)', '/files/**:path']
		) {
			scope.route({
				method: 'GET',
				path,
				handler: (ctx) => ctx.json(ctx.params),
			});
		}
	}, async (app) => {
		await app.boot();
		for (
			const [pattern, path, groups] of [
				['/users/:id', '/users/42', { id: '42' }],
				['/items/:id(\\d+)', '/items/123', { id: '123' }],
				['/files/**:path', '/files/a/b', { path: 'a/b' }],
			] as const
		) {
			const regex = app.toRegExp('GET', pattern);
			assertExists(regex);
			assertEquals<unknown>({ ...regex.exec(path)?.groups }, groups);
			assertEquals(await json(app, path), groups);
			assertEquals(regex.test(`${path}/`), true);
		}
		assertEquals(
			app.toRegExp('GET', '/users/:id')?.test('/users/42//'),
			false,
		);
		assertEquals(
			app.toRegExp('GET', '/items/:id(\\d+)')?.test('/items/abc'),
			false,
		);
		assertEquals(app.toRegExp('POST', '/users/:id'), null);
		assertEquals(app.toRegExp('GET', '/missing'), null);
	});
});

Deno.test('http/jetrouter: malformed patterns fail at boot before requests are accepted', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/files/**/invalid',
			handler: (ctx) => ctx.json('invalid'),
		});
	}, async (app) => {
		await assertRejects(() => app.boot(), Error);
		assertEquals(app.getPhase(), 'stopped');
	});
});

Deno.test('http/jetrouter: duplicate method/path definitions are rejected', () => {
	assertThrows(
		() =>
			createRouter('duplicates')
				.route({
					method: 'GET',
					path: '/users',
					handler: (ctx) => ctx.json('first'),
				})
				.route({
					method: 'GET',
					path: '/users',
					handler: (ctx) => ctx.json('second'),
				}),
		Error,
		'Duplicate route',
	);
});

Deno.test('http/jetrouter: concurrent first requests boot once and keep params isolated', async () => {
	await withRoutes((scope) => {
		scope.route({
			method: 'GET',
			path: '/users/:id',
			handler: async (ctx) => {
				await Promise.resolve();
				return ctx.json(ctx.params);
			},
		});
	}, async (app) => {
		assertEquals(app.getPhase(), 'idle');
		const responses = await Promise.all(
			Array.from(
				{ length: 40 },
				(_, index) => json(app, `/users/${index}`),
			),
		);
		assertEquals(
			responses,
			Array.from({ length: 40 }, (_, index) => ({ id: String(index) })),
		);
		assertEquals(app.getPhase(), 'ready');
		await app.shutdown();
		assertEquals((await request(app, '/users/42')).status, 503);
	});
});
