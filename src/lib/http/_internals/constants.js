/* @ts-self-types="./constants.d.ts" */
export const HTTP_METHODS = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'HEAD',
];
export const HTTP_METHOD_SET = new Set(HTTP_METHODS);
export const DEFAULT_VERSION_HEADER = 'X-Version';
