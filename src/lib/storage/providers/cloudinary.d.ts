import { hmacSha1 } from "../../../utils/hash.d.ts";
import type { SignedUploadOptions, SignedUploadResult, StorageConfig, StorageProvider, TransformationOptions, UploadOptions, UploadResult } from "../../../types/app.d.ts";
/**
 * Cloudinary {@link StorageProvider}.
 *
 * Reads its configuration from `StorageConfig.cloudinary`.
 * - `cloudName`  - your Cloudinary cloud name
 * - `apiKey`     - Cloudinary API key (safe to expose in signed-upload tokens)
 * - `apiSecret`  - Cloudinary API secret (**never** send to clients)
 */
export declare class CloudinaryStorageProvider implements StorageProvider {
    private readonly cloudName;
    private readonly apiKey;
    private readonly apiSecret;
    constructor(config: NonNullable<StorageConfig['cloudinary']>);
    private uploadUrl;
    private resolveResourceType;
    /**
     * Serialize a {@link TransformationOptions} object into the
     * comma-separated Cloudinary transformation string format.
     *
     * @example
     * ```ts
     * buildTransformString({ width: 400, height: 300, crop: 'fill', format: 'webp' })
     * // → "w_400,h_300,c_fill,f_webp"
     * ```
     */
    private buildTransformString;
    /**
     * Build the SHA-1 signature required by Cloudinary's authenticated API.
     * Only the "signable" parameters are included - Cloudinary excludes `file`, `api_key`, `resource_type`, and `cloud_name` from the signature
     */
    private buildSignature;
    /**
     * Map a raw {@link CloudinaryUploadResponse} to the generic
     * {@link UploadResult} shape used throughout the storage layer.
     */
    private mapResponse;
    private uploadOne;
    /**
     * Upload one file **or** an array of files from the server side.
     *
     * @example Single file
     * ```ts
     * const result = await provider.upload(bytes, {
     *   folder: 'avatars', assetType: 'image', contentType: 'image/jpeg',
     * });
     * ```
     *
     * @example Multiple files
     * ```ts
     * const results = await provider.upload([bytes1, bytes2], [
     *   { folder: 'images', assetType: 'image' },
     *   { folder: 'videos', assetType: 'video' },
     * ]) as UploadResult[];
     * ```
     */
    upload(file: Uint8Array | ReadableStream<Uint8Array> | Array<Uint8Array | ReadableStream<Uint8Array>>, options?: UploadOptions | UploadOptions[]): Promise<UploadResult | UploadResult[]>;
    /**
     * Delete an asset from Cloudinary by its `public_id`.
     *
     * Note: this method always routes through the `image/destroy` endpoint.
     * For video assets use the Cloudinary Admin API directly if you need
     * resource-type-aware deletion at scale.
     *
     * @param key  The `public_id` returned in {@link UploadResult.key}.
     */
    delete(key: string): Promise<void>;
    /**
     * Check whether a Cloudinary asset exists by querying the Resources API.
     *
     * Uses HTTP Basic auth (apiKey:apiSecret).  Returns `true` when the API
     * responds with HTTP 200, `false` for 404 or any other status.
     *
     * @param key  The `public_id` to look up.
     */
    exists(key: string): Promise<boolean>;
    /**
     * Generate a Cloudinary **signed delivery** URL for an existing asset.
     *
     * The signature covers the optional transformation segment, the asset key,
     * and the expiry timestamp, producing a URL that Cloudinary will serve only
     * until `expiresAt`.  Use this for private / authenticated assets.
     *
     * @param key            The `public_id` of the asset.
     * @param expiresIn      Seconds until expiry (default 3600).
     * @param transformation Optional on-the-fly transformation baked into the URL.
     * @returns              A fully signed `https://res.cloudinary.com/…` URL.
     */
    getSignedUrl(key: string, expiresIn?: number, transformation?: TransformationOptions): Promise<string>;
    /**
     * Build a **public** on-the-fly transformation URL - no signing required.
     *
     * Only use this for assets stored with public delivery access.  The URL
     * will be permanently accessible to anyone with the link.
     *
     * @param key            The `public_id` of the asset.
     * @param transformation Transformation parameters (resize, crop, format, …).
     * @returns              A `https://res.cloudinary.com/…` URL.
     *
     * @example
     * ```ts
     * provider.getTransformedUrl('avatars/user_123', {
     *   width: 200, height: 200, crop: 'fill', format: 'webp',
     * });
     * // → https://res.cloudinary.com/<cloud>/image/upload/f_auto/w_200,h_200,c_fill,f_webp/avatars/user_123
     * ```
     */
    getTransformedUrl(key: string, transformation: TransformationOptions): string;
    /**
     * Generate a **signed upload token** so the client can upload directly to
     * Cloudinary - no file bytes pass through your server.
     *
     * ## Security notes
     * - The `apiSecret` is **never** included in the response - only its
     *   SHA-1 derived `signature` is sent to the client.
     * - Always authenticate/authorise the user session before calling this.
     * - Set a short `expiresIn` (≤ 1800s) for uploads that must happen quickly.
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
     *   body: JSON.stringify({ folder: 'videos', contentType: 'video/mp4', assetType: 'video' }),
     * }).then(r => r.json());
     *
     * const form = new FormData();
     * Object.entries(token.fields).forEach(([k, v]) => form.append(k, v as string));
     * form.append('file', fileInput.files[0]);
     * await fetch(token.uploadUrl, { method: 'POST', body: form });
     * ```
     */
    getSignedUploadUrl(options: SignedUploadOptions): Promise<SignedUploadResult>;
}
export { hmacSha1 };
