/**
 * Shared by the roll page (a server component) and its client-side controls.
 * Kept out of the "use client" module on purpose: values exported from one
 * reach the server only as client references, not as the array itself.
 */
export const PAGE_SIZES = [25, 50, 100, 200] as const;

export const DEFAULT_PAGE_SIZE = 50;
