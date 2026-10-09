/**
 * @module @codexa/core/device
 *
 * User-Agent parsing utilities for request logging, session metadata, and
 * device-aware application features.
 *
 * @example
 * ```ts
 * import { parseDevice, formatDeviceShort } from '@codexa/core/device';
 *
 * const info = parseDevice(request.headers.get('user-agent'));
 * console.log(formatDeviceShort(info));
 * ```
 */
import type { DeviceInfo } from "../types/app.d.ts";
/**
 * Parse a User-Agent string into structured device information.
 *
 * @example
 * ```ts
 * const info = parseDevice(ctx.request.headers.get('user-agent'));
 * // { browser: "Chrome 122.0.0", os: "Windows 11", device: "desktop", ... }
 * ```
 */
export declare function parseDevice(userAgent: string | null): DeviceInfo;
/**
 * Format device info into a compact string for log lines.
 * @example "Chrome 122/Windows 11/desktop"
 */
export declare function formatDeviceShort(info: DeviceInfo): string;
