import { AppContext, PRIORITY_LABELS, SafeProvide } from './mod.ts';

/** Helpers */
export function priorityLabel(p: number): string {
	return PRIORITY_LABELS[p] ?? `CUSTOM(${p})`;
}

// Browser auto-probe paths -> logged at DEBUG to reduce noise.
export const BROWSER_PROBE_PATHS: Set<string> = new Set([
	'/favicon.ico',
	'/robots.txt',
	'/apple-touch-icon.png',
]);

export function fnName(fn: unknown): string {
	return (fn as { name?: string }).name || 'anonymous';
}

export function setFnName(fn: unknown, name: string): void {
	try {
		Object.defineProperty(fn, 'name', {
			value: name,
			configurable: true, //gives control of delete/redefine -> delete obj.id ❌ نہیں ہوگا if value is set to false
			// writable: false //gives control of property editable -> obj.id = 10 ❌ change نہیں ہوگا if value is set to false
			// enumerable: false //gives control of property visible in loops -> for(const key in obj) ❌ visible نہیں ہوگا if value is set to false
		});
	} catch {
		// fallback: ignore
	}
}

/**
 * Per-request symbol slot used by ctx.provide().
 * Stored directly on ctx.state so it travels with the request without
 * polluting the typed surface of OakAppState.
 */
export const PROVIDE_SLOT = Symbol('codexa.provide');

/**
 * Inject ctx.provide() onto the context and return a function that,
 * when called after handler execution, reads the slot and - if `provide`
 * is a function callback - applies it and merges the result into ctx.state.
 *
 * @param ctx   - The live request context.
 * @param provide - The UseOptions.provide value (static object or callback).
 * @returns A zero-arg flush function to call after the handler resolves.
 */
export function injectProvide<P extends SafeProvide>(
	ctx: AppContext,
	provide: P | ((data: unknown) => P) | undefined,
): () => void {
	// Always attach ctx.provide so the handler can always call it safely.
	// deno-lint-ignore no-explicit-any
	(ctx as any).provide = (data: unknown): void => {
		// deno-lint-ignore no-explicit-any
		(ctx.state as any)[PROVIDE_SLOT] = data;
	};

	// Return a flush function that runs AFTER the handler completes.
	// The callback is ALWAYS called (even if ctx.provide() was never invoked).
	// data = whatever the handler passed to ctx.provide(), or undefined if never called.
	// Whatever the callback returns is ALWAYS merged into ctx.state.
	// If provide is absent from UseOptions → no injection.
	return () => {
		if (typeof provide === 'function') {
			// deno-lint-ignore no-explicit-any
			const slot = (ctx.state as any)[PROVIDE_SLOT]; // undefined if ctx.provide() never called
			// if (slot !== undefined) {}
			const exposed = (provide as (data: unknown) => P)(slot); // always call callback
			if (
				exposed !== null && exposed !== undefined &&
				typeof exposed === 'object'
			) {
				Object.assign(ctx.state, exposed); // always merge return value
			}
		}
		// Static path: plain objects are merged pre-handler in wrapHandler.
		// No-op here for static - nothing to do post-handler.
		// Cleanup: always remove the slot symbol from state.
		// deno-lint-ignore no-explicit-any
		delete (ctx.state as any)[PROVIDE_SLOT];
	};
}
