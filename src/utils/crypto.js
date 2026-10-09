/* @ts-self-types="./crypto.d.ts" */
import { blake2b, bytesToHex } from "../providers/noble-hashes.js";
import { createLogger } from "./logger.js";
const log = createLogger('Crypto', { level: 'error' });
const encoder = new TextEncoder();
export function blake2bDigest(data, length = 32) {
    const hash = blake2b(encoder.encode(data), { dkLen: length });
    return bytesToHex(hash);
}
export function generateId() {
    return crypto.randomUUID();
}
export function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
}
export function randomBytesRaw(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}
export function generateOtp(length = 6) {
    const digits = '0123456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => digits[b % digits.length]).join('');
}
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
}
export function base32Decode(input) {
    const cleanInput = input.replace(/=+$/, '').toUpperCase();
    const result = [];
    let bits = 0;
    let value = 0;
    for (const char of cleanInput) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1)
            continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            result.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(result);
}
export function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
export function fromBase64Url(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
export function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
export async function hashPassword(password, iterations = 310_000) {
    const saltBytes = randomBytesRaw(16);
    const saltHex = bytesToHex(saltBytes);
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations,
    }, keyMaterial, 256);
    const hashHex = bytesToHex(new Uint8Array(derived));
    log.debug('Password hashed with PBKDF2');
    return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}
export async function verifyPassword(password, stored) {
    try {
        const [_, iterStr, saltHex, hashHex] = stored.split('$');
        const iterations = parseInt(iterStr, 10);
        const saltBytes = Uint8Array.from((saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
        const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
        const derived = await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: saltBytes,
            iterations,
        }, keyMaterial, 256);
        const candidateHex = bytesToHex(new Uint8Array(derived));
        return timingSafeEqual(candidateHex, hashHex);
    }
    catch (err) {
        log.error('Password verification failed', err);
        return false;
    }
}
