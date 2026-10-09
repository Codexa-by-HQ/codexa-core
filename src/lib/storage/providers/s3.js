/* @ts-self-types="./s3.d.ts" */
import { createLogger } from "../../../utils/logger.js";
import { generateId } from "../../../utils/crypto.js";
import { bytesToHex, hmacRaw, sha256 } from "../../../utils/hash.js";
import { awsUriEncode, deriveSigningKey, formatAmzDate, formatDateStamp, toBytes, } from "../helpers.js";
const log = createLogger('Codexa:Storage:S3');
async function presignS3Url(opts) {
    const { accessKey, secretKey, region, bucket, endpoint, key, method, expiresIn, } = opts;
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);
    const service = 's3';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const credential = `${accessKey}/${credentialScope}`;
    const host = endpoint
        ? new URL(endpoint).host
        : `${bucket}.s3.${region}.amazonaws.com`;
    const encodedPath = `/${awsUriEncode(key, false)}`;
    const rawQueryParams = {
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
    const canonicalRequest = [
        method,
        encodedPath,
        sortedQuery,
        `host:${host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');
    const hashedCanonical = await sha256(canonicalRequest);
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        hashedCanonical,
    ].join('\n');
    const signingKey = await deriveSigningKey(secretKey, dateStamp, region, service);
    const signature = bytesToHex(await hmacRaw(signingKey, stringToSign));
    const scheme = endpoint ? new URL(endpoint).protocol : 'https:';
    const baseUrl = endpoint
        ? `${endpoint.replace(/\/$/, '')}/${bucket}${encodedPath}`
        : `${scheme}//${host}${encodedPath}`;
    return `${baseUrl}?${sortedQuery}&X-Amz-Signature=${signature}`;
}
export class S3StorageProvider {
    bucket;
    region;
    accessKey;
    secretKey;
    endpoint;
    cdnBaseUrl;
    constructor(config) {
        this.bucket = config.bucket;
        this.region = config.region;
        this.accessKey = config.accessKey;
        this.secretKey = config.secretKey;
        this.endpoint = config.endpoint;
        this.cdnBaseUrl = config.cdnBaseUrl;
    }
    objectUrl(key) {
        if (this.cdnBaseUrl) {
            return `${this.cdnBaseUrl.replace(/\/$/, '')}/${key}`;
        }
        if (this.endpoint) {
            return `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
    resolveKey(options) {
        const ext = options?.contentType
            ? `.${options.contentType.split('/')[1] ?? 'bin'}`
            : '.bin';
        const fileName = options?.fileName ?? `${generateId()}${ext}`;
        return options?.folder ? `${options.folder}/${fileName}` : fileName;
    }
    get presignBase() {
        return {
            accessKey: this.accessKey,
            secretKey: this.secretKey,
            region: this.region,
            bucket: this.bucket,
            endpoint: this.endpoint,
        };
    }
    async uploadOne(file, options) {
        const data = await toBytes(file);
        const key = options?.customId ?? this.resolveKey(options);
        const contentType = options?.contentType ?? 'application/octet-stream';
        const putUrl = await presignS3Url({
            ...this.presignBase,
            key,
            method: 'PUT',
            expiresIn: 900,
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
    async upload(file, options) {
        if (Array.isArray(file)) {
            return Promise.all(file.map((f, i) => {
                const opt = Array.isArray(options)
                    ? (options[i] ?? options[options.length - 1])
                    : options;
                return this.uploadOne(f, opt);
            }));
        }
        return this.uploadOne(file, Array.isArray(options) ? options[0] : options);
    }
    async delete(key) {
        const now = new Date();
        const amzDate = formatAmzDate(now);
        const dateStamp = formatDateStamp(now);
        const service = 's3';
        const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
        const host = this.endpoint
            ? new URL(this.endpoint).host
            : `${this.bucket}.s3.${this.region}.amazonaws.com`;
        const encodedPath = `/${awsUriEncode(key, false)}`;
        const payloadHash = await sha256('');
        const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        const canonicalRequest = [
            'DELETE',
            encodedPath,
            '',
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
        const signingKey = await deriveSigningKey(this.secretKey, dateStamp, this.region, service);
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
    async exists(key) {
        const url = await presignS3Url({
            ...this.presignBase,
            key,
            method: 'GET',
            expiresIn: 60,
        });
        const res = await fetch(url, { method: 'HEAD' });
        return res.status === 200;
    }
    async getSignedUrl(key, expiresIn = 3600, _transformation) {
        return presignS3Url({
            ...this.presignBase,
            key,
            method: 'GET',
            expiresIn,
        });
    }
    getTransformedUrl(key, _transformation) {
        return this.objectUrl(key);
    }
    async getSignedUploadUrl(options) {
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
        log.info(`Generated presigned PUT for: ${key} (expires in ${expiresIn}s)`);
        return {
            uploadUrl,
            method: 'PUT',
            key,
            expiresAt,
            publicUrl,
        };
    }
}
