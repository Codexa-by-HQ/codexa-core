export declare function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>>;
export declare function toBytes(file: Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>>;
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
export declare function awsUriEncode(str: string, encodeSlash?: boolean): string;
/**
 * Format a `Date` as `YYYYMMDDTHHmmssZ` - the ISO-8601 basic format
 * required in the `X-Amz-Date` header / query parameter.
 */
export declare function formatAmzDate(d: Date): string;
/**
 * Format a `Date` as `YYYYMMDD` - the date-only stamp used in the credential
 * scope and signing key derivation chain.
 */
export declare function formatDateStamp(d: Date): string;
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
export declare function deriveSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<Uint8Array>;
