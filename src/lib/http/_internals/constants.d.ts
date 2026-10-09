/** Supported HTTP methods accepted by Codexa route definitions. */
export declare const HTTP_METHODS: readonly [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD"
];
/** Same values as {@link HTTP_METHODS}, for O(1) membership checks on the request path. */
export declare const HTTP_METHOD_SET: ReadonlySet<string>;
/** Default header used by versioned routes when a plugin does not override it. */
export declare const DEFAULT_VERSION_HEADER = "X-Version";
