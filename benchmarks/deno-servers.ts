// One file, four implementations, selected by FRAMEWORK env var.
// Run with: FRAMEWORK=codexa|deno|oak|hono PORT=<port> deno run --allow-net --allow-env deno-servers.ts

const framework = Deno.env.get('FRAMEWORK') ?? 'deno';
const port = Number(Deno.env.get('PORT') ?? 9000);

if (framework === 'codexa') {
	const { createApp, definePlugin } = await import('jsr:@codexa/core/http');
	const { zod } = await import('jsr:@codexa/core/providers/zod');

	const userSchema = zod.object({
		name: zod.string(),
		email: zod.string().email(),
	});

	const benchPlugin = definePlugin({
		name: 'bench',
		setup(scope: any) {
			scope.route({
				method: 'GET',
				path: '/hello',
				handler: (ctx: any) => ctx.json({ ok: true }),
			});
			scope.route({
				method: 'GET',
				path: '/users/:id',
				handler: (ctx: any) => ctx.json({ id: ctx.params.id }),
			});
			scope.route({
				method: 'POST',
				path: '/users',
				handler: async (ctx: any) => {
					try {
						const body = await ctx.request.json();
						const parsed = userSchema.parse(body);
						return ctx.json({ id: crypto.randomUUID(), ...parsed }, {
							status: 201,
						});
					} catch {
						return ctx.json({ error: 'invalid' }, { status: 400 });
					}
				},
			});
		},
	});

	const app = createApp('bench').install(benchPlugin);
	Deno.serve({ port, onListen: () => {} }, app.dispatch);
} else if (framework === 'oak') {
	const { Application, Router } = await import('jsr:@oak/oak@^17');
	const { z } = await import('npm:zod@^4');

	const userSchema = z.object({ name: z.string(), email: z.string().email() });

	const router = new Router();
	router.get('/hello', (ctx: any) => {
		ctx.response.body = { ok: true };
	});
	router.get('/users/:id', (ctx: any) => {
		ctx.response.body = { id: ctx.params.id };
	});
	router.post('/users', async (ctx: any) => {
		try {
			const body = await ctx.request.body.json();
			const parsed = userSchema.parse(body);
			ctx.response.status = 201;
			ctx.response.body = { id: crypto.randomUUID(), ...parsed };
		} catch {
			ctx.response.status = 400;
			ctx.response.body = { error: 'invalid' };
		}
	});

	const app = new Application();
	app.use(router.routes());
	app.use(router.allowedMethods());
	await app.listen({ port });
} else if (framework === 'hono') {
	const { Hono } = await import('jsr:@hono/hono@^4');
	const { z } = await import('npm:zod@^4');

	const userSchema = z.object({ name: z.string(), email: z.string().email() });

	const app = new Hono();
	app.get('/hello', (c: any) => c.json({ ok: true }));
	app.get('/users/:id', (c: any) => c.json({ id: c.req.param('id') }));
	app.post('/users', async (c: any) => {
		try {
			const body = await c.req.json();
			const parsed = userSchema.parse(body);
			return c.json({ id: crypto.randomUUID(), ...parsed }, 201);
		} catch {
			return c.json({ error: 'invalid' }, 400);
		}
	});

	Deno.serve({ port, onListen: () => {} }, app.fetch);
} else {
	// Raw Deno.serve, no framework, direct routing.
	const { z } = await import('npm:zod@^4');
	const userSchema = z.object({ name: z.string(), email: z.string().email() });

	Deno.serve({ port, onListen: () => {} }, async (req) => {
		const url = new URL(req.url);

		if (req.method === 'GET' && url.pathname === '/hello') {
			return Response.json({ ok: true });
		}

		const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);
		if (req.method === 'GET' && userMatch) {
			return Response.json({ id: userMatch[1] });
		}

		if (req.method === 'POST' && url.pathname === '/users') {
			try {
				const body = await req.json();
				const parsed = userSchema.parse(body);
				return Response.json({ id: crypto.randomUUID(), ...parsed }, {
					status: 201,
				});
			} catch {
				return Response.json({ error: 'invalid' }, { status: 400 });
			}
		}

		return Response.json({ error: 'not found' }, { status: 404 });
	});
}
