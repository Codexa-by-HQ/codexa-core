/** Supported HTTP methods accepted by Codexa route definitions. */
export const HTTP_METHODS = [
	'GET',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
	'OPTIONS',
	'HEAD',
] as const;

/** Same values as {@link HTTP_METHODS}, for O(1) membership checks on the request path. */
export const HTTP_METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);

/** Default header used by versioned routes when a plugin does not override it. */
export const DEFAULT_VERSION_HEADER = 'X-Version';
