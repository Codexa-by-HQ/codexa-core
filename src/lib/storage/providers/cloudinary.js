/* @ts-self-types="./cloudinary.d.ts" */
import { createLogger } from "../../../utils/logger.js";
import { generateId } from "../../../utils/crypto.js";
import { hmacSha1, sha1 } from "../../../utils/hash.js";
import { toBytes } from "../helpers.js";
const log = createLogger('Codexa:Storage:Cloudinary');
export class CloudinaryStorageProvider {
    cloudName;
    apiKey;
    apiSecret;
    constructor(config) {
        this.cloudName = config.cloudName;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
    }
    uploadUrl(resourceType) {
        return `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`;
    }
    resolveResourceType(assetType) {
        if (assetType === 'video')
            return 'video';
        if (assetType === 'image')
            return 'image';
        return 'raw';
    }
    buildTransformString(t) {
        if (t.cloudinaryOpts) {
            const opts = Array.isArray(t.cloudinaryOpts)
                ? t.cloudinaryOpts
                : [t.cloudinaryOpts];
            return opts
                .map((o) => Object.entries(o).map(([k, v]) => `${k}_${v}`).join(','))
                .join('/');
        }
        const parts = [];
        if (t.width)
            parts.push(`w_${t.width}`);
        if (t.height)
            parts.push(`h_${t.height}`);
        if (t.crop)
            parts.push(`c_${t.crop}`);
        if (t.format && t.format !== 'auto')
            parts.push(`f_${t.format}`);
        if (t.quality)
            parts.push(`q_${t.quality}`);
        return parts.join(',');
    }
    async buildSignature(params) {
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
    mapResponse(json, options) {
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
    async uploadOne(file, options) {
        const data = await toBytes(file);
        const resourceType = this.resolveResourceType(options?.assetType);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const publicId = options?.customId ??
            options?.fileName?.replace(/\.[^.]+$/, '') ??
            generateId();
        const sigParams = {
            timestamp,
            public_id: publicId,
        };
        if (options?.folder)
            sigParams['folder'] = options.folder;
        if (options?.tags?.length)
            sigParams['tags'] = options.tags.join(',');
        if (options?.overwrite)
            sigParams['overwrite'] = 'true';
        if (options?.eagerTransformations?.length) {
            sigParams['eager'] = options.eagerTransformations
                .map((t) => this.buildTransformString(t))
                .join('|');
        }
        const signature = await this.buildSignature(sigParams);
        const form = new FormData();
        form.append('file', new Blob([data], {
            type: options?.contentType ?? 'application/octet-stream',
        }));
        form.append('api_key', this.apiKey);
        form.append('timestamp', timestamp);
        form.append('signature', signature);
        form.append('public_id', publicId);
        if (options?.folder)
            form.append('folder', options.folder);
        if (options?.tags?.length)
            form.append('tags', options.tags.join(','));
        if (options?.overwrite)
            form.append('overwrite', 'true');
        if (sigParams['eager'])
            form.append('eager', sigParams['eager']);
        const res = await fetch(this.uploadUrl(resourceType), {
            method: 'POST',
            body: form,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Cloudinary upload failed (${res.status}): ${text}`);
        }
        const json = (await res.json());
        log.info(`Uploaded: ${json.public_id} (${json.bytes} bytes)`);
        return this.mapResponse(json, options);
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
        const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`, { method: 'POST', body: form });
        if (!res.ok) {
            throw new Error(`Cloudinary delete failed (${res.status})`);
        }
        log.info(`Deleted: ${key}`);
    }
    async exists(key) {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/resources/image/upload/${key}`, {
            headers: {
                Authorization: `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`,
            },
        });
        return res.status === 200;
    }
    async getSignedUrl(key, expiresIn = 3600, transformation) {
        const expiry = Math.floor(Date.now() / 1000) + expiresIn;
        const transforms = transformation
            ? `/${this.buildTransformString(transformation)}`
            : '';
        const toSign = `${transforms ? transforms + '/' : ''}${key}${expiry}${this.apiSecret}`;
        const sig = (await sha1(toSign)).slice(0, 8);
        const baseUrl = `https://res.cloudinary.com/${this.cloudName}/image/upload`;
        return `${baseUrl}${transforms}/s--${sig}--/e_${expiry}/${key}`;
    }
    getTransformedUrl(key, transformation) {
        const transforms = this.buildTransformString(transformation);
        const fAuto = transformation.format === 'auto' ? 'f_auto/' : '';
        return `https://res.cloudinary.com/${this.cloudName}/image/upload/${fAuto}${transforms}/${key}`;
    }
    async getSignedUploadUrl(options) {
        const expiresIn = options.expiresIn ?? 3600;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        const resourceType = this.resolveResourceType(options.assetType);
        const publicId = options.customId ??
            (options.fileName
                ? options.fileName.replace(/\.[^.]+$/, '')
                : generateId());
        const sigParams = {
            timestamp,
            public_id: publicId,
        };
        if (options.folder)
            sigParams['folder'] = options.folder;
        if (options.tags?.length)
            sigParams['tags'] = options.tags.join(',');
        if (options.overwrite)
            sigParams['overwrite'] = 'true';
        if (options.eagerTransformations?.length) {
            sigParams['eager'] = options.eagerTransformations
                .map((t) => this.buildTransformString(t))
                .join('|');
        }
        const signature = await this.buildSignature(sigParams);
        const fields = {
            api_key: this.apiKey,
            timestamp,
            signature,
            public_id: publicId,
        };
        if (options.folder)
            fields['folder'] = options.folder;
        if (options.tags?.length)
            fields['tags'] = options.tags.join(',');
        if (options.overwrite)
            fields['overwrite'] = 'true';
        if (sigParams['eager'])
            fields['eager'] = sigParams['eager'];
        const key = options.folder ? `${options.folder}/${publicId}` : publicId;
        const publicUrl = `https://res.cloudinary.com/${this.cloudName}/${resourceType}/upload/${key}`;
        log.info(`Generated signed upload token for: ${key} (expires in ${expiresIn}s)`);
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
export { hmacSha1 };
