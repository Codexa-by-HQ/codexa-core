// Hash - Web Crypto API hash utilities
// Enhancing @noble/hashes and blake2b in crypto.ts features in hash.ts

import type { HashAlgorithm, HmacAlgorithm } from '../types/app.d.ts';

//  Convert a string to a Uint8Array using UTF-8 encoding.
function toBytes(data: string | Uint8Array): Uint8Array {
	if (data instanceof Uint8Array) return data;
	return new TextEncoder().encode(data);
}

// Convert a Uint8Array to a lowercase hex string. All internal callers must wrap ArrayBuffer → new Uint8Array() before calling this.
function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// Convert a Uint8Array to a base64 string. All internal callers must wrap ArrayBuffer → new Uint8Array() before calling this.
function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

// Public API

// Create a hash digest and return it as a lowercase hex string.
export async function createHash(
	algorithm: HashAlgorithm,
	data: string | Uint8Array,
): Promise<string> {
	const buffer = await crypto.subtle.digest(
		algorithm,
		toBytes(data) as BufferSource,
	);
	return toHex(new Uint8Array(buffer));
}

// Create a hash digest and return it as a base64 string.
export async function createHashBase64(
	algorithm: HashAlgorithm,
	data: string | Uint8Array,
): Promise<string> {
	const buffer = await crypto.subtle.digest(
		algorithm,
		toBytes(data) as BufferSource,
	);
	return toBase64(new Uint8Array(buffer));
}

// Create a SHA-256 hash (hex). Convenience shorthand.
export async function sha256(data: string | Uint8Array): Promise<string> {
	return await createHash('SHA-256', data);
}

// Create a SHA-1 hash (hex). Convenience shorthand.
export async function sha1(data: string | Uint8Array): Promise<string> {
	return await createHash('SHA-1', data);
}

// Create a SHA-384 hash (hex). Convenience shorthand.
export async function sha384(data: string | Uint8Array): Promise<string> {
	return await createHash('SHA-384', data);
}

// Create a SHA-512 hash (hex). Convenience shorthand.
export async function sha512(data: string | Uint8Array): Promise<string> {
	return await createHash('SHA-512', data);
}

// HMAC

// Import a raw key for HMAC signing using the Web Crypto API. Internal helper shared by hmac* functions.
async function importHmacKey(
	secret: string | Uint8Array,
	algorithm: HmacAlgorithm,
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		toBytes(secret) as BufferSource,
		{ name: 'HMAC', hash: algorithm },
		false,
		['sign'],
	);
}

// Compute an HMAC digest and return the raw bytes as a Uint8Array. Useful when the result will be used as a key in a derived signing chain (e.g. AWS SigV4).
export async function hmacRaw(
	secret: string | Uint8Array,
	data: string | Uint8Array,
	algorithm: HmacAlgorithm = 'SHA-256',
): Promise<Uint8Array> {
	const key = await importHmacKey(secret, algorithm);
	const buffer: ArrayBuffer = await crypto.subtle.sign(
		'HMAC',
		key,
		toBytes(data) as BufferSource,
	);
	return new Uint8Array(buffer);
}

// Compute an HMAC digest and return it as a lowercase hex string.
export async function hmacHex(
	secret: string | Uint8Array,
	data: string | Uint8Array,
	algorithm: HmacAlgorithm = 'SHA-256',
): Promise<string> {
	const raw = await hmacRaw(secret, data, algorithm);
	return toHex(raw);
}

// Compute an HMAC-SHA256 hex digest. Convenience shorthand.
export async function hmacSha256(
	secret: string | Uint8Array,
	data: string | Uint8Array,
): Promise<string> {
	return hmacHex(secret, data, 'SHA-256');
}

// Compute an HMAC-SHA1 hex digest. Convenience shorthand. Used by ImageKit signed URL generation.
export async function hmacSha1(
	secret: string | Uint8Array,
	data: string | Uint8Array,
): Promise<string> {
	return hmacHex(secret, data, 'SHA-1');
}
