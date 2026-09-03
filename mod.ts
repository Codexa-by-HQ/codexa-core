/**
 * @module @codexa/core
 *
 * Codexa Core is published as a set of focused subpath modules.
 *
 * Prefer subpath imports so Deno loads only the capability you ask for:
 *
 * ```ts
 * import { createApp } from '@codexa/core/http';
 * import { createEventBus } from '@codexa/core/bus';
 * import { createStore } from '@codexa/core/store';
 * import { createCache } from '@codexa/core/cache';
 * import { createStorageManager } from '@codexa/core/storage';
 * import { env } from '@codexa/core/config';
 * import { createLogger } from '@codexa/core/logger';
 * import { zod } from '@codexa/core/providers/zod';
 * ```
 */

/** Current package version published by this source tree. */
export const CODEXA_CORE_VERSION = '1.0.6';

/** Public subpath module names exported by `@codexa/core`. */
export type CodexaCoreModule =
	| 'http'
	| 'openapi'
	| 'config'
	| 'bus'
	| 'store'
	| 'cache'
	| 'storage'
	| 'providers'
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
	'providers',
	'logger',
	'zod',
	'crypto',
	'hash',
	'device',
	'ttl',
	'response',
	'query',
]);
