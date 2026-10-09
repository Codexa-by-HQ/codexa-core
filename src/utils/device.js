/* @ts-self-types="./device.d.ts" */
import { UAParser } from "../providers/ua-parser-js.js";
const parserInstance = new UAParser();
export function parseDevice(userAgent) {
    const ua = userAgent || '';
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
export function formatDeviceShort(info) {
    return `${info.browser}/${info.os}/${info.device}`;
}
