// Build-time constants (vite.config.ts `define`): the build the page is.

/** The commit the site was built from (7 hex digits), or "dev". */
declare const __MHJDOJO_SITE_VERSION__: string;
/** A hash of everything the site was built from: it changes with any change that reaches the page. */
declare const __MHJDOJO_SITE_ID__: string;
/** When the site was built (ISO 8601). */
declare const __MHJDOJO_SITE_BUILT__: string;
/** The release the site was built as (e.g. v2026.0927.0), or null outside the Release site workflow. */
declare const __MHJDOJO_SITE_RELEASE__: string | null;
