/**
 * @module @codexa/core/providers/qs
 *
 * Full provider re-export for `qs`.
 */

import qs from 'qs';

export { qs };
export default qs;

export const parse: typeof qs.parse = qs.parse;
export const stringify: typeof qs.stringify = qs.stringify;
export const formats: typeof qs.formats = qs.formats;

export type IParseOptions = qs.IParseOptions;
export type IStringifyOptions = qs.IStringifyOptions;
export type ParsedQs = qs.ParsedQs;
