/* @ts-self-types="./mod.d.ts" */
import { createLogger } from "../../utils/logger.js";
import { LocalStorageProvider } from "./providers/local.js";
import { CloudinaryStorageProvider } from "./providers/cloudinary.js";
import { ImageKitStorageProvider } from "./providers/imagekit.js";
import { S3StorageProvider } from "./providers/s3.js";
const log = createLogger('Codexa:Storage');
export function resolveStorageAdapter(config) {
    switch (config.provider) {
        case 'local': {
            const localCfg = config.local ?? { dir: './uploads' };
            log.info(`Storage adapter: local (${localCfg.dir})`);
            return new LocalStorageProvider(localCfg);
        }
        case 'cloudinary': {
            if (!config.cloudinary) {
                throw new Error('Storage: cloudinary provider selected but config.cloudinary is missing. ' +
                    'Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set.');
            }
            log.info(`Storage adapter: cloudinary (${config.cloudinary.cloudName})`);
            return new CloudinaryStorageProvider(config.cloudinary);
        }
        case 'imagekit': {
            if (!config.imagekit) {
                throw new Error('Storage: imagekit provider selected but config.imagekit is missing. ' +
                    'Ensure IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT are set.');
            }
            log.info(`Storage adapter: imagekit (${config.imagekit.urlEndpoint})`);
            return new ImageKitStorageProvider(config.imagekit);
        }
        case 's3': {
            if (!config.s3) {
                throw new Error('Storage: s3 provider selected but config.s3 is missing. ' +
                    'Ensure S3_BUCKET, S3_REGION, S3_ACCESS_KEY, and S3_SECRET_KEY are set.');
            }
            log.info(`Storage adapter: s3 (${config.s3.bucket} / ${config.s3.region}${config.s3.endpoint ? ` @ ${config.s3.endpoint}` : ''})`);
            return new S3StorageProvider(config.s3);
        }
        default: {
            log.warn(`Storage: unknown provider "${config.provider}", falling back to local`);
            return new LocalStorageProvider({ dir: './uploads' });
        }
    }
}
export class StorageManager {
    _config;
    _provider;
    constructor(config, provider) {
        this._config = config;
        this._provider = provider;
    }
    async upload(file, options) {
        log.debug('Uploading file(s)', {
            provider: this._config.provider,
            count: Array.isArray(file) ? file.length : 1,
            folder: Array.isArray(options)
                ? options[0]?.folder
                : options?.folder,
            assetType: Array.isArray(options)
                ? options[0]?.assetType
                : options?.assetType,
        });
        return await this._provider.upload(file, options);
    }
    async delete(key) {
        log.debug('Deleting file', { key, provider: this._config.provider });
        await this._provider.delete(key);
    }
    async exists(key) {
        if (!this._provider.exists)
            return undefined;
        return await this._provider.exists(key);
    }
    async getSignedUrl(key, expiresIn, transformation) {
        if (!this._provider.getSignedUrl)
            return undefined;
        return await this._provider.getSignedUrl(key, expiresIn, transformation);
    }
    getTransformedUrl(key, transformation) {
        if (!this._provider.getTransformedUrl)
            return undefined;
        return this._provider.getTransformedUrl(key, transformation);
    }
    async getSignedUploadUrl(options) {
        if (!this._provider.getSignedUploadUrl)
            return undefined;
        log.debug('Generating signed upload URL', {
            provider: this._config.provider,
            folder: options.folder,
            assetType: options.assetType,
        });
        return await this._provider.getSignedUploadUrl(options);
    }
    get providerType() {
        return this._config.provider;
    }
    get config() {
        return this._config;
    }
    get adapter() {
        return this._provider;
    }
}
export function createStorageManager(config, adapter) {
    const provider = adapter ?? resolveStorageAdapter(config);
    return new StorageManager(config, provider);
}
class StorageRegistryImpl {
    #managers = new Map();
    register(name, config, adapter) {
        const normalizedName = normalizeStorageName(name);
        if (this.#managers.has(normalizedName)) {
            throw new Error(`Storage manager "${normalizedName}" is already registered.`);
        }
        const manager = createStorageManager(config, adapter);
        this.#managers.set(normalizedName, manager);
        return manager;
    }
    get(name) {
        const normalizedName = normalizeStorageName(name);
        const manager = this.#managers.get(normalizedName);
        if (!manager) {
            throw new Error(`Storage manager "${normalizedName}" is not registered.`);
        }
        return manager;
    }
    has(name) {
        return this.#managers.has(normalizeStorageName(name));
    }
    names() {
        return Object.freeze([...this.#managers.keys()]);
    }
    remove(name) {
        const normalizedName = normalizeStorageName(name);
        const manager = this.#managers.get(normalizedName);
        this.#managers.delete(normalizedName);
        return manager;
    }
    clear() {
        this.#managers.clear();
    }
}
function normalizeStorageName(name) {
    const normalizedName = name.trim();
    if (!normalizedName) {
        throw new Error('Storage manager name cannot be empty.');
    }
    return normalizedName;
}
export function createStorageRegistry() {
    return new StorageRegistryImpl();
}
export { LocalStorageProvider } from "./providers/local.js";
export { CloudinaryStorageProvider } from "./providers/cloudinary.js";
export { ImageKitStorageProvider } from "./providers/imagekit.js";
export { S3StorageProvider } from "./providers/s3.js";
