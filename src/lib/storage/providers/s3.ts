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

import { createLogger } from '../../../utils/logger.ts';
import { generateId } from '../../../utils/crypto.ts';
import { bytesToHex, hmacRaw, sha256 } from '../../../utils/hash.ts';
import type {
	SignedUploadOptions,
	SignedUploadResult,
	StorageConfig,
	StorageProvider,
	TransformationOptions,
	UploadOptions,
	UploadResult,
} from '../../../types/app.d.ts';
import {
	awsUriEncode,
	deriveSigningKey,
	formatAmzDate,
	formatDateStamp,
	toBytes,
} from '../helpers.ts';

const log = createLogger('Codexa:Storage:S3');

// Presigning core
interface PresignOptions {
	accessKey: string;
	secretKey: string;
	region: string;
	bucket: string;
	/** Custom host for S3-compatible services.  Defaults to `{bucket}.s3.{region}.amazonaws.com`. */
	endpoint?: string;
	/** The S3 object key (path inside the bucket). */
	key: string;
	/** HTTP verb for the presigned request. */
	method: 'PUT' | 'GET';
	/** How long (in seconds) the presigned URL remains valid. */
	expiresIn: number;
	/** MIME type - carried through for caller context, not locked into the signature for presigned URLs. */
	contentType?: string;
}

/**
 * Generate a presigned S3 URL using AWS Signature Version 4
 * (query-string / "unsigned payload" variant).
 *
 * The resulting URL is self-contained - no `Authorization` header is required
 * when making the request.  Works for PUT (upload) and GET (download) and is
 * compatible with any S3-compatible service.
 *
 * ### Signing flow
 * 1. Build canonical request - method, URI-encoded path, sorted query string,
 *    canonical headers, signed-headers list, and `"UNSIGNED-PAYLOAD"`.
 * 2. Build string-to-sign - algorithm identifier, timestamp, credential scope,
 *    SHA-256 of the canonical request.
 * 3. Derive signing key via {@link deriveSigningKey} (`hmacRaw` chain).
 * 4. Compute final signature: `bytesToHex(hmacRaw(signingKey, stringToSign))`.
 * 5. Append `X-Amz-Signature` to the query string.
 *
 * @param opts  Presign configuration.
 * @returns     A fully signed URL string.
 */
async function presignS3Url(opts: PresignOptions): Promise<string> {
	const {
		accessKey,
		secretKey,
		region,
		bucket,
		endpoint,
		key,
		method,
		expiresIn,
	} = opts;

	const now = new Date();
	const amzDate = formatAmzDate(now);
	const dateStamp = formatDateStamp(now);
	const service = 's3';
	const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
	const credential = `${accessKey}/${credentialScope}`;

	// Virtual-hosted-style host, or custom endpoint host for compatible services
	const host = endpoint
		? new URL(endpoint).host
		: `${bucket}.s3.${region}.amazonaws.com`;

	// Path - slashes within the key must NOT be encoded
	const encodedPath = `/${awsUriEncode(key, false)}`;

	// Canonical query parameters - must be sorted alphabetically by key
	const rawQueryParams: Record<string, string> = {
		'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
		'X-Amz-Credential': credential,
		'X-Amz-Date': amzDate,
		'X-Amz-Expires': String(expiresIn),
		'X-Amz-SignedHeaders': 'host',
	};

	const sortedQuery = Object.entries(rawQueryParams)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
		.join('&');

	// Canonical request
	// AWS requires "UNSIGNED-PAYLOAD" for presigned URLs - the body is not signed
	const canonicalRequest = [
		method,
		encodedPath,
		sortedQuery,
		`host:${host}\n`, // canonical headers block (must end with \n)
		'host', // signed headers list
		'UNSIGNED-PAYLOAD',
	].join('\n');

	// String to sign
	const hashedCanonical = await sha256(canonicalRequest);
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		credentialScope,
		hashedCanonical,
	].join('\n');

	// Derive the signing key and produce the hex signature
	// `hmacRaw` returns Uint8Array; `bytesToHex` (from hash.ts) converts to hex
	const signingKey = await deriveSigningKey(
		secretKey,
		dateStamp,
		region,
		service,
	);
	const signature = bytesToHex(await hmacRaw(signingKey, stringToSign));

	// Assemble the final presigned URL
	const scheme = endpoint ? new URL(endpoint).protocol : 'https:';
	const baseUrl = endpoint
		? `${endpoint.replace(/\/$/, '')}/${bucket}${encodedPath}`
		: `${scheme}//${host}${encodedPath}`;

	return `${baseUrl}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

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
export class S3StorageProvider implements StorageProvider {
	private readonly bucket: string;
	private readonly region: string;
	private readonly accessKey: string;
	private readonly secretKey: string;
	private readonly endpoint: string | undefined;
	private readonly cdnBaseUrl: string | undefined;

	constructor(config: NonNullable<StorageConfig['s3']>) {
		this.bucket = config.bucket;
		this.region = config.region;
		this.accessKey = config.accessKey;
		this.secretKey = config.secretKey;
		this.endpoint = config.endpoint;
		this.cdnBaseUrl = config.cdnBaseUrl;
	}

	// Private helpers
	/**
	 * Resolve the public HTTP URL for a stored object key.
	 *
	 * Priority order:
	 * 1. `<cdnBaseUrl>/<key>` - when a CDN is configured.
	 * 2. `<endpoint>/<bucket>/<key>` - for S3-compatible services with a custom endpoint.
	 * 3. `https://<bucket>.s3.<region>.amazonaws.com/<key>` - standard AWS virtual-hosted URL.
	 */
	private objectUrl(key: string): string {
		if (this.cdnBaseUrl) {
			return `${this.cdnBaseUrl.replace(/\/$/, '')}/${key}`;
		}
		if (this.endpoint) {
			return `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
		}
		return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
	}
	/**
	 * Derive the S3 object key from upload options.
	 *
	 * Joins the optional `folder` prefix with a resolved file name.  A UUID
	 * is generated when `fileName` is omitted; the extension is inferred from
	 * `contentType` when available.
	 */
	private resolveKey(options?: UploadOptions | SignedUploadOptions): string {
		const ext = options?.contentType
			? `.${options.contentType.split('/')[1] ?? 'bin'}`
			: '.bin';
		const fileName = options?.fileName ?? `${generateId()}${ext}`;
		return options?.folder ? `${options.folder}/${fileName}` : fileName;
	}

	/**
	 * Return the shared presign config derived from instance credentials.
	 * Reduces repetition across `uploadOne`, `delete`, and `getSignedUrl`.
	 */
	private get presignBase() {
		return {
			accessKey: this.accessKey,
			secretKey: this.secretKey,
			region: this.region,
			bucket: this.bucket,
			endpoint: this.endpoint,
		};
	}

	// Single-file upload (internal)
	/**
	 * Upload a single file to S3 from the server side.
	 *
	 * Internally generates a short-lived (15 min) presigned PUT URL and
	 * immediately uses it - the same signing path as client-side uploads,
	 * keeping the implementation DRY and the signing logic in one place.
	 *
	 * Called internally by the public `upload()` method.
	 */
	private async uploadOne(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult> {
		const data = await toBytes(file);
		const key = options?.customId ?? this.resolveKey(options);
		const contentType = options?.contentType ?? 'application/octet-stream';

		const putUrl = await presignS3Url({
			...this.presignBase,
			key,
			method: 'PUT',
			expiresIn: 900, // 15 min - plenty for a server-initiated PUT
			contentType,
		});

		const res = await fetch(putUrl, {
			method: 'PUT',
			headers: { 'Content-Type': contentType },
			body: data,
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`S3 upload failed (${res.status}): ${text}`);
		}

		log.info(`Uploaded: ${key} (${data.length} bytes)`);

		return {
			key,
			size: data.length,
			contentType,
			url: this.objectUrl(key),
			assetType: options?.assetType ?? 'raw',
		};
	}

	// StorageProvider interface
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
	async upload(
		file:
			| Uint8Array
			| ReadableStream<Uint8Array>
			| Array<Uint8Array | ReadableStream<Uint8Array>>,
		options?: UploadOptions | UploadOptions[],
	): Promise<UploadResult | UploadResult[]> {
		if (Array.isArray(file)) {
			return Promise.all(
				file.map((f, i) => {
					const opt = Array.isArray(options)
						? (options[i] ?? options[options.length - 1])
						: options;
					return this.uploadOne(f, opt);
				}),
			);
		}
		return this.uploadOne(
			file,
			Array.isArray(options) ? options[0] : options,
		);
	}

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
	async delete(key: string): Promise<void> {
		const now = new Date();
		const amzDate = formatAmzDate(now);
		const dateStamp = formatDateStamp(now);
		const service = 's3';
		const credentialScope =
			`${dateStamp}/${this.region}/${service}/aws4_request`;

		const host = this.endpoint
			? new URL(this.endpoint).host
			: `${this.bucket}.s3.${this.region}.amazonaws.com`;
		const encodedPath = `/${awsUriEncode(key, false)}`;

		// SHA-256 of an empty body
		const payloadHash = await sha256('');

		const canonicalHeaders =
			`host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
		const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

		const canonicalRequest = [
			'DELETE',
			encodedPath,
			'', // no query string
			canonicalHeaders,
			signedHeaders,
			payloadHash,
		].join('\n');

		const hashedCanonical = await sha256(canonicalRequest);
		const stringToSign = [
			'AWS4-HMAC-SHA256',
			amzDate,
			credentialScope,
			hashedCanonical,
		].join('\n');

		const signingKey = await deriveSigningKey(
			this.secretKey,
			dateStamp,
			this.region,
			service,
		);
		// hmacRaw → Uint8Array; bytesToHex → lowercase hex (both from hash.ts)
		const signature = bytesToHex(await hmacRaw(signingKey, stringToSign));

		const scheme = this.endpoint
			? new URL(this.endpoint).protocol
			: 'https:';
		const url = this.endpoint
			? `${this.endpoint.replace(/\/$/, '')}/${this.bucket}${encodedPath}`
			: `${scheme}//${host}${encodedPath}`;

		const res = await fetch(url, {
			method: 'DELETE',
			headers: {
				Host: host,
				'x-amz-date': amzDate,
				'x-amz-content-sha256': payloadHash,
				Authorization: [
					`AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}`,
					`SignedHeaders=${signedHeaders}`,
					`Signature=${signature}`,
				].join(', '),
			},
		});

		if (!res.ok && res.status !== 404) {
			throw new Error(`S3 delete failed (${res.status})`);
		}
		log.info(`Deleted: ${key}`);
	}

	/**
	 * Check whether an S3 object exists by issuing a HEAD request against a
	 * short-lived presigned GET URL.
	 *
	 * Returns `true` for HTTP 200, `false` for HTTP 404 or any other status.
	 *
	 * @param key  The object key to check.
	 */
	async exists(key: string): Promise<boolean> {
		const url = await presignS3Url({
			...this.presignBase,
			key,
			method: 'GET',
			expiresIn: 60,
		});
		const res = await fetch(url, { method: 'HEAD' });
		return res.status === 200;
	}

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
	async getSignedUrl(
		key: string,
		expiresIn = 3600,
		_transformation?: TransformationOptions,
	): Promise<string> {
		return presignS3Url({
			...this.presignBase,
			key,
			method: 'GET',
			expiresIn,
		});
	}

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
	getTransformedUrl(
		key: string,
		_transformation: TransformationOptions,
	): string {
		return this.objectUrl(key);
	}

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
	async getSignedUploadUrl(
		options: SignedUploadOptions,
	): Promise<SignedUploadResult> {
		const expiresIn = options.expiresIn ?? 3600;
		const key = options.customId ?? this.resolveKey(options);
		const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

		const uploadUrl = await presignS3Url({
			...this.presignBase,
			key,
			method: 'PUT',
			expiresIn,
			contentType: options.contentType,
		});

		const publicUrl = this.cdnBaseUrl ? this.objectUrl(key) : undefined;

		log.info(
			`Generated presigned PUT for: ${key} (expires in ${expiresIn}s)`,
		);

		return {
			uploadUrl,
			method: 'PUT',
			key,
			expiresAt,
			publicUrl,
		};
	}
}
