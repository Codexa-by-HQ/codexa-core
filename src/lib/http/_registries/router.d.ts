import type { Empty, HttpMethod, ICodexaHttpRouter, MiddlewareLocals, RouteDefinition, RouteHandler, RouteOptions, StateShape } from "../mod.d.ts";
import type { RouteOrigin, RouterSnapshot } from "../_internals/types.d.ts";
export declare class CodexaRouter<StateExt extends StateShape = Empty> implements ICodexaHttpRouter<StateExt> {
    #private;
    constructor(name?: string, origin?: RouteOrigin, pluginName?: string);
    getName(): string;
    route<const Route extends string, const Middlewares extends readonly unknown[] = readonly [
    ]>(definition: RouteDefinition<Route, StateExt, Middlewares>): this;
    snapshot(): RouterSnapshot<StateExt>;
    protected assertNotCommitted(action: string): void;
    protected markCommitted(): void;
    protected get name(): string;
    protected get scopeId(): number;
    protected addSnapshot<SnapshotState extends StateShape>(snapshot: RouterSnapshot<SnapshotState>, prefix?: string, version?: string, pluginName?: string, versionHeader?: string): void;
    protected addRouteRegistration<Route extends string, Middlewares extends readonly unknown[]>(methodInput: HttpMethod, pathInput: Route, handler: RouteHandler<Route, StateExt, MiddlewareLocals<Middlewares>>, routeOptions?: RouteOptions<Middlewares>, version?: string, versionHeader?: string): void;
}
/**
 * Create a reusable route collection that can be mounted inside a plugin.
 */
export declare function createRouter<StateExt extends StateShape = Empty>(name?: string): ICodexaHttpRouter<StateExt>;
/** Alias for {@link createRouter}. */
export declare function router<StateExt extends StateShape = Empty>(name?: string): ICodexaHttpRouter<StateExt>;
