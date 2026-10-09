/**
 * @module @codexa/core/sdk
 *
 * Generate browser-ready TypeScript SDK packages from Codexa HTTP metadata.
 *
 * The generator is intentionally separate from the HTTP runtime. It reads the
 * public inspect/OpenAPI surface and writes a small fetch-based client package
 * that frontend apps can install.
 */
import { type OpenApiDocument, type OpenApiSource } from "../openapi/mod.d.ts";
import { type SdkPackageManager } from "./helpers.d.ts";
export type { SdkPackageManager } from "./helpers.d.ts";
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
export declare function generateSdk(source: OpenApiSource | OpenApiDocument, options: GenerateSdkOptions): Promise<GeneratedSdkResult>;
/** Install a generated SDK tarball into a frontend/package-manager project. */
export declare function installSdkPackage(options: InstallSdkPackageOptions): Promise<InstalledSdkPackageResult>;
/** Load a backend module and generate an SDK from its exported app/document. */
export declare function generateSdkFromEntrypoint(options: GenerateSdkFromEntrypointOptions): Promise<GeneratedSdkResult>;
