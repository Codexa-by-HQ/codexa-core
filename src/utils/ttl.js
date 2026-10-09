/* @ts-self-types="./ttl.d.ts" */
import { createLogger } from "./logger.js";
const log = createLogger('TTL', {
    level: 'error',
});
export function parseTtlToSeconds(ttl) {
    const match = ttl.match(/^(\d+)([smhdw])$/);
    if (!match) {
        throw new Error(`Invalid TTL format: ${ttl}. Use format like '15m', '1d', '2h', '30s'`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = {
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
export function parseTtlToMs(ttl) {
    return parseTtlToSeconds(ttl) * 1000;
}
export function ttlToDate(ttl) {
    return new Date(Date.now() + parseTtlToMs(ttl));
}
