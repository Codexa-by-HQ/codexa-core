/* @ts-self-types="./storage.d.ts" */
import { createLogger } from "../utils/logger.js";
const log = createLogger('Codexa:Storage:Config');
export function buildStorageConfig(env) {
    switch (env.STORAGE_PROVIDER) {
        case 's3': {
            const config = {
                provider: 's3',
                s3: {
                    bucket: env.S3_BUCKET,
                    region: env.S3_REGION,
                    accessKey: env.S3_ACCESS_KEY,
                    secretKey: env.S3_SECRET_KEY,
                    endpoint: env.S3_ENDPOINT,
                    cdnBaseUrl: env.S3_CDN_BASE_URL,
                },
            };
            log.info('Storage: S3 provider configured', {
                bucket: env.S3_BUCKET,
                region: env.S3_REGION,
                endpoint: env.S3_ENDPOINT ?? '(default AWS)',
            });
            return config;
        }
        case 'cloudinary': {
            const config = {
                provider: 'cloudinary',
                cloudinary: {
                    cloudName: env.CLOUDINARY_CLOUD_NAME,
                    apiKey: env.CLOUDINARY_API_KEY,
                    apiSecret: env.CLOUDINARY_API_SECRET,
                },
            };
            log.info('Storage: Cloudinary provider configured', {
                cloudName: env.CLOUDINARY_CLOUD_NAME,
            });
            return config;
        }
        case 'imagekit': {
            const config = {
                provider: 'imagekit',
                imagekit: {
                    publicKey: env.IMAGEKIT_PUBLIC_KEY,
                    privateKey: env.IMAGEKIT_PRIVATE_KEY,
                    urlEndpoint: env.IMAGEKIT_URL_ENDPOINT.replace(/\/$/, ''),
                },
            };
            log.info('Storage: ImageKit provider configured', {
                urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
            });
            return config;
        }
        case 'local': {
            const dir = env.LOCAL_STORAGE_DIR ?? './uploads';
            const config = {
                provider: 'local',
                local: {
                    dir,
                    baseUrl: env.LOCAL_BASE_URL,
                },
            };
            log.info('Storage: Local provider configured', {
                dir,
                baseUrl: env.LOCAL_BASE_URL ?? '(none)',
            });
            return config;
        }
    }
}
