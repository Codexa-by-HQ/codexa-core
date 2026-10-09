/**
 * @module database
 *
 * Managed MongoDB connection factory for Codexa applications.
 *
 * Features:
 *
 * - Database name can come from the URI or `options.databaseName`.
 * - Uses one flattened MongoDB options object.
 * - Prevents conflicting database names.
 * - Prevents duplicate concurrent connections.
 * - Detects standalone, replica-set, sharded, and load-balanced deployments.
 * - Detects session and transaction support.
 * - Can require transaction support.
 * - Exposes the connected database, client, and capabilities.
 * - Handles disconnect requests during connection initialization.
 *
 * @example Database name from URI
 * ```ts
 * const mongo = createMongoDatabase(
 *   "mongodb://localhost:27017/myapp",
 * );
 *
 * const database = await mongo.connect();
 * ```
 *
 * @example Database name from options
 * ```ts
 * const mongo = createMongoDatabase(
 *   "mongodb://localhost:27017",
 *   {
 *     databaseName: "myapp",
 *     minPoolSize: 5,
 *     maxPoolSize: 20,
 *   },
 * );
 * ```
 *
 * @example Replica set with required transaction support
 * ```ts
 * const mongo = createMongoDatabase(
 *   "mongodb://host1:27017,host2:27017/myapp",
 *   {
 *     replicaSet: "rs0",
 *     requireTransactions: true,
 *   },
 * );
 *
 * await mongo.connect();
 *
 * console.log(mongo.isReplicaSet());
 * console.log(mongo.supportsTransactions());
 * ```
 */
import { type Db, MongoClient, type MongoClientOptions } from "../providers/mongodb.d.ts";
/**
 * MongoDB topology categories detected after connecting.
 */
export type MongoTopology = "standalone" | "replica-set" | "sharded" | "load-balanced" | "unknown";
/**
 * Capabilities detected from the connected MongoDB deployment.
 */
export interface MongoDatabaseCapabilities {
    /**
     * General deployment topology.
     */
    readonly topology: MongoTopology;
    /**
     * Replica-set name reported by MongoDB.
     *
     * This is undefined for standalone and sharded deployments.
     */
    readonly replicaSetName?: string;
    /**
     * True when connected directly to a replica set.
     */
    readonly isReplicaSet: boolean;
    /**
     * True when connected through mongos to a sharded cluster.
     */
    readonly isSharded: boolean;
    /**
     * True when the deployment uses MongoDB load-balanced mode.
     */
    readonly isLoadBalanced: boolean;
    /**
     * True when the deployment supports logical sessions.
     */
    readonly supportsSessions: boolean;
    /**
     * True when the deployment supports multi-document transactions.
     */
    readonly supportsTransactions: boolean;
    /**
     * Wire protocol version reported by MongoDB.
     */
    readonly maxWireVersion?: number;
}
/**
 * Options accepted by {@link createMongoDatabase}.
 *
 * These options extend the MongoDB driver's `MongoClientOptions`, so MongoDB
 * driver options are supplied directly without a nested `clientOptions`
 * property.
 *
 * @example
 * ```ts
 * {
 *   databaseName: "myapp",
 *   minPoolSize: 5,
 *   maxPoolSize: 20,
 *   serverSelectionTimeoutMS: 10_000,
 *   retryWrites: true,
 *   replicaSet: "rs0"
 * }
 * ```
 */
export interface MongoDatabaseOptions extends MongoClientOptions {
    /**
     * Database name to use when the URI does not contain one.
     *
     * If the URI and this property contain different names, connection creation
     * throws an error rather than silently selecting one.
     */
    databaseName?: string;
    /**
     * Require the deployment to support multi-document transactions.
     *
     * When enabled, `connect()` throws if MongoDB is standalone or otherwise
     * incapable of running transactions.
     *
     * @default false
     */
    requireTransactions?: boolean;
}
/**
 * Managed MongoDB connection returned by {@link createMongoDatabase}.
 */
export interface MongoDatabaseConnection {
    /**
     * Open the MongoDB connection.
     *
     * Calling this more than once is safe. Concurrent calls share the same
     * connection promise.
     */
    connect(): Promise<Db>;
    /**
     * Gracefully close the MongoDB connection.
     */
    disconnect(): Promise<void>;
    /**
     * Return whether the connection is currently open.
     */
    isConnected(): boolean;
    /**
     * Return the active MongoDB database.
     *
     * Throws when the connection has not been opened.
     */
    getDb(): Db;
    /**
     * Return the active MongoDB client.
     *
     * Throws when the connection has not been opened.
     */
    getClient(): MongoClient;
    /**
     * Return the resolved database name.
     */
    getDatabaseName(): string;
    /**
     * Return the detected deployment capabilities.
     *
     * Throws when the connection has not been opened.
     */
    getCapabilities(): MongoDatabaseCapabilities;
    /**
     * Return whether multi-document transactions are supported.
     *
     * Throws when the connection has not been opened.
     */
    supportsTransactions(): boolean;
    /**
     * Return whether the deployment is a replica set.
     *
     * Throws when the connection has not been opened.
     */
    isReplicaSet(): boolean;
    /**
     * Return whether the deployment is a sharded cluster.
     *
     * Throws when the connection has not been opened.
     */
    isSharded(): boolean;
    /**
     * Return whether the deployment uses load-balanced mode.
     *
     * Throws when the connection has not been opened.
     */
    isLoadBalanced(): boolean;
}
/**
 * Create a managed MongoDB connection.
 *
 * The connection is created lazily. MongoDB is not contacted until
 * `connect()` is called.
 *
 * @param uri MongoDB connection string.
 * @param options MongoDB driver and Codexa connection options.
 */
export declare function createMongoDatabase(uri: string, options?: MongoDatabaseOptions): MongoDatabaseConnection;
