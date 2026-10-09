/**
 * Build a typed {@link StorageConfig} from a strongly-typed env object.
 *
 * The parameter is a **closed discriminated union** ({@link StorageEnv}),
 * - You must declare which provider you want via `STORAGE_PROVIDER`.
 * - TypeScript enforces all required fields for that provider at compile time.
 * - The return type is **narrowed** - `cfg.s3`, `cfg.cloudinary`, etc. are
 *   directly accessible without an extra type guard.
 *
 * ---
 *
 * ### Passing env vars explicitly (recommended)
 *
 * Build the object yourself so TypeScript can validate every field:
 *
 * ```ts
 * import { buildStorageConfig } from '@codexa/core/config';
 *
 * // S3
 * const cfg = buildStorageConfig({
 *   STORAGE_PROVIDER: 's3',
 *   S3_BUCKET:     Deno.env.get('S3_BUCKET')!,
 *   S3_REGION:     Deno.env.get('S3_REGION')!,
 *   S3_ACCESS_KEY: Deno.env.get('S3_ACCESS_KEY')!,
 *   S3_SECRET_KEY: Deno.env.get('S3_SECRET_KEY')!,
 * });
 * cfg.s3.bucket; // ✅ no type guard needed
 *
 * // Cloudinary
 * const cfg = buildStorageConfig({
 *   STORAGE_PROVIDER:      'cloudinary',
 *   CLOUDINARY_CLOUD_NAME: Deno.env.get('CLOUDINARY_CLOUD_NAME')!,
 *   CLOUDINARY_API_KEY:    Deno.env.get('CLOUDINARY_API_KEY')!,
 *   CLOUDINARY_API_SECRET: Deno.env.get('CLOUDINARY_API_SECRET')!,
 * });
 *
 * // ImageKit
 * const cfg = buildStorageConfig({
 *   STORAGE_PROVIDER:      'imagekit',
 *   IMAGEKIT_PUBLIC_KEY:   Deno.env.get('IMAGEKIT_PUBLIC_KEY')!,
 *   IMAGEKIT_PRIVATE_KEY:  Deno.env.get('IMAGEKIT_PRIVATE_KEY')!,
 *   IMAGEKIT_URL_ENDPOINT: Deno.env.get('IMAGEKIT_URL_ENDPOINT')!,
 * });
 *
 * // Local filesystem
 * const cfg = buildStorageConfig({
 *   STORAGE_PROVIDER:  'local',
 *   LOCAL_STORAGE_DIR: Deno.env.get('LOCAL_STORAGE_DIR'), // optional, default './uploads'
 *   LOCAL_BASE_URL:    Deno.env.get('LOCAL_BASE_URL'),    // optional
 * });
 * ```
 *
 * ### Casting from `Deno.env.toObject()`
 *
 * `Deno.env.toObject()` returns `Record<string, string>` which TypeScript
 * cannot validate against `StorageEnv`. Cast to the branch you know is active:
 *
 * ```ts
 * import { buildStorageConfig, type S3Env } from '@codexa/core/config';
 *
 * const cfg = buildStorageConfig(Deno.env.toObject() as S3Env);
 * ```
 *
 * > **Note** - casting bypasses compile-time safety. Prefer the explicit
 * > approach above; use casting only when you control the env at runtime.
 *
 * @param env - Provider env object. `STORAGE_PROVIDER` selects the active
 *              backend and determines which other keys are required.
 * @returns A {@link StorageConfig} with the chosen provider's sub-object
 *          guaranteed to be populated.
 */
import type { StorageConfig } from "../types/app.d.ts";
/** Required env vars when `STORAGE_PROVIDER` is `'s3'`. */
export type S3Env = {
    STORAGE_PROVIDER: 's3';
    S3_BUCKET: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    /** Custom endpoint for S3-compatible services (e.g. MinIO, Cloudflare R2). Omit for standard AWS. */
    S3_ENDPOINT?: string;
    /** CDN base URL prepended to object keys when building public URLs. */
    S3_CDN_BASE_URL?: string;
};
/** Required env vars when `STORAGE_PROVIDER` is `'cloudinary'`. */
export type CloudinaryEnv = {
    STORAGE_PROVIDER: 'cloudinary';
    CLOUDINARY_CLOUD_NAME: string;
    CLOUDINARY_API_KEY: string;
    CLOUDINARY_API_SECRET: string;
};
/** Required env vars when `STORAGE_PROVIDER` is `'imagekit'`. */
export type ImageKitEnv = {
    STORAGE_PROVIDER: 'imagekit';
    IMAGEKIT_PUBLIC_KEY: string;
    IMAGEKIT_PRIVATE_KEY: string;
    /** Your ImageKit URL endpoint, e.g. `https://ik.imagekit.io/myapp`. */
    IMAGEKIT_URL_ENDPOINT: string;
};
/** Required env vars when `STORAGE_PROVIDER` is `'local'`. */
export type LocalEnv = {
    STORAGE_PROVIDER: 'local';
    /** Absolute or relative path to the upload directory. Default: `'./uploads'`. */
    LOCAL_STORAGE_DIR?: string;
    /** Base URL prepended to file keys when building public URLs. */
    LOCAL_BASE_URL?: string;
};
export type StorageEnv = S3Env | CloudinaryEnv | ImageKitEnv | LocalEnv;
export declare function buildStorageConfig(env: S3Env): StorageConfig & Required<Pick<StorageConfig, 's3'>>;
export declare function buildStorageConfig(env: CloudinaryEnv): StorageConfig & Required<Pick<StorageConfig, 'cloudinary'>>;
export declare function buildStorageConfig(env: ImageKitEnv): StorageConfig & Required<Pick<StorageConfig, 'imagekit'>>;
export declare function buildStorageConfig(env: LocalEnv): StorageConfig & Required<Pick<StorageConfig, 'local'>>;
export declare function buildStorageConfig(env: StorageEnv): StorageConfig;
