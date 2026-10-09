import type { ICodexaHttp } from "../mod.d.ts";
/**
 * Create a Codexa HTTP app.
 *
 * The app owns plugin installation, lifecycle, request handling, tag controls, and
 * service access from installed plugins.
 */
export declare function createApp<InstalledPlugins extends string = never>(name?: string): ICodexaHttp<InstalledPlugins>;
/** Alias for {@link createApp}. */
export declare function http<InstalledPlugins extends string = never>(name?: string): ICodexaHttp<InstalledPlugins>;
