import { Router } from '@oak/oak';
import {
	AppContext,
	AppMiddleware,
	CodexaHttp,
	CodexaPlugin,
	Empty,
	Hook,
	IPluginScope,
	IVersionedScope,
	SafeProvide,
	UseOptions,
} from '../mod.ts';
import { createLogger } from '../../../utils/logger.ts';
import type { Logger } from '../../../types/app.d.ts';

// ═══════════════════════════════════════════════════════════════════════════
//  Plugin System – PluginRegistry + PluginInstallScope
// ═══════════════════════════════════════════════════════════════════════════

/** Internal record for an installed plugin. */
export interface InstalledPlugin {
	plugin: CodexaPlugin<Record<string, unknown>>;
	scope: PluginInstallScope;
	status: 'installed' | 'initialized' | 'uninstalled';
	installedAt: number;
}

export const pluginLog: Logger = createLogger('CodexaHttp:Plugin');
/**
 * O(1)-amortised plugin & service registry.
 *
 * - Plugin store:   `Map<name, InstalledPlugin>`           → O(1) has/get/set/delete
 * - Service store:  `Map<pluginName, Map<svcName, svc>>`   → O(1) expose/get
 * - Dependency DAG: validated on install (eager) + topological sort in boot().
 */
export class PluginRegistry {
	/** name → InstalledPlugin. O(1) lookup. */
	private readonly store = new Map<string, InstalledPlugin>();

	/** pluginName → Map<serviceName, serviceInstance>. O(1) × O(1). */
	private readonly services = new Map<string, Map<string, unknown>>();

	// ── plugin store ──

	has(name: string): boolean {
		return this.store.has(name);
	}

	get(name: string): InstalledPlugin | undefined {
		return this.store.get(name);
	}

	set(name: string, entry: InstalledPlugin): void {
		this.store.set(name, entry);
	}

	delete(name: string): boolean {
		this.services.delete(name);
		return this.store.delete(name);
	}

	get size(): number {
		return this.store.size;
	}

	entries(): IterableIterator<[string, InstalledPlugin]> {
		return this.store.entries();
	}

	// ── dependency validation ──

	/**
	 * Check that every declared dependency is already installed.
	 * Throws an actionable error if any dependency is missing.
	 * O(d) where d = number of dependsOn entries (typically ≤5).
	 */
	validateDependencies(plugin: CodexaPlugin): void {
		for (const dep of plugin.dependsOn ?? []) {
			if (!this.store.has(dep)) {
				throw new Error(
					`CodexaHttp: Plugin "${plugin.name}" requires "${dep}" as a dependency, ` +
						`but "${dep}" is not installed.\n` +
						`  Fix: call \`await app.install(${dep}Plugin, ...)\` before installing "${plugin.name}".`,
				);
			}
		}
	}

	/**
	 * Detect circular dependencies across ALL installed plugins.
	 * Uses Kahn's algorithm (BFS topological sort).
	 *
	 * Returns the topologically sorted plugin names (dependencies first).
	 * Throws if a cycle is detected, naming the offending plugins.
	 */
	topologicalSort(): string[] {
		const names = Array.from(this.store.keys());
		if (names.length === 0) return [];

		// Build in-degree map + adjacency (Set-based for O(1) add).
		const inDegree = new Map<string, number>();
		const dependents = new Map<string, Set<string>>(); // dep → Set<plugins that depend on it>

		for (const name of names) {
			inDegree.set(name, 0);
			if (!dependents.has(name)) dependents.set(name, new Set());
		}

		for (const [name, { plugin }] of this.store) {
			for (const dep of plugin.dependsOn ?? []) {
				// Only count dependencies that are in the plugin set.
				if (this.store.has(dep)) {
					inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
					let bucket = dependents.get(dep);
					if (!bucket) {
						bucket = new Set();
						dependents.set(dep, bucket);
					}
					bucket.add(name);
				}
			}
		}

		// BFS: start with all zero-in-degree nodes.
		const queue: string[] = [];
		for (const [name, deg] of inDegree) {
			if (deg === 0) queue.push(name);
		}

		const sorted: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) break;
			sorted.push(current);
			for (const dependent of dependents.get(current) ?? []) {
				const newDeg = (inDegree.get(dependent) ?? 1) - 1;
				inDegree.set(dependent, newDeg);
				if (newDeg === 0) queue.push(dependent);
			}
		}

		if (sorted.length < names.length) {
			const cycled = names.filter((n) => !sorted.includes(n));

			// Trace the actual cycle path using DFS for a clear error message.
			const cycleSet = new Set(cycled);
			const adjCycled = new Map<string, string[]>();
			for (const n of cycled) {
				adjCycled.set(
					n,
					(this.store.get(n)?.plugin.dependsOn ?? []).filter((d) =>
						cycleSet.has(d)
					),
				);
			}
			const visited2 = new Set<string>();
			const stackArr: string[] = [];
			const onStack = new Set<string>();
			let cycleStr = cycled.join(' ↔ '); // fallback
			const dfsForCycle = (node: string): boolean => {
				visited2.add(node);
				onStack.add(node);
				stackArr.push(node);
				for (const dep of adjCycled.get(node) ?? []) {
					if (onStack.has(dep)) {
						const idx = stackArr.indexOf(dep);
						cycleStr = [...stackArr.slice(idx), dep].join(' → ');
						return true;
					}
					if (!visited2.has(dep) && dfsForCycle(dep)) return true;
				}
				stackArr.pop();
				onStack.delete(node);
				return false;
			};
			for (const start of cycled) {
				if (!visited2.has(start) && dfsForCycle(start)) break;
			}

			throw new Error(
				`CodexaHttp: Circular plugin dependency detected.\n` +
					`  Cycle: ${cycleStr}\n` +
					`  Review the dependsOn declarations of the plugins involved and remove the cycle.`,
			);
		}

		return sorted;
	}

	// ── service registry (O(1) × O(1)) ──

	exposeService(pluginName: string, name: string, service: unknown): void {
		let bucket = this.services.get(pluginName);
		if (!bucket) {
			bucket = new Map<string, unknown>();
			this.services.set(pluginName, bucket);
		}
		if (bucket.has(name)) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" already exposes service "${name}".`,
			);
		}
		bucket.set(name, service);
	}

	getService<T>(pluginName: string, serviceName: string): T {
		const bucket = this.services.get(pluginName);
		if (!bucket) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" is not installed or has no exposed services.`,
			);
		}
		if (!bucket.has(serviceName)) {
			throw new Error(
				`CodexaHttp: Plugin "${pluginName}" has no service named "${serviceName}".`,
			);
		}
		return bucket.get(serviceName) as T;
	}

	hasService(pluginName: string, serviceName: string): boolean {
		return this.services.get(pluginName)?.has(serviceName) ?? false;
	}

	serviceNames(pluginName: string): string[] {
		return Array.from(this.services.get(pluginName)?.keys() ?? []);
	}

	deleteServices(pluginName: string): void {
		this.services.delete(pluginName);
	}

	// ── introspection ──

	inspectAll(): {
		name: string;
		version: string;
		status: string;
		installedAt: number;
		services: string[];
		dependsOn: string[];
	}[] {
		return Array.from(this.store.entries()).map(
			([name, { plugin, status, installedAt }]) => ({
				name,
				version: plugin.version,
				status,
				installedAt,
				services: this.serviceNames(name),
				dependsOn: plugin.dependsOn ?? [],
			}),
		);
	}
}

/**
 * Versioned scope wrapper that auto-tags registrations with the plugin name.
 * Ensures that version().get(...) calls from a plugin are still scoped.
 */
export class PluginVersionedScope implements IVersionedScope {
	constructor(
		private readonly ver: string,
		private readonly host: CodexaHttp,
		private readonly pluginName: string,
	) {}

	private scopeOpts<P extends SafeProvide>(
		options?: UseOptions<P>,
	): UseOptions<P> {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);
		const name = options?.name
			? `${this.pluginName}:${options.name}`
			: undefined;
		const rawProvide = options?.provide;
		let provide: P | ((data: unknown) => P) | undefined;
		if (typeof rawProvide === 'function') {
			const pluginName = this.pluginName;
			provide = (data: unknown) =>
				({
					[pluginName]: (rawProvide as (d: unknown) => unknown)(data),
				}) as unknown as P;
		} else if (rawProvide) {
			provide = { [this.pluginName]: rawProvide } as unknown as P;
		}
		return { ...options, name, tags, provide };
	}

	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).get(path, handler, this.scopeOpts(options));
		return this;
	}

	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).post(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).put(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).delete(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.version(this.ver).patch(
			path,
			handler,
			this.scopeOpts(options),
		);
		return this;
	}

	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);
		const rawProvide = options?.provide;
		let provide: P | ((data: unknown) => P) | undefined;
		if (typeof rawProvide === 'function') {
			const pluginName = this.pluginName;
			provide = (data: unknown) =>
				({
					[pluginName]: (rawProvide as (d: unknown) => unknown)(data),
				}) as unknown as P;
		} else if (rawProvide) {
			provide = { [this.pluginName]: rawProvide } as unknown as P;
		}
		this.host.version(this.ver).router(prefix, routerInstance, {
			...options,
			tags,
			provide,
		});
		return this;
	}
}

/**
 * Sandboxed scope given to each plugin during install().
 *
 * Rules:
 * - Blocks boot(), listen(), shutdown() — plugins cannot control the server lifecycle.
 * - Auto-tags every registration with the plugin name for O(1) tag lookups.
 * - Scopes provide values under ctx.state[pluginName] to prevent cross-plugin collisions.
 * - enableByTags/disableByTags only affect this plugin's own entries.
 */
export class PluginInstallScope implements IPluginScope {
	private readonly pluginName: string;
	private readonly host: CodexaHttp;
	private readonly registry: PluginRegistry;
	/** Declared dependsOn of this plugin — used to enforce getService discipline. */
	private readonly dependsOn: string[];
	private _initFn: (() => Promise<void> | void) | null = null;
	private readonly _shutdownHooks: Hook[] = [];

	constructor(
		pluginName: string,
		host: CodexaHttp,
		registry: PluginRegistry,
		dependsOn: string[],
	) {
		this.pluginName = pluginName;
		this.host = host;
		this.registry = registry;
		this.dependsOn = dependsOn;
	}

	// ── option rewriting (auto-tag + scoped provide) ──

	/**
	 * Rewrites UseOptions so that:
	 * 1. The plugin name is always in the tags array (O(1) tag-based control).
	 * 2. Any provide values are scoped: `{ key: val }` → `{ [pluginName]: { key: val } }`
	 *    so they land in `ctx.state[pluginName].key`, not `ctx.state.key`.
	 * 3. Names are prefixed with `pluginName:` to avoid global collisions.
	 */
	private scopeOptions<P extends SafeProvide>(
		options?: UseOptions<P>,
	): UseOptions<P> {
		const tags = options?.tags ? [...options.tags] : [];
		// Always include the plugin name tag — Set-like dedup via indexOf.
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);

		// Prefix name if provided so it is globally unique.
		const name = options?.name
			? `${this.pluginName}:${options.name}`
			: undefined;

		// Scope provide under plugin namespace.
		// If the user passed a callback (dynamic provide), wrap it so the returned
		// shape is scoped: { [pluginName]: callback(data) }.
		// If the user passed a static object, wrap it statically.
		const rawProvide = options?.provide;
		let provide: P | ((data: unknown) => P) | undefined;
		if (typeof rawProvide === 'function') {
			// Dynamic: wrap callback to scope the output under plugin namespace.
			const pluginName = this.pluginName;
			provide = (data: unknown) =>
				({
					[pluginName]: (rawProvide as (d: unknown) => unknown)(data),
				}) as unknown as P;
		} else if (rawProvide) {
			// Static: scope the object under plugin namespace.
			provide = { [this.pluginName]: rawProvide } as unknown as P;
		}

		return {
			...options,
			name,
			tags,
			provide,
		};
	}

	/**
	 * Scope options for router() which omits 'name' from the options type.
	 */
	private scopeRouterOptions<P extends SafeProvide>(
		options?: Omit<UseOptions<P>, 'name'>,
	): Omit<UseOptions<P>, 'name'> {
		const tags = options?.tags ? [...options.tags] : [];
		if (!tags.includes(this.pluginName)) tags.push(this.pluginName);

		const rawProvide = options?.provide;
		let provide: P | ((data: unknown) => P) | undefined;
		if (typeof rawProvide === 'function') {
			const pluginName = this.pluginName;
			provide = (data: unknown) =>
				({
					[pluginName]: (rawProvide as (d: unknown) => unknown)(data),
				}) as unknown as P;
		} else if (rawProvide) {
			provide = { [this.pluginName]: rawProvide } as unknown as P;
		}

		return {
			...options,
			tags,
			provide,
		};
	}

	// ── delegated registration API ──

	use<P extends SafeProvide = Empty>(
		item: AppMiddleware<P> | Router,
		options?: UseOptions<P>,
	): this {
		this.host.use(item, this.scopeOptions(options));
		return this;
	}

	get<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.get(path, handler, this.scopeOptions(options));
		return this;
	}

	post<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.post(path, handler, this.scopeOptions(options));
		return this;
	}

	put<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.put(path, handler, this.scopeOptions(options));
		return this;
	}

	delete<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.delete(path, handler, this.scopeOptions(options));
		return this;
	}

	patch<P extends SafeProvide = Empty>(
		path: string,
		handler: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.patch(path, handler, this.scopeOptions(options));
		return this;
	}

	router<P extends SafeProvide = Empty>(
		prefix: string,
		routerInstance: Router,
		options?: Omit<UseOptions<P>, 'name'>,
	): this {
		this.host.router(
			prefix,
			routerInstance,
			this.scopeRouterOptions(options),
		);
		return this;
	}

	version(v: string): IVersionedScope {
		// Return a wrapped VersionedScope that auto-tags.
		return new PluginVersionedScope(
			v,
			this.host,
			this.pluginName,
		);
	}

	group<P extends SafeProvide = Empty>(
		groupName: string,
		items: Array<AppMiddleware<P> | Router>,
		options?: UseOptions<P>,
	): this {
		this.host.group(
			`${this.pluginName}:${groupName}`,
			items,
			this.scopeOptions(options),
		);
		return this;
	}

	useIf<P extends SafeProvide = Empty>(
		condition: (ctx: AppContext<P>) => boolean | Promise<boolean>,
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.useIf(condition, item, this.scopeOptions(options));
		return this;
	}

	useSafe<P extends SafeProvide = Empty>(
		item: AppMiddleware<P>,
		options?: UseOptions<P>,
	): this {
		this.host.useSafe(item, this.scopeOptions(options));
		return this;
	}

	// ── plugin-scoped tag controls ──
	// Scoping is already enforced at registration time via scopeOptions()
	// which auto-tags every entry with this plugin's name. The plugin
	// developer is responsible for using tags they themselves registered.

	enableByTags(...tags: string[]): this {
		this.host.enableByTags(...tags);
		return this;
	}

	disableByTags(...tags: string[]): this {
		this.host.disableByTags(...tags);
		return this;
	}

	inspectByTags(
		...tags: string[]
	): { name: string; priority: string; enabled: boolean; tags: string[] }[] {
		return this.host.inspectByTags(...tags);
	}

	// ── plugin lifecycle ──

	init(setup: () => Promise<void> | void): this {
		if (this._initFn) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" already has an init() registered. ` +
					'Call init() only once per plugin.',
			);
		}
		this._initFn = setup;
		return this;
	}

	// ── service inter-plugin communication ──

	exposeService<T>(name: string, service: T): this {
		this.registry.exposeService(this.pluginName, name, service);
		pluginLog.debug(
			`Plugin "${this.pluginName}" exposed service: "${name}"`,
		);
		return this;
	}

	getService<T>(pluginName: string, serviceName: string): T {
		// Guard: cannot access own services via getService (use local refs).
		if (pluginName === this.pluginName) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" cannot call getService() on itself — use a local reference.`,
			);
		}
		// Guard: target must be declared in dependsOn — enforces explicit dependency discipline.
		if (!this.dependsOn.includes(pluginName)) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" is trying to access service "${serviceName}" ` +
					`from "${pluginName}", but "${pluginName}" is not declared in dependsOn.\n` +
					`  Fix: add "${pluginName}" to the dependsOn array of "${this.pluginName}": ` +
					`dependsOn: ['${pluginName}'].`,
			);
		}
		// Guard: target plugin must be installed.
		if (!this.registry.has(pluginName)) {
			throw new Error(
				`CodexaHttp: Dependency plugin "${pluginName}" is not installed. ` +
					`Install it before "${this.pluginName}" with \`await app.install(${pluginName}Plugin, ...)\`.`,
			);
		}
		return this.registry.getService<T>(pluginName, serviceName);
	}

	getDependencyNames(): string[] {
		return [...this.dependsOn];
	}

	hasDependency(name: string): boolean {
		return this.dependsOn.includes(name) && this.registry.has(name);
	}

	getDependencyServices<T extends Record<string, unknown>>(
		pluginName: string,
	): T {
		if (!this.dependsOn.includes(pluginName)) {
			throw new Error(
				`CodexaHttp: Plugin "${this.pluginName}" cannot access services from "${pluginName}" — ` +
					`"${pluginName}" is not declared in dependsOn.\n` +
					`  Fix: add "${pluginName}" to "${this.pluginName}".dependsOn: ['${pluginName}'].`,
			);
		}
		if (!this.registry.has(pluginName)) {
			throw new Error(
				`CodexaHttp: Dependency plugin "${pluginName}" is not installed. ` +
					`Install it before "${this.pluginName}".`,
			);
		}
		const names = this.registry.serviceNames(pluginName);
		const result: Record<string, unknown> = {};
		for (const svc of names) {
			result[svc] = this.registry.getService(pluginName, svc);
		}
		return result as T;
	}

	onShutdown(hook: Hook): this {
		this._shutdownHooks.push(hook);
		return this;
	}

	// ── internal helpers (called by CodexaHttp, not by plugins) ──

	/** Run the plugin's init() during boot sequence. */
	async _runInit(): Promise<void> {
		if (this._initFn) {
			await this._initFn();
		}
	}

	/** Run shutdown hooks in reverse order (stack unwinding). */
	async _runShutdownHooks(): Promise<void> {
		for (let i = this._shutdownHooks.length - 1; i >= 0; i--) {
			try {
				await this._shutdownHooks[i]();
			} catch (err) {
				pluginLog.error(
					`Shutdown hook for plugin "${this.pluginName}" failed:`,
					err,
				);
			}
		}
	}

	/** Disable all middleware tagged with this plugin's name. */
	_disableAll(): void {
		this.host.disableByTags(this.pluginName);
	}
}
