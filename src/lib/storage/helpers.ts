import { hmacRaw } from '../../utils/hash.ts';

// Helpers
export async function readStream(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	const totalLength = chunks.reduce((s, c) => s + c.length, 0);
	const data = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.length;
	}
	return data;
}

export async function toBytes(
	file: Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
	if (file instanceof Uint8Array) {
		return new Uint8Array(file) as Uint8Array<ArrayBuffer>;
	}
	return await readStream(file);
}

// AWS Signature V4 helpers
/**
 * Percent-encode a string for use in AWS canonical URIs and query strings.
 *
 * Leaves RFC 3986 unreserved characters (`A-Z a-z 0-9 - _ . ~`) untouched.
 * Forward slashes are only encoded when `encodeSlash` is `true` (the default),
 * which is correct for query-string values.  Pass `false` when encoding a URI
 * path so that path segments remain separated by literal `/`.
 *
 * @param str          The raw string to encode.
 * @param encodeSlash  Whether to encode `/` characters (default: `true`).
 */
export function awsUriEncode(str: string, encodeSlash = true): string {
	return str
		.split('')
		.map((c) => {
			if (/[A-Za-z0-9\-_.~]/.test(c)) return c;
			if (c === '/' && !encodeSlash) return '/';
			return `%${
				c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
			}`;
		})
		.join('');
}

/**
 * Format a `Date` as `YYYYMMDDTHHmmssZ` - the ISO-8601 basic format
 * required in the `X-Amz-Date` header / query parameter.
 */
export function formatAmzDate(d: Date): string {
	return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

/**
 * Format a `Date` as `YYYYMMDD` - the date-only stamp used in the credential
 * scope and signing key derivation chain.
 */
export function formatDateStamp(d: Date): string {
	return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Derive the AWS Signature V4 signing key for a given date, region, and
 * service name.
 *
 * The derivation chain is:
 * ```
 * kDate    = HMAC-SHA256("AWS4" + secretKey,  dateStamp)
 * kRegion  = HMAC-SHA256(kDate,               region)
 * kService = HMAC-SHA256(kRegion,             service)
 * kSigning = HMAC-SHA256(kService,            "aws4_request")
 * ```
 *
 * `hmacRaw` from `hash.ts` is used at every step because the intermediate
 * values are raw bytes that feed directly into the next round - not hex
 * strings.
 *
 * @param secretKey  AWS secret access key (plain string).
 * @param dateStamp  Eight-digit date string (`YYYYMMDD`).
 * @param region     AWS region (e.g. `"us-east-1"`).
 * @param service    AWS service identifier (e.g. `"s3"`).
 * @returns          Raw signing key as a `Uint8Array`.
 */
export async function deriveSigningKey(
	secretKey: string,
	dateStamp: string,
	region: string,
	service: string,
): Promise<Uint8Array> {
	const kDate = await hmacRaw(`AWS4${secretKey}`, dateStamp);
	const kRegion = await hmacRaw(kDate, region);
	const kService = await hmacRaw(kRegion, service);
	return hmacRaw(kService, 'aws4_request');
}
