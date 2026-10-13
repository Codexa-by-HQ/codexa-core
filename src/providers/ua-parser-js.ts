/**
 * @module @codexa/core/providers/ua-parser-js
 *
 * Provider re-export for `ua-parser-js`.
 */

import { UAParser } from 'ua-parser-js';

export { UAParser };
export const uaParserJs: typeof UAParser = UAParser;
export default UAParser;
