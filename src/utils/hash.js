/* @ts-self-types="./hash.d.ts" */
function toBytes(data) {
    if (data instanceof Uint8Array)
        return data;
    return new TextEncoder().encode(data);
}
function toHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
export function bytesToHex(bytes) {
    return toHex(bytes);
}
export async function createHash(algorithm, data) {
    const buffer = await crypto.subtle.digest(algorithm, toBytes(data));
    return toHex(new Uint8Array(buffer));
}
export async function createHashBase64(algorithm, data) {
    const buffer = await crypto.subtle.digest(algorithm, toBytes(data));
    return toBase64(new Uint8Array(buffer));
}
export async function sha256(data) {
    return await createHash('SHA-256', data);
}
export async function sha1(data) {
    return await createHash('SHA-1', data);
}
export async function sha384(data) {
    return await createHash('SHA-384', data);
}
export async function sha512(data) {
    return await createHash('SHA-512', data);
}
async function importHmacKey(secret, algorithm) {
    return crypto.subtle.importKey('raw', toBytes(secret), { name: 'HMAC', hash: algorithm }, false, ['sign']);
}
export async function hmacRaw(secret, data, algorithm = 'SHA-256') {
    const key = await importHmacKey(secret, algorithm);
    const buffer = await crypto.subtle.sign('HMAC', key, toBytes(data));
    return new Uint8Array(buffer);
}
export async function hmacHex(secret, data, algorithm = 'SHA-256') {
    const raw = await hmacRaw(secret, data, algorithm);
    return toHex(raw);
}
export async function hmacSha256(secret, data) {
    return hmacHex(secret, data, 'SHA-256');
}
export async function hmacSha1(secret, data) {
    return hmacHex(secret, data, 'SHA-1');
}
