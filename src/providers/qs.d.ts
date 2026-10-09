/**
 * @module @codexa/core/providers/qs
 *
 * Full provider re-export for `qs`.
 */
import qs from 'qs';
export { qs };
export default qs;
export declare const parse: typeof qs.parse;
export declare const stringify: typeof qs.stringify;
export declare const formats: typeof qs.formats;
export type IParseOptions = qs.IParseOptions;
export type IStringifyOptions = qs.IStringifyOptions;
export type ParsedQs = qs.ParsedQs;
