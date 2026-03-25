import { UAParser } from 'ua-parser-js';
import type { DeviceInfo } from '../types/app.d.ts';

const parserInstance = new UAParser();

/**
 * Parse a User-Agent string into structured device information.
 *
 * @example
 * ```ts
 * const info = parseDevice(ctx.request.headers.get('user-agent'));
 * // { browser: "Chrome 122.0.0", os: "Windows 11", device: "desktop", ... }
 * ```
 */
export function parseDevice(userAgent: string | null): DeviceInfo {
	const ua = userAgent || '';

	// Use a fresh parse for thread safety
	const result = parserInstance.setUA(ua).getResult();

	const browser = result.browser.name
		? `${result.browser.name} ${result.browser.version || ''}`.trim()
		: 'unknown';

	const os = result.os.name
		? `${result.os.name} ${result.os.version || ''}`.trim()
		: 'unknown';

	const engine = result.engine.name
		? `${result.engine.name} ${result.engine.version || ''}`.trim()
		: 'unknown';

	// Determine device category - ua-parser-js uses "mobile", "tablet", etc.
	// If no device type detected, it's likely a desktop browser
	const deviceType = result.device.type || 'desktop';

	return {
		browser,
		os,
		device: deviceType,
		deviceVendor: result.device.vendor || 'unknown',
		deviceModel: result.device.model || 'unknown',
		engine,
		raw: ua,
	};
}

/**
 * Format device info into a compact string for log lines.
 * @example "Chrome 122/Windows 11/desktop"
 */
export function formatDeviceShort(info: DeviceInfo): string {
	return `${info.browser}/${info.os}/${info.device}`;
}

// Device info utility - parses User-Agent strings into structured device metadata.
// Uses ua-parser-js for accurate browser, OS, device, and engine detection.
// Reusable across request logging, device management, session tracking, etc.
