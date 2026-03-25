/**
 * @module @codexa/core
 *
 * The Codexa Core library — a modular toolkit for building
 * scalable Deno applications.
 *
 * Prefer subpath imports for tree-shaking:
 * ```ts
 * import { createLogger }         from '@codexa/core/logger';
 * import { z }                    from '@codexa/core/zod';
 * import { CodexaHttp }           from '@codexa/core/http';
 * import { eventBus }             from '@codexa/core/bus';
 * import { initializeStore }      from '@codexa/core/store';
 * import { createCache }          from '@codexa/core/cache';
 * import { createStorageManager } from '@codexa/core/storage';
 * import { env, createMongoDatabase,
 *          createRedisConnection } from '@codexa/core/config';
 * ```
 *
 * Or import everything at once (not recommended for production bundles):
 * ```ts
 * import * as Codexa from '@codexa/core';
 * ```
 */

// ── Utils ─────────────────────────────────────────────────────────────────────
export * from './src/utils/zod.ts';
export * from './src/utils/logger.ts';
export * from './src/utils/crypto.ts';
export * from './src/utils/hash.ts';
export * from './src/utils/device.ts';
export * from './src/utils/ttl.ts';
export * from './src/utils/response.ts';
export * from './src/utils/parseQueryParams.ts';

// ── Schemas / Structures ──────────────────────────────────────────────────────
export * from './src/structures/index.ts';

// ── Config ────────────────────────────────────────────────────────────────────
export * from './src/config/mod.ts';
