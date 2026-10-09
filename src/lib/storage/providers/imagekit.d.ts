/**
 * @module Storage:ImageKit
 *
 * ImageKit storage provider for the Codexa unified storage layer.
 *
 * ## Overview
 * ImageKit is a real-time image and video optimisation CDN. This adapter
 * covers four workflows:
 *
 * ### 1. Server-side upload (`upload`)
 * Your server reads the file, authenticates via HTTP Basic (private key),
 * and POSTs to the ImageKit Upload API. Suitable for server-generated
 * assets or files received via a traditional form submission.
 *
 * ### 2. Client-side direct upload (`getSignedUploadUrl`)
 * Your server generates an HMAC-SHA1 authentication bundle
 * (`token`, `expire`, `signature`) and returns it to the browser / mobile
 * app. The client then uploads the file **directly** to ImageKit, keeping
 * your server out of the hot path.
 *
 * ```
 * Client                    Your Server              ImageKit
 *   |--- POST /upload-token --->|                        |
 *   |<-- { uploadUrl, fields } -|  (signs token)         |
 *   |--- POST multipart --------|----------------------->|
 *   |<-- { url, fileId, … } ----|------------------------|
 * ```
 *
 * ### 3. Signed delivery URL (`getSignedUrl`)
 * HMAC-SHA1 signed URL for accessing a **private** file.  Expiry and
 * optional transformations are baked into the signature.
 *
 * ### 4. Public transformation URL (`getTransformedUrl`)
 * Unsigned transformation URL for public assets.
 *
 * ## Video support
 * Pass `assetType: 'video'` in upload options.  ImageKit handles video
 * transparently - the upload endpoint is the same; this flag is carried
 * through in the returned {@link UploadResult} only.
 *
 * ## Multi-file upload
 * Pass an array of files (and optionally a parallel array of options) to
 * `upload()`.  All uploads run concurrently; results maintain input order.
 *
 * @example Server-side upload
 * ```ts
 * const result = await provider.upload(fileBytes, {
 *   folder: '/avatars', contentType: 'image/png', assetType: 'image',
 * });
 * console.log(result.url); // https://ik.imagekit.io/…
 * ```
 *
 * @example Client-side direct upload
 * ```ts
 * // --- Server endpoint ---
 * const token = await provider.getSignedUploadUrl({
 *   folder: '/videos', contentType: 'video/mp4', assetType: 'video',
 * });
 * return Response.json(token);
 *
 * // --- Browser ---
 * const { uploadUrl, fields } = await fetch('/upload-token').then(r => r.json());
 * const form = new FormData();
 * Object.entries(fields).forEach(([k, v]) => form.append(k, v));
 * form.append('file', fileInput.files[0]);
 * form.append('fileName', fileInput.files[0].name);
 * await fetch(uploadUrl, { method: 'POST', body: form });
 * ```
 */
import type { SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, TransformationOptions, UploadOptions, UploadResult } from "../../../types/app.d.ts";
/**
 * ImageKit {@link StorageProvider}.
 *
 * Configuration is read from `StorageConfig.imagekit`:
 * - `publicKey`    - ImageKit public API key (safe to expose to clients)
 * - `privateKey`   - ImageKit private API key (**never** send to clients)
 * - `urlEndpoint`  - Your ImageKit URL endpoint (e.g. `https://ik.imagekit.io/myid`)
 */
export declare class ImageKitStorageProvider implements StorageProvider {
    private readonly publicKey;
    private readonly privateKey;
    private readonly urlEndpoint;
    constructor(config: NonNullable<StorageConfig['imagekit']>);
    /** ImageKit uses HTTP Basic auth: privateKey as username, empty password. */
    private get authHeader();
    /**
     * Serialize a {@link TransformationOptions} object into the ImageKit
     * transformation string format (`param-value` pairs joined by commas;
     * chained segments separated by `:`).
     *
     * When `imagekitOpts` is present it takes full precedence, enabling
     * arbitrary ImageKit parameters (e.g. `fo-auto`, `pr-true`).
     *
     * @example
     * ```ts
     * buildTransformString({ width: 400, height: 300, crop: 'fill', format: 'webp' })
     * // → "w-400,h-300,c-fill,f-webp"
     * ```
     */
    private buildTransformString;
    /**
     * Upload a single file to ImageKit from the server side.
     * Called internally by the public `upload()` method.
     */
    private uploadOne;
    /**
     * Upload one file **or** an array of files from the server side.
     *
     * @example Single file
     * ```ts
     * const result = await provider.upload(bytes, {
     *   folder: '/avatars', assetType: 'image', contentType: 'image/jpeg',
     * });
     * ```
     *
     * @example Multiple files
     * ```ts
     * const [img, vid] = await provider.upload([imgBytes, vidBytes], [
     *   { folder: '/images', assetType: 'image' },
     *   { folder: '/videos', assetType: 'video' },
     * ]) as UploadResult[];
     * ```
     */
    upload(file: Uint8Array | ReadableStream<Uint8Array> | Array<Uint8Array | ReadableStream<Uint8Array>>, options?: UploadOptions | UploadOptions[]): Promise<UploadResult | UploadResult[]>;
    /**
     * Delete an ImageKit file by its `fileId`.
     *
     * **Important:** `key` here must be the `fileId` (i.e. `result.publicId`)
     * returned from `upload()`, **not** the `filePath`.  The Admin API requires
     * the fileId for deletion.
     *
     * 404 responses are silently ignored - the file may have already been
     * deleted externally.
     *
     * @param key  The `fileId` (= `UploadResult.publicId`) of the asset.
     */
    delete(key: string): Promise<void>;
    /**
     * Check whether an ImageKit file exists by querying its details endpoint.
     *
     * @param key  The `fileId` (= `UploadResult.publicId`) to look up.
     * @returns    `true` when HTTP 200, `false` for 404 or other statuses.
     */
    exists(key: string): Promise<boolean>;
    /**
     * Generate a **signed delivery** URL for an existing ImageKit file.
     *
     * The HMAC-SHA1 signature covers the optional transformation path,
     * file path, and expiry - producing a URL that ImageKit validates on
     * each request.  Use this for private / authenticated files.
     *
     * @param key            The `filePath` returned in {@link UploadResult.key}.
     * @param expiresIn      Seconds until expiry (default 3600).
     * @param transformation Optional on-the-fly transformation baked into the URL.
     * @returns              A signed URL in the form
     *                       `{urlEndpoint}/tr:{transforms}{filePath}?ik-t={expiry}&ik-s={sig}`
     */
    getSignedUrl(key: string, expiresIn?: number, transformation?: TransformationOptions): Promise<string>;
    /**
     * Build a **public** on-the-fly transformation URL - no signing required.
     *
     * Only use this for files stored with public access.  The URL is
     * permanently accessible to anyone with the link.
     *
     * @param key            The `filePath` returned in {@link UploadResult.key}.
     * @param transformation Transformation parameters (resize, crop, format, …).
     * @returns              `{urlEndpoint}/tr:{transforms}{filePath}`
     *
     * @example
     * ```ts
     * provider.getTransformedUrl('/avatars/user.jpg', {
     *   width: 200, height: 200, crop: 'fill', format: 'webp',
     * });
     * // → https://ik.imagekit.io/myid/tr:w-200,h-200,c-fill,f-webp/avatars/user.jpg
     * ```
     */
    getTransformedUrl(key: string, transformation: TransformationOptions): string;
    /**
     * Generate an **ImageKit authentication token** so the client can upload
     * directly - no file bytes pass through your server.
     *
     * ## Security notes
     * - The `privateKey` is **never** included in the response.
     * - Always validate the user session before calling this method.
     * - Use a short `expiresIn` (≤ 1800 s) to limit the upload window.
     *
     * @param options  Metadata describing the file the client will upload.
     * @returns        `{ uploadUrl, method: "POST", fields, key, expiresAt, publicUrl? }`
     *
     * @example Server endpoint (Codexa)
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
     * const token = await fetch('/upload-token', {
     *   method: 'POST',
     *   body: JSON.stringify({ folder: '/videos', contentType: 'video/mp4' }),
     * }).then(r => r.json());
     *
     * const form = new FormData();
     * Object.entries(token.fields).forEach(([k, v]) => form.append(k, v as string));
     * form.append('file', fileInput.files[0]);
     * form.append('fileName', fileInput.files[0].name);
     * await fetch(token.uploadUrl, { method: 'POST', body: form });
     * ```
     */
    getSignedUploadUrl(options: SignedUploadOptions): Promise<SignedUploadResult>;
}
