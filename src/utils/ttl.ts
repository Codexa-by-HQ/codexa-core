import { createLogger } from './logger.ts';
const log = createLogger('TTL', {
	level: 'error',
});

// TTL Parser - Parse human-friendly duration strings to seconds/milliseconds
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
export function parseTtlToSeconds(ttl: string): number {
	const match = ttl.match(/^(\d+)([smhdw])$/);
	if (!match) {
		throw new Error(
			`Invalid TTL format: ${ttl}. Use format like '15m', '1d', '2h', '30s'`,
		);
	}
	const value = parseInt(match[1], 10);
	const unit = match[2];

	const multipliers: Record<string, number> = {
		s: 1,
		m: 60,
		h: 60 * 60,
		d: 60 * 60 * 24,
		w: 60 * 60 * 24 * 7,
	};
	const correctTTL = multipliers[unit];
	if (!correctTTL) {
		throw new Error(`Invalid TTL unit: ${unit}`);
	}
	return value * correctTTL;
}

//  Parse a duration string to milliseconds.
export function parseTtlToMs(ttl: string): number {
	return parseTtlToSeconds(ttl) * 1000;
}

/**
 * Calculate a future Date from now + ttl string. Parse a duration string to Date object.
 * @example
 * ```ts
 * const expiresAt = ttlToDate('30m'); // 30 minutes from now
 * ```
 */
export function ttlToDate(ttl: string): Date {
	return new Date(Date.now() + parseTtlToMs(ttl));
}
