/* @ts-self-types="./mod.d.ts" */
import { isAbsolute, join, resolve, toFileUrl } from '@std/path';
import { generateOpenApiDocument, } from "../openapi/mod.js";
import { createPackageJson, createTsConfig, detectPackageManager, exists, isOpenApiDocument, packageManagerInstallArgs, packSdkPackage, resolveExport, resolveSdkPackageFile, runCommand, toPackageManagerPath, toPascalIdentifier, writeJson, } from "./helpers.js";
import { collectRoutes, renderClientSource, renderDeclarationSource, renderReadme, renderRuntimeSource, } from "./templates.js";
export async function generateSdk(source, options) {
    const outDir = resolve(options.outDir);
    if (await exists(outDir)) {
        if (options.overwrite !== true) {
            throw new Error(`SDK output already exists: ${outDir}. Choose a new -V version or pass --force to replace it.`);
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
        Deno.writeTextFile(join(outDir, 'src', 'index.ts'), renderClientSource({
            clientName,
            defaultBaseUrl: options.baseUrl,
            routes,
        })),
        Deno.writeTextFile(join(outDir, 'dist', 'index.js'), renderRuntimeSource({
            clientName,
            defaultBaseUrl: options.baseUrl,
            routes,
        })),
        Deno.writeTextFile(join(outDir, 'dist', 'index.d.ts'), renderDeclarationSource({ clientName, routes })),
        Deno.writeTextFile(join(outDir, 'README.md'), renderReadme(options.name, clientName)),
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
export async function installSdkPackage(options) {
    const projectRoot = resolve(options.projectRoot);
    const sdkDir = resolve(options.sdkDir);
    const packageFile = await resolveSdkPackageFile(sdkDir, options.version);
    const packageManager = options.packageManager ??
        await detectPackageManager(projectRoot);
    const args = packageManagerInstallArgs(packageManager, toPackageManagerPath(projectRoot, packageFile));
    await runCommand(packageManager, args, projectRoot);
    return { projectRoot, sdkDir, packageFile, packageManager };
}
function prepareSdkSource(source, options) {
    if (isOpenApiDocument(source)) {
        return { document: source, skippedRouteCount: 0 };
    }
    const inspected = source.inspect({ includeDisabled: false });
    const enabledRoutes = inspected.routes.filter((route) => route.enabled);
    const sdkRoutes = enabledRoutes.filter((route) => route.openapi !== undefined && route.openapi.exclude !== true);
    const sdkSource = {
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
export async function generateSdkFromEntrypoint(options) {
    const entrypoint = isAbsolute(options.entrypoint)
        ? options.entrypoint
        : resolve(Deno.cwd(), options.entrypoint);
    const loaded = await import(toFileUrl(entrypoint).href);
    const source = resolveExport(loaded, options.exportName);
    return await generateSdk(source, options);
}
