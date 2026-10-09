/**
 * @module Storage:S3
 *
 * AWS S3 (and S3-compatible) storage provider for the Codexa unified storage
 * layer.
 *
 * ## Overview
 * This adapter targets AWS S3 and any S3-compatible object store
 * (Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, …).  It signs
 * all requests using **AWS Signature Version 4** - no SDK dependency.
 *
 * ### 1. Server-side upload (`upload`)
 * The server generates a short-lived presigned PUT URL internally and
 * immediately uses it to stream the file to S3.  Suitable for small assets
 * or server-generated content.  For large files prefer the direct-upload
 * path below.
 *
 * ### 2. Client-side direct upload (`getSignedUploadUrl`)
 * Your server generates a **presigned PUT URL** (valid for `expiresIn`
 * seconds) and returns it to the browser / mobile app.  The client then
 * PUTs the file **directly** to S3 - the file never passes through your API.
 *
 * ```
 * Client                    Your Server                   S3
 *   |--- POST /upload-token --->|                           |
 *   |<-- { uploadUrl, key } ----|  (signs S3 PUT URL)       |
 *   |--- PUT <binary body> ------|-------------------------->|
 *   |<-- HTTP 200 --------------|---------------------------|
 * ```
 *
 * **Client-side PUT (browser)**
 * ```ts
 * const { uploadUrl } = await fetch('/upload-token', { method: 'POST', … }).then(r => r.json());
 * await fetch(uploadUrl, {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'video/mp4' },
 *   body: fileInput.files[0],
 * });
 * ```
 *
 * ### 3. Signed delivery URL (`getSignedUrl`)
 * Presigned GET URL for reading a **private** object, valid for `expiresIn`
 * seconds.
 *
 * ### 4. Public CDN URL (`getTransformedUrl`)
 * Returns a plain `https://<cdnBaseUrl>/<key>` URL.  Only useful when a CDN
 * (CloudFront, etc.) sits in front of the bucket.  S3 itself does not support
 * on-the-fly image transformations.
 *
 * ## Video support
 * S3 stores video identically to any other binary object.  Pass
 * `assetType: 'video'` in options to have the flag propagated in
 * {@link UploadResult}; no special routing is applied.
 *
 * ## Multi-file upload
 * Pass an array of files (and optionally a parallel array of options) to
 * `upload()`.  All PUTs are dispatched concurrently; results maintain input
 * order.
 *
 * ## S3-compatible services
 * Set `StorageConfig.s3.endpoint` to the service's base URL:
 * - Cloudflare R2: `https://<account>.r2.cloudflarestorage.com`
 * - MinIO:         `http://localhost:9000`
 * - Backblaze B2:  `https://s3.<region>.backblazeb2.com`
 *
 * @example Configuration
 * ```ts
 * const storage = createStorageManager(buildStorageConfig({
 *   STORAGE_PROVIDER: 's3',
 *   S3_BUCKET:        'my-bucket',
 *   S3_REGION:        'us-east-1',
 *   S3_ACCESS_KEY:    Deno.env.get('AWS_ACCESS_KEY_ID')!,
 *   S3_SECRET_KEY:    Deno.env.get('AWS_SECRET_ACCESS_KEY')!,
 * }));
 * ```
 */
import type { SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, TransformationOptions, UploadOptions, UploadResult } from "../../../types/app.d.ts";
/**
 * S3 (and S3-compatible) {@link StorageProvider} - **not yet implemented**.
 *
 * This stub throws clear errors on every call so that mis-configurations
 * surface immediately rather than failing silently.
 *
 * **To use S3:** implement `StorageProvider` in your own code, instantiate it
 * with `StorageConfig.s3`, and pass it as the second argument to
 * `createStorageManager()`:
 *
 * ```ts
 * import { createStorageManager } from '@codexa/core/storage';
 * import { buildStorageConfig } from '@codexa/core/config';
 *
 * const cfg = buildStorageConfig(Deno.env.toObject()); // provider: 's3'
 * const storage = createStorageManager(cfg, new MyS3Adapter(cfg.s3!));
 * ```
 *
 * @todo Implement using the AWS Signature V4 signing algorithm.
 */
export declare class S3StorageProvider implements StorageProvider {
    private readonly bucket;
    private readonly region;
    private readonly accessKey;
    private readonly secretKey;
    private readonly endpoint;
    private readonly cdnBaseUrl;
    constructor(config: NonNullable<StorageConfig['s3']>);
    /**
     * Resolve the public HTTP URL for a stored object key.
     *
     * Priority order:
     * 1. `<cdnBaseUrl>/<key>` - when a CDN is configured.
     * 2. `<endpoint>/<bucket>/<key>` - for S3-compatible services with a custom endpoint.
     * 3. `https://<bucket>.s3.<region>.amazonaws.com/<key>` - standard AWS virtual-hosted URL.
     */
    private objectUrl;
    /**
     * Derive the S3 object key from upload options.
     *
     * Joins the optional `folder` prefix with a resolved file name.  A UUID
     * is generated when `fileName` is omitted; the extension is inferred from
     * `contentType` when available.
     */
    private resolveKey;
    /**
     * Return the shared presign config derived from instance credentials.
     * Reduces repetition across `uploadOne`, `delete`, and `getSignedUrl`.
     */
    private get presignBase();
    /**
     * Upload a single file to S3 from the server side.
     *
     * Internally generates a short-lived (15 min) presigned PUT URL and
     * immediately uses it - the same signing path as client-side uploads,
     * keeping the implementation DRY and the signing logic in one place.
     *
     * Called internally by the public `upload()` method.
     */
    private uploadOne;
    /**
     * Upload one file **or** an array of files from the server side.
     *
     * @example Single file
     * ```ts
     * const result = await provider.upload(videoBytes, {
     *   folder: 'videos', assetType: 'video', contentType: 'video/mp4',
     * });
     * ```
     *
     * @example Multiple files
     * ```ts
     * const results = await provider.upload([img, pdf], [
     *   { folder: 'images', contentType: 'image/webp' },
     *   { folder: 'docs',   contentType: 'application/pdf', assetType: 'document' },
     * ]) as UploadResult[];
     * ```
     */
    upload(file: Uint8Array | ReadableStream<Uint8Array> | Array<Uint8Array | ReadableStream<Uint8Array>>, options?: UploadOptions | UploadOptions[]): Promise<UploadResult | UploadResult[]>;
    /**
     * Delete an S3 object by its key.
     *
     * Issues an authenticated DELETE request signed with AWS Signature V4
     * (header-based, not presigned - DELETE carries no body so a presigned
     * URL provides no advantage here).  HTTP 404 responses are silently
     * ignored - the object may have already been removed externally.
     *
     * @param key  The object key returned in {@link UploadResult.key}.
     */
    delete(key: string): Promise<void>;
    /**
     * Check whether an S3 object exists by issuing a HEAD request against a
     * short-lived presigned GET URL.
     *
     * Returns `true` for HTTP 200, `false` for HTTP 404 or any other status.
     *
     * @param key  The object key to check.
     */
    exists(key: string): Promise<boolean>;
    /**
     * Generate a presigned **GET** URL for downloading a private S3 object.
     *
     * The `transformation` parameter is accepted for interface compatibility
     * but **ignored** - S3 does not support on-the-fly image transformations.
     *
     * @param key        The object key to presign.
     * @param expiresIn  Seconds until the URL expires (default 3600).
     * @returns          A presigned `https://…` URL.
     */
    getSignedUrl(key: string, expiresIn?: number, _transformation?: TransformationOptions): Promise<string>;
    /**
     * Return the CDN (or plain S3) URL for a public object.
     *
     * If `StorageConfig.s3.cdnBaseUrl` is configured that URL is returned;
     * otherwise the standard S3 virtual-hosted URL is used.
     *
     * The `transformation` parameter is accepted for interface compatibility
     * but **ignored** - S3 does not natively support on-the-fly transforms.
     *
     * @param key  The object key.
     */
    getTransformedUrl(key: string, _transformation: TransformationOptions): string;
    /**
     * Generate a presigned **PUT** URL so the client can upload directly to S3.
     *
     * Unlike Cloudinary / ImageKit, S3 presigned PUTs use a **raw binary body** -
     * no `FormData` is needed.  `result.fields` is always `undefined`.
     *
     * ## Security notes
     * - `secretKey` is **never** included in the response - only the derived
     *   query-string signature is exposed.
     * - Always authenticate/authorise the user session before calling this.
     * - Keep `expiresIn` short (≤ 1800 s) to limit the upload window.
     *
     * @param options  Metadata describing the file the client will upload.
     * @returns        `{ uploadUrl, method: "PUT", key, expiresAt, publicUrl? }`
     *
     * @example Server endpoint (Hono)
     * ```ts
     * app.post('/upload-token', async (c) => {
     *   const { folder, contentType, assetType } = await c.req.json();
     *   const token = await provider.getSignedUploadUrl({ folder, contentType, assetType });
     *   return c.json(token);
     * });
     * ```
     *
     * @example Browser client
     * ```ts
     * const { uploadUrl, key } = await fetch('/upload-token', {
     *   method: 'POST',
     *   body: JSON.stringify({ folder: 'videos', contentType: 'video/mp4' }),
     * }).then(r => r.json());
     *
     * // PUT the raw file - no FormData needed for S3 presigned PUT
     * await fetch(uploadUrl, {
     *   method: 'PUT',
     *   headers: { 'Content-Type': 'video/mp4' },
     *   body: fileInput.files[0],
     * });
     * ```
     */
    getSignedUploadUrl(options: SignedUploadOptions): Promise<SignedUploadResult>;
}
