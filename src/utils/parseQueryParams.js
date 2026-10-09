/* @ts-self-types="./parseQueryParams.d.ts" */
import qs, {} from "../providers/qs.js";
export function parseQueryParams(query, options) {
    return qs.parse(query, {
        ignoreQueryPrefix: true,
        ...options,
    });
}
