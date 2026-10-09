/**
 * @module Storage:Local
 *
 * Local filesystem storage provider for the Codexa unified storage layer.
 *
 * ## Overview
 * Writes files to a directory on the local filesystem.  This provider is
 * intended for **development and testing only** - it has no CDN, no
 * expiring URLs, and no cross-server file sharing.
 *
 * @example Configuration
 * ```ts
 * const storage = createStorageManager(buildStorageConfig({
 *   STORAGE_PROVIDER:  'local',
 *   LOCAL_STORAGE_DIR: './uploads',
 *   LOCAL_BASE_URL:    'http://localhost:3000/uploads',
 * }));
 * ```
 */
import type { SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, TransformationOptions, UploadOptions, UploadResult } from "../../../types/app.d.ts";
/**
 * Local filesystem {@link StorageProvider}.
 *
 * Reads its configuration from `StorageConfig.local`.  Falls back to
 * `./uploads` and no base URL when nothing is set.
 *
 * **For development / testing only.**  Use Cloudinary, ImageKit, or S3 for
 * production workloads.
 */
export declare class LocalStorageProvider implements StorageProvider {
    private readonly dir;
    private readonly baseUrl;
    constructor(config: NonNullable<StorageConfig['local']>);
    /**
     * Recursively create all directories in `dirPath` if they do not exist.
     * Swallows "already exists" errors silently.
     */
    private ensureDir;
    /**
     * Resolve the absolute filesystem path for a given storage key.
     *
     * @param key  Relative storage key (e.g. `"avatars/user_123.jpg"`).
     */
    private resolveFilePath;
    /**
     * Build the public URL for a storage key.
     *
     * Returns `<baseUrl>/<key>` when `baseUrl` is configured, otherwise just
     * the relative key - useful as a fallback for static file middleware.
     */
    private resolveUrl;
    /**
     * Write a single file to disk and return an {@link UploadResult}.
     * Called internally by the public `upload()` method.
     */
    private uploadOne;
    /**
     * Write one file **or** an array of files to the local filesystem.
     *
     * @example Single file
     * ```ts
     * const result = await provider.upload(bytes, {
     *   folder: 'avatars', contentType: 'image/jpeg', assetType: 'image',
     * });
     * ```
     *
     * @example Multiple files
     * ```ts
     * const [img, doc] = await provider.upload([imgBytes, pdfBytes], [
     *   { folder: 'images', contentType: 'image/png' },
     *   { folder: 'docs',   contentType: 'application/pdf', assetType: 'document' },
     * ]) as UploadResult[];
     * ```
     */
    upload(file: Uint8Array | ReadableStream<Uint8Array> | Array<Uint8Array | ReadableStream<Uint8Array>>, options?: UploadOptions | UploadOptions[]): Promise<UploadResult | UploadResult[]>;
    /**
     * Delete a file from the local filesystem by its storage key.
     *
     * `Deno.errors.NotFound` is handled gracefully - a warning is logged and the method resolves without throwing.  All other errors propagate.
     *
     * @param key  Relative storage key returned from `upload()`.
     */
    delete(key: string): Promise<void>;
    /**
     * Check whether a file exists on the local filesystem.
     *
     * Uses `Deno.stat` - returns `true` when the stat succeeds, `false` on any error (including `NotFound` and permission errors).
     *
     * @param key  Relative storage key to check.
     */
    exists(key: string): Promise<boolean>;
    /**
     * Return a plain URL for the file (no signing is applied).
     *
     * The local provider has no access-control layer, so "signed" URLs are
     * identical to the regular `url` in {@link UploadResult}.  The `expiresIn`
     * and `transformation` parameters are accepted for interface compatibility
     * but ignored.
     *
     * @param key  Relative storage key.
     */
    getSignedUrl(key: string, _expiresIn?: number, _transformation?: TransformationOptions): Promise<string>;
    /**
     * Return a plain URL for the file (no transformation is applied).
     *
     * The local filesystem provider cannot perform on-the-fly image
     * transformations.  The `transformation` parameter is accepted for
     * interface compatibility but ignored.
     *
     * @param key  Relative storage key.
     */
    getTransformedUrl(key: string, _transformation: TransformationOptions): string;
    /**
     * **Not supported by the local provider.**
     *
     * The local filesystem has no publicly accessible upload endpoint, so
     * client-side direct upload is not possible.  This method always throws.
     *
     * To use client-side direct upload switch to `cloudinary`, `imagekit`, or
     * `s3` as your `STORAGE_PROVIDER`.
     *
     * @throws {Error} Always - local provider does not support signed upload tokens.
     */
    getSignedUploadUrl(_options: SignedUploadOptions): Promise<SignedUploadResult>;
}
