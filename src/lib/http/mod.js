/* @ts-self-types="./mod.d.ts" */
import { HTTP_METHODS } from "./_internals/constants.js";
export { DEFAULT_VERSION_HEADER, HTTP_METHODS, } from "./_internals/constants.js";
export { serveStatic } from "./static.js";
export { createApp, http } from "./_registries/http.js";
export { createRouter, router } from "./_registries/router.js";
export { defineMiddleware, definePlugin, definePluginMiddleware, plugin, } from "./_registries/plugin.js";
