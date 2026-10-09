/* @ts-self-types="./helpers.d.ts" */
import { hmacRaw } from "../../utils/hash.js";
export async function readStream(stream) {
    const chunks = [];
    const reader = stream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value)
            chunks.push(value);
    }
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
    }
    return data;
}
export async function toBytes(file) {
    if (file instanceof Uint8Array) {
        return new Uint8Array(file);
    }
    return await readStream(file);
}
export function awsUriEncode(str, encodeSlash = true) {
    return str
        .split('')
        .map((c) => {
        if (/[A-Za-z0-9\-_.~]/.test(c))
            return c;
        if (c === '/' && !encodeSlash)
            return '/';
        return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    })
        .join('');
}
export function formatAmzDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}
export function formatDateStamp(d) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
}
export async function deriveSigningKey(secretKey, dateStamp, region, service) {
    const kDate = await hmacRaw(`AWS4${secretKey}`, dateStamp);
    const kRegion = await hmacRaw(kDate, region);
    const kService = await hmacRaw(kRegion, service);
    return hmacRaw(kService, 'aws4_request');
}
