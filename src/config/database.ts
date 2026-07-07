/**
 * @module database
 *
 * Managed MongoDB connection factory for `@codexa/core`.
 *
 * @example Standalone (default - no replica set required)
 * ```ts
 * import { createMongoDatabase } from '@codexa/core/config';
 *
 * const mongo = createMongoDatabase('mongodb://localhost:27017', 'myapp');
 * const db = await mongo.connect();
 * ```
 *
 * @example Replica Set (transactions enabled)
 * ```ts
 * const mongo = createMongoDatabase(
 *   'mongodb://localhost:27017/myapp?replicaSet=rs0',
 *   'myapp',
 *   { replicaSet: true },
 * );
 * const db = await mongo.connect(); // throws if not a replica set
 * ```
 */

import {
	type Db,
	MongoClient,
	type MongoClientOptions,
} from '../providers/mongodb.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('Codexa:MongoDB');

/**
 * Options for {@link createMongoDatabase}.
 */
export interface MongoDatabaseOptions {
	/**
	 * When `true`, the connection **requires** a replica set or sharded
	 * cluster. If the server is standalone, `connect()` will throw.
	 *
	 * When `false` (default), standalone connections are allowed but a
	 * warning is logged that transactions are unavailable.
	 *
	 * @default false
	 */
	replicaSet?: boolean;
	/** Minimum connection pool size (default: 5). */
	minPoolSize?: number;
	/** Maximum connection pool size (default: 20). */
	maxPoolSize?: number;
	/** Server selection timeout in ms (default: 10 000). */
	serverSelectionTimeoutMS?: number;
	/** Socket timeout in ms (default: 45 000). */
	socketTimeoutMS?: number;
	/** Connect timeout in ms (default: 10 000). */
	connectTimeoutMS?: number;
	/** Extra MongoClientOptions forwarded to the driver. */
	clientOptions?: Partial<MongoClientOptions>;
}

/**
 * A managed/controlled MongoDB connection returned by {@link createMongoDatabase}.
 */
export interface MongoDatabaseConnection {
	/** Open the connection. Safe to call multiple times. */
	connect(): Promise<Db>;
	/** Gracefully close the connection. */
	disconnect(): Promise<void>;
	/** Return the active `Db` instance. Throws if not connected. */
	getDb(): Db;
	/** Return the active `MongoClient`. Throws if not connected. */
	getClient(): MongoClient;
	/** True when the server supports multi-document transactions. */
	supportsTransactions(): boolean;
}

/**
 * Safely extract the database name from any MongoDB URI variant:
 *  - mongodb://host:27017/dbname
 *  - mongodb://host:27017/dbname?replicaSet=rs0
 *  - mongodb+srv://user:pass@cluster.mongodb.net/dbname
 *  - mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority
 *  - mongodb://localhost:27017              (no db name → null)
 *  - mongodb+srv://cluster.mongodb.net      (no db name → null)
 */
function extractDbNameFromUri(uri: string): string | null {
	try {
		// Normalize both schemes to something the WHATWG URL parser accepts
		const normalized = uri
			.replace(/^mongodb\+srv:\/\//i, 'https://')
			.replace(/^mongodb:\/\//i, 'http://');

		const parsed = new URL(normalized);

		// pathname is either empty, "/", or "/dbname" or "/dbname?..."
		// strip the leading slash then drop anything after "?"
		const name = parsed.pathname
			.replace(/^\//, '') // remove leading slash
			.split('?')[0] // drop inline query string (edge-case safety)
			.trim();

		return name.length > 0 ? name : null;
	} catch {
		// Malformed URI - let MongoClient surface the real error later
		return null;
	}
}

/**
 * Inspect whether the connected server supports multi-document transactions.
 */
async function detectTransactionSupport(
	database: Db,
	client: MongoClient,
): Promise<boolean> {
	try {
		const hello = await database.command({ hello: 1 });
		const isReplicaSet = typeof hello.setName === 'string' &&
			hello.setName.length > 0;
		const isMongos = hello.msg === 'isdbgrid';
		// deno-lint-ignore no-explicit-any
		const topologyType = (client as any)?.topology?.description?.type as
			| string
			| undefined;
		const topologySupports = topologyType === 'ReplicaSetWithPrimary' ||
			topologyType === 'ReplicaSetNoPrimary' ||
			topologyType === 'Sharded';
		return isReplicaSet || isMongos || topologySupports;
	} catch {
		return false;
	}
}

/**
 * Create a managed MongoDB connection.
 *
 * The connection is **not opened** until you call `.connect()`.
 *
 * @param uri    - MongoDB connection string.
 * @param dbName - Database name.
 * @param options - Connection options.
 */
export function createMongoDatabase(
	uri: string,
	dbName: string,
	options: MongoDatabaseOptions = {},
): MongoDatabaseConnection {
	let client: MongoClient | null = null;
	let db: Db | null = null;
	let _supportsTransactions = false;
	let _connecting: Promise<Db> | null = null;

	const {
		replicaSet = false,
		minPoolSize = 5,
		maxPoolSize = 20,
		serverSelectionTimeoutMS = 10_000,
		socketTimeoutMS = 45_000,
		connectTimeoutMS = 10_000,
		clientOptions = {},
	} = options;

	async function _connect(): Promise<Db> {
		log.info('Connecting to MongoDB', { dbName, replicaSet });

		//  URI db-name conflict detection
		const uriDbName = extractDbNameFromUri(uri);
		if (uriDbName && uriDbName !== dbName) {
			log.warn(
				`[createMongoDatabase] Database name conflict: ` +
					`URI contains "${uriDbName}" but the dbName argument is "${dbName}". ` +
					`The explicit dbName "${dbName}" will be used. ` +
					`To silence this warning, remove the database name from the URI.`,
			);
		}

		const driverOpts = {
			minPoolSize,
			maxPoolSize,
			serverSelectionTimeoutMS,
			socketTimeoutMS,
			connectTimeoutMS,
			// retryWrites needs replica set - disable for standalone
			retryWrites: replicaSet,
			retryReads: true,
			...clientOptions,
		} as MongoClientOptions;

		const newClient = new MongoClient(uri, driverOpts);

		// Connection pool lifecycle logging
		newClient.on(
			'connectionPoolCreated',
			() => log.debug('Connection pool created'),
		);
		newClient.on(
			'connectionPoolClosed',
			() => log.debug('Connection pool closed'),
		);
		newClient.on(
			'error',
			(error: Error) => log.error('MongoDB client error', error),
		);

		try {
			await newClient.connect();
			const newDb = newClient.db(dbName);

			// Verify connectivity
			await newDb.command({ ping: 1 });

			// Detect replica set support
			const supported = await detectTransactionSupport(newDb, newClient);

			if (replicaSet && !supported) {
				await newClient.close().catch(() => {});
				throw new Error(
					'MongoDB server does not support multi-document transactions. ' +
						'The connection string does not point to a replica set or sharded cluster.\n' +
						'Either:\n' +
						'  1. Convert your standalone MongoDB to a replica set ' +
						'(use `mongod --replSet rs0` and run `rs.initiate()` in mongosh)\n' +
						'  2. Set `replicaSet: false` in createMongoDatabase options ' +
						'to use standalone mode (transactions disabled)',
				);
			}

			if (!supported) {
				log.warn(
					'⚠️  MongoDB is running in standalone mode. ' +
						'Multi-document transactions are NOT available. ' +
						'To enable transactions, use a replica set or sharded cluster. ' +
						'Set `replicaSet: true` to enforce this.',
				);
			}

			client = newClient;
			db = newDb;
			_supportsTransactions = supported;

			const topoLabel = supported
				? 'replica-set/sharded (transactions enabled)'
				: 'standalone (transactions disabled)';

			log.info(`Connected to "${dbName}"`, {
				topology: topoLabel,
				pool: `${minPoolSize}-${maxPoolSize}`,
			});

			return db;
		} catch (error) {
			client = null;
			db = null;
			_supportsTransactions = false;
			await newClient.close().catch(() => {});
			log.error('Failed to connect to database', error);
			throw error;
		}
	}

	return {
		connect(): Promise<Db> {
			if (client && db) {
				log.debug('Database already connected');
				return Promise.resolve(db);
			}
			if (_connecting) {
				log.debug('Connection already in progress - awaiting');
				return _connecting;
			}
			_connecting = _connect().finally(() => {
				_connecting = null;
			});
			return _connecting;
		},

		async disconnect(): Promise<void> {
			if (!client) return;
			const closing = client;
			client = null;
			db = null;
			_supportsTransactions = false;
			await closing.close();
			log.info('Disconnected from MongoDB');
		},

		getDb(): Db {
			if (!db) {
				throw new Error(
					'Database not connected. Call connect() first.',
				);
			}
			return db;
		},

		getClient(): MongoClient {
			if (!client) {
				throw new Error(
					'Database not connected. Call connect() first.',
				);
			}
			return client;
		},

		supportsTransactions(): boolean {
			return _supportsTransactions;
		},
	};
}
