/**
 * @module @codexa/core/logger
 *
 * Runtime-neutral structured logger with console output and optional writers.
 *
 * @example
 * ```ts
 * import { createLogger } from '@codexa/core/logger';
 *
 * const log = createLogger('Api');
 * log.info('started', { port: 8000 });
 * log.error('request failed', { requestId: 'r1' });
 * ```
 */
import type { LogEntry, Logger, LogLevelT } from "../types/app.d.ts";
/**
 * Runtime-neutral destination for structured logs.
 *
 * A writer can forward entries to a file, database, remote logging service,
 * Cloudflare Analytics Engine, or another runtime-specific destination.
 */
export type LogWriter = (entry: Readonly<LogEntry>) => void | Promise<void>;
/**
 * Create a runtime-neutral logger scoped to a module name.
 *
 * Logs are written to the console by default. An optional writer can forward
 * structured entries to files, databases, or external logging services.
 * Use `logger.child(name)` for nested module names.
 */
export declare function createLogger(module: string, options?: {
    level?: LogLevelT;
    production?: boolean;
    writer?: LogWriter;
}): Logger;
