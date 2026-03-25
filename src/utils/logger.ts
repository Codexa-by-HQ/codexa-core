import type {
	LogEntry,
	LogFileConfig,
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
const COLORS = {
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
} as const;

const ENV_TYPE = Deno.env.get('ENV_TYPE') || 'development';
const IS_PRODUCTION = ENV_TYPE === 'production';
const GLOBAL_LOG_LEVEL: LogLevelT = (Deno.env.get('LOG_LEVEL') as LogLevelT) ||
	'debug';

const GLOBAL_FILE_CONFIG: LogFileConfig = {
	enabled: Deno.env.get('LOG_FILE_ENABLED') === 'true',
	dir: Deno.env.get('LOG_DIR') || './logs',
	maxSize: parseInt(Deno.env.get('LOG_MAX_FILE_SIZE') || '5242880'), // 5MB
	maxFiles: parseInt(Deno.env.get('LOG_MAX_FILES') || '5'),
};

export function createLogger(
	module: string,
	options?: { level?: LogLevelT; file?: Partial<LogFileConfig> },
): Logger {
	const minLevel = options?.level || GLOBAL_LOG_LEVEL;
	const fileConfig: LogFileConfig = {
		...GLOBAL_FILE_CONFIG,
		...options?.file,
	};

	const logger: Logger = {
		debug: createLogMethod('debug', module, minLevel, fileConfig),
		info: createLogMethod('info', module, minLevel, fileConfig),
		warn: createLogMethod('warn', module, minLevel, fileConfig),
		error: createLogMethod('error', module, minLevel, fileConfig),
		fatal: createLogMethod('fatal', module, minLevel, fileConfig),

		/**
		 * Create a child logger with a sub-module prefix.
		 * @example
		 * ```ts
		 * const log = createLogger('Auth');
		 * const childLog = log.child('TOTP');
		 * childLog.info('Verified'); // [Auth:TOTP] Verified
		 * ```
		 */
		child(subModule: string): Logger {
			return createLogger(`${module}:${subModule}`, {
				level: minLevel,
				file: fileConfig,
			});
		},
	};
	return logger;
}

// helpers
let fileWriterInitialized = false;
function writeToConsole(level: LogLevelT, formattedMessage: string) {
	switch (level) {
		case 'debug':
			console.log(formattedMessage);
			break;
		case 'info':
			console.info(formattedMessage);
			break;
		case 'warn':
			console.warn(formattedMessage);
			break;
		case 'error':
			console.error(formattedMessage);
			break;
		case 'fatal':
			console.error(formattedMessage);
			break;
		default:
			break;
	}
}
function ensureLogDir(dir: string): void {
	try {
		Deno.mkdirSync(dir, { recursive: true });
	} catch {
		// Directory already exists or cannot be created
	}
}
function getLogFilePath(dir: string, index?: number): string {
	if (index === undefined || index === 0) {
		return `${dir}/app.log`;
	}
	return `${dir}/app.${index}.log`;
}
function getFileSize(path: string): number {
	try {
		const stat = Deno.statSync(path);
		return stat.size;
	} catch {
		return 0;
	}
}
function rotateLogFiles(config: LogFileConfig): void {
	const { dir, maxFiles } = config;

	// Delete the oldest log file if it exists
	const oldestPath = getLogFilePath(dir, maxFiles);
	try {
		Deno.removeSync(oldestPath);
	} catch {
		// File doesn't exist, that's fine
	}

	// Shift all existing rotated files up by one
	for (let i = maxFiles - 1; i >= 1; i--) {
		const currentPath = getLogFilePath(dir, i);
		const nextPath = getLogFilePath(dir, i + 1);
		try {
			Deno.renameSync(currentPath, nextPath);
		} catch {
			// File doesn't exist, skip
		}
	}

	// Rename current log to .1
	const currentLogPath = getLogFilePath(dir);
	const rotatedPath = getLogFilePath(dir, 1);
	try {
		Deno.renameSync(currentLogPath, rotatedPath);
	} catch {
		// Current log doesn't exist, skip
	}
}
function writeToFile(content: string, fileConfig: LogFileConfig) {
	if (!fileConfig.enabled) return;

	if (!fileWriterInitialized) {
		ensureLogDir(fileConfig.dir);
		fileWriterInitialized = true;
	}
	const logPath = getLogFilePath(fileConfig.dir);

	// Check if rotation is needed
	const currentSize = getFileSize(logPath);
	if (currentSize >= fileConfig.maxSize) {
		rotateLogFiles(fileConfig);
	}

	// Append to log file
	try {
		Deno.writeTextFileSync(logPath, content + '\n', { append: true });
	} catch (err) {
		// Last resort: log to stderr if file writing fails
		console.error(`[Logger] Failed to write to log file: ${err}`);
	}
}

function createLogMethod(
	level: LogLevelT,
	module: string,
	minLevel: LogLevelT,
	fileConfig: LogFileConfig,
) {
	return (msg: string, ...args: unknown[]) => {
		if (!shouldLog(level, minLevel)) return;

		// Console output
		if (IS_PRODUCTION) {
			const jsonOutput = formatJsonOutput(level, module, msg, args);
			writeToConsole(level, jsonOutput);

			// File output (always JSON in production)
			writeToFile(jsonOutput, fileConfig);
		} else {
			const devOutput = formatDevOutput(level, module, msg, args);
			writeToConsole(level, devOutput);

			// File output (JSON format for parseability even in dev)
			if (fileConfig.enabled) {
				const jsonOutput = formatJsonOutput(
					level,
					module,
					msg,
					args,
				);
				writeToFile(jsonOutput, fileConfig);
			}
		}
	};
}
function shouldLog(level: LogLevelT, minLevel: LogLevelT): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatJsonOutput(
	level: LogLevelT,
	module: string,
	msg: string,
	args: unknown[],
): string {
	const entry: LogEntry = {
		timestamp: formatISOTimestamp(),
		level,
		module,
		message: msg,
	};

	if (args.length > 0) {
		if (args.length === 1) {
			const arg = args[0];
			if (arg instanceof Error) {
				entry.data = {
					name: arg.name,
					message: arg.message,
					stack: arg.stack,
				};
			} else {
				entry.data = arg;
			}
		} else {
			entry.data = args;
		}
	}

	return JSON.stringify(entry, null, 2);
}
function formatTimestamp(): string {
	const now = new Date();
	const pad = (n: number, len = 2) => String(n).padStart(len, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
		pad(now.getDate())
	} ${pad(now.getHours())}:${pad(now.getMinutes())}:${
		pad(now.getSeconds())
	}.${pad(now.getMilliseconds(), 3)}`;
}
function formatISOTimestamp(): string {
	return new Date().toISOString();
}
function formatDevOutput(
	level: LogLevelT,
	module: string,
	msg: string,
	args: unknown[],
): string {
	const ts = formatTimestamp();
	const levelUpper = level.toUpperCase().padEnd(5);
	const color = COLORS[level as keyof typeof COLORS];
	const dataStr = formatDataArgs(args);

	let output = `${COLORS.timestamp}${ts}${COLORS.reset} `;
	output += `${color}${COLORS.bold}${levelUpper}${COLORS.reset} `;
	output += `${COLORS.module}[${module}]${COLORS.reset} `;
	output += msg;

	if (dataStr) {
		output += ` ${COLORS[level as keyof typeof COLORS]}${dataStr}${COLORS.reset}`;
	}

	return output;
}
function formatDataArgs(args: unknown[]): string | undefined {
	if (args.length === 0) return undefined;
	if (args.length === 1) {
		const arg = args[0];
		if (arg instanceof Error) {
			return JSON.stringify(
				{
					name: arg.name,
					message: arg.message,
					stack: arg.stack,
				},
				null,
				2,
			);
		}
		if (typeof arg === 'object' && arg !== null) {
			try {
				return JSON.stringify(arg, null, 2);
			} catch {
				return String(arg);
			}
		}
		return String(arg);
	}
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return args.map(String).join(' ');
	}
}
