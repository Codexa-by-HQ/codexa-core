import type { CodexaPluginDefinition, Empty, ICodexaPlugin, IPluginScope, MiddlewareConfig, MiddlewareInputWithExpose, MiddlewareInputWithoutExpose, PluginConfig, PluginMiddlewareConfig, StateShape } from "../mod.d.ts";
import type { PluginHost, PluginScopeSnapshot } from "../_internals/types.d.ts";
/**
 * Define inline route middleware.
 *
 * Inline middleware writes exposed data into `ctx.locals` for the current
 * route pipeline only.
 */
export declare function defineMiddleware(config: MiddlewareInputWithoutExpose<StateShape, StateShape>): MiddlewareConfig<StateShape, never, Empty, StateShape>;
export declare function defineMiddleware<const TProvide extends StateShape>(config: MiddlewareInputWithExpose<TProvide, TProvide, StateShape, StateShape>): MiddlewareConfig<StateShape, TProvide, TProvide, StateShape>;
export declare function defineMiddleware<StateExt extends StateShape, TProvide extends StateShape, TExposed extends StateShape, LocalsExt extends StateShape>(config: MiddlewareInputWithExpose<TProvide, TExposed, StateExt, LocalsExt>): MiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>;
/**
 * Define plugin-scoped middleware.
 *
 * Plugin middleware is selected by `appliedOn` tag patterns and writes exposed
 * data into the current plugin's `ctx.state`.
 */
export declare function definePluginMiddleware(config: PluginMiddlewareConfig<Empty, never, Empty, Empty>): PluginMiddlewareConfig<Empty, never, Empty, Empty>;
export declare function definePluginMiddleware<const TProvide extends StateShape>(config: PluginMiddlewareConfig<Empty, TProvide, TProvide, Empty>): PluginMiddlewareConfig<Empty, TProvide, TProvide, Empty>;
export declare function definePluginMiddleware<const TProvide extends StateShape, StateExt extends StateShape, TExposed extends StateShape, LocalsExt extends StateShape>(config: PluginMiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>): PluginMiddlewareConfig<StateExt, TProvide, TExposed, LocalsExt>;
/**
 * Define an installable Codexa HTTP plugin with typed config, dependencies,
 * routes, middleware, hooks, and exposed services.
 */
export declare function definePlugin<const Name extends string, Config = PluginConfig<Name>, const Deps extends readonly string[] = readonly [
]>(plugin: CodexaPluginDefinition<Name, Config, Deps>): ICodexaPlugin<Name, Config, Deps[number]>;
/** Alias for {@link definePlugin}. */
export declare function plugin<const Name extends string, Config = PluginConfig<Name>, const Deps extends readonly string[] = readonly [
]>(definition: CodexaPluginDefinition<Name, Config, Deps>): ICodexaPlugin<Name, Config, Deps[number]>;
export declare function createPluginScope<StateExt extends StateShape = Empty, PluginName extends string = string, Deps extends string = never>(host: PluginHost, pluginName: PluginName, deps: readonly Deps[], versionHeader: string): IPluginScope<StateExt, PluginName, Deps> & {
    pluginSnapshot(): PluginScopeSnapshot<StateExt>;
};
