// deno-lint-ignore-file camelcase

/**
 * @module Storage:Cloudinary
 *
 * Cloudinary storage provider for the Codexa unified storage layer.
 *
 * ## Overview
 * Cloudinary is a cloud-based media management platform that supports
 * images, videos, and raw files. This adapter wraps the Cloudinary Upload
 * API and covers four main workflows:
 *
 * ### 1. Server-side upload (`upload`)
 * The server reads the file bytes, signs the request with your API secret,
 * and POSTs the payload directly to Cloudinary. Suitable for small files or
 * server-generated assets.
 *
 * ### 2. Client-side direct upload (`getSignedUploadUrl`)
 * Your server generates a signed parameter set (timestamp + signature) and
 * returns it to the browser / mobile app. The client then POSTs the file
 * **directly** to Cloudinary - no file bytes ever pass through your API.
 * This is the recommended path for large images and videos because:
 * - It removes your server from the hot path.
 * - Upload speed is constrained only by the client's connection.
 * - You avoid double-charging egress on your hosting platform.
 *
 * ```
 * Client                    Your Server              Cloudinary
 *   |--- POST /upload-token --->|                        |
 *   |<-- { uploadUrl, fields } -|  (signs params)        |
 *   |--- POST multipart --------|----------------------->|
 *   |<-- { secure_url, … } -----|------------------------|
 * ```
 *
 * ### 3. Signed delivery URL (`getSignedUrl`)
 * Time-limited URL for accessing a **private** asset. The expiry and
 * optional transformation are baked into the URL signature.
 *
 * ### 4. Public transformation URL (`getTransformedUrl`)
 * Unsigned URL with on-the-fly resize / crop / format conversion.
 * Use this for public assets only.
 *
 * ## Video support
 * Pass `assetType: 'video'` in upload / signed-upload options. Cloudinary
 * automatically routes the request to the `video` resource-type endpoint and
 * returns `duration`, `bitrate`, and `frameRate` in the result.
 *
 * ## Multi-file upload
 * Pass an array of files (and an optional parallel array of options) to
 * `upload()`. All uploads run concurrently and results are returned in the
 * same order.
 *
 * @example Server-side upload
 * ```ts
 * const result = await provider.upload(fileBytes, {
 *   folder: 'avatars', contentType: 'image/webp', assetType: 'image',
 * });
 * console.log(result.url); // https://res.cloudinary.com/…
 * ```
 *
 * @example Client-side direct upload
 * ```ts
 * // --- Server endpoint (e.g. Hono / Oak / Fresh) ---
 * const token = await provider.getSignedUploadUrl({
 *   folder: 'videos', contentType: 'video/mp4', assetType: 'video',
 *   expiresIn: 1800,
 * });
 * return Response.json(token);
 *
 * // --- Browser ---
 * const { uploadUrl, fields } = await fetch('/upload-token').then(r => r.json());
 * const form = new FormData();
 * Object.entries(fields).forEach(([k, v]) => form.append(k, v));
 * form.append('file', fileInput.files[0]);
 * await fetch(uploadUrl, { method: 'POST', body: form });
 * ```
 */

import { createLogger } from '../../../utils/logger.ts';
import { generateId } from '../../../utils/crypto.ts';
import { hmacSha1, sha1 } from '../../../utils/hash.ts';
import type {
	AssetType,
	SignedUploadOptions,
	SignedUploadResult,
	StorageConfig,
	StorageProvider,
	TransformationOptions,
	UploadOptions,
	UploadResult,
} from '../../../types/app.d.ts';
import { toBytes } from '../helpers.ts';

const log = createLogger('Codexa:Storage:Cloudinary');

// Raw response shape returned by the Cloudinary Upload API.
interface CloudinaryUploadResponse {
	public_id: string;
	secure_url: string;
	bytes: number;
	format: string;
	resource_type: string;
	width?: number;
	height?: number;
	/** Duration in seconds (video assets). */
	duration?: number;
	bit_rate?: number;
	frame_rate?: number;
}

// Provider
/**
 * Cloudinary {@link StorageProvider}.
 *
 * Reads its configuration from `StorageConfig.cloudinary`.
 * - `cloudName`  - your Cloudinary cloud name
 * - `apiKey`     - Cloudinary API key (safe to expose in signed-upload tokens)
 * - `apiSecret`  - Cloudinary API secret (**never** send to clients)
 */
export class CloudinaryStorageProvider implements StorageProvider {
	private readonly cloudName: string;
	private readonly apiKey: string;
	private readonly apiSecret: string;

	constructor(config: NonNullable<StorageConfig['cloudinary']>) {
		this.cloudName = config.cloudName;
		this.apiKey = config.apiKey;
		this.apiSecret = config.apiSecret;
	}

	// Private helpers
	private uploadUrl(resourceType: string): string {
		return `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`;
	}

	private resolveResourceType(assetType?: AssetType): string {
		if (assetType === 'video') return 'video'; // video, audio, files.
		if (assetType === 'image') return 'image'; // image - raster/vector images
		return 'raw'; // raw - everything else (PDFs, ZIPs, documents, …)
	}

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
	private buildTransformString(t: TransformationOptions): string {
		if (t.cloudinaryOpts) {
			const opts = Array.isArray(t.cloudinaryOpts)
				? t.cloudinaryOpts
				: [t.cloudinaryOpts];
			return opts
				.map((o) =>
					Object.entries(o).map(([k, v]) => `${k}_${v}`).join(',')
				)
				.join('/');
		}
		const parts: string[] = [];
		if (t.width) parts.push(`w_${t.width}`);
		if (t.height) parts.push(`h_${t.height}`);
		if (t.crop) parts.push(`c_${t.crop}`);
		if (t.format && t.format !== 'auto') parts.push(`f_${t.format}`);
		if (t.quality) parts.push(`q_${t.quality}`);
		return parts.join(',');
	}

	/**
	 * Build the SHA-1 signature required by Cloudinary's authenticated API.
	 * Only the "signable" parameters are included - Cloudinary excludes `file`, `api_key`, `resource_type`, and `cloud_name` from the signature
	 */
	private async buildSignature(
		params: Record<string, string>,
	): Promise<string> {
		const excluded = new Set([
			'file',
			'api_key',
			'resource_type',
			'cloud_name',
		]);
		const sorted = Object.entries(params)
			.filter(([k]) => !excluded.has(k))
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join('&');
		return await sha1(`${sorted}${this.apiSecret}`);
	}

	/**
	 * Map a raw {@link CloudinaryUploadResponse} to the generic
	 * {@link UploadResult} shape used throughout the storage layer.
	 */
	private mapResponse(
		json: CloudinaryUploadResponse,
		options?: UploadOptions,
	): UploadResult {
		const resourceType = this.resolveResourceType(options?.assetType);
		return {
			key: json.public_id,
			size: json.bytes,
			contentType: options?.contentType ??
				`${resourceType}/${json.format}`,
			url: json.secure_url,
			assetType: options?.assetType ?? 'raw',
			publicId: json.public_id,
			format: json.format,
			width: json.width,
			height: json.height,
			duration: json.duration,
			bitrate: json.bit_rate,
			frameRate: json.frame_rate,
		};
	}

	// Single-file upload to Cloudinary from the server side. Called internally by the public `upload()` method.
	private async uploadOne(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult> {
		const data = await toBytes(file);
		const resourceType = this.resolveResourceType(options?.assetType);
		const timestamp = String(Math.floor(Date.now() / 1000));
		const publicId = options?.customId ??
			options?.fileName?.replace(/\.[^.]+$/, '') ??
			generateId();

		// Build signable params
		const sigParams: Record<string, string> = {
			timestamp,
			public_id: publicId,
		};
		if (options?.folder) sigParams['folder'] = options.folder;
		if (options?.tags?.length) sigParams['tags'] = options.tags.join(',');
		if (options?.overwrite) sigParams['overwrite'] = 'true';
		if (options?.eagerTransformations?.length) {
			sigParams['eager'] = options.eagerTransformations
				.map((t) => this.buildTransformString(t))
				.join('|');
		}

		const signature = await this.buildSignature(sigParams);

		// Assemble multipart form
		const form = new FormData();
		form.append(
			'file',
			new Blob([data], {
				type: options?.contentType ?? 'application/octet-stream',
			}),
		);
		form.append('api_key', this.apiKey);
		form.append('timestamp', timestamp);
		form.append('signature', signature);
		form.append('public_id', publicId);
		if (options?.folder) form.append('folder', options.folder);
		if (options?.tags?.length) form.append('tags', options.tags.join(','));
		if (options?.overwrite) form.append('overwrite', 'true');
		if (sigParams['eager']) form.append('eager', sigParams['eager']);

		const res = await fetch(this.uploadUrl(resourceType), {
			method: 'POST',
			body: form,
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(
				`Cloudinary upload failed (${res.status}): ${text}`,
			);
		}

		const json = (await res.json()) as CloudinaryUploadResponse;
		log.info(`Uploaded: ${json.public_id} (${json.bytes} bytes)`);
		return this.mapResponse(json, options);
	}

	// StorageProvider interface
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
	async upload(
		file:
			| Uint8Array
			| ReadableStream<Uint8Array>
			| Array<Uint8Array | ReadableStream<Uint8Array>>,
		options?: UploadOptions | UploadOptions[],
	): Promise<UploadResult | UploadResult[]> {
		if (Array.isArray(file)) {
			const results = await Promise.all(
				file.map((f, i) => {
					const opt = Array.isArray(options)
						? (options[i] ?? options[options.length - 1])
						: options;
					return this.uploadOne(f, opt);
				}),
			);
			return results;
		}
		return this.uploadOne(
			file,
			Array.isArray(options) ? options[0] : options,
		);
	}

	/**
	 * Delete an asset from Cloudinary by its `public_id`.
	 *
	 * Note: this method always routes through the `image/destroy` endpoint.
	 * For video assets use the Cloudinary Admin API directly if you need
	 * resource-type-aware deletion at scale.
	 *
	 * @param key  The `public_id` returned in {@link UploadResult.key}.
	 */
	async delete(key: string): Promise<void> {
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = await this.buildSignature({
			public_id: key,
			timestamp,
		});

		const form = new FormData();
		form.append('public_id', key);
		form.append('api_key', this.apiKey);
		form.append('timestamp', timestamp);
		form.append('signature', signature);

		const res = await fetch(
			`https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`,
			{ method: 'POST', body: form },
		);
		if (!res.ok) {
			throw new Error(`Cloudinary delete failed (${res.status})`);
		}
		log.info(`Deleted: ${key}`);
	}

	/**
	 * Check whether a Cloudinary asset exists by querying the Resources API.
	 *
	 * Uses HTTP Basic auth (apiKey:apiSecret).  Returns `true` when the API
	 * responds with HTTP 200, `false` for 404 or any other status.
	 *
	 * @param key  The `public_id` to look up.
	 */
	async exists(key: string): Promise<boolean> {
		const res = await fetch(
			`https://api.cloudinary.com/v1_1/${this.cloudName}/resources/image/upload/${key}`,
			{
				headers: {
					Authorization: `Basic ${
						btoa(`${this.apiKey}:${this.apiSecret}`)
					}`,
				},
			},
		);
		return res.status === 200;
	}

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
	async getSignedUrl(
		key: string,
		expiresIn = 3600,
		transformation?: TransformationOptions,
	): Promise<string> {
		const expiry = Math.floor(Date.now() / 1000) + expiresIn;
		const transforms = transformation
			? `/${this.buildTransformString(transformation)}`
			: '';
		const toSign = `${
			transforms ? transforms + '/' : ''
		}${key}${expiry}${this.apiSecret}`;
		const sig = (await sha1(toSign)).slice(0, 8);
		const baseUrl =
			`https://res.cloudinary.com/${this.cloudName}/image/upload`;
		return `${baseUrl}${transforms}/s--${sig}--/e_${expiry}/${key}`;
	}

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
	getTransformedUrl(
		key: string,
		transformation: TransformationOptions,
	): string {
		const transforms = this.buildTransformString(transformation);
		const fAuto = transformation.format === 'auto' ? 'f_auto/' : '';
		return `https://res.cloudinary.com/${this.cloudName}/image/upload/${fAuto}${transforms}/${key}`;
	}

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
	async getSignedUploadUrl(
		options: SignedUploadOptions,
	): Promise<SignedUploadResult> {
		const expiresIn = options.expiresIn ?? 3600;
		const timestamp = String(Math.floor(Date.now() / 1000));
		const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
		const resourceType = this.resolveResourceType(options.assetType);

		const publicId = options.customId ??
			(options.fileName
				? options.fileName.replace(/\.[^.]+$/, '')
				: generateId());

		// Build signable params (same rules as server-side upload)
		const sigParams: Record<string, string> = {
			timestamp,
			public_id: publicId,
		};
		if (options.folder) sigParams['folder'] = options.folder;
		if (options.tags?.length) sigParams['tags'] = options.tags.join(',');
		if (options.overwrite) sigParams['overwrite'] = 'true';
		if (options.eagerTransformations?.length) {
			sigParams['eager'] = options.eagerTransformations
				.map((t) => this.buildTransformString(t))
				.join('|');
		}

		const signature = await this.buildSignature(sigParams);

		// The client must include all of these in the multipart POST body
		const fields: Record<string, string> = {
			api_key: this.apiKey,
			timestamp,
			signature,
			public_id: publicId,
		};
		if (options.folder) fields['folder'] = options.folder;
		if (options.tags?.length) fields['tags'] = options.tags.join(',');
		if (options.overwrite) fields['overwrite'] = 'true';
		if (sigParams['eager']) fields['eager'] = sigParams['eager'];

		const key = options.folder ? `${options.folder}/${publicId}` : publicId;
		const publicUrl =
			`https://res.cloudinary.com/${this.cloudName}/${resourceType}/upload/${key}`;

		log.info(
			`Generated signed upload token for: ${key} (expires in ${expiresIn}s)`,
		);

		return {
			uploadUrl: this.uploadUrl(resourceType),
			method: 'POST',
			fields,
			key,
			expiresAt,
			publicUrl,
		};
	}
}

// Re-export the hmacSha1 import so the module graph stays clean
export { hmacSha1 };
