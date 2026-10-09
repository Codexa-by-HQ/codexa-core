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
/** Install one validated plugin into the host workspace with rollback on failure. */
export declare function installPlugin(options: PluginInstallOptions): Promise<InstalledPlugin>;
/** Read the host registry without loading or executing any installed plugin code. */
export declare function listInstalledPlugins(projectRoot: string): Promise<readonly InstalledPlugin[]>;
