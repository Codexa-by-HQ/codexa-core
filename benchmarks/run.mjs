import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import autocannon from 'autocannon';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG = { connections: 50, duration: 10, pipelining: 1, warmup: 3 };

const frameworks = [
	{
		key: 'codexa',
		label: 'Codexa Core',
		version: 'jsr:@codexa/core@latest',
		port: 9001,
		cmd: 'deno',
		args: ['run', '--allow-net', '--allow-env', 'deno-servers.ts'],
		env: { FRAMEWORK: 'codexa' },
	},
	{
		key: 'deno',
		label: 'Deno (no framework)',
		version: 'Deno.serve + Zod',
		port: 9002,
		cmd: 'deno',
		args: ['run', '--allow-net', '--allow-env', 'deno-servers.ts'],
		env: { FRAMEWORK: 'deno' },
	},
	{
		key: 'oak',
		label: 'Oak (Deno)',
		version: 'jsr:@oak/oak@^17',
		port: 9003,
		cmd: 'deno',
		args: ['run', '--allow-net', '--allow-env', 'deno-servers.ts'],
		env: { FRAMEWORK: 'oak' },
	},
	{
		key: 'express',
		label: 'Express (Node)',
		version: 'express@^5.1.0',
		port: 9004,
		cmd: 'node',
		args: ['express-server.js'],
		env: {},
	},
	{
		key: 'hono',
		label: 'Hono (Deno)',
		version: 'jsr:@hono/hono@^4',
		port: 9005,
		cmd: 'deno',
		args: ['run', '--allow-net', '--allow-env', 'deno-servers.ts'],
		env: { FRAMEWORK: 'hono' },
	},
];

const endpoints = [
	{
		key: 'users-post',
		label: 'POST /users',
		method: 'POST',
		path: '/users',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Ada Lovelace', email: 'ada@example.com' }),
	},
	{ key: 'hello', label: 'GET /hello', method: 'GET', path: '/hello' },
	{
		key: 'users-get',
		label: 'GET /users/:id',
		method: 'GET',
		path: '/users/123',
	},
];

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(port, timeoutMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/hello`);
			if (res.ok) return;
		} catch {
			// server not accepting connections yet
		}
		await sleep(150);
	}
	throw new Error(`server on port ${port} did not become ready in time`);
}

function killProcess(child) {
	if (!child || child.exitCode !== null) return;
	if (process.platform === 'win32') {
		try {
			execFileSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
				stdio: 'ignore',
			});
			return;
		} catch {
			// fall through to plain kill
		}
	}
	try {
		child.kill('SIGTERM');
	} catch {
		// process may already be gone
	}
}

function runAutocannon(opts) {
	return new Promise((resolve, reject) => {
		autocannon(opts, (err, result) => {
			if (err) return reject(err);
			resolve(result);
		});
	});
}

async function benchEndpoint(port, endpoint) {
	const base = {
		url: `http://127.0.0.1:${port}${endpoint.path}`,
		method: endpoint.method,
		headers: endpoint.headers,
		body: endpoint.body,
		connections: CONFIG.connections,
		pipelining: CONFIG.pipelining,
	};

	await runAutocannon({ ...base, duration: CONFIG.warmup });
	const result = await runAutocannon({ ...base, duration: CONFIG.duration });

	return {
		requestsPerSecAvg: result.requests.average,
		requestsPerSecMax: result.requests.max,
		latencyAvgMs: result.latency.average,
		latencyP99Ms: result.latency.p99,
		throughputAvgMBs: Number(
			(result.throughput.average / 1024 / 1024).toFixed(3),
		),
		errors: result.errors,
		timeouts: result.timeouts,
		totalRequests: result.requests.total,
	};
}

async function benchFramework(fw) {
	console.log(`\n▶ ${fw.label}`);
	const child = spawn(fw.cmd, fw.args, {
		cwd: __dirname,
		env: { ...process.env, PORT: String(fw.port), ...fw.env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let stderr = '';
	child.stderr?.on('data', (chunk) => {
		stderr += chunk.toString();
	});

	try {
		await waitForReady(fw.port);
	} catch (err) {
		killProcess(child);
		console.error(`  failed to start: ${err.message}`);
		if (stderr) console.error(`  stderr: ${stderr.slice(0, 500)}`);
		return {
			key: fw.key,
			label: fw.label,
			version: fw.version,
			error: err.message,
		};
	}

	const endpointResults = {};
	for (const endpoint of endpoints) {
		process.stdout.write(`  ${endpoint.label} ... `);
		try {
			const result = await benchEndpoint(fw.port, endpoint);
			endpointResults[endpoint.key] = result;
			console.log(`${Math.round(result.requestsPerSecAvg)} req/s`);
		} catch (err) {
			console.log(`failed (${err.message})`);
			endpointResults[endpoint.key] = { error: err.message };
		}
	}

	killProcess(child);
	await sleep(400);

	return {
		key: fw.key,
		label: fw.label,
		version: fw.version,
		endpoints: endpointResults,
	};
}

async function main() {
	console.log('Codexa Core benchmarks');
	console.log(
		`connections=${CONFIG.connections} duration=${CONFIG.duration}s warmup=${CONFIG.warmup}s`,
	);

	const results = [];
	for (const fw of frameworks) {
		const result = await benchFramework(fw);
		results.push(result);
	}

	const denoVersion = execFileSync('deno', ['--version'], { encoding: 'utf8' })
		.split('\n')[0]
		.replace('deno ', '');

	const output = {
		generatedAt: new Date().toISOString(),
		config: CONFIG,
		env: {
			os: `${os.type()} ${os.release()} (${os.arch()})`,
			cpu: os.cpus()[0]?.model ?? 'unknown',
			cores: os.cpus().length,
		},
		legend: {
			node: process.version.replace('v', ''),
			deno: denoVersion,
			frameworks: Object.fromEntries(
				frameworks.map((fw) => [fw.key, fw.version]),
			),
		},
		endpoints: endpoints.map((e) => e.label),
		endpointKeys: endpoints.map((e) => e.key),
		results,
	};

	writeFileSync(
		join(__dirname, 'results/results.json'),
		JSON.stringify(output, null, 2),
	);

	writeFileSync(join(__dirname, 'results/results.md'), toMarkdown(output));

	console.log('\nWrote results/results.json and results/results.md');
}

function toMarkdown(output) {
	const lines = [];
	lines.push('# Codexa Core benchmark results');
	lines.push('');
	lines.push(`Generated: ${output.generatedAt}`);
	lines.push('');
	lines.push(
		`Load: ${output.config.connections} connections, ${output.config.duration}s duration, pipelining ${output.config.pipelining}, ${output.config.warmup}s warmup (discarded) per endpoint per framework.`,
	);
	lines.push('');
	lines.push(
		`Machine: ${output.env.cpu}, ${output.env.cores} cores, ${output.env.os}. Node ${output.legend.node}, Deno ${output.legend.deno}.`,
	);
	lines.push('');
	lines.push(
		'These numbers are from one developer machine, not a dedicated benchmark server. Treat them as directional, not authoritative, and reproduce with `npm run bench` before relying on them.',
	);
	lines.push('');

	output.endpoints.forEach((endpoint, idx) => {
		lines.push(`## ${endpoint}`);
		lines.push('');
		lines.push(
			'| Framework | req/s (avg) | latency avg (ms) | latency p99 (ms) |',
		);
		lines.push('| --- | --- | --- | --- |');
		for (const fw of output.results) {
			const endpointKey = output.endpointKeys[idx];
			const stat = fw.endpoints?.[endpointKey];
			if (!stat || stat.error) {
				lines.push(`| ${fw.label} | error | - | - |`);
				continue;
			}
			lines.push(
				`| ${fw.label} | ${Math.round(stat.requestsPerSecAvg)} | ${stat.latencyAvgMs.toFixed(2)} | ${stat.latencyP99Ms.toFixed(2)} |`,
			);
		}
		lines.push('');
	});

	return lines.join('\n');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
