import type { OpenApiDocument, OpenApiSource } from "../openapi/mod.d.ts";
export type SdkPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export interface SdkPackageJsonOptions {
    readonly name: string;
    readonly version: string;
}
export declare function isOpenApiDocument(value: unknown): value is OpenApiDocument;
export declare function resolveExport(loaded: Record<string, unknown>, exportName?: string): OpenApiSource | OpenApiDocument;
export declare function createPackageJson(options: SdkPackageJsonOptions): Record<string, unknown>;
export declare function createTsConfig(): Record<string, unknown>;
export declare function writeJson(path: string, value: Record<string, unknown>): Promise<void>;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function assertValidPackageIdentity(options: SdkPackageJsonOptions): void;
export declare function toIdentifier(value: string): string;
export declare function toPascalIdentifier(value: string): string;
export declare function detectPackageManager(projectRoot: string): Promise<SdkPackageManager>;
export declare function packageManagerInstallArgs(packageManager: SdkPackageManager, packageFile: string): string[];
export declare function toPackageManagerPath(projectRoot: string, packageFile: string): string;
export declare function packSdkPackage(outDir: string): Promise<string>;
export declare function resolveSdkPackageFile(sdkDirOrFile: string, version?: string): Promise<string>;
export declare function runCommand(command: string, args: readonly string[], cwd: string): Promise<string>;
export declare function exists(path: string): Promise<boolean>;
