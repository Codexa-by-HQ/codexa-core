import type { Context, Next, RouteParams, RouterContext } from '@oak/oak';
import type { DeviceInfo, RequestMetrics } from './app.d.ts';

/**
 * Plugins augment this interface to inject typed state into `ctx.state`.
 *
 * @example — in your plugin's declaration file:
 * ```ts
 * declare module '@codexa/core/http' {
 *   interface PluginStateMap {
 *     auth: { userId: string; role: string; permissions: string[] }
 *   }
 * }
 * // Now ctx.state.auth.userId is fully typed
 * ```
 */
// deno-lint-ignore no-empty-interface
export interface PluginStateMap {}

type PluginState = {
	[K in keyof PluginStateMap]?: PluginStateMap[K];
};

export interface OakAppState extends PluginState {
	requestId?: string;
	startTime?: number;
	device?: DeviceInfo;
	metrics?: RequestMetrics;
}

export type SafeProvide = Omit<
	Record<string, unknown>,
	keyof OakAppState | keyof PluginStateMap
>;
export type Empty = Record<string, never>;

/** Typed Oak context with optional state injection. */
export type AppContext<S extends SafeProvide = Empty> = Context<
	OakAppState & S
>;
export type AppNext = Next;
export type AppMiddleware<
	P extends SafeProvide = Empty,
> = (
	ctx: AppContext<P>,
	next: AppNext,
) => Promise<void> | void;

/** Use when you need both `ctx.state.*` and `ctx.params.*`. */
export type AppRouterContext<
	R extends string,
	S extends SafeProvide = Empty,
> = RouterContext<
	R,
	RouteParams<R>,
	OakAppState & S
>;
