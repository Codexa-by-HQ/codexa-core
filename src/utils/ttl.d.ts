/**
 * @module @codexa/core/ttl
 *
 * Parse human-readable TTL strings into seconds, milliseconds, or dates.
 *
 * @example
 * ```ts
 * import { parseTtlToSeconds, ttlToDate } from '@codexa/core/ttl';
 *
 * const seconds = parseTtlToSeconds('15m');
 * const expiresAt = ttlToDate('1h');
 * ```
 */
/**
 * Parse a duration string like "15m", "1d", "2h", "30s" to seconds.
 *
 * Supported suffixes:
 *   s = seconds, m = minutes, h = hours, d = days, w = weeks
 *
 * @example
 * ```ts
 * parseTtlToSeconds('15m') // 900
 * parseTtlToSeconds('1d')  // 86400
 * parseTtlToSeconds('2h')  // 7200
 * parseTtlToSeconds('30s') // 30
 * ```
 */
export declare function parseTtlToSeconds(ttl: string): number;
/** Parse a duration string like `"15m"` or `"2h"` to milliseconds. */
export declare function parseTtlToMs(ttl: string): number;
/**
 * Calculate a future Date from now + ttl string. Parse a duration string to Date object.
 * @example
 * ```ts
 * const expiresAt = ttlToDate('30m'); // 30 minutes from now
 * ```
 */
export declare function ttlToDate(ttl: string): Date;
