/**
 * @module @codexa/core/crypto
 *
 * Cryptographic helpers for IDs, random bytes, encodings, timing-safe
 * comparison, and PBKDF2 password hashing.
 *
 * @example
 * ```ts
 * import { generateId, hashPassword, verifyPassword } from '@codexa/core/crypto';
 *
 * const id = generateId();
 * const stored = await hashPassword('secret');
 * const ok = await verifyPassword('secret', stored);
 * ```
 */
/**
 * Generate a blake2b digest for integrity checks.
 * @example
 * ```ts
 * const digest = blake2bDigest(`${walletId}:${currency}:${balance}`);
 * ```
 */
export declare function blake2bDigest(data: string, length?: number): string;
/** Generate a cryptographically secure UUID v4. */
export declare function generateId(): string;
/** Generate secure random bytes as a hex string. output=> "a3f91c7b"
 * Each byte = 2 hex characters
 */
export declare function randomBytes(length: number): string;
/** Generate secure random bytes as a raw Uint8Array. output=> Uint8Array [163, 249, 28, 123]
 */
export declare function randomBytesRaw(length: number): Uint8Array;
/** Generate a random numeric OTP code. */
export declare function generateOtp(length?: number): string;
/** Encode a Uint8Array to a Base32 string (RFC 4648, no padding). */
export declare function base32Encode(buffer: Uint8Array): string;
/** Decode a Base32 string to a Uint8Array. */
export declare function base32Decode(input: string): Uint8Array;
/** Encode a Uint8Array to a base64url string (no padding). */
export declare function toBase64Url(bytes: Uint8Array): string;
/** Decode a base64url string to a Uint8Array. */
export declare function fromBase64Url(str: string): Uint8Array;
/** Constant-time string comparison - prevents timing attacks. */
export declare function timingSafeEqual(a: string, b: string): boolean;
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
export declare function hashPassword(password: string, iterations?: number): Promise<string>;
/**
 * Verify a password against a hash produced by {@link hashPassword}.
 */
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
