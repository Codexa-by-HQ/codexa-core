import { type Db, MongoClient, type MongoClientOptions } from 'mongodb';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('MongoDB');

/**
 * Options for {@link createMongoDatabase}.
 */
export interface MongoDatabaseOptions {
	/** Minimum connection pool size (default: 5) */
	minPoolSize?: number;
	/** Maximum connection pool size (default: 20) */
	maxPoolSize?: number;
	/** Server selection timeout in ms (default: 5 000) */
	serverSelectionTimeoutMS?: number;
	/** Socket timeout in ms (default: 45 000) */
	socketTimeoutMS?: number;
	/** Connect timeout in ms (default: 10 000) */
	connectTimeoutMS?: number;
	/** Extra MongoClientOptions forwarded to the driver */
	clientOptions?: Partial<MongoClientOptions>;
}

/**
 * A managed MongoDB connection returned by {@link createMongoDatabase}.
 */
export interface MongoDatabaseConnection {
	/**
	 * Open the connection. Safe to call multiple times — subsequent calls
	 * return the existing connection.
	 */
	connect(): Promise<Db>;
	/** Gracefully close the connection. */
	disconnect(): Promise<void>;
	/** Return the active `Db` instance. Throws if not connected. */
	getDb(): Db;
	/** Return the active `MongoClient`. Throws if not connected. */
	getClient(): MongoClient;
	/**
	 * True when the server supports multi-document transactions
	 * (replica set or sharded cluster).
	 */
	supportsTransactions(): boolean;
}

/**
 * Inspect whether the connected server supports multi-document transactions.
 * Transactions require a replica set or sharded cluster.
 */
async function detectTransactionSupport(
	database: Db,
	client: MongoClient,
): Promise<boolean> {
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
}

/**
 * Create a managed MongoDB connection.
 *
 * The connection is **not opened** until you call `.connect()`.
 * The library enforces that the target server supports multi-document
 * transactions (replica set or sharded cluster).
 *
 * @example
 * ```ts
 * import { createMongoDatabase } from '@codexa/core/config';
 *
 * const db = createMongoDatabase(
 *   Deno.env.get('MONGODB_URI')!,
 *   Deno.env.get('MONGODB_DATABASE') ?? 'myapp',
 * );
 *
 * await db.connect();
 * const database = db.getDb();
 * ```
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
		minPoolSize = 5,
		maxPoolSize = 20,
		serverSelectionTimeoutMS = 5_000,
		socketTimeoutMS = 45_000,
		connectTimeoutMS = 10_000,
		clientOptions = {},
	} = options;

	async function _connect(): Promise<Db> {
		log.info('Connecting to MongoDB', { dbName });

		const newClient = new MongoClient(uri, {
			minPoolSize,
			maxPoolSize,
			serverSelectionTimeoutMS,
			socketTimeoutMS,
			connectTimeoutMS,
			retryWrites: true,
			retryReads: true,
			...clientOptions,
		} as MongoClientOptions);

		newClient.on(
			'connectionPoolCreated',
			() => log.debug('Connection pool created'),
		);
		newClient.on(
			'connectionPoolClosed',
			() => log.debug('Connection pool closed'),
		);
		newClient.on('error', (error) => log.error('MongoDB client error', error));
		newClient.on('topologyClosed', () => {
			log.warn(
				'MongoDB topology closed — connection state reset. ' +
					'The next operation will trigger reconnection.',
			);
			client = null;
			db = null;
			_supportsTransactions = false;
		});

		try {
			await newClient.connect();
			const newDb = newClient.db(dbName);
			await newDb.command({ ping: 1 });

			const supported = await detectTransactionSupport(newDb, newClient);
			if (!supported) {
				await newClient.close().catch(() => {});
				throw new Error(
					'MongoDB server does not support multi-document transactions. ' +
						'Please connect to a replica set or sharded cluster.\n' +
						'Local dev: use `mongod --replSet rs0` and run `rs.initiate()` in mongosh.',
				);
			}

			client = newClient;
			db = newDb;
			_supportsTransactions = true;

			log.info(`Connected to "${dbName}"`, {
				topology: 'replica-set / sharded (transactions enabled)',
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
				log.debug('Connection already in progress — awaiting');
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
