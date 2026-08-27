import { dirname, join, normalize, relative, resolve } from '@std/path';

const PLUGIN_MANIFEST_FILE = 'plugin.json';
const PLUGIN_REGISTRY_FILE = 'plugins.json';
const PLUGIN_DIRECTORY = 'plugins';
const CODEXA_DIRECTORY = '.codexa';
const MAX_PLUGIN_FILES = 10_000;
const MAX_PLUGIN_BYTES = 100 * 1024 * 1024;
const ROOT_ONLY_DENO_OPTIONS = [
	'workspace',
	'lock',
	'nodeModulesDir',
	'vendor',
	'minimumDependencyAge',
	'links',
	'allowScripts',
	'unstable',
] as const;

export interface PluginManifest {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly entrypoint: string;
	readonly setup?: string;
	readonly codexaCore?: string;
}

export interface PluginInstallOptions {
	readonly projectRoot: string;
	readonly repository?: string;
	readonly ref?: string;
	readonly sourceDirectory?: string;
	readonly runDenoInstall?: boolean;
	readonly runDenoCheck?: boolean;
}

export interface InstalledPlugin {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly directory: string;
	readonly entrypoint: string;
	readonly repository?: string;
	readonly ref?: string;
	readonly commit?: string;
	readonly installedAt: string;
}

interface MutableJsonObject {
	[key: string]: unknown;
}

interface PluginRegistry {
	schemaVersion: 1;
	plugins: Record<string, InstalledPlugin>;
}

interface ResolvedPluginSource {
	readonly directory: string;
	readonly commit?: string;
	readonly cleanup: () => Promise<void>;
}

/** Install one validated plugin into the host workspace with rollback on failure. */
export async function installPlugin(
	options: PluginInstallOptions,
): Promise<InstalledPlugin> {
	const projectRoot = resolve(options.projectRoot);
	const rootConfigPath = await resolveRootConfig(projectRoot);
	const source = await resolvePluginSource(options);

	try {
		const metadata = await resolvePluginManifest(source.directory);
		const pluginRoot = resolve(projectRoot, PLUGIN_DIRECTORY, metadata.id);
		assertInsideProject(projectRoot, pluginRoot);

		if (await pathExists(pluginRoot)) {
			throw new Error(`Plugin "${metadata.id}" is already installed.`);
		}

		const originalConfig = await Deno.readTextFile(rootConfigPath);
		const lockPath = join(projectRoot, 'deno.lock');
		const originalLock = await readOptionalFile(lockPath);
		const registryPath = join(
			projectRoot,
			CODEXA_DIRECTORY,
			PLUGIN_REGISTRY_FILE,
		);
		const originalRegistry = await readOptionalFile(registryPath);
		const stagingRoot = `${pluginRoot}.install-${crypto.randomUUID()}`;

		try {
			await copyPluginTree(source.directory, stagingRoot);
			await Deno.mkdir(dirname(pluginRoot), { recursive: true });
			await Deno.rename(stagingRoot, pluginRoot);
			await addWorkspaceMember(
				rootConfigPath,
				`./${PLUGIN_DIRECTORY}/${metadata.id}`,
			);

			if (options.runDenoInstall !== false) {
				await runCommand('deno', ['install'], projectRoot);
			}
			if (options.runDenoCheck !== false) {
				await runCommand(
					'deno',
					[
						'check',
						join(
							pluginRoot,
							normalizePluginPath(metadata.entrypoint),
						),
					],
					projectRoot,
				);
			}

			const installed = Object.freeze(
				{
					id: metadata.id,
					name: metadata.name,
					version: metadata.version,
					directory: `./${PLUGIN_DIRECTORY}/${metadata.id}`,
					entrypoint: metadata.entrypoint,
					...(options.repository
						? { repository: options.repository }
						: {}),
					...(options.ref ? { ref: options.ref } : {}),
					...(source.commit ? { commit: source.commit } : {}),
					installedAt: new Date().toISOString(),
				} satisfies InstalledPlugin,
			);
			await writePluginRegistry(registryPath, installed);
			return installed;
		} catch (error) {
			const rollbackFailures = await rollbackInstallation({
				pluginRoot,
				stagingRoot,
				rootConfigPath,
				originalConfig,
				lockPath,
				originalLock,
				registryPath,
				originalRegistry,
			});
			if (rollbackFailures.length > 0) {
				throw new AggregateError(
					[error, ...rollbackFailures],
					'Plugin installation and rollback both failed.',
				);
			}
			throw error;
		}
	} finally {
		await source.cleanup();
	}
}

/** Read the host registry without loading or executing any installed plugin code. */
export async function listInstalledPlugins(
	projectRoot: string,
): Promise<readonly InstalledPlugin[]> {
	const registryPath = join(
		resolve(projectRoot),
		CODEXA_DIRECTORY,
		PLUGIN_REGISTRY_FILE,
	);
	const registry = await readPluginRegistry(registryPath);
	return Object.freeze(
		Object.values(registry.plugins).sort((left, right) =>
			left.id.localeCompare(right.id)
		),
	);
}

/** Locate a strict root deno.json because the first CLI version never rewrites JSONC. */
async function resolveRootConfig(projectRoot: string): Promise<string> {
	const denoJson = join(projectRoot, 'deno.json');
	if (await pathExists(denoJson)) return denoJson;
	if (await pathExists(join(projectRoot, 'deno.jsonc'))) {
		throw new Error(
			'Plugin installation currently requires deno.json because rewriting deno.jsonc could remove host comments.',
		);
	}
	throw new Error(`No deno.json exists in host project: ${projectRoot}`);
}

/** Resolve a local test source or clone one exact GitHub ref into temporary storage. */
async function resolvePluginSource(
	options: PluginInstallOptions,
): Promise<ResolvedPluginSource> {
	if (options.sourceDirectory) {
		const directory = resolve(options.sourceDirectory);
		if (!await pathExists(directory)) {
			throw new Error(
				`Plugin source directory does not exist: ${directory}`,
			);
		}
		return { directory, cleanup: () => Promise.resolve() };
	}

	if (!options.repository || !options.ref) {
		throw new Error('A GitHub repository and pinned --ref are required.');
	}
	assertGitHubRepository(options.repository);
	assertGitRef(options.ref);

	const temporaryRoot = await Deno.makeTempDir({ prefix: 'codexa-plugin-' });
	const directory = join(temporaryRoot, 'repository');
	try {
		await runCommand('git', ['init', directory], temporaryRoot);
		await runCommand(
			'git',
			['-C', directory, 'remote', 'add', 'origin', options.repository],
			temporaryRoot,
		);
		await runCommand(
			'git',
			['-C', directory, 'fetch', '--depth', '1', 'origin', options.ref],
			temporaryRoot,
		);
		await runCommand(
			'git',
			['-C', directory, 'checkout', '--detach', 'FETCH_HEAD'],
			temporaryRoot,
		);
		const commit = await runCommand(
			'git',
			['-C', directory, 'rev-parse', 'HEAD'],
			temporaryRoot,
		);
		return {
			directory,
			commit: commit.trim(),
			cleanup: () => Deno.remove(temporaryRoot, { recursive: true }),
		};
	} catch (error) {
		await Deno.remove(temporaryRoot, { recursive: true }).catch(() =>
			undefined
		);
		throw error;
	}
}

/** Validate the required plugin manifest against the package metadata in deno.json. */
async function resolvePluginManifest(
	sourceRoot: string,
): Promise<PluginManifest> {
	const denoConfig = await readJsonObject(join(sourceRoot, 'deno.json'));
	const manifestPath = join(sourceRoot, PLUGIN_MANIFEST_FILE);
	if (!await pathExists(manifestPath)) {
		throw new Error(
			`Plugin repository must contain ${PLUGIN_MANIFEST_FILE}.`,
		);
	}
	const manifest = await readJsonObject(manifestPath);
	const exportsValue = denoConfig.exports;
	const exportedEntry = typeof exportsValue === 'string'
		? exportsValue
		: isJsonObject(exportsValue) && typeof exportsValue['.'] === 'string'
		? exportsValue['.']
		: undefined;
	const resolved = {
		schemaVersion: manifest.schemaVersion,
		id: readString(manifest, 'id'),
		name: readString(manifest, 'name'),
		version: readString(manifest, 'version'),
		entrypoint: readString(manifest, 'entrypoint'),
		setup: readOptionalString(manifest, 'setup'),
		codexaCore: readOptionalString(manifest, 'codexaCore'),
	};

	assertPluginManifest(resolved);
	const validated = resolved as PluginManifest;
	if (
		denoConfig.name !== validated.name ||
		denoConfig.version !== validated.version ||
		exportedEntry !== validated.entrypoint
	) {
		throw new Error(
			'plugin.json name, version, and entrypoint must match deno.json package metadata.',
		);
	}
	for (const option of ROOT_ONLY_DENO_OPTIONS) {
		if (option in denoConfig) {
			throw new Error(
				`Plugin deno.json cannot define root-only option: ${option}`,
			);
		}
	}
	const entrypoint = resolve(
		sourceRoot,
		normalizePluginPath(validated.entrypoint),
	);
	assertInsideProject(sourceRoot, entrypoint);
	if (!await isFile(entrypoint)) {
		throw new Error(
			`Plugin entrypoint does not exist: ${validated.entrypoint}`,
		);
	}
	return Object.freeze(validated);
}

/** Copy plugin source recursively while excluding Git metadata and rejecting symlinks. */
async function copyPluginTree(
	sourceRoot: string,
	destinationRoot: string,
): Promise<void> {
	let fileCount = 0;
	let totalBytes = 0;
	await Deno.mkdir(destinationRoot, { recursive: true });

	async function copyDirectory(
		source: string,
		destination: string,
	): Promise<void> {
		for await (const entry of Deno.readDir(source)) {
			if (entry.name === '.git') continue;
			const sourcePath = join(source, entry.name);
			const destinationPath = join(destination, entry.name);
			const info = await Deno.lstat(sourcePath);
			if (info.isSymlink) {
				throw new Error(
					`Plugin archives cannot contain symbolic links: ${sourcePath}`,
				);
			}
			if (info.isDirectory) {
				await Deno.mkdir(destinationPath, { recursive: true });
				await copyDirectory(sourcePath, destinationPath);
				continue;
			}
			if (!info.isFile) continue;
			fileCount++;
			totalBytes += info.size;
			if (fileCount > MAX_PLUGIN_FILES || totalBytes > MAX_PLUGIN_BYTES) {
				throw new Error(
					'Plugin exceeds the supported installation size.',
				);
			}
			await Deno.copyFile(sourcePath, destinationPath);
		}
	}

	await copyDirectory(sourceRoot, destinationRoot);
}

/** Append the plugin directory once while preserving all existing workspace members. */
async function addWorkspaceMember(
	configPath: string,
	member: string,
): Promise<void> {
	const config = await readJsonObject(configPath);
	const workspace = config.workspace;
	if (workspace !== undefined && !Array.isArray(workspace)) {
		throw new Error('Host deno.json workspace must be an array.');
	}
	const members = workspace ? [...workspace] : [];
	if (members.some((value) => typeof value !== 'string')) {
		throw new Error(
			'Host deno.json workspace contains a non-string member.',
		);
	}
	if (!members.includes(member)) members.push(member);
	config.workspace = members;
	await writeJsonFile(configPath, config);
}

/** Persist installation metadata separately from executable plugin configuration. */
async function writePluginRegistry(
	registryPath: string,
	plugin: InstalledPlugin,
): Promise<void> {
	const registry = await readPluginRegistry(registryPath);
	if (registry.plugins[plugin.id]) {
		throw new Error(`Plugin registry already contains "${plugin.id}".`);
	}
	registry.plugins[plugin.id] = plugin;
	await Deno.mkdir(dirname(registryPath), { recursive: true });
	await writeJsonFile(registryPath, registry as unknown as MutableJsonObject);
}

/** Read and validate the host-owned plugin registry, or create its empty representation. */
async function readPluginRegistry(
	registryPath: string,
): Promise<PluginRegistry> {
	if (!await pathExists(registryPath)) {
		return { schemaVersion: 1, plugins: {} };
	}
	const parsed = await readJsonObject(registryPath);
	if (parsed.schemaVersion !== 1 || !isJsonObject(parsed.plugins)) {
		throw new Error('Codexa plugin registry is invalid.');
	}
	return {
		schemaVersion: 1,
		plugins: parsed.plugins as unknown as Record<string, InstalledPlugin>,
	};
}

/** Restore every host file touched by a failed installation and report cleanup failures. */
async function rollbackInstallation(input: {
	pluginRoot: string;
	stagingRoot: string;
	rootConfigPath: string;
	originalConfig: string;
	lockPath: string;
	originalLock: string | undefined;
	registryPath: string;
	originalRegistry: string | undefined;
}): Promise<unknown[]> {
	const operations = [
		removeIfExists(input.pluginRoot),
		removeIfExists(input.stagingRoot),
		Deno.writeTextFile(input.rootConfigPath, input.originalConfig),
		restoreOptionalFile(input.lockPath, input.originalLock),
		restoreOptionalFile(input.registryPath, input.originalRegistry),
	];
	const results = await Promise.allSettled(operations);
	return results.flatMap((result) =>
		result.status === 'rejected' ? [result.reason] : []
	);
}

/** Execute one subprocess without a shell and include stderr in any failure. */
async function runCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<string> {
	const output = await new Deno.Command(command, {
		args,
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

/** Validate the static fields that define an installable workspace package. */
function assertPluginManifest(value: MutableJsonObject): void {
	if (value.schemaVersion !== 1) {
		throw new Error('Plugin manifest schemaVersion must be 1.');
	}
	if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(value.id ?? ''))) {
		throw new Error(
			'Plugin id must use lowercase letters, numbers, and hyphens.',
		);
	}
	if (
		!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(
			String(value.name ?? ''),
		)
	) {
		throw new Error('Plugin package name must use the @scope/name format.');
	}
	if (
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value.version ?? ''))
	) {
		throw new Error('Plugin version must be a semantic version.');
	}
	if (typeof value.entrypoint !== 'string') {
		throw new Error('Plugin entrypoint is required.');
	}
	normalizePluginPath(value.entrypoint);
	if (value.setup !== undefined) normalizePluginPath(String(value.setup));
}

/** Allow only public HTTPS GitHub repository URLs in the first installer version. */
function assertGitHubRepository(repository: string): void {
	const url = new URL(repository);
	if (
		url.protocol !== 'https:' || url.hostname !== 'github.com' ||
		url.pathname.split('/').filter(Boolean).length !== 2
	) {
		throw new Error(
			'Plugin repository must be a public HTTPS GitHub repository URL.',
		);
	}
}

/** Reject ambiguous or option-like Git refs before passing them to Git. */
function assertGitRef(ref: string): void {
	if (
		ref.startsWith('-') || ref.includes('..') ||
		!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)
	) {
		throw new Error(
			'Plugin ref is invalid. Use a release tag or exact commit.',
		);
	}
}

/** Convert a plugin-relative path while rejecting absolute and parent traversal paths. */
function normalizePluginPath(value: string): string {
	const normalized = normalize(value.replaceAll('\\', '/')).replaceAll(
		'\\',
		'/',
	);
	if (
		value.length === 0 || value.startsWith('/') ||
		/^[A-Za-z]:/.test(value) ||
		normalized === '..' || normalized.startsWith('../')
	) {
		throw new Error(
			`Plugin path must remain inside its directory: ${value}`,
		);
	}
	return normalized.replace(/^\.\//, '');
}

/** Ensure a resolved target remains under the expected project or plugin root. */
function assertInsideProject(root: string, target: string): void {
	const child = relative(resolve(root), resolve(target));
	if (
		child === '' || child === '..' ||
		child.startsWith(`..${Deno.build.os === 'windows' ? '\\' : '/'}`)
	) {
		throw new Error(`Path escapes its expected root: ${target}`);
	}
}

/** Read one required JSON object with a focused validation error. */
async function readJsonObject(path: string): Promise<MutableJsonObject> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await Deno.readTextFile(path));
	} catch (error) {
		throw new Error(`Cannot read JSON object: ${path}`, { cause: error });
	}
	if (!isJsonObject(parsed)) {
		throw new Error(`Expected a JSON object: ${path}`);
	}
	return parsed;
}

/** Write deterministic JSON through a sibling temporary file before replacement. */
async function writeJsonFile(
	path: string,
	value: MutableJsonObject,
): Promise<void> {
	await Deno.mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	await Deno.writeTextFile(
		temporaryPath,
		`${JSON.stringify(value, null, '\t')}\n`,
	);
	try {
		await Deno.rename(temporaryPath, path);
	} catch (error) {
		await Deno.remove(temporaryPath).catch(() => undefined);
		throw error;
	}
}

/** Read an optional file so rollback can distinguish missing files from empty files. */
async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await Deno.readTextFile(path);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return undefined;
		throw error;
	}
}

/** Restore an optional file to its exact pre-installation state. */
async function restoreOptionalFile(
	path: string,
	value: string | undefined,
): Promise<void> {
	if (value === undefined) {
		await removeIfExists(path);
		return;
	}
	await Deno.mkdir(dirname(path), { recursive: true });
	await Deno.writeTextFile(path, value);
}

/** Remove one exact path only when it exists. */
async function removeIfExists(path: string): Promise<void> {
	try {
		await Deno.remove(path, { recursive: true });
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
}

/** Check path existence without hiding permission or filesystem failures. */
async function pathExists(path: string): Promise<boolean> {
	try {
		await Deno.lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return false;
		throw error;
	}
}

/** Check that an entrypoint resolves to a regular file. */
async function isFile(path: string): Promise<boolean> {
	try {
		return (await Deno.lstat(path)).isFile;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return false;
		throw error;
	}
}

/** Narrow unknown JSON values to plain object records. */
function isJsonObject(value: unknown): value is MutableJsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read one required string field from parsed JSON. */
function readString(value: MutableJsonObject, key: string): string | undefined {
	return typeof value[key] === 'string' ? value[key] : undefined;
}

/** Read one optional string while rejecting invalid manifest field types. */
function readOptionalString(
	value: MutableJsonObject,
	key: string,
): string | undefined {
	const field = value[key];
	if (field === undefined) return undefined;
	if (typeof field !== 'string') {
		throw new Error(`Plugin manifest ${key} must be a string.`);
	}
	return field;
}
