/**
 * @module @codexa/core
 *
 * Codexa Core is published as a set of focused subpath modules.
 *
 * Prefer subpath imports so Deno loads only the capability you ask for:
 *
 * ```ts
 * import { createApp } from '@codexa/core/http';
 * import { eventBus } from '@codexa/core/bus';
 * import { initializeStore } from '@codexa/core/store';
 * import { createCache } from '@codexa/core/cache';
 * import { createStorageManager } from '@codexa/core/storage';
 * import { env } from '@codexa/core/config';
 * import { createLogger } from '@codexa/core/logger';
 * ```
 */

/** Current package version published by this source tree. */
export const CODEXA_CORE_VERSION = '0.0.7';

/** Public subpath module names exported by `@codexa/core`. */
export type CodexaCoreModule =
	| 'http'
	| 'openapi'
	| 'config'
	| 'bus'
	| 'store'
	| 'cache'
	| 'storage'
	| 'logger'
	| 'zod'
	| 'crypto'
	| 'hash'
	| 'device'
	| 'ttl'
	| 'response'
	| 'query';

/** Public subpath modules available from this package. */
export const CODEXA_CORE_MODULES: readonly CodexaCoreModule[] = Object.freeze([
	'http',
	'openapi',
	'config',
	'bus',
	'store',
	'cache',
	'storage',
	'logger',
	'zod',
	'crypto',
	'hash',
	'device',
	'ttl',
	'response',
	'query',
]);
