/**
 * @module @codexa/core/hash
 *
 * Web Crypto hash and HMAC helpers.
 *
 * @example
 * ```ts
 * import { sha256, hmacSha256 } from '@codexa/core/hash';
 *
 * const digest = await sha256('payload');
 * const signature = await hmacSha256('secret', 'payload');
 * ```
 */
import type { HashAlgorithm, HmacAlgorithm } from "../types/app.d.ts";
/**
 * Convert a `Uint8Array` to a lowercase hex string.
 *
 * @example
 * ```ts
 * const sig = await hmacRaw(key, payload);
 * const hex = bytesToHex(sig); // "a3f91c…"
 * ```
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/** Create a hash digest and return it as a lowercase hex string. */
export declare function createHash(algorithm: HashAlgorithm, data: string | Uint8Array): Promise<string>;
/** Create a hash digest and return it as a base64 string. */
export declare function createHashBase64(algorithm: HashAlgorithm, data: string | Uint8Array): Promise<string>;
/** Create a SHA-256 hash digest as lowercase hex. */
export declare function sha256(data: string | Uint8Array): Promise<string>;
/** Create a SHA-1 hash digest as lowercase hex. */
export declare function sha1(data: string | Uint8Array): Promise<string>;
/** Create a SHA-384 hash digest as lowercase hex. */
export declare function sha384(data: string | Uint8Array): Promise<string>;
/** Create a SHA-512 hash digest as lowercase hex. */
export declare function sha512(data: string | Uint8Array): Promise<string>;
/** Compute an HMAC digest and return the raw bytes. */
export declare function hmacRaw(secret: string | Uint8Array, data: string | Uint8Array, algorithm?: HmacAlgorithm): Promise<Uint8Array>;
/** Compute an HMAC digest and return it as lowercase hex. */
export declare function hmacHex(secret: string | Uint8Array, data: string | Uint8Array, algorithm?: HmacAlgorithm): Promise<string>;
/** Compute an HMAC-SHA256 digest as lowercase hex. */
export declare function hmacSha256(secret: string | Uint8Array, data: string | Uint8Array): Promise<string>;
/** Compute an HMAC-SHA1 digest as lowercase hex. */
export declare function hmacSha1(secret: string | Uint8Array, data: string | Uint8Array): Promise<string>;
