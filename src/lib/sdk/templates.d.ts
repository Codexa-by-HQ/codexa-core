import type { OpenApiDocument, OpenApiOperation } from "../openapi/mod.d.ts";
interface RouteModel {
    readonly namespace: string;
    readonly methodName: string;
    readonly method: string;
    readonly path: string;
    readonly permission: string;
    readonly operation: OpenApiOperation;
    readonly typePrefix: string;
    readonly fixedHeaders: readonly FixedHeader[];
}
interface FixedHeader {
    readonly name: string;
    readonly value: string;
}
export declare function collectRoutes(document: OpenApiDocument): RouteModel[];
export declare function renderReadme(packageName: string, clientName: string): string;
export declare function renderRuntimeSource(input: {
    readonly clientName: string;
    readonly defaultBaseUrl?: string;
    readonly routes: readonly RouteModel[];
}): string;
export declare function renderDeclarationSource(input: {
    readonly clientName: string;
    readonly routes: readonly RouteModel[];
}): string;
export declare function renderClientSource(input: {
    readonly clientName: string;
    readonly defaultBaseUrl?: string;
    readonly routes: readonly RouteModel[];
}): string;
export {};
