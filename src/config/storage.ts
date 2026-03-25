import { createLogger } from '../utils/logger.ts';
import type { StorageConfig, StorageProviderType } from '../types/app.d.ts';

const log = createLogger('Storage:Config');

/**
 * Build a {@link StorageConfig} from a plain environment-variable map.
 *
 * Pass `Deno.env.toObject()` (or your own config object) — the function
 * reads the well-known storage keys and returns a typed `StorageConfig`.
 *
 * @example
 * ```ts
 * import { buildStorageConfig } from '@codexa/core/config';
 *
 * const cfg = buildStorageConfig(Deno.env.toObject());
 *
 * if (cfg.provider === 's3') {
 *   // cfg.s3 is guaranteed to be populated
 * }
 * ```
 */
export function buildStorageConfig(
	rawEnv: Record<string, string | undefined>,
): StorageConfig {
	const provider = (rawEnv['STORAGE_PROVIDER'] ?? 'local') as StorageProviderType;
	const config: StorageConfig = { provider };

	switch (provider) {
		case 's3': {
			const bucket = rawEnv['S3_BUCKET'];
			const region = rawEnv['S3_REGION'];
			const accessKey = rawEnv['S3_ACCESS_KEY'];
			const secretKey = rawEnv['S3_SECRET_KEY'];

			if (!bucket || !region || !accessKey || !secretKey) {
				throw new Error(
					'Storage: S3 provider requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY, and S3_SECRET_KEY',
				);
			}

			config.s3 = {
				bucket,
				region,
				accessKey,
				secretKey,
				endpoint: rawEnv['S3_ENDPOINT'],
				cdnBaseUrl: rawEnv['S3_CDN_BASE_URL'],
			};

			log.info('Storage: S3 provider configured', {
				bucket,
				region,
				endpoint: config.s3.endpoint ?? '(default AWS)',
			});
			break;
		}

		case 'cloudinary': {
			const cloudName = rawEnv['CLOUDINARY_CLOUD_NAME'];
			const apiKey = rawEnv['CLOUDINARY_API_KEY'];
			const apiSecret = rawEnv['CLOUDINARY_API_SECRET'];

			if (!cloudName || !apiKey || !apiSecret) {
				throw new Error(
					'Storage: Cloudinary provider requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET',
				);
			}

			config.cloudinary = { cloudName, apiKey, apiSecret };
			log.info('Storage: Cloudinary provider configured', { cloudName });
			break;
		}

		case 'imagekit': {
			const publicKey = rawEnv['IMAGEKIT_PUBLIC_KEY'];
			const privateKey = rawEnv['IMAGEKIT_PRIVATE_KEY'];
			const urlEndpoint = rawEnv['IMAGEKIT_URL_ENDPOINT'];

			if (!publicKey || !privateKey || !urlEndpoint) {
				throw new Error(
					'Storage: ImageKit provider requires IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT',
				);
			}

			config.imagekit = { publicKey, privateKey, urlEndpoint };
			log.info('Storage: ImageKit provider configured', { urlEndpoint });
			break;
		}

		case 'local':
		default: {
			const dir = rawEnv['LOCAL_STORAGE_DIR'] ?? './uploads';
			const baseUrl = rawEnv['LOCAL_BASE_URL'];
			config.local = { dir, baseUrl };
			log.info('Storage: Local provider configured', { dir, baseUrl });
			break;
		}
	}

	return config;
}
