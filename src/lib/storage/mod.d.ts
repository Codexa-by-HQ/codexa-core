/**
 * @module @codexa/core/storage
 *
 * Unified storage layer for Codexa applications.
 *
 * Pass a {@link StorageConfig} (built via {@link buildStorageConfig} from
 * `@codexa/core/config`) to {@link createStorageManager}. The correct adapter
 * is resolved automatically - no manual provider wiring needed. Every manager
 * is independent; use {@link createStorageRegistry} when named lookup is useful.
 *
 * ### Supported providers
 * | `STORAGE_PROVIDER` | Status |
 * |---|---|
 * | `local`      | ✅ Ready (dev/test only) |
 * | `cloudinary` | ✅ Ready |
 * | `imagekit`   | ✅ Ready |
 * | `s3`         | ✅ Ready (AWS S3 + S3-compatible) |
 *
 * ---
 *
 * ## Server-side upload
 * The server reads the file bytes and uploads them directly to the configured provider.
 * ```ts
 * const result = await storage.upload(fileBytes, {
 *   folder: 'avatars', contentType: 'image/jpeg', assetType: 'image',
 * });
 * ```
 *
 * ## Multi-file server-side upload
 * ```ts
 * const results = await storage.upload([bytes1, bytes2], [
 *   { folder: 'images', assetType: 'image' },
 *   { folder: 'videos', assetType: 'video' },
 * ]) as UploadResult[];
 * ```
 *
 * ## Client-side direct upload (recommended for large files / videos)
 * Your server generates signed credentials; the client uploads directly to
 * the provider without the file ever passing through your API.
 *
 * ```
 * Client                   Your Server               Provider
 *   |--- POST /upload-token ->|                          |
 *   |<-- SignedUploadResult --|  (signs credentials)     |
 *   |--- PUT / POST -------->|------------------------->|
 *   |<-- 200 / asset URL ----|--------------------------|
 * ```
 *
 * ```ts
 * // Server endpoint
 * const token = await storage.getSignedUploadUrl({
 *   folder: 'videos', contentType: 'video/mp4', assetType: 'video',
 *   expiresIn: 1800,
 * });
 * return Response.json(token);
 *
 * // Browser (S3 - raw PUT)
 * await fetch(token.uploadUrl, {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'video/mp4' },
 *   body: file,
 * });
 *
 * // Browser (Cloudinary / ImageKit - multipart POST)
 * const form = new FormData();
 * Object.entries(token.fields!).forEach(([k, v]) => form.append(k, v));
 * form.append('file', file);
 * await fetch(token.uploadUrl, { method: 'POST', body: form });
 * ```
 *
 * @example Cloudinary
 * ```ts
 * import { buildStorageConfig } from '@codexa/core/config';
 * import { createStorageManager } from '@codexa/core/storage';
 *
 * const storage = createStorageManager(
 *   buildStorageConfig({
 *     STORAGE_PROVIDER:      'cloudinary',
 *     CLOUDINARY_CLOUD_NAME: Deno.env.get('CLOUDINARY_CLOUD_NAME')!,
 *     CLOUDINARY_API_KEY:    Deno.env.get('CLOUDINARY_API_KEY')!,
 *     CLOUDINARY_API_SECRET: Deno.env.get('CLOUDINARY_API_SECRET')!,
 *   }),
 * );
 * ```
 *
 * @example ImageKit
 * ```ts
 * const storage = createStorageManager(
 *   buildStorageConfig({
 *     STORAGE_PROVIDER:      'imagekit',
 *     IMAGEKIT_PUBLIC_KEY:   Deno.env.get('IMAGEKIT_PUBLIC_KEY')!,
 *     IMAGEKIT_PRIVATE_KEY:  Deno.env.get('IMAGEKIT_PRIVATE_KEY')!,
 *     IMAGEKIT_URL_ENDPOINT: Deno.env.get('IMAGEKIT_URL_ENDPOINT')!,
 *   }),
 * );
 * ```
 *
 * @example Local filesystem
 * ```ts
 * const storage = createStorageManager(
 *   buildStorageConfig({
 *     STORAGE_PROVIDER:  'local',
 *     LOCAL_STORAGE_DIR: './uploads',
 *     LOCAL_BASE_URL:    'http://localhost:3000/uploads',
 *   }),
 * );
 * ```
 *
 * @example S3 / S3-compatible
 * ```ts
 * const storage = createStorageManager(
 *   buildStorageConfig({
 *     STORAGE_PROVIDER: 's3',
 *     S3_BUCKET:        Deno.env.get('S3_BUCKET')!,
 *     S3_REGION:        Deno.env.get('S3_REGION')!,
 *     S3_ACCESS_KEY:    Deno.env.get('AWS_ACCESS_KEY_ID')!,
 *     S3_SECRET_KEY:    Deno.env.get('AWS_SECRET_ACCESS_KEY')!,
 *     // S3_ENDPOINT:   'https://<account>.r2.cloudflarestorage.com', // R2 / MinIO
 *   }),
 * );
 * ```
 *
 * @example transformed URL
 * ```ts
 * // On-the-fly transformation URL (Cloudinary / ImageKit)
 * const thumb = storage.getTransformedUrl(result.key, {
 *   width: 200, height: 200, crop: 'fill', format: 'webp',
 * });
 * ```
 */
import type { SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, StorageProviderType, TransformationOptions, UploadOptions, UploadResult } from "../../types/app.d.ts";
/**
 * Resolve the correct {@link StorageProvider} implementation from a
 * {@link StorageConfig}.
 *
 * Called automatically by {@link createStorageManager}.  You can also call
 * this directly if you need the raw provider instance without the
 * `StorageManager` wrapper.
 *
 * @param config  Fully populated storage configuration.
 * @returns       The resolved provider instance.
 * @throws        When the selected provider is configured but required config
 *                keys are missing (e.g. Cloudinary without `apiSecret`).
 */
export declare function resolveStorageAdapter(config: StorageConfig): StorageProvider;
/**
 * High-level storage manager that wraps a {@link StorageProvider}.
 *
 * Obtain an instance via {@link createStorageManager} - do not construct this
 * class directly unless you have a specific reason to. All provider differences (Cloudinary vs ImageKit vs S3 vs local) are
 * abstracted away; every method returns `undefined` (rather than throwing)
 * when the underlying provider does not support the operation.
 */
export declare class StorageManager {
    private readonly _config;
    private readonly _provider;
    /** @internal Use {@link createStorageManager} instead. */
    constructor(config: StorageConfig, provider: StorageProvider);
    /**
     * Upload one file **or** an array of files using the configured provider.
     *
     * When an array is provided all uploads are dispatched concurrently and
     * results are returned in the same order. Passing a parallel `options`
     * array lets you specify per-file metadata; a single options object is
     * applied to all files.
     *
     * @param file    Raw bytes, a readable stream, or an array of either.
     * @param options Upload metadata. Single object or array aligned to `file`.
     * @returns       A single {@link UploadResult} or an array of them.
     *
     * @example Single file
     * ```ts
     * const result = await storage.upload(fileBytes, {
     *   folder: 'avatars', contentType: 'image/jpeg', assetType: 'image',
     * });
     * ```
     *
     * @example Multiple files
     * ```ts
     * const [img, vid] = await storage.upload([imgBytes, vidBytes], [
     *   { folder: 'images', assetType: 'image', contentType: 'image/webp' },
     *   { folder: 'videos', assetType: 'video', contentType: 'video/mp4'  },
     * ]) as UploadResult[];
     * ```
     */
    upload(file: Uint8Array | ReadableStream<Uint8Array> | Array<Uint8Array | ReadableStream<Uint8Array>>, options?: UploadOptions | UploadOptions[]): Promise<UploadResult | UploadResult[]>;
    /**
     * Delete a stored asset by its storage key.
     *
     * The meaning of "key" varies by provider:
     * - **Cloudinary** - `public_id` (returned as `result.key`)
     * - **ImageKit**   - `fileId` (returned as `result.publicId`)
     * - **S3 / local** - relative object / file path (returned as `result.key`)
     *
     * @param key  The storage key to delete.
     */
    delete(key: string): Promise<void>;
    /**
     * Check whether an asset exists.
     *
     * @param key  The storage key to check.
     * @returns    `true` / `false`, or `undefined` when the provider does not
     *             implement `exists`.
     */
    exists(key: string): Promise<boolean | undefined>;
    /**
     * Generate a pre-signed (time-limited) **delivery** URL for an existing asset.
     *
     * Supported by Cloudinary, ImageKit, and S3. Returns `undefined` for
     * providers that do not implement `getSignedUrl`.
     *
     * @param key            The storage key / public_id / fileId.
     * @param expiresIn      Seconds until the URL expires (default 3600).
     * @param transformation Optional on-the-fly transformations baked into the
     *                       URL (Cloudinary / ImageKit only; ignored by S3).
     */
    getSignedUrl(key: string, expiresIn?: number, transformation?: TransformationOptions): Promise<string | undefined>;
    /**
     * Build a public on-the-fly transformation URL.
     *
     * Supported by Cloudinary, ImageKit, and S3 (CDN URL only - no transforms).
     * Returns `undefined` for providers that do not implement `getTransformedUrl`.
     *
     * @param key            The storage key / public_id / filePath.
     * @param transformation Transformation options (resize, crop, format, …).
     */
    getTransformedUrl(key: string, transformation: TransformationOptions): string | undefined;
    /**
     * Generate signed credentials so the **client** can upload directly to the
     * storage provider - no file bytes ever pass through your server.
     *
     * ## Provider differences
     * | Provider    | `method` | `fields`         | Client body              |
     * |-------------|----------|------------------|--------------------------|
     * | S3          | `PUT`    | -                | Raw binary               |
     * | Cloudinary  | `POST`   | signature params | FormData + `file` field  |
     * | ImageKit    | `POST`   | auth fields      | FormData + `file` field  |
     * | Local       | throws   | -                | Not supported            |
     *
     * Always authenticate the requesting user **before** calling this method.
     * The returned `fields` contain only derived credentials - your API secret
     * or private key is never included.
     *
     * @param options  Metadata describing the file the client intends to upload.
     * @returns        {@link SignedUploadResult}, or `undefined` when the
     *                 provider does not implement `getSignedUploadUrl`.
     *
     * @example Server endpoint
     * ```ts
     * app.post('/upload-token', async (c) => {
     *   const session = getSession(c); // your auth
     *   if (!session) return c.json({ error: 'Unauthorized' }, 401);
     *
     *   const { contentType, folder, assetType } = await c.req.json();
     *   const token = await storage.getSignedUploadUrl({ contentType, folder, assetType });
     *   return c.json(token);
     * });
     * ```
     */
    getSignedUploadUrl(options: SignedUploadOptions): Promise<SignedUploadResult | undefined>;
    /** The active provider type string (e.g. `"cloudinary"`). */
    get providerType(): StorageProviderType;
    /** The full resolved {@link StorageConfig} used to create this manager. */
    get config(): StorageConfig;
    /**
     * The underlying {@link StorageProvider} adapter.
     *
     * Use this escape hatch when you need to call provider-specific methods
     * not exposed by `StorageManager`.
     */
    get adapter(): StorageProvider;
}
/**
 * Create a {@link StorageManager} from a {@link StorageConfig}.
 *
 * The correct adapter is resolved automatically from `config.provider`.
 * Optionally override with a custom `adapter` - useful for testing or
 * custom S3-compatible services.
 *
 * @param config  Built via {@link buildStorageConfig} from `@codexa/core/config`.
 * @param adapter Optional override - bypasses auto-resolution entirely.
 *
 * @example Auto-resolved (most common)
 * ```ts
 * import { buildStorageConfig } from '@codexa/core/config';
 * import { createStorageManager } from '@codexa/core/storage';
 *
 * const storage = createStorageManager(
 *   buildStorageConfig(Deno.env.toObject()),
 * );
 * ```
 *
 * @example Custom / BYO adapter
 * ```ts
 * const storage = createStorageManager(config, new MyMinioAdapter(config.s3!));
 * ```
 */
export declare function createStorageManager(config: StorageConfig, adapter?: StorageProvider): StorageManager;
/** A named collection of independently configured storage managers. */
export interface StorageRegistry {
    register(name: string, config: StorageConfig, adapter?: StorageProvider): StorageManager;
    get(name: string): StorageManager;
    has(name: string): boolean;
    names(): readonly string[];
    remove(name: string): StorageManager | undefined;
    clear(): void;
}
/** Create a registry for named storage manager instances. */
export declare function createStorageRegistry(): StorageRegistry;
export { LocalStorageProvider } from "./providers/local.d.ts";
export { CloudinaryStorageProvider } from "./providers/cloudinary.d.ts";
export { ImageKitStorageProvider } from "./providers/imagekit.d.ts";
export { S3StorageProvider } from "./providers/s3.d.ts";
export type { AssetType, SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, StorageProviderType, TransformationOptions, UploadOptions, UploadResult, } from "../../types/app.d.ts";
