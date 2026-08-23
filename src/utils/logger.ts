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

import type {
	LogEntry,
	Logger,
	LogLevelT,
} from '../types/app.d.ts';

// logger levels
const LOG_LEVELS: Record<LogLevelT, number> = {
	debug: 0,
	info: 10,
	warn: 20,
	error: 30,
	fatal: 40,
};

// logger colors
const COLORS = Object.freeze({
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',

	// Level colors
	debug: '\x1b[36m', // Cyan
	info: '\x1b[32m', // Green
	warn: '\x1b[33m', // Yellow
	error: '\x1b[31m', // Red
	fatal: '\x1b[41m\x1b[37m', // White on red background

	// Structural colors
	timestamp: '\x1b[90m', // Gray
	module: '\x1b[35m', // Magenta
	data: '\x1b[90m', // Gray
});

/**
 * Runtime-neutral destination for structured logs.
 *
 * A writer can forward entries to a file, database, remote logging service,
 * Cloudflare Analytics Engine, or another runtime-specific destination.
 */
export type LogWriter = (
	entry: Readonly<LogEntry>,
) => void | Promise<void>;

/**
 * Create a runtime-neutral logger scoped to a module name.
 *
 * Logs are written to the console by default. An optional writer can forward
 * structured entries to files, databases, or external logging services.
 * Use `logger.child(name)` for nested module names.
 */
export function createLogger(
	module: string,
	options?: { level?: LogLevelT; production?: boolean; writer?: LogWriter; },
): Logger {

	const normalizedModule = normalizeModuleName(module);
	const minimumLevel = options?.level ?? "debug";
	const production = options?.production ?? false;
	const writer = options?.writer;

	assertLogLevel(minimumLevel);

	return Object.freeze({
		debug: createLogMethod(
			"debug",
			normalizedModule,
			minimumLevel,
			production,
			writer,
		),

		info: createLogMethod(
			"info",
			normalizedModule,
			minimumLevel,
			production,
			writer,
		),

		warn: createLogMethod(
			"warn",
			normalizedModule,
			minimumLevel,
			production,
			writer,
		),

		error: createLogMethod(
			"error",
			normalizedModule,
			minimumLevel,
			production,
			writer,
		),

		fatal: createLogMethod(
			"fatal",
			normalizedModule,
			minimumLevel,
			production,
			writer,
		),

		child(subModule: string): Logger {
			const normalizedSubModule = normalizeModuleName(subModule);

			return createLogger(
				`${normalizedModule}:${normalizedSubModule}`,
				{
					level: minimumLevel,
					production,
					writer,
				},
			);
		},
	});
}

// helpers
function createLogMethod(
	level: LogLevelT,
	module: string,
	minLevel: LogLevelT,
	production: boolean,
	writer?: LogWriter,
) {
	return (message: string, ...data: unknown[]): void => {
		if (!shouldLog(level, minLevel)) {
			return;
		}

		const entry = createLogEntry(level, module, message, data);

		if (production) {
			writeToConsole(level, JSON.stringify(entry));
		} else {
			writeToConsole(level, formatDevelopmentEntry(entry));
		}

		if (writer !== undefined) {
			safelyWriteEntry(writer, entry);
		}
	};
}


function createLogEntry(
  level: LogLevelT,
  module: string,
  message: string,
  data: readonly unknown[],
): Readonly<LogEntry> {
  const normalizedData = normalizeLogData(data);

  return Object.freeze({
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(normalizedData === undefined
      ? {}
      : { data: normalizedData }),
  });
}

function shouldLog(level: LogLevelT, minLevel: LogLevelT): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function writeToConsole(
  level: LogLevelT,
  output: string,
): void {
  switch (level) {
    case "debug":
      console.debug(output);
      return;

    case "info":
      console.info(output);
      return;

    case "warn":
      console.warn(output);
      return;

    case "error":
    case "fatal":
      console.error(output);
      return;
  }
}

function safelyWriteEntry(
  writer: LogWriter,
  entry: Readonly<LogEntry>,
): void {
  try {
    const result = writer(entry);

    if (isPromiseLike(result)) {
      void result.catch((error: unknown) => {
        console.error(
          "[Logger] Asynchronous log writer failed.",
          error,
        );
      });
    }
  } catch (error) {
    console.error(
      "[Logger] Log writer failed.",
      error,
    );
  }
}

function isPromiseLike(
  value: unknown,
): value is PromiseLike<void> & {
  catch(
    onRejected: (error: unknown) => void,
  ): PromiseLike<void>;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function" &&
    "catch" in value &&
    typeof value.catch === "function"
  );
}

function normalizeModuleName(module: string): string {
  const normalized = module.trim();

  if (normalized === "") {
    throw new Error("Logger module name cannot be empty.");
  }

  return normalized;
}

function assertLogLevel(
  level: string,
): asserts level is LogLevelT {
  if (!(level in LOG_LEVELS)) {
    throw new Error(`Invalid log level: ${level}`);
  }
}


function normalizeLogData(
  data: readonly unknown[],
): unknown {
  if (data.length === 0) {
    return undefined;
  }

  if (data.length === 1) {
    return serializeValue(data[0]);
  }

  return data.map(serializeValue);
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return Object.freeze({
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: serializeErrorCause(value.cause),
    });
  }

  return value;
}

function serializeErrorCause(
  cause: unknown,
): unknown {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    return Object.freeze({
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    });
  }

  return cause;
}


function formatDevelopmentEntry(
  entry: Readonly<LogEntry>,
): string {
  const level = entry.level.toUpperCase().padEnd(5);
  const levelColor = COLORS[entry.level];

  let output =
    `${COLORS.timestamp}${formatTimestamp(entry.timestamp)}${COLORS.reset} ` +
    `${levelColor}${COLORS.bold}${level}${COLORS.reset} ` +
    `${COLORS.module}[${entry.module}]${COLORS.reset} ` +
    entry.message;

  if (entry.data !== undefined) {
    output += ` ${levelColor}${formatData(entry.data)}${COLORS.reset}`;
  }

  return output;
}

function formatTimestamp(
  isoTimestamp: string,
): string {
  const date = new Date(isoTimestamp);

  const pad = (
    value: number,
    length = 2,
  ): string => String(value).padStart(length, "0");

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())} ` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}.` +
    pad(date.getMilliseconds(), 3)
  );
}

function formatData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

