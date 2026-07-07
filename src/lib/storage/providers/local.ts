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

import * as path from '../../../providers/path.ts';
import { createLogger } from '../../../utils/logger.ts';
import { generateId } from '../../../utils/crypto.ts';
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

const log = createLogger('Codexa:Storage:Local');

// Provider
/**
 * Local filesystem {@link StorageProvider}.
 *
 * Reads its configuration from `StorageConfig.local`.  Falls back to
 * `./uploads` and no base URL when nothing is set.
 *
 * **For development / testing only.**  Use Cloudinary, ImageKit, or S3 for
 * production workloads.
 */
export class LocalStorageProvider implements StorageProvider {
	private readonly dir: string;
	private readonly baseUrl: string;

	constructor(config: NonNullable<StorageConfig['local']>) {
		this.dir = config.dir ?? './uploads';
		this.baseUrl = config.baseUrl ?? '';
	}

	// Private helpers
	/**
	 * Recursively create all directories in `dirPath` if they do not exist.
	 * Swallows "already exists" errors silently.
	 */
	private async ensureDir(dirPath: string): Promise<void> {
		try {
			await Deno.mkdir(dirPath, { recursive: true });
		} catch {
			// Already exists - ignore
		}
	}

	/**
	 * Resolve the absolute filesystem path for a given storage key.
	 *
	 * @param key  Relative storage key (e.g. `"avatars/user_123.jpg"`).
	 */
	private resolveFilePath(key: string): string {
		return path.join(this.dir, key);
	}

	/**
	 * Build the public URL for a storage key.
	 *
	 * Returns `<baseUrl>/<key>` when `baseUrl` is configured, otherwise just
	 * the relative key - useful as a fallback for static file middleware.
	 */
	private resolveUrl(key: string): string {
		return this.baseUrl ? `${this.baseUrl}/${key}` : key;
	}

	// Single-file upload (internal)
	/**
	 * Write a single file to disk and return an {@link UploadResult}.
	 * Called internally by the public `upload()` method.
	 */
	private async uploadOne(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult> {
		const folder = options?.folder ?? '';
		const ext = options?.contentType
			? `.${options.contentType.split('/')[1] ?? 'bin'}`
			: '.bin';
		const fileName = options?.fileName ?? `${generateId()}${ext}`;
		const key = folder ? `${folder}/${fileName}` : fileName;

		const fullPath = this.resolveFilePath(key);
		await this.ensureDir(path.dirname(fullPath));

		const data = await toBytes(file);
		await Deno.writeFile(fullPath, data);

		log.info(`Uploaded: ${key} (${data.length} bytes)`);

		return {
			key,
			size: data.length,
			contentType: options?.contentType ?? 'application/octet-stream',
			url: this.resolveUrl(key),
			assetType: options?.assetType ?? 'raw',
		};
	}

	// StorageProvider interface
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
	 * Delete a file from the local filesystem by its storage key.
	 *
	 * `Deno.errors.NotFound` is handled gracefully - a warning is logged and the method resolves without throwing.  All other errors propagate.
	 *
	 * @param key  Relative storage key returned from `upload()`.
	 */
	async delete(key: string): Promise<void> {
		try {
			await Deno.remove(this.resolveFilePath(key));
			log.info(`Deleted: ${key}`);
		} catch (err) {
			if (!(err instanceof Deno.errors.NotFound)) throw err;
			log.warn(`Not found for deletion: ${key}`);
		}
	}

	/**
	 * Check whether a file exists on the local filesystem.
	 *
	 * Uses `Deno.stat` - returns `true` when the stat succeeds, `false` on any error (including `NotFound` and permission errors).
	 *
	 * @param key  Relative storage key to check.
	 */
	async exists(key: string): Promise<boolean> {
		try {
			await Deno.stat(this.resolveFilePath(key));
			return true;
		} catch {
			return false;
		}
	}

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
	async getSignedUrl(
		key: string,
		_expiresIn?: number,
		_transformation?: TransformationOptions,
	): Promise<string> {
		return Promise.resolve(this.resolveUrl(key));
	}

	/**
	 * Return a plain URL for the file (no transformation is applied).
	 *
	 * The local filesystem provider cannot perform on-the-fly image
	 * transformations.  The `transformation` parameter is accepted for
	 * interface compatibility but ignored.
	 *
	 * @param key  Relative storage key.
	 */
	getTransformedUrl(
		key: string,
		_transformation: TransformationOptions,
	): string {
		return this.resolveUrl(key);
	}

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
	getSignedUploadUrl(
		_options: SignedUploadOptions,
	): Promise<SignedUploadResult> {
		throw new Error(
			'LocalStorageProvider does not support client-side direct upload. ' +
				'Switch STORAGE_PROVIDER to "cloudinary", "imagekit", or "s3" to use getSignedUploadUrl().',
		);
	}
}
