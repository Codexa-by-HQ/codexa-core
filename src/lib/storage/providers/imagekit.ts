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

import { createLogger } from '../../../utils/logger.ts';
import { generateId } from '../../../utils/crypto.ts';
import { hmacSha1 } from '../../../utils/hash.ts';
import type {
	SignedUploadOptions,
	SignedUploadResult,
	StorageConfig,
	StorageProvider,
	TransformationOptions,
	UploadOptions,
	UploadResult,
} from '../../../types/app.d.ts';
import { toBytes } from '../helpers.ts';

const log = createLogger('Codexa:Storage:ImageKit');

/** Raw response shape returned by the ImageKit Upload API. */
interface ImageKitUploadResponse {
	fileId: string;
	name: string;
	url: string;
	size: number;
	filePath: string;
	fileType: string;
	width?: number;
	height?: number;
	thumbnailUrl?: string;
}

// Provider
/**
 * ImageKit {@link StorageProvider}.
 *
 * Configuration is read from `StorageConfig.imagekit`:
 * - `publicKey`    - ImageKit public API key (safe to expose to clients)
 * - `privateKey`   - ImageKit private API key (**never** send to clients)
 * - `urlEndpoint`  - Your ImageKit URL endpoint (e.g. `https://ik.imagekit.io/myid`)
 */
export class ImageKitStorageProvider implements StorageProvider {
	private readonly publicKey: string;
	private readonly privateKey: string;
	private readonly urlEndpoint: string;

	constructor(config: NonNullable<StorageConfig['imagekit']>) {
		this.publicKey = config.publicKey;
		this.privateKey = config.privateKey;
		this.urlEndpoint = config.urlEndpoint.replace(/\/$/, '');
	}

	// Private helpers

	/** ImageKit uses HTTP Basic auth: privateKey as username, empty password. */
	private get authHeader(): string {
		return `Basic ${btoa(`${this.privateKey}:`)}`;
	}

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
	private buildTransformString(t: TransformationOptions): string {
		if (t.imagekitOpts) {
			const opts = Array.isArray(t.imagekitOpts)
				? t.imagekitOpts
				: [t.imagekitOpts];
			return opts
				.map((o) =>
					Object.entries(o).map(([k, v]) => `${k}-${v}`).join(',')
				)
				.join(':');
		}
		const parts: string[] = [];
		if (t.width) parts.push(`w-${t.width}`);
		if (t.height) parts.push(`h-${t.height}`);
		if (t.crop) parts.push(`c-${t.crop}`);
		if (t.format && t.format !== 'auto') parts.push(`f-${t.format}`);
		if (t.quality) parts.push(`q-${t.quality}`);
		return parts.join(',');
	}

	// Single-file upload (internal)
	/**
	 * Upload a single file to ImageKit from the server side.
	 * Called internally by the public `upload()` method.
	 */
	private async uploadOne(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult> {
		const data = await toBytes(file);
		const contentType = options?.contentType ?? 'application/octet-stream';
		const ext = contentType.split('/')[1] ?? 'bin';
		const fileName = options?.fileName ?? `${generateId()}.${ext}`;

		const form = new FormData();
		form.append('file', new Blob([data], { type: contentType }), fileName);
		form.append('fileName', fileName);
		form.append('publicKey', this.publicKey);
		if (options?.folder) form.append('folder', options.folder);
		if (options?.tags?.length) form.append('tags', options.tags.join(','));
		if (options?.customId) {
			form.append('customCoordinates', options.customId);
		}
		if (options?.overwrite !== undefined) {
			form.append('overwriteFile', String(options.overwrite));
		}
		if (options?.isPublic === false) form.append('isPrivateFile', 'true');
		if (options?.metadata) {
			form.append('customMetadata', JSON.stringify(options.metadata));
		}
		if (options?.eagerTransformations?.length) {
			form.append(
				'transformation',
				JSON.stringify({
					pre: options.eagerTransformations.map((t) => ({
						raw: this.buildTransformString(t),
					})),
				}),
			);
		}

		const res = await fetch(
			'https://upload.imagekit.io/api/v1/files/upload',
			{
				method: 'POST',
				headers: { Authorization: this.authHeader },
				body: form,
			},
		);
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`ImageKit upload failed (${res.status}): ${text}`);
		}

		const json = (await res.json()) as ImageKitUploadResponse;
		log.info(`Uploaded: ${json.filePath} (${json.size} bytes)`);

		return {
			key: json.filePath,
			size: json.size,
			contentType,
			url: json.url,
			assetType: options?.assetType ?? 'raw',
			publicId: json.fileId,
			width: json.width,
			height: json.height,
			thumbnailUrl: json.thumbnailUrl,
		};
	}

	// StorageProvider interface
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
	async delete(key: string): Promise<void> {
		const res = await fetch(`https://api.imagekit.io/v1/files/${key}`, {
			method: 'DELETE',
			headers: { Authorization: this.authHeader },
		});
		if (!res.ok && res.status !== 404) {
			throw new Error(`ImageKit delete failed (${res.status})`);
		}
		log.info(`Deleted: ${key}`);
	}

	/**
	 * Check whether an ImageKit file exists by querying its details endpoint.
	 *
	 * @param key  The `fileId` (= `UploadResult.publicId`) to look up.
	 * @returns    `true` when HTTP 200, `false` for 404 or other statuses.
	 */
	async exists(key: string): Promise<boolean> {
		const res = await fetch(
			`https://api.imagekit.io/v1/files/${key}/details`,
			{ headers: { Authorization: this.authHeader } },
		);
		return res.status === 200;
	}

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
	async getSignedUrl(
		key: string,
		expiresIn = 3600,
		transformation?: TransformationOptions,
	): Promise<string> {
		const expiry = Math.floor(Date.now() / 1000) + expiresIn;
		const transforms = transformation
			? `/tr:${this.buildTransformString(transformation)}`
			: '';
		const filePath = key.startsWith('/') ? key : `/${key}`;
		// ImageKit signed URL: HMAC-SHA1( transforms + path + expiry, privateKey )
		const signature = await hmacSha1(
			this.privateKey,
			`${transforms}${filePath}${expiry}`,
		);
		return `${this.urlEndpoint}${transforms}${filePath}?ik-t=${expiry}&ik-s=${signature}`;
	}

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
	getTransformedUrl(
		key: string,
		transformation: TransformationOptions,
	): string {
		const transforms = this.buildTransformString(transformation);
		const filePath = key.startsWith('/') ? key : `/${key}`;
		return `${this.urlEndpoint}/tr:${transforms}${filePath}`;
	}

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
	async getSignedUploadUrl(
		options: SignedUploadOptions,
	): Promise<SignedUploadResult> {
		const expiresIn = options.expiresIn ?? 3600;
		const expire = Math.floor(Date.now() / 1000) + expiresIn;

		// A random nonce - ImageKit requires this to be unique per request
		const token = generateId();

		// HMAC-SHA1(token + expire, privateKey)
		const signature = await hmacSha1(
			this.privateKey,
			`${token}${expire}`,
		);

		const contentType = options.contentType ?? 'application/octet-stream';
		const ext = contentType.split('/')[1] ?? 'bin';
		const fileName = options.fileName ?? `${generateId()}.${ext}`;
		const folder = options.folder ?? '/';

		// Normalise folder to ensure leading slash
		const normFolder = folder.startsWith('/') ? folder : `/${folder}`;
		const key = `${normFolder}/${fileName}`.replace(/\/+/g, '/');

		// Fields the client must include in the multipart POST body
		const fields: Record<string, string> = {
			publicKey: this.publicKey,
			signature,
			expire: String(expire),
			token,
			fileName,
			folder: normFolder,
		};
		if (options.tags?.length) fields['tags'] = options.tags.join(',');
		if (options.overwrite !== undefined) {
			fields['overwriteFile'] = String(options.overwrite);
		}
		if (options.metadata) {
			fields['customMetadata'] = JSON.stringify(options.metadata);
		}
		if (options.eagerTransformations?.length) {
			fields['transformation'] = JSON.stringify({
				pre: options.eagerTransformations.map((t) => ({
					raw: this.buildTransformString(t),
				})),
			});
		}

		const publicUrl = `${this.urlEndpoint}${key}`;

		log.info(
			`Generated signed upload token for: ${key} (expires in ${expiresIn}s)`,
		);

		return {
			uploadUrl: 'https://upload.imagekit.io/api/v1/files/upload',
			method: 'POST',
			fields,
			key,
			expiresAt: expire,
			publicUrl,
		};
	}
}
