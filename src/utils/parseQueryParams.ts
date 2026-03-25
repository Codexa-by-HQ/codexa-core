import qs from 'qs';

/**
 * Parse a query string into a structured object.
 * Automatically strips the leading `?` if present.
 *
 * Uses `qs` for full nested object/array support:
 *   - `?a[b]=c` → `{ a: { b: 'c' } }`
 *   - `?tags[]=a&tags[]=b` → `{ tags: ['a', 'b'] }`
 *
 * @example
 * ```ts
 * const params = parseQueryParams('?page=1&limit=20&sort[field]=name');
 * // { page: '1', limit: '20', sort: { field: 'name' } }
 *
 * const params = parseQueryParams('page=1&filters[status]=active&sort=name');
 * // { page: '1', filters: { status: 'active' }, sort: 'name' }
 * ```
 */
export function parseQueryParams(
	query: string,
	options?: qs.IParseOptions,
): qs.ParsedQs {
	return qs.parse(query, {
		ignoreQueryPrefix: true,
		// depth: 3,
		// parameterLimit: 50,
		...options,
	});
}
