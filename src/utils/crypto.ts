import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createLogger } from './logger.ts';

const log = createLogger('Crypto', { level: 'error' });

// ── Blake2b ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Generate a blake2b digest for integrity checks.
 * @example
 * ```ts
 * const digest = blake2bDigest(`${walletId}:${currency}:${balance}`);
 * ```
 */
export function blake2bDigest(data: string, length = 32): string {
	const hash = blake2b(encoder.encode(data), { dkLen: length });
	return bytesToHex(hash);
}

// ── Random Utilities ─────────────────────────────────────────────────────────

/** Generate a cryptographically secure UUID v4. */
export function generateId(): string {
	return crypto.randomUUID();
}

/** Generate secure random bytes as a hex string. output=> "a3f91c7b"
 * Each byte = 2 hex characters
 */
export function randomBytes(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

/** Generate secure random bytes as a raw Uint8Array. output=> Uint8Array [163, 249, 28, 123]
 */
export function randomBytesRaw(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

/** Generate a random numeric OTP code. */
export function generateOtp(length = 6): string {
	const digits = '0123456789';
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => digits[b % digits.length]).join('');
}

// ── Base32 Encode/Decode (RFC 4648) ─────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode a Uint8Array to a Base32 string (RFC 4648, no padding). */
export function base32Encode(buffer: Uint8Array): string {
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

/** Decode a Base32 string to a Uint8Array. */
export function base32Decode(input: string): Uint8Array {
	const cleanInput = input.replace(/=+$/, '').toUpperCase();
	const result: number[] = [];
	let bits = 0;
	let value = 0;
	for (const char of cleanInput) {
		const idx = BASE32_ALPHABET.indexOf(char);
		if (idx === -1) continue;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			result.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(result);
}

// ── Base64URL Encode/Decode ──────────────────────────────────────────────────

/** Encode a Uint8Array to a base64url string (no padding). */
export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/** Decode a base64url string to a Uint8Array. */
export function fromBase64Url(str: string): Uint8Array {
	const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// ── Timing-safe comparison ───────────────────────────────────────────────────

/** Constant-time string comparison - prevents timing attacks. */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

// ── Password hashing helpers (Web Crypto - bcrypt-free) ──────────────────────

/**
 * Hash a password using PBKDF2-SHA256 (Web Crypto API, no native addons).
 *
 * Returns a self-describing string:
 *   `pbkdf2$<iterations>$<saltHex>$<hashHex>`
 *
 * @example
 * ```ts
 * const hash = await hashPassword('mySecret');
 * const ok   = await verifyPassword('mySecret', hash);
 * ```
 */
export async function hashPassword(
	password: string,
	iterations = 310_000,
): Promise<string> {
	const saltBytes = randomBytesRaw(16);
	const saltHex = bytesToHex(saltBytes);
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits'],
	);
	const derived = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: saltBytes as unknown as ArrayBuffer,
			iterations,
		},
		keyMaterial,
		256,
	);
	const hashHex = bytesToHex(new Uint8Array(derived));
	log.debug('Password hashed with PBKDF2');
	return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

/**
 * Verify a password against a hash produced by {@link hashPassword}.
 */
export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	try {
		const [_, iterStr, saltHex, hashHex] = stored.split('$');
		const iterations = parseInt(iterStr, 10);
		const saltBytes = Uint8Array.from(
			(saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
		);
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveBits'],
		);
		const derived = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				hash: 'SHA-256',
				salt: saltBytes as unknown as ArrayBuffer,
				iterations,
			},
			keyMaterial,
			256,
		);
		const candidateHex = bytesToHex(new Uint8Array(derived));
		return timingSafeEqual(candidateHex, hashHex);
	} catch (err) {
		log.error('Password verification failed', err);
		return false;
	}
}
