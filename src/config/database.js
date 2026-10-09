/* @ts-self-types="./database.d.ts" */
import { MongoClient, } from "../providers/mongodb.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("Codexa:MongoDB");
function extractDatabaseNameFromUri(uri) {
    const schemeMatch = uri.match(/^mongodb(?:\+srv)?:\/\//i);
    if (schemeMatch === null) {
        return null;
    }
    const afterScheme = uri.slice(schemeMatch[0].length);
    const pathStart = afterScheme.indexOf("/");
    if (pathStart === -1) {
        return null;
    }
    const pathAndQuery = afterScheme.slice(pathStart + 1);
    const encodedName = pathAndQuery
        .split(/[?#]/, 1)[0]
        .trim();
    if (encodedName === "") {
        return null;
    }
    try {
        return decodeURIComponent(encodedName);
    }
    catch {
        return encodedName;
    }
}
function resolveDatabaseName(uri, configuredDatabaseName) {
    const uriDatabaseName = extractDatabaseNameFromUri(uri);
    const optionDatabaseName = configuredDatabaseName?.trim();
    if (optionDatabaseName !== undefined &&
        optionDatabaseName === "") {
        throw new Error("MongoDB options.databaseName cannot be empty.");
    }
    if (uriDatabaseName !== null &&
        optionDatabaseName !== undefined &&
        uriDatabaseName !== optionDatabaseName) {
        throw new Error(`MongoDB database name conflict: the URI specifies ` +
            `"${uriDatabaseName}", while options.databaseName specifies ` +
            `"${optionDatabaseName}". Provide the database name only once.`);
    }
    const resolvedDatabaseName = uriDatabaseName ?? optionDatabaseName;
    if (resolvedDatabaseName === undefined ||
        resolvedDatabaseName === "") {
        throw new Error("MongoDB database name is required. Include it in the URI " +
            "or provide options.databaseName.");
    }
    return resolvedDatabaseName;
}
async function detectCapabilities(database) {
    const hello = await database.command({
        hello: 1,
    });
    const replicaSetName = typeof hello.setName === "string" &&
        hello.setName.trim() !== ""
        ? hello.setName
        : undefined;
    const isReplicaSet = replicaSetName !== undefined;
    const isSharded = hello.msg === "isdbgrid";
    const isLoadBalanced = hello.serviceId !== undefined &&
        hello.serviceId !== null;
    const maxWireVersion = typeof hello.maxWireVersion === "number"
        ? hello.maxWireVersion
        : undefined;
    const supportsSessions = typeof hello.logicalSessionTimeoutMinutes ===
        "number";
    const supportsTransactions = supportsSessions &&
        maxWireVersion !== undefined &&
        ((isReplicaSet && maxWireVersion >= 7) ||
            (isSharded && maxWireVersion >= 8) ||
            (isLoadBalanced && maxWireVersion >= 8));
    let topology;
    if (isLoadBalanced) {
        topology = "load-balanced";
    }
    else if (isSharded) {
        topology = "sharded";
    }
    else if (isReplicaSet) {
        topology = "replica-set";
    }
    else if (hello.ok === 1) {
        topology = "standalone";
    }
    else {
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
export function createMongoDatabase(uri, options = {}) {
    const normalizedUri = uri.trim();
    if (normalizedUri === "") {
        throw new Error("MongoDB connection URI cannot be empty.");
    }
    const { databaseName: configuredDatabaseName, requireTransactions = false, ...providedClientOptions } = options;
    const databaseName = resolveDatabaseName(normalizedUri, configuredDatabaseName);
    const clientOptions = {
        minPoolSize: 5,
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        connectTimeoutMS: 10_000,
        retryReads: true,
        ...providedClientOptions,
    };
    let client = null;
    let database = null;
    let capabilities = null;
    let connectingPromise = null;
    async function performConnect() {
        log.info("Connecting to MongoDB", {
            databaseName,
            replicaSet: clientOptions.replicaSet,
            requireTransactions,
        });
        const newClient = new MongoClient(normalizedUri, clientOptions);
        newClient.on("connectionPoolCreated", () => {
            log.debug("MongoDB connection pool created", {
                databaseName,
            });
        });
        newClient.on("connectionPoolClosed", () => {
            log.debug("MongoDB connection pool closed", {
                databaseName,
            });
        });
        newClient.on("error", (error) => {
            log.error("MongoDB client error", error);
        });
        try {
            await newClient.connect();
            const newDatabase = newClient.db(databaseName);
            await newDatabase.command({
                ping: 1,
            });
            const detectedCapabilities = await detectCapabilities(newDatabase);
            if (requireTransactions &&
                !detectedCapabilities.supportsTransactions) {
                throw new Error(`MongoDB deployment topology ` +
                    `"${detectedCapabilities.topology}" does not support ` +
                    "multi-document transactions.");
            }
            if (!detectedCapabilities.supportsTransactions) {
                log.warn("Connected MongoDB deployment does not support transactions", {
                    databaseName,
                    topology: detectedCapabilities.topology,
                    maxWireVersion: detectedCapabilities.maxWireVersion,
                    supportsSessions: detectedCapabilities.supportsSessions,
                });
            }
            client = newClient;
            database = newDatabase;
            capabilities = detectedCapabilities;
            log.info("Connected to MongoDB", {
                databaseName,
                topology: detectedCapabilities.topology,
                replicaSetName: detectedCapabilities.replicaSetName,
                supportsTransactions: detectedCapabilities
                    .supportsTransactions,
                pool: {
                    minimum: clientOptions.minPoolSize,
                    maximum: clientOptions.maxPoolSize,
                },
            });
            return newDatabase;
        }
        catch (error) {
            await newClient.close().catch((closeError) => {
                log.error("Failed to close MongoDB client after connection failure", closeError);
            });
            client = null;
            database = null;
            capabilities = null;
            log.error("Failed to connect to MongoDB", error);
            throw error;
        }
    }
    function requireCapabilities() {
        if (capabilities === null) {
            throw new Error("MongoDB is not connected. Call connect() first.");
        }
        return capabilities;
    }
    return Object.freeze({
        connect() {
            if (client !== null &&
                database !== null) {
                log.debug("MongoDB is already connected", {
                    databaseName,
                });
                return Promise.resolve(database);
            }
            if (connectingPromise !== null) {
                log.debug("MongoDB connection is already in progress", {
                    databaseName,
                });
                return connectingPromise;
            }
            connectingPromise = performConnect()
                .finally(() => {
                connectingPromise = null;
            });
            return connectingPromise;
        },
        async disconnect() {
            if (connectingPromise !== null) {
                await connectingPromise.catch(() => {
                });
            }
            if (client === null) {
                return;
            }
            const closingClient = client;
            client = null;
            database = null;
            capabilities = null;
            try {
                await closingClient.close();
                log.info("Disconnected from MongoDB", {
                    databaseName,
                });
            }
            catch (error) {
                log.error("Failed to disconnect from MongoDB", error);
                throw error;
            }
        },
        isConnected() {
            return (client !== null &&
                database !== null);
        },
        getDb() {
            if (database === null) {
                throw new Error("MongoDB is not connected. Call connect() first.");
            }
            return database;
        },
        getClient() {
            if (client === null) {
                throw new Error("MongoDB is not connected. Call connect() first.");
            }
            return client;
        },
        getDatabaseName() {
            return databaseName;
        },
        getCapabilities() {
            return requireCapabilities();
        },
        supportsTransactions() {
            return requireCapabilities()
                .supportsTransactions;
        },
        isReplicaSet() {
            return requireCapabilities()
                .isReplicaSet;
        },
        isSharded() {
            return requireCapabilities()
                .isSharded;
        },
        isLoadBalanced() {
            return requireCapabilities()
                .isLoadBalanced;
        },
    });
}
