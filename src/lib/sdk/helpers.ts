import { basename, join, relative } from '@std/path';
import type { OpenApiDocument, OpenApiSource } from '../openapi/mod.ts';

export type SdkPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface SdkPackageJsonOptions {
	readonly name: string;
	readonly version: string;
}

const UNSAFE_PROPERTY_IDENTIFIERS = new Set([
	'constructor',
	'prototype',
	'__proto__',
]);

const PACKAGE_NAME_PATTERN =
	/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isOpenApiDocument(value: unknown): value is OpenApiDocument {
	return isRecord(value) && typeof value.openapi === 'string' &&
		isRecord(value.paths);
}

function isOpenApiSource(value: unknown): value is OpenApiSource {
	return isRecord(value) && typeof value.inspect === 'function';
}

export function resolveExport(
	loaded: Record<string, unknown>,
	exportName?: string,
): OpenApiSource | OpenApiDocument {
	const value = exportName === undefined
		? loaded.default
		: loaded[exportName];
	if (isOpenApiDocument(value) || isOpenApiSource(value)) return value;
	throw new Error(
		`SDK entrypoint must export a Codexa app or OpenAPI document${
			exportName === undefined ? ' as default' : ` named "${exportName}"`
		}.`,
	);
}

export function createPackageJson(
	options: SdkPackageJsonOptions,
): Record<string, unknown> {
	assertValidPackageIdentity(options);
	return {
		name: options.name,
		version: options.version,
		type: 'module',
		main: './dist/index.js',
		module: './dist/index.js',
		types: './dist/index.d.ts',
		exports: {
			'.': {
				import: './dist/index.js',
				types: './dist/index.d.ts',
			},
		},
		files: ['dist', 'src', 'README.md'],
		sideEffects: false,
	};
}

export function createTsConfig(): Record<string, unknown> {
	return {
		compilerOptions: {
			target: 'ES2020',
			module: 'ESNext',
			moduleResolution: 'Bundler',
			lib: ['ES2020', 'DOM', 'DOM.Iterable'],
			declaration: true,
			outDir: './dist',
			rootDir: './src',
			strict: true,
			skipLibCheck: true,
		},
		include: ['./src'],
	};
}

export async function writeJson(
	path: string,
	value: Record<string, unknown>,
): Promise<void> {
	await Deno.writeTextFile(path, `${JSON.stringify(value, null, '\t')}\n`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertValidPackageIdentity(
	options: SdkPackageJsonOptions,
): void {
	if (!PACKAGE_NAME_PATTERN.test(options.name)) {
		throw new Error(
			`SDK package name must be a valid npm package name: ${options.name}`,
		);
	}
	if (!PACKAGE_VERSION_PATTERN.test(options.version)) {
		throw new Error(
			`SDK version must be a valid npm semver version, for example 1.0.0: ${options.version}`,
		);
	}
}

export function toIdentifier(value: string): string {
	const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const [first = 'api', ...rest] = words;
	let identifier = [
		first.toLowerCase(),
		...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
	].join('');
	if (!/^[a-zA-Z_$]/.test(identifier)) identifier = `_${identifier}`;
	return UNSAFE_PROPERTY_IDENTIFIERS.has(identifier)
		? `_${identifier}`
		: identifier;
}

export function toPascalIdentifier(value: string): string {
	const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	let identifier =
		words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(
			'',
		) || 'CodexaSdk';
	if (!/^[a-zA-Z_$]/.test(identifier)) identifier = `_${identifier}`;
	return UNSAFE_PROPERTY_IDENTIFIERS.has(identifier.toLowerCase())
		? `_${identifier}`
		: identifier;
}

export async function detectPackageManager(
	projectRoot: string,
): Promise<SdkPackageManager> {
	if (await exists(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
	if (await exists(join(projectRoot, 'package-lock.json'))) return 'npm';
	if (await exists(join(projectRoot, 'yarn.lock'))) return 'yarn';
	if (
		await exists(join(projectRoot, 'bun.lockb')) ||
		await exists(join(projectRoot, 'bun.lock'))
	) return 'bun';
	return 'npm';
}

export function packageManagerInstallArgs(
	packageManager: SdkPackageManager,
	packageFile: string,
): string[] {
	if (packageManager === 'npm') return ['install', packageFile];
	return ['add', packageFile];
}

export function toPackageManagerPath(
	projectRoot: string,
	packageFile: string,
): string {
	const path = relative(projectRoot, packageFile).replaceAll('\\', '/');
	if (/^[a-zA-Z]:\//.test(path) || path.startsWith('/')) return path;
	return path.startsWith('.') ? path : `./${path}`;
}

export async function packSdkPackage(outDir: string): Promise<string> {
	const stdout = await runCommand(
		'npm',
		['pack', '--pack-destination', outDir, '--json'],
		outDir,
	);
	const packageName = parsePackedPackageName(stdout);
	if (packageName === undefined) {
		throw new Error('npm pack did not report a generated SDK package.');
	}
	return join(outDir, packageName);
}

function parsePackedPackageName(stdout: string): string | undefined {
	try {
		const result = JSON.parse(stdout) as unknown;
		if (Array.isArray(result) && isRecord(result[0])) {
			const filename = result[0].filename;
			return typeof filename === 'string' ? filename : undefined;
		}
	} catch {
		// Older npm versions can still print the filename as plain text.
	}
	return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}

export async function resolveSdkPackageFile(
	sdkDirOrFile: string,
	version?: string,
): Promise<string> {
	let info: Deno.FileInfo;
	try {
		info = await Deno.lstat(sdkDirOrFile);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			throw new Error(`SDK package path does not exist: ${sdkDirOrFile}`);
		}
		throw error;
	}
	if (info.isFile) {
		if (!sdkDirOrFile.endsWith('.tgz')) {
			throw new Error(`SDK package must be a .tgz file: ${sdkDirOrFile}`);
		}
		if (
			version !== undefined &&
			!basename(sdkDirOrFile).endsWith(`-${version}.tgz`)
		) {
			throw new Error(
				`SDK package file does not match requested -V ${version}: ${sdkDirOrFile}`,
			);
		}
		return sdkDirOrFile;
	}
	const packageDir = version === undefined
		? sdkDirOrFile
		: join(sdkDirOrFile, version);
	if (!(await exists(packageDir))) {
		throw new Error(
			`SDK version directory does not exist: ${packageDir}. Run sdk generate with -V ${
				version ?? '<version>'
			} first.`,
		);
	}
	const packageFiles: string[] = [];
	for await (const entry of Deno.readDir(packageDir)) {
		if (entry.isFile && entry.name.endsWith('.tgz')) {
			packageFiles.push(join(packageDir, entry.name));
		}
	}
	if (packageFiles.length === 0) {
		throw new Error(
			`No generated SDK .tgz package found in ${packageDir}. Run sdk generate with the same -V value first.`,
		);
	}
	if (packageFiles.length > 1) {
		throw new Error(
			`Multiple SDK .tgz packages found in ${packageDir}. Pass the exact .tgz path instead.`,
		);
	}
	return packageFiles[0];
}

export async function runCommand(
	command: string,
	args: readonly string[],
	cwd: string,
): Promise<string> {
	const output = await new Deno.Command(command, {
		args: [...args],
		cwd,
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	const decoder = new TextDecoder();
	if (!output.success) {
		const details = decoder.decode(output.stderr).trim();
		throw new Error(
			`${command} ${args.join(' ')} failed${
				details ? `: ${details}` : '.'
			}`,
		);
	}
	return decoder.decode(output.stdout);
}

export async function exists(path: string): Promise<boolean> {
	try {
		await Deno.lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return false;
		throw error;
	}
}
