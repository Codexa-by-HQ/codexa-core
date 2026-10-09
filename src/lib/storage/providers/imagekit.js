/* @ts-self-types="./imagekit.d.ts" */
import { createLogger } from "../../../utils/logger.js";
import { generateId } from "../../../utils/crypto.js";
import { hmacSha1 } from "../../../utils/hash.js";
import { toBytes } from "../helpers.js";
const log = createLogger('Codexa:Storage:ImageKit');
export class ImageKitStorageProvider {
    publicKey;
    privateKey;
    urlEndpoint;
    constructor(config) {
        this.publicKey = config.publicKey;
        this.privateKey = config.privateKey;
        this.urlEndpoint = config.urlEndpoint.replace(/\/$/, '');
    }
    get authHeader() {
        return `Basic ${btoa(`${this.privateKey}:`)}`;
    }
    buildTransformString(t) {
        if (t.imagekitOpts) {
            const opts = Array.isArray(t.imagekitOpts)
                ? t.imagekitOpts
                : [t.imagekitOpts];
            return opts
                .map((o) => Object.entries(o).map(([k, v]) => `${k}-${v}`).join(','))
                .join(':');
        }
        const parts = [];
        if (t.width)
            parts.push(`w-${t.width}`);
        if (t.height)
            parts.push(`h-${t.height}`);
        if (t.crop)
            parts.push(`c-${t.crop}`);
        if (t.format && t.format !== 'auto')
            parts.push(`f-${t.format}`);
        if (t.quality)
            parts.push(`q-${t.quality}`);
        return parts.join(',');
    }
    async uploadOne(file, options) {
        const data = await toBytes(file);
        const contentType = options?.contentType ?? 'application/octet-stream';
        const ext = contentType.split('/')[1] ?? 'bin';
        const fileName = options?.fileName ?? `${generateId()}.${ext}`;
        const form = new FormData();
        form.append('file', new Blob([data], { type: contentType }), fileName);
        form.append('fileName', fileName);
        form.append('publicKey', this.publicKey);
        if (options?.folder)
            form.append('folder', options.folder);
        if (options?.tags?.length)
            form.append('tags', options.tags.join(','));
        if (options?.customId) {
            form.append('customCoordinates', options.customId);
        }
        if (options?.overwrite !== undefined) {
            form.append('overwriteFile', String(options.overwrite));
        }
        if (options?.isPublic === false)
            form.append('isPrivateFile', 'true');
        if (options?.metadata) {
            form.append('customMetadata', JSON.stringify(options.metadata));
        }
        if (options?.eagerTransformations?.length) {
            form.append('transformation', JSON.stringify({
                pre: options.eagerTransformations.map((t) => ({
                    raw: this.buildTransformString(t),
                })),
            }));
        }
        const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
            method: 'POST',
            headers: { Authorization: this.authHeader },
            body: form,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`ImageKit upload failed (${res.status}): ${text}`);
        }
        const json = (await res.json());
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
        const res = await fetch(`https://api.imagekit.io/v1/files/${key}`, {
            method: 'DELETE',
            headers: { Authorization: this.authHeader },
        });
        if (!res.ok && res.status !== 404) {
            throw new Error(`ImageKit delete failed (${res.status})`);
        }
        log.info(`Deleted: ${key}`);
    }
    async exists(key) {
        const res = await fetch(`https://api.imagekit.io/v1/files/${key}/details`, { headers: { Authorization: this.authHeader } });
        return res.status === 200;
    }
    async getSignedUrl(key, expiresIn = 3600, transformation) {
        const expiry = Math.floor(Date.now() / 1000) + expiresIn;
        const transforms = transformation
            ? `/tr:${this.buildTransformString(transformation)}`
            : '';
        const filePath = key.startsWith('/') ? key : `/${key}`;
        const signature = await hmacSha1(this.privateKey, `${transforms}${filePath}${expiry}`);
        return `${this.urlEndpoint}${transforms}${filePath}?ik-t=${expiry}&ik-s=${signature}`;
    }
    getTransformedUrl(key, transformation) {
        const transforms = this.buildTransformString(transformation);
        const filePath = key.startsWith('/') ? key : `/${key}`;
        return `${this.urlEndpoint}/tr:${transforms}${filePath}`;
    }
    async getSignedUploadUrl(options) {
        const expiresIn = options.expiresIn ?? 3600;
        const expire = Math.floor(Date.now() / 1000) + expiresIn;
        const token = generateId();
        const signature = await hmacSha1(this.privateKey, `${token}${expire}`);
        const contentType = options.contentType ?? 'application/octet-stream';
        const ext = contentType.split('/')[1] ?? 'bin';
        const fileName = options.fileName ?? `${generateId()}.${ext}`;
        const folder = options.folder ?? '/';
        const normFolder = folder.startsWith('/') ? folder : `/${folder}`;
        const key = `${normFolder}/${fileName}`.replace(/\/+/g, '/');
        const fields = {
            publicKey: this.publicKey,
            signature,
            expire: String(expire),
            token,
            fileName,
            folder: normFolder,
        };
        if (options.tags?.length)
            fields['tags'] = options.tags.join(',');
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
        log.info(`Generated signed upload token for: ${key} (expires in ${expiresIn}s)`);
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
