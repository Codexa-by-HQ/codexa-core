/**
 * @module @codexa/core/providers/noble-hashes
 *
 * Provider re-exports for `@noble/hashes`.
 *
 * `@noble/hashes` does not expose a usable root module at runtime, so this
 * provider exports its public submodules as namespaces and directly exposes
 * the BLAKE2 and utils helpers used by Codexa Core.
 */

export * from '@noble/hashes/blake2.js';
export * from '@noble/hashes/utils.js';

export * as mdInternals from '@noble/hashes/_md.js';
export * as argon2 from '@noble/hashes/argon2.js';
export * as blake1 from '@noble/hashes/blake1.js';
export * as blake2 from '@noble/hashes/blake2.js';
export * as blake3 from '@noble/hashes/blake3.js';
export * as eskdf from '@noble/hashes/eskdf.js';
export * as hkdf from '@noble/hashes/hkdf.js';
export * as hmac from '@noble/hashes/hmac.js';
export * as legacy from '@noble/hashes/legacy.js';
export * as pbkdf2 from '@noble/hashes/pbkdf2.js';
export * as scrypt from '@noble/hashes/scrypt.js';
export * as sha2 from '@noble/hashes/sha2.js';
export * as sha3 from '@noble/hashes/sha3.js';
export * as sha3Addons from '@noble/hashes/sha3-addons.js';
export * as utils from '@noble/hashes/utils.js';
export * as webcrypto from '@noble/hashes/webcrypto.js';
