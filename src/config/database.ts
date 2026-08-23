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

import {
  type Db,
  MongoClient,
  type MongoClientOptions,
} from "../providers/mongodb.ts";

import { createLogger } from "../utils/logger.ts";

const log = createLogger("Codexa:MongoDB");

/**
 * MongoDB topology categories detected after connecting.
 */
export type MongoTopology =
  | "standalone"
  | "replica-set"
  | "sharded"
  | "load-balanced"
  | "unknown";

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
 * Extract a database name from a MongoDB URI.
 *
 * Supported examples:
 *
 * - mongodb://localhost:27017/myapp
 * - mongodb://localhost:27017/myapp?replicaSet=rs0
 * - mongodb+srv://user:password@cluster.mongodb.net/myapp
 * - mongodb+srv://cluster.mongodb.net/myapp?retryWrites=true
 *
 * Returns `null` when the URI does not contain a database name.
 */
function extractDatabaseNameFromUri(
  uri: string,
): string | null {
  const schemeMatch = uri.match(
    /^mongodb(?:\+srv)?:\/\//i,
  );

  if (schemeMatch === null) {
    return null;
  }

  const afterScheme = uri.slice(
    schemeMatch[0].length,
  );

  const pathStart = afterScheme.indexOf("/");

  if (pathStart === -1) {
    return null;
  }

  const pathAndQuery = afterScheme.slice(
    pathStart + 1,
  );

  const encodedName = pathAndQuery
    .split(/[?#]/, 1)[0]
    .trim();

  if (encodedName === "") {
    return null;
  }

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

/**
 * Resolve the database name from the URI and options.
 */
function resolveDatabaseName(
  uri: string,
  configuredDatabaseName?: string,
): string {
  const uriDatabaseName =
    extractDatabaseNameFromUri(uri);

  const optionDatabaseName =
    configuredDatabaseName?.trim();

  if (
    optionDatabaseName !== undefined &&
    optionDatabaseName === ""
  ) {
    throw new Error(
      "MongoDB options.databaseName cannot be empty.",
    );
  }

  if (
    uriDatabaseName !== null &&
    optionDatabaseName !== undefined &&
    uriDatabaseName !== optionDatabaseName
  ) {
    throw new Error(
      `MongoDB database name conflict: the URI specifies ` +
        `"${uriDatabaseName}", while options.databaseName specifies ` +
        `"${optionDatabaseName}". Provide the database name only once.`,
    );
  }

  const resolvedDatabaseName =
    uriDatabaseName ?? optionDatabaseName;

  if (
    resolvedDatabaseName === undefined ||
    resolvedDatabaseName === ""
  ) {
    throw new Error(
      "MongoDB database name is required. Include it in the URI " +
        "or provide options.databaseName.",
    );
  }

  return resolvedDatabaseName;
}

/**
 * Detect topology and transaction support using MongoDB's public `hello`
 * command.
 *
 * The implementation intentionally avoids private driver properties such as
 * `client.topology.description`, which can change between driver versions.
 */
async function detectCapabilities(
  database: Db,
): Promise<MongoDatabaseCapabilities> {
  const hello = await database.command({
    hello: 1,
  });

  const replicaSetName =
    typeof hello.setName === "string" &&
      hello.setName.trim() !== ""
      ? hello.setName
      : undefined;

  const isReplicaSet =
    replicaSetName !== undefined;

  const isSharded =
    hello.msg === "isdbgrid";

  const isLoadBalanced =
    hello.serviceId !== undefined &&
    hello.serviceId !== null;

  const maxWireVersion =
    typeof hello.maxWireVersion === "number"
      ? hello.maxWireVersion
      : undefined;

  const supportsSessions =
    typeof hello.logicalSessionTimeoutMinutes ===
      "number";

  /*
   * Replica-set transactions require MongoDB 4.0 or newer:
   * maxWireVersion >= 7.
   *
   * Sharded transactions require MongoDB 4.2 or newer:
   * maxWireVersion >= 8.
   *
   * Logical sessions are also required.
   */
  const supportsTransactions =
    supportsSessions &&
    maxWireVersion !== undefined &&
    (
      (isReplicaSet && maxWireVersion >= 7) ||
      (isSharded && maxWireVersion >= 8) ||
      (isLoadBalanced && maxWireVersion >= 8)
    );

  let topology: MongoTopology;

  if (isLoadBalanced) {
    topology = "load-balanced";
  } else if (isSharded) {
    topology = "sharded";
  } else if (isReplicaSet) {
    topology = "replica-set";
  } else if (hello.ok === 1) {
    topology = "standalone";
  } else {
    topology = "unknown";
  }

  return Object.freeze({
    topology,
    replicaSetName,
    isReplicaSet,
    isSharded,
    isLoadBalanced,
    supportsSessions,
    supportsTransactions,
    maxWireVersion,
  });
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
export function createMongoDatabase(
  uri: string,
  options: MongoDatabaseOptions = {},
): MongoDatabaseConnection {
  const normalizedUri = uri.trim();

  if (normalizedUri === "") {
    throw new Error(
      "MongoDB connection URI cannot be empty.",
    );
  }

  const {
    databaseName: configuredDatabaseName,
    requireTransactions = false,
    ...providedClientOptions
  } = options;

  const databaseName = resolveDatabaseName(
    normalizedUri,
    configuredDatabaseName,
  );

  /*
   * User-provided driver options override the defaults.
   *
   * There is only one configuration path. No nested clientOptions object is
   * needed.
   */
  const clientOptions: MongoClientOptions = {
    minPoolSize: 5,
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    connectTimeoutMS: 10_000,
    retryReads: true,
    ...providedClientOptions,
  };

  let client: MongoClient | null = null;
  let database: Db | null = null;

  let capabilities:
    | MongoDatabaseCapabilities
    | null = null;

  let connectingPromise: Promise<Db> | null =
    null;

  /**
   * Perform the actual MongoDB connection.
   */
  async function performConnect(): Promise<Db> {
    log.info("Connecting to MongoDB", {
      databaseName,
      replicaSet: clientOptions.replicaSet,
      requireTransactions,
    });

    const newClient = new MongoClient(
      normalizedUri,
      clientOptions,
    );

    /*
     * MongoClient events are optional observability helpers. They do not
     * control connection state.
     */
    newClient.on(
      "connectionPoolCreated",
      () => {
        log.debug(
          "MongoDB connection pool created",
          {
            databaseName,
          },
        );
      },
    );

    newClient.on(
      "connectionPoolClosed",
      () => {
        log.debug(
          "MongoDB connection pool closed",
          {
            databaseName,
          },
        );
      },
    );

    newClient.on(
      "error",
      (error: Error) => {
        log.error(
          "MongoDB client error",
          error,
        );
      },
    );

    try {
      await newClient.connect();

      const newDatabase =
        newClient.db(databaseName);

      /*
       * Verify that the selected database server is reachable before marking
       * the connection as active.
       */
      await newDatabase.command({
        ping: 1,
      });

      const detectedCapabilities =
        await detectCapabilities(newDatabase);

      if (
        requireTransactions &&
        !detectedCapabilities.supportsTransactions
      ) {
        throw new Error(
          `MongoDB deployment topology ` +
            `"${detectedCapabilities.topology}" does not support ` +
            "multi-document transactions.",
        );
      }

      if (
        !detectedCapabilities.supportsTransactions
      ) {
        log.warn(
          "Connected MongoDB deployment does not support transactions",
          {
            databaseName,
            topology:
              detectedCapabilities.topology,
            maxWireVersion:
              detectedCapabilities.maxWireVersion,
            supportsSessions:
              detectedCapabilities.supportsSessions,
          },
        );
      }

      /*
       * Publish connection state only after every connection and capability
       * check has succeeded.
       */
      client = newClient;
      database = newDatabase;
      capabilities = detectedCapabilities;

      log.info("Connected to MongoDB", {
        databaseName,
        topology:
          detectedCapabilities.topology,
        replicaSetName:
          detectedCapabilities.replicaSetName,
        supportsTransactions:
          detectedCapabilities
            .supportsTransactions,
        pool: {
          minimum: clientOptions.minPoolSize,
          maximum: clientOptions.maxPoolSize,
        },
      });

      return newDatabase;
    } catch (error) {
      /*
       * A partially connected client must always be closed.
       */
      await newClient.close().catch(
        (closeError: unknown) => {
          log.error(
            "Failed to close MongoDB client after connection failure",
            closeError,
          );
        },
      );

      client = null;
      database = null;
      capabilities = null;

      log.error(
        "Failed to connect to MongoDB",
        error,
      );

      throw error;
    }
  }

  /**
   * Return capabilities or throw when not connected.
   */
  function requireCapabilities():
    MongoDatabaseCapabilities {
    if (capabilities === null) {
      throw new Error(
        "MongoDB is not connected. Call connect() first.",
      );
    }

    return capabilities;
  }

  return Object.freeze({
    connect(): Promise<Db> {
      /*
       * Return the existing database when already connected.
       */
      if (
        client !== null &&
        database !== null
      ) {
        log.debug(
          "MongoDB is already connected",
          {
            databaseName,
          },
        );

        return Promise.resolve(database);
      }

      /*
       * Concurrent connect calls share the same promise, preventing multiple
       * clients and pools from being created.
       */
      if (connectingPromise !== null) {
        log.debug(
          "MongoDB connection is already in progress",
          {
            databaseName,
          },
        );

        return connectingPromise;
      }

      connectingPromise = performConnect()
        .finally(() => {
          connectingPromise = null;
        });

      return connectingPromise;
    },

    async disconnect(): Promise<void> {
      /*
       * If disconnect is requested while the initial connection is being
       * established, wait for that attempt to settle first.
       */
      if (connectingPromise !== null) {
        await connectingPromise.catch(() => {
          // The connection failure was already logged by performConnect().
        });
      }

      if (client === null) {
        return;
      }

      const closingClient = client;

      /*
       * Clear public connection state before awaiting close so new calls do
       * not receive a connection that is shutting down.
       */
      client = null;
      database = null;
      capabilities = null;

      try {
        await closingClient.close();

        log.info(
          "Disconnected from MongoDB",
          {
            databaseName,
          },
        );
      } catch (error) {
        log.error(
          "Failed to disconnect from MongoDB",
          error,
        );

        throw error;
      }
    },

    isConnected(): boolean {
      return (
        client !== null &&
        database !== null
      );
    },

    getDb(): Db {
      if (database === null) {
        throw new Error(
          "MongoDB is not connected. Call connect() first.",
        );
      }

      return database;
    },

    getClient(): MongoClient {
      if (client === null) {
        throw new Error(
          "MongoDB is not connected. Call connect() first.",
        );
      }

      return client;
    },

    getDatabaseName(): string {
      return databaseName;
    },

    getCapabilities():
      MongoDatabaseCapabilities {
      return requireCapabilities();
    },

    supportsTransactions(): boolean {
      return requireCapabilities()
        .supportsTransactions;
    },

    isReplicaSet(): boolean {
      return requireCapabilities()
        .isReplicaSet;
    },

    isSharded(): boolean {
      return requireCapabilities()
        .isSharded;
    },

    isLoadBalanced(): boolean {
      return requireCapabilities()
        .isLoadBalanced;
    },
  });
}