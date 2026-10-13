/** Copy the validated build into the sibling public release repository. */
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(privateRoot, 'dist');
const publicRoot = resolve(privateRoot, '..', 'public');
const parentRoot = dirname(privateRoot);

async function assertPublicDestination(): Promise<void> {
	if (
		dirname(publicRoot) !== parentRoot ||
		relative(parentRoot, publicRoot) !== 'public'
	) {
		throw new Error(
			'The release destination must be the sibling public directory.',
		);
	}
	if ((await Deno.lstat(publicRoot)).isSymlink) {
		throw new Error('The public directory must not be a symlink.');
	}
	if (
		dirname(await Deno.realPath(publicRoot)) !==
			await Deno.realPath(parentRoot)
	) {
		throw new Error(
			'The public directory resolves outside the intended workspace.',
		);
	}
}

function isReleaseFile(path: string): boolean {
	return path.endsWith('.js') || path.endsWith('.d.ts') ||
		['deno.json', 'README.md', 'LICENSE', 'env.example.txt'].includes(path);
}

/** Validate the entire tree before copying or replacing any files. */
async function filesIn(directory: string, base = directory): Promise<string[]> {
	const files: string[] = [];
	for await (const entry of Deno.readDir(directory)) {
		const path = join(directory, entry.name);
		if (entry.isSymlink) {
			throw new Error('Release trees must not contain symlinks: ' + path);
		}
		if (entry.isDirectory) {
			files.push(...await filesIn(path, base));
		} else if (entry.isFile) {
			files.push(relative(base, path).replaceAll('\\', '/'));
		} else {
			throw new Error('Unsupported release entry: ' + path);
		}
	}
	return files.sort();
}

function assertOnlyReleaseFiles(files: string[]): void {
	for (const path of files) {
		if (!isReleaseFile(path)) {
			throw new Error('Unexpected build file: ' + path);
		}
	}
}

async function assertValidReleaseConfig(files: string[]): Promise<void> {
	const releaseConfig = JSON.parse(
		await Deno.readTextFile(join(buildRoot, 'deno.json')),
	);
	const sourceConfig = JSON.parse(
		await Deno.readTextFile(join(privateRoot, 'deno.json')),
	);
	if (
		releaseConfig.name !== sourceConfig.name ||
		releaseConfig.version !== sourceConfig.version
	) {
		throw new Error(
			'The build does not match the current source package. Run deno task build.',
		);
	}
	for (const path of Object.values(releaseConfig.exports) as string[]) {
		if (
			!path.endsWith('.js') || !files.includes(path.replace(/^\.\//, ''))
		) {
			throw new Error('Missing compiled release export: ' + path);
		}
	}
	if (
		releaseConfig.tasks?.build ||
		Object.values(releaseConfig.tasks ?? {}).some(
			(task) => typeof task === 'string' && task.includes('scripts/'),
		)
	) {
		throw new Error(
			'The release configuration must not depend on private build scripts.',
		);
	}
}

// Only the generated src tree is replaced. Git metadata and workflows are preserved.
async function removeGeneratedSrc(): Promise<void> {
	const generatedSrc = join(publicRoot, 'src');
	try {
		const existing = await filesIn(generatedSrc);
		if (
			existing.some((path) =>
				!path.endsWith('.js') && !path.endsWith('.d.ts')
			)
		) {
			throw new Error(
				'public/src contains non-build files; refusing to replace them.',
			);
		}
		if ((await Deno.lstat(generatedSrc)).isSymlink) {
			throw new Error('Refusing to replace a symlink at public/src.');
		}
		await Deno.remove(generatedSrc, { recursive: true });
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
}

async function copyReleaseFiles(files: string[]): Promise<void> {
	for (const path of files) {
		const destination = join(publicRoot, path);
		try {
			if ((await Deno.lstat(destination)).isSymlink) {
				throw new Error(
					'Refusing to overwrite a symlink: ' + destination,
				);
			}
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
		await Deno.mkdir(dirname(destination), { recursive: true });
		await Deno.copyFile(join(buildRoot, path), destination);
	}
}

await assertPublicDestination();

const files = await filesIn(buildRoot);
assertOnlyReleaseFiles(files);
await assertValidReleaseConfig(files);

await removeGeneratedSrc();
await copyReleaseFiles(files);

console.log(
	'Prepared ' + files.length +
		' release files in ../public. Git history and workflows were preserved.',
);