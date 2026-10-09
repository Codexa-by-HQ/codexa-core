/* @ts-self-types="./logger.d.ts" */
const LOG_LEVELS = {
    debug: 0,
    info: 10,
    warn: 20,
    error: 30,
    fatal: 40,
};
const COLORS = Object.freeze({
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[41m\x1b[37m',
    timestamp: '\x1b[90m',
    module: '\x1b[35m',
    data: '\x1b[90m',
});
export function createLogger(module, options) {
    const normalizedModule = normalizeModuleName(module);
    const minimumLevel = options?.level ?? "debug";
    const production = options?.production ?? false;
    const writer = options?.writer;
    assertLogLevel(minimumLevel);
    return Object.freeze({
        debug: createLogMethod("debug", normalizedModule, minimumLevel, production, writer),
        info: createLogMethod("info", normalizedModule, minimumLevel, production, writer),
        warn: createLogMethod("warn", normalizedModule, minimumLevel, production, writer),
        error: createLogMethod("error", normalizedModule, minimumLevel, production, writer),
        fatal: createLogMethod("fatal", normalizedModule, minimumLevel, production, writer),
        child(subModule) {
            const normalizedSubModule = normalizeModuleName(subModule);
            return createLogger(`${normalizedModule}:${normalizedSubModule}`, {
                level: minimumLevel,
                production,
                writer,
            });
        },
    });
}
function createLogMethod(level, module, minLevel, production, writer) {
    return (message, ...data) => {
        if (!shouldLog(level, minLevel)) {
            return;
        }
        const entry = createLogEntry(level, module, message, data);
        if (production) {
            writeToConsole(level, JSON.stringify(entry));
        }
        else {
            writeToConsole(level, formatDevelopmentEntry(entry));
        }
        if (writer !== undefined) {
            safelyWriteEntry(writer, entry);
        }
    };
}
function createLogEntry(level, module, message, data) {
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
function shouldLog(level, minLevel) {
    return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}
function writeToConsole(level, output) {
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
function safelyWriteEntry(writer, entry) {
    try {
        const result = writer(entry);
        if (isPromiseLike(result)) {
            void result.catch((error) => {
                console.error("[Logger] Asynchronous log writer failed.", error);
            });
        }
    }
    catch (error) {
        console.error("[Logger] Log writer failed.", error);
    }
}
function isPromiseLike(value) {
    return (typeof value === "object" &&
        value !== null &&
        "then" in value &&
        typeof value.then === "function" &&
        "catch" in value &&
        typeof value.catch === "function");
}
function normalizeModuleName(module) {
    const normalized = module.trim();
    if (normalized === "") {
        throw new Error("Logger module name cannot be empty.");
    }
    return normalized;
}
function assertLogLevel(level) {
    if (!(level in LOG_LEVELS)) {
        throw new Error(`Invalid log level: ${level}`);
    }
}
function normalizeLogData(data) {
    if (data.length === 0) {
        return undefined;
    }
    if (data.length === 1) {
        return serializeValue(data[0]);
    }
    return data.map(serializeValue);
}
function serializeValue(value) {
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
function serializeErrorCause(cause) {
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
function formatDevelopmentEntry(entry) {
    const level = entry.level.toUpperCase().padEnd(5);
    const levelColor = COLORS[entry.level];
    let output = `${COLORS.timestamp}${formatTimestamp(entry.timestamp)}${COLORS.reset} ` +
        `${levelColor}${COLORS.bold}${level}${COLORS.reset} ` +
        `${COLORS.module}[${entry.module}]${COLORS.reset} ` +
        entry.message;
    if (entry.data !== undefined) {
        output += ` ${levelColor}${formatData(entry.data)}${COLORS.reset}`;
    }
    return output;
}
function formatTimestamp(isoTimestamp) {
    const date = new Date(isoTimestamp);
    const pad = (value, length = 2) => String(value).padStart(length, "0");
    return (`${date.getFullYear()}-` +
        `${pad(date.getMonth() + 1)}-` +
        `${pad(date.getDate())} ` +
        `${pad(date.getHours())}:` +
        `${pad(date.getMinutes())}:` +
        `${pad(date.getSeconds())}.` +
        pad(date.getMilliseconds(), 3));
}
function formatData(data) {
    if (typeof data === "string") {
        return data;
    }
    try {
        return JSON.stringify(data, null, 2);
    }
    catch {
        return String(data);
    }
}
