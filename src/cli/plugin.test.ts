import {
	assertEquals,
	assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { installPlugin, listInstalledPlugins } from './plugin.ts';

Deno.test('plugin CLI installs a local package as an isolated workspace member', async () => {
	const temporaryRoot = await Deno.makeTempDir({
		prefix: 'codexa-cli-test-',
	});
	const hostRoot = `${temporaryRoot}/host`;
	const pluginSource = `${temporaryRoot}/source`;
	try {
		await Deno.mkdir(hostRoot, { recursive: true });
		await Deno.mkdir(`${pluginSource}/src`, { recursive: true });
		await Deno.mkdir(`${pluginSource}/.git`, { recursive: true });
		await Deno.writeTextFile(
			`${hostRoot}/deno.json`,
			JSON.stringify({ tasks: { dev: 'deno run main.ts' } }, null, '\t'),
		);
		await Deno.writeTextFile(
			`${pluginSource}/deno.json`,
			JSON.stringify(
				{
					name: '@codexa/oauth',
					version: '1.0.0',
					exports: { '.': './plugin.ts' },
				},
				null,
				'\t',
			),
		);
		await Deno.writeTextFile(
			`${pluginSource}/plugin.json`,
			JSON.stringify(
				{
					schemaVersion: 1,
					id: 'oauth',
					name: '@codexa/oauth',
					version: '1.0.0',
					entrypoint: './plugin.ts',
				},
				null,
				'\t',
			),
		);
		await Deno.writeTextFile(
			`${pluginSource}/plugin.ts`,
			'export const installed = true;\n',
		);
		await Deno.writeTextFile(
			`${pluginSource}/.git/config`,
			'private metadata',
		);

		const installed = await installPlugin({
			projectRoot: hostRoot,
			sourceDirectory: pluginSource,
			runDenoInstall: false,
			runDenoCheck: false,
		});

		assertEquals(installed.id, 'oauth');
		const hostConfig = JSON.parse(
			await Deno.readTextFile(`${hostRoot}/deno.json`),
		);
		assertEquals(hostConfig.tasks.dev, 'deno run main.ts');
		assertEquals(hostConfig.workspace, ['./plugins/oauth']);
		const pluginConfig = JSON.parse(
			await Deno.readTextFile(`${hostRoot}/plugins/oauth/deno.json`),
		);
		assertEquals(pluginConfig.name, '@codexa/oauth');
		assertEquals(pluginConfig.version, '1.0.0');
		assertEquals(pluginConfig.exports['.'], './plugin.ts');
		assertEquals(pluginConfig.exports['.'], './plugin.ts');
		await assertRejects(() => Deno.stat(`${hostRoot}/plugins/oauth/.git`));
		assertEquals((await listInstalledPlugins(hostRoot)).length, 1);
	} finally {
		await Deno.remove(temporaryRoot, { recursive: true });
	}
});

Deno.test('plugin CLI refuses duplicate installations without changing the workspace', async () => {
	const temporaryRoot = await Deno.makeTempDir({
		prefix: 'codexa-cli-test-',
	});
	const hostRoot = `${temporaryRoot}/host`;
	const pluginSource = `${temporaryRoot}/source`;
	try {
		await Deno.mkdir(hostRoot, { recursive: true });
		await Deno.mkdir(pluginSource, { recursive: true });
		await Deno.writeTextFile(`${hostRoot}/deno.json`, '{}');
		await Deno.writeTextFile(
			`${pluginSource}/deno.json`,
			JSON.stringify({
				name: '@codexa/oauth',
				version: '1.0.0',
				exports: { '.': './plugin.ts' },
			}),
		);
		await Deno.writeTextFile(
			`${pluginSource}/plugin.json`,
			JSON.stringify({
				schemaVersion: 1,
				id: 'oauth',
				name: '@codexa/oauth',
				version: '1.0.0',
				entrypoint: './plugin.ts',
			}),
		);
		await Deno.writeTextFile(`${pluginSource}/plugin.ts`, 'export {};\n');
		const options = {
			projectRoot: hostRoot,
			sourceDirectory: pluginSource,
			runDenoInstall: false,
			runDenoCheck: false,
		} as const;
		await installPlugin(options);
		const configBefore = await Deno.readTextFile(`${hostRoot}/deno.json`);
		await assertRejects(
			() => installPlugin(options),
			Error,
			'already installed',
		);
		assertEquals(
			await Deno.readTextFile(`${hostRoot}/deno.json`),
			configBefore,
		);
	} finally {
		await Deno.remove(temporaryRoot, { recursive: true });
	}
});
