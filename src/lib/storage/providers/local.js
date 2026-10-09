/* @ts-self-types="./local.d.ts" */
import * as path from "../../../providers/path.js";
import { createLogger } from "../../../utils/logger.js";
import { generateId } from "../../../utils/crypto.js";
import { toBytes } from "../helpers.js";
const log = createLogger('Codexa:Storage:Local');
export class LocalStorageProvider {
    dir;
    baseUrl;
    constructor(config) {
        this.dir = config.dir ?? './uploads';
        this.baseUrl = config.baseUrl ?? '';
    }
    async ensureDir(dirPath) {
        try {
            await Deno.mkdir(dirPath, { recursive: true });
        }
        catch {
        }
    }
    resolveFilePath(key) {
        return path.join(this.dir, key);
    }
    resolveUrl(key) {
        return this.baseUrl ? `${this.baseUrl}/${key}` : key;
    }
    async uploadOne(file, options) {
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
    async upload(file, options) {
        if (Array.isArray(file)) {
            const results = await Promise.all(file.map((f, i) => {
                const opt = Array.isArray(options)
                    ? (options[i] ?? options[options.length - 1])
                    : options;
                return this.uploadOne(f, opt);
            }));
            return results;
        }
        return this.uploadOne(file, Array.isArray(options) ? options[0] : options);
    }
    async delete(key) {
        try {
            await Deno.remove(this.resolveFilePath(key));
            log.info(`Deleted: ${key}`);
        }
        catch (err) {
            if (!(err instanceof Deno.errors.NotFound))
                throw err;
            log.warn(`Not found for deletion: ${key}`);
        }
    }
    async exists(key) {
        try {
            await Deno.stat(this.resolveFilePath(key));
            return true;
        }
        catch {
            return false;
        }
    }
    async getSignedUrl(key, _expiresIn, _transformation) {
        return Promise.resolve(this.resolveUrl(key));
    }
    getTransformedUrl(key, _transformation) {
        return this.resolveUrl(key);
    }
    getSignedUploadUrl(_options) {
        throw new Error('LocalStorageProvider does not support client-side direct upload. ' +
            'Switch STORAGE_PROVIDER to "cloudinary", "imagekit", or "s3" to use getSignedUploadUrl().');
    }
}
