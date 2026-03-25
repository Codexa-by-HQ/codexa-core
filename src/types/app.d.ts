import { Empty, SafeProvide } from './global.d.ts';

// ── Logger ────────────────────────────────────────────────────────────────────

/** Union of all valid log level strings. */
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

// ── Device / Platform / OS ────────────────────────────────────────────────────

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv' | 'iot' | 'cli' | 'unknown';
export type DevicePlatform = 'web' | 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'api';
export type OS = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'chromeos' | 'unknown';

export interface DeviceInfo {
	browser: string;
	os: string;
	device: string;
	deviceVendor: string;
	deviceModel: string;
	engine: string;
	raw: string;
}

// ── Hash / Crypto ─────────────────────────────────────────────────────────────

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

// ── Environment ───────────────────────────────────────────────────────────────

export type EnvType = 'development' | 'production' | 'staging' | 'test';
export type LogLevel = LogLevelT;
export type StoreMode = 'redis' | 'kv' | 'memory';
export type StorageProviderType = 's3' | 'cloudinary' | 'imagekit' | 'local';

/** Validated environment config shape for @codexa/core. */
export interface EnvConfig {
	NODE_ENV: EnvType;
	PORT: number;
	SERVER_HOSTNAME: string;
	LOG_LEVEL: LogLevelT;
	LOG_DIR: string;
	LOG_FILE_ENABLED: boolean;
	LOG_MAX_FILE_SIZE: number;
	LOG_MAX_FILES: number;
	CACHE_TTL: number;
	CACHE_PREFIX: string;
	STORE_MODE: StoreMode;
	STORE_FALLBACK_TO_MEMORY: boolean;
	REDIS_URL?: string;
	REDIS_HOST: string;
	REDIS_PORT: number;
	REDIS_PASSWORD?: string;
	REDIS_DB: number;
	REDIS_KEY_PREFIX: string;
	DENO_KV_PATH?: string;
	DENO_KV_PREFIX: string;
	STORAGE_PROVIDER: StorageProviderType;
	S3_BUCKET?: string;
	S3_REGION?: string;
	S3_ACCESS_KEY?: string;
	S3_SECRET_KEY?: string;
	S3_ENDPOINT?: string;
	S3_CDN_BASE_URL?: string;
	CLOUDINARY_CLOUD_NAME?: string;
	CLOUDINARY_API_KEY?: string;
	CLOUDINARY_API_SECRET?: string;
	IMAGEKIT_PUBLIC_KEY?: string;
	IMAGEKIT_PRIVATE_KEY?: string;
	IMAGEKIT_URL_ENDPOINT?: string;
	LOCAL_STORAGE_DIR: string;
	LOCAL_BASE_URL?: string;
	[key: string]: unknown;
}

// ── Database / Model ──────────────────────────────────────────────────────────

export interface SystemFields {
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
	createdBy?: unknown;
	updatedBy?: unknown;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationInput {
	page: number;
	limit: number;
	sort: string;
	order: 'asc' | 'desc';
}

// ── Event Bus ─────────────────────────────────────────────────────────────────

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
	/**
	 * Initialise the event bus.
	 * @param opts.redisClient - Optional pre-connected Redis client for distributed pub/sub.
	 * @param opts.subscribeChannels - Redis channels to subscribe to on startup.
	 */
	initialize(opts: {
		// deno-lint-ignore no-explicit-any
		redisClient?: any;
		subscribeChannels?: string[];
	}): Promise<void>;
	on<T = unknown>(channel: string, event: string, handler: EventHandler<T>): void;
	once<T = unknown>(channel: string, event: string, handler: EventHandler<T>): void;
	off(channel?: string, event?: string, specificHandler?: EventHandler): void;
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

// ── Store ─────────────────────────────────────────────────────────────────────

export type StoreType = StoreMode;

export interface StoreSetOptions {
	/** TTL in seconds */
	ttl?: number;
	/** Alias for ttl (Redis EX) */
	ex?: number;
}

/**
 * Configuration for {@link initializeStore}.
 * Pass explicit connections rather than relying on environment variables.
 */
export interface StoreConfig {
	/**
	 * Backing store to use.
	 *   - `redis`  — requires `redisClient`
	 *   - `kv`     — uses Deno.openKv; optionally set `kvPath` and `kvPrefix`
	 *   - `memory` — in-process Map (default)
	 */
	mode?: StoreType;
	/** Fall back to in-memory when the chosen backend fails (default: true). */
	fallbackToMemory?: boolean;
	/**
	 * Pre-connected Redis client (required when `mode === 'redis'`).
	 * Obtain one from `createRedisConnection(...).connect()`.
	 */
	// deno-lint-ignore no-explicit-any
	redisClient?: any;
	/** Filesystem path for Deno KV. Omit for Deno Deploy managed KV. */
	kvPath?: string;
	/** Key prefix for Deno KV entries (default: 'store'). */
	kvPrefix?: string;
}

export interface IStore {
	set(key: string, value: unknown, options?: StoreSetOptions): Promise<string>;
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

// ── Storage ───────────────────────────────────────────────────────────────────

export type AssetType = 'image' | 'video' | 'document' | 'raw';

export interface StorageConfig {
	provider: StorageProviderType;
	s3?: {
		bucket: string;
		region: string;
		accessKey: string;
		secretKey: string;
		endpoint?: string;
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
	cloudinaryOpts?: Record<string, unknown> | Array<Record<string, unknown>>;
	imagekitOpts?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface UploadOptions {
	folder?: string;
	fileName?: string;
	overwrite?: boolean;
	contentType?: string;
	assetType?: AssetType;
	isPublic?: boolean;
	customId?: string;
	tags?: readonly string[];
	tenantId?: string;
	metadata?: Record<string, string>;
	eagerTransformations?: TransformationOptions[];
}

export interface UploadResult {
	key: string;
	size: number;
	contentType: string;
	url: string;
	assetType: AssetType;
	publicId?: string;
	format?: string;
	width?: number;
	height?: number;
	duration?: number;
	bitrate?: number;
	frameRate?: number;
	thumbnailUrl?: string;
}

export interface StorageProvider {
	upload(
		file: Uint8Array | ReadableStream<Uint8Array>,
		options?: UploadOptions,
	): Promise<UploadResult>;
	delete(key: string): Promise<void>;
	exists?(key: string): Promise<boolean>;
	getSignedUrl?(
		key: string,
		expiresIn?: number,
		transformation?: TransformationOptions,
	): Promise<string>;
	getTransformedUrl?(key: string, transformations: TransformationOptions): string;
}

// ── HTTP / API ────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
	success: boolean;
	message?: string;
	data?: T;
	error?: string;
	errors?: unknown;
	meta?: {
		timestamp: string;
		path?: string;
		requestId?: string;
		[key: string]: unknown;
	};
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

// ── Metrics ───────────────────────────────────────────────────────────────────

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

// Re-export global types for downstream use
export type { Empty, SafeProvide };
