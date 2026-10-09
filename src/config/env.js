/* @ts-self-types="./env.d.ts" */
import { load as envLoad } from "../providers/dotenv.js";
import { AnyZodObject, zod, ZodError, ZodInfer } from "../providers/zod.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger('Codexa:Env');
export class Environment {
    static instance;
    config = {};
    _loaded = false;
    static getInstance() {
        if (!Environment.instance) {
            Environment.instance = new Environment();
        }
        return Environment.instance;
    }
    get loaded() {
        return this._loaded;
    }
    async loadEnv(options) {
        const { paths = ['.env'], schema, loadFiles = true, } = options ?? {};
        const pathList = Array.isArray(paths) ? paths : [paths];
        let fileVars = {};
        if (loadFiles) {
            for (const envPath of pathList) {
                try {
                    const loaded = await envLoad({
                        envPath,
                        export: true,
                    });
                    fileVars = { ...fileVars, ...loaded };
                    log.info(`Loaded env from: ${envPath}`);
                }
                catch {
                    log.debug(`Env file not found or unreadable: ${envPath} (skipped)`);
                }
            }
        }
        const merged = {
            ...fileVars,
            ...Deno.env.toObject(),
        };
        if (schema) {
            try {
                this.config = schema.parse(merged);
                log.info('Environment validated successfully');
            }
            catch (error) {
                if (error instanceof ZodError) {
                    log.fatal('Environment validation failed:');
                    error.issues.forEach((err) => {
                        log.fatal(`  [${err.path.join('.')}] ${err.message}`);
                    });
                    throw new Error('Invalid environment configuration. See log output above.');
                }
                throw error;
            }
        }
        else {
            this.config = merged;
            log.info('Environment loaded (no schema validation - raw values)');
        }
        this._loaded = true;
        return this.config;
    }
    get(key) {
        if (key in this.config) {
            return this.config[key];
        }
        return Deno.env.get(key);
    }
    getAll() {
        return { ...this.config };
    }
    getConfig() {
        return this.config;
    }
    enabled(key) {
        const raw = this.config[key] ?? Deno.env.get(key);
        if (!raw)
            return false;
        return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase());
    }
    number(key, defaultValue) {
        const raw = this.config[key] ?? Deno.env.get(key);
        if (raw === undefined || raw === null)
            return defaultValue;
        const parsed = Number(raw);
        return Number.isNaN(parsed) ? defaultValue : parsed;
    }
    list(key) {
        const raw = this.config[key] ?? Deno.env.get(key);
        if (!raw)
            return [];
        return String(raw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    is(type) {
        return this.get('NODE_ENV') === type;
    }
    isDevelopment() {
        return this.is('development');
    }
    isProduction() {
        return this.is('production');
    }
    isTest() {
        return this.is('test');
    }
}
export const env = Environment.getInstance();
