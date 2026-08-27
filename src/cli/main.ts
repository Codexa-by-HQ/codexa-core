#!/usr/bin/env -S deno run

import { installPlugin, listInstalledPlugins } from './plugin.ts';

interface ParsedArguments {
	readonly positionals: string[];
	readonly options: Readonly<Record<string, string | boolean>>;
}

const HELP = `Codexa plugin CLI

Usage:
  codexa plugin add <github-url> --ref <tag-or-commit> [options]
  codexa plugin list [--project <directory>]

Install options:
  --project <directory>   Host project containing deno.json
  --ref <value>           Required release tag or exact commit

Examples:
  codexa plugin add https://github.com/Codexa-by-HQ/oauth --ref v1.0.0
  codexa plugin list
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

if (import.meta.main) Deno.exit(await runCodexaCli(Deno.args));
