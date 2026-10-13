/** Build a JSR release without original TypeScript implementation files. */
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'npm:typescript@6.0.3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const config = JSON.parse(await Deno.readTextFile(join(root, 'deno.json')));

const compilerOptions: ts.CompilerOptions = {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	verbatimModuleSyntax: true,
	removeComments: true,
	sourceMap: false,
	inlineSourceMap: false,
	declarationMap: false,
};

const printer = ts.createPrinter({ removeComments: false });
let compiledFiles = 0;

const releaseInstructions = [
	'## Publishing This Release',
	'',
	'This repository contains generated JavaScript and type declarations for `@codexa/core`. Original TypeScript implementation files, build scripts, tests, and source maps are kept in the private development repository.',
	'',
	'Validate the existing release files:',
	'',
	'```bash',
	'deno task check',
	'deno task dry-run',
	'```',
	'',
	'Publish the existing build:',
	'',
	'```bash',
	'deno task publish',
	'```',
	'',
	'This repository does not build the framework. A new release is prepared in the private project with `deno task release:prepare`, then the generated files are committed here. GitHub Actions publishes tags matching `v*` or a manually triggered release, using the repository linked to the package in JSR.',
	'',
	'',
].join('\n');

const toJsPath = (path: string): string => path.replace(/\.ts$/, '.js');
const toDeclarationPath = (path: string): string =>
	path.replace(/\.ts$/, '.d.ts');

async function prepareOutputDirectory(): Promise<void> {
	// Resolve and check the single, fixed build directory before recursive removal.
	if (relative(root, outDir) !== 'dist') {
		throw new Error('Build output must be the project dist directory.');
	}
	try {
		if ((await Deno.lstat(outDir)).isSymlink) {
			throw new Error('Refusing to replace a symlink at dist.');
		}
		await Deno.remove(outDir, { recursive: true });
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
	await Deno.mkdir(outDir, { recursive: true });
}

/** Rewrite module specifiers, leaving SDK templates and other strings intact. */
function rewriteImports(
	declaration: boolean,
): ts.TransformerFactory<ts.SourceFile> {
	return (context) => {
		const visit: ts.Visitor = (node) => {
			if (ts.isStringLiteral(node)) {
				const parent = node.parent;
				const isModule = parent && (
					ts.isImportDeclaration(parent) ||
					ts.isExportDeclaration(parent) ||
					(ts.isLiteralTypeNode(parent) &&
						ts.isImportTypeNode(parent.parent)) ||
					(ts.isCallExpression(parent) &&
						parent.expression.kind === ts.SyntaxKind.ImportKeyword)
				);
				if (isModule && /^\.{1,2}\//.test(node.text)) {
					const suffix = declaration ? '.d.ts' : '.js';
					return context.factory.createStringLiteral(
						node.text.replace(/(?<!\.d)\.ts$/, suffix),
					);
				}
			}
			return ts.visitEachChild(node, visit, context);
		};
		return (source) => ts.visitNode(source, visit) as ts.SourceFile;
	};
}

function checkDiagnostics(
	fileName: string,
	diagnostics: readonly ts.Diagnostic[] = [],
): void {
	const errors = diagnostics.filter((d) =>
		d.category === ts.DiagnosticCategory.Error
	);
	if (errors.length > 0) {
		const messages = errors.map((d) =>
			ts.flattenDiagnosticMessageText(d.messageText, '\n')
		);
		throw new Error(fileName + ':\n' + messages.join('\n'));
	}
}

function rewriteDeclaration(fileName: string, source: string): string {
	const parsed = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.ESNext,
		true,
	);
	const result = ts.transform(parsed, [rewriteImports(true)]);
	try {
		return printer.printFile(result.transformed[0]);
	} finally {
		result.dispose();
	}
}

/** Insert the `@ts-self-types` directive, keeping a leading shebang first. */
function addTypesDirective(code: string, declarationName: string): string {
	const directive = '/* @ts-self-types="./' + declarationName + '" */\n';
	const shebang = code.match(/^#![^\n]*\n/);
	return shebang
		? shebang[0] + directive + code.slice(shebang[0].length)
		: directive + code;
}

async function compileFile(path: string): Promise<void> {
	const fileName = relative(root, path);
	const source = await Deno.readTextFile(path);
	const destination = join(outDir, fileName);
	await Deno.mkdir(dirname(destination), { recursive: true });

	if (path.endsWith('.d.ts')) {
		await Deno.writeTextFile(
			destination,
			rewriteDeclaration(fileName, source),
		);
		return;
	}

	const runtime = ts.transpileModule(source, {
		fileName,
		compilerOptions,
		reportDiagnostics: true,
		transformers: { before: [rewriteImports(false)] },
	});
	checkDiagnostics(fileName, runtime.diagnostics);

	const declaration = ts.transpileDeclaration(source, {
		fileName,
		compilerOptions: { ...compilerOptions, removeComments: false },
	});
	checkDiagnostics(fileName, declaration.diagnostics);

	await Deno.writeTextFile(
		toDeclarationPath(destination),
		rewriteDeclaration(
			toDeclarationPath(fileName),
			declaration.outputText,
		),
	);
	await Deno.writeTextFile(
		toJsPath(destination),
		addTypesDirective(
			runtime.outputText,
			basename(toDeclarationPath(destination)),
		),
	);
	compiledFiles++;
}

async function compileDirectory(directory: string): Promise<void> {
	for await (const entry of Deno.readDir(directory)) {
		const path = join(directory, entry.name);
		if (entry.isDirectory) {
			await compileDirectory(path);
		} else if (
			entry.isFile && entry.name.endsWith('.ts') &&
			!/\.(test|spec)\.ts$/.test(entry.name)
		) {
			await compileFile(path);
		}
	}
}

async function copyStaticFiles(): Promise<void> {
	for (const name of ['LICENSE', 'env.example.txt']) {
		await Deno.copyFile(join(root, name), join(outDir, name));
	}
}

async function writeReleaseReadme(): Promise<void> {
	const readme = await Deno.readTextFile(join(root, 'README.md'));
	await Deno.writeTextFile(
		join(outDir, 'README.md'),
		readme.replace(
			/## Building And Publishing[\s\S]*?(?=## License)/,
			releaseInstructions,
		),
	);
}

async function writeReleaseConfig(): Promise<void> {
	const {
		tasks: _tasks,
		lint: _lint,
		fmt: _fmt,
		publish: _publish,
		...metadata
	} = config;
	const exports = config.exports as Record<string, string>;
	const entryPoints = [...new Set(Object.values(exports))].map(toJsPath);

	const releaseConfig = {
		...metadata,
		tasks: {
			check: 'deno check --no-lock ' + entryPoints.join(' '),
			'dry-run': 'deno publish --dry-run --allow-dirty',
			publish: 'deno publish',
		},
		exports: Object.fromEntries(
			Object.entries(exports).map(([name, path]) => [
				name,
				toJsPath(path),
			]),
		),
		publish: {
			exclude: ['!**'],
			include: [
				'**/*.js',
				'**/*.d.ts',
				'deno.json',
				'README.md',
				'LICENSE',
				'env.example.txt',
			],
		},
	};

	await Deno.writeTextFile(
		join(outDir, 'deno.json'),
		JSON.stringify(releaseConfig, null, '\t') + '\n',
	);
}

await prepareOutputDirectory();

try {
	await compileFile(join(root, 'mod.ts'));
	await compileDirectory(join(root, 'src'));
	await copyStaticFiles();
	await writeReleaseReadme();
	await writeReleaseConfig();
	console.log(
		'Built ' + compiledFiles +
			' modules into dist (JavaScript + declarations, no source maps).',
	);
} catch (error) {
	// Never leave a partial package that could accidentally be released.
	await Deno.remove(outDir, { recursive: true });
	throw error;
}