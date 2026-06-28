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

/** Default header used by versioned routes when a plugin does not override it. */
export const DEFAULT_VERSION_HEADER = 'X-Version';
