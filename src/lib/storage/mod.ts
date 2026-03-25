/**
 * @module @codexa/core/storage
 *
 * Storage adapters for Codexa applications.
 *
 * Provides a unified `StorageManager` interface over pluggable backends:
 * local filesystem, AWS S3 (and S3-compatible), Cloudinary, and ImageKit.
 *
 * > [!NOTE]
 * > Concrete adapter implementations (S3, Cloudinary, ImageKit, Local) are
 * > **not yet implemented**. The `StorageManager` class and
 * > `createStorageManager()` factory are exported as stubs — implement
 * > `StorageProvider` in your own code or contribute an adapter.
 *
 * @example
 * ```ts
 * import { createStorageManager } from '@codexa/core/storage';
 * import { buildStorageConfig } from '@codexa/core/config';
 *
 * const config = buildStorageConfig(Deno.env.toObject());
 * const storage = createStorageManager(config);
 *
 * // Upload a file
 * const result = await storage.upload(fileBytes, { folder: 'avatars' });
 * console.log(result.url);
 * ```
 */

import { createLogger } from '../../utils/logger.ts';
import type {
	StorageConfig,
	StorageProvider,
	UploadOptions,
	UploadResult,
} from '../../types/app.d.ts';

const log = createLogger('Storage');

/**
 * High-level storage manager wrapping a {@link StorageProvider}.
 *
 * @todo Implement concrete adapters for S3, Cloudinary, ImageKit, and Local.
 */
export class StorageManager {
	constructor(
		protected readonly config: StorageConfig,
		protected provider: StorageProvider | null = null,
	) {}

	/**
	 * Upload a file using the configured provider.
	 * @throws {Error} When no concrete adapter has been registered.
	 */
	async upload(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult> {
		if (!this.provider) {
			throw new Error(
				`StorageManager: No adapter implemented for provider "${this.config.provider}". ` +
					'Implement a StorageProvider and pass it to createStorageManager().',
			);
		}
		log.debug(`Uploading file`, {
			provider: this.config.provider,
			folder: options?.folder,
		});
		return await this.provider.upload(file, options);
	}

	/** Delete a file by its storage key. */
	async delete(key: string): Promise<void> {
		if (!this.provider) {
			throw new Error(
				`StorageManager: No adapter implemented for provider "${this.config.provider}".`,
			);
		}
		await this.provider.delete(key);
	}

	/** Check whether a file exists. Returns `undefined` if the provider does not support it. */
	async exists(key: string): Promise<boolean | undefined> {
		if (!this.provider?.exists) return undefined;
		return await this.provider.exists(key);
	}

	/** Get a pre-signed URL for private object access (if supported). */
	async getSignedUrl(
		key: string,
		expiresIn?: number,
	): Promise<string | undefined> {
		if (!this.provider?.getSignedUrl) return undefined;
		return await this.provider.getSignedUrl(key, expiresIn);
	}

	/** The resolved provider configuration. */
	get providerConfig(): StorageConfig {
		return this.config;
	}
}

/**
 * Create a {@link StorageManager} for the given config.
 *
 * Optionally inject a concrete `StorageProvider` adapter. When omitted,
 * document all calls will throw until an adapter is provided.
 *
 * @example
 * ```ts
 * import { buildStorageConfig } from '@codexa/core/config';
 * import { createStorageManager } from '@codexa/core/storage';
 *
 * const cfg = buildStorageConfig(Deno.env.toObject());
 * const storage = createStorageManager(cfg, myS3Adapter);
 * ```
 */
export function createStorageManager(
	config: StorageConfig,
	adapter?: StorageProvider,
): StorageManager {
	return new StorageManager(config, adapter ?? null);
}

// Re-export types for convenience
export type {
	StorageConfig,
	StorageProvider,
	UploadOptions,
	UploadResult,
} from '../../types/app.d.ts';
