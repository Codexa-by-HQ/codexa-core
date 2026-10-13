/**
 * @module @codexa/core/sdk
 *
 * Generate browser-ready TypeScript SDK packages from Codexa HTTP metadata.
 *
 * The generator is intentionally separate from the HTTP runtime. It reads the
 * public inspect/OpenAPI surface and writes a small fetch-based client package
 * that frontend apps can install.
 */

import { isAbsolute, join, resolve, toFileUrl } from '@std/path';
import {
	generateOpenApiDocument,
	type OpenApiDocument,
	type OpenApiSource,
} from '../openapi/mod.ts';
import {
	createPackageJson,
	createTsConfig,
	detectPackageManager,
	exists,
	isOpenApiDocument,
	packageManagerInstallArgs,
	packSdkPackage,
	resolveExport,
	resolveSdkPackageFile,
	runCommand,
	type SdkPackageManager,
	toPackageManagerPath,
	toPascalIdentifier,
	writeJson,
} from './helpers.ts';
import {
	collectRoutes,
	renderClientSource,
	renderDeclarationSource,
	renderReadme,
	renderRuntimeSource,
} from './templates.ts';

export type { SdkPackageManager } from './helpers.ts';

export interface GenerateSdkOptions {
	/** Generated package name, for example "@acme/api-sdk". */
	readonly name: string;
	/** Directory where package.json, tsconfig.json, src, dist, and the package tarball are written. */
	readonly outDir: string;
	/** Required generated package version. */
	readonly version: string;
	/** Exported client class name. Defaults to "CodexaSDK". */
	readonly clientName?: string;
	/** Optional default base URL baked into the generated client. */
	readonly baseUrl?: string;
	/** Optional OpenAPI document metadata used when the source is an app. */
	readonly openapi?: {
		readonly title?: string;
		readonly version?: string;
		readonly pathPrefix?: string;
	};
	/** Replace an existing output directory. Defaults to false. */
	readonly overwrite?: boolean;
}

export interface GenerateSdkFromEntrypointOptions extends GenerateSdkOptions {
	/** Deno module that exports a Codexa app or an OpenAPI document. */
	readonly entrypoint: string;
	/** Named export to load. Defaults to the module default export. */
	readonly exportName?: string;
}

export interface GeneratedSdkResult {
	readonly outDir: string;
	readonly sourceFile: string;
	readonly packageFile: string;
	readonly routeCount: number;
	readonly skippedRouteCount: number;
}

export interface InstallSdkPackageOptions {
	readonly sdkDir: string;
	readonly projectRoot: string;
	readonly version?: string;
	readonly packageManager?: SdkPackageManager;
}

export interface InstalledSdkPackageResult {
	readonly projectRoot: string;
	readonly sdkDir: string;
	readonly packageFile: string;
	readonly packageManager: SdkPackageManager;
}

/** Generate an SDK from a Codexa app-like source or an OpenAPI document. */
export async function generateSdk(
	source: OpenApiSource | OpenApiDocument,
	options: GenerateSdkOptions,
): Promise<GeneratedSdkResult> {
	const outDir = resolve(options.outDir);
	if (await exists(outDir)) {
		if (options.overwrite !== true) {
			throw new Error(
				`SDK output already exists: ${outDir}. Choose a new -V version or pass --force to replace it.`,
			);
		}
		await Deno.remove(outDir, { recursive: true });
	}
	const prepared = prepareSdkSource(source, options);
	const document = prepared.document;
	const clientName = toPascalIdentifier(options.clientName ?? 'CodexaSDK');
	const routes = collectRoutes(document);

	await Deno.mkdir(join(outDir, 'src'), { recursive: true });
	await Deno.mkdir(join(outDir, 'dist'), { recursive: true });
	await Promise.all([
		writeJson(join(outDir, 'package.json'), createPackageJson(options)),
		writeJson(join(outDir, 'tsconfig.json'), createTsConfig()),
		Deno.writeTextFile(
			join(outDir, 'src', 'index.ts'),
			renderClientSource({
				clientName,
				defaultBaseUrl: options.baseUrl,
				routes,
			}),
		),
		Deno.writeTextFile(
			join(outDir, 'dist', 'index.js'),
			renderRuntimeSource({
				clientName,
				defaultBaseUrl: options.baseUrl,
				routes,
			}),
		),
		Deno.writeTextFile(
			join(outDir, 'dist', 'index.d.ts'),
			renderDeclarationSource({ clientName, routes }),
		),
		Deno.writeTextFile(
			join(outDir, 'README.md'),
			renderReadme(options.name, clientName),
		),
	]);
	const packageFile = await packSdkPackage(outDir);

	return {
		outDir,
		sourceFile: join(outDir, 'src', 'index.ts'),
		packageFile,
		routeCount: routes.length,
		skippedRouteCount: prepared.skippedRouteCount,
	};
}

/** Install a generated SDK tarball into a frontend/package-manager project. */
export async function installSdkPackage(
	options: InstallSdkPackageOptions,
): Promise<InstalledSdkPackageResult> {
	const projectRoot = resolve(options.projectRoot);
	const sdkDir = resolve(options.sdkDir);
	const packageFile = await resolveSdkPackageFile(sdkDir, options.version);
	const packageManager = options.packageManager ??
		await detectPackageManager(projectRoot);
	const args = packageManagerInstallArgs(
		packageManager,
		toPackageManagerPath(projectRoot, packageFile),
	);
	await runCommand(packageManager, args, projectRoot);
	return { projectRoot, sdkDir, packageFile, packageManager };
}

function prepareSdkSource(
	source: OpenApiSource | OpenApiDocument,
	options: GenerateSdkOptions,
): { readonly document: OpenApiDocument; readonly skippedRouteCount: number } {
	if (isOpenApiDocument(source)) {
		return { document: source, skippedRouteCount: 0 };
	}
	const inspected = source.inspect({ includeDisabled: false });
	const enabledRoutes = inspected.routes.filter((route) => route.enabled);
	const sdkRoutes = enabledRoutes.filter((route) =>
		route.openapi !== undefined && route.openapi.exclude !== true
	);
	const sdkSource: OpenApiSource = {
		inspect: () => ({
			...inspected,
			routes: sdkRoutes,
		}),
	};
	return {
		document: generateOpenApiDocument(sdkSource, {
			info: {
				title: options.openapi?.title ?? options.name,
				version: options.openapi?.version ?? options.version,
			},
			pathPrefix: options.openapi?.pathPrefix,
			includeDisabled: false,
			versionedPathStrategy: 'same-path',
		}),
		skippedRouteCount: enabledRoutes.length - sdkRoutes.length,
	};
}

/** Load a backend module and generate an SDK from its exported app/document. */
export async function generateSdkFromEntrypoint(
	options: GenerateSdkFromEntrypointOptions,
): Promise<GeneratedSdkResult> {
	const entrypoint = isAbsolute(options.entrypoint)
		? options.entrypoint
		: resolve(Deno.cwd(), options.entrypoint);
	const loaded = await import(toFileUrl(entrypoint).href) as Record<
		string,
		unknown
	>;
	const source = resolveExport(loaded, options.exportName);
	return await generateSdk(source, options);
}
