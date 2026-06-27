/**
 * Shared type definitions for @codexa/core.
 *
 * These types are imported by internal modules. They are NOT re-exported
 * as a separate subpath - consumers get them via the module that uses them
 * (e.g. `import type { Logger } from '@codexa/core/logger'`).
 */

// Logger
export type LogLevelT = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogFileConfig {
	enabled: boolean;
	dir: string;
	maxSize: number;
	maxFiles: number;
}

export interface Logger {
	debug(msg: string, ...args: unknown[]): void;
	info(msg: string, ...args: unknown[]): void;
	warn(msg: string, ...args: unknown[]): void;
	error(msg: string, ...args: unknown[]): void;
	fatal(msg: string, ...args: unknown[]): void;
	child(subModule: string): Logger;
}

export interface LogEntry {
	timestamp: string;
	level: LogLevelT;
	module: string;
	message: string;
	data?: unknown;
}

// Device / Platform / OS
export type DeviceType =
	| 'desktop'
	| 'mobile'
	| 'tablet'
	| 'tv'
	| 'iot'
	| 'cli'
	| 'unknown';
export type DevicePlatform =
	| 'web'
	| 'ios'
	| 'android'
	| 'macos'
	| 'windows'
	| 'linux'
	| 'api';
export type OS =
	| 'windows'
	| 'macos'
	| 'linux'
	| 'ios'
	| 'android'
	| 'chromeos'
	| 'unknown';

export interface DeviceInfo {
	browser: string;
	os: string;
	device: string;
	deviceVendor: string;
	deviceModel: string;
	engine: string;
	raw: string;
}

// Hash / Crypto
export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

// Event Bus
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export interface HandlerEntry {
	channel: string;
	event: string;
	originalHandler: EventHandler;
	wrappedHandler: EventListener;
	isOnce: boolean;
}

export type HandlerOptions = {
	signal?: AbortSignal;
};

export interface IEventBus {
	initialize(opts: {
		// deno-lint-ignore no-explicit-any
		redisClient?: any;
		subscribeChannels?: string[];
	}): Promise<void>;
	on<T = unknown>(
		channel: string,
		event: string,
		handler: EventHandler<T>,
	): void;
	once<T = unknown>(
		channel: string,
		event: string,
		handler: EventHandler<T>,
	): void;
	off(
		channel?: string,
		event?: string,
		specificHandler?: EventHandler,
	): void;
	emit<T = unknown>(
		channel: string,
		event: string,
		data: T,
		options?: { distributed?: boolean },
	): void;
	subscribeRedis(channel: string): Promise<void>;
	listActiveEvents(): string[];
	destroy(): Promise<void>;
}

// Store
export type StoreMode = 'redis' | 'kv' | 'memory';
export type StoreType = StoreMode;

export interface StoreSetOptions {
	/** TTL in seconds */
	ttl?: number;
	/** Alias for ttl (Redis EX) */
	ex?: number;
}

export interface StoreConfig {
	mode?: StoreType;
	fallbackToMemory?: boolean;
	// deno-lint-ignore no-explicit-any
	redisClient?: any;
	kvPath?: string;
	kvPrefix?: string;
}

export interface IStore {
	set(
		key: string,
		value: unknown,
		options?: StoreSetOptions,
	): Promise<string>;
	get<T = unknown>(key: string): Promise<T | null>;
	del(...keys: string[]): Promise<number>;
	exists(...keys: string[]): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
	ttl(key: string): Promise<number>;
	incr(key: string): Promise<number>;
	decr(key: string): Promise<number>;
	incrby(key: string, amount: number): Promise<number>;
	decrby(key: string, amount: number): Promise<number>;
	keys(pattern: string): Promise<string[]>;
	flushdb(): Promise<string>;
	quit(): Promise<string>;
}

export interface StoreStats {
	type: StoreType;
	keyCount?: number;
	uptimeMs: number;
	backend: string;
}

// Storage
export type StorageProviderType = 's3' | 'cloudinary' | 'imagekit' | 'local';
export type AssetType = 'image' | 'video' | 'document' | 'raw';

export interface StorageConfig {
	provider: StorageProviderType;
	s3?: {
		bucket: string;
		region: string;
		accessKey: string;
		secretKey: string;
		/** Custom endpoint for S3-compatible services (MinIO, R2, etc.). */
		endpoint?: string;
		/** CDN base URL prepended to the object key in UploadResult.url. */
		cdnBaseUrl?: string;
	};
	cloudinary?: {
		cloudName: string;
		apiKey: string;
		apiSecret: string;
	};
	imagekit?: {
		publicKey: string;
		privateKey: string;
		urlEndpoint: string;
	};
	local?: {
		dir: string;
		baseUrl?: string;
	};
}

// Transformation
export interface TransformationOptions {
	width?: number | `${number}%`;
	height?: number | `${number}%`;
	crop?: 'scale' | 'fill' | 'fit' | 'crop' | 'pad' | 'limit' | string;
	format?:
		| 'webp'
		| 'avif'
		| 'jpeg'
		| 'png'
		| 'mp4'
		| 'webm'
		| 'mov'
		| 'jpg'
		| 'gif'
		| 'svg'
		| 'auto'
		| string;
	quality?: number | 'auto';

	// Escape hatches for provider-specific options
	cloudinaryOpts?:
		| Record<string, unknown>
		| Array<Record<string, unknown>>;
	imagekitOpts?:
		| Record<string, unknown>
		| Array<Record<string, unknown>>;
}

export interface UploadOptions {
	folder?: string;
	fileName?: string;
	overwrite?: boolean;
	contentType?: string;
	assetType?: AssetType;
	/** If false, the file is stored as private/authenticated. Default: true. */
	isPublic?: boolean;
	/** Provider-specific stable identifier (Cloudinary public_id, etc.). */
	customId?: string;
	tags?: readonly string[];
	tenantId?: string;
	metadata?: Record<string, string>;
	/** Transformations to apply immediately after the client's upload lands. */
	eagerTransformations?: TransformationOptions[];
}

export interface UploadResult {
	key: string;
	size: number;
	contentType: string;
	url: string;
	assetType: AssetType;
	/** Provider's stable public identifier (Cloudinary public_id / ImageKit fileId). */
	publicId?: string;
	format?: string;
	width?: number;
	height?: number;
	/** Duration in seconds (video assets). */
	duration?: number;
	/** Bit-rate in bits/second (video assets). */
	bitrate?: number;
	frameRate?: number;
	thumbnailUrl?: string;
}

// Signed / direct-upload (client-side)
export interface SignedUploadOptions {
	/** Target folder / prefix inside the bucket or cloud. */
	folder?: string;
	/** Desired file name (without extension). Providers may override it. */
	fileName?: string;
	/** MIME type of the file the client wants to upload. */
	contentType: string;
	assetType?: AssetType;
	/** How long (seconds) the upload credential should remain valid. Default: 3600. */
	expiresIn?: number;
	/** Provider-specific stable identifier (Cloudinary public_id, etc.). */
	customId?: string;
	tags?: readonly string[];
	overwrite?: boolean;
	metadata?: Record<string, string>;
	/** Transformations to apply immediately after the client's upload lands. */
	eagerTransformations?: TransformationOptions[];
}

/**
 * Credentials returned by the server so the browser / mobile client can upload
 * directly to the storage provider - no file bytes ever pass through your API.
 *
 * The shape varies by provider:
 * - **S3 / R2 / MinIO** - a single `uploadUrl` (presigned PUT).
 * - **Cloudinary** - `uploadUrl` + `fields` map of form params to include.
 * - **ImageKit** - `uploadUrl` + `fields` map (token, expire, signature, …).
 * - **Local** - not supported; `getSignedUploadUrl` throws.
 */
export interface SignedUploadResult {
	/**
	 * The URL the client should HTTP POST (multipart) or PUT (S3) to.
	 * Always present.
	 */
	uploadUrl: string;
	/**
	 * HTTP method the client must use.
	 * - `"PUT"`  - S3 presigned PUT.
	 * - `"POST"` - Cloudinary / ImageKit multipart form POST.
	 */
	method: 'PUT' | 'POST';
	/**
	 * Additional form fields the client must include in the multipart body
	 * (Cloudinary, ImageKit).  Omitted for S3 presigned PUT.
	 */
	fields?: Record<string, string>;
	/**
	 * The key / public_id / filePath the uploaded file will receive.
	 * Needed to call `getSignedUrl` or `getTransformedUrl` after upload.
	 */
	key: string;
	/** Unix timestamp (seconds) when these credentials expire. */
	expiresAt: number;
	/**
	 * Public URL where the asset will be accessible after the client upload
	 * completes (only available when `isPublic !== false`).
	 */
	publicUrl?: string;
}

export interface StorageProvider {
	upload(
		file:
			| Uint8Array
			| ReadableStream<Uint8Array>
			| Array<Uint8Array | ReadableStream<Uint8Array>>,
		options?: UploadOptions | UploadOptions[],
	): Promise<UploadResult | UploadResult[]>;

	delete(key: string): Promise<void>;

	exists?(key: string): Promise<boolean>;

	/**
	 * Generate a time-limited **delivery** URL (reading an existing asset).
	 *
	 * @param key            Storage key / public_id / fileId.
	 * @param expiresIn      Seconds until expiry (default 3600).
	 * @param transformation Optional on-the-fly transforms baked into the URL.
	 */
	getSignedUrl?(
		key: string,
		expiresIn?: number,
		transformation?: TransformationOptions,
	): Promise<string>;

	getTransformedUrl?(
		key: string,
		transformations: TransformationOptions,
	): string;

	/**
	 * Generate credentials so the **client** can upload directly to the
	 * storage provider - no file bytes pass through your server.
	 *
	 * Call this from a lightweight server endpoint (e.g. `POST /upload-token`)
	 * that validates the user session, then return the result as JSON.  The
	 * browser / mobile app uses `result.uploadUrl`, `result.method`, and
	 * `result.fields` to push the file straight to the provider.
	 *
	 * @param options Metadata about the file the client intends to upload.
	 */
	getSignedUploadUrl?(
		options: SignedUploadOptions,
	): Promise<SignedUploadResult>;
}

// Native HTTP response payloads
export interface ResponseMeta {
	timestamp: string;
	path?: string;
	requestId?: string;
	[key: string]: unknown;
}

export interface ApiResponse<T = unknown> {
	success: boolean;
	message?: string;
	data?: T;
	error?: string;
	errors?: unknown;
	meta?: ResponseMeta;
}

export interface PaginationMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
	hasNext: boolean;
	hasPrev: boolean;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
	pagination: PaginationMeta;
}

// Native request/response metrics
export interface RequestMetrics {
	timestamp: string;
	duration: number;
	method: string;
	path: string;
	status: number;
	requestId: string;
	ip: string;
	contentLength: number;
}
