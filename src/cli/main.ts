#!/usr/bin/env -S deno run

import { installPlugin, listInstalledPlugins } from './plugin.ts';
import {
	generateSdkFromEntrypoint,
	installSdkPackage,
	type SdkPackageManager,
} from '../lib/sdk/mod.ts';

interface ParsedArguments {
	readonly positionals: string[];
	readonly options: Readonly<Record<string, string | boolean>>;
}

const HELP = `Codexa plugin CLI

Usage:
  codexa plugin add <github-url> --ref <tag-or-commit> [options]
  codexa plugin list [--project <directory>]
  codexa sdk generate <entrypoint> --out <directory> --name <package-name> -V <version> [options]
  codexa sdk install <sdk-directory-or-tarball> --project <frontend-directory> -V <version> [options]

Install options:
  --project <directory>   Host project containing deno.json
  --ref <value>           Required release tag or exact commit

SDK options:
  --project <directory>   Project root for relative entrypoint/out paths
  --out <directory>       Directory where the SDK package is written
  --name <package-name>   Generated package name
  --client <class-name>   Generated client class name, default CodexaSDK
  --export <name>         Named export to load, default export is used otherwise
  --base-url <url>        Default base URL baked into the generated SDK
  --version, -V <value>   Required generated package version
  --force                 Replace an existing generated SDK version directory
  --install <directory>   Install generated SDK into a frontend project
  --package-manager <pm>  npm, pnpm, yarn, or bun

Examples:
  codexa plugin add https://github.com/Codexa-by-HQ/oauth --ref v1.0.0
  codexa plugin list
  codexa sdk generate ./main.ts --out ./sdk --name @acme/api-sdk --client AcmeSDK -V 1.0.0
  codexa sdk install ./sdk --project ../frontend -V 1.0.0 --package-manager pnpm
`;

/** Run the public CLI and return a process exit code for embedding and tests. */
export async function runCodexaCli(args: readonly string[]): Promise<number> {
	try {
		const parsed = parseArguments(args);
		const [group, command, repository] = parsed.positionals;
		if (
			parsed.options.help === true || group === undefined ||
			group === 'help' ||
			group === '--help'
		) {
			console.log(HELP);
			return 0;
		}
		if (group === 'sdk') {
			if (command === 'install') {
				if (!repository) {
					throw new Error('SDK directory is required.');
				}
				const installed = await installSdkPackage({
					sdkDir: resolvePath(Deno.cwd(), repository),
					projectRoot: resolvePath(
						Deno.cwd(),
						requiredOption(parsed, 'project'),
					),
					version: requiredOption(parsed, 'version'),
					packageManager: packageManagerOption(parsed),
				});
				console.log(
					`Installed SDK from ${installed.packageFile} into ${installed.projectRoot} with ${installed.packageManager}`,
				);
				return 0;
			}
			if (command !== 'generate') {
				throw new Error(
					`Unknown sdk command: ${command ?? '(missing)'}`,
				);
			}
			if (!repository) {
				throw new Error('SDK entrypoint is required.');
			}
			const projectRoot = optionString(parsed, 'project') ?? Deno.cwd();
			const version = requiredOption(parsed, 'version');
			const outRoot = resolvePath(
				projectRoot,
				requiredOption(parsed, 'out'),
			);
			const generated = await generateSdkFromEntrypoint({
				entrypoint: resolvePath(projectRoot, repository),
				outDir: joinPath(outRoot, version),
				name: requiredOption(parsed, 'name'),
				clientName: optionString(parsed, 'client'),
				exportName: optionString(parsed, 'export'),
				baseUrl: optionString(parsed, 'base-url'),
				version,
				overwrite: parsed.options.force === true,
			});
			console.log(
				`Generated SDK in ${generated.outDir} and packed ${generated.packageFile} (${generated.routeCount} route(s), ${generated.skippedRouteCount} skipped from SDK)`,
			);
			const installProject = optionString(parsed, 'install');
			if (installProject !== undefined) {
				const installed = await installSdkPackage({
					sdkDir: outRoot,
					projectRoot: resolvePath(projectRoot, installProject),
					version,
					packageManager: packageManagerOption(parsed),
				});
				console.log(
					`Installed SDK package ${installed.packageFile} into ${installed.projectRoot} with ${installed.packageManager}`,
				);
			}
			return 0;
		}
		if (group !== 'plugin') {
			throw new Error(`Unknown command group: ${group}`);
		}

		const projectRoot = optionString(parsed, 'project') ?? Deno.cwd();
		if (command === 'add') {
			if (!repository) {
				throw new Error('Plugin GitHub repository URL is required.');
			}
			const installed = await installPlugin({
				projectRoot,
				repository,
				ref: requiredOption(parsed, 'ref'),
			});
			console.log(
				`Installed ${installed.name}@${installed.version} in ${installed.directory}`,
			);
			return 0;
		}
		if (command === 'list') {
			const plugins = await listInstalledPlugins(projectRoot);
			if (plugins.length === 0) {
				console.log('No Codexa plugins are installed.');
				return 0;
			}
			for (const plugin of plugins) {
				console.log(
					`${plugin.id}\t${plugin.name}@${plugin.version}\t${plugin.directory}`,
				);
			}
			return 0;
		}
		throw new Error(`Unknown plugin command: ${command ?? '(missing)'}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

/** Parse positional arguments and conventional --name value or --name=value flags. */
function parseArguments(args: readonly string[]): ParsedArguments {
	const positionals: string[] = [];
	const options: Record<string, string | boolean> = {};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '-V') {
			const next = args[index + 1];
			if (next !== undefined && !next.startsWith('-')) {
				options.version = next;
				index++;
				continue;
			}
			options.version = true;
			continue;
		}
		if (!argument.startsWith('--')) {
			positionals.push(argument);
			continue;
		}
		const separator = argument.indexOf('=');
		if (separator > 2) {
			options[argument.slice(2, separator)] = argument.slice(
				separator + 1,
			);
			continue;
		}
		const name = argument.slice(2);
		const next = args[index + 1];
		if (next !== undefined && !next.startsWith('--')) {
			options[name] = next;
			index++;
		} else {
			options[name] = true;
		}
	}
	return { positionals, options };
}

/** Read an optional CLI string and reject boolean misuse. */
function optionString(
	parsed: ParsedArguments,
	name: string,
): string | undefined {
	const value = parsed.options[name];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`--${name} requires a value.`);
	}
	return value;
}

/** Read one required CLI option with a focused error. */
function requiredOption(parsed: ParsedArguments, name: string): string {
	const value = optionString(parsed, name);
	if (!value) throw new Error(`--${name} is required.`);
	return value;
}

function packageManagerOption(
	parsed: ParsedArguments,
): SdkPackageManager | undefined {
	const value = optionString(parsed, 'package-manager');
	if (value === undefined) return undefined;
	if (
		value === 'npm' || value === 'pnpm' || value === 'yarn' ||
		value === 'bun'
	) return value;
	throw new Error('--package-manager must be npm, pnpm, yarn, or bun.');
}

function resolvePath(projectRoot: string, path: string): string {
	if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path;
	return `${projectRoot.replace(/[\\/]$/, '')}/${path}`;
}

function joinPath(root: string, child: string): string {
	return `${root.replace(/[\\/]$/, '')}/${child.replace(/^[\\/]/, '')}`;
}

if (import.meta.main) Deno.exit(await runCodexaCli(Deno.args));
