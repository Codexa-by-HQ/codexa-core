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

export const CODEXA_CORE_VERSION = '0.0.5';

export type CodexaCoreModule =
	| 'http'
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

export const CODEXA_CORE_MODULES: readonly CodexaCoreModule[] = Object.freeze([
	'http',
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
